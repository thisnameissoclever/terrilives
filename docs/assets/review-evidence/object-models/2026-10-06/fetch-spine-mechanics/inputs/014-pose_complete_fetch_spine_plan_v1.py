"""Plan source-indexed spine contact and an exact lifted-book pull corridor."""
import ast
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np
from scipy.spatial import ConvexHull

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from book_grip_reading_geometry import Mesh, Kernel
from continuous_support_patch import measure


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


def store_patch(arrays, prefix, patch):
    for name, value in patch.items():
        if isinstance(value, np.ndarray):
            arrays[prefix + '/' + name] = value
    return {k: v for k, v in patch.items() if not isinstance(v, np.ndarray)}


def hull_mesh(points):
    hull = ConvexHull(points)
    triangles = hull.simplices.copy()
    cross = np.cross(points[triangles[:, 1]] - points[triangles[:, 0]],
                     points[triangles[:, 2]] - points[triangles[:, 0]])
    reverse = np.einsum('ij,ij->i', cross, hull.equations[:, :3]) < 0
    triangles[reverse, 1], triangles[reverse, 2] = triangles[reverse, 2].copy(), triangles[reverse, 1].copy()
    return Mesh(points, triangles)


def run(output):
    if output.exists():
        raise ValueError('Preserve the existing planned route')
    output.mkdir()
    began = time.monotonic()
    capture_dir = HERE / 'pose-complete-fetch-spine-capture-01/raw'
    source_paths = [Path(__file__), capture_dir / 'proof.json', capture_dir / 'geometry.npz',
                    HERE / 'sofa-derived-binding-03/normalized-rest.npz', HERE / 'audit_sofa_binding.py',
                    HERE / 'book_grip_reading_geometry.py', HERE / 'continuous_support_patch.py',
                    HERE / 'sofa_coupled_contact_evaluator.py']
    inputs = {str(p): digest(p) for p in source_paths}
    report = dict(state='running', inputs=inputs, acceptance=False,
                  scope='Source-indexed hand/contact and exact rigid-book corridor plan; no garment acceptance')
    arrays = {}

    def save():
        report['elapsed_seconds'] = time.monotonic() - began
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n')

    save()
    try:
        capture = json.loads((capture_dir / 'proof.json').read_text())
        source = np.load(HERE / 'sofa-derived-binding-03/normalized-rest.npz')
        geometry = np.load(capture_dir / 'geometry.npz')
        rest = {n: np.asarray(m) for n, m in capture['bone_rest'].items()}
        frames = {n: np.asarray(m) for n, m in capture['bone_matrices'].items()}
        world = np.asarray(capture['rig_matrix_world'])
        palm = source['Relaxed palm.001/rest_points']
        triangles = source['Relaxed palm.001/triangles']
        local = (np.c_[palm, np.ones(len(palm))] @ np.linalg.inv(rest['hand.R']).T)[:, :3]
        axis_low, axis_high = local[:, 1].min(), local[:, 1].max()
        core_ids = np.flatnonzero(local[:, 1] <= (axis_low + axis_high) / 2)
        pad_ids = np.flatnonzero(np.all(local[triangles, 1] >= axis_high - .025, axis=1))
        book_points = geometry['furniture/Book 0 0/points']
        book_triangles = geometry['furniture/Book 0 0/triangles']
        furniture = {key[:-len('/points')].split('/', 1)[1]:
                     Mesh(geometry[key], geometry[key[:-len('/points')] + '/triangles'])
                     for key in geometry.files if key.startswith('furniture/') and key.endswith('/points')}
        book = furniture['Book 0 0']
        kernel = Kernel(primitives(), began + 180)
        stock_pairs, unresolved = kernel.pairs(book, furniture['Base'])
        arrays['stock_support/Book 0 0|Base/pairs'] = stock_pairs
        report['canonical_stock_support'] = dict(source_rule='bookcase_layout.parts bottom=.10+row*.34-.002',
            source_book_low_z=float(book.low[2]), source_base_high_z=float(furniture['Base'].high[2]),
            surface_pairs=len(stock_pairs), unresolved=unresolved,
            classification='Declared original named resting support; not zero-contact physics')
        lift = .0025
        outward = .205
        clear = book_points + np.array([0., 0., lift])
        angle = np.deg2rad(50.)
        rotation = np.array([[1., 0., 0.], [0., np.sin(angle), np.cos(angle)],
                             [0., -np.cos(angle), np.sin(angle)]])
        oriented = local @ rotation.T
        extreme = int(np.argmax(oriented[:, 1]))
        target = np.array([float((book.low[0] + book.high[0]) / 2), float(book.low[1] - .0005),
                           float(clear[:, 2].max() - .008)])
        wrist = target - oriented[extreme]
        spine = frames['spine'] @ np.linalg.inv(rest['spine'])
        shoulder = (world @ spine @ np.r_[rest['upper_arm.R'][:3, 3], 1.])[:3]
        world[0, 3] += wrist[0] - shoulder[0]
        shoulder = (world @ spine @ np.r_[rest['upper_arm.R'][:3, 3], 1.])[:3]
        lengths = [float(np.linalg.norm(rest[b][:3, 3] - rest[a][:3, 3]))
                   for a, b in [('upper_arm.R', 'forearm.R'), ('forearm.R', 'hand.R')]]
        spine_normals = np.cross(book_points[book_triangles[:, 1]] - book_points[book_triangles[:, 0]],
                                 book_points[book_triangles[:, 2]] - book_points[book_triangles[:, 0]])
        spine_ids = np.flatnonzero(np.all(book_points[book_triangles, 1] <= book.low[1] + 1e-6, axis=1)
                                  & (spine_normals[:, 1] < 0))
        hand = oriented + wrist
        contact = measure(hand, triangles[pad_ids], clear, book_triangles[spine_ids], np.array([0., -1., 0.]), .0015)
        negative = measure(hand + np.array([0., 0., .02]), triangles[pad_ids], clear,
                           book_triangles[spine_ids], np.array([0., -1., 0.]), .0015)
        cabinet_front = min(m.low[1] for n, m in furniture.items() if not n.startswith('Book '))
        report['indexed_patches'] = dict(distal_part='Relaxed palm.001',
            distal_rule='Original source triangles wholly within the distal25mm of the saved wrist axis',
            distal_triangles=pad_ids.tolist(), spine_part='Book 0 0', spine_triangles=spine_ids.tolist(),
            core_rule='Original proximal palm hemisphere, bounded by source-axis midpoint, independent of furniture',
            core_vertices=core_ids.tolist(), source_face_map_preserved=True)
        report['contact'] = store_patch(arrays, 'spine_contact', contact)
        report['raised_hand_negative'] = store_patch(arrays, 'raised_hand_negative', negative)
        report['palm_core_front'] = dict(actual_max_y=float(hand[core_ids, 1].max()),
                                       cabinet_front_y=float(cabinet_front),
                                       gap=float(cabinet_front - hand[core_ids, 1].max()))
        # A translated convex book sweeps exactly its endpoint convex hull.
        # This is continuous clearance, not a collection of sampled frame checks.
        end = clear + np.array([0., -outward, 0.])
        corridor = hull_mesh(np.concatenate([clear, end]))
        arrays['clear_corridor/points'] = corridor.points
        arrays['clear_corridor/triangles'] = corridor.triangles
        report['clear_corridor'] = dict(lift=lift, outward=outward,
            actual_bottom_base_gap=float(clear[:, 2].min() - furniture['Base'].high[2]),
            final_back_front_gap=float(cabinet_front - end[:, 1].max()),
            reverse='Same exact swept set, ending at lifted clear state; declared setdown is separate', contacts=[])
        for name, obstacle in furniture.items():
            if name == 'Book 0 0':
                continue
            witness = kernel.contact(corridor, obstacle, arrays, 'clear_corridor/' + name)
            if witness:
                report['clear_corridor']['contacts'].append(dict(part=name, evidence={
                    k: int(len(v)) if k == 'pairs' else v for k, v in witness.items()}))
        reach = []
        for label, point in [('spine_clear', wrist), ('clear_outside', wrist + np.array([0., -outward, 0.]))]:
            distance = float(np.linalg.norm(point - shoulder))
            reach.append(dict(stage=label, distance=distance, source_lengths=lengths,
                              upper_margin=sum(lengths) - distance,
                              lower_margin=distance - abs(lengths[0] - lengths[1])))
        report['reach'] = reach
        report['plan'] = dict(rig_matrix_world=world.tolist(), hand_world_rotation=rotation.tolist(),
                             hand_world_wrist=wrist.tolist(), source_extreme_vertex=extreme,
                             lift=lift, outward=outward, hand_part='Relaxed palm.001')
        report['independent_mechanics_pass'] = bool(contact['projected_area'] > 0 and contact['certified_cells'] > 0
            and negative['projected_area'] == 0 and report['palm_core_front']['gap'] > 1e-6
            and report['clear_corridor']['actual_bottom_base_gap'] > 1e-6
            and report['clear_corridor']['final_back_front_gap'] > 1e-6
            and not report['clear_corridor']['contacts']
            and all(r['upper_margin'] > 0 and r['lower_margin'] > 0 for r in reach))
        report['state'] = 'complete'
    except BaseException as error:
        report.update(state='failed', error=repr(error))
        raise
    finally:
        np.savez_compressed(output / 'witnesses.npz', **arrays)
        report['inputs_unchanged'] = all(digest(p) == s for p, s in inputs.items())
        save()


if __name__ == '__main__':
    run(Path(sys.argv[1]).resolve())
