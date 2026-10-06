"""Compare saved/source read grips with endpoint and full-frame sofa retargeting."""
import hashlib
import json
import os
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
import probe_sofa_outward_torso as torso
from sofa_book_support import normals

probe, witness = torso.probe, torso.witness
PART_PREFIXES = ('Relaxed palm', 'Resting thumb', 'Reading book cover', 'Reading book pages')


def objects_for(rig):
    return {obj.get('probe_source_name', obj.name): obj for obj in bpy.data.objects if obj.type == 'MESH'
            and any(mod.type == 'ARMATURE' and mod.object == rig for mod in obj.modifiers)
            and obj.get('probe_source_name', obj.name).startswith(PART_PREFIXES)}


def ready(objects):
    bpy.context.view_layer.update()
    for obj in objects.values():
        if not obj.hide_render and not obj.hide_viewport:
            obj.update_tag(refresh={'OBJECT'})
    bpy.context.view_layer.update()
    for obj in objects.values():
        if obj.hide_render or obj.hide_viewport:
            raise ValueError(f'Reading contact part is unexpectedly hidden: {obj.name}')
        expected = obj.parent.matrix_world @ obj.matrix_parent_inverse @ obj.matrix_basis
        error = max(abs(obj.matrix_world[r][c] - expected[r][c]) for r in range(4) for c in range(4))
        if error > .00001:
            raise ValueError(f'Read-pose object hierarchy is stale: {obj.name}')


def rest_identity(objects, rig):
    meshes = {}
    for name, obj in objects.items():
        relative = obj.matrix_parent_inverse @ obj.matrix_basis
        points = np.asarray([list(relative @ vertex.co) for vertex in obj.data.vertices], dtype=np.float64)
        polygons = [list(p.vertices) for p in obj.data.polygons]
        meshes[name] = dict(points=points.tolist(), polygons=polygons,
                            groups=[g.name for g in obj.vertex_groups],
                            weights=[[[v.group, v.weight] for v in vertex.groups] for vertex in obj.data.vertices])
    return dict(meshes=meshes, bones={b.name: [list(row) for row in b.matrix_local] for b in rig.data.bones})


def save_rest(output, label, identity):
    arrays, parts = {}, {}
    for name, mesh in identity['meshes'].items():
        arrays[name + '/points'] = np.asarray(mesh['points'])
        arrays[name + '/polygon_offsets'] = np.cumsum([0] + [len(p) for p in mesh['polygons']], dtype=np.int32)
        arrays[name + '/polygon_vertices'] = np.asarray([v for p in mesh['polygons'] for v in p], dtype=np.int32)
        arrays[name + '/weights'] = np.asarray([[i, group, weight] for i, row in enumerate(mesh['weights']) for group, weight in row])
        parts[name] = dict(vertices=len(mesh['points']), polygons=len(mesh['polygons']), groups=mesh['groups'])
    names = list(identity['bones'])
    arrays['bone_matrices'] = np.asarray([identity['bones'][name] for name in names])
    path = output / f'{label}-rest.npz'
    np.savez(path, **arrays)
    return dict(cache=dict(path=path.name, sha256=probe.digest(path)), parts=parts, bone_names=names)


