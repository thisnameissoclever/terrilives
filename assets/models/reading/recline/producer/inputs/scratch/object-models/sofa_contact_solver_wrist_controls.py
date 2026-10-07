"""Bounded wrist attachment regressions from immutable evaluated caches."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import time
import numpy as np
from sofa_contact_solver_wrists import WristEvaluator, classify_wrist, is_wrist
from sofa_contact_solver_evaluator import gate, REQUIRED


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(root, output):
    output.mkdir(exist_ok=False,parents=True)
    began=time.monotonic();limit=8000;seconds=45;count=0
    paths=[Path(__file__),root/'sofa_contact_solver_wrists.py',root/'sofa_contact_solver_evaluator.py',
           root/'sofa-contact-solver-controls-scene-01/proof.json',root/'sofa-contact-solver-controls-scene-01/retained-scene.npz',
           root/'sofa-hand-support-01/proof.json',root/'sofa-hand-support-01/resting-geometry.npz',
           root/'sofa-hand-frame-diagnosis-01/proof.json',root/'sofa-binding-audit-01/source-binding.npz',
           root/'sofa-binding-audit-01/proof.json',root/'sofa-derived-binding-03/normalized-rest.npz']
    inputs={str(p.resolve()):digest(p) for p in paths}
    receipt=json.loads(paths[3].read_text());current=np.load(paths[4]);old=np.load(paths[6])
    evaluator=WristEvaluator(root);controls=[];arrays={}
    rows=copy.deepcopy(receipt['retained_scene_control']['rows'])
    for index,row in enumerate(rows):
        if row['kind']!='arm_body' or not is_wrist(*row['parts']):continue
        seat=row['seat'];first,second=row['parts'];prefix=row['witness']
        a,b=[{key:current[f'retained/{seat}/{name}/{key}'] for key in ('points','triangles')} for name in (first,second)]
        verdict=classify_wrist(first,second,current[prefix+'/world_segments'],current[prefix+'/source_segments'],
                              current[prefix+'/source_faces'],a,b,evaluator.topology,evaluator.audit,evaluator.rest)
        count+=len(current[prefix+'/world_segments'])
        rows[index]=dict(kind='arm_body',seat=seat,parts=[first,second],valid=verdict['valid'],residual=0. if verdict['valid'] else 1.,wrist=verdict)
        controls.append(dict(name=f'retained wrist {seat} {second}',expected=True,actual=verdict['valid'],passed=verdict['valid'],witness=verdict))
    for state,suffix in [('before',''),('before','.001'),('after','.001')]:
        first='Forearm with elbow and wrist sections'+suffix
        folded=old[f'internal/0/{first}/{state}']
        for base in ('Relaxed palm','Resting thumb'):
            second=base+suffix
            a,b=[{key:old[f'{state}/0/{name}/{key}'] for key in ('points','triangles')} for name in (first,second)]
            pairs=old[f'self/0/{first}/{second}/{state}']
            count+=len(pairs)
            if count>limit or time.monotonic()-began>seconds:raise RuntimeError('Declared cache inspection budget exhausted')
            row=evaluator.contact(0,first,second,a,b,pairs,arrays,f'{state}/{second}')
            folds=dict(kind='folds',valid=len(folded)==0,residual=len(folded),pairs=len(folded))
            result=gate([row,folds],{name:True for name in REQUIRED})
            expected=state=='before'
            controls.append(dict(name=f'original {state} {second}',expected=expected,actual=result['valid'],
                                 passed=result['valid']==expected,contact=row,fold=folds,
                                 fixture_scope='Attachment and fold gate only; other coverage flags are fixture inputs'))
    verdict=gate(rows,receipt['retained_scene_control']['coverage'])
    np.savez(output/'witnesses.npz',**arrays)
    for path,sha in inputs.items():assert digest(path)==sha,path
    proof=dict(state='complete',passed=all(c['passed'] for c in controls),inputs=inputs,controls=controls,
               recomputed_retained_scene=verdict,remaining_failures=verdict['failures'],
               rows=rows,pair_count=count,limits=dict(pairs=limit,seconds=seconds),elapsed_seconds=time.monotonic()-began,
               cache_sha256=digest(output/'witnesses.npz'),scope='Cached source wrist controls and reclassification; no fitting or Blender; retained garment failures remain rejected')
    (output/'proof.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(passed=proof['passed'],controls=len(controls),pairs=count,elapsed_seconds=proof['elapsed_seconds'],
                         failed=[c['name'] for c in controls if not c['passed']],remaining=len(verdict['failures']))))
    if not proof['passed']:raise RuntimeError('Wrist controls failed')

if __name__=='__main__':run(*(Path(p).resolve() for p in sys.argv[1:]))
