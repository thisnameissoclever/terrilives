import hashlib,json
from pathlib import Path
import numpy as np
from sofa_contact_solver_placement import centre_bounds
root=Path(__file__).parent;output=root/'sofa-contact-solver-placement-controls-01';output.mkdir(exist_ok=False)
rest=np.load(root/'sofa-derived-binding-03/normalized-rest.npz')
geometry=np.load(root/'sofa-contact-solver-controls-scene-02/retained-scene.npz')
rows=[]
for seat,side in ((0,'L'),(1,'L'),(1,'R'),(2,'R')):
    suffix='.001' if side=='R' else '';target='Tailored trouser leg'+suffix;hand='Relaxed palm'+suffix
    points=geometry[f'retained/{seat}/{target}/points'];triangles=geometry[f'retained/{seat}/{target}/triangles']
    normal=geometry[f'retained/contact/{seat}/{side}/basis'][:,2]
    low,high,ids,radius=centre_bounds(points,triangles,normal,rest[hand+'/rest_points'])
    centre=geometry[f'retained/{seat}/{hand}/points'].mean(0);inside=bool(np.all(centre[:2]>=low)&np.all(centre[:2]<=high))
    assert inside
    rows.append(dict(seat=seat,side=side,centre=centre.tolist(),bounds=[low.tolist(),high.tolist()],radius=radius,inside=inside,
                     meaning='Search bounds only; physical finite exposed support comes from the full continuous scene evaluator'))
paths=[Path(__file__),root/'sofa_contact_solver_placement.py',root/'sofa-derived-binding-03/normalized-rest.npz',root/'sofa-contact-solver-controls-scene-02/retained-scene.npz']
proof=dict(state='complete',passed=True,rows=rows,inputs={str(p.resolve()):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})
(output/'proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
