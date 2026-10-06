"""Diagnose saved hand frames, source-face correspondence and continuous support."""
import collections
import hashlib
import itertools
import json
import math
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import continuous_support_patch as contact


def proper(matrix):
    u, s, v = np.linalg.svd(matrix)
    return u @ v


def rotation_between(first, second):
    first, second = first / np.linalg.norm(first), second / np.linalg.norm(second)
    cross = np.cross(first, second)
    cosine = float(first @ second)
    if cosine < -1 + 1e-8:
        raise ValueError('Antiparallel minimal-frame reconstruction needs an explicit roll axis')
    skew = np.asarray([[0., -cross[2], cross[1]], [cross[2], 0., -cross[0]], [-cross[1], cross[0], 0.]])
    return np.eye(3) + skew + skew @ skew / (1 + cosine)


def triangle_parents(triangles, polygons):
    lookup = {}
    for index, polygon in enumerate(polygons):
        for triple in itertools.combinations(polygon, 3):
            key = tuple(sorted(triple))
            if key in lookup:
                raise ValueError('Ambiguous source polygon for a triangle')
            lookup[key] = index
    parents, by_polygon = [], collections.defaultdict(list)
    for triangle in triangles:
        key = tuple(sorted(int(v) for v in triangle))
        if key not in lookup:
            raise ValueError('Posed triangle is outside source evaluated polygons')
        parent = lookup[key]
        polygon = polygons[parent]
        positions = [polygon.index(int(v)) for v in triangle]
        if sum((b - a) % len(polygon) for a, b in zip(positions, positions[1:] + positions[:1])) != len(polygon):
            raise ValueError('Posed triangle reverses source polygon winding')
        parents.append(parent)
        by_polygon[parent].append(triangle)
    for index, polygon in enumerate(polygons):
        tris = by_polygon[index]
        if len(tris) != len(polygon) - 2:
            raise ValueError('Posed triangulation no longer covers the source polygon')
        edges = collections.Counter(tuple(sorted((int(a), int(b)))) for tri in tris for a, b in zip(tri, np.roll(tri, -1)))
        boundary = {tuple(sorted((a, b))) for a, b in zip(polygon, polygon[1:] + polygon[:1])}
        if {edge for edge, count in edges.items() if count == 1} != boundary or any(count not in (1, 2) for count in edges.values()):
            raise ValueError('Posed triangulation changed source polygon boundaries')
    return np.asarray(parents, dtype=np.int32)


def controls():
    support = np.asarray([[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]])
    hand = support.copy()
    hand[:, 2] = [.0005, .005, .005]
    result = contact.measure(hand, [[0, 2, 1]], support, [[0, 1, 2]], [0, 0, 1], .0015)
    expected = .5 * ((.0015 - .0005) / (.005 - .0005)) ** 2
    assert abs(result['projected_area'] - expected) < 1e-10
    disjoint = hand.copy()
    disjoint[:, 0] += 1.
    assert contact.measure(disjoint, [[0, 2, 1]], support, [[0, 1, 2]], [0, 0, 1], .0015)['projected_area'] == 0
    below = support.copy()
    below[:, 2] = -.001
    assert contact.measure(below, [[0, 2, 1]], support, [[0, 1, 2]], [0, 0, 1], .0015)['projected_area'] == 0
    return dict(single_near_vertex_with_true_continuous_patch_area=expected,
                projected_point_only_area=0, penetrated_plane_not_counted_as_support=True)


