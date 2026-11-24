"""Install sampled pool depth while preserving the other outdoor rectangles."""

import argparse
import hashlib
import json
from pathlib import Path
import tomllib

import numpy as np
from PIL import Image

from fixture_depth_encoding import decode_fixture_depth

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[3]
ATLAS_PATH = ROOT / 'assets/sprites/atlas.toml'
PUBLIC = ROOT / 'web/public'
CATALOGS = ('static-props-07.json', 'static-props-08.json')
POOL_NAMES = ('offlinePool', 'offlinePoolRectangular')
FACINGS = ('SE', 'NW', 'SW', 'NE')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def check_bytes(path, sha):
    data = path.read_bytes()
    if digest(data) != sha:
        raise ValueError(f'Changed pool depth input: {path}')
    return data


def pack(compact, wide, output):
    atlas_bytes = ATLAS_PATH.read_bytes()
    atlas = tomllib.loads(atlas_bytes.decode())
    atlas_rows = {row['name']: (index, row) for index, row in enumerate(atlas['sprite'])}
    outdoor = BASE / 'outdoor-depth'
    manifest = json.loads((outdoor / 'manifest.json').read_bytes())
    page, = manifest['pages']
    prior = check_bytes(outdoor / page['path'], page['sha256'])
    plane = np.frombuffer(prior, dtype=np.uint8).reshape(page['height'], page['width'], 4).copy()
    entries = {row['name']: row for row in manifest['sprites']}
    append_y = max(row['y'] + row['h'] for row in entries.values())
    append_x = 0

    models = ROOT / 'assets/models'
    catalog = {row['name']: models / row['directory'] for name in CATALOGS
               for row in json.loads((models / name).read_bytes())['objects']}
    for prefix, samples in zip(POOL_NAMES, (compact, wide), strict=True):
        source = catalog[prefix]
        report = json.loads((samples / 'proof.json').read_bytes())
        if report['state'] != 'complete' or tuple(row['facing'] for row in report['sprites']) != FACINGS:
            raise ValueError(f'Expected four completed depth samples for {prefix}')
        check_bytes(source / 'proof.json', report['proofSha256'])
        model = source / 'pool-authoring.blend'
        check_bytes(model, report['modelSha256'])
        manifest['sources'][prefix] = dict(path=model.relative_to(ROOT).as_posix(), sha256=report['modelSha256'])
        for name, sha in report['producerHashes'].items():
            check_bytes(BASE / name, sha)
            manifest['producerHashes'][name] = sha

        for row in report['sprites']:
            facing = '' if row['facing'] == 'SE' else row['facing']
            name = prefix + facing
            if row['name'] != name or row['source'] != prefix:
                raise ValueError(f'Depth sample name differs from {name}')
            sprite_index, sprite = atlas_rows[name]
            width, height = row['w'], row['h']
            if (width, height, row['pixelDensity']) != (sprite['w'], sprite['h'], sprite['pixel_density']):
                raise ValueError(f'Atlas registration changed for {name}')
            pixels = np.frombuffer(check_bytes(samples / row['path'], row['sha256']), dtype=np.uint8)
            pixels = pixels.reshape(height, width, 4)
            decode_fixture_depth(pixels, row['depthRange'])
            with Image.open(PUBLIC / atlas['pages'][sprite['page']]) as image:
                x, y = sprite['x'], sprite['y']
                alpha = np.asarray(image.getchannel('A').crop((x, y, x + width, y + height)))
            if not np.array_equal(pixels[:, :, 3] > 0, alpha > 0):
                raise ValueError(f'Published color and sampled depth differ in coverage for {name}')
            original = entries.get(name)
            if original:
                if (original['w'], original['h'], original['atlasIndex']) != (width, height, sprite_index):
                    raise ValueError(f'Existing outdoor depth registration changed for {name}')
                x, y = original['x'], original['y']
            else:
                x, y = append_x, append_y
                append_x += width
            if x + width > page['width'] or y + height > page['height']:
                raise ValueError('Outdoor depth page is full')
            plane[y:y+height, x:x+width] = pixels
            entries[name] = {**{key: value for key, value in row.items() if key not in ('path', 'sha256')},
                             'atlasIndex': sprite_index, 'sprite': sprite_index, 'pageIndex': 0, 'x': x, 'y': y}

    manifest['sprites'] = list(entries.values())
    manifest['encoding'] = 'rg-u16-unorm-x-minus-y-with-b-high-range'
    manifest['atlasSha256'] = digest(atlas_bytes)
    page_files = {atlas['pages'][atlas_rows[name][1]['page']] for name in entries}
    manifest['coverageSources'] = {f'web/public/{file}': digest((PUBLIC / file).read_bytes())
                                   for file in sorted(page_files)}
    payload = plane.tobytes()
    sha = digest(payload)
    page.update(sha256=sha, path=f'depth-{sha}.rgba')
    output.mkdir(parents=True, exist_ok=True)
    (output / page['path']).write_bytes(payload)
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'{len(entries)} registered outdoor depth rectangles, page {sha}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compact', type=Path, required=True)
    parser.add_argument('--wide', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    pack(args.compact, args.wide, args.output)
