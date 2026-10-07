"""One original-source control and one frozen coupled static candidate; no fit loop."""
import itertools
import json
import os
from pathlib import Path
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import book_grip_original_replay as base
import book_grip_replay_math as prop_math
import sofa_contact_solver_frames as frames
from sofa_contact_solver_wrists import WristEvaluator
from sofa_contact_solver_evaluator import exposed
from sofa_coupled_contact_evaluator import SourceSurface
from sofa_coupled_contact_evaluator_v2 import component_ids
from sofa_coupled_contact_segments import mapped_segments
from probe_sofa_resting_clearance import apply_frames, verified_hit

MAX_SECONDS=240
CHANGED={'head','book',*(part+'.'+side for side in ('L','R') for part in ('upper_arm','forearm','hand'))}


def data(surface):
    return dict(points=np.asarray(surface.points),triangles=np.asarray(surface.triangles,dtype=np.int32))


def run(prepared,output):
    if not bpy.app.background or not output.is_absolute():raise ValueError('Background Blender and a new absolute output are required')
    output.mkdir(parents=True,exist_ok=False);began=time.monotonic();deadline=began+MAX_SECONDS
    plan=json.loads((prepared/'proof.json').read_text())
    if plan['state']!='prepared':raise ValueError('One frozen prepared proposal is required')
    inputs=dict(plan['inputs'])
    for path in (Path(__file__),prepared/'proof.json',Path(base.__file__),Path(prop_math.__file__)):
        inputs[str(path.resolve())]=base.digest(path)
    for module in tuple(sys.modules.values()):
        path=getattr(module,'__file__',None)
        if path and Path(path).suffix=='.py' and Path(path).is_file() and base.ROOT in Path(path).resolve().parents:
            path=Path(path).resolve();sha=base.digest(path)
            if str(path) in inputs and inputs[str(path)]!=sha:raise ValueError('Frozen dependency changed: '+str(path))
            inputs[str(path)]=sha
    source_sha={sha for path,sha in inputs.items() if Path(path).resolve()==base.SOURCE.resolve()}
    if len(source_sha)!=1 or base.digest(base.SOURCE)!=next(iter(source_sha)):raise ValueError('Original source identity changed')
    report=dict(state='running',pid=os.getpid(),background=True,blender_version=bpy.app.version_string,inputs=inputs,
        opened_original=dict(path=str(base.SOURCE.resolve()),sha256=base.digest(base.SOURCE)),
        limits=dict(seconds=MAX_SECONDS,threads=2,source_controls=1,candidates=1,fit_loop=False),rows=[],
        scope='Static single-actor source-scale acceptance only; furniture, motion, owner visual acceptance and mechanical equilibrium remain separate')
    arrays={}
    def save():
        report['elapsed_seconds']=time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    def budget():
        if time.monotonic()>=deadline:raise TimeoutError('Declared 240-second original-source replay budget exhausted')
    def row(value):
        report['rows'].append(value)
    save()
    try:
        if not all(base.digest(Path(p))==sha for p,sha in inputs.items()):raise ValueError('Input hash mismatch before opening')
        bpy.ops.wm.open_mainfile(filepath=str(base.SOURCE))
        if Path(bpy.data.filepath).resolve()!=base.SOURCE.resolve():raise ValueError('Opened source path mismatch')
        report['opened_original']['blender_reported_path']=bpy.data.filepath
        rig=bpy.data.objects['SIM_01_SHARED_RIG'];objects=base.owned(rig);scene=bpy.context.scene
        scene.render.threads_mode='FIXED';scene.render.threads=2
        rig.animation_data.action=bpy.data.actions['read'];scene.frame_set(4)
        source_state=base.frame_state(rig,objects);raw=base.rest.identity(objects,[rig]);actions=base.action_identity()
        report.update(source_state=source_state,raw_source_identity=raw,source_actions=actions,margin_controls=prop_math.margin_controls())
        source=base.visible(objects);report['source_control_cache']=base.cache_surfaces(output/'source-control.npz',source,rig)
        previous=np.load(HERE/'book-grip-original-replay-01/source-control.npz')
        control=base.compare_surfaces(source,{n:previous[n+'/points'] for n in source},{n:previous[n+'/triangles'] for n in source})
        report['source_evaluated_control']=control
        if any(v['maximum_coordinate_error']>1e-5 or not v['ordered_triangles_equal'] for v in control.values()):raise ValueError('Original saved source control changed')
        guarded=base.rest.RestAudit(objects,[rig])
        try:
            guarded.activate();rest_surfaces=base.visible(objects)
            report['rest_cache']=base.cache_surfaces(output/'rest.npz',rest_surfaces)
        finally:report['rest_restoration']=guarded.restore()
        budget();classifier=WristEvaluator(HERE)
        rest_error={n:float(np.linalg.norm(np.asarray(s.points)-classifier.rest[n+'/rest_points'],axis=1).max()) for n,s in rest_surfaces.items() if n+'/rest_points' in classifier.rest}
        report['classifier_original_rest_correspondence']=rest_error
        if max(rest_error.values())>1e-5:raise ValueError('Classifier rest surfaces do not match the explicit original')
        report['frame_rest_controls']={}
        for side in ('L','R'):
            rest_m={b.name:np.asarray(b.matrix_local) for b in rig.data.bones}
            inp=dict(matrices=dict(spine_pose=rest_m['spine'],spine_rest=rest_m['spine'],upper_rest=rest_m['upper_arm.'+side],forearm_rest=rest_m['forearm.'+side],hand_rest=rest_m['hand.'+side]))
            solved=frames.coupled_frames(inp,rest_m['hand.'+side],0.,0.)
            error=max(float(np.max(np.abs(matrix-rest_m[name+'.'+side]))) for name,matrix in solved['targets'].items())
            report['frame_rest_controls'][side]=error
            if error>1e-5:raise ValueError('Book-specific full-rest frame control failed')
        # Baseline book penetration is a negative control for the same fourteen-
        # part inventory and interior primitive used below, not an accepted pose.
        negative=[]
        for name,surface in source.items():
            if not name.startswith(base.PROP):continue
            center,axes,half,_=prop_math.box(surface)
            for part,other in source.items():
                if not part.startswith(('Relaxed palm','Resting thumb')):continue
                hits=prop_math.triangle_box_hits(np.asarray(other.points)[np.asarray(other.triangles)],center,axes,half)
                if len(hits):negative.append(dict(prop=name,hand=part,triangles=len(hits)));arrays['control/'+name+'/'+part]=hits
        report['source_penetration_negative_control']=negative
        if not negative:raise ValueError('Book penetration negative control was lost')
        save();budget()
        rig.animation_data.action=None
        targets={n:np.asarray(plan['target_frames'][n]) for n in plan['target_frames'] if n in CHANGED}
        frame_error=apply_frames(rig,targets)
        current=base.visible(objects);report['candidate_state']=base.frame_state(rig,objects)
        report['candidate_cache']=base.cache_surfaces(output/'candidate.npz',current,rig)
        groups={n:raw['meshes'][n]['groups'] for n in current}
        head_names={n for n in current if groups[n]==['head']}
        moving={n for n in current if any(g in CHANGED for g in groups[n])}
        book_names=[n for n in current if n.startswith(base.PROP)];body_names=[n for n in current if n not in book_names]
        if len(book_names)!=14 or sum(n.startswith('Printed book line') for n in book_names)!=10:raise ValueError('Fourteen rendered prop parts were not found')
        head_transform=np.asarray(plan['head_transform']);grasp_transform=np.asarray(plan['grasp_transform'])
        canonical=np.load(HERE/'book-grip-original-replay-01/reopened.npz')
        rigid_owners={};report['rigid_correspondence']={}
        for name,surface in current.items():
            budget()
            if name in head_names:
                transform=head_transform;reference=np.asarray(source[name].points);owner='head'
            elif name.startswith(base.PROP+('Relaxed palm','Resting thumb')):
                transform=grasp_transform;reference=canonical[name+'/points'];owner='grasp'
            elif name not in moving:
                transform=np.eye(4);reference=np.asarray(source[name].points);owner='fixed'
            else:continue
            expected=reference@transform[:3,:3].T+transform[:3,3]
            error=float(np.linalg.norm(np.asarray(surface.points)-expected,axis=1).max())
            report['rigid_correspondence'][name]=dict(owner=owner,error=error)
            row(dict(kind='rigid_or_fixed_surface',part=name,valid=error<=1e-5,residual=error))
            if error<=1e-5:rigid_owners[name]=owner
        for name in book_names:
            budget();solid=current[name];center,axes,half,description=prop_math.box(solid)
            report.setdefault('prop_solids',{})[name]=description
            for part in body_names:
                surface=current[part];points=np.asarray(surface.points)
                hit=prop_math.triangle_box_hits(points[np.asarray(surface.triangles)],center,axes,half)
                if len(hit):
                    key='prop/'+name+'/'+part;arrays[key]=hit
                    row(dict(kind='prop_body',parts=[name,part],valid=False,residual=len(hit),witness_array=key))
                elif np.all(np.min(solid.points,axis=0)>=points.min(0)-1e-6) and np.all(np.max(solid.points,axis=0)<=points.max(0)+1e-6):
                    # Use the verified connected-component containment primitive
                    # when the broad bounds alone cannot dismiss enclosure.
                    hit=verified_hit(arrays,'containment/'+name+'/'+part,solid,surface)
                    if hit:row(dict(kind='prop_body_containment',parts=[name,part],valid=False,residual=1,evidence=hit))
        for name in body_names:
            if name not in moving or (name in rigid_owners and rigid_owners[name] in ('head','grasp')):continue
            budget();surface=current[name]
            pairs=[(a,b) for a,b in surface.tree.overlap(surface.tree) if a<b and not set(surface.triangles[a])&set(surface.triangles[b])]
            arrays['fold/'+name]=np.asarray(pairs,dtype=np.int32).reshape((-1,2))
            row(dict(kind='actual_blend_folds',part=name,valid=not pairs,residual=len(pairs)))
        # Complete discovery includes the moved head, blended neck, both arms,
        # all clothes and fixed lower body. Source subassemblies pass only after
        # their complete point correspondence above, never merely by pair name.
        for first,second in itertools.combinations(body_names,2):
            budget()
            if first not in moving and second not in moving:continue
            a,b=current[first],current[second]
            hit=verified_hit(arrays,'own/'+first+'/'+second,a,b)
            if not hit:continue
            same=rigid_owners.get(first)==rigid_owners.get(second) and rigid_owners.get(first) in ('head','grasp')
            if same:
                old=verified_hit(arrays,'control-own/'+first+'/'+second,source[first],source[second])
                row(dict(kind='source_subassembly',parts=[first,second],valid=old is not None,residual=0 if old else 1,
                    evidence=hit,source_evidence=old,reason='Both complete surfaces have verified identical common rigid motion from the original source'))
                continue
            if hit['kind']!='surface':
                row(dict(kind='body_containment',parts=[first,second],valid=False,residual=1,evidence=hit));continue
            pairs=arrays[hit['witness_array']]
            if first.startswith(base.ARM) or second.startswith(base.ARM):
                def order(name):return next((i for i,p in enumerate(('Forearm with elbow','Relaxed shirt sleeve','Turned sleeve cuff','Relaxed palm','Resting thumb')) if name.startswith(p)),9)
                if order(second)<order(first):first,second=second,first;a,b=b,a;pairs=pairs[:,::-1]
                row(classifier.contact(0,first,second,data(a),data(b),pairs,arrays,'classified/'+first+'/'+second))
            elif set((first,second))=={'Natural neck','Sculpted head'}:
                mapped,unresolved=mapped_segments(data(a),data(b),pairs,classifier.rest[first+'/rest_points'],classifier.rest[second+'/rest_points'],classifier.primitives)
                world=np.asarray([v[2] for v in mapped]);components=component_ids(world) if len(world) else []
                source_solids={n:SourceSurface(classifier.rest[n+'/rest_points'],classifier.rest[n+'/triangles']) for n in (first,second)}
                valid_regions=[]
                for v in mapped:
                    budget();valid_regions.append(source_solids[second].contains_segment(v[3])[0] and source_solids[first].contains_segment(v[4])[0])
                key='neck/'+first+'/'+second;arrays[key+'/world_segments']=world
                arrays[key+'/source_segments']=np.asarray([[v[3],v[4]] for v in mapped]);arrays[key+'/pairs']=pairs
                closed=len(components)==1 and components[0]['closed']
                valid=bool(mapped) and all(valid_regions) and not unresolved and closed
                row(dict(kind='source_neck_attachment',parts=[first,second],valid=valid,residual=sum(not v for v in valid_regions)+len(unresolved)+(not closed),
                    source_overlap_valid=valid_regions,components=components,unresolved=unresolved,witness=key))
            else:
                row(dict(kind='head_or_body_exterior',parts=[first,second],valid=False,residual=hit.get('triangle_pairs',1),evidence=hit))
        for side,suffix in (('L',''),('R','.001')):
            budget();book='Reading book cover'+suffix;palm='Relaxed palm'+suffix
            p=np.asarray(current[book].points);tri=p[np.asarray(current[book].triangles)];normals=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);normals/=np.linalg.norm(normals,axis=1)[:,None]
            mean_up=np.asarray(rig.matrix_world@rig.pose.bones['book'].matrix)[:3,1];up=-normals[np.argmin(normals@mean_up)]
            obstacles={n:data(s) for n,s in current.items() if n not in (book,palm)}
            result=exposed(data(current[book]),data(current[palm]),up,.0015,obstacles,arrays,'contact/'+side)
            row(dict(side=side,**result))
        eyes=np.mean([np.asarray(current['Eye white'+suffix].points).mean(0) for suffix in ('','.001')],0)
        actual_normals=[];predicted=np.asarray(plan['proposal']['gaze'])
        for suffix in ('','.001'):
            _,basis=np.linalg.eigh(np.cov(np.asarray(current['Dark pupil'+suffix].points).T));n=basis[:,0]
            actual_normals.append(n if n@predicted>0 else -n)
        gaze=np.mean(actual_normals,0);gaze/=np.linalg.norm(gaze)
        target=np.asarray(current['Reading book pages'].points).mean(0);direction=target-eyes
        angular=float(np.degrees(np.arccos(np.clip(gaze@direction/np.linalg.norm(direction),-1,1))))
        hit=current['Reading book pages'].tree.ray_cast(Vector(eyes),Vector(gaze),2.)
        page_up=np.asarray(rig.matrix_world@rig.pose.bones['book'].matrix)[:3,1];page_up/=np.linalg.norm(page_up)
        valid=hit[0] is not None and gaze@direction>0 and page_up[1]>=-1e-6 and page_up[2]>0 and page_up@(eyes-target)>0 and angular<.001
        row(dict(kind='reading_gaze_proxy',valid=bool(valid),residual=angular,angular_error_degrees=angular,eye_midpoint=eyes.tolist(),gaze=gaze.tolist(),page_normal=page_up.tolist(),
            page_hit=list(hit[0]) if hit[0] is not None else None,meaning='Finite front-facing page hit by measured binocular surface-normal proxy; actual visible gaze still requires images'))
        length=max(abs((b.tail-b.head).length-rig.data.bones[b.name].length) for b in rig.pose.bones)
        scale=max(abs(v-1) for b in rig.pose.bones for v in b.scale)
        join=max((rig.pose.bones[a+'.'+s].tail-rig.pose.bones[b+'.'+s].head).length for s in ('L','R') for a,b in (('upper_arm','forearm'),('forearm','hand')))
        row(dict(kind='joints',valid=max(length,scale,join,frame_error)<=1e-5,residual=max(length,scale,join,frame_error),length=length,scale=scale,join=join,frame_error=frame_error))
        raw_equal=base.rest.identity(objects,[rig])==raw;actions_equal=base.action_identity()==actions
        row(dict(kind='source_identity',valid=raw_equal and actions_equal,residual=0 if raw_equal and actions_equal else 1,raw=raw_equal,actions=actions_equal))
        report['coverage']=dict(actual_blends=True,full_body_contacts=True,all_fourteen_props=True,finite_exposed_support=True,gaze_and_page=True,joints_and_identity=True,
            furniture='Not part of static single-actor scope',animation='Not authored',visual_acceptance='Pending diagnostics')
        np.savez(output/'witnesses.npz',**arrays);report['witness_sha256']=base.digest(output/'witnesses.npz')
        report['failures']=[r for r in report['rows'] if not r['valid']];report['geometry_survivor']=not report['failures']
        save();budget()
        if report['geometry_survivor']:
            derivative=output/'alt2-static.blend';bpy.ops.wm.save_as_mainfile(filepath=str(derivative))
            report['derivative']=dict(path=derivative.name,sha256=base.digest(derivative));bpy.ops.wm.open_mainfile(filepath=str(derivative))
            rig=bpy.data.objects['SIM_01_SHARED_RIG'];reopened=base.visible(base.owned(rig))
            report['reopened_correspondence']=base.compare_surfaces(reopened,{n:np.asarray(s.points) for n,s in current.items()},{n:s.triangles for n,s in current.items()})
            if any(v['maximum_coordinate_error']>1e-5 or not v['ordered_triangles_equal'] for v in report['reopened_correspondence'].values()):raise ValueError('Saved coupled candidate did not reproduce')
            reopened_objects=base.owned(rig)
            report['reopened_state']=base.frame_state(rig,reopened_objects)
            report['reopened_cache']=base.cache_surfaces(output/'reopened.npz',reopened,rig)
            report['reopened_raw_identity_unchanged']=base.rest.identity(reopened_objects,[rig])==raw
            report['reopened_actions_unchanged']=base.action_identity()==actions
            if not report['reopened_raw_identity_unchanged'] or not report['reopened_actions_unchanged']:
                raise ValueError('Saved coupled candidate changed original rest identity or action data')
        budget()
        report['state']='complete';report['acceptance']='Actual geometry survivor pending visual judgment' if report['geometry_survivor'] else 'Rejected static candidate; no subsequent candidate attempted'
    except BaseException as error:
        report.update(state='budget_exhausted' if isinstance(error,TimeoutError) else 'failed',error=repr(error));raise
    finally:
        if arrays:
            np.savez(output/'witnesses.npz',**arrays);report['witness_sha256']=base.digest(output/'witnesses.npz')
        report['inputs_unchanged']=all(base.digest(Path(p))==sha for p,sha in inputs.items())
        if not report['inputs_unchanged']:
            report.update(state='failed',geometry_survivor=False,error='An immutable replay input changed')
        save()
        if not report['inputs_unchanged']:raise ValueError('An immutable replay input changed')


if __name__=='__main__':run(*(Path(p) for p in sys.argv[sys.argv.index('--')+1:]))
