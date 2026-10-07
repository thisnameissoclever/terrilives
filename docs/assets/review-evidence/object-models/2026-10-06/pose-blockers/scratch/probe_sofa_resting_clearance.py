"""Test the measured lap adjustment with a bounded, body-constrained elbow arc."""
import copy
import json
import math
import os
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).parent))
import probe_sofa_hand_support as shared
import continuous_support_patch as contact
import derive_lap_support_adjustment as adjustment
import sofa_resting_clearance_frames as arc

torso, probe, witness = shared.torso, shared.probe, shared.witness
LAP = ((0, 'L'), (1, 'L'), (1, 'R'), (2, 'R'))
BODY = ('Overshirt body', 'Shirt lower hem', 'Trouser hip bridge', 'Shirt placket',
        'Small horn button', 'Small horn button.001')
DISTAL = ('Forearm with elbow and wrist sections', 'Turned sleeve cuff', 'Relaxed palm', 'Resting thumb')


def apply_frames(rig, frames):
    for name, matrix in frames.items():
        rig.pose.bones[name].matrix = Matrix(np.asarray(matrix).tolist())
        bpy.context.view_layer.update()
    residual = max(float(np.abs(np.asarray(rig.pose.bones[name].matrix)-matrix).max()) for name, matrix in frames.items())
    if residual > 1e-5:
        raise ValueError(f'Full frame replay exceeded the existing bound: {residual}')
    return residual


def sample(objects, names):
    deps = bpy.context.evaluated_depsgraph_get()
    return {name: witness.Surface(objects[name], deps) for name in names}


def store_patch(arrays, prefix, result):
    for key, value in result.items():
        if isinstance(value, np.ndarray):
            arrays[prefix+'/'+key] = value
    return {key: value for key, value in result.items() if not isinstance(value, np.ndarray)}


def verified_hit(arrays,key,first,second):
    if any(first.bounds[1][i]<second.bounds[0][i] or second.bounds[1][i]<first.bounds[0][i] for i in range(3)):
        return None
    pairs=first.tree.overlap(second.tree)
    if pairs:
        arrays[key]=np.asarray(pairs,dtype=np.int32)
        return dict(kind='surface',triangle_pairs=len(pairs),witness_array=key)
    # With no surface crossing, one vertex per connected source component
    # decides containment in a closed oriented target. Open sheets define no solid.
    for label,source,target in (('first_inside_second',first,second),('second_inside_first',second,first)):
        closed=all(target.topology[k]==0 for k in ('boundary_edges','nonmanifold_edges','inconsistent_edges'))
        if not closed:
            continue
        for index in arc.component_vertices(source.triangles):
            value=arc.winding(source.points[index],target.points,target.triangles)
            if abs(value)>.5:
                nearest=target.tree.find_nearest(source.points[index])
                if nearest[3]>1e-6:
                    return dict(kind=label,vertex=index,point=list(source.points[index]),winding=value,
                                distance=nearest[3],target_triangle=nearest[2],
                                classification='Closed oriented target, disjoint surfaces and connected-component solid-angle containment')
    return None


def evaluate_arm(rig, objects, solids, data, side, fraction, arrays, prefix):
    solution = arc.solve(data, np.asarray(rig.matrix_world), fraction)
    target = {name+'.'+side: value for name, value in solution['targets'].items()}
    residual = apply_frames(rig, target)
    suffix = '.001' if side == 'R' else ''
    owner = sample(objects, [name+suffix for name in shared.ARM_PARTS] + list(BODY))
    hits, internal = [], []
    for name, surface in owner.items():
        shared.cache_surface(arrays, prefix+'/'+name, surface)
        if not name.startswith(shared.ARM_PARTS):
            continue
        folds = [(a,b) for a,b in surface.tree.overlap(surface.tree)
                 if a < b and not set(surface.triangles[a]) & set(surface.triangles[b])]
        arrays[prefix+'/internal/'+name] = np.asarray(folds, dtype=np.int32).reshape((-1,2))
        if folds:
            internal.append(dict(part=name, count=len(folds)))
        for part, solid in solids.items():
            value = verified_hit(arrays, prefix+'/furniture/'+name+'/'+part, surface, solid)
            if value:
                hits.append(dict(parts=[name,part], evidence=value))
        if name.startswith(DISTAL):
            for part in BODY:
                value = verified_hit(arrays, prefix+'/body/'+name+'/'+part, surface, owner[part])
                if value:
                    hits.append(dict(parts=[name,part], evidence=value))
    return dict(fraction=fraction, frame_residual=residual, elbow=solution['elbow'].tolist(),
                wrist=solution['wrist'].tolist(), shoulder=solution['shoulder'].tolist(),
                circle_radius=solution['circle_radius'], arc_angle=solution['arc_angle'],
                wrist_rest_relative_degrees=solution['wrist_rest_relative_degrees'],
                frames={name:value.tolist() for name,value in target.items()}, hits=hits, internal=internal,
                clear=not hits and not internal, cache_prefix=prefix)


