"""Record a measured coupled-reading domain and immutable APIs; do not fit a pose."""
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from scipy.spatial import ConvexHull

sys.path.insert(0,str(Path(__file__).parent))
from sofa_arm_frame_math import rotation_between


def run(root,output):
    output.mkdir(parents=True,exist_ok=False)
    source=root/'book-grip-original-replay-01'
    prior=json.loads((source/'proof.json').read_text())
    cache=np.load(source/'reopened.npz');contact=np.load(source/'witnesses.npz')
    matrices={name:np.asarray(value) for name,value in prior['candidate_state']['bone_matrices'].items()}
    rest={b['name']:np.asarray(b['matrix']) for b in next(iter(prior['raw_source_identity']['bones'].values()))}
    normal=matrices['book'][:3,1].copy();normal/=np.linalg.norm(normal)
    level=rotation_between(normal,np.asarray([0.,0.,1.]))
    page=np.mean([cache['Reading book pages'+suffix+'/points'].mean(0) for suffix in ('','.001')],0)
    names=[key[:-len('/points')] for key in cache.files if key.endswith('/points')]
    grip_names=[name for name in names if name.startswith(('Relaxed palm','Resting thumb','Reading book','Printed book line'))]
    grip=np.concatenate([(cache[name+'/points']-page)@level.T for name in grip_names])
    torso_names=[name for name in names if name.startswith(('Overshirt body','Shirt','One sewn','Folded fabric collar','Small horn button'))]
    torso_front=min(float(cache[name+'/points'][:,1].min()) for name in torso_names)
    lap_top=max(float(cache['Tailored trouser leg'+suffix+'/points'][:,2].max()) for suffix in ('','.001'))
    shells={}
    for side in ('L','R'):
        wrist_offset=level@(matrices['hand.'+side][:3,3]-page)
        upper=np.linalg.norm(rest['forearm.'+side][:3,3]-rest['upper_arm.'+side][:3,3])
        lower=np.linalg.norm(rest['hand.'+side][:3,3]-rest['forearm.'+side][:3,3])
        shells[side]=dict(wrist_offset_from_page_center=wrist_offset.tolist(),
            page_center_reach_shell_center=(matrices['upper_arm.'+side][:3,3]-wrist_offset).tolist(),
            upper_length=float(upper),forearm_length=float(lower),inner_radius=float(abs(upper-lower)),outer_radius=float(upper+lower))
    cells=[]
    for side,suffix in (('L',''),('R','.001')):
        basis=contact['contact/'+side+'/basis'];uv=contact['contact/'+side+'/vertices']
        plane=float(np.min(cache['Reading book cover'+suffix+'/points']@basis[:,2]))
        cells.append((np.column_stack((uv,np.full(len(uv),plane)))@basis.T-page)@level.T)
    footprint=np.concatenate(cells)[:,:2];hull=ConvexHull(footprint)
    balance={}
    for part in ('cover','pages'):
        center=(np.mean([cache['Reading book '+part+suffix+'/points'].mean(0) for suffix in ('','.001')],0)-page)@level.T
        balance[part]=dict(relative_centroid=center.tolist(),maximum_horizontal_hull_distance=float(np.max(hull.equations[:,:2]@center[:2]+hull.equations[:,2])))
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    inputs=dict(prior['inputs'])
    dependencies={}
    for name in ('sofa_contact_solver_frames.py','sofa_contact_solver_wrists.py','sofa_contact_solver_evaluator.py','sofa_contact_solver_scene_v2.py','sofa_contact_solver_memo.py'):
        path=root/name;dependencies[name]=digest(path);inputs[str(path.resolve())]=dependencies[name]
    receipts={}
    for name in ('sofa-contact-solver-frame-controls-01','sofa-contact-solver-wrist-controls-01','sofa-contact-solver-controls-scene-02'):
        path=root/name/'proof.json';receipt=json.loads(path.read_text());inputs.update(receipt['inputs'])
        inputs[str(path.resolve())]=digest(path);receipts[name]=dict(sha256=digest(path),state=receipt['state'])
    for path in (Path(__file__),source/'proof.json',source/'reopened.npz',source/'witnesses.npz'):
        inputs[str(path.resolve())]=digest(path)
    report=dict(state='complete',inputs=inputs,scope='Passive domain and API design only: no position chosen, no arm target fitted, no Blender or candidate run',
        level_orientation_control=level.tolist(),level_rotation_degrees=float(np.degrees(np.arccos(np.clip((np.trace(level)-1)/2,-1,1)))),
        reach_shells=shells,
        coarse_clearance_domain=dict(source_axes='Rig-local X lateral, negative Y forward, positive Z upward',
            page_center_y_maximum=torso_front-float(grip[:,1].max())-1e-6,
            page_center_z_minimum=lap_top-float(grip[:,2].min())+1e-6,
            torso_front=torso_front,lap_top=lap_top,grip_backmost_offset=float(grip[:,1].max()),grip_lowest_offset=float(grip[:,2].min()),
            torso_parts=torso_names,grasp_parts=grip_names,
            meaning='Conservative starting half-spaces for the leveled mean page plane only; exact full geometry and head clearance remain required. Recompute for another orientation; do not turn these seed bounds into universal pose limits.'),
        conditional_support_projection=balance,
        balance_assumptions='Uniform density in each symmetric cover/page pair, vertical resultant loads, and the geometric near-contact footprint. Both pair centroids lie inside for the level orientation, so their convex mass mixtures do too. This is not pressure, friction, or visual support acceptance.',
        immutable_dependencies=dependencies,control_receipts=receipts,
        api_owner_freeze='Sofa worker explicitly froze these filenames for this design; future worker changes will use new filenames. Rehash before reuse.')
    np.savez(output/'domain.npz',level_orientation=level,grasp_relative_points=grip,near_contact_cells=np.concatenate(cells),horizontal_hull_vertices=footprint[hull.vertices],hull_equations=hull.equations)
    report['cache_sha256']=digest(output/'domain.npz')
    assert all(digest(Path(path))==sha for path,sha in inputs.items())
    (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({key:report[key] for key in ('scope','reach_shells','coarse_clearance_domain','conditional_support_projection')},indent=2))


if __name__=='__main__':run(*(Path(p) for p in sys.argv[1:]))
