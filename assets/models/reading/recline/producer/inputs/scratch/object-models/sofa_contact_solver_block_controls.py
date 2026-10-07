"""Pure two-arm constraint controls and retained blended-source feature evidence."""
import hashlib,json,time
from pathlib import Path
import numpy as np
from sofa_contact_solver_block import affected,joint_step,nonworsening,feature_values,own_features,neighbor_features
from classify_sofa_lap_contacts import source_map

root=Path(__file__).parent;output=root/'sofa-contact-solver-block-controls-01';output.mkdir(exist_ok=False);began=time.monotonic()
assert affected(dict(kind='neighbors',seats=[0,1],parts=['Relaxed shirt sleeve','Relaxed shirt sleeve.001']))
assert affected(dict(kind='arm_body',seat=1,parts=['Relaxed shirt sleeve.001','Overshirt body']))
assert not affected(dict(kind='arm_body',seat=1,parts=['Relaxed shirt sleeve','Overshirt body']))
features=[dict(group='left',kind='existing garment'),dict(group='right',kind='existing garment'),dict(group='neighbor',kind='neighbor guard')]
base=np.array([-1.,-1.,0.]);jac=np.array([[1.,0.],[0.,1.],[-1.,1.]])
step=joint_step(features,base,jac,'left',np.array([-1.,-1.]),np.array([1.,1.]))
assert step['found'] and nonworsening(features,base,step['predicted'])['valid']
left=base+jac@np.array([step['step'][0],0.]);right=base+jac@np.array([0.,step['step'][1]])
assert not nonworsening(features,base,left)['valid'] and right[0]==base[0]
trade=np.array([0.,-1.5,0.]);assert np.sum(np.maximum(-trade,0))<np.sum(np.maximum(-base,0))
assert not nonworsening(features,base,trade)['valid']
# The feature reader consumes the evaluated blended point, not a rigid-arm substitute.
blend_feature=[dict(group='blend',kind='neighbor guard',a=dict(seat=0,name='sleeve',vertices=[0],weights=[1.]),
                    b=dict(seat=1,name='sleeve',vertices=[0],weights=[1.]),normal=[1.,0.,0.])]
blended=feature_values(blend_feature,{'x/0/sleeve/points':np.array([[.7,.3,0.]]),'x/1/sleeve/points':np.zeros((1,3))},'x')
assert abs(blended[0]-.7)<1e-12
paths=[Path(__file__),root/'sofa_contact_solver_block.py',root/'sofa-contact-solver-fit-02/proof.json',
       root/'sofa-contact-solver-fit-02/selected-geometry.npz',root/'sofa-binding-audit-01/source-binding.npz',
       root/'sofa-binding-audit-01/proof.json',root/'sofa-derived-binding-03/normalized-rest.npz',
       root/'sofa-coupled-contact-neutral-shoulders-01/proof.json',root/'sofa-hand-support-01/proof.json',
       root/'classify_sofa_lap_contacts.py',root/'diagnose_sofa_hand_frames.py']
paths += [root/f'sofa-contact-solver-fit-02/candidate-{i:03d}.npz' for i in (3,4,5)]
inputs={str(p.resolve()):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
receipt=json.loads((root/'sofa-contact-solver-fit-02/proof.json').read_text());reference=np.load(root/'sofa-contact-solver-fit-02/selected-geometry.npz')
topology=np.load(root/'sofa-binding-audit-01/source-binding.npz');audit=json.loads((root/'sofa-binding-audit-01/proof.json').read_text())
rest=np.load(root/'sofa-derived-binding-03/normalized-rest.npz');neutral=json.loads((root/'sofa-coupled-contact-neutral-shoulders-01/proof.json').read_text())
cases=[(str(i),np.load(root/f'sofa-contact-solver-fit-02/candidate-{i:03d}.npz')) for i in (3,4,5)]
maps={label:[source_map(name,cache[f'candidate/{seat}/{name}/triangles'],topology) for seat,name in [(0,'Relaxed shirt sleeve'),(1,'Relaxed shirt sleeve.001')]] for label,cache in cases}
own,coverage=own_features(receipt['selected'],reference,'candidate',neutral)
neighbor=neighbor_features(reference,'candidate',cases,maps)
values=feature_values(own+neighbor,reference,'candidate')
assert len(neighbor)==154 and np.min(values[len(own):])>0
names=json.loads((root/'sofa-hand-support-01/proof.json').read_text())['bone_names'];cache=cases[0][1]
blend_rows=[]
for seat,side,name,map_index in [(0,'L','Relaxed shirt sleeve',0),(1,'R','Relaxed shirt sleeve.001',1)]:
    pairs=cache['candidate/neighbor/0/1/Relaxed shirt sleeve/Relaxed shirt sleeve.001'];ids=np.unique(pairs[:,map_index])
    faces=np.unique(maps['3'][map_index][ids]);vertices=np.unique(cache[f'candidate/{seat}/{name}/triangles'][ids])
    matrix=cache[f'candidate/{seat}/rig_matrix_world']@cache[f'candidate/{seat}/bone_matrices'][names.index('upper_arm.'+side)]@np.linalg.inv(np.asarray(audit['rest_bones']['upper_arm.'+side]['matrix']))
    naive=rest[name+'/rest_points'][vertices]@matrix[:3,:3].T+matrix[:3,3]
    actual=cache[f'candidate/{seat}/{name}/points'][vertices]
    error=np.linalg.norm(actual-naive,axis=1)
    assert error.max()>1e-4
    blend_rows.append(dict(seat=seat,side=side,source_faces=faces.tolist(),vertices=len(vertices),maximum_rigid_predictor_error=float(error.max())))
assert time.monotonic()-began<45
for path,sha in inputs.items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==sha,path
np.savez(output/'feature-reference.npz',values=values)
proof=dict(state='complete',passed=True,inputs=inputs,elapsed_seconds=time.monotonic()-began,
           controls=['Neighbor seats participate in the active block','Joint step preserves neighbor while isolated left step fails','A lower aggregate violation cannot hide a worsening right-arm constraint','Evaluated blended points drive features'],
           synthetic_joint=dict(step=step['step'].tolist(),fraction=step['fraction'],rank=step['rank']),
           own_coverage=coverage,own_features=len(own),neighbor_features=len(neighbor),minimum_neighbor_feature_separation=float(values[len(own):].min()),
           blended_witness_evidence=blend_rows,features=own+neighbor,
           scope='Pure/local model controls and retained source witnesses; no new reference or pose acceptance')
(output/'proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({k:v for k,v in proof.items() if k not in ['inputs','features']}))
