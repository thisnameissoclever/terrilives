"""Extract saved bindings and map waist intersection segments into source anatomy."""
import collections
import hashlib
import json
import math
import os
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).parent))
import probe_sofa_outward_torso as torso

probe = torso.probe
witness = torso.witness
PARTS = ['Overshirt body', 'Shirt lower hem', 'Trouser hip bridge',
         'Tailored trouser leg', 'Tailored trouser leg.001']
PAIRS = [(shirt, lower) for shirt in PARTS[:2] for lower in PARTS[2:]]
TAG = '_sofa_audit_source_face'
NUMERICAL_EPS = 1e-8


def geometry(obj, rig):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        mesh.calc_loop_triangles()
        points = np.asarray([list(evaluated.matrix_world @ v.co) for v in mesh.vertices], dtype=np.float64)
        rest_basis = rig.matrix_world.inverted() @ evaluated.matrix_world
        local = np.asarray([list(rest_basis @ v.co) for v in mesh.vertices], dtype=np.float64)
        polygons = [tuple(p.vertices) for p in mesh.polygons]
        triangles = np.asarray([tuple(t.vertices) for t in mesh.loop_triangles], dtype=np.int32)
        triangle_polygons = np.asarray([t.polygon_index for t in mesh.loop_triangles], dtype=np.int32)
        attribute = mesh.attributes.get(TAG)
        parent_faces = np.asarray([v.value for v in attribute.data], dtype=np.int32) if attribute else None
        return dict(points=points, local=local, polygons=polygons, triangles=triangles,
                    triangle_polygons=triangle_polygons, parent_faces=parent_faces,
                    tree=BVHTree.FromPolygons(points.tolist(), triangles.tolist(), all_triangles=True, epsilon=0))
    finally:
        evaluated.to_mesh_clear()


def modifiers(obj):
    result = []
    for item in obj.modifiers:
        properties = {}
        for prop in item.bl_rna.properties:
            name = prop.identifier
            if name == 'rna_type':
                continue
            try:
                value = getattr(item, name)
                if isinstance(value, (str, int, float, bool)) or value is None:
                    properties[name] = value
                elif isinstance(value, bpy.types.ID):
                    properties[name] = dict(id_name=value.name, id_type=type(value).__name__)
                elif getattr(prop, 'is_array', False):
                    properties[name] = list(value)
            except (AttributeError, TypeError, ValueError):
                pass
        result.append(dict(name=item.name, type=item.type, properties=properties))
    return result


def boundary_components(data):
    edges = collections.Counter(tuple(sorted((a, b))) for p in data['polygons'] for a, b in zip(p, (*p[1:], p[0])))
    adjacency = collections.defaultdict(set)
    for (a, b), count in edges.items():
        if count == 1:
            adjacency[a].add(b)
            adjacency[b].add(a)
    remaining = set(adjacency)
    components = []
    while remaining:
        todo = [remaining.pop()]
        found = set(todo)
        while todo:
            for neighbor in adjacency[todo.pop()]:
                if neighbor not in found:
                    found.add(neighbor)
                    remaining.discard(neighbor)
                    todo.append(neighbor)
        points = data['local'][sorted(found)]
        components.append(dict(vertices=sorted(found), bounds=[points.min(0).tolist(), points.max(0).tolist()],
                               degree_counts=dict(collections.Counter(len(adjacency[i]) for i in found))))
    return components


def plane_slice(tri, origin, normal):
    distances = (tri - origin) @ normal
    points = []
    for i in range(3):
        j = (i + 1) % 3
        if abs(distances[i]) <= NUMERICAL_EPS:
            points.append(tri[i])
        if distances[i] * distances[j] < 0:
            points.append(tri[i] + (tri[j] - tri[i]) * distances[i] / (distances[i] - distances[j]))
    return points


