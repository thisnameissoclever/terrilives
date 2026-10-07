"""Verify a cached reading contact contract against all four saved source phases."""
import json
import os
from pathlib import Path
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).parent))
import book_grip_construct as construction
import coherent_sofa_arm_frames_v2 as coherent
import compare_original_read_grip as original
import continuous_support_patch as continuous
import sofa_rest_initialization as rest

ARM = ('Relaxed shirt sleeve', 'Turned sleeve cuff', 'Forearm with elbow and wrist sections', 'Relaxed palm', 'Resting thumb')


def run(source, contract_dir, output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Background Blender and an absolute new output directory are required')
    output.mkdir(parents=True, exist_ok=False)
    contract = json.loads((contract_dir/'contract.json').read_text())
    inputs = dict(contract['inputs'])
    for path in tuple(inputs):
        if Path(path).name == 'proof.json':
            inputs.update(json.loads(Path(path).read_text()).get('inputs', {}))
    for p in (source, contract_dir/'contract.json', contract_dir/'geometry.npz', Path(__file__), Path(coherent.__file__), Path(coherent.geometry.__file__), Path(original.__file__), Path(continuous.__file__), Path(rest.__file__)):
        inputs[str(p.resolve())] = construction.digest(p)
    report = dict(state='running', pid=os.getpid(), background=True, threads=bpy.context.scene.render.threads,
                  inputs=inputs, blender_version=bpy.app.version_string, cases=[], started=time.time())
    def save():
        (output/'proof.json').write_text(json.dumps(report, indent=2)+'\n',encoding='utf-8')
    save()
    try:
        if not all(construction.digest(Path(p))==sha for p,sha in inputs.items()):
            raise ValueError('A source input changed before verification')
        bpy.ops.wm.open_mainfile(filepath=str(source))
        rig = bpy.data.objects['SIM_01_SHARED_RIG']
        objects = [obj for obj in bpy.data.objects if obj.type=='MESH' and any(mod.type=='ARMATURE' and mod.object==rig for mod in obj.modifiers)]
        initial_identity = rest.identity(objects, [rig])
        action = bpy.data.actions['read']
        report['bone_names'] = [bone.name for bone in rig.pose.bones]
        report['rest_frames'] = {bone.name:[list(row) for row in bone.matrix_local] for bone in rig.data.bones}
        def capture(kind, phase, records=None):
            row = dict(kind=kind,phase=phase,arm_frames=records,internal=[],self_contacts=[])
            report['cases'].append(row)
            save()
            arrays = {}
            reading = original.objects_for(rig)
            row['hand_book'] = original.measure(reading,rig,arrays)
            deps = bpy.context.evaluated_depsgraph_get()
            surfaces = {obj.name:original.witness.Surface(obj,deps) for obj in objects if not obj.hide_render and not obj.hide_viewport}
            for name,surface in surfaces.items():
                arrays[name+'/world_points'] = np.asarray(surface.points)
                arrays[name+'/triangles'] = np.asarray(surface.triangles,dtype=np.int32)
                if not name.startswith(ARM):
                    continue
                pairs = [(a,b) for a,b in surface.tree.overlap(surface.tree) if a<b and not set(surface.triangles[a])&set(surface.triangles[b])]
                arrays['internal/'+name] = np.asarray(pairs,dtype=np.int32).reshape((-1,2))
                row['internal'].append(dict(part=name,pairs=len(pairs)))
                for other_name,other in surfaces.items():
                    if other_name==name or (other_name.startswith(ARM) and other_name<name):
                        continue
                    hits = surface.tree.overlap(other.tree)
                    if hits:
                        key='self/'+name+'/'+other_name
                        arrays[key]=np.asarray(hits,dtype=np.int32)
                        row['self_contacts'].append(dict(parts=[name,other_name],pairs=len(hits),witness_array=key))
            row['contacts']={}
            book_world=np.asarray(rig.matrix_world@rig.pose.bones['book'].matrix,dtype=np.float64)
            for side,suffix in (('L',''),('R','.001')):
                palm=surfaces['Relaxed palm'+suffix];cover=surfaces['Reading book cover'+suffix]
                up=book_world[:3,:3]@np.asarray(contract['hands'][side]['support_normal'])
                result=continuous.measure(cover.points,cover.triangles,palm.points,palm.triangles,up,.0015)
                row['contacts'][side]={}
                for key,value in result.items():
                    if isinstance(value,np.ndarray): arrays['contact/'+side+'/'+key]=value
                    else: row['contacts'][side][key]=value
            row['bones']=dict(maximum_length_error=max(abs((b.tail-b.head).length-rig.data.bones[b.name].length) for b in rig.pose.bones),
                maximum_scale_error=max(abs(v-1) for b in rig.pose.bones for v in b.scale),
                wrist_join_error={s:(rig.pose.bones['forearm.'+s].tail-rig.pose.bones['hand.'+s].head).length for s in ('L','R')},
                elbow_join_error={s:(rig.pose.bones['upper_arm.'+s].tail-rig.pose.bones['forearm.'+s].head).length for s in ('L','R')})
            arrays['bone_matrices']=np.asarray([list(b.matrix) for b in rig.pose.bones])
            arrays['rig_matrix_world']=np.asarray(rig.matrix_world)
            filename=f'case-{len(report["cases"])-1:02d}.npz'
            np.savez(output/filename,**arrays)
            row['cache']=dict(path=filename,sha256=construction.digest(output/filename))
            save()
        for phase,frame in zip((0.,.25,.5,.75),(1,2,3,4)):
            rig.animation_data.action=action
            bpy.context.scene.frame_set(frame)
            capture('source',phase)
            rig.animation_data.action=None
            records=[]
            for side in ('L','R'):
                rig.pose.bones['hand.'+side].matrix=rig.pose.bones['book'].matrix@Matrix(contract['hands'][side]['book_relative_frame'])
                bpy.context.view_layer.update()
                records.append(coherent.solve(rig,side))
            capture('candidate',phase,records)
        report['raw_identity_unchanged']=rest.identity(objects,[rig])==initial_identity
        if not report['raw_identity_unchanged']: raise ValueError('Raw geometry, weights, materials or rest skeleton changed')
        bpy.ops.wm.save_as_mainfile(filepath=str(output/'canonical-reading.blend'))
        report['saved_blend_sha256']=construction.digest(output/'canonical-reading.blend')
        report['input_hashes_unchanged']=all(construction.digest(Path(p))==sha for p,sha in inputs.items())
        if not report['input_hashes_unchanged']: raise ValueError('Verification input changed')
        report['state']='complete'
        report['acceptance']='Geometry results require classification; owner and furniture integration acceptance pending'
    except BaseException as error:
        report.update(state='failed',error=repr(error))
        raise
    finally:
        report['elapsed_seconds']=time.time()-report['started']
        save()


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:]
    run(*(Path(p) for p in args))
