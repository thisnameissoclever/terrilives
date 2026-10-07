"""Derive six labeled native-scale copies without another render."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image

MODELS = Path(__file__).resolve().parents[2]/'assets/models'
sys.path.insert(0, str(MODELS/'seating'))
from seat_export_contract import reference_beauty


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(source, output):
    receipt = json.loads((source/'proof.json').read_text())
    if receipt['state'] != 'complete' or len(receipt['renders']) != 6:
        raise ValueError('Six completed diagnostic renders are required')
    output.mkdir(parents=True, exist_ok=False)
    inputs = {str(p):digest(p) for p in (Path(__file__).resolve(), source/'proof.json',
              MODELS/'seating/seat_export_contract.py', MODELS/'bedroom/double_bed_linear.py')}
    images = []
    for row in receipt['renders']:
        path = source/row['image']['path']
        if digest(path) != row['image']['sha256']:
            raise ValueError('Raw render identity changed')
        inputs[str(path)] = digest(path)
        with Image.open(path) as raw:
            if raw.mode != 'RGBA' or list(raw.size) != [v*row['source_density'] for v in row['native_size']]:
                raise ValueError('Unexpected source dimensions or mode')
            if row['source_density']==8:
                image = reference_beauty(raw, tuple(row['native_size']))
                dense = reference_beauty(raw, tuple(v*2 for v in row['native_size']))
                dense_path = output/(row['name']+'-density2.png')
                dense.save(dense_path)
                images.append(dict(path=dense_path.name, sha256=digest(dense_path), size=list(dense.size),
                                   density=2, labels=row['labels'], filter=row['reduction']))
            else:
                image = raw.resize(tuple(row['native_size']), Image.Resampling.LANCZOS)
                image.putdata([(r,g,b,a) if a>4 else (0,0,0,0) for r,g,b,a in image.getdata()])
            image.info.clear()
            target = output/(row['name']+'-native.png')
            image.save(target)
            images.append(dict(path=target.name, sha256=digest(target), size=list(image.size),
                               labels=row['labels'], alpha_bounds=image.getbbox(), density=1, filter=row['reduction']))
    report = dict(state='complete', acceptance=False, inputs=inputs, images=images,
                  scale='Diagnostic crops preserve physical logical-pixel scale; sofa also has density2 copies',
                  limitation='Beauty diagnostics only; no production compositor or runtime pixel acceptance')
    (output/'proof.json').write_text(json.dumps(report, indent=2)+'\n')


if __name__ == '__main__':
    run(*(Path(v).resolve() for v in sys.argv[1:]))
