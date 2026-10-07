"""One bounded, witness-guided phase-zero coupled sofa-arm fit."""
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
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).parent))
from sofa_contact_solver_scene_v2 import SceneEvaluatorV2, surface_data, retained
from sofa_contact_solver_frames import coupled_frames, rotation
from derive_lap_support_adjustment import minimum_gap

LIMIT=48
SECONDS=1800
WORK_SECONDS=1770
ORDER=((1,'L'),(0,'L'),(2,'R'),(1,'R'))


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def arm_name(name,side):
    return name.startswith(retained.shared.ARM_PARTS) and name.endswith('.001')==(side=='R')


def key(row):
    return (row['kind'],str(row.get('seat',row.get('seats',''))),tuple(row.get('parts',())),row.get('part',''),row.get('side',''))


def active_rows(result,seat,side):
    return [r for r in result['rows'] if not r['valid'] and r.get('seat')==seat
            and any(arm_name(n,side) for n in r.get('parts',[]))]


def merit(result,seat,side):return sum(float(r.get('residual',1.)) for r in active_rows(result,seat,side))


def closest_triangle_xy(point,triangles):
    axes=np.stack((triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0]),axis=2)
    bary=np.linalg.solve(axes,(point-triangles[:,0])[:,:,None])[:,:,0]
    if np.any((bary[:,0]>=0)&(bary[:,1]>=0)&(bary.sum(1)<=1)):return point.copy()
    nearest=[]
    for start,end in ((0,1),(1,2),(2,0)):
        a=triangles[:,start];axis=triangles[:,end]-a
        t=np.clip(np.einsum('ij,ij->i',point-a,axis)/np.einsum('ij,ij->i',axis,axis),0,1)
        nearest.extend(a+t[:,None]*axis)
    nearest=np.asarray(nearest)
    return nearest[np.argmin(np.linalg.norm(nearest-point,axis=1))]


