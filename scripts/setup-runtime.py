"""Download only locked runtime tooling into the guarded D workspace."""
import hashlib, json, os, pathlib, subprocess, tarfile, urllib.request

_validation_file = os.environ.get('CODELEADER_VALIDATION_INPUTS')
if not _validation_file or not pathlib.Path(_validation_file).is_absolute() or pathlib.Path(_validation_file).drive.upper() != 'D:':
    raise RuntimeError('Set CODELEADER_VALIDATION_INPUTS explicitly before using this historical validation tool')
_validation = json.loads(pathlib.Path(_validation_file).read_text(encoding='utf-8'))['files'][pathlib.Path(__file__).name]

root = pathlib.Path(__file__).resolve().parent.parent
assert root.drive.upper() == 'D:'
tools = root / '.tools' / 'runtime'
assert tools.resolve().drive.upper() == 'D:', 'Resolved tooling path must stay on D'
tools.mkdir(parents=True, exist_ok=True)
lock = json.loads((root / 'runtime/dependencies.json').read_text())
for name in ('javaAgent', 'collector'):
    item = lock[name]
    dest = tools / item['url'].rsplit('/', 1)[-1]
    assert dest.resolve().drive.upper() == 'D:'
    if not dest.exists():
        print('Downloading', name, flush=True)
        urllib.request.urlretrieve(item['url'], dest)
    item['sha256'] = hashlib.sha256(dest.read_bytes()).hexdigest()
    if name == 'collector' and not (tools / 'otelcol.exe').exists():
        with tarfile.open(dest) as archive:
            member = next(m for m in archive.getmembers() if m.name.endswith('otelcol-contrib.exe'))
            (tools / 'otelcol.exe').write_bytes(archive.extractfile(member).read())
(tools / 'download-provenance.json').write_text(json.dumps(lock, indent=2))
venv = tools / 'python'
assert venv.resolve().drive.upper() == 'D:'
if not venv.exists():
    subprocess.run([os.sys.executable, '-m', 'venv', str(venv)], check=True)
python = venv / 'Scripts/python.exe'
subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check', '-r', str(root / 'runtime/requirements.txt'), '-r', _validation['requirements']['value']], check=True)
with (tools / 'python-freeze.txt').open('w') as out:
    subprocess.run([str(python), '-m', 'pip', 'freeze'], stdout=out, check=True)
