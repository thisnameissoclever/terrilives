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
from sofa_arm_frame_math import solve as rest_frame_solve, angle_degrees


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
                  scope='Second authored sit/read/sit key pose; side grip and neutral outer wrists; raw diagnostics only')

    def save():
        report['elapsed_seconds'] = time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(report, indent=2)+'\n')

    def budget():
        if time.monotonic()-began > 180:
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
        arms = []
        for seat, rig in enumerate(rigs):
            frames = {name:old[f'scene/{seat}/bone_matrices'][i].copy() for i,name in enumerate(bone_names)}
            rig.matrix_world = Matrix(old[f'scene/{seat}/rig_matrix_world'])
            rest = {bone.name:np.asarray(bone.matrix_local).copy() for bone in rig.data.bones}
            values = proposal['actors'][seat]
            rx = rotation([1,0,0], math.radians(values['forward_degrees']))
            ry = rotation([0,1,0], math.radians(values['outward_degrees']))
            spine_rot = rx@ry
            frames['spine'] = affine(spine_rot@rest['spine'][:3,:3], frames['spine'][:3,3])
            deform = frames['spine']@np.linalg.inv(rest['spine'])
            frames['head'] = deform@rest['head']
            frames['head'][:3,:3] = deform[:3,:3]@rotation([1,0,0], math.radians(values['head_relative_degrees']))@rest['head'][:3,:3]
            if seat==1:
                book_rot = rotation([1,0,0], math.radians(proposal['book']['pitch_degrees']))
                center = np.asarray(proposal['book']['center'])
                frames['book'] = affine(book_rot@rest['book'][:3,:3], center)
            for side,sign in (('L',-1),('R',1)):
                if seat==1:
                    suffix = '' if side=='L' else '.001'
                    mean = rest_cache['Relaxed palm'+suffix+'/points'].mean(0)
                    names = ('Relaxed palm','Resting thumb','Forearm with elbow and wrist sections')
                    envelope = np.concatenate([rest_cache[n+suffix+'/points'] for n in names])
                    # A side grip has opposing inward palm faces and thumbs below the edge.
                    # This proper basis preserves the complete hand frame, including roll.
                    hand_turn = np.asarray([[0,sign,0],[0,0,1],[sign,0,0]],dtype=float)
                    local_envelope = (envelope-mean)@hand_turn.T
                    cover = np.concatenate([rest_cache[n+'/points'] for n in
                        ('Reading book cover','Reading book cover.001')])-rest['book'][:3,3]
                    edge = cover[:,0].min() if sign<0 else cover[:,0].max()
                    target = np.asarray([edge-sign*np.min(sign*local_envelope[:,0])+sign*.0005,
                                         proposal['book']['palm_y'],proposal['book']['palm_z']])
                    hand_rotation = book_rot@hand_turn
                    hand_translation = center+book_rot@target-hand_rotation@mean
                    hand = affine(hand_rotation,hand_translation)@rest['hand.'+side]
                    data = dict(matrices=dict(spine_pose=frames['spine'],spine_rest=rest['spine'],
                        upper_rest=rest['upper_arm.'+side],forearm_rest=rest['forearm.'+side],
                        hand_rest=rest['hand.'+side],hand_pose=hand),
                        endpoints=dict(upper_head=rest['upper_arm.'+side][:3,3],
                            forearm_head=rest['forearm.'+side][:3,3],forearm_tail=rest['hand.'+side][:3,3]))
                    solved = rest_frame_solve(data)
                    for name,matrix in solved['targets'].items():
                        frames[name+'.'+side] = matrix
                    lower_deform = frames['forearm.'+side]@np.linalg.inv(rest['forearm.'+side])
                    wrist_angle = angle_degrees(lower_deform[:3,:3],hand_rotation)
                    style = 'New opposing side grip; full palm/thumb/forearm rest envelope outside the cover edge; actual deformed envelope checked below'
                    arms.append(dict(seat=seat,side=side,style=style,
                        shoulder=solved['shoulder'].tolist(),elbow=solved['elbow'].tolist(),wrist=solved['wrist'].tolist(),
                        wrist_relative_degrees=wrist_angle,grip_envelope_names=[n+suffix for n in names],
                        cover_side_coordinate=float(edge),hand_center_in_book_frame=target.tolist()))
                else:
                    # Direct connected local rotations keep the wrist neutral to its forearm.
                    upper_turn = rotation([1,0,0],math.radians(-30))@rotation([0,1,0],math.radians(sign*15))
                    upper_pivot = rest['upper_arm.'+side][:3,3]
                    upper_deform = deform@affine(upper_turn,upper_pivot-upper_turn@upper_pivot)
                    elbow_turn = rotation([1,0,0],math.radians(-45))
                    elbow_pivot = rest['forearm.'+side][:3,3]
                    lower_deform = upper_deform@affine(elbow_turn,elbow_pivot-elbow_turn@elbow_pivot)
                    frames['upper_arm.'+side] = upper_deform@rest['upper_arm.'+side]
                    frames['forearm.'+side] = lower_deform@rest['forearm.'+side]
                    frames['hand.'+side] = lower_deform@rest['hand.'+side]
                    arms.append(dict(seat=seat,side=side,
                        style='Direct local shoulder and elbow rotations; neutral wrist; no armrest or thigh target',
                        shoulder=frames['upper_arm.'+side][:3,3].tolist(),
                        elbow=frames['forearm.'+side][:3,3].tolist(),wrist=frames['hand.'+side][:3,3].tolist(),
                        wrist_relative_degrees=0.,shoulder_forward_degrees=30,shoulder_inward_degrees=15,elbow_bend_degrees=45))
            retained.apply_frames(rig, frames)
            rig['book_visible'] = float(seat==1)
            rig['eyes_closed'] = 0.
            rig.update_tag(refresh={'OBJECT','DATA'})
        bpy.context.view_layer.update()
        for obj in all_objects:
            obj.update_tag(refresh={'OBJECT'})
        bpy.context.view_layer.update()
        owners = retained.torso.surfaces(bodies)
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
            if label in ('SE','SW'):
                old_view = next(r for r in camera_receipt['renders'] if r['name']=='static-'+label)
                rotation_matrix = rigs[1].matrix_world.to_3x3()@Matrix(old_view['rig_matrix_world']).to_3x3().inverted()@Matrix(old_view['camera_matrix']).to_3x3()
                points = np.concatenate([np.asarray(s.points) for s in all_surfaces.values()])
            else:
                offset = Vector((0,-3,.35) if label=='reader-front' else (3,0,.35))
                rotation_matrix = rigs[1].matrix_world.to_3x3()@(-offset).to_track_quat('-Z','Y').to_matrix()
                points = np.concatenate([np.asarray(s.points) for n,s in owners[1].items()
                    if n.startswith(source.ARM+source.PROP) or any(t in n.lower() for t in ('head','eye','hair','ear','nose','mouth','lip','chin'))])
            projected = points@np.asarray(rotation_matrix)
            center = (projected.min(0)+projected.max(0))/2
            size = np.ceil(np.ptp(projected[:,:2],axis=0)*density+12).astype(int)
            camera = scene.camera
            camera.data.type = 'ORTHO'
            camera.rotation_euler = rotation_matrix.to_euler()
            camera.location = rotation_matrix@Vector(center)+rotation_matrix@Vector((0,0,10))
            camera.data.ortho_scale = float(max(size)/density)
            scene.render.resolution_x,scene.render.resolution_y = (int(v*8) for v in size)
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
        def crossing(a,b,key):
            if any(a.bounds[1][k]<b.bounds[0][k] or b.bounds[1][k]<a.bounds[0][k] for k in range(3)):
                return
            pairs = a.tree.overlap(b.tree)
            if pairs:
                raw[key] = np.asarray(pairs,dtype=np.int32)
                report['failures'].append(dict(kind='unclassified_surface_crossing',parts=key.split('|'),
                    pairs=len(pairs),witness=key,classification='Includes designed joins; no exemption or acceptance inferred'))
        for seat,owner in enumerate(owners):
            budget()
            for name,surface in owner.items():
                pairs=[(a,b) for a,b in surface.tree.overlap(surface.tree) if a<b and not set(surface.triangles[a])&set(surface.triangles[b])]
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
        np.savez(output/'raw-crossings.npz',**raw)
        report.update(state='complete',diagnostic_render_count=4,
            geometry_limitations=['Raw triangle crossings retain source joins and artificial caps without exemption',
                'Containment and full contact-region certification are not performed in this early visual diagnostic',
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
