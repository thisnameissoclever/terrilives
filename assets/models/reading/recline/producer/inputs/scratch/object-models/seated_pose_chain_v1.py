"""Author one complete mixed sofa key pose and inspect it before further fitting."""
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_grip_original_replay as source
import probe_sofa_resting_clearance as retained
from sofa_contact_solver_frames import rotation
from sofa_arm_frame_math import rotation_between, proper_rotation
from seated_pose_chain_math_v1 import solve_upper
from seated_pose_chain_geometry_v1 import Containment, finite_grasp


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def affine(rot, translation):
    result = np.eye(4)
    result[:3, :3], result[:3, 3] = rot, translation
    return result


def run(manifest_path, output):
    if not bpy.app.background or output.exists() or not output.is_absolute():
        raise ValueError('Require background Blender and a new absolute output directory')
    manifest = json.loads(manifest_path.read_text())
    inputs = dict(manifest['inputs'])
    inputs[str(manifest_path)] = digest(manifest_path)
    if any(digest(p)!=s for p,s in inputs.items()):
        raise ValueError('Frozen input changed')
    output.mkdir(parents=True, exist_ok=False)
    began = time.monotonic()
    report = dict(state='running', pid=os.getpid(), inputs=inputs, acceptance=False,
                  blender_version=bpy.app.version_string, renders=[], failures=[],
                  scope='One complete-chain comparison; only two reader upper-arm frames change; all failures retained')

    def save():
        report['elapsed_seconds'] = time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(report, indent=2)+'\n')

    def budget():
        if time.monotonic()-began > 240:
            raise TimeoutError('Single-proposal diagnostic ceiling exhausted')

    try:
        binding = json.loads((HERE/'sofa-derived-binding-03/proof.json').read_text())
        rigs, bodies, furniture, origins = retained.shared.load_scene(HERE/'sofa-derived-binding-03', binding)
        retained.shared.pose(rigs, origins, 'sit', 0.)
        all_objects = [obj for body in bodies for obj in body.all_objects if obj.type=='MESH']
        original_identity = source.rest.identity(all_objects, rigs)
        scene = bpy.context.scene
        source_registration = dict(canvas=[scene.render.resolution_x//8, scene.render.resolution_y//8],
                                   ortho_scale=scene.camera.data.ortho_scale, source_density=8)
        density = max(source_registration['canvas'])/source_registration['ortho_scale']
        old = np.load(HERE/'sofa-contact-solver-patch-replay-01/scene-00.npz')
        bone_names = json.loads((HERE/'sofa-hand-support-01/proof.json').read_text())['bone_names']
        rest_cache = np.load(HERE/'book-grip-alt2-replay-01/rest.npz')
        proposal = manifest['proposal']
        prior=json.loads((HERE/'seated-pose-mixed-02/raw/proof.json').read_text())
        baseline=np.load(HERE/'seated-pose-mixed-02/raw/authored-geometry.npz')
        for seat,rig in enumerate(rigs):
            state=prior['full_states'][seat]
            rig.matrix_world=Matrix(state['rig_matrix_world'])
            retained.apply_frames(rig,{n:np.asarray(m) for n,m in state['bone_matrices'].items()})
            for key,value in state['properties'].items():
                rig[key]=value
            rig.update_tag(refresh={'OBJECT','DATA'})
        bpy.context.view_layer.update()
        initial=retained.torso.surfaces(bodies)
        report['baseline_geometry_replay']=[]
        for seat,owner in enumerate(initial):
            errors={}
            for name,surface in owner.items():
                error=float(np.linalg.norm(np.asarray(surface.points)-baseline[f'{seat}/{name}/points'],axis=1).max())
                equal=bool(np.array_equal(surface.triangles,baseline[f'{seat}/{name}/triangles']))
                errors[name]=dict(maximum_error=error,ordered_triangles_equal=equal)
                if error>1e-5 or not equal:
                    raise ValueError('Mixed02 exact source replay failed: '+str(seat)+'/'+name)
            report['baseline_geometry_replay'].append(errors)
        rig=rigs[1]
        rest={bone.name:np.asarray(bone.matrix_local).copy() for bone in rig.data.bones}
        frames={n:np.asarray(m) for n,m in prior['full_states'][1]['bone_matrices'].items()}
        arms=[]
        for side in ('L','R'):
            value,proof=solve_upper(rest['upper_arm.'+side],rest['forearm.'+side],rest['hand.'+side],
                                    frames['upper_arm.'+side],frames['forearm.'+side])
            frames['upper_arm.'+side]=value
            arms.append(dict(side=side,**proof))
        retained.apply_frames(rig,frames)
        report['protected_frame_errors']=[]
        for seat,item in enumerate(rigs):
            reference=prior['full_states'][seat]
            errors={name:float(np.abs(np.asarray(item.pose.bones[name].matrix)-np.asarray(matrix)).max())
                    for name,matrix in reference['bone_matrices'].items()
                    if not (seat==1 and name in ('upper_arm.L','upper_arm.R'))}
            if max(errors.values())>1e-5:
                raise ValueError('Protected non-upper-arm frame changed')
            report['protected_frame_errors'].append(errors)
        for row in arms:
            side=row['side']
            upper=proper_rotation((np.asarray(rig.pose.bones['upper_arm.'+side].matrix)@np.linalg.inv(rest['upper_arm.'+side]))[:3,:3])
            lower=proper_rotation((np.asarray(rig.pose.bones['forearm.'+side].matrix)@np.linalg.inv(rest['forearm.'+side]))[:3,:3])
            b=rest['hand.'+side][:3,3]-rest['forearm.'+side][:3,3]
            b/=np.linalg.norm(b)
            residual=float(np.abs(rotation_between(upper@b,lower@b)@upper-lower).max())
            row['actual_elbow_transport_matrix_error']=residual
            if residual>1e-5:
                raise ValueError('Replayed complete-chain transport exceeded tolerance')
        bpy.context.view_layer.update()
        for obj in all_objects:
            obj.update_tag(refresh={'OBJECT'})
        bpy.context.view_layer.update()
        owners = retained.torso.surfaces(bodies)
        allowed=set()
        for obj in bodies[1].all_objects:
            if obj.type!='MESH':
                continue
            groups={g.index for g in obj.vertex_groups if g.name in ('upper_arm.L','upper_arm.R')}
            if any(weight.group in groups and weight.weight>0 for vertex in obj.data.vertices for weight in vertex.groups):
                allowed.add(obj.get('probe_source_name',obj.name))
        report['surface_changes']=[]
        for seat,owner in enumerate(owners):
            for name,surface in owner.items():
                error=float(np.linalg.norm(np.asarray(surface.points)-baseline[f'{seat}/{name}/points'],axis=1).max())
                permitted=seat==1 and name in allowed
                report['surface_changes'].append(dict(seat=seat,part=name,maximum_error=error,has_changed_upper_arm_weight=permitted))
                if not permitted and error>1e-5:
                    raise ValueError('Protected mesh changed outside reader upper-arm binding: '+name)
        report['allowed_changed_surfaces']=sorted(allowed)
        report['visible_books'] = [sum(name.startswith(source.PROP) for name in owner) for owner in owners]
        if report['visible_books'] != [0,14,0]:
            raise ValueError('Mixed scene does not contain exactly the middle reader book')
        deps = bpy.context.evaluated_depsgraph_get()
        solids = {obj.name:source.witness.Surface(obj,deps) for obj in furniture.all_objects if obj.type=='MESH'}
        report.update(proposal=proposal, source_registration=source_registration, arm_construction=arms,
                      full_states=[source.frame_state(rig,source.owned(rig)) for rig in rigs])
        report['source_identity_equal'] = source.rest.identity(all_objects,rigs)==original_identity
        if not report['source_identity_equal']:
            raise ValueError('Authored pose changed raw geometry, bindings, skeleton or materials')
        report['rig_checks'] = []
        for seat,rig in enumerate(rigs):
            length = max(abs((b.tail-b.head).length-rig.data.bones[b.name].length) for b in rig.pose.bones)
            scale = max(abs(v-1) for b in rig.pose.bones for v in b.scale)
            joins = max((rig.pose.bones[a+'.'+s].tail-rig.pose.bones[b+'.'+s].head).length
                        for s in ('L','R') for a,b in (('upper_arm','forearm'),('forearm','hand')))
            report['rig_checks'].append(dict(seat=seat, length_error=length, scale_error=scale, joint_error=joins))
            if max(length,scale,joins)>1e-5:
                report['failures'].append(dict(kind='rig_integrity',seat=seat))
        arrays = {}
        for seat,owner in enumerate(owners):
            for name,surface in owner.items():
                retained.shared.cache_surface(arrays,f'{seat}/{name}',surface)
        for name,surface in solids.items():
            retained.shared.cache_surface(arrays,'furniture/'+name,surface)
        np.savez(output/'authored-geometry.npz',**arrays)
        (output/'authored-pose.json').write_text(json.dumps(report['full_states'],indent=2)+'\n')
        bpy.ops.wm.save_as_mainfile(filepath=str(output/'authored-mixed-sofa.blend'))
        save()

        # Inspect the authored composition before spending time on raw collision inventory.
        camera_receipt = json.loads((HERE/'book-grip-static-views-01/proof.json').read_text())
        all_surfaces = {f'{seat}/{n}':s for seat,owner in enumerate(owners) for n,s in owner.items()}
        all_surfaces.update({'furniture/'+n:s for n,s in solids.items()})
        for label in ('SE','SW','reader-front','reader-side'):
            budget()
            reference_view=next(row for row in prior['renders'] if row['name']==label)
            size=np.asarray(reference_view['native_size'],dtype=int)
            camera=scene.camera
            camera.data.type='ORTHO'
            camera.matrix_world=Matrix(reference_view['camera_matrix'])
            camera.data.ortho_scale=reference_view['camera_scale']
            scene.render.resolution_x,scene.render.resolution_y=(int(v*8) for v in size)
            scene.render.resolution_percentage = 100
            scene.render.threads_mode='FIXED'
            scene.render.threads=2
            scene.render.film_transparent=True
            scene.render.image_settings.file_format='PNG'
            scene.render.image_settings.color_mode='RGBA'
            scene.render.image_settings.color_depth='8'
            bpy.context.view_layer.update()
            path=output/(label+'.png')
            scene.render.filepath=str(path)
            start=time.monotonic()
            bpy.ops.render.render(write_still=True)
            report['renders'].append(dict(name=label, native_size=size.tolist(), source_density=8,
                reduction='float-linear premultiplied BOX then display once',
                labels=['UNACCEPTED AUTHORED PROPOSAL; raw failures retained in this receipt',
                        'One mixed static scene only; no animation, full geometry acceptance or runtime proof'],
                seconds=time.monotonic()-start, camera_matrix=[list(r) for r in camera.matrix_world],
                camera_scale=camera.data.ortho_scale,image=dict(path=path.name,sha256=digest(path))))
            save()

        raw = {}
        containment=Containment()
        report['fold_inventory']=[]
        def crossing(a,b,key):
            if any(a.bounds[1][k]<b.bounds[0][k] or b.bounds[1][k]<a.bounds[0][k] for k in range(3)):
                return
            pairs = a.tree.overlap(b.tree)
            if pairs:
                raw[key] = np.asarray(pairs,dtype=np.int32)
                report['failures'].append(dict(kind='unclassified_surface_crossing',parts=key.split('|'),
                    pairs=len(pairs),witness=key,classification='Includes designed joins; no exemption or acceptance inferred'))
            else:
                report['failures'].extend(containment.check(a,b,key,budget))
        for seat,owner in enumerate(owners):
            budget()
            for name,surface in owner.items():
                pairs=[(a,b) for a,b in surface.tree.overlap(surface.tree) if a<b and not set(surface.triangles[a])&set(surface.triangles[b])]
                report['fold_inventory'].append(dict(seat=seat,part=name,pairs=len(pairs)))
                if pairs:
                    key=f'fold/{seat}/{name}'
                    raw[key]=np.asarray(pairs,dtype=np.int32)
                    report['failures'].append(dict(kind='actual_self_fold',seat=seat,part=name,pairs=len(pairs),witness=key))
                for other,solid in solids.items():
                    crossing(surface,solid,f'{seat}/{name}|furniture/{other}')
            for (name,a),(other,b) in itertools.combinations(owner.items(),2):
                crossing(a,b,f'{seat}/{name}|{seat}/{other}')
            for other_seat in range(seat+1,3):
                for name,a in owner.items():
                    for other,b in owners[other_seat].items():
                        crossing(a,b,f'{seat}/{name}|{other_seat}/{other}')
        report['support'] = []
        for seat,owner in enumerate(owners):
            hip=retained.torso.depth.regions.support(owner['Trouser hip bridge'].points,bpy.data.objects[f'Seat cushion {seat}'],deps)
            feet=[]
            inverse=np.linalg.inv(np.asarray(rigs[seat].matrix_world))
            for name,surface in owner.items():
                if name.startswith('Fitted rounded shoe sole'):
                    points=np.asarray(surface.points)
                    before=old[f'scene/{seat}/{name}/points']
                    feet.append(dict(part=name,minimum_z=float(points[:,2].min()),baseline_maximum_error=float(np.linalg.norm(points-before,axis=1).max())))
            report['support'].append(dict(seat=seat,hips=hip,feet=feet))
            if not hip['valid']:
                report['failures'].append(dict(kind='hip_support',seat=seat,evidence=hip))
        prop=[(n,s) for n,s in owners[1].items() if n.startswith('Reading book cover')]
        report['palm_book_distance'] = []
        for name,surface in owners[1].items():
            if name.startswith('Relaxed palm'):
                distances=[min(s.tree.find_nearest(p)[3] for _,s in prop) for p in surface.points]
                report['palm_book_distance'].append(dict(part=name,minimum=float(min(distances)),vertices_within_2mm=sum(d<=.002 for d in distances),
                    meaning='Surface-distance diagnostic only; not finite support or containment certification'))
        # Measure actual deformed surfaces against the newly selected side planes.
        book_frame = np.asarray(rigs[1].matrix_world)@np.asarray(rigs[1].pose.bones['book'].matrix)
        book_rest = np.asarray(rigs[1].data.bones['book'].matrix_local)
        local_from_world = book_rest@np.linalg.inv(book_frame)
        cover_local = np.concatenate([np.asarray(s.points) for _,s in prop])@local_from_world[:3,:3].T+local_from_world[:3,3]
        report['actual_side_grip_envelopes'] = []
        for side,sign,suffix in (('L',-1,''),('R',1,'.001')):
            edge = float(cover_local[:,0].min() if sign<0 else cover_local[:,0].max())
            parts = []
            for stem in ('Relaxed palm','Resting thumb','Forearm with elbow and wrist sections'):
                name=stem+suffix
                points=np.asarray(owners[1][name].points)@local_from_world[:3,:3].T+local_from_world[:3,3]
                gaps=sign*(points[:,0]-edge)
                parts.append(dict(part=name,minimum_side_plane_gap=float(gaps.min()),
                    all_vertices_outside_side_plane=bool(np.all(gaps>=0))))
            report['actual_side_grip_envelopes'].append(dict(side=side,parts=parts,
                meaning='Fresh deformed full-envelope separation from the book side plane; intended side contact still needs visual and finite-area review'))
        report['containment_statistics']=containment.statistics
        book_rotation=np.asarray(rigs[1].matrix_world)[:3,:3]@(
            np.asarray(rigs[1].pose.bones['book'].matrix)@np.linalg.inv(np.asarray(rigs[1].data.bones['book'].matrix_local)))[:3,:3]
        report['finite_grasp_contact']=finite_grasp(owners[1],book_rotation,raw)
        for contact in report['finite_grasp_contact']:
            if not contact['valid']:
                report['failures'].append(dict(kind='invalid_finite_grasp_contact',side=contact['side'],evidence=contact))
        negative_path=HERE/'book-grip-sleeve-fold-controls-01/proof.json'
        negative=json.loads(negative_path.read_text())
        controls=[r for r in negative['controls'] if r.get('actual_skin_fold_pairs')==498]
        if len(controls)!=2 or any(r['decision']['valid'] or not r['passed'] for r in controls):
            raise ValueError('Preserved 498-pair reversed-wrist negative is no longer rejected')
        report['preserved_negative_control']=dict(path=str(negative_path),sha256=digest(negative_path),controls=controls,
            scope='Unchanged retained negative, not a fresh negative-pose Blender evaluation; both rows reference the same 498 pairs')
        np.savez(output/'raw-crossings.npz',**raw)
        report.update(state='complete',diagnostic_render_count=4,
            geometry_limitations=['Raw triangle crossings retain source joins and artificial caps without exemption',
                'Closed-target component containment and finite side-contact areas are measured; source-join classifications and force/visual acceptance remain open',
                'Head/collar and book/body crossings are included in the raw own-body inventory'])
    except BaseException as error:
        report.update(state='failed',error=repr(error))
        raise
    finally:
        report['inputs_unchanged']=all(digest(p)==s for p,s in inputs.items())
        if not report['inputs_unchanged']:
            report.update(state='failed',error='Frozen input changed')
        save()


if __name__=='__main__':
    run(*(Path(v).resolve() for v in sys.argv[sys.argv.index('--')+1:]))
