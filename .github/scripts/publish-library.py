"""One-off GitHub Actions transfer of the explicitly approved public library."""
import concurrent.futures as cf
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

REPOSITORY = 'baharercili/obje-kutuphanesi'
MANIFEST_URL = os.environ['TRANSFER_MANIFEST_URL']
ORIGIN = urllib.parse.urlsplit(MANIFEST_URL)
if ORIGIN.scheme != 'https' or not ORIGIN.hostname.endswith('.trycloudflare.com'):
    raise ValueError('Expected the approved temporary HTTPS transfer source')
SOURCE = ORIGIN.scheme + '://' + ORIGIN.netloc
TOKEN = os.environ['GH_TOKEN']
PHASE = os.environ.get('PUBLISH_PHASE', 'all')
SELECTED_RELEASE = os.environ.get('MODEL_RELEASE')
if PHASE not in {'all', 'originals', 'web'}:
    raise ValueError('Invalid publication phase')
if os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
    raise ValueError('Unexpected destination repository')
API = 'https://api.github.com/repos/' + REPOSITORY
APPROVED = json.loads(Path('full-model-index.json').read_text())
if len(APPROVED) != 2609:
    raise ValueError('Approved model registry is incomplete')
RATE_LOCK = threading.Lock()
RATE_UNTIL = 0

def respect_rate_pause():
    while True:
        with RATE_LOCK:
            remaining = RATE_UNTIL - time.time()
        if remaining <= 0:
            return
        time.sleep(min(30, remaining))

def rate_pause(until):
    global RATE_UNTIL
    with RATE_LOCK:
        RATE_UNTIL = max(RATE_UNTIL, until)
    print('GitHub requested a pause until ' + datetime.datetime.fromtimestamp(until, datetime.timezone.utc).isoformat(), flush=True)

