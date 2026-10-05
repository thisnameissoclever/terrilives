import base64, io, json
from pathlib import Path
import numpy as np
from PIL import Image

root=Path(__file__).resolve().parents[4]
source=root/'assets/models/seating/export/neutral-03'
manifest=json.loads((source/'manifest.json').read_text())
names=dict(dining='DiningChair',office='DeskChair',sofa='LongSofa',ottoman='Ottoman',reading='Chair')
references=[]
for obj in manifest['objects']:
    for row in obj['scenes']:
        arrays=[np.asarray(Image.open(source/row['layers'][role]['path']),dtype=np.float64)/255
                for role in ('body','furniture','ink')]
        summed=sum(arrays)
        alpha=summed[...,3:4]
        straight=np.divide(summed[...,:3],alpha,out=np.zeros_like(summed[...,:3]),where=alpha>0)
        display=np.where(straight<=.0031308,straight*12.92,1.055*np.maximum(straight,0)**(1/2.4)-.055)
        rgb=np.where(alpha>=.5,display*np.minimum(alpha,1)+[.09,.09,.11]*(1-np.minimum(alpha,1)),[.09,.09,.11])
        assert np.isfinite(rgb).all()
        rgb=np.round(np.clip(rgb,0,1)*255).astype(np.uint8)
        image=Image.fromarray(rgb).convert('RGBA')
        data=io.BytesIO();image.save(data,format='PNG')
        references.append(dict(name=f"{obj['kind']} {row['facing']} {row['variant']} {row['frame']}",
            empty='offline'+names[obj['kind']]+('' if row['facing']=='SE' else row['facing']),
            facing=dict(SE=3,NW=4,SW=2,NE=1)[row['facing']],variant=row['variant'],frame=row['frame'],
            image='data:image/png;base64,'+base64.b64encode(data.getvalue()).decode()))
(root/'web/proofs/neutral-seats-reference.json').write_text(json.dumps(references))
print(len(references),'complete decoded-layer shader references')
