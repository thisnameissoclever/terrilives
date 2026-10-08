"""Export independently checked additive fridge reach layers after the source writer exits.

Usage: python export_fridge_reach.py SOURCE_PROOF INK_PROOF OUTPUT --writer-exited
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
import fridge_reach_geometry as geo
from fridge_export_contract import (MODELS, FACINGS, PALETTES, OWNERS, FETCH_ACTION, SOURCE, canvas, export_size,
                                    read_batch, read_ink, render_rows, reference_rows, case_preservation,
                                    validate_depths)
import numpy as np
from PIL import Image
from bathroom_export_contract import encode_raw_scene
from export_toilet_loop import ENCODING, TILE_DROP
from seat_export_contract import read_png, digest, check_palettes

# The static refrigerator draws its 96 by 120 canvas with this anchor; the
# padded scene must land the fixture on exactly the same screen point.
EMPTY_ANCHOR = [48.0000114440918, 116.0004369020462]


def scene_anchor(origin_pixels):
    """Logical anchor of the padded scene canvas: the projected origin plus the tile drop."""
    x, y = origin_pixels
    return [x/8, y/8+TILE_DROP]


def registered_anchor():
    """The empty fixture's anchor moved by the canvas padding."""
    return [EMPTY_ANCHOR[0]+geo.PADDING[0], EMPTY_ANCHOR[1]+geo.PADDING[1]]


def scene_depth(data, raw):
    """The scene's depth sprite: the producer's per-pixel depth, with every pixel the
    furniture layer owns reading no farther than the fixture's anchor.

    The producer clamps fixture surfaces where its centre ray hits the fixture.
    A silhouette pixel the export filter gives to the furniture can still have
    its centre ray pass the edge onto the body behind; it takes the same clamp,
    so the fixture is never drawn farther than the empty fridge draws it."""
    size = export_size()
    body = np.asarray(raw['sim'].getchannel('A').resize(size, Image.Resampling.BOX), dtype=np.int64)
    furniture = np.asarray(raw['furniture'].getchannel('A').resize(size, Image.Resampling.BOX), dtype=np.int64)
    pixels = np.round(data*255).astype(np.int64)
    encoded = pixels[:, :, 0]*256+pixels[:, :, 1]
    anchor = round(2/4*65535)
    owned = (furniture > body) & (pixels[:, :, 3] > 0) & (encoded < anchor)
    pixels[owned, 0], pixels[owned, 1] = anchor//256, anchor % 256
    return Image.fromarray(pixels.astype(np.uint8), 'RGBA')


