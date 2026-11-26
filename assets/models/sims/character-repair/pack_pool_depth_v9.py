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
CATALOGS = ('static-props-07.json', 'static-props-08.json', 'static-props-09.json', 'static-props-10.json')
FACINGS = ('SE', 'NW', 'SW', 'NE')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def check_bytes(path, sha):
    data = path.read_bytes()
    if digest(data) != sha:
        raise ValueError(f'Changed pool depth input: {path}')
    return data


def pack(families, output):
    atlas_bytes = ATLAS_PATH.read_bytes()
    atlas = tomllib.loads(atlas_bytes.decode())
    atlas_rows = {row['name']: (index, row) for index, row in enumerate(atlas['sprite'])}
    outdoor = BASE / 'outdoor-depth'
    manifest = json.loads((outdoor / 'manifest.json').read_bytes())
    planes = []
    for page in manifest['pages']:
        data = check_bytes(outdoor / page['path'], page['sha256'])
        planes.append(np.frombuffer(data, dtype=np.uint8).reshape(page['height'],page['width'],4).copy())
    entries = {row['name']: row for row in manifest['sprites']}
    append_page = len(planes) - 1
    append_y = max((row['y'] + row['h'] for row in entries.values() if row['pageIndex'] == append_page), default=0)
    append_x = 0
    row_height = 0

    models = ROOT / 'assets/models'
    catalog = {row['name']: models / row['directory'] for name in CATALOGS
               for row in json.loads((models / name).read_bytes())['objects']}
    for prefix, samples in families:
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
                page_index, x, y = original['pageIndex'], original['x'], original['y']
            else:
                if width > atlas['width'] or height > atlas['height']:
                    raise ValueError(f'Depth rectangle exceeds a graphics page: {name}')
                if append_x + width > atlas['width']:
                    append_x, append_y, row_height = 0, append_y + row_height, 0
                if append_y + height > atlas['height']:
                    append_page += 1
                    append_x, append_y, row_height = 0, 0, 0
                    planes.append(np.zeros((atlas['height'],atlas['width'],4),dtype=np.uint8))
                page_index, x, y = append_page, append_x, append_y
                append_x += width
                row_height = max(row_height,height)
            planes[page_index][y:y+height, x:x+width] = pixels
            entries[name] = {**{key: value for key, value in row.items() if key not in ('path', 'sha256')},
                             'atlasIndex': sprite_index, 'sprite': sprite_index, 'pageIndex': page_index, 'x': x, 'y': y}

    manifest['sprites'] = list(entries.values())
    manifest['encoding'] = 'rg-u16-unorm-x-minus-y-with-b-high-range'
    manifest['atlasSha256'] = digest(atlas_bytes)
    page_files = {atlas['pages'][atlas_rows[name][1]['page']] for name in entries}
    manifest['coverageSources'] = {f'web/public/{file}': digest((PUBLIC / file).read_bytes())
                                   for file in sorted(page_files)}
    output.mkdir(parents=True, exist_ok=True)
    manifest['pages'] = []
    for page_index, plane in enumerate(planes):
        payload = plane.tobytes()
        sha = digest(payload)
        path = f'depth-{sha}.rgba'
        (output / path).write_bytes(payload)
        height, width = plane.shape[:2]
        manifest['pages'].append(dict(pageIndex=page_index, path=path, sha256=sha, width=width, height=height))
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'{len(entries)} registered outdoor depth rectangles on {len(planes)} pages')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compact', type=Path)
    parser.add_argument('--wide', type=Path)
    parser.add_argument('--lodge', type=Path)
    parser.add_argument('--in-ground', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    families = [(name, directory) for name, directory in (
        ('offlinePool', args.compact), ('offlinePoolRectangular', args.wide), ('offlinePoolLodge', args.lodge),
        ('offlinePoolInGround', args.in_ground))
                if directory is not None]
    if not families:
        parser.error('Specify at least one pool export')
    pack(families, args.output)
