"""Resolve byte-preserved ottoman recipes without consulting temporary output."""
import hashlib
import json
from pathlib import Path
import re
import shutil


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative_path(value, *, historical=False):
    """Normalize recorded Windows separators, but never normalize away traversal."""
    if not isinstance(value, str) or not value or (not historical and '\\' in value):
        raise ValueError('Invalid ottoman bundle path')
    name = value.replace('\\', '/')
    parts = name.split('/')
    if (any(part in ('', '.', '..') or part.endswith((' ', '.')) for part in parts)
            or re.search(r'[:<>"|?*\x00-\x1f]', name)):
        raise ValueError(f'Invalid ottoman bundle path: {value!r}')
    if any(re.fullmatch(r'CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3]',
                        part.split('.')[0], re.IGNORECASE) for part in parts):
        raise ValueError(f'Reserved device in ottoman bundle path: {value!r}')
    if not historical and parts[0] != 'assets':
        raise ValueError('Ottoman archive path must stay under assets')
    return name


class OttomanBundle:
    def __init__(self, root, records):
        self.root = root
        self.records = records

    def resolve(self, historical, expected_sha=None):
        name = relative_path(historical, historical=True)
        if name not in self.records:
            raise ValueError(f'Unmapped ottoman dependency: {name}')
        row = self.records[name]
        if expected_sha is not None and expected_sha != row['sha256']:
            raise ValueError(f'Receipt hash differs from ottoman mapping: {name}')
        path = (self.root / row['path']).resolve()
        if not path.is_relative_to(self.root / 'assets'):
            raise ValueError(f'Ottoman archive path escaped assets: {name}')
        if not path.is_file():
            raise ValueError(f'Missing ottoman archived file: {name}')
        if digest(path) != row['sha256']:
            raise ValueError(f'Ottoman bundle hash mismatch: {name}')
        return path

    def materialize(self, names, destination):
        """Copy selected recipe inputs into a new root; archived evidence stays intact."""
        sources = [(relative_path(name, historical=True), self.resolve(name)) for name in names]
        if not sources or len({name.casefold() for name, _ in sources}) != len(sources):
            raise ValueError('Replay needs a nonempty, unique dependency inventory')
        destination = Path(destination).resolve()
        destination.mkdir(parents=True, exist_ok=False)
        for name, source in sources:
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            if digest(target) != self.records[name]['sha256']:
                raise ValueError(f'Replay copy hash mismatch: {name}')
        return destination


def load_bundle(catalog, *, root):
    root = Path(root).resolve()
    data = json.loads(Path(catalog).read_text(encoding='utf-8'))
    if (not isinstance(data, dict) or type(data.get('version')) is not int
            or data['version'] != 1 or data.get('asset') != 'ottoman_sit'
            or not isinstance(data.get('files'), list) or not data['files']):
        raise ValueError('Invalid ottoman bundle inventory')
    records, names, targets = {}, set(), set()
    for row in data['files']:
        if (not isinstance(row, dict) or set(row) != {'historical', 'path', 'sha256'}
                or not isinstance(row['sha256'], str)
                or not re.fullmatch(r'[0-9a-f]{64}', row['sha256'])):
            raise ValueError('Invalid ottoman bundle file record')
        name = relative_path(row['historical'], historical=True)
        target = relative_path(row['path'])
        if name.casefold() in names:
            raise ValueError(f'Duplicate historical ottoman path: {name}')
        if target.casefold() in targets:
            raise ValueError(f'Duplicate archive ottoman path: {target}')
        names.add(name.casefold())
        targets.add(target.casefold())
        records[name] = row
    bundle = OttomanBundle(root, records)
    for name in bundle.records:
        bundle.resolve(name)
    return bundle
