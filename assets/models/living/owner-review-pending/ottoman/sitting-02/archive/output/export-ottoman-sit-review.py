"""Build an offline sprite candidate and inspectable full-clip review sheets."""
import hashlib
import json
import math
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT/'output/ottoman-sit-candidate-02'
RAW = BASE/'contributions'
DESTINATION = BASE/'offline-export'
sys.path.insert(0, str(ROOT/'assets/models/furniture'))
from export_contributions import compare_reconstruction, validate_ownership
from layer_partition import encode_contribution, reconstruct_layers

FACINGS = ('SE', 'NE', 'SW', 'NW')
VARIANTS = ('green', 'blue', 'red')
OWNERS = ('beauty', 'sim', 'furniture', 'lines')
SIZE = (192, 240)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2)+'\n')


def validate_rows(proof):
    expected = {(facing, frame, variant, owner) for facing in FACINGS
                for frame in range(4) for variant in VARIANTS for owner in OWNERS}
    expected.update((facing, 0, 'green', 'empty') for facing in FACINGS)
    if (proof.get('state') != 'complete' or proof.get('source_bytes_unchanged') is not True
            or not proof.get('blender_version') or not proof.get('blender_build_hash')):
        raise ValueError('Incomplete source generation')
    anchor = proof.get('anchor')
    if (not isinstance(anchor, list) or len(anchor) != 2
            or any(type(value) not in (int, float) or not math.isfinite(value)
                   or abs(value-want) > .002 for value, want in zip(anchor, (48, 116.00044)))):
        raise ValueError('Camera registration changed')
    contacts = proof.get('contact_samples', {})
    if (set(contacts) != set(VARIANTS) or any(len(rows) != 4 for rows in contacts.values())
            or contacts['green'] != contacts['blue'] or contacts['green'] != contacts['red']):
        raise ValueError('Palette contact samples are missing or different')
    keys, paths = set(), set()
    for row in proof['renders']:
        key = tuple(row[name] for name in ('facing', 'frame', 'variant', 'owner'))
        if key not in expected or key in keys:
            raise ValueError('Unexpected or duplicated render sample')
        filename = f'ottoman-sit-{key[2]}-{key[0]}-{key[1]}-{key[3]}.png'
        if row['path'] != filename or row['path'] in paths:
            raise ValueError('Ambiguous or escaped render path')
        keys.add(key)
        paths.add(row['path'])
    if keys != expected:
        raise ValueError('Missing render samples')


def read_original(path, padding=False):
    with Image.open(path) as image:
        if image.format != 'PNG' or image.mode != 'RGBA' or image.size != (768, 960):
            raise ValueError(f'Expected full RGBA original: {path.name}')
        image.load()
        if padding:
            bounds = image.getchannel('A').getbbox()
            if not bounds or min(bounds[:2]) < 8 or bounds[2] > 760 or bounds[3] > 952:
                raise ValueError(f'Empty or clipped source: {path.name}')
        return image.copy()


def load_records():
    proof = json.loads((RAW/'raw-proof.json').read_text())
    validate_rows(proof)
    for name, expected in proof['signature'].items():
        path = (ROOT/name).resolve()
        if not path.is_relative_to(ROOT.resolve()) or digest(path) != expected:
            raise ValueError(f'Source signature mismatch: {name}')
    accepted = json.loads((BASE/'strict-contact-proof-02.json').read_text())
    if (accepted.get('state') != 'complete' or accepted.get('accepted') is not True
            or proof['contact_samples']['green'] != accepted['samples']):
        raise ValueError('Render setup no longer matches physical acceptance')
    records = {}
    for row in proof['renders']:
        path = RAW/row['path']
        if path.resolve().parent != RAW.resolve() or digest(path) != row['sha256']:
            raise ValueError(f'Raw render hash mismatch: {row["path"]}')
        read_original(path, row['owner'] in ('beauty', 'empty'))
        records[tuple(row[name] for name in ('facing', 'frame', 'variant', 'owner'))] = path
    return proof, records


