"""Classify cached lap intrusions and test whether continuous support is exposed."""
import ast
import collections
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import continuous_support_patch as patch
from diagnose_sofa_hand_frames import triangle_parents


def functions_from(path):
    tree = ast.parse(path.read_text())
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                and node.name in ('plane_slice', 'intersection_segment', 'barycentric')]
    scope = {'np': np, 'NUMERICAL_EPS': 1e-8}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(path), 'exec'), scope)
    return scope


def source_map(name, triangles, topology):
    offsets, vertices = topology[name + '/rest_polygon_offsets'], topology[name + '/rest_polygon_vertices']
    polygons = [vertices[offsets[i]:offsets[i + 1]].tolist() for i in range(len(offsets) - 1)]
    parent = triangle_parents(triangles, polygons)
    return topology[name + '/rest_source_faces'][parent]


def projected_all(points, triangles, basis):
    p = np.asarray(points) @ basis
    tri = p[np.asarray(triangles)].copy()
    area = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])[:, 2]
    ids = np.flatnonzero(np.abs(area) > 1e-14)
    tri = tri[ids]
    reverse = area[ids] < 0
    tri[reverse, 1], tri[reverse, 2] = tri[reverse, 2].copy(), tri[reverse, 1].copy()
    matrices = np.concatenate((tri[:, :, :2], np.ones((len(tri), 3, 1))), axis=2)
    planes = np.linalg.solve(matrices, tri[:, :, 2, None])[:, :, 0]
    return dict(ids=ids, tri=tri, planes=planes, low=tri[:, :, :2].min(1), high=tri[:, :, :2].max(1))