def run(hand_dir, binding_dir, audit_dir, output):
    if output.exists():
        raise ValueError('Preserve existing cached diagnostics')
    output.mkdir(parents=True)
    proof = json.loads((hand_dir / 'proof.json').read_text())
    source = json.loads((audit_dir / 'proof.json').read_text())
    geometry = np.load(hand_dir / 'resting-geometry.npz')
    rest = np.load(binding_dir / 'normalized-rest.npz')
    topology = np.load(audit_dir / 'source-binding.npz')
    ids = {name: index for index, name in enumerate(proof['bone_names'])}
    files = [Path(__file__), Path(contact.__file__), hand_dir / 'proof.json', hand_dir / 'resting-geometry.npz',
             binding_dir / 'normalized-rest.npz', audit_dir / 'proof.json', audit_dir / 'source-binding.npz']
    report = dict(state='running', inputs={str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
                  scope='Read-only cached analysis; no Blender, binding or target changes', controls=controls(), frames=[], folds=[], contacts=[])
    arrays = {}

    def save():
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n')

    save()
    for hand in proof['hands']:
        seat, side = hand['seat'], hand['side']
        row = dict(seat=seat, side=side, states={})
        for state in ('before', 'after'):
            bones = geometry[f'{state}/{seat}/bone_matrices']
            forearm, palm = (proper(bones[ids[n + '.' + side], :3, :3]) for n in ('forearm', 'hand'))
            f_rest, h_rest = (np.asarray(source['rest_bones'][n + '.' + side]['matrix'])[:3, :3] for n in ('forearm', 'hand'))
            relative = forearm.T @ palm @ (f_rest.T @ h_rest).T
            angle = math.acos(float(np.clip((np.trace(relative) - 1) / 2, -1, 1)))
            row['states'][state] = dict(shaft_angle_degrees=math.degrees(math.acos(float(np.clip(forearm[:, 1] @ palm[:, 1], -1, 1)))),
                rest_relative_wrist_rotation_degrees=math.degrees(angle), half_blend_minimum_rotation_singular_value=abs(math.cos(angle / 2)))
        before = geometry[f'before/{seat}/bone_matrices']
        after = geometry[f'after/{seat}/bone_matrices']
        world = geometry[f'after/{seat}/rig_matrix_world']
        before_world = geometry[f'before/{seat}/rig_matrix_world']
        upper_before, lower_before = (before_world @ before[ids[n + '.' + side]] for n in ('upper_arm', 'forearm'))
        wrist = (world @ after[ids['hand.' + side]])[:3, 3]
        elbow = np.asarray(hand['measurement']['elbow'])
        shoulder = upper_before[:3, 3]
        old_elbow = lower_before[:3, 3]
        old_wrist = (before_world @ before[ids['hand.' + side]])[:3, 3]
        intended_upper = rotation_between(old_elbow - shoulder, elbow - shoulder) @ upper_before[:3, :3]
        intended_lower = rotation_between(old_wrist - old_elbow, wrist - elbow) @ lower_before[:3, :3]
        row['intended_frame_maximum_component_error'] = max(float(np.abs(intended_upper - (world @ after[ids['upper_arm.' + side]])[:3, :3]).max()),
                                                          float(np.abs(intended_lower - (world @ after[ids['forearm.' + side]])[:3, :3]).max()))
        hand_direction = proper((world @ after[ids['hand.' + side]])[:3, :3])[:, 1]
        upper, lower = (source['rest_bones'][n + '.' + side]['length'] for n in ('upper_arm', 'forearm'))
        delta = wrist - shoulder
        distance = np.linalg.norm(delta)
        axis = delta / distance
        along = (upper * upper - lower * lower + distance * distance) / (2 * distance)
        centre = shoulder + along * axis
        radius = math.sqrt(max(0., upper * upper - along * along))
        direction = hand_direction - axis * (hand_direction @ axis)
        best_elbow = centre - radius * direction / np.linalg.norm(direction)
        row['minimum_shaft_angle_at_same_hand_target'] = math.degrees(math.acos(float(np.clip(((wrist - best_elbow) / lower) @ hand_direction, -1, 1))))
        row['minimum_angle_is_kinematic_bound_only'] = True
        report['frames'].append(row)
    for seat, part in ((0, 'Forearm with elbow and wrist sections.001'), (2, 'Forearm with elbow and wrist sections')):
        offsets = topology[part + '/rest_polygon_offsets']
        verts = topology[part + '/rest_polygon_vertices']
        polygons = [verts[offsets[i]:offsets[i + 1]].tolist() for i in range(len(offsets) - 1)]
        before = geometry[f'before/{seat}/{part}/triangles']
        after = geometry[f'after/{seat}/{part}/triangles']
        triangle_parents(before, polygons)
        parents = triangle_parents(after, polygons)
        pairs = geometry[f'internal/{seat}/{part}/after']
        evaluated_faces = parents[pairs]
        source_faces = topology[part + '/rest_source_faces'][evaluated_faces]
        source_offsets, source_vertices = topology[part + '/polygon_offsets'], topology[part + '/polygon_vertices']
        control_vertices = np.unique(np.concatenate([source_vertices[source_offsets[i]:source_offsets[i + 1]] for i in np.unique(source_faces)]))
        folded_vertices = np.unique(after[pairs].ravel())
        source_points = rest[part + '/rest_points'][folded_vertices]
        arrays[f'{seat}/source_face_pairs'] = source_faces
        arrays[f'{seat}/evaluated_polygon_pairs'] = evaluated_faces
        arrays[f'{seat}/source_control_vertices'] = control_vertices
        groups = source['saved_objects'][part]['groups']
        weights = topology[part + '/weights'][control_vertices]
        report['folds'].append(dict(seat=seat, part=part, triangle_pair_count=len(pairs), source_correspondence='Every posed triangle uniquely covers an original evaluated polygon with preserved winding and boundaries',
            triangulation_identical=False, source_vertex_bounds=[source_points.min(0).tolist(), source_points.max(0).tolist()],
            source_control_weight_ranges={group: [float(weights[:, i].min()), float(weights[:, i].max())] for i, group in enumerate(groups)}))
    save()
    for hand in proof['hands']:
        seat, side, measurement = hand['seat'], hand['side'], hand['measurement']
        part = 'Relaxed palm' + ('.001' if side == 'R' else '')
        target = measurement['support']
        prefix = 'furniture/' + target if target.startswith('Arm ') else f'after/{seat}/{target}'
        result = contact.measure(geometry[f'after/{seat}/{part}/points'], geometry[f'after/{seat}/{part}/triangles'],
                                 geometry[prefix + '/points'], geometry[prefix + '/triangles'], measurement['support_normal'], measurement['near_gap'])
        record = dict(seat=seat, side=side, support=target, sparse_vertex_area=measurement['patch']['area'])
        for key, value in result.items():
            if isinstance(value, np.ndarray):
                arrays[f'patch/{seat}/{side}/{key}'] = value
            else:
                record[key] = value
        report['contacts'].append(record)
        save()
    np.savez(output / 'witnesses.npz', **arrays)
    report['cache_sha256'] = hashlib.sha256((output / 'witnesses.npz').read_bytes()).hexdigest()
    report['state'] = 'complete'
    save()


if __name__ == '__main__':
    run(*(Path(value) for value in sys.argv[1:]))