class ArmDomain:
    def __init__(self,seat,side,rig,data,owner,classifier,measurement):
        self.seat,self.side,self.rig=seat,side,rig
        self.data=copy.deepcopy(data);suffix='.001' if side=='R' else ''
        self.palm=classifier.rest['Relaxed palm'+suffix+'/rest_points']
        self.palm_triangles=classifier.rest['Relaxed palm'+suffix+'/triangles']
        self.rest_hand=np.asarray(data['matrices']['hand_rest'])
        self.world=np.asarray(rig.matrix_world);self.inverse=np.linalg.inv(self.world)
        self.hand0=self.world@np.asarray(rig.pose.bones['hand.'+side].matrix)
        self.deform0=self.hand0@np.linalg.inv(self.rest_hand)
        self.centre=(self.palm@self.deform0[:3,:3].T+self.deform0[:3,3]).mean(0)
        self.normal=np.asarray(measurement['support_normal']);self.normal/=np.linalg.norm(self.normal)
        tangent=np.array([-1.,0.,0.]);tangent-=self.normal*(tangent@self.normal);tangent/=np.linalg.norm(tangent)
        self.basis=np.column_stack((tangent,np.cross(self.normal,tangent),self.normal))
        span=np.ptp(self.palm@self.deform0[:3,:3].T@self.basis,axis=0)
        self.tilt=math.atan2(span[2],min(span[:2]))
        support=owner['Tailored trouser leg'+suffix];self.support=surface_data(support)
        tri=self.support['points'][self.support['triangles']]
        normals=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);centres=tri.mean(1)
        m={n:np.asarray(v) for n,v in data['matrices'].items()}
        spine=m['spine_pose']@np.linalg.inv(m['spine_rest'])
        self.shoulder=(self.world@spine@m['upper_rest'])[:3,3]
        self.lengths=[np.linalg.norm(m[b][:3,3]-m[a][:3,3]) for a,b in [('upper_rest','forearm_rest'),('forearm_rest','hand_rest')]]
        reach=sum(self.lengths);radius=np.linalg.norm(self.palm-m['hand_rest'][:3,3],axis=1).max()
        blockers=[value for name,value in owner.items() if not name.startswith(retained.shared.ARM_PARTS) and name!='Tailored trouser leg'+suffix]
        exposed=[]
        for index,centre in enumerate(centres):
            if normals[index,2]<=1e-14 or np.linalg.norm(centre-self.shoulder)>reach+radius:continue
            hit=support.tree.ray_cast(Vector((centre[0],centre[1],2.)),Vector((0,0,-1)),4.)[0]
            if hit is None or abs(hit.z-centre[2])>1e-6:continue
            hidden=False
            for blocker in blockers:
                cover=blocker.tree.ray_cast(Vector((centre[0],centre[1],2.)),Vector((0,0,-1)),4.)[0]
                if cover is not None and cover.z>centre[2]+1e-6:hidden=True;break
            if not hidden:exposed.append(index)
        if not exposed:raise ValueError('No measured exposed reachable thigh domain')
        self.exposed=exposed;self.triangles=tri[exposed,:,:2]
        self.low=self.triangles.reshape(-1,2).min(0);self.high=self.triangles.reshape(-1,2).max(0)
        self.q=np.zeros(7);self.q[:2]=(self.centre[:2]-(self.low+self.high)/2)/((self.high-self.low)/2)
        # Recover the retained elbow plane from its actual full-frame origin.
        hand=self.inverse@self.hand0
        shoulder=(spine@m['upper_rest'])[:3,3];wrist=hand[:3,3]
        axis=wrist-shoulder;distance=np.linalg.norm(axis);axis/=distance
        a,b=self.lengths;circle=shoulder+axis*(a*a-b*b+distance*distance)/(2*distance)
        reference=(spine@m['forearm_rest'])[:3,3]-circle;reference-=axis*(reference@axis);reference/=np.linalg.norm(reference)
        actual=np.asarray(rig.pose.bones['forearm.'+side].matrix)[:3,3]-circle;actual-=axis*(actual@axis);actual/=np.linalg.norm(actual)
        self.q[5]=math.atan2(axis@np.cross(reference,actual),reference@actual)/math.pi
        self.initial_q=self.q.copy()

    def bounded(self,q):
        q=np.asarray(q).copy();q[:2]=np.clip(q[:2],-1,1);q[3:5]=np.clip(q[3:5],-1,1)
        for i in (2,5,6):q[i]=(q[i]+1)%2-1
        xy=(self.low+self.high)/2+q[:2]*(self.high-self.low)/2
        xy=closest_triangle_xy(xy,self.triangles)
        q[:2]=(xy-(self.low+self.high)/2)/((self.high-self.low)/2)
        return q

    def construct(self,q,bounded=True):
        if bounded:q=self.bounded(q)
        xy=(self.low+self.high)/2+q[:2]*(self.high-self.low)/2
        rot=rotation(self.normal,q[2]*math.pi)@rotation(self.basis[:,0],q[3]*self.tilt)@rotation(self.basis[:,1],q[4]*self.tilt)
        deform=self.deform0.copy();deform[:3,:3]=rot@deform[:3,:3]
        centre=np.r_[xy,self.centre[2]];deform[:3,3]=centre-deform[:3,:3]@self.palm.mean(0)
        palm=self.palm@deform[:3,:3].T+deform[:3,3]
        gap=minimum_gap(palm,self.palm_triangles,self.support['points'],self.support['triangles'],self.basis)
        deform[:3,3]+=self.normal*(.0005-gap['minimum'])
        solved=coupled_frames(self.data,self.inverse@deform@self.rest_hand,q[5]*math.pi,q[6]*math.pi)
        solved['q']=q;solved['frames']={name+'.'+self.side:matrix for name,matrix in solved['targets'].items()}
        solved['upper_world']=self.world@solved['targets']['upper_arm']@np.linalg.inv(np.asarray(self.data['matrices']['upper_rest']))
        return solved

    def points(self,solution,source):return source@solution['upper_world'][:3,:3].T+solution['upper_world'][:3,3]


