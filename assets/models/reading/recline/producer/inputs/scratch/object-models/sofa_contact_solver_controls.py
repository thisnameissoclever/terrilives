"""Regression fixtures for the same attachment classifier and hard candidate gate."""
import hashlib
import json
from pathlib import Path
import sys
import time
import numpy as np
from sofa_contact_solver_evaluator import Evaluator, gate, REQUIRED


def run(root, output):
    output.mkdir(parents=True, exist_ok=False)
    start=time.monotonic()
    paths=[Path(__file__),root/'sofa_contact_solver_evaluator.py',
           root/'sofa-coupled-contact-controls-01/proof.json',root/'sofa-coupled-contact-segments-01/segments.npz',
           root/'sofa-coupled-contact-neutral-shoulders-01/proof.json',root/'sofa_coupled_contact_evaluator_v2.py',
           root/'sofa_coupled_contact_evaluator.py',root/'sofa-binding-audit-01/source-binding.npz',
           root/'sofa-binding-audit-01/proof.json',root/'sofa-derived-binding-03/normalized-rest.npz']
    hashes={str(p.resolve()):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    evaluator=Evaluator(root)
    prior=json.loads(paths[2].read_text())
    data=np.load(paths[3])
    cases=[]
    for row in prior['cases']:
        prefix=row['source_prefix']
        results,components=evaluator.classify(*row['parts'],data[prefix+'/world_segments'],
            data[prefix+'/source_segments'],data[prefix+'/source_faces'],row['classifications'])
        invalid=sum(not r['valid'] for r in results)
        cases.append(dict(seat=row['seat'],parts=row['parts'],kind='arm_body',valid=invalid==0,
                          residual=invalid,segments=len(results),invalid=invalid,components=components))
    fixtures=[('center false survivor',1,['Turned sleeve cuff','One sewn breast pocket'],False),
              ('center sleeve pocket',1,['Relaxed shirt sleeve','One sewn breast pocket'],False),
              ('left end cuff shirt',0,['Turned sleeve cuff','Overshirt body'],False),
              ('right end cuff shirt',2,['Turned sleeve cuff.001','Overshirt body'],False),
              ('left outer shoulder',0,['Relaxed shirt sleeve.001','Overshirt body'],True),
              ('right outer shoulder',2,['Relaxed shirt sleeve','Overshirt body'],True)]
    controls=[]
    for label,seat,parts,expected in fixtures:
        row=next(r for r in cases if r['seat']==seat and r['parts']==parts)
        result=gate([row],{name:True for name in REQUIRED})
        controls.append(dict(name=label,expected=expected,actual=result['valid'],passed=result['valid']==expected,witness=row))
    for row in cases:
        if row['parts'][0].startswith('Forearm') or (row['parts'][0].startswith('Relaxed shirt sleeve') and row['parts'][1].startswith('Turned sleeve cuff')):
            controls.append(dict(name='source adjacent material '+str(row['seat'])+' '+str(row['parts']),expected=True,actual=row['valid'],passed=row['valid'],witness=row))
    for path,sha in hashes.items(): assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==sha,path
    result=dict(state='complete',passed=all(r['passed'] for r in controls),elapsed_seconds=time.monotonic()-start,
                inputs=hashes,cases=cases,controls=controls,
                scope='Isolated source attachment and hard-gate regressions; coverage markers are fixture inputs, not a new complete scene certificate')
    (output/'proof.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(passed=result['passed'],controls=len(controls),elapsed_seconds=result['elapsed_seconds'],failed=[c['name'] for c in controls if not c['passed']])))
    if not result['passed']: raise RuntimeError('Regression controls failed; fitting forbidden')

if __name__=='__main__': run(*(Path(p).resolve() for p in sys.argv[1:]))
