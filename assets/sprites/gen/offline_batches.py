"""Interleave reviewed static and animated batches without renumbering sprites."""
import json
from pathlib import Path

from offline_bunk import load_reviewed_bunk
from offline_props import inside, load_props


def load_batches(path, *, model_root=None, existing_names=()):
    path = Path(path).resolve()
    root = Path(model_root).resolve() if model_root is not None else path.parent
    data = json.loads(path.read_text())
    if type(data.get('version')) is not int or data['version'] != 1:
        raise ValueError('unsupported atlas batch version')
    rows = data.get('batches')
    if not isinstance(rows, list) or not rows:
        raise ValueError('atlas batches are empty')
    names, catalogs, result = set(existing_names), set(), []
    for row in rows:
        if not isinstance(row, dict) or row.get('kind') not in ('static', 'bunk'):
            raise ValueError('unknown atlas batch kind')
        catalog = inside(root, row.get('catalog'))
        if catalog in catalogs:
            raise ValueError('duplicate atlas batch catalog')
        catalogs.add(catalog)
        if row['kind'] == 'static':
            loaded = load_props(catalog, existing_names=names)
            sprites = loaded[0]
        else:
            loaded = load_reviewed_bunk(catalog, existing_names=names)
            sprites = loaded.sprites
        names.update(sprite[0] for sprite in sprites)
        result.append((row['kind'], loaded))
    return result
