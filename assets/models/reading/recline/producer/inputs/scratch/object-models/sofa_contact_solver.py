"""Bounded phase-zero contact/arm solve. Invocation requires a parent geometry window."""
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
import numpy as np
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0,str(Path(__file__).parent))
from sofa_contact_solver_frames import coupled_frames, rotation
from sofa_contact_solver_scene import SceneEvaluator, surface_data, retained
from derive_lap_support_adjustment import minimum_gap

LAP=((0,'L'),(1,'L'),(1,'R'),(2,'R'))
MAX_EVALUATIONS=96
MAX_SECONDS=1800


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(root, output, mode):
    if mode not in ('controls','solve'):raise ValueError('Explicit controls or solve mode required')
    if not bpy.app.background:raise ValueError('Background Blender required')
    output.mkdir(parents=True,exist_ok=False)
    began=time.monotonic()
    source=json.loads((root/'sofa-resting-clearance-01/proof.json').read_text())
    control=json.loads((root/'sofa-contact-solver-controls-02/proof.json').read_text())
    if not control['passed']:raise ValueError('Cached classifier controls must pass before fitting')
    for receipt in (source,control):
        for path,sha in receipt['inputs'].items():
            if digest(path)!=sha:raise ValueError('Retained receipt dependency changed: '+path)
    inputs=dict(source['inputs']);inputs.update(control['inputs'])
    for path in [*root.glob('sofa_contact_solver*.py'),root/'sofa-derived-binding-03/derived-waist-binding.blend',
                 root/'sofa-resting-clearance-01/proof.json',root/'sofa-resting-clearance-01/phase-00.npz',
                 root/'sofa-coherent-arms-02/proof.json',root/'sofa-hand-support-01/proof.json']:
        inputs[str(path.resolve())]=digest(path)
    for path,sha in inputs.items():
        if digest(path)!=sha:raise ValueError('Immutable input changed: '+path)
    proof=dict(state='running',pid=os.getpid(),mode=mode,inputs=inputs,evaluations=[],
               limits=dict(evaluations=MAX_EVALUATIONS if mode=='solve' else 1,seconds=MAX_SECONDS if mode=='solve' else 180),
               runtime_phase_contract='Four shared phases per sofa; final production/export replay remains required',
               final_acceptance=False,remaining=['Canonical repaired book grip and mixed actions','Opposing and whole-sofa views','Owner visual approval','All four phases after phase-zero review'])
    def save():
        proof['elapsed_seconds']=time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
    save()
    try:
        binding=json.loads((root/'sofa-derived-binding-03/proof.json').read_text())
        hands=json.loads((root/'sofa-hand-support-01/proof.json').read_text())
        old=json.loads((root/'sofa-coherent-arms-02/proof.json').read_text())
        rigs,bodies,furniture,origins=retained.shared.load_scene(root/'sofa-derived-binding-03',binding)
        retained.shared.pose(rigs,origins,'sit',0.)
        for rig,frames in zip(rigs,source['selected_frames']):retained.apply_frames(rig,{n:np.asarray(m) for n,m in frames.items()})
        initial=retained.torso.surfaces(bodies)
        baseline=[{n:surface_data(s) for n,s in body.items()} for body in initial]
        evaluator=SceneEvaluator(root,rigs,bodies,furniture,hands,baseline)
        arrays={}
        regression=evaluator.evaluate(arrays,'retained',0.,began+(180 if mode=='controls' else MAX_SECONDS))
        proof['retained_scene_control']=regression
        np.savez(output/'retained-scene.npz',**arrays)
        expected=[(1,['Turned sleeve cuff','One sewn breast pocket']),(1,['Relaxed shirt sleeve','One sewn breast pocket']),
                  (0,['Turned sleeve cuff','Overshirt body']),(2,['Turned sleeve cuff.001','Overshirt body'])]
        for seat,parts in expected:
            if not any(r.get('seat')==seat and r.get('parts')==parts and not r['valid'] for r in regression['rows']):
                raise ValueError('Full discovery missed retained failure: '+str((seat,parts)))
        for seat,parts in [(0,['Relaxed shirt sleeve.001','Overshirt body']),(2,['Relaxed shirt sleeve','Overshirt body'])]:
            if not any(r.get('seat')==seat and r.get('parts')==parts and r['valid'] for r in regression['rows']):
                raise ValueError('Full discovery lost source shoulder control')
        proof['retained_scene_control_passed']=True;save()
        if mode=='controls':
            proof['state']='complete';return
        domains=[]
        for seat,side in LAP:
            suffix='.001' if side=='R' else ''
            data=copy.deepcopy(next(r for r in old['frames'] if r['seat']==seat and r['side']==side)['inputs'])
            support=initial[seat]['Tailored trouser leg'+suffix]
            points=np.asarray(support.points);tri=points[np.asarray(support.triangles)]
            normals=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);centres=tri.mean(1)
            source_m={key:np.asarray(value) for key,value in data['matrices'].items()}
            spine_deform=source_m['spine_pose']@np.linalg.inv(source_m['spine_rest'])
            shoulder=(np.asarray(rigs[seat].matrix_world)@spine_deform@source_m['upper_rest'])[:3,3]
            reach=sum(np.linalg.norm(source_m[b][:3,3]-source_m[a][:3,3])
                      for a,b in (('upper_rest','forearm_rest'),('forearm_rest','hand_rest')))
            source_palm=evaluator.classifier.rest['Relaxed palm'+suffix+'/rest_points']
            palm_radius=np.linalg.norm(source_palm-source_m['hand_rest'][:3,3],axis=1).max()
            blockers=[value for name,value in initial[seat].items()
                      if not name.startswith(retained.shared.ARM_PARTS) and name!='Tailored trouser leg'+suffix]
            exposed_ids=[]
            for index,centre in enumerate(centres):
                if normals[index,2]<=0:continue
                hit=support.tree.ray_cast(Vector((centre[0],centre[1],2.)),Vector((0,0,-1)),4.)[0]
                if hit is None or abs(hit.z-centre[2])>=1e-6:continue
                if np.linalg.norm(centre-shoulder)>reach+palm_radius:continue
                hidden=False
                for blocker in blockers:
                    cover=blocker.tree.ray_cast(Vector((centre[0],centre[1],2.)),Vector((0,0,-1)),4.)[0]
                    if cover is not None and cover.z>centre[2]+1e-6:hidden=True;break
                if not hidden:exposed_ids.append(index)
            if not exposed_ids:raise ValueError('No exposed thigh surface')
            domain_points=tri[exposed_ids].reshape(-1,3)
            low,high=domain_points[:,:2].min(0),domain_points[:,:2].max(0)
            initial_hand=np.asarray(rigs[seat].matrix_world)@np.asarray(rigs[seat].pose.bones['hand.'+side].matrix)
            rest_hand=np.asarray(data['matrices']['hand_rest']);deform=initial_hand@np.linalg.inv(rest_hand)
            palm=evaluator.classifier.rest['Relaxed palm'+suffix+'/rest_points']
            centre=(palm@deform[:3,:3].T+deform[:3,3]).mean(0)
            exposed_centres=centres[exposed_ids]
            starting_xy=exposed_centres[np.argmin(np.linalg.norm(exposed_centres[:,:2]-centre[:2],axis=1)),:2]
            measurement=next(r['measurement'] for r in hands['hands'] if r['seat']==seat and r['side']==side)
            normal=np.asarray(measurement['support_normal']);normal/=np.linalg.norm(normal)
            tangent=np.array([-1.,0.,0.]);tangent-=normal*(tangent@normal);tangent/=np.linalg.norm(tangent)
            basis=np.column_stack((tangent,np.cross(normal,tangent),normal))
            palm_spans=np.ptp(palm@deform[:3,:3].T@basis,axis=0)
            tilt=math.atan2(palm_spans[2],min(palm_spans[:2]))
            domains.append(dict(seat=seat,side=side,low=low,high=high,centre=centre,data=data,
                                support=surface_data(support),normal=normal,basis=basis,tilt=tilt,
                                palm=palm,palm_triangles=evaluator.classifier.rest['Relaxed palm'+suffix+'/triangles'],
                                deformation=deform,rest_hand=rest_hand,exposed_triangle_ids=exposed_ids,
                                domain_triangles=tri[exposed_ids],starting_xy=starting_xy))
        proof['domains']=[dict(seat=d['seat'],side=d['side'],xy_bounds=[d['low'].tolist(),d['high'].tolist()],
                              yaw_bound_radians=math.pi,tilt_bound_radians=d['tilt'],swivel_bound_radians=math.pi,
                              roll_bound_radians=math.pi,exposed_triangle_ids=d['exposed_triangle_ids'],
                              mechanism='Actual upper thigh triangles, unchanged reach, contact normal refit and complete scene gate') for d in domains]
        def evaluate(x):
            if len(proof['evaluations'])>=MAX_EVALUATIONS or time.monotonic()-began>=MAX_SECONDS:
                raise TimeoutError('Declared coupled solve budget exhausted')
            number=len(proof['evaluations']);arrays={};frames=[];diagnostics=[];stage='construct'
            try:
                for d,v in zip(domains,np.asarray(x).reshape(4,7)):
                    seat,side=d['seat'],d['side'];xy=(d['low']+d['high'])/2+v[:2]*(d['high']-d['low'])/2
                    triangles=d['domain_triangles'][:,:,:2]
                    axes=np.stack((triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0]),axis=2)
                    bary=np.linalg.solve(axes,(xy-triangles[:,0])[:,:,None])[:,:,0]
                    if not np.any((bary[:,0]>=0)&(bary[:,1]>=0)&(bary.sum(1)<=1)):
                        raise ValueError('Contact centre outside measured exposed reachable thigh triangles')
                    normal=d['normal'];basis=d['basis']
                    rot=rotation(normal,v[2]*math.pi)@rotation(basis[:,0],v[3]*d['tilt'])@rotation(basis[:,1],v[4]*d['tilt'])
                    deform=d['deformation'].copy();deform[:3,:3]=rot@deform[:3,:3]
                    centre=np.r_[xy,d['centre'][2]]
                    deform[:3,3]=centre-deform[:3,:3]@d['palm'].mean(0)
                    palm=d['palm']@deform[:3,:3].T+deform[:3,3]
                    gap=minimum_gap(palm,d['palm_triangles'],d['support']['points'],d['support']['triangles'],basis)
                    deform[:3,3]+=normal*(.0005-gap['minimum'])
                    hand=np.linalg.inv(np.asarray(rigs[seat].matrix_world))@deform@d['rest_hand']
                    solved=coupled_frames(d['data'],hand,v[5]*math.pi,v[6]*math.pi)
                    target={name+'.'+side:matrix for name,matrix in solved['targets'].items()}
                    frames.append(dict(seat=seat,side=side,matrices={n:m.tolist() for n,m in target.items()}))
                    diagnostics.append(dict(seat=seat,side=side,blend_minimum_singular_values=solved['blend_minimum_singular_values']))
                stage='evaluate'
                error=0.
                for frame in frames:error=max(error,retained.apply_frames(rigs[frame['seat']],{n:np.asarray(m) for n,m in frame['matrices'].items()}))
                result=evaluator.evaluate(arrays,'candidate',error,began+MAX_SECONDS)
                result.update(frames=frames,axial_blend_diagnostics=diagnostics)
            except ValueError as error:
                if stage=='evaluate':raise
                result=dict(valid=False,merit=1e9,failures=[dict(kind='construction',valid=False,error=str(error))],frames=frames)
            filename=f'evaluation-{number:03d}.npz';np.savez(output/filename,**arrays)
            result.update(index=number,parameters=np.asarray(x).tolist(),cache=filename,cache_sha256=digest(output/filename))
            proof['evaluations'].append(result);save()
            return result
        x=np.zeros(28)
        for index,d in enumerate(domains):x[index*7:index*7+2]=np.clip((d['starting_xy']-(d['low']+d['high'])/2)/((d['high']-d['low'])/2),-1,1)
        best=evaluate(x);radius=.125
        # Geometry residuals supply finite-difference descent directions. These
        # perturbations estimate a local model; they are not an angle grid.
        while not best['valid'] and len(proof['evaluations'])+29<=MAX_EVALUATIONS:
            gradient=np.zeros(28)
            for index in range(28):
                probe=x.copy();step=radius if x[index]+radius<=1 else -radius;probe[index]+=step
                row=evaluate(probe);gradient[index]=(row['merit']-best['merit'])/step
                if row['valid']:best=row;x=probe;break
            if best['valid']:break
            norm=np.linalg.norm(gradient)
            if norm<1e-12:proof['limiting_reason']='Measured local residual is flat within the declared trust region';break
            proposed=np.clip(x-radius*gradient/norm,-1,1);row=evaluate(proposed)
            if row['merit']<best['merit']:best=row;x=proposed;radius=min(.25,radius*1.25)
            else:radius*=.5
        proof['selected']=best
        proof['phase_zero_geometry_survivor']=best['valid']
        proof['state']='complete'
        proof['scope']='One bounded current-body phase-zero domain; failure does not establish global infeasibility'
    except BaseException as error:
        proof['state']='budget_exhausted' if isinstance(error,TimeoutError) else 'failed'
        proof['error']=repr(error)
        if proof['evaluations']:proof['selected']=min(proof['evaluations'],key=lambda r:r['merit'])
        raise
    finally:
        proof['inputs_unchanged']=all(digest(path)==sha for path,sha in inputs.items())
        save()
        print(json.dumps(dict(state=proof['state'],pid=os.getpid(),inputs_unchanged=proof['inputs_unchanged'],evaluations=len(proof['evaluations']),elapsed_seconds=proof['elapsed_seconds'])),flush=True)

if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:]
    run(Path(args[0]).resolve(),Path(args[1]).resolve(),args[2])