def measure(objects, rig, arrays):
    ready(objects)
    deps = bpy.context.evaluated_depsgraph_get()
    surfaces = {name: witness.Surface(obj, deps) for name, obj in objects.items()}
    book_inverse = np.linalg.inv(np.asarray(rig.matrix_world @ rig.pose.bones['book'].matrix, dtype=np.float64))
    result = dict(pairs=[], books={}, frames={name: [list(row) for row in rig.pose.bones[name].matrix] for name in torso.BONES},
                  relative_hand_book={})
    for name, surface in surfaces.items():
        p = np.asarray(surface.points)
        arrays[name + '/world_points'] = p
        arrays[name + '/triangles'] = np.asarray(surface.triangles, dtype=np.int32)
        arrays[name + '/book_relative_points'] = p @ book_inverse[:3, :3].T + book_inverse[:3, 3]
    for side in ('L', 'R'):
        result['relative_hand_book'][side] = (np.linalg.inv(np.asarray(rig.pose.bones['book'].matrix, dtype=np.float64))
                                             @ np.asarray(rig.pose.bones['hand.' + side].matrix, dtype=np.float64)).tolist()
    for book_name, book in surfaces.items():
        if not book_name.startswith(('Reading book cover', 'Reading book pages')):
            continue
        points = np.asarray(book.points)
        triangles = points[np.asarray(book.triangles)]
        face_normals, _ = normals(book)
        convex = bool(all(np.max((points - origin) @ normal) <= 1e-6 for origin, normal in zip(triangles[:, 0], face_normals)))
        closed = all(book.topology[k] == 0 for k in ('boundary_edges', 'nonmanifold_edges', 'inconsistent_edges'))
        result['books'][book_name] = dict(convex=convex, closed=closed)
        for hand_name, hand in surfaces.items():
            if not hand_name.startswith(('Relaxed palm', 'Resting thumb')):
                continue
            hp = np.asarray(hand.points)
            signed = np.einsum('nkd,kd->nk', hp[:, None, :] - triangles[None, :, 0, :], face_normals)
            inside = np.all(signed < -1e-6, axis=1) if convex and closed else np.zeros(len(hp), dtype=bool)
            hits = hand.tree.overlap(book.tree)
            prefix = hand_name + '/' + book_name
            arrays[prefix + '/inside_vertices'] = np.flatnonzero(inside)
            arrays[prefix + '/crossing_triangles'] = np.asarray(hits, dtype=np.int32).reshape((-1, 2))
            result['pairs'].append(dict(hand=hand_name, book=book_name, crossing_pairs=len(hits),
                inside_vertex_records=int(inside.sum()), deepest_inside=float(np.min(-signed[inside], axis=1).max()) if inside.any() else 0.,
                cache_prefix=prefix))
    return result


