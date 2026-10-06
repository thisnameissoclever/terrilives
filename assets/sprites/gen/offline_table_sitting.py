"""Import the food-free fitted chair pose as an additional interaction view."""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops
from offline_furniture import FurnitureExport

def load_table_sitting(directory):
    directory=Path(directory)
    proof=json.loads((directory/'proof.json').read_text())
    assert proof['state']=='complete' and len(proof['renders'])==48
    digest=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
    assert digest(directory.parent/'seated-dining.blend')==proof['source_sha256']
    assert digest(directory.parent/'render_table_sitting.py')==proof['producer_sha256']
    sys.path.insert(0,str(directory.parent.parent/'furniture'))
    from layer_partition import encode_contribution
    from export_contributions import compare_reconstruction,validate_ownership
    records={}
    for row in proof['renders']:
        path=directory/row['path'];assert path.resolve().parent==directory.resolve()
        assert digest(path)==row['sha256']
        with Image.open(path) as image:
            assert image.mode=='RGBA' and image.size==(640,896)
            records[row['facing'],row['variant'],row['owner']]=image.copy()
    sprites=[];pairs={};profiles={};bounds={}
    for facing in ('SE','SW','NW','NE'):
        chair='offlineDiningChair'+('' if facing=='SE' else facing)
        profiles[chair]={'action':8,'halfCycleTicks':16,'frames':{}}
        palettes={}
        for variant in ('green','blue','red'):
            layers={owner:encode_contribution(records[facing,variant,owner],(160,224)) for owner in ('sim','furniture','lines')}
            compare_reconstruction(records[facing,variant,'beauty'],layers['sim'],layers['furniture'],layers['lines'])
            palettes[variant]=layers
            name=f'occupiedTableSit{facing}{variant.title()}'
            for role in ('sim','furniture','lines'):
                sprites.append((name+role,layers[role],160,224))
            body=name+'sim';pairs[body]={'furniture':name+'furniture','outline':name+'lines'}
            alpha=ImageChops.lighter(ImageChops.lighter(layers['sim'].getchannel('A'),layers['furniture'].getchannel('A')),layers['lines'].getchannel('A'))
            bounds[body]=[v/2 for v in alpha.getbbox()]
            profiles[chair]['frames'][variant]=[body]
        validate_ownership(palettes)
    return FurnitureExport(sprites,proof['anchor'],pairs,profiles,bounds)
