"""Validate and encode the complete offline interaction batch for the atlas."""
import hashlib
import json
from pathlib import Path

from PIL import Image

from layer_partition import encode_contribution, reconstruct_layers
from render_provenance import verify as verify_dependencies

BASE = Path(__file__).resolve().parent
COUNTS = {'bike':8,'chair':4}
FACINGS = ('SE','NW','SW','NE')
VARIANTS = ('green','blue','red')
OWNERS = ('beauty','sim','furniture','lines')
SIZE = (192,240)
RENDER_SCRIPTS = ('render_contributions.py','animation_export.py','build_parts.py','geometry.py','preview.py')


def validate_signature(signature, base=BASE, source=None):
    source = source or base.parent/'sims/sim-01/sim-01-rigged.blend'
    if (signature.get('density') != 8 or signature.get('logical_canvas') != [96,120]
            or set(signature.get('scripts',{})) != set(RENDER_SCRIPTS)):
        raise ValueError('Render signature is incomplete or has a different registration')
    hashes = [(source,signature['source_sha256'])]
    hashes.extend((base/name,signature['scripts'][name]) for name in RENDER_SCRIPTS)
    for path,expected in hashes:
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f'Render source changed since generation: {path.name}')


def expected_keys():
    keys = {(kind,facing,index,variant,owner) for kind,count in COUNTS.items()
            for facing in FACINGS for index in range(count) for variant in VARIANTS for owner in OWNERS}
    keys.update((kind,facing,0,'green','empty') for kind in COUNTS for facing in FACINGS)
    return keys


def validate_ownership(palettes):
    if set(palettes) != set(VARIANTS):
        raise ValueError('Incomplete palette ownership evidence')
    for owner in ('furniture','lines'):
        if len({layers[owner].tobytes() for layers in palettes.values()}) != 1:
            raise ValueError(f'Palette colour leaked into {owner} ownership')
    if len({layers['sim'].tobytes() for layers in palettes.values()}) != 3:
        raise ValueError('Body ownership does not contain all three shirt colours')


def compare_reconstruction(beauty, body, furniture, outline):
    result = reconstruct_layers(body,furniture,outline)
    reference = encode_contribution(beauty,result.size)
    actual = encode_contribution(result,result.size)
    errors = sorted(max(abs(a-b) for a,b in zip(left,right))
                    for left,right in zip(actual.getdata(),reference.getdata()) if left[3] or right[3])
    if not errors:
        raise ValueError('Empty reconstruction')
    metrics = {'max_error':max(errors),'p95_error':errors[int(len(errors)*.95)],
               'active_pixels':len(errors),'pixels_above_8':sum(value>8 for value in errors)}
    # Independent display-transformed passes differ at antialiased outline
    # boundaries. Large disagreement is an error, not a reason to drop a pass.
    if metrics['p95_error'] > 12 or metrics['max_error'] > 64:
        raise ValueError(f'Interaction reconstruction differs from full scene: {metrics}')
    return metrics


def load_records(directory, complete=True):
    proof = json.loads((directory/'raw-proof.json').read_text())
    validate_signature(proof['signature'])
    verify_dependencies(directory,complete=complete)
    records = {}
    for row in proof['renders']:
        key = (row['object'],row['facing'],row['frame'],row['variant'],row['owner'])
        if key in records or key not in expected_keys():
            raise ValueError('Duplicate or unexpected render sample')
        path = directory/row['path']
        if path.resolve().parent != directory.resolve():
            raise ValueError('Render path leaves the batch directory')
        if hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError(f'Render hash changed: {path.name}')
        with Image.open(path) as image:
            if image.mode != 'RGBA' or image.size != (768,960):
                raise ValueError(f'Render format changed: {path.name}')
        records[key] = path
    if complete and (proof['state'] != 'complete' or set(records) != expected_keys()):
        raise ValueError('Production render coverage is incomplete')
    return proof,records


def export(directory, output, complete=True):
    directory,output = Path(directory),Path(output)
    proof,records = load_records(directory,complete)
    manifest = {'version':1,'pixel_density':2,'width':96,'height':120,
                'anchor':proof['anchor'],'empty':[],'frames':[]}
    metrics = []
    alpha_reference = {}
    def save(image, prefix):
        # Content-addressed files share identical furniture and ink across colours.
        content_hash = hashlib.sha256(image.tobytes()).hexdigest()
        path = output/prefix/f'{content_hash}.png'
        path.parent.mkdir(parents=True,exist_ok=True)
        image.save(path)
        return {'path':path.relative_to(output).as_posix(),
                'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    for kind,count in COUNTS.items():
        for facing in FACINGS:
            key = (kind,facing,0,'green','empty')
            if key in records and complete:
                with Image.open(records[key]) as image:
                    ref = save(image.resize(SIZE,Image.Resampling.LANCZOS),'empty')
                manifest['empty'].append({'object':kind,'facing':facing,**ref})
            for index in range(count):
                palettes = {}
                for variant in VARIANTS:
                    prefix = (kind,facing,index,variant)
                    if not all((*prefix,owner) in records for owner in OWNERS):
                        continue
                    images = {}
                    for owner in OWNERS:
                        with Image.open(records[*prefix,owner]) as source:
                            images[owner] = source.copy()
                    encoded = {owner:encode_contribution(images[owner],SIZE)
                               for owner in ('sim','furniture','lines')}
                    palettes[variant] = encoded
                    for owner,image in encoded.items():
                        alpha_key = (kind,facing,index,owner)
                        alpha = image.getchannel('A').tobytes()
                        if alpha_key in alpha_reference and alpha_reference[alpha_key] != alpha:
                            raise ValueError(f'Palette changed geometry coverage: {prefix} {owner}')
                        alpha_reference[alpha_key] = alpha
                    comparison = compare_reconstruction(images['beauty'],encoded['sim'],encoded['furniture'],encoded['lines'])
                    metrics.append({'object':kind,'facing':facing,'frame':index,'variant':variant,**comparison})
                    if complete:
                        manifest['frames'].append({'object':kind,'facing':facing,'frame':index,'variant':variant,
                            'body':save(encoded['sim'],'layers'),'furniture':save(encoded['furniture'],'layers'),
                            'outline':save(encoded['lines'],'layers')})
                if len(palettes) == 3:
                    validate_ownership(palettes)
    report = {'complete':complete,'checked_groups':len(metrics),'comparisons':metrics}
    (directory/'export-comparison.json').write_text(json.dumps(report,indent=2))
    if complete:
        if len(manifest['frames']) != 144 or len(manifest['empty']) != 8:
            raise ValueError('Runtime manifest coverage is incomplete')
        target = output/'manifest.json'
        temporary = target.with_suffix('.tmp')
        temporary.write_text(json.dumps(manifest,indent=2))
        temporary.replace(target)
    print(f'PASS: {len(metrics)} independently compared groups; production_export={complete}')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,default=BASE/'review/contributions-01')
    parser.add_argument('--output',type=Path,default=BASE/'export')
    parser.add_argument('--check-ready',action='store_true')
    args = parser.parse_args()
    export(args.input,args.output,complete=not args.check_ready)