def export(source_path, ink_path, output, *, process_exited):
    if process_exited is not True:
        raise ValueError('Wait for the source writer to exit before exporting')
    source_path, ink_path, output = [Path(p).resolve() for p in (source_path, ink_path, output)]
    source = read_batch(source_path, process_exited=True)
    ink, ink_rows = read_ink(ink_path, source_path, source)
    if not output.is_relative_to((BASE/'export').resolve()) or output == (BASE/'export').resolve():
        raise ValueError('Choose a new owned kitchen export child directory')
    # The projected origin agrees with the padded empty anchor to within the
    # camera's single-precision rounding; the scene records the exact padded
    # anchor so the fixture lands on the empty fridge's screen point.
    if any(abs(a-b) > 1e-4 for a, b in zip(scene_anchor(source['origin_pixels']), registered_anchor())):
        raise ValueError('Fridge scene anchor does not register on the empty fixture')
    anchor = registered_anchor()
    output.mkdir(parents=True, exist_ok=False)
    for path, name in ((source_path, 'source-proof.json'), (ink_path, 'ink-proof.json')):
        shutil.copy2(path, output/name)
    dependencies = [BASE/'fridge_export_contract.py', Path(__file__).resolve(), BASE/'fridge_reach_geometry.py',
                    MODELS/'bathroom/actions/bathroom_export_contract.py', MODELS/'bathroom/actions/export_toilet_loop.py',
                    MODELS/'bathroom/actions/contact_surface.py', MODELS/'seating/seat_export_contract.py',
                    MODELS/'bedroom/double_bed_linear.py', MODELS/'bedroom/double_bed_layers.py',
                    MODELS/'sims/sim-01/shirt-source-materials.json']
    manifest = dict(version=1, encoding=ENCODING, pixel_density=2, action=FETCH_ACTION, samples=geo.SAMPLES,
                    playback='progress', padding=list(geo.PADDING),
                    comparison_reference='independent-beauty-float-linear-box-display-once',
                    source_batch=source_path.relative_to(MODELS).as_posix(), ink_batch=ink_path.relative_to(MODELS).as_posix(),
                    source_receipt=dict(path='source-proof.json', sha256=digest(source_path)),
                    ink_receipt=dict(path='ink-proof.json', sha256=digest(ink_path)),
                    dependencies={p.relative_to(MODELS).as_posix(): digest(p) for p in dependencies}, objects=[],
                    case_preservation=[])
    obj = dict(kind='fridge', content='fridge', source_sha256=source['inputs'][SOURCE],
               canvas=[v//8 for v in canvas()], anchor=anchor, camera_matrix=source['camera_matrix'],
               ortho_scale=source['ortho_scale'], scenes=[])
    manifest['objects'].append(obj)
    saved = {}

    def write_image(image, role):
        pixel_hash = hashlib.sha256(image.tobytes()).hexdigest()
        key = (image.mode, image.size, pixel_hash)
        if key not in saved:
            name = f'{role}/{image.width}x{image.height}-{pixel_hash}.png'
            path = output/name
            path.parent.mkdir(parents=True, exist_ok=True)
            image.save(path)
            saved[key] = dict(path=name, sha256=digest(path), pixels_sha256=pixel_hash)
        return saved[key]

    rows = render_rows(source)
    references = reference_rows(source)
    depths = validate_depths(source['depths'], source_path)
    size = tuple(canvas())
    for facing in FACINGS:
        empty = read_png(source_path.parent, references[facing, None, 'empty'], size)
        closed = read_png(source_path.parent, references[facing, 0, 'door'], size)
        for frame in range(geo.SAMPLES):
            raw_palettes = [{owner: read_png(source_path.parent, rows[facing, variant, frame, owner], size)
                             for owner in OWNERS} for variant in PALETTES]
            check_palettes(raw_palettes)
            door = read_png(source_path.parent, references[facing, frame, 'door'], size)
            kept = case_preservation(raw_palettes[0]['furniture'], raw_palettes[0]['sim'], empty, door, closed)
            if kept['max_alpha_difference'] > 2 or kept['compared_pixels'] <= 0:
                raise ValueError(f'Fridge {facing}/{frame}: the case changed outside the door and body: {kept}')
            manifest['case_preservation'].append(dict(facing=facing, frame=frame, **kept))
            body_ink = read_png(ink_path.parent, ink_rows[facing, 'green', frame, 'body_ink'], size)
            depth = scene_depth(depths[facing, frame], raw_palettes[0])
            for variant, raw in zip(PALETTES, raw_palettes):
                try:
                    layers, coverage, comparison, reconstruction = encode_raw_scene(raw, body_ink, export_size())
                except ValueError as failure:
                    raise ValueError(f'Fridge {facing}/{variant}/{frame}: {failure}') from failure
                obj['scenes'].append(dict(facing=facing, variant=variant, frame=frame, comparison=comparison,
                                          depth=write_image(depth, 'depth'),
                                          layers={r: write_image(i, 'layers') for r, i in layers.items()},
                                          coverage={r: write_image(i, 'coverage') for r, i in coverage.items()},
                                          reconstruction=write_image(reconstruction, 'reconstruction')))
    (output/'comparison.json').write_text(json.dumps([row['comparison'] for row in obj['scenes']], indent=2)+'\n')
    # The manifest is written last; incomplete output cannot enter the atlas.
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2, allow_nan=False)+'\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('ink', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--writer-exited', action='store_true')
    args = parser.parse_args()
    export(args.source, args.ink, args.output, process_exited=args.writer_exited)
