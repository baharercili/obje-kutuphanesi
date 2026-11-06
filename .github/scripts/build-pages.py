"""Package only the already verified browser app; models stay in public storage."""
import hashlib
import json
import os
from pathlib import Path
import shutil

root = Path(os.environ.get('OBJE_PAGES_SOURCE_ROOT', '.')).resolve()
manifest = json.loads((root / '.github/pages-site-manifest.json').read_text())
originals = json.loads((root / 'full-model-index.json').read_text())
index = json.loads((root / 'model-assets.json').read_text())
receipt = json.loads((root / 'publish-receipt.json').read_text())
if len(originals) != 2609 or set(index['models']) != set(originals):
    raise ValueError('Complete model coverage is required')
if index.get('asset_base_url') != 'https://raw.githubusercontent.com/baharercili/obje-kutuphanesi/main/':
    raise ValueError('Expected independent public preview storage')
if (receipt['models_verified'] != 2609 or receipt['preview_models'] != 2609
        or receipt['original_bytes'] != manifest['original_bytes']
        or receipt['preview_pack_bytes'] != manifest['preview_bytes']):
    raise ValueError('Publication receipt coverage differs')
checks = {r['id']: r for r in receipt['model_checksums']}
if set(checks) != set(originals) or any(checks[k]['sha256'] != v['sha256'] for k, v in originals.items()):
    raise ValueError('Original checksum receipt differs')
out = root / '_site'
out.mkdir(exist_ok=True)
if any(p.is_dir() for p in out.iterdir()):
    raise ValueError('Unexpected directory in the static app output')
for row in manifest['files']:
    name = row['filename']
    if Path(name).name != name or name in {'.', '..'}:
        raise ValueError('Unexpected app path')
    source = root / name
    if source.stat().st_size != row['bytes'] or hashlib.sha256(source.read_bytes()).hexdigest() != row['sha256']:
        raise ValueError('App file differs from the accepted bundle: ' + name)
    shutil.copyfile(source, out / name)
shutil.copyfile(root / 'publish-receipt.json', out / 'publish-receipt.json')
if not (out / 'index.html').is_file() or sum(p.stat().st_size for p in out.iterdir()) > 900 * 1024 * 1024:
    raise ValueError('Invalid static browser app output')
print(json.dumps({'models': len(originals), 'app_files': len(list(out.iterdir())),
                  'site_bytes': sum(p.stat().st_size for p in out.iterdir()),
                  'model_directories_in_artifact': False}))