def run(arm_dir, binding_dir, audit_dir, output):
    if output.exists():
        raise ValueError('Preserve prior lap classification')
    output.mkdir(parents=True)
    receipt = json.loads((arm_dir / 'proof.json').read_text())
    g = np.load(arm_dir / 'geometry.npz')
    rest = np.load(binding_dir / 'normalized-rest.npz')
    topology = np.load(audit_dir / 'source-binding.npz')
    source = json.loads((audit_dir / 'proof.json').read_text())
    segment_path = Path(__file__).with_name('audit_sofa_binding.py')
    primitive = functions_from(segment_path)
    files = [Path(__file__), segment_path, Path(patch.__file__), Path(__file__).with_name('diagnose_sofa_hand_frames.py'),
             arm_dir / 'proof.json', arm_dir / 'geometry.npz', binding_dir / 'normalized-rest.npz',
             audit_dir / 'proof.json', audit_dir / 'source-binding.npz']
    report = dict(state='running', inputs={str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}, contacts=[], exposure=[],
                  scope='Source-region and exposed-support classification from immutable caches; no pose or binding changes')
    arrays = {}
    maps = {}
    shirt_min = float(topology['Overshirt body/raw_points'][:, 2].min())

    def save():
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n')

    save()
    lap = {(0, 'L'), (1, 'L'), (1, 'R'), (2, 'R')}
    for entry in receipt['self_contacts']:
        seat = entry['seat']
        a, b = entry['parts']
        if b not in ('Overshirt body', 'Shirt lower hem', 'Trouser hip bridge') or not a.startswith(('Forearm', 'Relaxed palm', 'Turned sleeve cuff')):
            continue
        side = 'R' if a.endswith('.001') else 'L'
        if (seat, side) not in lap:
            continue
        at, bt = g[f'{seat}/{a}/triangles'], g[f'{seat}/{b}/triangles']
        for name, triangles in ((a, at), (b, bt)):
            maps.setdefault((seat, name), source_map(name, triangles, topology))
        pairs = g[entry['witness_array']]
        source_endpoints, world_endpoints, source_faces, categories, unresolved = [], [], [], [], []
        for ai, bi in pairs:
            av, bv = at[ai], bt[bi]
            ta, tb = g[f'{seat}/{a}/points'][av], g[f'{seat}/{b}/points'][bv]
            segment = primitive['intersection_segment'](ta, tb)
            if segment['kind'] != 'segment':
                unresolved.append([int(ai), int(bi), segment['kind']])
                continue
            mapped_a = [primitive['barycentric'](np.asarray(p), ta) @ rest[a + '/rest_points'][av] for p in segment['endpoints']]
            mapped_b = [primitive['barycentric'](np.asarray(p), tb) @ rest[b + '/rest_points'][bv] for p in segment['endpoints']]
            face_a, face_b = maps[(seat, a)][ai], maps[(seat, b)][bi]
            category = 'non-join body contact'
            if b == 'Overshirt body':
                offsets, verts = topology[b + '/polygon_offsets'], topology[b + '/polygon_vertices']
                original = topology[b + '/raw_points'][verts[offsets[face_b]:offsets[face_b + 1]]]
                category = 'shirt lower cap' if np.max(np.abs(original[:, 2] - shirt_min)) < 1e-8 else 'shirt exterior side panel'
            elif b == 'Shirt lower hem':
                category = 'hem exterior'
            elif b == 'Trouser hip bridge':
                category = 'pelvis exterior'
            source_endpoints.append([mapped_a, mapped_b])
            world_endpoints.append(segment['endpoints'])
            source_faces.append([int(face_a), int(face_b)])
            categories.append(category)
        prefix = f'contact{len(report["contacts"])}'
        arrays[prefix + '/source_endpoints'] = np.asarray(source_endpoints)
        arrays[prefix + '/world_endpoints'] = np.asarray(world_endpoints)
        arrays[prefix + '/source_faces'] = np.asarray(source_faces, dtype=np.int32)
        endpoints = np.asarray(source_endpoints)
        report['contacts'].append(dict(seat=seat, side=side, parts=[a, b], cache_prefix=prefix, crossing_pairs=len(pairs),
            categories=dict(collections.Counter(categories)), unresolved=unresolved,
            arm_source_bounds=[endpoints[:, 0].reshape(-1, 3).min(0).tolist(), endpoints[:, 0].reshape(-1, 3).max(0).tolist()] if len(endpoints) else None,
            body_source_bounds=[endpoints[:, 1].reshape(-1, 3).min(0).tolist(), endpoints[:, 1].reshape(-1, 3).max(0).tolist()] if len(endpoints) else None,
            classification='Forearm/palm/cuff contacts with torso or pelvis are not sleeve/cuff/wrist attachment joins; panel and closure-cap cases are retained separately'))
    save()
    for seat, side in sorted(lap):
        prefix = f'contact/{seat}/{side}'
        basis = g[prefix + '/basis']
        vertices, offsets, pairs = g[prefix + '/vertices'], g[prefix + '/offsets'], g[prefix + '/pairs']
        suffix = '.001' if side == 'R' else ''
        target_name, hand_name = 'Tailored trouser leg' + suffix, 'Relaxed palm' + suffix
        support = (g[f'{seat}/{target_name}/points'] @ basis)[g[f'{seat}/{target_name}/triangles']]
        hand = (g[f'{seat}/{hand_name}/points'] @ basis)[g[f'{seat}/{hand_name}/triangles']]
        occluders = {name: projected_all(g[f'{seat}/{name}/points'], g[f'{seat}/{name}/triangles'], basis)
                     for name in ('Overshirt body', 'Shirt lower hem', 'Shirt placket', 'Small horn button', 'Small horn button.001')}
        hits, world_support = [], []
        for cell, (hi, si) in enumerate(pairs):
            poly = vertices[offsets[cell]:offsets[cell + 1]]
            support_plane = np.linalg.solve(np.column_stack((support[si, :, :2], np.ones(3))), support[si, :, 2])
            hand_plane = np.linalg.solve(np.column_stack((hand[hi, :, :2], np.ones(3))), hand[hi, :, 2])
            heights = poly @ support_plane[:2] + support_plane[2]
            world_support.extend(np.column_stack((poly, heights)) @ basis.T)
            low, high = poly.min(0), poly.max(0)
            for name, mesh in occluders.items():
                candidates = np.flatnonzero(np.all(mesh['high'] >= low, axis=1) & np.all(mesh['low'] <= high, axis=1))
                for index in candidates:
                    overlap = patch.intersect(list(poly), mesh['tri'][index, :, :2])
                    difference = mesh['planes'][index] - support_plane
                    difference[2] -= 1e-6
                    overlap = patch.clip(overlap, difference)
                    if len(overlap) < 3 or abs(patch.signed_area(overlap)) <= 1e-14:
                        continue
                    h = np.asarray(overlap) @ (mesh['planes'][index] - support_plane)[:2] + (mesh['planes'][index] - support_plane)[2]
                    hits.append(dict(cell=cell, garment=name, triangle=int(mesh['ids'][index]), projected_area=abs(patch.signed_area(overlap)),
                                     height_above_support_range=[float(h.min()), float(h.max())]))
        p = np.asarray(world_support)
        arrays[f'exposure/{seat}/{side}/world_support_vertices'] = p
        report['exposure'].append(dict(seat=seat, side=side, support=target_name, tested_continuous_cells=len(pairs),
            garment_above_support=hits, support_world_bounds=[p.min(0).tolist(), p.max(0).tolist()],
            definition='Any shirt, hem, placket or low-button triangle above a support cell along the actual contact normal is retained as a possible garment occluder'))
    np.savez(output / 'witnesses.npz', **arrays)
    report['cache_sha256'] = hashlib.sha256((output / 'witnesses.npz').read_bytes()).hexdigest()
    report['state'] = 'complete'
    save()


if __name__ == '__main__':
    run(*(Path(value) for value in sys.argv[1:]))
