"""Keep verified hand contacts fixed while repairing the arm-frame construction."""
import json
import os
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).parent))
import coherent_sofa_arm_frames_v2 as coherent
import continuous_support_patch as continuous
import probe_sofa_hand_support as first

torso, probe, witness = first.torso, first.probe, first.witness


def restore_frames(rigs, cache, prefix, names):
    for index, rig in enumerate(rigs):
        rig.data.pose_position = 'POSE'
        rig['book_visible'] = 0.
        rig['eyes_closed'] = 0.
        rig.matrix_world = Matrix(cache[f'{prefix}/{index}/rig_matrix_world'].tolist())
        for name, matrix in zip(names, cache[f'{prefix}/{index}/bone_matrices']):
            rig.pose.bones[name].matrix = Matrix(matrix.tolist())
            bpy.context.view_layer.update()


def skin_weights(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=deps)
    try:
        names = [group.name for group in obj.vertex_groups]
        weights = np.zeros((len(mesh.vertices), len(names)), dtype=np.float64)
        for vertex in mesh.vertices:
            for group in vertex.groups:
                weights[vertex.index, group.group] = group.weight
        return names, weights
    finally:
        evaluated.to_mesh_clear()


def convex_inside(points, solid):
    p = np.asarray(solid.points)
    triangles = p[np.asarray(solid.triangles)]
    normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    normals /= np.maximum(np.linalg.norm(normals, axis=1), 1e-15)[:, None]
    if not all(np.max((p - origin) @ normal) <= 1e-6 for origin, normal in zip(triangles[:, 0], normals)):
        return None
    signed = np.einsum('nkd,kd->nk', np.asarray(points)[:, None, :] - triangles[None, :, 0, :], normals)
    inside = np.all(signed < -1e-6, axis=1)
    depths = np.min(-signed, axis=1)
    return inside, depths


