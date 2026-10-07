"""Reduce the four mixed-pose beauties with the existing linear-light reference filter."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image

MODELS=Path(__file__).resolve().parents[2]/'assets/models'
sys.path.insert(0,str(MODELS/'seating'))
from seat_export_contract import reference_beauty


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(source,output):
    receipt=json.loads((source/'proof.json').read_text())
    if receipt['state']!='complete' or receipt['diagnostic_render_count']!=4:
        raise ValueError('Require four completed diagnostics')
    output.mkdir(exist_ok=False)
    images=[]
    inputs={str(p):digest(p) for p in (Path(__file__).resolve(),source/'proof.json',
        MODELS/'seating/seat_export_contract.py',MODELS/'bedroom/double_bed_linear.py')}
    for row in receipt['renders']:
        path=source/row['image']['path']
        if digest(path)!=row['image']['sha256']:
            raise ValueError('Raw beauty hash changed')
        inputs[str(path)]=digest(path)
        with Image.open(path) as raw:
            for density in (1,2):
                size=tuple(v*density for v in row['native_size'])
                image=reference_beauty(raw,size)
                target=output/(row['name']+f'-density{density}.png')
                image.save(target)
                images.append(dict(path=target.name,sha256=digest(target),density=density,
                    size=list(size),alpha_bounds=image.getbbox(),labels=row['labels']))
    (output/'proof.json').write_text(json.dumps(dict(state='complete',acceptance=False,inputs=inputs,images=images,
        filter='Existing float-linear premultiplied BOX beauty reference; no compositor acceptance'),indent=2)+'\n')


if __name__=='__main__':
    run(*(Path(v).resolve() for v in sys.argv[1:]))
