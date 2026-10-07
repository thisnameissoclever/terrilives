"""Audit original and derived rest geometry in separate visibility-safe contexts."""
import collections
import json
import math
import os
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
import probe_sofa_derived_binding as metrics
import sofa_rest_initialization as initialize

audit, torso, probe, witness = metrics.audit, metrics.torso, metrics.probe, metrics.witness
CHANGED, ACCESSORIES, FIELD = metrics.CHANGED, metrics.ACCESSORIES, metrics.FIELD
ATTACHMENT_TARGET = {name: ('Shirt placket' if name.startswith('Small horn button') else 'Overshirt body')
                     for name in ACCESSORIES}


def run(audit_dir, output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Background Blender and a new absolute output directory are required')
    output.mkdir(parents=True, exist_ok=False)
    original = json.loads((audit_dir / 'proof.json').read_text(encoding='utf-8'))
    inputs = dict(original['inputs'])
    for path in (Path(__file__), Path(metrics.__file__), Path(initialize.__file__), audit_dir / 'proof.json', audit_dir / 'source-binding.npz'):
        inputs[str(path)] = probe.digest(path)
    if any(probe.digest(Path(path)) != sha for path, sha in original['inputs'].items()):
        raise ValueError('An original audit input changed')
    report = dict(state='running', stage='original-rest-context', pid=os.getpid(), background=True,
                  blender_version=bpy.app.version_string, inputs=inputs, cases=[], weight_changes={}, rest_contexts={},
                  scope='Derived waist binding only; hand support and complete pose acceptance remain separate')

    def save():
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')

    save()
    try:
        source = probe.MODELS / probe.PROFILES['sofa']['source']
        scene, root, rigs, bodies, furniture, origins = witness.prepare(source)
        objects = [{obj.get('probe_source_name', obj.name): obj for obj in body.all_objects if obj.type == 'MESH'} for body in bodies]
        all_objects = [obj for owner in objects for obj in owner.values()]
        source_cache = np.load(audit_dir / 'source-binding.npz')
        low = float(source_cache['Trouser hip bridge/raw_points'][:, 2].max())
        hinge = original['rest_bones']['spine']['head'][2]
        shirt_points = source_cache['Overshirt body/raw_points']
        high = float(min(z for z in shirt_points[:, 2] if z > hinge))
        report['anatomical_transition'] = dict(pelvis_through=low, spine_from=high, spine_hinge=hinge,
            formula='smoothstep((source_z - pelvis_through) / (spine_from - pelvis_through))',
            justification='Original pelvis upper control ring and first original shirt control ring above the spine hinge')
        t = np.clip((shirt_points[:, 2] - low) / (high - low), 0, 1)
        weights = {'Overshirt body': t * t * (3 - 2 * t)}
        # These provenance/scalar attributes do not change geometry or skin weights.
        for owner in objects:
            for obj in owner.values():
                tag = obj.data.attributes.get(audit.TAG) or obj.data.attributes.new(audit.TAG, 'INT', 'FACE')
                for face, value in zip(obj.data.polygons, tag.data):
                    value.value = face.index
        shirt = objects[0]['Overshirt body']
        field = shirt.data.attributes.new(FIELD, 'FLOAT', 'POINT')
        for entry, share in zip(field.data, weights['Overshirt body']):
            entry.value = float(share)
        original_state = initialize.RestAudit(all_objects, rigs)
        try:
            hierarchy = original_state.activate()
            rest = {name: audit.geometry(obj, rigs[0]) for name, obj in objects[0].items()}
            shirt_shares = metrics.field_values(shirt)
            mapping = {}
            for name in ACCESSORIES:
                obj = objects[0][name]
                target_name = ATTACHMENT_TARGET[name]
                parent = rest[target_name]
                shares = shirt_shares if target_name == 'Overshirt body' else weights[target_name]
                if len(shares) != len(parent['points']):
                    raise ValueError(f'Attachment field vertex correspondence failed: {target_name}')
                rows, values = [], []
                for vertex in obj.data.vertices:
                    point = obj.matrix_world @ vertex.co
                    closest, normal, face, distance = parent['tree'].find_nearest(point)
                    tri = parent['triangles'][face]
                    bary = audit.barycentric(np.asarray(closest), parent['points'][tri])
                    values.append(float(np.clip(bary @ shares[tri], 0, 1)))
                    rows.append([int(face), *bary.tolist(), float(distance)])
                weights[name], mapping[name] = np.asarray(values), np.asarray(rows, dtype=np.float64)
            report['rest_contexts']['original'] = dict(maximum_hierarchy_residual=max(hierarchy.values()),
                                                       parts=len(rest), no_binding_changes=True)
        finally:
            restoration = original_state.restore()
            report['rest_contexts'].setdefault('original', {})['restoration'] = restoration
            save()
        normalized = {}
        for name, data in rest.items():
            normalized[name + '/rest_points'] = data['local']
            normalized[name + '/world_points'] = data['points']
            normalized[name + '/triangles'] = data['triangles']
            normalized[name + '/source_faces'] = data['parent_faces']
        np.savez(output / 'normalized-rest.npz', **normalized)
        report['normalized_rest_sha256'] = probe.digest(output / 'normalized-rest.npz')
        # Intentional rebinding happens only between the two guarded rest contexts.
        report['stage'] = 'intentional-binding-change'
        weight_cache = {}
        for name, values in weights.items():
            weight_cache[name + '/old_weights'] = source_cache[name + '/weights']
            weight_cache[name + '/new_hips_spine'] = np.stack((1 - values, values), axis=1)
            if name in mapping:
                weight_cache[name + '/source_attachment_triangle_barycentric_gap'] = mapping[name]
            report['weight_changes'][name] = dict(vertices=len(values), changed_vertices=int(np.count_nonzero(values != 1.)),
                old_groups=original['saved_objects'][name]['groups'], new_groups=['hips', 'spine'],
                spine_min=float(values.min()), spine_max=float(values.max()))
            if name in mapping:
                report['weight_changes'][name]['attachment_target'] = ATTACHMENT_TARGET[name]
                report['weight_changes'][name]['source_gap_range'] = [float(mapping[name][:, 4].min()), float(mapping[name][:, 4].max())]
            for owner in objects:
                metrics.set_weights(owner[name], values)
                field = owner[name].data.attributes.get(FIELD) or owner[name].data.attributes.new(FIELD, 'FLOAT', 'POINT')
                for entry, value in zip(field.data, values):
                    entry.value = float(value)
        anchors = {name: metrics.source_attachment(rest[name], rest[ATTACHMENT_TARGET[name]]) for name in ACCESSORIES}
        for name, values in anchors.items():
            weight_cache[name + '/source_intersection_material_anchors'] = values
        np.savez(output / 'binding-deltas.npz', **weight_cache)
        report['binding_deltas_sha256'] = probe.digest(output / 'binding-deltas.npz')
        derived_state = initialize.RestAudit(all_objects, rigs)
        original_meshes = original_state.before_identity['meshes']
        derived_meshes = derived_state.before_identity['meshes']
        protected = ('geometry', 'materials', 'material_indices', 'object_basis', 'parent_inverse')
        if original_state.before_identity['bones'] != derived_state.before_identity['bones']:
            raise ValueError('Intentional rebinding changed the source rest skeleton')
        if any(original_meshes[name][key] != derived_meshes[name][key] for name in original_meshes for key in protected):
            raise ValueError('Intentional rebinding changed protected source geometry/materials/transforms')
        report['protected_raw_identity_equal'] = True
        report['stage'] = 'derived-rest-context'
        try:
            hierarchy = derived_state.activate()
            report['rest_equality'] = {}
            for name, before in rest.items():
                after = audit.geometry(objects[0][name], rigs[0])
                topology = before['polygons'] == after['polygons']
                finite = bool(np.isfinite(before['points']).all() and np.isfinite(after['points']).all())
                exact = np.array_equal(before['points'], after['points'])
                residual = float(np.linalg.norm(after['points'] - before['points'], axis=1).max()) if before['points'].shape == after['points'].shape else None
                report['rest_equality'][name] = dict(ordered_topology_equal=topology, finite=finite, exact=exact, maximum_vertex_difference=residual)
                if not topology or not finite or not exact:
                    np.savez(output / 'rest-equality-failure.npz', before=before['points'], after=after['points'])
                    save()
                    raise ValueError(f'Derived rest changed: {name}, residual={residual}')
            report['rest_contexts']['derived'] = dict(maximum_hierarchy_residual=max(hierarchy.values()), parts=len(rest), no_binding_changes=True)
        finally:
            restoration = derived_state.restore()
            report['rest_contexts'].setdefault('derived', {})['restoration'] = restoration
            save()
        bpy.ops.wm.save_as_mainfile(filepath=str(output / 'derived-waist-binding.blend'))
        report['derived_source_sha256'] = probe.digest(output / 'derived-waist-binding.blend')
        original_internal = {name: metrics.internal(rest[name]) for name in CHANGED}
        torso.depth.coupled.PARAMETERS = (0, .08, .18)
        angles = {0: math.radians(17.305960723622544), 2: math.radians(17.305966041652816)}
        report['stage'] = 'all-phase-garment-screen'
        save()
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
                        metrics.add_geometry(case_cache, name, data)
                    for number, (a, b) in enumerate(audit.PAIRS):
                        segments = audit.classify(a, b, current[a], current[b], rest, original['regions'][a + '/' + b]['bounds'])
                        case['pairs'].append(dict(parts=[a, b], cache_prefix=f'pair{number}', **metrics.pack_segments(case_cache, f'pair{number}', segments)))
                    for name in CHANGED:
                        intersections = metrics.internal(current[name])
                        case_cache[name + '/internal_pairs'] = intersections
                        prior = {tuple(row) for row in original_internal[name]}
                        new = [tuple(row) for row in intersections if tuple(row) not in prior]
                        frame, inverted = metrics.orientation(current[name], rest[name], objects[index][name], rigs[index])
                        case_cache[name + '/inverted_or_collapsed_triangles'] = inverted
                        case['internal'][name] = dict(source_rest_pairs=len(prior), current_pairs=len(intersections), new_pairs=len(new), orientation=frame)
                    for name in ACCESSORIES:
                        posed = current[name]
                        target_name = ATTACHMENT_TARGET[name]
                        nearest = [current[target_name]['tree'].find_nearest(Vector(p))[3] for p in posed['points']]
                        pairs = posed['tree'].overlap(current[target_name]['tree'])
                        gaps = metrics.attachment_distances(anchors[name], posed, current[target_name])
                        case_cache[name + '/attachment_surface_pairs'] = np.asarray(pairs, dtype=np.int32).reshape((-1, 2))
                        case_cache[name + '/attachment_surface_distances'] = np.asarray(nearest)
                        case_cache[name + '/source_material_anchor_separation'] = gaps
                        case['accessory_attachment'].append(dict(part=name, target=target_name, posed_nearest_min=float(min(nearest)), posed_nearest_max=float(max(nearest)),
                            surface_pairs=len(pairs), source_material_anchor_count=len(gaps),
                            source_material_anchor_max_separation=float(gaps.max()) if len(gaps) else None,
                            status='Source material-anchor drift is measured separately from sliding waist contact'))
                    filename = f'case-{len(report["cases"]):02d}.npz'
                    np.savez(output / filename, **case_cache)
                    case['cache'] = dict(path=filename, sha256=probe.digest(output / filename))
                    report['cases'].append(case)
                    save()
        if any(probe.digest(Path(path)) != sha for path, sha in inputs.items()):
            raise ValueError('A derived-candidate input changed')
        report['state'] = 'complete'
        report['stage'] = 'complete'
        report['acceptance'] = 'Garment diagnostic only; hands, full assembly checks and visual review remain required'
    except BaseException as error:
        report['state'] = 'failed'
        report['error'] = repr(error)
        raise
    finally:
        save()


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--') + 1:]
    run(Path(arguments[0]), Path(arguments[1]))