def run(binding_dir, hand_dir, output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Background Blender and a new absolute output directory are required')
    output.mkdir(parents=True, exist_ok=False)
    old = json.loads((hand_dir / 'proof.json').read_text())
    binding = json.loads((binding_dir / 'proof.json').read_text())
    inputs = dict(old['inputs'])
    for file in (Path(__file__), Path(coherent.__file__), Path(coherent.geometry.__file__), Path(continuous.__file__), hand_dir / 'proof.json', hand_dir / 'resting-geometry.npz'):
        inputs[str(file)] = probe.digest(file)
    if any(probe.digest(Path(path)) != sha for path, sha in old['inputs'].items()):
        raise ValueError('An earlier hand-probe input changed')
    report = dict(state='running', pid=os.getpid(), background=True, inputs=inputs,
                  blender_version=bpy.app.version_string, frames=[], furniture=[], neighbors=[], self_contacts=[], internal=[], contacts=[],
                  scope='Same six hand targets; source-relative elbow/frame correction only; no render or complete pose acceptance')

    def save():
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')

    save()
    try:
        rigs, bodies, furniture, origins = first.load_scene(binding_dir, binding)
        cache = np.load(hand_dir / 'resting-geometry.npz')
        # Positive kinematic control: the source rest target reproduces its rest arm.
        rig = rigs[0]
        rig.data.pose_position = 'POSE'
        for bone in rig.pose.bones:
            bone.matrix = rig.data.bones[bone.name].matrix_local.copy()
            bpy.context.view_layer.update()
        control = []
        report['rest_frame_control'] = control
        canonical_rest = np.load(binding_dir / 'normalized-rest.npz')
        rest_objects = {obj.get('probe_source_name', obj.name): obj for obj in bodies[0].all_objects if obj.type == 'MESH'}
        for side, suffix in (('L', ''), ('R', '.001')):
            row = dict(side=side, stage='inputs')
            control.append(row)
            def record_control(value):
                row['construction'] = dict(value)
                save()
            value = coherent.solve(rig, side, on_measurement=record_control)
            row['bones'] = {}
            for part in ('upper_arm', 'forearm', 'hand'):
                name = part + '.' + side
                bone, rest_bone = rig.pose.bones[name], rig.data.bones[name]
                matrix = np.asarray(bone.matrix, dtype=np.float64)
                rest_matrix = np.asarray(rest_bone.matrix_local, dtype=np.float64)
                row['bones'][name] = dict(actual_matrix=matrix.tolist(), source_rest_matrix=rest_matrix.tolist(),
                    matrix_component_residual=float(np.max(np.abs(matrix-rest_matrix))),
                    rotation_residual_degrees=coherent.geometry.angle_degrees(matrix[:3,:3],rest_matrix[:3,:3]),
                    actual_head=list(bone.head), actual_tail=list(bone.tail), source_head=list(rest_bone.head_local), source_tail=list(rest_bone.tail_local),
                    world_head_displacement=(rig.matrix_world@bone.head-rig.matrix_world@rest_bone.head_local).length,
                    world_tail_displacement=(rig.matrix_world@bone.tail-rig.matrix_world@rest_bone.tail_local).length,
                    stored_length=rest_bone.length, actual_length=(bone.tail-bone.head).length, scale=list(bone.scale))
            row['mesh_displacement'] = {}
            inverse = np.linalg.inv(np.asarray(rig.matrix_world,dtype=np.float64))
            for prefix in first.ARM_PARTS:
                name=prefix+suffix
                surface=witness.Surface(rest_objects[name],bpy.context.evaluated_depsgraph_get())
                world=np.asarray(surface.points)
                local=world@inverse[:3,:3].T+inverse[:3,3]
                expected=canonical_rest[name+'/rest_points']
                error=float(np.linalg.norm(local-expected,axis=1).max())
                row['mesh_displacement'][name]=error
                if error>.00001:
                    np.savez(output/f'rest-control-{side}-{prefix}.npz',actual=local,expected=expected)
            row['maximum_joint_displacement']=max(max(b['world_head_displacement'],b['world_tail_displacement']) for b in row['bones'].values())
            row['maximum_length_error']=max(abs(b['actual_length']-b['stored_length']) for b in row['bones'].values())
            row['maximum_scale_error']=max(abs(v-1) for b in row['bones'].values() for v in b['scale'])
            row['stage']='measured-before-assertion'
            save()
            # Keep the established metre/scale bounds; matrix and angle residuals
            # are retained separately rather than mixing their units into this control.
            if max(row['mesh_displacement'].values())>.00001 or row['maximum_joint_displacement']>.00001 or row['maximum_length_error']>.00001 or row['maximum_scale_error']>.00001:
                raise ValueError('Source rest arm failed an existing spatial, length or scale bound')
            row['stage']='passed'
            save()
        restore_frames(rigs, cache, 'after', old['bone_names'])
        report['rejected_candidate_replay_error'] = {}
        replay = torso.surfaces(bodies)
        for index, owner in enumerate(replay):
            for name, surface in owner.items():
                if not name.startswith(first.ARM_PARTS):
                    continue
                error = float(np.linalg.norm(np.asarray(surface.points) - cache[f'after/{index}/{name}/points'], axis=1).max())
                report['rejected_candidate_replay_error'][f'{index}/{name}'] = error
                if error > .00001:
                    raise ValueError('Recorded rejected arm pose did not replay')
        for index, rig in enumerate(rigs):
            for side in ('L', 'R'):
                row=dict(seat=index,side=side,state='inputs')
                report['frames'].append(row)
                def record_frame(value):
                    row.update(value)
                    save()
                try:
                    row.update(coherent.solve(rig,side,on_measurement=record_frame))
                    row['state']='constructed'
                except ValueError as error:
                    row.update(state='construction_rejected',error=str(error))
                save()
        owners = torso.surfaces(bodies)
        deps = bpy.context.evaluated_depsgraph_get()
        solids = {obj.name: witness.Surface(obj, deps) for obj in furniture.all_objects if obj.type == 'MESH'}
        objects = [{obj.get('probe_source_name', obj.name): obj for obj in body.all_objects} for body in bodies]
        arrays = {}
        report['hand_target_replay_error'] = {}
        for part, solid in solids.items():
            first.cache_surface(arrays, f'furniture/{part}', solid)
        for index, owner in enumerate(owners):
            arrays[f'{index}/bone_matrices'] = np.asarray([list(b.matrix) for b in rigs[index].pose.bones])
            arrays[f'{index}/rig_matrix_world'] = np.asarray(rigs[index].matrix_world)
            for name, surface in owner.items():
                first.cache_surface(arrays, f'{index}/{name}', surface)
                if name.startswith(('Relaxed palm', 'Resting thumb')):
                    error = float(np.linalg.norm(np.asarray(surface.points) - cache[f'after/{index}/{name}/points'], axis=1).max())
                    report['hand_target_replay_error'][f'{index}/{name}'] = error
                    if error > .00001:
                        raise ValueError('The frame correction moved a hand contact target')
                for part, solid in solids.items():
                    hit = first.compact_hit(arrays, f'collision/furniture/{index}/{name}/{part}', surface, solid)
                    if hit:
                        record = dict(seat=index, body=name, furniture=part, evidence=hit)
                        if name.startswith('Forearm'):
                            groups, weights = skin_weights(objects[index][name])
                            arrays[f'{index}/{name}/evaluated_skin_weights'] = weights
                            record['skin_groups'] = groups
                            record['skin_normalization_error'] = float(np.abs(weights.sum(1) - 1).max())
                            inside = convex_inside(surface.points, solid)
                            if inside is not None:
                                mask, depths = inside
                                hand_group = next((j for j, group in enumerate(groups) if group.startswith('hand.')), None)
                                arrays[f'{index}/{name}/inside_{part}_vertices'] = np.flatnonzero(mask)
                                if hand_group is not None:
                                    driven = mask & (weights[:, hand_group] >= 1 - 1e-7)
                                    record['numerically_hand_driven_inside_vertices'] = int(driven.sum())
                                    record['deepest_hand_driven_inside_vertex'] = float(depths[driven].max()) if driven.any() else 0.
                        report['furniture'].append(record)
                for neighbor in range(index + 1, 3):
                    for part, other in owners[neighbor].items():
                        hit = first.compact_hit(arrays, f'collision/neighbor/{index}/{neighbor}/{name}/{part}', surface, other)
                        if hit:
                            report['neighbors'].append(dict(seats=[index, neighbor], parts=[name, part], evidence=hit))
            for name, surface in owner.items():
                if not name.startswith(first.ARM_PARTS):
                    continue
                pairs = [(a, b) for a, b in surface.tree.overlap(surface.tree)
                         if a < b and not set(surface.triangles[a]) & set(surface.triangles[b])]
                arrays[f'internal/{index}/{name}'] = np.asarray(pairs, dtype=np.int32).reshape((-1, 2))
                report['internal'].append(dict(seat=index, part=name, pairs=len(pairs)))
                for part, other in owner.items():
                    if part == name or (part.startswith(first.ARM_PARTS) and part < name):
                        continue
                    pairs = surface.tree.overlap(other.tree)
                    if pairs:
                        key = f'self/{index}/{name}/{part}'
                        arrays[key] = np.asarray(pairs, dtype=np.int32)
                        report['self_contacts'].append(dict(seat=index, parts=[name, part], pairs=len(pairs), witness_array=key,
                                                           classification='Named contacts remain subject to source-region classification'))
        for hand in old['hands']:
            seat, side, measure = hand['seat'], hand['side'], hand['measurement']
            part = 'Relaxed palm' + ('.001' if side == 'R' else '')
            palm = owners[seat][part]
            target = solids[measure['support']] if measure['support'].startswith('Arm ') else owners[seat][measure['support']]
            result = continuous.measure(palm.points, palm.triangles, target.points, target.triangles, measure['support_normal'], measure['near_gap'])
            record = dict(seat=seat, side=side, support=measure['support'])
            for key, value in result.items():
                if isinstance(value, np.ndarray):
                    arrays[f'contact/{seat}/{side}/{key}'] = value
                else:
                    record[key] = value
            report['contacts'].append(record)
        report['hip_support'] = [torso.depth.regions.support(owner['Trouser hip bridge'].points, bpy.data.objects[f'Seat cushion {i}'], deps)
                                 for i, owner in enumerate(owners)]
        report['bone_checks'] = [dict(seat=i, maximum_length_error=max(abs((b.tail-b.head).length-rig.data.bones[b.name].length) for b in rig.pose.bones),
            maximum_scale_error=max(abs(v-1) for b in rig.pose.bones for v in b.scale),
            wrist_join_error={side:(rig.pose.bones['forearm.'+side].tail-rig.pose.bones['hand.'+side].head).length for side in ('L','R')})
            for i, rig in enumerate(rigs)]
        np.savez(output / 'geometry.npz', **arrays)
        report['cache_sha256'] = probe.digest(output / 'geometry.npz')
        if any(probe.digest(Path(path)) != sha for path, sha in inputs.items()):
            raise ValueError('A coherent-frame input changed')
        report['state'] = 'complete'
        report['acceptance'] = 'Controlled frame comparison only; surface failures are retained and no complete pose is accepted'
    except BaseException as error:
        report['state'] = 'failed'
        report['error'] = repr(error)
        raise
    finally:
        save()


if __name__ == '__main__':
    run(*(Path(value) for value in sys.argv[sys.argv.index('--') + 1:]))