def run(binding_dir, output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Background Blender and a new absolute output directory are required')
    output.mkdir(parents=True, exist_ok=False)
    binding = json.loads((binding_dir / 'proof.json').read_text())
    original_file = probe.MODELS / 'sims/sim-01/sim-01-rigged.blend'
    inputs = dict(binding['inputs'])
    for file in (Path(__file__), original_file, binding_dir / 'proof.json', binding_dir / 'derived-waist-binding.blend',
                 Path(__file__).with_name('sofa_book_support.py'), Path(__file__).with_name('sofa_resting_hand_solver.py')):
        inputs[str(file)] = probe.digest(file)
    if any(probe.digest(Path(path)) != sha for path, sha in binding['inputs'].items()):
        raise ValueError('A binding source input changed')
    report = dict(state='running', pid=os.getpid(), background=True, blender_version=bpy.app.version_string,
                  inputs=inputs, cases=[], comparisons=[],
                  scope='Saved original read action versus source generator and sofa retarget controls; no grip correction or render')

    def save():
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n')

    def record(kind, phase, objects, rig):
        arrays = {}
        result = measure(objects, rig, arrays)
        filename = f'case-{len(report["cases"]):02d}.npz'
        np.savez(output / filename, **arrays)
        result.update(kind=kind, phase=phase, cache=dict(path=filename, sha256=probe.digest(output / filename)))
        report['cases'].append(result)
        save()
        return result

    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(original_file))
        rig = bpy.data.objects['SIM_01_SHARED_RIG']
        objects = objects_for(rig)
        action = bpy.data.actions.get('read')
        if action is None:
            raise ValueError('The original saved read action is missing')
        original_rest = rest_identity(objects, rig)
        report['original_rest_identity'] = save_rest(output, 'original', original_rest)
        saved_frames, generated_frames = {}, {}
        for phase, frame in zip(torso.PHASES, (1, 2, 3, 4)):
            rig.animation_data.action = action
            bpy.context.scene.frame_set(frame)
            result = record('original_saved_read', phase, objects, rig)
            saved_frames[phase] = {name: Matrix(value) for name, value in result['frames'].items()}
        for phase in torso.PHASES:
            rig.animation_data.action = None
            probe.pose(rig, 'read', phase)
            result = record('original_pose_generator', phase, objects, rig)
            generated_frames[phase] = {name: Matrix(value) for name, value in result['frames'].items()}
        bpy.ops.wm.open_mainfile(filepath=str(binding_dir / 'derived-waist-binding.blend'))
        rig = bpy.data.objects['SIM_01_SHARED_RIG']
        rig.animation_data.action = None
        rig.data.pose_position = 'POSE'
        objects = objects_for(rig)
        target_rest = rest_identity(objects, rig)
        report['target_rest_identity'] = save_rest(output, 'target', target_rest)
        report['rest_mesh_correspondence'] = {}
        for name, original_mesh in original_rest['meshes'].items():
            target = target_rest['meshes'][name]
            error = float(np.linalg.norm(np.asarray(original_mesh['points']) - np.asarray(target['points']), axis=1).max())
            same_topology = original_mesh['polygons'] == target['polygons']
            same_binding = original_mesh['groups'] == target['groups'] and original_mesh['weights'] == target['weights']
            report['rest_mesh_correspondence'][name] = dict(maximum_coordinate_error=error, topology_equal=same_topology, binding_equal=same_binding)
            if error > .00001 or not same_topology or not same_binding:
                raise ValueError(f'Original and sofa contact geometry differ: {name}')
        torso.depth.coupled.PARAMETERS = (0, .08, .18)
        for phase in torso.PHASES:
            probe.reading_pose(rig, phase)
            torso.depth.coupled.coupled_arms(rig)
            record('current_endpoint_adapter', phase, objects, rig)
        profile = probe.PROFILES['sofa']
        shift = Matrix.Translation(Vector((0, profile['hip_y'], profile['z_offset'])) - Vector((0, -.06, -.33)))
        for kind, source_frames in (('full_saved_frame_control', saved_frames), ('full_generated_frame_control', generated_frames)):
            for phase in torso.PHASES:
                probe.apply(rig, 'sofa', phase)
                for name in torso.BONES:
                    deformation = source_frames[phase][name] @ Matrix(original_rest['bones'][name]).inverted()
                    rig.pose.bones[name].matrix = shift @ deformation @ rig.data.bones[name].matrix_local
                    bpy.context.view_layer.update()
                rig['book_visible'] = 1.
                rig['eyes_closed'] = 0.
                bpy.context.view_layer.update()
                torso.depth.coupled.coupled_arms(rig)
                record(kind, phase, objects, rig)
        for phase in torso.PHASES:
            reference = next(row for row in report['cases'] if row['kind'] == 'original_saved_read' and row['phase'] == phase)
            a = np.load(output / reference['cache']['path'])
            for case in [row for row in report['cases'] if row['phase'] == phase and row is not reference]:
                b = np.load(output / case['cache']['path'])
                errors = {name: float(np.linalg.norm(a[name + '/book_relative_points'] - b[name + '/book_relative_points'], axis=1).max())
                          for name in original_rest['meshes']}
                report['comparisons'].append(dict(phase=phase, kind=case['kind'], book_relative_geometry_errors=errors,
                    relative_frame_component_error={side: float(np.max(np.abs(np.asarray(case['relative_hand_book'][side]) - np.asarray(reference['relative_hand_book'][side])))) for side in ('L', 'R')}))
        if any(probe.digest(Path(path)) != sha for path, sha in inputs.items()):
            raise ValueError('A source-grip comparison input changed')
        report['state'] = 'complete'
        report['acceptance'] = 'Provenance/retarget diagnosis only; no new grip or pose acceptance'
    except BaseException as error:
        report['state'] = 'failed'
        report['error'] = repr(error)
        raise
    finally:
        save()


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:]
    run(Path(args[0]), Path(args[1]))
