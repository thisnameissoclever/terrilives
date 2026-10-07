"""Create a separate anatomical waist binding and retain compact indexed diagnostics."""
import collections
import json
import math
from pathlib import Path
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
import audit_sofa_binding as audit

torso = audit.torso
probe = audit.probe
witness = audit.witness
FIELD = '_sofa_derived_spine_share'
ACCESSORIES = ['Shirt lower hem', 'Shirt placket', 'Small horn button', 'Small horn button.001']
CHANGED = ['Overshirt body'] + ACCESSORIES


def set_weights(obj, shares):
    spine = obj.vertex_groups.get('spine') or obj.vertex_groups.new(name='spine')
    hips = obj.vertex_groups.get('hips') or obj.vertex_groups.new(name='hips')
    for index, share in enumerate(shares):
        spine.add([index], float(share), 'REPLACE')
        hips.add([index], float(1 - share), 'REPLACE')


def field_values(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        return np.asarray([v.value for v in mesh.attributes[FIELD].data], dtype=np.float64)
    finally:
        evaluated.to_mesh_clear()


def internal(data):
    triangles = data['triangles']
    return np.asarray([(a, b) for a, b in data['tree'].overlap(data['tree'])
                       if a < b and not set(triangles[a]) & set(triangles[b])], dtype=np.int32).reshape((-1, 2))


def source_attachment(first, second):
    rows = []
    for a, b in first['tree'].overlap(second['tree']):
        av, bv = first['triangles'][a], second['triangles'][b]
        ta, tb = first['points'][av], second['points'][bv]
        segment = audit.intersection_segment(ta, tb)
        if segment['kind'] != 'segment':
            continue
        for point in np.asarray(segment['endpoints']):
            wa, wb = audit.barycentric(point, ta), audit.barycentric(point, tb)
            rows.append([*av.tolist(), *bv.tolist(), *wa.tolist(), *wb.tolist()])
    return np.asarray(rows, dtype=np.float64).reshape((-1, 12))


def attachment_distances(mapping, first, second):
    if not len(mapping):
        return np.empty(0)
    a = first['points'][mapping[:, :3].astype(np.int32)]
    b = second['points'][mapping[:, 3:6].astype(np.int32)]
    return np.linalg.norm(np.einsum('ni,nij->nj', mapping[:, 6:9], a)
                          - np.einsum('ni,nij->nj', mapping[:, 9:12], b), axis=1)


def orientation(data, rest, obj, rig):
    tri = data['triangles']
    original = rest['points'][tri]
    moved = data['points'][tri]
    normals = np.cross(original[:, 1] - original[:, 0], original[:, 2] - original[:, 0])
    posed = np.cross(moved[:, 1] - moved[:, 0], moved[:, 2] - moved[:, 0])
    source_area, posed_area = np.linalg.norm(normals, axis=1), np.linalg.norm(posed, axis=1)
    valid = source_area > 1e-12
    normals /= np.where(valid, source_area, 1)[:, None]
    posed /= np.where(posed_area > 1e-12, posed_area, 1)[:, None]
    transforms = {name: np.asarray(rig.matrix_world.to_3x3() @ rig.pose.bones[name].matrix.to_3x3()
                    @ rig.data.bones[name].matrix_local.to_3x3().inverted() @ rig.matrix_world.to_3x3().inverted())
                  for name in ('hips', 'spine')}
    share = field_values(obj)[tri].mean(axis=1)
    expected = (1 - share[:, None]) * (normals @ transforms['hips'].T) + share[:, None] * (normals @ transforms['spine'].T)
    expected /= np.maximum(np.linalg.norm(expected, axis=1), 1e-15)[:, None]
    dots = (expected * posed).sum(axis=1)
    invalid = np.flatnonzero(valid & ((dots <= 0) | (posed_area <= 1e-12)))
    return dict(minimum_orientation_dot=float(dots[valid].min()),
                source_degenerate=int(np.count_nonzero(~valid)), inverted_or_collapsed=len(invalid)), invalid


def add_geometry(cache, name, data):
    cache[name + '/points'] = data['points']
    cache[name + '/triangles'] = data['triangles']
    cache[name + '/triangle_polygons'] = data['triangle_polygons']
    cache[name + '/source_faces'] = data['parent_faces']


def pack_segments(cache, key, segments):
    labels = sorted({row['classification'] for row in segments})
    cache[key + '/indices'] = np.asarray([row['triangles'] for row in segments], dtype=np.int32).reshape((-1, 2))
    cache[key + '/source_polygons'] = np.asarray([row['source_polygons'] for row in segments], dtype=np.int32).reshape((-1, 2))
    cache[key + '/classification'] = np.asarray([labels.index(row['classification']) for row in segments], dtype=np.int8)
    cache[key + '/endpoints'] = np.asarray([row.get('endpoints', [[math.nan] * 3] * 2) for row in segments], dtype=np.float64).reshape((-1, 2, 3))
    cache[key + '/source_endpoints'] = np.asarray([row.get('source_endpoints', [[[math.nan] * 3] * 2] * 2)
                                                  for row in segments], dtype=np.float64).reshape((-1, 2, 2, 3))
    return dict(classification_labels=labels, counts=dict(collections.Counter(row['classification'] for row in segments)),
                maximum_mapping_residual=max((row.get('maximum_mapping_residual', 0.) for row in segments), default=0.))


def run(audit_dir, output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Background Blender and a new absolute output directory are required')
    output.mkdir(parents=True, exist_ok=False)
    original = json.loads((audit_dir / 'proof.json').read_text(encoding='utf-8'))
    inputs = dict(original['inputs'])
    for path in (Path(__file__), audit_dir / 'proof.json', audit_dir / 'source-binding.npz'):
        inputs[str(path)] = probe.digest(path)
    if any(probe.digest(Path(path)) != sha for path, sha in original['inputs'].items()):
        raise ValueError('An original audit input changed')
    report = dict(state='running', stage='derive-binding', pid=os.getpid(), background=True,
                  blender_version=bpy.app.version_string, inputs=inputs, cases=[], weight_changes={},
                  scope='Derived waist binding only; hands remain independent unfinished work; no render or accepted pose')

    def save():
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')

    save()
    try:
        source = probe.MODELS / probe.PROFILES['sofa']['source']
        scene, root, rigs, bodies, furniture, origins = witness.prepare(source)
        source_cache = np.load(audit_dir / 'source-binding.npz')
        source_hip_top = float(source_cache['Trouser hip bridge/raw_points'][:, 2].max())
        hinge = original['rest_bones']['spine']['head'][2]
        shirt_points = source_cache['Overshirt body/raw_points']
        upper_ring = float(min(z for z in shirt_points[:, 2] if z > hinge))
        report['anatomical_transition'] = dict(pelvis_through=source_hip_top, spine_from=upper_ring,
            spine_hinge=hinge, formula='smoothstep((source_z - pelvis_through) / (spine_from - pelvis_through))',
            justification='Original pelvis upper control ring and first original shirt control ring above the spine hinge')
        objects = [{obj.get('probe_source_name', obj.name): obj for obj in body.all_objects if obj.type == 'MESH'} for body in bodies]
        for actor in rigs:
            actor.data.pose_position = 'REST'
            actor['book_visible'] = 1.
        for owner in objects:
            for obj in owner.values():
                attr = obj.data.attributes.new(audit.TAG, 'INT', 'FACE')
                for face, value in zip(obj.data.polygons, attr.data):
                    value.value = face.index
        bpy.context.view_layer.update()
        rest = {name: audit.geometry(obj, rigs[0]) for name, obj in objects[0].items()}
        t = np.clip((shirt_points[:, 2] - source_hip_top) / (upper_ring - source_hip_top), 0, 1)
        weights = {'Overshirt body': t * t * (3 - 2 * t)}
        shirt = objects[0]['Overshirt body']
        attr = shirt.data.attributes.new(FIELD, 'FLOAT', 'POINT')
        for value, share in zip(attr.data, weights['Overshirt body']):
            value.value = float(share)
        set_weights(shirt, weights['Overshirt body'])
        bpy.context.view_layer.update()
        shares = field_values(shirt)
        parent = audit.geometry(shirt, rigs[0])
        mapping = {}
        for name in ACCESSORIES:
            obj = objects[0][name]
            rows, values = [], []
            for vertex in obj.data.vertices:
                point = obj.matrix_world @ vertex.co
                closest, normal, face, distance = parent['tree'].find_nearest(point)
                tri = parent['triangles'][face]
                bary = audit.barycentric(np.asarray(closest), parent['points'][tri])
                share = float(np.clip(bary @ shares[tri], 0, 1))
                values.append(share)
                rows.append([int(face), *bary.tolist(), float(distance)])
            weights[name] = np.asarray(values)
            mapping[name] = np.asarray(rows, dtype=np.float64)
        weight_cache = {}
        for name, values in weights.items():
            old = source_cache[name + '/weights']
            weight_cache[name + '/old_weights'] = old
            weight_cache[name + '/new_hips_spine'] = np.stack((1 - values, values), axis=1)
            if name in mapping:
                weight_cache[name + '/shirt_attachment_triangle_barycentric_gap'] = mapping[name]
            report['weight_changes'][name] = dict(vertices=len(values), changed_vertices=int(np.count_nonzero(values != 1.)),
                old_groups=original['saved_objects'][name]['groups'], new_groups=['hips', 'spine'],
                spine_min=float(values.min()), spine_max=float(values.max()),
                mapping='Shirt evaluated source-rest field barycentrically sampled at the nearest source cloth patch' if name in mapping else 'Source anatomical control-ring field')
            for owner in objects:
                set_weights(owner[name], values)
                field = owner[name].data.attributes.get(FIELD) or owner[name].data.attributes.new(FIELD, 'FLOAT', 'POINT')
                for entry, value in zip(field.data, values):
                    entry.value = float(value)
        anchors = {name: source_attachment(rest[name], rest['Overshirt body']) for name in ACCESSORIES}
        for name, values in anchors.items():
            weight_cache[name + '/source_intersection_material_anchors'] = values
        np.savez(output / 'binding-deltas.npz', **weight_cache)
        report['binding_deltas_sha256'] = probe.digest(output / 'binding-deltas.npz')
        bpy.context.view_layer.update()
        report['rest_equality'] = {}
        for name, before in rest.items():
            after = audit.geometry(objects[0][name], rigs[0])
            if before['polygons'] != after['polygons'] or not np.array_equal(before['points'], after['points']):
                raise ValueError(f'Derived binding changed evaluated rest geometry: {name}')
            report['rest_equality'][name] = dict(vertices=len(before['points']), polygons=len(before['polygons']), exact=True)
        # Save the derived binding before pose diagnostics; originals remain untouched.
        bpy.ops.wm.save_as_mainfile(filepath=str(output / 'derived-waist-binding.blend'))
        report['derived_source_sha256'] = probe.digest(output / 'derived-waist-binding.blend')
        save()
        original_internal = {name: internal(rest[name]) for name in CHANGED}
        for actor in rigs:
            actor.data.pose_position = 'POSE'
        torso.depth.coupled.PARAMETERS = (0, .08, .18)
        angles = {0: math.radians(17.305960723622544), 2: math.radians(17.305966041652816)}
        report['stage'] = 'all-phase-garment-screen'
        for phase in torso.PHASES:
            for action in ('sit', 'read'):
                torso.base_pose(rigs, origins, action, phase)
                for index, sign in ((0, -1), (2, 1)):
                    torso.apply_torso(rigs[index], angles[index], sign)
                bpy.context.view_layer.update()
                for index in range(3):
                    case_cache = {}
                    current = {name: audit.geometry(objects[index][name], rigs[index]) for name in set(audit.PARTS + CHANGED)}
                    case = dict(phase=phase, action=action, seat=index, pairs=[], internal={}, accessory_attachment=[])
                    for name, data in current.items():
                        if data['polygons'] != rest[name]['polygons'] or not np.array_equal(data['parent_faces'], rest[name]['parent_faces']):
                            raise ValueError(f'Source topology/provenance changed: {name}')
                        add_geometry(case_cache, name, data)
                    for number, (a, b) in enumerate(audit.PAIRS):
                        segments = audit.classify(a, b, current[a], current[b], rest, original['regions'][a + '/' + b]['bounds'])
                        case['pairs'].append(dict(parts=[a, b], cache_prefix=f'pair{number}', **pack_segments(case_cache, f'pair{number}', segments)))
                    for name in CHANGED:
                        intersections = internal(current[name])
                        case_cache[name + '/internal_pairs'] = intersections
                        prior = {tuple(row) for row in original_internal[name]}
                        new = [tuple(row) for row in intersections if tuple(row) not in prior]
                        case['internal'][name] = dict(source_rest_pairs=len(prior), current_pairs=len(intersections),
                                                      new_pairs=len(new), status='New nonadjacent self-crossings require rejection/classification' if new else 'No new nonadjacent self-crossing')
                        frame, inverted = orientation(current[name], rest[name], objects[index][name], rigs[index])
                        case['internal'][name]['orientation'] = frame
                        case_cache[name + '/inverted_or_collapsed_triangles'] = inverted
                    for name in ACCESSORIES:
                        source_map = mapping[name]
                        posed = current[name]
                        # Accessory raw vertices precede modifiers; these four parts have
                        # identity post-skin topology except the hem, measured below as surfaces.
                        nearest = [current['Overshirt body']['tree'].find_nearest(Vector(p))[3] for p in posed['points']]
                        raw_gaps = source_map[:, 4]
                        surface_pairs = posed['tree'].overlap(current['Overshirt body']['tree'])
                        anchor_gaps = attachment_distances(anchors[name], posed, current['Overshirt body'])
                        case_cache[name + '/shirt_surface_pairs'] = np.asarray(surface_pairs, dtype=np.int32).reshape((-1, 2))
                        case_cache[name + '/shirt_surface_distances'] = np.asarray(nearest)
                        case_cache[name + '/source_material_anchor_separation'] = anchor_gaps
                        case['accessory_attachment'].append(dict(part=name, original_raw_nearest_min=float(raw_gaps.min()),
                            original_raw_nearest_max=float(raw_gaps.max()), posed_evaluated_nearest_min=float(min(nearest)),
                            posed_evaluated_nearest_max=float(max(nearest)), surface_pairs=len(surface_pairs),
                            source_material_anchor_count=len(anchor_gaps),
                            source_material_anchor_max_separation=float(anchor_gaps.max()) if len(anchor_gaps) else None,
                            status='Source material-anchor separation measures accessory drift; sliding waist contact is classified separately'))
                    filename = f'case-{len(report["cases"]):02d}.npz'
                    np.savez(output / filename, **case_cache)
                    case['cache'] = dict(path=filename, sha256=probe.digest(output / filename))
                    report['cases'].append(case)
                    save()
        if any(probe.digest(Path(path)) != sha for path, sha in inputs.items()):
            raise ValueError('A derived-candidate input changed')
        report['state'] = 'complete'
        report['stage'] = 'complete'
        report['acceptance'] = 'Derived garment diagnostic only; accessory continuity, hand support and final assembly/visual checks remain required'
    except BaseException as error:
        report['state'] = 'failed'
        report['error'] = repr(error)
        raise
    finally:
        save()


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:]
    run(Path(args[0]), Path(args[1]))
