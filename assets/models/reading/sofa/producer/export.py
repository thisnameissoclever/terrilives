"""Export hash-bound additive multi-owner sofa scenes after completed writers."""
import hashlib
import itertools
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
ROOT = next(path for path in Path(__file__).resolve().parents if (path / 'assets/models/sims/sim-01').is_dir())
sys.path[:0] = [str(ROOT / 'assets/models/seating'), str(ROOT / 'assets/models/bedroom'),
               str(ROOT / 'assets/sprites/gen')]
from seat_export_contract import reference_beauty, premultiplied_display
from double_bed_linear import encode, reconstruct
from double_bed_layers import comparison
from reading_joint_alpha import joint_alpha


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(source, output):
    if output.exists():
        raise ValueError('Preserve prior sofa export')
    exporter_paths = [Path(__file__).resolve(), ROOT / 'assets/models/seating/seat_export_contract.py',
                      ROOT / 'assets/models/bedroom/double_bed_linear.py', ROOT / 'assets/models/bedroom/double_bed_layers.py',
                      ROOT / 'assets/sprites/gen/reading_joint_alpha.py']
    exporter_inputs = {str(path): digest(path) for path in exporter_paths}
    jobs = []
    for path in sorted(source.glob('*/raw/proof.json')):
        proof = json.loads(path.read_text())
        process = json.loads((path.parent.parent / 'render-process-exit.json').read_text(encoding='utf-8-sig'))
        if (proof['state'] != 'complete' or process['exit_code'] != 0 or not process['actual_handle_retained']
                or not process['inputs_unchanged'] or process['stop_reason'] is not None):
            raise ValueError('Sofa writer did not finish with retained provenance')
        if any(digest(name) != sha for name, sha in proof['inputs'].items()):
            raise ValueError('Sofa frozen source changed')
        jobs.append((path, proof))
    if not jobs:
        raise ValueError('No completed sofa source jobs')
    output.mkdir(); textures = output / 'textures'; textures.mkdir()
    proofs = [dict(path=str(path), sha256=digest(path), sceneKey=proof['sceneKey'], facing=proof['facing'])
              for path, proof in jobs]
    physical = output / 'physical-proof.json'
    physical.write_text(json.dumps(dict(state='rendered_actual_source_poses', sourceProofs=proofs,
        scope='Actual retained reader pose and existing neutral sofa sitting; no new pose fitting',
        phaseAliases=[0, 0, 0, 0]), indent=2) + '\n')
    complete = {(proof['sceneKey'], proof['facing']) for path, proof in jobs} == set(itertools.product(range(27), ('SE', 'NW', 'SW', 'NE')))
    manifest = dict(version=2, state='complete' if complete else 'completed_pilot', importable=complete,
        content='long_sofa', stage='seatedRead', encoding='scene-linear-premultiplied-visible-additive', pixelDensity=2,
        stableSeatIds=['seat_1', 'seat_2', 'seat_3'], layerOrder=['furniture', 'body0', 'body1', 'body2', 'sharedInk'],
        sofaAnchor=jobs[0][1]['anchor'], canvasPadding=[0, 0, 0, 0],
        phases=dict(count=4, cycleTicks=16, phaseTicks=[0, 4, 8, 12], sourceAliases=[0, 0, 0, 0], reducedMotionFrame=0),
        physicalReceipt=dict(path=physical.name, sha256=digest(physical)), records=[], comparisons=[],
        exporterInputs=exporter_inputs,
        scope='All occupancy states use actual static poses; four phase aliases disclose the static animation')
    saved = {}; joint_records = []; source_references = []
    def put(image):
        box = image.getchannel('A').getbbox()
        crop = (max(0, box[0] - 1), max(0, box[1] - 1), min(image.width, box[2] + 1), min(image.height, box[3] + 1)) if box else (0, 0, 1, 1)
        cropped = image.crop(crop) if box else Image.new('RGBA', (1, 1))
        key = cropped.size, hashlib.sha256(cropped.tobytes()).hexdigest(), crop
        if key not in saved:
            target = textures / (f'{cropped.width}x{cropped.height}-{crop[0]}-{crop[1]}-' + key[1] + '.png')
            cropped.save(target)
            saved[key] = dict(path=target.relative_to(output).as_posix(), sha256=digest(target), pixelsSha256=key[1],
                              width=cropped.width, height=cropped.height)
        return dict(**saved[key], trim=[crop[0] / 2, crop[1] / 2, cropped.width / 2, cropped.height / 2], rawCrop=list(crop))
    for path, proof in jobs:
        raw = path.parent; rows = {(row['palette'], row['owner']): row for row in proof['renders']}
        occupied = [place for place, action in enumerate(proof['actions']) if action]
        def read(palette, owner):
            row = rows[palette, owner]; file = raw / row['path']
            if digest(file) != row['sha256']:
                raise ValueError('Sofa raw render changed')
            with Image.open(file) as image:
                if image.mode != 'RGBA' or image.size != tuple(value * 8 for value in proof['canvas']):
                    raise ValueError('Sofa raw registration differs')
                return image.copy()
        size = tuple(value * 2 for value in proof['canvas'])
        blank = Image.new('RGBA', size); blank_ref = put(blank)
        ink = read('green', 'sharedInk'); furniture = read('green', 'furniture')
        fixed = encode(furniture, size, ink); lines = encode(ink, size)
        body_inks = {place: read('green', 'bodyInk' + str(place)) for place in occupied}
        if any(ImageChops.subtract(body.getchannel('A'), ink.getchannel('A')).getbbox()
               for body in body_inks.values()):
            raise ValueError('Sofa body-owned ink exceeds shared scene ink')
        bodies = {}; baseline = {}
        for palette in ('green', 'blue', 'red'):
            for place in occupied:
                image = read(palette, 'body' + str(place))
                alpha = image.getchannel('A').tobytes()
                if place in baseline and baseline[place] != alpha:
                    raise ValueError('Sofa palette changes occupied visible geometry')
                baseline[place] = alpha; bodies[place, palette] = encode(image, size, ink)
            beauty = read(palette, 'beauty')
            edges = beauty.getchannel('A')
            width, height = beauty.size
            if any(edges.crop(box).getbbox() for box in ((0, 0, width, 1), (0, height - 1, width, height),
                                                        (0, 0, 1, height), (width - 1, 0, width, height))):
                raise ValueError('Sofa canonical canvas clips visible geometry')
            actual = reconstruct([fixed] + [bodies[place, palette] for place in occupied] + [lines])
            metrics = comparison(premultiplied_display(reference_beauty(beauty, size)), premultiplied_display(actual),
                                 [fixed] + [bodies[place, palette] for place in occupied])
            if metrics['scene']['max_error'] > 6 or metrics['scene']['p95_error'] > 2:
                raise ValueError('Sofa layer reconstruction exceeds six/two: ' + str(metrics['scene']))
            beauty_copy = output / f'beauty-{proof["sceneKey"]:02d}-{proof["facing"]}-{palette}.png'
            beauty_copy.write_bytes((raw / rows[palette, 'beauty']['path']).read_bytes())
            beauty_ref = dict(path=beauty_copy.name, sha256=digest(beauty_copy),
                pixelsSha256=hashlib.sha256(beauty.tobytes()).hexdigest(), width=beauty.width, height=beauty.height)
            uniform_layers = [put(fixed)] + [put(bodies[place, palette]) if place in occupied else blank_ref
                                            for place in range(3)] + [put(lines)]
            witness = dict(sceneKey=proof['sceneKey'], facing=proof['facing'], sourceFrame=proof['sceneKey'] * 4,
                palette=palette, kind='actualUniform', sourceBeauty=beauty_ref, sourceDensity=proof['source_density'],
                canvas=proof['canvas'], anchor=proof['anchor'], layers=uniform_layers)
            manifest['comparisons'].append(dict(**witness, **metrics))
            source_references.append(witness)
        # Preserve one actual geometry alpha for all declared static phase aliases.
        beauty_copy = output / f'beauty-{proof["sceneKey"]:02d}-{proof["facing"]}-green.png'
        joint_records.append(dict(facing=proof['facing'], sourceFrame=proof['sceneKey'] * 4,
            source=dict(path=beauty_copy.name, sha256=digest(beauty_copy)),
            coverage=joint_alpha(beauty_copy, size, digest(beauty_copy))))
        owners = [None] * 3
        full = fixed.getchannel('A')
        for place in occupied:
            body = bodies[place, 'green']
            full = ImageChops.add(full, body.getchannel('A'))
            alpha = ImageChops.add(body.getchannel('A'), body_inks[place].getchannel('A').resize(size, Image.Resampling.BOX))
            mask = Image.merge('RGBA', (Image.new('L', size), Image.new('L', size), Image.new('L', size), alpha))
            owners[place] = dict(stableSeatId='seat_' + str(place + 1), coverage=put(mask), marker=proof['markers'][place])
        full = ImageChops.add(full, lines.getchannel('A'))
        alpha_ref = put(Image.merge('RGBA', (Image.new('L', size), Image.new('L', size), Image.new('L', size), full)))
        for witness in manifest['comparisons'][-3:] + source_references[-3:]:
            witness['owners'] = owners
        for palette_indices in itertools.product(*(range(3) if action else (0,) for action in proof['actions'])):
            layers = [put(fixed)] + [put(bodies[place, ('green', 'blue', 'red')[palette_indices[place]]])
                                    if place in occupied else blank_ref for place in range(3)] + [put(lines)]
            for frame in range(4):
                manifest['records'].append(dict(facing=proof['facing'], sceneKey=proof['sceneKey'], actions=proof['actions'],
                    frame=frame, sourceScene=proof['sceneKey'], sourceFrame=proof['sceneKey'] * 4,
                    paletteIndices=list(palette_indices), layers=layers, owners=owners, alphaCoverage=alpha_ref,
                    canvas=proof['canvas'], anchor=proof['anchor'],
                    composition='actualUniform' if len({palette_indices[place] for place in occupied}) <= 1 else 'derivedIndependentPalette',
                    ownerSources=[dict(facing=proof['facing'], sourceFrame=proof['sceneKey'] * 4,
                        palette=('green', 'blue', 'red')[palette_indices[place]], place=place) if place in occupied else None
                        for place in range(3)]))
    if any(digest(path) != sha for path, sha in exporter_inputs.items()):
        raise ValueError('Sofa exporter code changed during source validation')
    manifest_path = output / 'manifest.json'; manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    (output / 'joint-alpha.json').write_text(json.dumps(dict(manifestSHA256=digest(manifest_path), records=joint_records)) + '\n')
    (output / 'source-reference-index.json').write_text(json.dumps(dict(manifestSHA256=digest(manifest_path),
        records=source_references), indent=2) + '\n')
    (output / 'export-process-exit.json').write_text(json.dumps(dict(exit_code=0, manifest=dict(sha256=digest(manifest_path)))) + '\n')
    print(json.dumps(dict(output=str(output), sourceJobs=len(jobs), complete=complete, records=len(manifest['records']),
                         maxError=max(row['scene']['max_error'] for row in manifest['comparisons']))))


if __name__ == '__main__':
    run(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