def separating_target(owner,row,classifier,geometry):
    first,second=row['parts'];source=classifier.rest[first+'/rest_points']
    if first.startswith('Relaxed shirt sleeve'):
        # Exclude the demonstrated proximal shoulder material from the rigid
        # predictor. These distal source vertices are purely upper-arm-bound.
        neutral=next(r for r in classifier.neutral['cases'] if r['name']==first)
        source=source[source[:,2]<neutral['bounds'][0][2]]
    if not first.startswith(('Turned sleeve cuff','Relaxed shirt sleeve')):
        raise ValueError('Limiting contact is outside the source rigid upper-arm predictor')
    target=np.asarray(owner[second].points);actual=np.asarray(owner[first].points)
    if first.startswith('Relaxed shirt sleeve'):
        rest=classifier.rest[first+'/rest_points'];actual=actual[rest[:,2]<neutral['bounds'][0][2]]
    _,axes=np.linalg.eigh(np.cov(target.T))
    choices=[]
    for axis in axes.T:
        for sign in (-1,1):
            normal=axis*sign;gap=float((target@normal).max()-(actual@normal).min())
            if gap>1e-6:choices.append((gap,normal))
    if not choices:raise ValueError('No positive measured separating interval')
    gap,normal=min(choices,key=lambda value:value[0])
    return source,normal,float((target@normal).max()),dict(parts=row['parts'],gap=gap,normal=normal.tolist(),
             mechanism='Smallest positive separating interval along actual target principal face axes; rigid distal source material only')


