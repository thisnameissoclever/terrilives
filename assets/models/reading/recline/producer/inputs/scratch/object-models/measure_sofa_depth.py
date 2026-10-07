"""Measure supported rigid depth translations and exact swept triangle intervals."""
import itertools
import json
import math
import os
from pathlib import Path
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
import measure_sofa_regions as regions

witness = regions.witness
probe = witness.probe
coupled = witness.coupled


def swept(first, second):
    """Closed intervals where translating the second triangle surface along X crosses."""
    a = np.asarray(first.points, dtype=np.float64)[np.asarray(first.triangles)]
    b = np.asarray(second.points, dtype=np.float64)[np.asarray(second.triangles)]
    low_b, high_b = b.min(axis=1), b.max(axis=1)
    all_intervals = []
    for ai, tri in enumerate(a):
        lo, hi = tri.min(axis=0), tri.max(axis=0)
        candidates = np.flatnonzero(np.all(high_b[:, 1:] >= lo[1:] - 1e-12, axis=1)
                                   & np.all(low_b[:, 1:] <= hi[1:] + 1e-12, axis=1))
        if not len(candidates):
            continue
        other = b[candidates]
        ea = np.roll(tri, -1, axis=0) - tri
        eb = np.roll(other, -1, axis=1) - other
        na = np.cross(ea[0], ea[1])
        nb = np.cross(eb[:, 0], eb[:, 1])
        axes = [np.broadcast_to(na, (len(other), 3)), nb]
        axes.extend(np.cross(edge, eb[:, j]) for edge in ea for j in range(3))
        # In-plane edge normals retain coplanar and degenerate-projection coverage.
        axes.extend(np.broadcast_to(np.cross(na, edge), (len(other), 3)) for edge in ea)
        axes.extend(np.cross(nb, eb[:, j]) for j in range(3))
        axes.extend(np.broadcast_to(axis, (len(other), 3)) for axis in np.eye(3))
        axes = np.stack(axes, axis=1)
        lengths = np.linalg.norm(axes, axis=2)
        axes /= np.where(lengths > 1e-15, lengths, 1)[:, :, None]
        ap = np.einsum('nkd,td->nkt', axes, tri)
        bp = np.einsum('nkd,ntd->nkt', axes, other)
        lower = ap.min(axis=2) - bp.max(axis=2)
        upper = ap.max(axis=2) - bp.min(axis=2)
        speed = axes[:, :, 0]
        moving = np.abs(speed) > 1e-12
        allowed = np.all(moving | ((lower <= 1e-12) & (upper >= -1e-12)), axis=1)
        divisor = np.where(moving, speed, 1)
        start, end = lower / divisor, upper / divisor
        start, end = np.minimum(start, end), np.maximum(start, end)
        start = np.where(moving, start, -np.inf).max(axis=1)
        end = np.where(moving, end, np.inf).min(axis=1)
        for item in np.flatnonzero(allowed & (start <= end + 1e-12)):
            all_intervals.append((float(start[item]), float(end[item]), ai, int(candidates[item])))
    all_intervals.sort()
    merged = []
    for lo, hi, ai, bi in all_intervals:
        if merged and lo <= merged[-1]['high'] + 1e-10:
            if hi > merged[-1]['high']:
                merged[-1]['high'] = hi
                merged[-1]['high_witness'] = [ai, bi]
            merged[-1]['triangle_intervals'] += 1
        else:
            merged.append(dict(low=lo, high=hi, low_witness=[ai, bi],
                               high_witness=[ai, bi], triangle_intervals=1))
    return merged


def collision(first, second):
    result = witness.classify(first, second)
    if result and result['kind'] == 'surface':
        result['all_triangle_indices'] = first.tree.overlap(second.tree)
    return result


