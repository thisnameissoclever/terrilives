"""No-jump boundary control and saved measured-frame continuity controls."""
import hashlib
import json
from pathlib import Path
import numpy as np
from sofa_contact_solver_adaptive import linearize,recover
from sofa_contact_solver_frames import coupled_frames

root=Path(__file__).parent;output=root/'sofa-contact-solver-adaptive-controls-01';output.mkdir(exist_ok=False)
# The discarded centre-only triangle constraint creates a shared entry jump.
def triangle_bound(q):
    q=np.maximum(q,0.)
    if q.sum()>1:q-=((q.sum()-1)/2)
    return q
measure=lambda q:float(q@np.array([2.,3.]))
old=np.array([2.,2.]);base=triangle_bound(old)
naive=(measure(triangle_bound(old+np.array([.01,0.])))-measure(old))/.01
result=linearize(old,triangle_bound,measure,cyclic=())
assert abs(naive)>100 and np.linalg.norm(result['gradient'])<4
for row in result['derivatives']:
    if 'actual_move' in row:assert abs(np.asarray(row['actual_move'])@result['gradient']-row['response'])<1e-12
# Conservative placement bounds contain a valid edge-supported hand centre.
identity=lambda q:np.clip(q,[-3.,-3.],[3.,3.])
identity_result=linearize(old,identity,measure,cyclic=())
assert np.array_equal(identity_result['reference'],old)
assert np.max(np.abs(identity_result['gradient']-[2.,3.]))<1e-12
receipt=json.loads((root/'sofa-contact-solver-fit-01/proof.json').read_text())
checkpoint=receipt['evaluations'][1]
original=json.loads((root/'sofa-coherent-arms-02/proof.json').read_text())
data=next(row['inputs'] for row in original['frames'] if row['seat']==1 and row['side']=='L')
frames=checkpoint['frames'][1]
recovery=recover(data,*[np.asarray(frames[name+'.L']) for name in ('upper_arm','forearm','hand')])
assert max(recovery['errors'].values())<1e-5
reference=recovery['result']['targets'];scales=[]
for epsilon in (1e-4,1e-5,1e-6,1e-7):
    hand=np.asarray(frames['hand.L']).copy();hand[0,3]+=epsilon
    value=coupled_frames(data,hand,recovery['swivel']+epsilon,recovery['roll']+epsilon)['targets']
    scales.append(dict(epsilon=epsilon,maximum_frame_change=max(float(np.abs(value[name]-reference[name]).max()) for name in value)))
ratios=[b['maximum_frame_change']/a['maximum_frame_change'] for a,b in zip(scales,scales[1:])]
assert all(.09<ratio<.11 for ratio in ratios)
paths=[Path(__file__),root/'sofa_contact_solver_adaptive.py',root/'sofa_contact_solver_frames.py',
       root/'sofa-contact-solver-fit-01/proof.json',root/'sofa-contact-solver-fit-01/candidate-001.npz',root/'sofa-coherent-arms-02/proof.json']
proof=dict(state='complete',passed=True,inputs={str(p.resolve()):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
           discarded_reference=old.tolist(),discarded_projection=base.tolist(),naive_false_derivative=naive,
           constrained_gradient=result['gradient'].tolist(),corrected_envelope_reference=identity_result['reference'].tolist(),
           corrected_envelope_gradient=identity_result['gradient'].tolist(),checkpoint=1,checkpoint_frame_errors=recovery['errors'],
           recovered_swivel=recovery['swivel'],recovered_roll=recovery['roll'],continuity=scales,successive_change_ratios=ratios,
           scope='Pure parameterization and full-frame algebra; not new pose geometry acceptance')
(output/'proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