def run(root,output):
    if not bpy.app.background:raise ValueError('Background Blender required')
    output.mkdir(exist_ok=False,parents=True);began=time.monotonic()
    controls=json.loads((root/'sofa-contact-solver-controls-scene-02/proof.json').read_text())
    if not controls['retained_scene_control_passed'] or not controls['exact_reuse_preserved_rows_and_arrays']:raise ValueError('Complete controls required')
    inputs=dict(controls['inputs'])
    for path,sha in inputs.items():
        if digest(path)!=sha:raise ValueError('Immutable dependency changed: '+path)
    for path in [Path(__file__),root/'sofa-contact-solver-controls-scene-02/proof.json',root/'sofa-contact-solver-controls-scene-02/retained-scene.npz']:
        inputs[str(path.resolve())]=digest(path)
    report=dict(state='running',pid=os.getpid(),inputs=inputs,limits=dict(evaluations=LIMIT,seconds=SECONDS,threads=2),
                evaluations=[],updates=[],candidate_evaluations=0,acceptance=False,
                remaining=['Phase-zero opposing and whole-sofa views','Canonical repaired book grip and mixed actions','All shared phases','Owner visual approval'])
    def save():
        report['elapsed_seconds']=time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    save()
    try:
        binding=json.loads((root/'sofa-derived-binding-03/proof.json').read_text())
        source=json.loads((root/'sofa-resting-clearance-01/proof.json').read_text())
        hands=json.loads((root/'sofa-hand-support-01/proof.json').read_text())
        old=json.loads((root/'sofa-coherent-arms-02/proof.json').read_text())
        rigs,bodies,furniture,origins=retained.shared.load_scene(root/'sofa-derived-binding-03',binding)
        retained.shared.pose(rigs,origins,'sit',0.)
        current_frames=[{n:np.asarray(v) for n,v in frame.items()} for frame in source['selected_frames']]
        for rig,frames in zip(rigs,current_frames):retained.apply_frames(rig,frames)
        owners=retained.torso.surfaces(bodies)
        reference=np.load(root/'sofa-contact-solver-controls-scene-02/retained-scene.npz')
        for seat,owner in enumerate(owners):
            for name,surface in owner.items():
                assert np.array_equal(np.asarray(surface.points),reference[f'retained/{seat}/{name}/points']),(seat,name,'initial point identity')
                assert np.array_equal(np.asarray(surface.triangles),reference[f'retained/{seat}/{name}/triangles']),(seat,name,'initial topology identity')
        evaluator=SceneEvaluatorV2(root,rigs,bodies,furniture,hands,[{n:surface_data(s) for n,s in owner.items()} for owner in owners])
        domains={}
        for seat,side in ORDER:
            data=next(r['inputs'] for r in old['frames'] if r['seat']==seat and r['side']==side)
            measurement=next(r['measurement'] for r in hands['hands'] if r['seat']==seat and r['side']==side)
            domains[seat,side]=ArmDomain(seat,side,rigs[seat],data,owners[seat],evaluator.classifier,measurement)
        report['domains']=[dict(seat=d.seat,side=d.side,xy_bounds=[d.low.tolist(),d.high.tolist()],exposed_triangles=d.exposed,
                               tilt_radians=d.tilt,yaw_swivel_roll_radians=[-math.pi,math.pi],initial_parameters=d.q.tolist()) for d in domains.values()]
        current=copy.deepcopy(controls['retained_scene_control']);current_arrays={k:v for k,v in reference.items()}
        bad_keys={key(row) for row in current['failures']};costs=[];streak=0;last_hard=None;effective_limit=LIMIT
        def evaluate(domain,solution,update,backtrack):
            nonlocal effective_limit
            if len(report['evaluations'])>=effective_limit or time.monotonic()-began>=WORK_SECONDS:raise TimeoutError('Declared fit budget exhausted')
            start=time.monotonic();arrays={};frames=[dict(f) for f in current_frames]
            frames[domain.seat].update(solution['frames']);error=0.
            report['pending_candidate']=dict(index=len(report['evaluations']),seat=domain.seat,side=domain.side,
                parameters=solution['q'].tolist(),frames=[{n:m.tolist() for n,m in f.items()} for f in frames])
            save()
            for rig,frame in zip(rigs,frames):error=max(error,retained.apply_frames(rig,frame))
            result=evaluator.evaluate(arrays,'candidate',error,began+WORK_SECONDS)
            elapsed=time.monotonic()-start;costs.append(elapsed)
            number=len(report['evaluations']);filename=f'candidate-{number:03d}.npz';np.savez(output/filename,**arrays)
            record=dict(index=number,seat=domain.seat,side=domain.side,parameters=solution['q'].tolist(),
                        elapsed_seconds=elapsed,update=update,backtrack=backtrack,frames=[{n:m.tolist() for n,m in f.items()} for f in frames],
                        blend_diagnostics=solution['blend_minimum_singular_values'],cache=filename,cache_sha256=digest(output/filename),**result)
            report['evaluations'].append(record);report['candidate_evaluations']=len(report['evaluations'])
            report.pop('pending_candidate',None)
            if len(costs)==2:
                reserve=max(costs)*1.1
                effective_limit=min(LIMIT,len(costs)+max(0,int((WORK_SECONDS-(time.monotonic()-began))/reserve)))
                report['changed_scene_cost_calibration']=dict(seconds=costs.copy(),effective_evaluation_limit=effective_limit,planning_seconds_per_candidate=reserve)
            save()
            print(json.dumps(dict(event='candidate',index=number,seat=domain.seat,side=domain.side,seconds=elapsed,
                                  valid=result['valid'],active_residual=merit(result,domain.seat,domain.side),failures=[dict(kind=r['kind'],seat=r.get('seat'),parts=r.get('parts'),part=r.get('part')) for r in result['failures']])),flush=True)
            return record,arrays,frames
        no_progress=0;trust=.125;updates=0
        while len(report['evaluations'])<effective_limit and time.monotonic()-began<WORK_SECONDS:
            if current['valid']:
                report['acceptance']=True;report['state']='phase_zero_survivor';report['selected']=current;break
            remaining=[pair for pair in ORDER if active_rows(current,*pair)]
            if not remaining:report['stop_reason']='Remaining failures cannot be corrected by the declared lap-arm domain';break
            pair=remaining[0] if updates==0 else max(remaining,key=lambda pair:merit(current,*pair))
            domain=domains[pair];rows=active_rows(current,*pair)
            priority=lambda r:(0 if r['parts'][0].startswith('Turned sleeve cuff') and r['parts'][1]=='One sewn breast pocket' else
                               1 if r['parts'][1]=='One sewn breast pocket' else 2 if r['parts'][0].startswith('Turned sleeve cuff') else 3)
            row=min(rows,key=priority)
            owners=retained.torso.surfaces(bodies)
            material,normal,target,predictor=separating_target(owners[domain.seat],row,evaluator.classifier,current_arrays)
            base=domain.construct(domain.q,bounded=False)
            projected=lambda solution:float(np.min(domain.points(solution,material)@normal))
            value=projected(base);gap=max(0.,target-value);gradient=np.zeros(7);derivatives=[]
            for index in range(7):
                step=.01;trial=domain.q.copy();trial[index]+=step
                try:response=domain.construct(trial);gradient[index]=(projected(response)-value)/step;derivatives.append(dict(parameter=index,step=step,value=float(gradient[index])))
                except ValueError:
                    trial=domain.q.copy();trial[index]-=step
                    try:response=domain.construct(trial);gradient[index]=(projected(response)-value)/(-step);derivatives.append(dict(parameter=index,step=-step,value=float(gradient[index])))
                    except ValueError:derivatives.append(dict(parameter=index,unavailable=True))
            norm=float(np.linalg.norm(gradient))
            if norm<1e-10 or gap<=1e-8:report['stop_reason']='Measured limiting region has no useful coupled separating derivative';break
            delta=gradient*(gap+1e-6)/(norm*norm)
            if np.linalg.norm(delta)>trust:delta*=trust/np.linalg.norm(delta)
            update=dict(index=updates,seat=domain.seat,side=domain.side,predictor=predictor,computed_gap=gap,
                        derivatives=derivatives,trust_radius=trust,delta=delta.tolist(),before_residual=merit(current,*pair),trials=[])
            report['updates'].append(update);updates+=1;improved=False
            for backtrack in range(3):
                proposed=domain.bounded(domain.q+delta*(.5**backtrack))
                if np.linalg.norm(proposed-domain.q)<1e-8:continue
                try:solution=domain.construct(proposed)
                except ValueError as error:update['trials'].append(dict(backtrack=backtrack,construction_error=str(error)));continue
                result,arrays,frames=evaluate(domain,solution,update['index'],backtrack)
                new_hard=[r for r in result['failures'] if key(r) not in bad_keys]
                after=merit(result,*pair);meaningful=after<=update['before_residual']*.99
                signature=tuple(sorted(str(key(r)) for r in new_hard))
                if new_hard and signature==last_hard:streak+=1
                elif new_hard:streak=1;last_hard=signature
                else:streak=0;last_hard=None
                update['trials'].append(dict(candidate=result['index'],active_residual=after,new_hard_failures=[key(r) for r in new_hard],meaningful=meaningful))
                if result['valid'] or (not new_hard and meaningful):
                    current,current_arrays,current_frames=result,arrays,frames;domain.q=solution['q'];bad_keys={key(r) for r in current['failures']}
                    improved=True;no_progress=0;trust=min(.25,trust*1.25);update['accepted_as_search_state']=result['index'];save();break
                for rig,frame in zip(rigs,current_frames):retained.apply_frames(rig,frame)
                if streak>=3:report['stop_reason']='Three trials hit the same new hard failure; fresh approach review required';break
            if streak>=3:break
            if not improved:
                no_progress+=1;trust*=.5
                if no_progress>=2:report['stop_reason']='Two adaptive updates failed the 1 percent improvement and no-new-hard-failure rule';break
            save()
        if current['valid']:
            report['state']='phase_zero_survivor';report['acceptance']=True
        elif report['state']=='running':report['state']='bounded_domain_stopped'
        report['selected']=current
        report['selected_frames']=[{n:m.tolist() for n,m in frame.items()} for frame in current_frames]
        report.setdefault('stop_reason','First complete phase-zero survivor' if current['valid'] else 'Declared evaluation or wall budget reached')
        np.savez(output/'selected-geometry.npz',**current_arrays)
        report['selected_geometry_sha256']=digest(output/'selected-geometry.npz')
    except BaseException as error:
        report['state']='budget_exhausted' if isinstance(error,TimeoutError) else 'failed';report['error']=repr(error)
        if 'current' in locals():
            report['selected']=current
            report['selected_frames']=[{n:m.tolist() for n,m in frame.items()} for frame in current_frames]
            np.savez(output/'selected-geometry.npz',**current_arrays)
            report['selected_geometry_sha256']=digest(output/'selected-geometry.npz')
        raise
    finally:
        report['inputs_unchanged']=all(digest(path)==sha for path,sha in inputs.items());save()
        print(json.dumps(dict(event='complete',pid=os.getpid(),state=report['state'],evaluations=report['candidate_evaluations'],inputs_unchanged=report['inputs_unchanged'],elapsed_seconds=report['elapsed_seconds'])),flush=True)

if __name__=='__main__':run(*(Path(p).resolve() for p in sys.argv[sys.argv.index('--')+1:]))