def request(url, data=None, method='GET', api=False, binary=False):
    headers = {'User-Agent': 'obje-kutuphanesi-publisher'}
    if api:
        if urllib.parse.urlsplit(url).hostname not in {'api.github.com', 'uploads.github.com'}:
            raise ValueError('Unexpected authenticated destination')
        headers.update({'Authorization': 'Bearer ' + TOKEN,
                        'Accept': 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2022-11-28'})
    if data is not None:
        if binary:
            headers['Content-Type'] = 'model/gltf-binary'
        else:
            data = json.dumps(data).encode()
            headers['Content-Type'] = 'application/json'
    for attempt in range(6):
        try:
            if api:
                respect_rate_pause()
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=240) as response:
                body = response.read()
                if api and response.headers.get('X-RateLimit-Remaining') == '0':
                    rate_pause(int(response.headers['X-RateLimit-Reset']) + 5)
            if binary and not api:
                return body
            return json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            if api and error.code in {403, 429}:
                message = error.read().decode('utf8', errors='replace').lower()
                limited = error.headers.get('X-RateLimit-Remaining') == '0' or 'rate limit' in message or error.headers.get('Retry-After')
                if limited and attempt < 5:
                    if error.headers.get('X-RateLimit-Remaining') == '0':
                        until = int(error.headers['X-RateLimit-Reset']) + 5
                    else:
                        until = time.time() + max(60 * 2 ** attempt, int(error.headers.get('Retry-After', '0')))
                    rate_pause(until)
                    continue
            if error.code not in {429, 500, 502, 503, 504} or attempt == 5:
                raise RuntimeError(f'HTTP {error.code} during {method} {urllib.parse.urlsplit(url).path}') from None
            time.sleep(min(60, max(2 ** attempt, int(error.headers.get('Retry-After', '0')))))
        except (TimeoutError, OSError):
            if attempt == 5:
                raise RuntimeError('Transfer timed out: ' + urllib.parse.urlsplit(url).path) from None
            time.sleep(min(30, 2 ** attempt))

def manifest():
    result = request(MANIFEST_URL)
    if result.get('repository') != REPOSITORY:
        raise ValueError('Source names an unexpected repository')
    rows = [model for group in result['groups'] for model in group['models']]
    if len(rows) != 2609 or len({m['id'] for m in rows}) != 2609:
        raise ValueError('Expected all 2,609 approved models')
    if {row['id'] for row in rows} != set(APPROVED):
        raise ValueError('Source model scope differs from the approved registry')
    for group in result['groups']:
        for row in group['models']:
            approved = APPROVED[row['id']]
            if (any(row[key] != approved[key] for key in ['filename', 'sha256', 'bytes'])
                    or group['tag'] != approved['release_tag']):
                raise ValueError('Source differs from approved original: ' + row['id'])
    for row in rows:
        if not re.fullmatch('[a-f0-9]{64}', row['sha256']):
            raise ValueError('Invalid source checksum')
        if row.get('encoding') == 'gzip':
            expected = '/originals/' + row['sha256'] + '/' + urllib.parse.quote(row['filename']) + '.gz'
        elif row.get('encoding') == 'glbpkt1':
            expected = '/lossless/' + row['sha256'] + '/' + urllib.parse.quote(row['filename']) + '.glbpkt'
        else:
            raise ValueError('Unsupported lossless transport')
        if row['path'] != expected or Path(row['filename']).name != row['filename']:
            raise ValueError('Unexpected source path')
    return result

def assets(release):
    result = []
    for page in range(1, 12):
        batch = request(release['assets_url'] + f'?per_page=100&page={page}', api=True)
        result.extend(batch)
        if len(batch) < 100:
            break
    return {asset['name']: asset for asset in result}

def verified(asset, row):
    return (asset.get('state') == 'uploaded' and asset['size'] == row['bytes']
            and asset.get('digest') == 'sha256:' + row['sha256'])

data = manifest()
work_groups = [group for group in data['groups'] if not SELECTED_RELEASE or group['tag'] == SELECTED_RELEASE]
if not work_groups or (SELECTED_RELEASE and PHASE != 'originals'):
    raise ValueError('Invalid release selection')
existing_releases = request(API + '/releases?per_page=100', api=True)
releases, tasks, receipts = {}, [], []
for group in work_groups:
    tag = group['tag']
    release = next((item for item in existing_releases if item['tag_name'] == tag), None)
    if release is None:
        release = request(API + '/releases', {
            'tag_name': tag, 'target_commitish': 'main', 'name': group['name'],
            'draft': True, 'body': f"{len(group['models'])} özgün GLB; geometri ve gömülü yüzey malzemeleri korunur."
        }, method='POST', api=True)
    releases[tag] = release
    uploaded = assets(release)
    expected_names = {row['filename'] for row in group['models']}
    if set(uploaded) - expected_names:
        raise ValueError('Unexpected existing release assets: ' + tag)
    for row in group['models']:
        prior = uploaded.get(row['filename'])
        if prior and verified(prior, row):
            receipts.append({'id': row['id'], 'sha256': row['sha256'], 'asset_id': prior['id']})
        elif (prior and prior.get('state') == 'starter' and prior.get('digest') is None
              and prior['size'] == row['bytes']
              and (prior['id'] in {715282711, 715251305, 715253959, 715255578}
                   or prior.get('uploader', {}).get('login') == 'github-actions[bot]')):
            # Retry incomplete task uploads; a completed asset is never removed here.
            request(prior['url'], method='DELETE', api=True)
            tasks.append((release, row))
        elif prior:
            raise ValueError('Existing asset does not match the approved original: ' + row['filename'])
        else:
            tasks.append((release, row))

def transfer(task):
    release, row = task
    body = request(SOURCE + row['path'], binary=True)
    if row['encoding'] == 'gzip':
        body = gzip.decompress(body)
    else:
        decoded = subprocess.run(['node', '.github/scripts/decode-packet.mjs', '--module-root', '.github/scripts/vendor',
                                  '--expected-sha256', row['sha256']], input=body, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        if decoded.returncode:
            raise ValueError('Lossless decoding failed for ' + row['filename'] + ': ' + decoded.stderr.decode('utf8', errors='replace')[-1500:])
        body = decoded.stdout
    if len(body) != row['bytes'] or hashlib.sha256(body).hexdigest() != row['sha256']:
        raise ValueError('Source integrity mismatch: ' + row['filename'])
    url = release['upload_url'].split('{')[0] + '?name=' + urllib.parse.quote(row['filename'])
    asset = request(url, body, method='POST', api=True, binary=True)
    if not verified(asset, row):
        raise ValueError('Uploaded asset integrity mismatch: ' + row['filename'])
    return {'id': row['id'], 'sha256': row['sha256'], 'asset_id': asset['id']}

scope_total = sum(len(group['models']) for group in work_groups)
if PHASE == 'web' and tasks:
    raise ValueError('Web publication requires every original to be verified first')
print(f'Already verified {len(receipts)} originals; transferring {len(tasks)}. Scope: {SELECTED_RELEASE or "all releases"}.', flush=True)
with cf.ThreadPoolExecutor(max_workers=8) as pool:
    futures = [pool.submit(transfer, task) for task in tasks]
    try:
      for future in cf.as_completed(futures):
        receipts.append(future.result())
        if len(receipts) % 25 == 0:
            print(f'Originals verified: {len(receipts)}/{scope_total}', flush=True)
    except BaseException:
        for future in futures:
            future.cancel()
        raise

for group in work_groups:
    release = releases[group['tag']]
    uploaded = assets(release)
    if len(uploaded) != len(group['models']) or any(not verified(uploaded.get(row['filename'], {}), row) for row in group['models']):
        raise ValueError('Release verification failed: ' + group['tag'])
    if release['draft']:
        request(release['url'], {'draft': False, 'make_latest': 'false'}, method='PATCH', api=True)
    print('Published and verified ' + group['tag'], flush=True)

if PHASE == 'originals':
    print(f'Release complete: {len(receipts)}/{scope_total} originals verified.', flush=True)
    sys.exit(0)

# The owner enables this manifest only after all local previews and audits pass.
for attempt in range(360):
    data = manifest()
    if data['web'].get('ready'):
        break
    if attempt % 4 == 0:
        print('Waiting for the completed, audited web bundle.', flush=True)
    time.sleep(30)
else:
    raise RuntimeError('Completed web bundle was not supplied within three hours')

rows = data['web']['files']
names = [row['filename'] for row in rows]
if len(names) != len(set(names)) or not {'index.html', 'model-assets.json', 'model-transport.js'} <= set(names):
    raise ValueError('Incomplete web bundle')
for row in rows:
    if row['kind'] not in {'app', 'pack'}:
        raise ValueError('Unexpected web file type')
    valid_name = (bool(re.fullmatch(r'models/[a-f0-9]{64}\.modelpack', row['filename'])) if row['kind'] == 'pack'
                  else Path(row['filename']).name == row['filename'] and row['filename'] not in {'.', '..'})
    if not valid_name or row['path'] != '/web/' + urllib.parse.quote(row['filename']):
        raise ValueError('Unexpected web path')

def download_web(row):
    destination = Path(row['filename'])
    if destination.is_file() and destination.stat().st_size == row['bytes']:
        if hashlib.sha256(destination.read_bytes()).hexdigest() == row['sha256']:
            return row
    body = request(SOURCE + row['path'], binary=True)
    if len(body) != row['bytes'] or hashlib.sha256(body).hexdigest() != row['sha256']:
        raise ValueError('Web asset integrity mismatch: ' + row['filename'])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(body)
    return row

def git(*args):
    subprocess.run(['git', *args], check=True)

git('config', 'user.name', 'github-actions[bot]')
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
packs = [row for row in rows if row['kind'] == 'pack']
pending, size = [], 0
with cf.ThreadPoolExecutor(max_workers=8) as pool:
    for row in pool.map(download_web, packs):
        pending.append(row['filename'])
        size += row['bytes']
        if size >= 400 * 1024 * 1024:
            git('add', '--', *pending)
            if subprocess.run(['git', 'diff', '--cached', '--quiet']).returncode:
                git('commit', '-m', 'Add verified browser model packs')
                git('push', 'origin', 'HEAD:main')
            pending, size = [], 0
if pending:
    git('add', '--', *pending)
    if subprocess.run(['git', 'diff', '--cached', '--quiet']).returncode:
        git('commit', '-m', 'Add remaining verified browser model packs')
        git('push', 'origin', 'HEAD:main')

app = [row for row in rows if row['kind'] == 'app']
with cf.ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(download_web, app))
index = json.loads(Path('model-assets.json').read_text())
if set(index['models']) != {row['id'] for group in data['groups'] for row in group['models']}:
    raise ValueError('Web model index does not include every approved model')
if {row['file'] for row in index['packs']} != {row['filename'] for row in packs}:
    raise ValueError('Web model pack coverage mismatch')
receipt = {
    'published_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'models_verified': len(receipts), 'original_bytes': sum(row['bytes'] for group in data['groups'] for row in group['models']),
    'preview_models': len(index['models']), 'preview_pack_bytes': sum(row['bytes'] for row in packs),
    'releases': [{'tag': group['tag'], 'models': len(group['models'])} for group in data['groups']],
    'model_checksums': sorted(receipts, key=lambda item: item['id'])
}
Path('publish-receipt.json').write_text(json.dumps(receipt, separators=(',', ':')) + '\n')
git('add', '--', *[row['filename'] for row in app], 'publish-receipt.json')
if subprocess.run(['git', 'diff', '--cached', '--quiet']).returncode:
    git('commit', '-m', 'Publish complete three-brand browser library and verification receipt')
    git('push', 'origin', 'HEAD:main')
out = Path('_site')
out.mkdir(exist_ok=True)
for row in app:
    shutil.copyfile(row['filename'], out / row['filename'])
shutil.copyfile('publish-receipt.json', out / 'publish-receipt.json')
if sum(file.stat().st_size for file in out.iterdir()) > 900 * 1024 * 1024:
    raise ValueError('Published app exceeds the Pages size budget')
print('All 2,609 originals, previews and app files verified. Ready for Pages.', flush=True)