def control():
    class Triangle:
        points = [Vector((0, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))]
        triangles = [(0, 1, 2)]
    first, second = Triangle(), Triangle()
    second.points = [point + Vector((.2, .2, .2)) for point in first.points]
    result = swept(first, second)
    assert len(result) == 1 and abs(result[0]['low'] + .2) < 1e-7 and abs(result[0]['high'] + .2) < 1e-7
    second.points = [point + Vector((0, 2, 0)) for point in first.points]
    assert not swept(first, second)
    second.points = [Vector((-.3, .2, .2)), Vector((.4, .8, .2)), Vector((.1, .2, .8))]
    result = swept(first, second)
    assert len(result) == 1 and abs(result[0]['low'] + .4) < 1e-7 and abs(result[0]['high'] - .3) < 1e-7
    return 'Separated, coplanar translated, and slanted crossing controls passed'


def run(output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Background Blender and a new absolute output path are required')
    output.mkdir(parents=True, exist_ok=False)
    source = probe.MODELS / probe.PROFILES['sofa']['source']
    files = {source, Path(__file__), Path(regions.__file__), Path(witness.__file__),
             Path(coupled.__file__), Path(probe.__file__)}
    for module in list(sys.modules.values()):
        filename = getattr(module, '__file__', None)
        if filename and Path(filename).resolve().is_relative_to(probe.MODELS):
            files.add(Path(filename).resolve())
    hashes = {str(path): probe.digest(path) for path in files}
    report = dict(state='running', pid=os.getpid(), background=True,
                  blender_version=bpy.app.version_string, inputs=hashes,
                  classification='Diagnostic geometry only; open-surface containment remains unresolved',
                  scope='Phase-zero depth study at outward offsets -0.06, 0, +0.06 metres',
                  regions=[], required_depth=[], stage='controls')
    receipt = output / 'proof.json'

    def save():
        receipt.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')

    save()
    try:
        report['controls'] = control()
        scene, root, rigs, bodies, furniture, origins = witness.prepare(source)
        coupled.PARAMETERS = (0, .08, .18)
        cached = {}
        arrays = {}
        report['cache_surfaces'] = {}
        for action in ('sit', 'read'):
            for index, rig in enumerate(rigs):
                rig.matrix_world = origins[index].copy()
                (probe.reading_pose if action == 'read' else lambda r, p: probe.apply(r, 'sofa', p))(rig, 0.)
                coupled.coupled_arms(rig)
            bpy.context.view_layer.update()
            deps = bpy.context.evaluated_depsgraph_get()
            cached[action] = [{obj.get('probe_source_name', obj.name): witness.Surface(obj, deps)
                               for obj in body.all_objects if obj.type == 'MESH' and not obj.hide_render}
                              for body in bodies]
            for index, owner in enumerate(cached[action]):
                for part, surface in owner.items():
                    key = f'{action}/{index}/{part}'
                    arrays[key + '/points'] = np.asarray(surface.points, dtype=np.float32)
                    arrays[key + '/triangles'] = np.asarray(surface.triangles, dtype=np.int32)
                    report['cache_surfaces'][key] = dict(bounds=surface.bounds, topology=surface.topology)
        deps = bpy.context.evaluated_depsgraph_get()
        solids = {obj.name: witness.Surface(obj, deps) for obj in furniture.all_objects if obj.type == 'MESH'}
        for part, surface in solids.items():
            key = 'furniture/' + part
            arrays[key + '/points'] = np.asarray(surface.points, dtype=np.float32)
            arrays[key + '/triangles'] = np.asarray(surface.triangles, dtype=np.int32)
            report['cache_surfaces'][key] = dict(bounds=surface.bounds, topology=surface.topology)
        np.savez(output / 'surfaces.npz', **arrays)
        report['cache_sha256'] = probe.digest(output / 'surfaces.npz')
        del arrays
        report['stage'] = 'required-depth'
        save()
        lateral = [Vector((0, value, 0)) for value in (-.06, 0, .06)]
        shifted_owners = {action: [{part: regions.shifted(surface, lateral[index]) for part, surface in owner.items()}
                                   for index, owner in enumerate(cached[action])] for action in cached}
        # Measure the two facing sleeves responsible for every surviving baseline crossing.
        for left in (0, 1):
            for first_action, second_action in itertools.product(('sit', 'read'), repeat=2):
                first_owner = shifted_owners[first_action][left]
                second_owner = shifted_owners[second_action][left + 1]
                baseline = []
                for first_name, first in first_owner.items():
                    for second_name, second in second_owner.items():
                        hit = collision(first, second)
                        if hit:
                            baseline.append(dict(parts=[first_name, second_name], evidence=hit))
                row = dict(owners=[left, left + 1], actions=[first_action, second_action], baseline=baseline, pairs=[])
                for entry in baseline:
                    first_name, second_name = entry['parts']
                    first, second = first_owner[first_name], second_owner[second_name]
                    started = time.monotonic()
                    intervals = swept(first, second)
                    pair = dict(parts=entry['parts'], forbidden_second_minus_first_x=intervals,
                                seconds=time.monotonic() - started, boundaries=[])
                    for interval in intervals:
                        for side in ('low', 'high'):
                            triangle_ids = interval[side + '_witness']
                            pair['boundaries'].append(dict(side=side, offset=interval[side],
                                triangles=[first.triangle(triangle_ids[0]), second.triangle(triangle_ids[1])],
                                inside=collision(first, regions.shifted(second, Vector((interval[side] + (1e-5 if side == 'low' else -1e-5), 0, 0)))),
                                outside=collision(first, regions.shifted(second, Vector((interval[side] + (-1e-5 if side == 'low' else 1e-5), 0, 0))))))
                    row['pairs'].append(pair)
                report['required_depth'].append(row)
                save()
        report['stage'] = 'supported-depth-regions'
        save()
        for index in range(3):
            cushion = bpy.data.objects[f'Seat cushion {index}']
            hip = cached['sit'][index]['Trouser hip bridge']
            # Any support must project into the actual cushion bounds. This bounds sampling only.
            bounds = solids[cushion.name].bounds
            low = bounds[0][0] - hip.bounds[1][0]
            high = bounds[1][0] - hip.bounds[0][0]
            region = dict(seat=index, conservative_projection_bounds=[low, high], step=.005,
                          rows=[], valid_depths=[])
            report['regions'].append(region)
            for step in range(math.ceil(low / .005), math.floor(high / .005) + 1):
                depth = step * .005
                offset = lateral[index] + Vector((depth, 0, 0))
                supported = regions.support([point + offset for point in hip.points], cushion, deps)
                row = dict(depth=depth, support=supported, collisions=[])
                if supported['valid']:
                    for action in ('sit', 'read'):
                        for part, original in cached[action][index].items():
                            sb = [tuple(bound[axis] + offset[axis] for axis in range(3)) for bound in original.bounds]
                            possible = [(name, solid) for name, solid in solids.items()
                                        if not any(sb[1][axis] < solid.bounds[0][axis] or solid.bounds[1][axis] < sb[0][axis]
                                                   for axis in range(3))]
                            if possible:
                                moved = regions.shifted(original, offset)
                                for name, solid in possible:
                                    hit = collision(moved, solid)
                                    if hit:
                                        row['collisions'].append(dict(action=action, body=part, furniture=name, evidence=hit))
                row['valid'] = supported['valid'] and not row['collisions']
                if row['valid']:
                    region['valid_depths'].append(depth)
                region['rows'].append(row)
            save()
        report['stage'] = 'complete'
        report['state'] = 'complete'
        report['acceptance'] = 'No feasibility claim; other phases, full self/contact proof and visual review remain required'
        if any(probe.digest(Path(path)) != digest for path, digest in hashes.items()):
            raise ValueError('A measurement input changed')
    except BaseException as error:
        report['state'] = 'failed'
        report['error'] = repr(error)
        raise
    finally:
        save()


if __name__ == '__main__':
    run(Path(sys.argv[sys.argv.index('--') + 1]))