def run(root, output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use background Blender and a new absolute output path')
    output.mkdir(parents=True, exist_ok=False)
    binding_dir, arm_dir = root/'sofa-derived-binding-03', root/'sofa-coherent-arms-02'
    hand_dir, shift_dir = root/'sofa-hand-support-01', root/'sofa-lap-support-adjustment-01'
    binding = json.loads((binding_dir/'proof.json').read_text())
    old = json.loads((arm_dir/'proof.json').read_text())
    hands = json.loads((hand_dir/'proof.json').read_text())
    shifts = json.loads((shift_dir/'proof.json').read_text())
    inputs = dict(old['inputs'])
    for file in (Path(__file__), Path(arc.__file__), Path(adjustment.__file__), Path(contact.__file__),
                 arm_dir/'proof.json', arm_dir/'geometry.npz', shift_dir/'proof.json', shift_dir/'witnesses.npz'):
        inputs[str(file.resolve())] = probe.digest(file)
    if any(probe.digest(Path(path)) != sha for path,sha in inputs.items()):
        raise ValueError('A verified candidate input changed')
    report = dict(state='running', pid=os.getpid(), inputs=inputs, background=True,
        blender_version=bpy.app.version_string, arms=[], phases=[], neighbors=[],
        scope='Third complete resting-arm approach: measured lap translation, source-defined elbow arc, four sitting phases and provisional old-reading neighbors; no render',
        construction=dict(hand_targets='Four prior measured tangent translations; exact continuous normal refit',
            outer_arms='Both passing armrest arms retain exact recorded full frames',
            elbow='Minimum wrist swing to forwardmost circle endpoint; at most 10 boundary bisections then 1 mm arc-length margin',
            attachment='All arm self-contact pairs retained for source-region classification; none exempted',
            phase_policy='Stationary supported arm frames; original four-phase head motion retained'),
        incomplete=['Canonical reading grip is being repaired separately', 'Source-region attachment classification and owner visuals remain required'])
    def save():
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n')
    save()
    try:
        rigs,bodies,furniture,origins = shared.load_scene(binding_dir,binding)
        cache = np.load(arm_dir/'geometry.npz')
        objects = [{obj.get('probe_source_name',obj.name):obj for obj in body.all_objects if obj.type=='MESH'} for body in bodies]
        shared.pose(rigs,origins,'sit',0.)
        for seat,rig in enumerate(rigs):
            apply_frames(rig,{name:matrix for name,matrix in zip(hands['bone_names'],cache[f'{seat}/bone_matrices'])})
        deps=bpy.context.evaluated_depsgraph_get()
        solids={obj.name:witness.Surface(obj,deps) for obj in furniture.all_objects if obj.type=='MESH'}
        selection_arrays={}
        for seat,side in LAP:
            suffix='.001' if side=='R' else ''
            row=dict(seat=seat,side=side,tests=[])
            report['arms'].append(row)
            data=copy.deepcopy(next(r for r in old['frames'] if r['seat']==seat and r['side']==side)['inputs'])
            shift=next(r for r in shifts['cases'] if r['seat']==seat and r['side']==side)
            world_shift=np.asarray(shift['world_shift'])
            matrix=np.asarray(data['matrices']['hand_pose'])
            matrix[:3,3] += np.linalg.inv(np.asarray(rigs[seat].matrix_world))[:3,:3] @ world_shift
            data['matrices']['hand_pose']=matrix.tolist()
            apply_frames(rigs[seat],{'hand.'+side:matrix})
            palm_name,support_name='Relaxed palm'+suffix,'Tailored trouser leg'+suffix
            current=sample(objects[seat],[palm_name,support_name])
            basis=cache[f'contact/{seat}/{side}/basis']
            gap=adjustment.minimum_gap(current[palm_name].points,current[palm_name].triangles,
                current[support_name].points,current[support_name].triangles,basis)
            normal_refit=shift['source_gap']['minimum']-gap['minimum']
            matrix[:3,3] += np.linalg.inv(np.asarray(rigs[seat].matrix_world))[:3,:3] @ (basis[:,2]*normal_refit)
            data['matrices']['hand_pose']=matrix.tolist()
            row.update(inputs=data,measured_world_shift=world_shift.tolist(),normal_refit=normal_refit,
                       preserved_minimum_gap=shift['source_gap']['minimum'])
            def test(fraction):
                result=evaluate_arm(rigs[seat],objects[seat],solids,data,side,fraction,selection_arrays,
                                    f'{seat}/{side}/test{len(row["tests"])}')
                row['tests'].append(result)
                save()
                return result
            low,high=test(0.),test(1.)
            if low['clear']:
                chosen=low
            elif not high['clear']:
                chosen=high
                row['construction_failed']='Forwardmost reachable elbow is not clear; no alternative target or arc is attempted'
            else:
                for _ in range(10):
                    middle=test((low['fraction']+high['fraction'])/2)
                    if middle['clear']:
                        high=middle
                    else:
                        low=middle
                margin=min(1.,high['fraction']+.001/(high['circle_radius']*high['arc_angle']))
                chosen=test(margin)
                row['boundary_bracket']=[low['fraction'],high['fraction']]
                row['margin_arc_length']=.001
                if not chosen['clear']:
                    row['construction_failed']='Positive arc margin failed; candidate retained without retuning'
            apply_frames(rigs[seat],{name:np.asarray(value) for name,value in chosen['frames'].items()})
            row['selected']=chosen
            save()
        np.savez(output/'selection.npz',**selection_arrays)
        report['selection_cache']=dict(path='selection.npz',sha256=probe.digest(output/'selection.npz'))
        arm_frames=[{name:np.asarray(rig.pose.bones[name].matrix) for name in torso.BONES if name.startswith(('upper_arm.','forearm.','hand.'))} for rig in rigs]
        report['outer_frame_residuals']={}
        for seat,side in ((0,'R'),(2,'L')):
            for part in ('upper_arm','forearm','hand'):
                name=part+'.'+side
                index=hands['bone_names'].index(name)
                report['outer_frame_residuals'][f'{seat}/{name}']=float(np.abs(arm_frames[seat][name]-cache[f'{seat}/bone_matrices'][index]).max())
        report['selected_frames']=[{name:matrix.tolist() for name,matrix in frames.items()} for frames in arm_frames]
        report['bone_names']=hands['bone_names']
        for phase in torso.PHASES:
            shared.pose(rigs,origins,'sit',phase)
            for rig,frames in zip(rigs,arm_frames):
                apply_frames(rig,frames)
            owners=torso.surfaces(bodies)
            arrays={}
            row=dict(phase=phase,furniture=[],self_contacts=[],internal=[],support=[],bones=[])
            for part,solid in solids.items():
                shared.cache_surface(arrays,'furniture/'+part,solid)
            for seat,owner in enumerate(owners):
                arrays[f'{seat}/bone_matrices']=np.asarray([list(b.matrix) for b in rigs[seat].pose.bones])
                arrays[f'{seat}/rig_matrix_world']=np.asarray(rigs[seat].matrix_world)
                for name,surface in owner.items():
                    shared.cache_surface(arrays,f'{seat}/{name}',surface)
                    for part,solid in solids.items():
                        hit=verified_hit(arrays,f'furniture/{seat}/{name}/{part}',surface,solid)
                        if hit:
                            row['furniture'].append(dict(seat=seat,parts=[name,part],evidence=hit))
                    if not name.startswith(shared.ARM_PARTS):
                        continue
                    internal=[(a,b) for a,b in surface.tree.overlap(surface.tree) if a<b and not set(surface.triangles[a])&set(surface.triangles[b])]
                    arrays[f'internal/{seat}/{name}']=np.asarray(internal,dtype=np.int32).reshape((-1,2))
                    row['internal'].append(dict(seat=seat,part=name,pairs=len(internal)))
                    for part,other in owner.items():
                        if part==name or (part.startswith(shared.ARM_PARTS) and part<name):
                            continue
                        hits=surface.tree.overlap(other.tree)
                        if hits:
                            key=f'self/{seat}/{name}/{part}'
                            arrays[key]=np.asarray(hits,dtype=np.int32)
                            row['self_contacts'].append(dict(seat=seat,parts=[name,part],pairs=len(hits),witness_array=key))
                for side in ('L','R'):
                    measurement=next(h['measurement'] for h in hands['hands'] if h['seat']==seat and h['side']==side)
                    palm=owner['Relaxed palm'+('.001' if side=='R' else '')]
                    support=solids[measurement['support']] if measurement['support'].startswith('Arm ') else owner[measurement['support']]
                    patch=contact.measure(palm.points,palm.triangles,support.points,support.triangles,measurement['support_normal'],measurement['near_gap'])
                    row['support'].append(dict(seat=seat,side=side,target=measurement['support'],**store_patch(arrays,f'contact/{seat}/{side}',patch)))
                rig=rigs[seat]
                row['bones'].append(dict(seat=seat,maximum_length_error=max(abs((b.tail-b.head).length-rig.data.bones[b.name].length) for b in rig.pose.bones),
                    maximum_scale_error=max(abs(v-1) for b in rig.pose.bones for v in b.scale),
                    joins={side:{part:(rig.pose.bones[part+'.'+side].tail-rig.pose.bones[next_part+'.'+side].head).length
                        for part,next_part in (('upper_arm','forearm'),('forearm','hand'))} for side in ('L','R')}))
            row['hip_support']=[torso.depth.regions.support(owner['Trouser hip bridge'].points,bpy.data.objects[f'Seat cushion {seat}'],bpy.context.evaluated_depsgraph_get()) for seat,owner in enumerate(owners)]
            # Cache the old read assembly solely as provisional neighbor context.
            shared.pose(rigs,origins,'read',phase)
            reading=torso.surfaces(bodies)
            for seat,owner in enumerate(reading):
                for name,surface in owner.items():
                    shared.cache_surface(arrays,f'old_read/{seat}/{name}',surface)
            for left in range(3):
                for right in range(left+1,3):
                    for a,b in (('sit','sit'),('sit','read'),('read','sit')):
                        first=(owners if a=='sit' else reading)[left]
                        second=(owners if b=='sit' else reading)[right]
                        failures=[]
                        for name,surface in first.items():
                            for part,other in second.items():
                                hit=verified_hit(arrays,f'neighbor/{left}/{right}/{a}/{b}/{name}/{part}',surface,other)
                                if hit:
                                    failures.append(dict(parts=[name,part],evidence=hit))
                        row.setdefault('neighbors',[]).append(dict(seats=[left,right],actions=[a,b],failures=failures,provisional='read' in (a,b)))
            filename=f'phase-{len(report["phases"]):02d}.npz'
            np.savez(output/filename,**arrays)
            row['cache']=dict(path=filename,sha256=probe.digest(output/filename))
            report['phases'].append(row)
            save()
        if any(probe.digest(Path(path))!=sha for path,sha in inputs.items()):
            raise ValueError('A constrained resting-pose input changed')
        report['state']='complete'
        report['acceptance']='Measured third candidate; no visual acceptance; every remaining collision/attachment classification is explicit'
    except BaseException as error:
        report['state']='failed'
        report['error']=repr(error)
        raise
    finally:
        save()


if __name__=='__main__':
    run(*(Path(value) for value in sys.argv[sys.argv.index('--')+1:]))
