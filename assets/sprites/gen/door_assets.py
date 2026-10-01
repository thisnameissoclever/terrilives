"""Append checked model renders without changing historical sprite identities."""
import hashlib
import json
from pathlib import Path
from PIL import Image

BASE = Path(__file__).resolve().parents[2] / 'models/doors/export'


def records():
    manifest = json.loads((BASE / 'manifest.json').read_text())
    expected = [name for facing in range(4) for name in
                [f'doorFrame{facing}', *[f'doorLeaf{facing}_{phase}' for phase in range(9)]]]
    assert [r['name'] for r in manifest['records']] == expected
    assert manifest['density'] == 3 and manifest['canvas'] == [112, 120]
    for relative, expected_hash in manifest['inputs'].items():
        path = BASE.parent.parent / relative
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected_hash, relative
    result = []
    for record in manifest['records']:
        for suffix in ('', 'Depth'):
            name = record['name'] + suffix
            path = BASE / f'{name}.png'
            assert hashlib.sha256(path.read_bytes()).hexdigest() == record['sha256'][suffix], name
            image = Image.open(path).convert('RGBA')
            assert image.size == (336, 360), name
            result.append((name, image, *image.size))
    return result
