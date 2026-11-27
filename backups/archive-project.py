"""Archive the public library's referenced images on this repository's Releases.

Runs on GitHub's runner; no model archive is copied back to the user's Mac.
Only the three image hosts already present in the public catalogs are requested.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path.cwd()
WORK = ROOT / '_project_backup'
WORK.mkdir(exist_ok=True)
REPO = os.environ['GITHUB_REPOSITORY']
TOKEN = os.environ['GH_TOKEN']
API = 'https://api.github.com/repos/' + REPO
TAG = 'project-backup-2026-11-27'
HOSTS = {'static.zarahome.net', 'image.hm.com', 'cdn3.hipicon.com'}
IMAGE = re.compile(r'\.(?:jpe?g|png|webp)(?:$|[?&])', re.I)


def api(path, payload=None, method='GET', binary=None):
    data = binary if binary is not None else (json.dumps(payload).encode() if payload is not None else None)
    headers = {'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2022-11-28',
               'Content-Type': 'application/octet-stream' if binary is not None else 'application/json'}
    url = path if path.startswith('https://') else API + path
    # Repository authorization is sent only to GitHub's API/upload endpoints.
    parsed = urllib.parse.urlsplit(url)
    assert parsed.hostname in {'api.github.com', 'uploads.github.com'}
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=240) as response:
        return json.load(response)


def release():
    try:
        return api('/releases/tags/' + TAG)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    return api('/releases', {'tag_name': TAG, 'name': 'Complete project backup · 2026-11-27',
                            'body': 'Original reference images, runtime dependency copies and the complete restoration manifest. Original GLB models remain in the four existing model releases. Generation sources are in backups/source-recipes.zip on main.',
                            'draft': False, 'prerelease': False}, 'POST')


release_info = release()
existing_assets = {}
for page in range(1, 100):
    assets = api('/releases/' + str(release_info['id']) + '/assets?per_page=100&page=' + str(page))
    existing_assets.update({asset['name']: asset for asset in assets})
    if len(assets) < 100:
        break


def upload(path):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    name = path.stem + '-' + digest[:12] + path.suffix
    if name in existing_assets:
        asset = existing_assets[name]
        assert asset['size'] == path.stat().st_size
        assert asset.get('digest') == 'sha256:' + digest
    else:
        url = release_info['upload_url'].split('{')[0] + '?name=' + urllib.parse.quote(name)
        asset = api(url, method='POST', binary=path.read_bytes())
        assert asset['state'] == 'uploaded' and asset['size'] == path.stat().st_size
        assert asset.get('digest') == 'sha256:' + digest
        existing_assets[name] = asset
    return {'filename': name, 'bytes': asset['size'], 'sha256': digest, 'download_url': asset['browser_download_url']}


def image_key(url):
    parsed = urllib.parse.urlsplit(url)
    # Hipicon puts resize parameters after '.jpg' in the path, instead of '?'.
    path = re.split(r'(?i)(?<=\.jpg)&|(?<=\.jpeg)&|(?<=\.png)&|(?<=\.webp)&', parsed.path)[0]
    return parsed.hostname + re.sub('/+', '/', path)


urls = set()


def visit(value):
    if isinstance(value, dict):
        for child in value.values():
            visit(child)
    elif isinstance(value, list):
        for child in value:
            visit(child)
    elif isinstance(value, str) and value.startswith('https://'):
        parsed = urllib.parse.urlsplit(value)
        if parsed.hostname in HOSTS and IMAGE.search(value):
            urls.add(value)


for source in ROOT.glob('*.json'):
    visit(json.loads(source.read_text()))

groups = {}
for url in sorted(urls):
    groups.setdefault(image_key(url), []).append(url)


def score(url):
    sizes = re.findall(r'(?:[?&](?:imwidth|w)=)(\d+)', url)
    return max(map(int, sizes), default=0)


def fetch_image(item):
    key, variants = item
    targets = sorted(variants, key=score, reverse=True)
    last_error = None
    for attempt in range(3):
        for url in targets[:3]:
            try:
                assert urllib.parse.urlsplit(url).hostname in HOSTS
                request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*'})
                with urllib.request.urlopen(request, timeout=35) as response:
                    assert urllib.parse.urlsplit(response.url).hostname in HOSTS
                    mime = response.headers.get_content_type()
                    assert mime.startswith('image/'), mime
                    data = response.read()
                assert len(data) > 100
                if data[:2] == b'\xff\xd8':
                    extension = '.jpg'
                elif data[:8] == b'\x89PNG\r\n\x1a\n':
                    extension = '.png'
                elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
                    extension = '.webp'
                else:
                    raise ValueError('Unrecognized image header: ' + mime)
                filename = hashlib.sha256(key.encode()).hexdigest() + extension
                target = WORK / 'photos' / filename
                target.parent.mkdir(exist_ok=True)
                target.write_bytes(data)
                return {'key': key, 'original_urls': variants, 'captured_url': url, 'filename': 'images/' + filename,
                        'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'mime': mime}, None
            except Exception as error:
                last_error = type(error).__name__ + ': ' + str(error)
                if isinstance(error, urllib.error.HTTPError) and error.code in {404, 410}:
                    break
        if attempt < 2:
            time.sleep(attempt + 1)
    return None, {'key': key, 'original_urls': variants, 'error': last_error}


manifest_path = ROOT / 'backups' / 'complete-project-manifest.json'
prior = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
completed = {record['key']: record for record in prior.get('images', [])
             if record.get('archive') in existing_assets}
parts = list(prior.get('image_archives', []))
missing = [(key, variants) for key, variants in groups.items() if key not in completed]
captured, failed = [], []
print(f'Reference image URLs: {len(urls)}; distinct images: {len(groups)}; already archived: {len(completed)}', flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
    for index, (record, failure) in enumerate(executor.map(fetch_image, missing), 1):
        if record:
            captured.append(record)
        if failure:
            failed.append(failure)
        if index % 100 == 0 or index == len(missing):
            print(f'Processed {index}/{len(missing)}; saved {len(captured)}; unavailable {len(failed)}', flush=True)


def zip_part(records, number):
    path = WORK / ('reference-images-' + str(number).zfill(4) + '.zip')
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_STORED) as archive:
        for record in records:
            info = zipfile.ZipInfo(record['filename'], (2026, 11, 27, 0, 0, 0))
            archive.writestr(info, (WORK / 'photos' / Path(record['filename']).name).read_bytes())
    asset = upload(path)
    for record in records:
        record['archive'] = asset['filename']
        completed[record['key']] = record
    parts.append(asset)
    print(f'Archived {len(records)} reference images in {asset["filename"]}', flush=True)


batch, size = [], 0
number = len(parts) + 1
for record in sorted(captured, key=lambda record: record['key']):
    if batch and size + record['bytes'] > 128 * 1024 * 1024:
        zip_part(batch, number)
        batch, size, number = [], 0, number + 1
    batch.append(record)
    size += record['bytes']
if batch:
    zip_part(batch, number)

# Keep copies of the exact small runtime dependencies referenced by the app.
dependencies = [
    'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
    'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js',
    'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js',
    'https://cdn.jsdelivr.net/npm/meshoptimizer@0.25.0/meshopt_decoder.module.js',
    'https://registry.npmjs.org/three/-/three-0.160.0.tgz',
    'https://registry.npmjs.org/meshoptimizer/-/meshoptimizer-0.25.0.tgz',
    'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Manrope:wght@400;500;600&display=swap',
]
dependency_records = []
dependency_archive = WORK / 'runtime-dependencies.zip'
with zipfile.ZipFile(dependency_archive, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for url in dependencies:
        with urllib.request.urlopen(url, timeout=45) as response:
            data = response.read()
        extension = '.tgz' if url.endswith('.tgz') else '.css' if 'googleapis' in url else '.js'
        filename = 'vendor/' + hashlib.sha256(url.encode()).hexdigest() + extension
        archive.writestr(filename, data)
        dependency_records.append({'url': url, 'filename': filename, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        if filename.endswith('.css'):
            for font_url in sorted(set(re.findall(r'url\((https://fonts\.gstatic\.com/[^)]+)\)', data.decode()))):
                with urllib.request.urlopen(font_url, timeout=45) as response:
                    font = response.read()
                name = 'vendor/' + hashlib.sha256(font_url.encode()).hexdigest() + Path(urllib.parse.urlsplit(font_url).path).suffix
                archive.writestr(name, font)
                dependency_records.append({'url': font_url, 'filename': name, 'bytes': len(font), 'sha256': hashlib.sha256(font).hexdigest()})
    archive.writestr('dependency-index.json', json.dumps(dependency_records, indent=2))
dependency_asset = upload(dependency_archive)

originals = json.loads((ROOT / 'backups' / 'full-model-archive.json').read_text())
manifest = {
    'schema_version': 1, 'verified_on': '2026-11-27', 'repository': REPO,
    'status': 'complete' if len(completed) == len(groups) else 'partial',
    'original_models': {'count': originals['model_count'], 'bytes': originals['total_bytes'], 'index': 'backups/full-model-archive.json'},
    'generation_source_files': 937, 'generation_source_archive': 'backups/source-recipes.zip',
    'source_image_urls': len(urls), 'distinct_source_images': len(groups),
    'archived_images': len(completed), 'unavailable_images': failed,
    'image_archives': parts, 'images': sorted(completed.values(), key=lambda record: record['key']),
    'runtime_dependency_archive': dependency_asset,
    'note': 'The live site keeps original source-photo links. These image archives preserve the project independently of those links. Originals contain the image bytes returned by the URLs already recorded in the catalogs; no image edits were made.'
}
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
manifest_asset = upload(manifest_path)
subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], check=True)
subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], check=True)
subprocess.run(['git', 'add', 'backups/complete-project-manifest.json'], check=True)
if subprocess.run(['git', 'diff', '--cached', '--quiet']).returncode:
    subprocess.run(['git', 'commit', '-m', 'Record complete project archive and original reference image backups'], check=True)
    subprocess.run(['git', 'push', 'origin', 'HEAD:main'], check=True)
print(json.dumps({'status': manifest['status'], 'original_models': originals['model_count'],
                  'archived_images': len(completed), 'unavailable_images': len(failed),
                  'release': release_info['html_url'], 'manifest': manifest_asset['download_url']}), flush=True)
if failed:
    raise SystemExit('Archive is partial: unavailable original image URLs are recorded in the manifest.')
