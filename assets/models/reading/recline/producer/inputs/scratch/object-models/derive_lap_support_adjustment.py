"""Measure a forward supported hand adjustment from cached collision boundaries."""
import ast
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import continuous_support_patch as contact
import sofa_arm_frame_math as arm_math


def minimum_gap(points, triangles, support_points, support_triangles, basis):
    hand = contact.projected(points, triangles, basis, -1)
    support = contact.projected(support_points, support_triangles, basis, 1)
    best, witness, ambiguous = float('inf'), None, 0
    for hi, triangle in enumerate(hand['triangles']):
        candidates = np.flatnonzero(np.all(support['high'] >= hand['low'][hi], axis=1)
                                   & np.all(support['low'] <= hand['high'][hi], axis=1))
        for si in candidates:
            poly = contact.intersect(list(triangle[:, :2]), support['triangles'][si, :, :2])
            if len(poly) < 3 or abs(contact.signed_area(poly)) <= 1e-14:
                continue
            if contact.hidden(poly, hand['planes'][hi], hand, hi, False) or contact.hidden(poly, support['planes'][si], support, si, True):
                ambiguous += 1
                continue
            gap = hand['planes'][hi] - support['planes'][si]
            values = np.asarray(poly) @ gap[:2] + gap[2]
            at = int(np.argmin(values))
            if values[at] < best:
                best = float(values[at])
                witness = dict(triangles=[int(hand['ids'][hi]), int(support['ids'][si])], projected_point=np.asarray(poly)[at].tolist())
    if witness is None:
        raise ValueError('No continuous support overlap remains')
    return dict(minimum=best, witness=witness, ambiguous_cells=ambiguous)


def run(arm_dir, output):
    if output.exists():
        raise ValueError('Preserve prior support-adjustment evidence')
    output.mkdir(parents=True)
    source = Path(__file__).with_name('measure_sofa_depth.py')
    tree = ast.parse(source.read_text())
    fn = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'swept')
    namespace = {'np': np}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), str(source), 'exec'), namespace)
    swept = namespace['swept']
    proof = json.loads((arm_dir / 'proof.json').read_text())
    cache = np.load(arm_dir / 'geometry.npz')
    files = [Path(__file__), source, Path(contact.__file__), Path(arm_math.__file__), arm_dir / 'proof.json', arm_dir / 'geometry.npz']
    report = dict(state='running', inputs={str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
                  scope='Minimum rigid tangent separation for palm/thumb versus torso, followed by exact continuous support refit; whole-arm clearance is not yet certified',
                  positive_path_clearance=.001, cases=[])
    arrays = {}
    torso_parts = ('Overshirt body', 'Shirt lower hem', 'Trouser hip bridge', 'Shirt placket', 'Small horn button', 'Small horn button.001')

    def save():
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n')

    save()
    for seat, side in ((0, 'L'), (1, 'L'), (1, 'R'), (2, 'R')):
        suffix = '.001' if side == 'R' else ''
        palm_name, thumb_name, support_name = ('Relaxed palm' + suffix, 'Resting thumb' + suffix, 'Tailored trouser leg' + suffix)
        basis = cache[f'contact/{seat}/{side}/basis']
        palm = cache[f'{seat}/{palm_name}/points']
        palm_triangles = cache[f'{seat}/{palm_name}/triangles']
        support = cache[f'{seat}/{support_name}/points']
        support_triangles = cache[f'{seat}/{support_name}/triangles']
        initial_gap = minimum_gap(palm, palm_triangles, support, support_triangles, basis)
        intervals, bounds = [], []
        for hand_name in (palm_name, thumb_name):
            moving = SimpleNamespace(points=cache[f'{seat}/{hand_name}/points'] @ basis, triangles=cache[f'{seat}/{hand_name}/triangles'])
            for body_name in torso_parts:
                body = SimpleNamespace(points=cache[f'{seat}/{body_name}/points'] @ basis, triangles=cache[f'{seat}/{body_name}/triangles'])
                forbidden = swept(body, moving)
                row = dict(parts=[body_name, hand_name], intervals=forbidden)
                bounds.append(row)
                intervals.extend((item['low'], item['high']) for item in forbidden)
        distance = 0.
        while True:
            containing = [high for low, high in intervals if low <= distance <= high]
            if not containing:
                break
            distance = max(containing) + 1e-10
        bound = distance
        distance += report['positive_path_clearance']
        tangent_shift = basis[:, 0] * distance
        moved_gap = minimum_gap(palm + tangent_shift, palm_triangles, support, support_triangles, basis)
        normal_shift = initial_gap['minimum'] - moved_gap['minimum']
        shift = tangent_shift + basis[:, 2] * normal_shift
        final_patch = contact.measure(palm + shift, palm_triangles, support, support_triangles, basis[:, 2], .0015)
        residual = []
        for hand_name in (palm_name, thumb_name):
            moving = SimpleNamespace(points=(cache[f'{seat}/{hand_name}/points'] + shift) @ basis,
                                     triangles=cache[f'{seat}/{hand_name}/triangles'])
            for body_name in torso_parts:
                body = SimpleNamespace(points=cache[f'{seat}/{body_name}/points'] @ basis, triangles=cache[f'{seat}/{body_name}/triangles'])
                hit = [row for row in swept(body, moving) if row['low'] <= 0 <= row['high']]
                if hit:
                    residual.append(dict(parts=[body_name, hand_name], intervals=hit))
        frame = next(row for row in proof['frames'] if row['seat'] == seat and row['side'] == side)
        data = json.loads(json.dumps(frame['inputs']))
        inverse = np.linalg.inv(cache[f'{seat}/rig_matrix_world'])
        hand_matrix = np.asarray(data['matrices']['hand_pose'])
        hand_matrix[:3, 3] += inverse[:3, :3] @ shift
        data['matrices']['hand_pose'] = hand_matrix.tolist()
        try:
            reach = arm_math.solve(data)
            reach_result = dict(reachable=True, circle_radius=reach['circle_radius'], endpoint_lengths=reach['endpoint_lengths'],
                                unconstrained_elbow=reach['elbow'].tolist(), classification='Kinematic reach only; body-clear elbow branch still required')
        except ValueError as error:
            reach_result = dict(reachable=False, error=str(error))
        row = dict(seat=seat, side=side, rigid_tangent_separation_bound=bound, tangent_distance=distance, normal_distance=normal_shift,
            world_shift=shift.tolist(), shift_length=float(np.linalg.norm(shift)), source_gap=initial_gap, translated_gap=moved_gap,
            continuous_patch={k: v for k, v in final_patch.items() if not isinstance(v, np.ndarray)},
            hand_torso_surface_failures_after_refit=residual, boundaries=bounds, reach=reach_result)
        report['cases'].append(row)
        for key, value in final_patch.items():
            if isinstance(value, np.ndarray):
                arrays[f'{seat}/{side}/{key}'] = value
        save()
    np.savez(output / 'witnesses.npz', **arrays)
    report['cache_sha256'] = hashlib.sha256((output / 'witnesses.npz').read_bytes()).hexdigest()
    report['state'] = 'complete'
    save()


if __name__ == '__main__':
    run(Path(sys.argv[1]), Path(sys.argv[2]))