def main():
    proof, records = load_records()
    DESTINATION.mkdir(exist_ok=False)
    manifest = {'version': 1, 'scope': 'offline candidate, not installed',
                'pixel_density': 2, 'width': 96, 'height': 120, 'anchor': proof['anchor'],
                'empty': [], 'frames': [], 'raw_proof_sha256': digest(RAW/'raw-proof.json')}

    def save(image, prefix):
        path = DESTINATION/prefix/(hashlib.sha256(image.tobytes()).hexdigest()+'.png')
        path.parent.mkdir(exist_ok=True)
        image.save(path)
        return {'path': path.relative_to(DESTINATION).as_posix(), 'sha256': digest(path)}

    metrics, reconstructed = [], {}
    for facing in FACINGS:
        empty = read_original(records[facing, 0, 'green', 'empty'], True)
        manifest['empty'].append({'facing': facing,
                                 **save(empty.resize(SIZE, Image.Resampling.LANCZOS), 'empty')})
        for frame in range(4):
            palettes, coverage = {}, {}
            for variant in VARIANTS:
                images = {owner: read_original(records[facing, frame, variant, owner]) for owner in OWNERS}
                encoded = {owner: encode_contribution(images[owner], SIZE)
                           for owner in ('sim', 'furniture', 'lines')}
                palettes[variant] = encoded
                for owner, image in encoded.items():
                    alpha = image.getchannel('A').tobytes()
                    if owner in coverage and coverage[owner] != alpha:
                        raise ValueError(f'Palette changed geometry coverage: {facing}/{frame}/{owner}')
                    coverage[owner] = alpha
                comparison = compare_reconstruction(images['beauty'], encoded['sim'],
                                                    encoded['furniture'], encoded['lines'])
                metrics.append({'facing': facing, 'frame': frame, 'variant': variant, **comparison})
                reconstructed[facing, frame, variant] = reconstruct_layers(
                    encoded['sim'], encoded['furniture'], encoded['lines'])
                manifest['frames'].append({'facing': facing, 'frame': frame, 'variant': variant,
                                          'body': save(encoded['sim'], 'layers'),
                                          'furniture': save(encoded['furniture'], 'layers'),
                                          'outline': save(encoded['lines'], 'layers')})
            validate_ownership(palettes)
    write_json(DESTINATION/'manifest.json', manifest)
    review_files = []
    font = ImageFont.load_default(size=18)
    for variant in VARIANTS:
        # Each source sample is beside its separately encoded and recombined layers.
        board = Image.new('RGBA', (1920, 1456), (235, 230, 218, 255))
        draw = ImageDraw.Draw(board)
        draw.text((16, 12), f'{variant}: full source | sprite layers; four facings x four samples',
                  font=font, fill='#302d28')
        for column, facing in enumerate(FACINGS):
            for frame in range(4):
                x, y = column*480, 40+frame*354
                draw.text((x+8, y), f'{facing} sample {frame}', font=font, fill='#302d28')
                source = read_original(records[facing, frame, variant, 'beauty'])
                board.alpha_composite(source.resize((240, 300), Image.Resampling.LANCZOS), (x, y+26))
                board.alpha_composite(reconstructed[facing, frame, variant].resize(
                    (240, 300), Image.Resampling.NEAREST), (x+240, y+26))
        path = DESTINATION/f'full-clip-{variant}.png'
        board.convert('RGB').save(path)
        review_files.append({'path': path.name, 'sha256': digest(path)})
    # Lossless, independently composited full frames. Cycling does not move the camera.
    animation = []
    for frame in range(4):
        board = Image.new('RGBA', (960, 1056), (235, 230, 218, 255))
        draw = ImageDraw.Draw(board)
        for row, variant in enumerate(VARIANTS):
            for column, facing in enumerate(FACINGS):
                x, y = column*240, row*352
                draw.text((x+8, y+8), f'{variant} {facing}', font=font, fill='#302d28')
                board.alpha_composite(reconstructed[facing, frame, variant].resize(
                    (240, 300), Image.Resampling.NEAREST), (x, y+40))
        animation.append(board)
    animated = DESTINATION/'full-clip.webp'
    animation[0].save(animated, save_all=True, append_images=animation[1:],
                      duration=300, loop=0, lossless=True)
    review_files.append({'path': animated.name, 'sha256': digest(animated)})
    # Revalidate all sources after encoding and sheet generation.
    assert load_records()[0] == proof
    report = {'state': 'complete', 'scope': 'offline export, no runtime acceptance',
              'originals': len(records), 'checked_groups': len(metrics), 'comparisons': metrics,
              'encoder_sha256': digest(Path(__file__)),
              'partition_sha256': digest(ROOT/'assets/models/furniture/layer_partition.py'),
              'comparison_sha256': digest(ROOT/'assets/models/furniture/export_contributions.py'),
              'raw_proof_sha256': digest(RAW/'raw-proof.json'),
              'manifest_sha256': digest(DESTINATION/'manifest.json'), 'review_files': review_files,
              'sources_unchanged': True}
    write_json(DESTINATION/'export-proof.json', report)
    print(f'PASS: {len(records)} originals; {len(metrics)} occupied comparisons; palette coverage unchanged.')


if __name__ == '__main__':
    main()
