"""Export independently checked additive bathing layers after the source writer exits."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

from bath_export_contract import (BASE, MODELS, FACINGS, OWNERS, BATHE_ACTION, TUB_SOURCE, LOGICAL_CANVAS,
                                  ORIGINAL_DIMENSIONS, read_loop, read_ink, validate_render_rows)
from bathroom_export_contract import encode_raw_scene
from export_toilet_loop import ENCODING, scene_anchor
from seat_export_contract import read_png, digest

EXPORT_SIZE = (320, 352)


def export(source_path, ink_path, output, *, process_exited):
    if process_exited is not True:
        raise ValueError('Wait for the source writer to exit before exporting')
    source_path, ink_path, output = [Path(p).resolve() for p in (source_path, ink_path, output)]
    source = read_loop(source_path, process_exited=True)
    ink, ink_rows = read_ink(ink_path, source_path, source)
    if not output.is_relative_to((BASE/'export').resolve()) or output == (BASE/'export').resolve():
        raise ValueError('Choose a new owned bathroom export child directory')
    output.mkdir(parents=True, exist_ok=False)
    for path, name in ((source_path, 'source-proof.json'), (ink_path, 'ink-proof.json')):
        shutil.copy2(path, output/name)
    dependencies = [BASE/'bath_export_contract.py', Path(__file__).resolve(), BASE/'bathroom_export_contract.py',
                    BASE/'export_toilet_loop.py', BASE/'contact_surface.py', MODELS/'seating/seat_export_contract.py',
                    MODELS/'bedroom/double_bed_linear.py', MODELS/'bedroom/double_bed_layers.py',
                    MODELS/'sims/sim-01/shirt-source-materials.json']
    manifest = dict(version=1, encoding=ENCODING, pixel_density=2, action=BATHE_ACTION, halfCycleTicks=8,
                    palette_independent=True,
                    comparison_reference='independent-beauty-float-linear-box-display-once',
                    source_batch=source_path.relative_to(MODELS).as_posix(), ink_batch=ink_path.relative_to(MODELS).as_posix(),
                    source_receipt=dict(path='source-proof.json', sha256=digest(source_path)),
                    ink_receipt=dict(path='ink-proof.json', sha256=digest(ink_path)),
                    dependencies={p.relative_to(MODELS).as_posix():digest(p) for p in dependencies}, objects=[])
    accepted = json.loads((MODELS/source['accepted_source']['proof_path']).read_text())
    obj = dict(kind='bathtub', content='bathtub', source_sha256=accepted['inputs'][TUB_SOURCE],
               model_sha256=source['editable_model']['sha256'], canvas=list(LOGICAL_CANVAS),
               anchor=scene_anchor(source['origin_pixels']), camera_matrix=source['camera_matrix'],
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
    rows = {(facing, frame, owner):row for (facing, _, frame, owner), row in validate_render_rows(source['renders']).items()}
    for facing in FACINGS:
        for frame in range(4):
            raw = {owner:read_png(source_path.parent, rows[facing, frame, owner], tuple(ORIGINAL_DIMENSIONS)) for owner in OWNERS}
            body_ink = read_png(ink_path.parent, ink_rows[facing, 'green', frame, 'body_ink'], tuple(ORIGINAL_DIMENSIONS))
            try:
                layers, coverage, comparison, reconstruction = encode_raw_scene(raw, body_ink, EXPORT_SIZE)
            except ValueError as failure:
                raise ValueError(f'Bath {facing}/{frame}: {failure}') from failure
            obj['scenes'].append(dict(facing=facing, variant='green', frame=frame, comparison=comparison,
                                      layers={role:write_image(image, 'layers') for role, image in layers.items()},
                                      coverage={role:write_image(image, 'coverage') for role, image in coverage.items()},
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