def intersection_segment(first, second):
    normal_a = np.cross(first[1] - first[0], first[2] - first[0])
    normal_b = np.cross(second[1] - second[0], second[2] - second[0])
    lengths = [np.linalg.norm(normal_a), np.linalg.norm(normal_b)]
    if min(lengths) <= 1e-15:
        return dict(kind='unresolved_degenerate_triangle')
    normal_a /= lengths[0]
    normal_b /= lengths[1]
    direction = np.cross(normal_a, normal_b)
    length = np.linalg.norm(direction)
    if length <= 1e-9:
        return dict(kind='unresolved_coplanar_or_parallel')
    direction /= length
    first_slice = plane_slice(first, second[0], normal_b)
    second_slice = plane_slice(second, first[0], normal_a)
    if not first_slice or not second_slice:
        return dict(kind='unresolved_numerical_slice')
    anchor = first_slice[0]
    a = [float((p - anchor) @ direction) for p in first_slice]
    b = [float((p - anchor) @ direction) for p in second_slice]
    low, high = max(min(a), min(b)), min(max(a), max(b))
    if high < low - NUMERICAL_EPS:
        return dict(kind='unresolved_nonoverlapping_slices', separation=low - high)
    return dict(kind='segment', endpoints=[(anchor + low * direction).tolist(), (anchor + high * direction).tolist()],
                length=max(0., high - low))


def barycentric(point, triangle):
    u, v, p = triangle[1] - triangle[0], triangle[2] - triangle[0], point - triangle[0]
    uu, uv, vv = u @ u, u @ v, v @ v
    determinant = uu * vv - uv * uv
    if determinant <= 1e-25:
        raise ValueError('Degenerate barycentric mapping')
    beta = (vv * (p @ u) - uv * (p @ v)) / determinant
    gamma = (uu * (p @ v) - uv * (p @ u)) / determinant
    return np.asarray([1 - beta - gamma, beta, gamma])


def classify(first_name, second_name, first, second, rest, envelope):
    result = []
    for ai, bi in first['tree'].overlap(second['tree']):
        av, bv = first['triangles'][ai], second['triangles'][bi]
        a, b = first['points'][av], second['points'][bv]
        record = dict(triangles=[ai, bi], vertices=[av.tolist(), bv.tolist()],
                      evaluated_polygons=[int(first['triangle_polygons'][ai]), int(second['triangle_polygons'][bi])],
                      world_triangles=[a.tolist(), b.tolist()], **intersection_segment(a, b))
        record['source_polygons'] = [int(first['parent_faces'][record['evaluated_polygons'][0]]),
                                     int(second['parent_faces'][record['evaluated_polygons'][1]])]
        if record['kind'] == 'segment':
            mapped_a, mapped_b, residuals, barycentrics = [], [], [], []
            for endpoint in np.asarray(record['endpoints']):
                wa, wb = barycentric(endpoint, a), barycentric(endpoint, b)
                barycentrics.extend([wa.tolist(), wb.tolist()])
                mapped_a.append((wa @ rest[first_name]['local'][av]).tolist())
                mapped_b.append((wb @ rest[second_name]['local'][bv]).tolist())
                residuals.extend([float(np.linalg.norm(wa @ a - endpoint)), float(np.linalg.norm(wb @ b - endpoint))])
            record['source_endpoints'] = [mapped_a, mapped_b]
            record['maximum_mapping_residual'] = max(residuals)
            record['barycentrics'] = barycentrics
            if max(residuals) > 1e-6 or min(min(values) for values in barycentrics) < -1e-5:
                record['classification'] = 'unresolved_segment_mapping'
                result.append(record)
                continue
            low, high = np.asarray(envelope[0]), np.asarray(envelope[1])
            outside_a = any(np.any(np.asarray(point) < low - NUMERICAL_EPS) or np.any(np.asarray(point) > high + NUMERICAL_EPS)
                            for point in mapped_a)
            outside_b = any(np.any(np.asarray(point) < low - NUMERICAL_EPS) or np.any(np.asarray(point) > high + NUMERICAL_EPS)
                            for point in mapped_b)
            record['classification'] = 'outside_source_overlap_envelope' if outside_a or outside_b else 'inside_source_overlap_envelope_unverified_attachment'
            record['source_side_outside'] = [outside_a, outside_b]
        else:
            record['classification'] = 'unresolved_segment'
        result.append(record)
    return result


