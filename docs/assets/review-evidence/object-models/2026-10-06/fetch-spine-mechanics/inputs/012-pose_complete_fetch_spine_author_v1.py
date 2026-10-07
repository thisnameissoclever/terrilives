"""Replay the indexed spine plan on the unchanged 17-bone source rig."""
import ast
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
import traceback

import bpy
import numpy as np
from mathutils import Matrix
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1] / 'assets/models/living')]
from book_grip_reading_geometry import Mesh, Kernel
from sofa_coupled_contact_evaluator import solid_angle, nearest_distance
from continuous_support_patch import measure
from sofa_arm_frame_math import apply_swing, rotation_between
from seated_pose_chain_math_v1 import solve_upper


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def primitives():
    path = HERE / 'audit_sofa_binding.py'
    tree = ast.parse(path.read_text())
    scope = {'np': np, 'NUMERICAL_EPS': 1e-8}
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef)
             and n.name in ('plane_slice', 'intersection_segment', 'barycentric')]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), scope)
    return scope


class ExactKernel(Kernel):
    def contact(self, first, second, arrays, prefix):
        pairs, unresolved = self.pairs(first, second)
        if len(pairs) or unresolved:
            arrays[prefix + '/pairs'] = pairs
            return dict(kind='surface', pairs=int(len(pairs)), unresolved=unresolved, witness=prefix)
        for label, source, target in (('first_inside_second', first, second), ('second_inside_first', second, first)):
            if not target.closed:
                continue
            for index in source.components:
                self.budget()
                point = source.points[index]
                if np.any(point < target.low) or np.any(point > target.high):
                    continue
                winding = solid_angle(point, target.points, target.triangles)
                if abs(winding) > .5:
                    distance = nearest_distance(point, target.points, target.triangles)
                    if distance > 1e-6:
                        return dict(kind=label, vertex=int(index), winding=winding, distance=distance)
        return None


def snapshot(rig):
    deps = bpy.context.evaluated_depsgraph_get()
    groups = {'body': {}, 'furniture': {}}
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or obj.hide_render:
            continue
        owner = ('body' if any(m.type == 'ARMATURE' and m.object == rig for m in obj.modifiers)
                 else 'furniture' if obj.name.startswith(('Back panel', 'Left side', 'Right side', 'Base', 'Shelf ', 'Crown', 'Book '))
                 else None)
        if owner is None:
            continue
        evaluated = obj.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            points = np.asarray([list(evaluated.matrix_world @ v.co) for v in mesh.vertices], dtype=np.float64)
            triangles = np.asarray([tuple(t.vertices) for t in mesh.loop_triangles], dtype=np.int32)
            error = float(np.abs(points - points.astype(np.float32).astype(np.float64)).max())
            tree = BVHTree.FromPolygons(points.tolist(), triangles.tolist(), all_triangles=True, epsilon=2 * error + 2e-6)
            groups[owner][obj.get('probe_source_name', obj.name)] = Mesh(points, triangles, tree)
        finally:
            evaluated.to_mesh_clear()
    return groups


def apply_pose(rig, rest, source_frames, world, hand_world):
    frames = {n: m.copy() for n, m in source_frames.items()}
    upper, lower, hand = 'upper_arm.R', 'forearm.R', 'hand.R'
    hand_pose = np.linalg.inv(world) @ hand_world
    spine = frames['spine'] @ np.linalg.inv(rest['spine'])
    shoulder = (spine @ np.r_[rest[upper][:3, 3], 1.])[:3]
    wrist = hand_pose[:3, 3]
    lengths = [np.linalg.norm(rest[b][:3, 3] - rest[a][:3, 3]) for a, b in [(upper, lower), (lower, hand)]]
    delta = wrist - shoulder
    distance = float(np.linalg.norm(delta))
    if not abs(lengths[0] - lengths[1]) < distance < sum(lengths):
        raise ValueError('Actual source spine target exceeds unchanged arm reach')
    axis = delta / distance
    along = .5 * (distance + (lengths[0] - lengths[1]) * sum(lengths) / distance)
    centre = shoulder + along * axis
    radius = math.sqrt((sum(lengths) - distance) * (sum(lengths) + distance)
                       * (distance + lengths[0] - lengths[1]) * (distance - lengths[0] + lengths[1])) / (2 * distance)
    pole = (spine @ np.r_[rest[lower][:3, 3], 1.])[:3] - centre
    pole -= axis * (pole @ axis)
    pole /= np.linalg.norm(pole)
    elbow = centre + radius * pole
    deformation = hand_pose @ np.linalg.inv(rest[hand])
    up = apply_swing(spine @ rest[upper], rotation_between(spine[:3, :3] @ (rest[lower][:3, 3] - rest[upper][:3, 3]), elbow - shoulder), shoulder)
    low = apply_swing(deformation @ rest[lower], rotation_between(deformation[:3, :3] @ (rest[hand][:3, 3] - rest[lower][:3, 3]), wrist - elbow), elbow)
    up, transport = solve_upper(rest[upper], rest[lower], rest[hand], up, low)
    frames.update({upper: up, lower: low, hand: hand_pose})
    rig.matrix_world = Matrix(world.tolist())
    for name, frame in frames.items():
        rig.pose.bones[name].matrix = Matrix(frame.tolist())
        bpy.context.view_layer.update()
    residual = max(float(np.abs(np.asarray(rig.pose.bones[n].matrix) - m).max()) for n, m in frames.items())
    if residual > 1e-5:
        raise ValueError('Original full-frame replay tolerance exceeded')
    return frames, dict(frame_error=residual, distance=distance, upper_margin=float(sum(lengths) - distance), transport=transport)


