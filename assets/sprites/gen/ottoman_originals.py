"""Verify all original renders against the archived ottoman sprite exports."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import sys

from PIL import Image
from offline_ottoman import load_reviewed_ottoman
from offline_props import inside
from ottoman_receipt import receipt_session

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'models/furniture'))
from export_contributions import compare_reconstruction
from layer_partition import encode_contribution

EMPTY = ('offlineOttoman', 'offlineOttomanNW', 'offlineOttomanSW', 'offlineOttomanNE')


def verify_originals(catalog_path, raw_directory):
    """Read local originals explicitly; never use them as a clean-build fallback."""
    with receipt_session(catalog_path) as (paths, bindings):
        return {**verify_pixels(paths, catalog_path, raw_directory), **bindings}


def verify_pixels(paths, catalog_path, raw_directory):
    load_reviewed_ottoman(catalog_path, existing_names=EMPTY)
    manifest = json.loads(paths['manifest'].read_text())
    raw = json.loads(paths['raw_proof'].read_text())
    expected = json.loads(paths['comparison'].read_text())
    rows = {tuple(row[key] for key in ('facing', 'frame', 'variant', 'owner')): row for row in raw['renders']}
    root = Path(raw_directory).resolve()

    def read(key):
        row = rows[key]
        path = inside(root, row['path'])
        payload = path.read_bytes()
        if hashlib.sha256(payload).hexdigest() != row['sha256']:
            raise ValueError(f'Ottoman original image changed: {path.name}')
        with Image.open(io.BytesIO(payload)) as image:
            if image.format != 'PNG' or image.mode != 'RGBA' or image.size != (768, 960):
                raise ValueError(f'Expected ottoman original RGBA PNG at 768x960: {path.name}')
            image.load()
            if key[3] in ('beauty', 'empty'):
                bounds = image.getchannel('A').getbbox()
                if not bounds or min(bounds[:2]) < 8 or bounds[2] > 760 or bounds[3] > 952:
                    raise ValueError(f'Empty or clipped ottoman original: {path.name}')
            return image.copy()

    def compare_pixels(image, ref):
        with Image.open(inside(paths['manifest'].parent, ref['path'])) as saved:
            if saved.mode != image.mode or saved.size != image.size or saved.tobytes() != image.tobytes():
                raise ValueError('Ottoman re-encoded pixels differ from the reviewed export')

    checked = set()
    for row in manifest['empty']:
        key = row['facing'], 0, 'green', 'empty'
        compare_pixels(read(key).resize((192, 240), Image.Resampling.LANCZOS), row)
        checked.add(key)
    metrics = {(r['facing'], r['frame'], r['variant']): r for r in expected['comparisons']}
    for row in manifest['frames']:
        key = row['facing'], row['frame'], row['variant']
        originals = {role: read((*key, role)) for role in ('beauty', 'sim', 'furniture', 'lines')}
        layers = {role: encode_contribution(originals[owner], (192, 240))
                  for role, owner in (('body', 'sim'), ('furniture', 'furniture'), ('outline', 'lines'))}
        for role, image in layers.items():
            compare_pixels(image, row[role])
        measured = compare_reconstruction(originals['beauty'], layers['body'], layers['furniture'], layers['outline'])
        if any(measured[field] != metrics[key][field] for field in measured):
            raise ValueError('Ottoman reconstruction measurements changed')
        checked.update((*key, role) for role in originals)
    if checked != set(rows) or len(checked) != 196:
        raise ValueError('Ottoman original verification skipped samples')
    return {'state': 'complete', 'originals': len(checked), 'occupied_comparisons': len(metrics),
            'encoded_pixels_unchanged': True, 'scope': 'Original-to-export verification; not gameplay acceptance'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', required=True, type=Path)
    parser.add_argument('--originals', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.output and args.output.exists():
        raise FileExistsError(args.output)
    report = json.dumps(verify_originals(args.catalog, args.originals), indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x', encoding='utf-8') as stream:
            stream.write(report + '\n')
    print(report)