def run(output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Background Blender and a new absolute output directory are required')
    output.mkdir(parents=True, exist_ok=False)
    source = probe.MODELS / probe.PROFILES['sofa']['source']
    files = {source, Path(__file__), Path(torso.__file__), Path(torso.depth.__file__), Path(torso.depth.regions.__file__),
             Path(witness.__file__), Path(torso.depth.coupled.__file__), Path(probe.__file__)}
    for module in list(sys.modules.values()):
        filename = getattr(module, '__file__', None)
        if filename and Path(filename).resolve().is_relative_to(probe.MODELS):
            files.add(Path(filename).resolve())
    inputs = {str(path): probe.digest(path) for path in files}
    report = dict(state='running', stage='saved-binding-extraction', pid=os.getpid(), background=True,
                  blender_version=bpy.app.version_string, inputs=inputs, saved_objects={}, regions={}, cases=[],
                  classification='Anatomical source-overlap envelope screen; region membership alone does not certify a valid attachment',
                  numerical_segment_epsilon=NUMERICAL_EPS)

    def save():
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')

    save()
    try:
        scene, root, rigs, bodies, furniture, origins = witness.prepare(source)
        rig = rigs[0]
        arrays = {}
        report['rest_bones'] = {b.name: dict(head=list(b.head_local), tail=list(b.tail_local),
            matrix=[list(row) for row in b.matrix_local], parent=b.parent.name if b.parent else None,
            length=b.length, use_deform=b.use_deform) for b in rig.data.bones}
        for obj in bodies[0].all_objects:
            if obj.type != 'MESH':
                continue
            name = obj.get('probe_source_name', obj.name)
            group_names = [g.name for g in obj.vertex_groups]
            weights = np.zeros((len(obj.data.vertices), len(group_names)), dtype=np.float64)
            for v in obj.data.vertices:
                for group in v.groups:
                    weights[v.index, group.group] = group.weight
            relative = rig.matrix_world.inverted() @ obj.matrix_world
            points = np.asarray([list(relative @ v.co) for v in obj.data.vertices], dtype=np.float64)
            polygons = [list(p.vertices) for p in obj.data.polygons]
            arrays[name + '/raw_points'] = points
            arrays[name + '/weights'] = weights
            arrays[name + '/polygon_offsets'] = np.cumsum([0] + [len(p) for p in polygons], dtype=np.int32)
            arrays[name + '/polygon_vertices'] = np.asarray([v for p in polygons for v in p], dtype=np.int32)
            report['saved_objects'][name] = dict(vertices=len(points), polygons=len(polygons), groups=group_names,
                weight_summary={group: dict(nonzero=int(np.count_nonzero(weights[:, i])), minimum=float(weights[:, i].min()),
                    maximum=float(weights[:, i].max())) for i, group in enumerate(group_names)},
                normalization_error=float(np.max(np.abs(weights.sum(1) - 1))), modifiers=modifiers(obj),
                raw_bounds=[points.min(0).tolist(), points.max(0).tolist()],
                materials=[mat.name if mat else None for mat in obj.data.materials],
                material_indices=[p.material_index for p in obj.data.polygons],
                matrix_world=[list(row) for row in obj.matrix_world], mesh_sha256=hashlib.sha256(points.tobytes()).hexdigest())
        save()
        # Provenance-only face tags live in memory and do not alter vertices, weights or saved inputs.
        for body in bodies:
            for obj in body.all_objects:
                if obj.type != 'MESH':
                    continue
                attr = obj.data.attributes.new(TAG, 'INT', 'FACE')
                for face, value in zip(obj.data.polygons, attr.data):
                    value.value = face.index
        report['provenance_method'] = 'Saved source polygon indices propagated through modifiers as an in-memory integer face attribute; no binary saved'
        for actor in rigs:
            actor.data.pose_position = 'REST'
            actor['book_visible'] = 1.
        bpy.context.view_layer.update()
        rest = {}
        for obj in bodies[0].all_objects:
            if obj.type != 'MESH':
                continue
            name = obj.get('probe_source_name', obj.name)
            data = geometry(obj, rig)
            rest[name] = data
            arrays[name + '/rest_points'] = data['local']
            arrays[name + '/rest_triangles'] = data['triangles']
            arrays[name + '/rest_polygon_offsets'] = np.cumsum([0] + [len(p) for p in data['polygons']], dtype=np.int32)
            arrays[name + '/rest_polygon_vertices'] = np.asarray([v for p in data['polygons'] for v in p], dtype=np.int32)
            arrays[name + '/rest_source_faces'] = data['parent_faces']
            report['saved_objects'][name]['evaluated_rest'] = dict(vertices=len(data['local']), polygons=len(data['polygons']),
                bounds=[data['local'].min(0).tolist(), data['local'].max(0).tolist()],
                boundary_components=boundary_components(data),
                source_face_id_range=[int(data['parent_faces'].min()), int(data['parent_faces'].max())])
        np.savez(output / 'source-binding.npz', **arrays)
        report['source_binding_sha256'] = probe.digest(output / 'source-binding.npz')
        for a, b in PAIRS:
            low = np.maximum(rest[a]['local'].min(0), rest[b]['local'].min(0))
            high = np.minimum(rest[a]['local'].max(0), rest[b]['local'].max(0))
            report['regions'][a + '/' + b] = dict(bounds=[low.tolist(), high.tolist()],
                defined_before_pose=True, rule='Intersection of complete evaluated source-rest part bounds, independent of failing pose triangles',
                status='Necessary source-overlap envelope, not a blanket contact permission')
        save()
        # Source-rest positive evidence is recorded against the same envelope before posing.
        report['source_rest_contacts'] = []
        for a, b in PAIRS:
            found = classify(a, b, rest[a], rest[b], rest, report['regions'][a + '/' + b]['bounds'])
            report['source_rest_contacts'].append(dict(parts=[a, b], crossings=found))
        for actor in rigs:
            actor.data.pose_position = 'POSE'
        torso.depth.coupled.PARAMETERS = (0, .08, .18)
        report['stage'] = 'phase-zero-attachment-segments'
        angles = {0: math.radians(17.305960723622544), 2: math.radians(17.305966041652816)}
        for state in ('upright', 'outward'):
            torso.base_pose(rigs, origins, 'sit', 0.)
            if state == 'outward':
                for index, sign in ((0, -1), (2, 1)):
                    torso.apply_torso(rigs[index], angles[index], sign)
            bpy.context.view_layer.update()
            for index in (0, 2):
                objects = {obj.get('probe_source_name', obj.name): obj for obj in bodies[index].all_objects}
                current = {name: geometry(objects[name], rigs[index]) for name in PARTS}
                for name, data in current.items():
                    if len(data['points']) != len(rest[name]['local']) or data['polygons'] != rest[name]['polygons']:
                        raise ValueError(f'Current-to-source evaluated topology changed: {state}/{index}/{name}')
                    if not np.array_equal(data['parent_faces'], rest[name]['parent_faces']):
                        raise ValueError(f'Source polygon provenance changed: {state}/{index}/{name}')
                case = dict(state=state, seat=index, topology_and_source_polygons_match=True, pairs=[])
                for a, b in PAIRS:
                    segments = classify(a, b, current[a], current[b], rest, report['regions'][a + '/' + b]['bounds'])
                    case['pairs'].append(dict(parts=[a, b], counts=dict(collections.Counter(r['classification'] for r in segments)),
                                             crossings=segments))
                report['cases'].append(case)
                save()
        if any(probe.digest(Path(path)) != sha for path, sha in inputs.items()):
            raise ValueError('An audit input changed')
        report['state'] = 'complete'
        report['stage'] = 'complete'
        report['acceptance'] = 'Extraction and attachment diagnostic only; no weights changed and no pose accepted'
    except BaseException as error:
        report['state'] = 'failed'
        report['error'] = repr(error)
        raise
    finally:
        save()


if __name__ == '__main__':
    run(Path(sys.argv[sys.argv.index('--') + 1]))