def patch_report(arrays, prefix, patch):
    for name, value in patch.items():
        if isinstance(value, np.ndarray):
            arrays[prefix + '/' + name] = value
    return {k: v for k, v in patch.items() if not isinstance(v, np.ndarray)}


def run(manifest_path, output):
    manifest = json.loads(manifest_path.read_text())
    inputs = dict(manifest['inputs'])
    inputs[str(manifest_path)] = digest(manifest_path)
    if output.exists() or not bpy.app.background or any(digest(p) != s for p, s in inputs.items()):
        raise ValueError('Require a new author proof and frozen inputs')
    output.mkdir()
    began = time.monotonic()
    report = dict(state='running', pid=os.getpid(), inputs=inputs, acceptance=False, stages=[],
                  scope='Actual spine-first source replay; rejected stock garments are not approved by independent mechanics')
    arrays = {}

    def save():
        report['elapsed_seconds'] = time.monotonic() - began
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n')

    save()
    try:
        plan = json.loads(Path(manifest['plan']).read_text())
        if not plan['independent_mechanics_pass']:
            raise ValueError('Require the source-constraint plan to pass before authoring')
        capture = json.loads(Path(manifest['capture']).read_text())
        rest = {n: np.asarray(m) for n, m in capture['bone_rest'].items()}
        source_frames = {n: np.asarray(m) for n, m in capture['bone_matrices'].items()}
        world = np.asarray(plan['plan']['rig_matrix_world'])
        hand_world = np.eye(4)
        hand_world[:3, :3] = plan['plan']['hand_world_rotation']
        hand_world[:3, 3] = plan['plan']['hand_world_wrist']
        pad_ids = np.asarray(plan['indexed_patches']['distal_triangles'], dtype=np.int32)
        spine_ids = np.asarray(plan['indexed_patches']['spine_triangles'], dtype=np.int32)
        core_ids = np.asarray(plan['indexed_patches']['core_vertices'], dtype=np.int32)
        kernel = ExactKernel(primitives(), began + 210)
        floor = Mesh(np.array([[-2., -2., 0.], [2., -2., 0.], [2., 2., 0.], [-2., 2., 0.]]), np.array([[0, 1, 2], [0, 2, 3]]))
        for stage, book_offset in [('lift_clear', np.array([0., 0., plan['plan']['lift']])),
                                   ('outside_spine', np.array([0., -plan['plan']['outward'], plan['plan']['lift']]))]:
            bpy.ops.wm.open_mainfile(filepath=manifest['seed_scene'])
            rig = bpy.data.objects[manifest['rig']]
            book_obj = bpy.data.objects['Book 0 0']
            book_obj.location += Matrix.Translation(book_offset.tolist()).translation
            desired = hand_world.copy()
            desired[:3, 3] += book_offset - np.array([0., 0., plan['plan']['lift']])
            frames, frame_proof = apply_pose(rig, rest, source_frames, world, desired)
            groups = snapshot(rig)
            body, furniture = groups['body'], groups['furniture']
            palm, book = body['Relaxed palm.001'], furniture['Book 0 0']
            with np.load(manifest['normalized_rest']) as normalized:
                correspondence = bool(np.array_equal(palm.triangles, normalized['Relaxed palm.001/triangles']))
            if not correspondence:
                raise ValueError('Original source triangle indices no longer identify the evaluated palm')
            contact = measure(palm.points, palm.triangles[pad_ids], book.points, book.triangles[spine_ids], np.array([0., -1., 0.]), .0015)
            record = dict(stage=stage, frames=frame_proof, source_correspondence=correspondence,
                          contact=patch_report(arrays, stage + '/spine_contact', contact),
                          palm_core_front_gap=float(plan['palm_core_front']['cabinet_front_y'] - palm.points[core_ids, 1].max()),
                          actual_bottom_base_gap=float(book.low[2] - furniture['Base'].high[2]),
                          skin_and_cloth_furniture=[], distal_body=[], self_folds=[], feet=[])
            report['stages'].append(record)
            save()
            for name, mesh in body.items():
                kernel.budget()
                for other, obstacle in furniture.items():
                    witness = kernel.contact(mesh, obstacle, arrays, stage + '/furniture/' + name + '|' + other)
                    if witness:
                        record['skin_and_cloth_furniture'].append(dict(parts=[name, other], evidence=witness))
                if name.startswith(('Forearm', 'Relaxed palm', 'Resting thumb', 'Relaxed shirt sleeve', 'Turned sleeve cuff')):
                    pairs, unresolved = kernel.pairs(mesh, mesh, self_test=True)
                    if len(pairs) or unresolved:
                        arrays[stage + '/self/' + name + '/pairs'] = pairs
                        record['self_folds'].append(dict(part=name, pairs=int(len(pairs)), unresolved=unresolved))
                if name.startswith(('Forearm', 'Relaxed palm', 'Resting thumb')):
                    for other, target_mesh in body.items():
                        if not other.startswith(('Overshirt', 'Shirt lower', 'Trouser hip', 'One sewn', 'Shirt placket', 'Small horn')):
                            continue
                        witness = kernel.contact(mesh, target_mesh, arrays, stage + '/distal/' + name + '|' + other)
                        if witness:
                            record['distal_body'].append(dict(parts=[name, other], evidence=witness))
            for suffix in ('', '.001'):
                sole = body['Fitted rounded shoe sole' + suffix]
                support = measure(sole.points, sole.triangles, floor.points, floor.triangles, np.array([0., 0., 1.]), .0015)
                record['feet'].append(dict(part='sole' + suffix, patch=patch_report(arrays, stage + '/foot' + suffix, support), low_z=float(sole.low[2])))
            raised = desired.copy()
            raised[2, 3] += .02
            apply_pose(rig, rest, source_frames, world, raised)
            raised_palm = snapshot(rig)['body']['Relaxed palm.001']
            negative = measure(raised_palm.points, raised_palm.triangles[pad_ids], book.points,
                               book.triangles[spine_ids], np.array([0., -1., 0.]), .0015)
            record['raised_arm_negative'] = patch_report(arrays, stage + '/raised_arm', negative)
            apply_pose(rig, rest, source_frames, world, desired)
            restored = snapshot(rig)
            restored_palm = restored['body']['Relaxed palm.001']
            record['negative_restore_error'] = float(np.abs(restored_palm.points - palm.points).max())
            if record['negative_restore_error'] > 1e-5:
                raise ValueError('Negative control restoration changed original source geometry')
            for owner, meshes in restored.items():
                for name, mesh in meshes.items():
                    arrays[stage + '/' + owner + '/' + name + '/points'] = mesh.points
                    arrays[stage + '/' + owner + '/' + name + '/triangles'] = mesh.triangles
            record['independent_mechanics_pass'] = bool(contact['projected_area'] > 0 and contact['certified_cells'] > 0
                and record['palm_core_front_gap'] > 1e-6 and record['actual_bottom_base_gap'] > 1e-6
                and not record['skin_and_cloth_furniture'] and not record['distal_body']
                and negative['projected_area'] == 0 and all(f['patch']['projected_area'] > 0 and f['low_z'] >= 0 for f in record['feet']))
            directory = output / stage
            directory.mkdir()
            scene = directory / 'source.blend'
            bpy.context.preferences.filepaths.save_version = 0
            bpy.ops.wm.save_as_mainfile(filepath=str(scene))
            record['scene'] = dict(path=str(scene), sha256=digest(scene))
            record['bone_matrices'] = {n: np.asarray(rig.pose.bones[n].matrix).tolist() for n in frames}
            save()
        report['independent_mechanics_pass'] = all(s['independent_mechanics_pass'] for s in report['stages'])
        report['state'] = 'complete'
    except BaseException as error:
        report.update(state='failed', error=repr(error), traceback=traceback.format_exc())
        raise
    finally:
        np.savez_compressed(output / 'geometry-witnesses.npz', **arrays)
        report['inputs_unchanged'] = all(digest(p) == s for p, s in inputs.items())
        save()


if __name__ == '__main__':
    run(*(Path(v).resolve() for v in sys.argv[sys.argv.index('--') + 1:]))
