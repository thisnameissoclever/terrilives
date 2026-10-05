"""Export complete neutral scenes without modifying historical source or sprites."""
import argparse
import hashlib
import itertools
import json
from pathlib import Path
import shutil

from PIL import Image

from seat_export_contract import (BASE, MODELS, FACINGS, PALETTES, OWNERS, ENCODING, IDENTITY,
    checked_file, check_body_ink, check_identity, check_palettes, compare_scene, digest,
    encode_scene, index_rows, read_batch, read_png)


def check_ink(source_path, proof, ink_path):
    ink = json.loads(ink_path.read_text())
    if ink.get('state') != 'complete' or ink.get('source_proof_sha256') != digest(source_path):
        raise ValueError('Missing complete body-owned ink receipt for this source')
    if ink.get('producer_sha256') != digest(BASE / 'render_neutral_ink.py') or ink.get('inputs') != proof['inputs']:
        raise ValueError('Ink producer or source dependencies changed')
    if len(ink['objects']) != len(proof['objects']):
        raise ValueError('Incomplete ink objects')
    indexed = {obj['kind']: obj for obj in ink['objects']}
    if set(indexed) != {obj['kind'] for obj in proof['objects']}:
        raise ValueError('Duplicate or missing ink objects')
    for source in proof['objects']:
        obj = indexed[source['kind']]
        check_identity(source, obj)
        contact = source['contacts'][0]
        if obj['body_parts'] != contact['body_parts'] or obj['furniture_solids'] != contact['furniture_solids']:
            raise ValueError('Ink named owner inventory differs from physical contact receipt')
        expected = set(itertools.product(FACINGS, range(4)))
        index_rows(obj['renders'], expected, ('facing', 'frame'))
        geometry = obj['geometry']
        if (len(geometry) != 16 or {(row['facing'], row['frame']) for row in geometry} != expected
                or any(row['variants'] != list(PALETTES) or not set(contact['body_parts']).issubset(row['body'])
                       for row in geometry)):
            raise ValueError('Missing complete palette geometry evidence')
        if source['kind'] == 'ottoman':
            symmetry = obj.get('quarter_turn_symmetry', {})
            if not 0 <= symmetry.get('max_vertex_distance', float('inf')) <= .00001:
                raise ValueError('Missing quarter-turn ottoman symmetry proof')
    return ink, indexed


def export(source_path, ink_path, output, *, process_exited):
    source_path, ink_path, output = (Path(path).resolve() for path in (source_path, ink_path, output))
    proof = read_batch(source_path, process_exited=process_exited)
    ink, inks = check_ink(source_path, proof, ink_path)
    if not output.is_relative_to((BASE / 'export').resolve()) or output == (BASE / 'export').resolve():
        raise ValueError('Choose a new child of the seating export directory')
    output.mkdir(parents=True, exist_ok=False)
    for path, name in ((source_path, 'source-proof.json'), (ink_path, 'ink-proof.json')):
        shutil.copyfile(path, output / name)
    dependencies = [BASE / name for name in ('seat_export_contract.py', 'export_neutral_seats.py', 'render_neutral_ink.py')]
    dependencies += [MODELS / 'bedroom' / name for name in ('double_bed_linear.py', 'double_bed_layers.py')]
    manifest = dict(version=1, encoding=ENCODING, pixel_density=2, action=8, halfCycleTicks=16,
                    comparison_reference='independent-beauty-float-linear-box-display-once',
                    source_batch=source_path.relative_to(MODELS).as_posix(),
                    ink_batch=ink_path.relative_to(MODELS).as_posix(),
                    source_receipt=dict(path='source-proof.json', sha256=digest(source_path)),
                    ink_receipt=dict(path='ink-proof.json', sha256=digest(ink_path)),
                    dependencies={path.relative_to(MODELS).as_posix(): digest(path) for path in dependencies}, objects=[])
    saved = {}
    def write_image(image, role):
        pixels = hashlib.sha256(image.tobytes()).hexdigest()
        key = (image.mode, image.size, pixels)
        if key not in saved:
            name = f'{role}/{image.width}x{image.height}-{pixels}.png'
            target = output / name
            target.parent.mkdir(exist_ok=True)
            image.save(target)
            saved[key] = dict(path=name, sha256=digest(target), pixels_sha256=pixels)
        return saved[key]
    for obj in proof['objects']:
        item = {field: obj[field] for field in (*IDENTITY, 'kind', 'content')}
        item['scenes'] = []
        if obj['kind'] == 'ottoman':
            item['quarter_turn_symmetry'] = inks[obj['kind']]['quarter_turn_symmetry']
        manifest['objects'].append(item)
        rows = index_rows(obj['renders'], set(itertools.product(FACINGS, PALETTES, range(4), OWNERS)))
        ink_rows = index_rows(inks[obj['kind']]['renders'], set(itertools.product(FACINGS, range(4))), ('facing', 'frame'))
        raw_size = tuple(v * 8 for v in obj['canvas'])
        size = tuple(v * 2 for v in obj['canvas'])
        for facing, frame in itertools.product(FACINGS, range(4)):
            images = [{owner: read_png(source_path.parent, rows[facing, palette, frame, owner], raw_size)
                       for owner in OWNERS} for palette in PALETTES]
            check_palettes(images)
            body_ink = read_png(ink_path.parent, ink_rows[facing, frame], raw_size)
            check_body_ink(images[0]['lines'], body_ink)
            for palette, image in zip(PALETTES, images):
                encoded = encode_scene(image, size)
                try:
                    metrics, result = compare_scene(encoded, image['beauty'])
                except ValueError as error:
                    raise ValueError(f'{obj["kind"]}/{facing}/{palette}/{frame}: {error}') from error
                scene = dict(facing=facing, variant=palette, frame=frame,
                             path=f'{obj["kind"]}-{facing}-{palette}-{frame}', comparison=metrics)
                scene['layers'] = {role: write_image(encoded[owner], 'layers') for role, owner in
                                   (('body', 'sim'), ('furniture', 'furniture'), ('ink', 'lines'))}
                masks = {role: image[owner].getchannel('A').resize(size, Image.Resampling.BOX) for role, owner in
                         (('body', 'sim'), ('furniture', 'furniture'), ('ink', 'lines'))}
                masks['bodyInk'] = body_ink.getchannel('A').resize(size, Image.Resampling.BOX)
                scene['coverage'] = {role: write_image(mask, 'coverage') for role, mask in masks.items()}
                scene['reconstruction'] = write_image(result, 'reconstruction')
                item['scenes'].append(scene)
        print(obj['kind'] + ': 48 complete scenes', flush=True)
    # A manifest is the commit marker. Failed exports retain diagnostics but cannot import.
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / 'comparison.json').write_text(json.dumps({obj['kind']: [row['comparison'] for row in obj['scenes']]
                                                       for obj in manifest['objects']}, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('ink', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--writer-exited', action='store_true')
    args = parser.parse_args()
    export(args.source, args.ink, args.output, process_exited=args.writer_exited)
