"""Measure supported lateral seating regions without altering furniture or people."""
import json
import math
import os
from pathlib import Path
import sys
import time

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).parent))
import probe_sofa_witnesses as witness

probe = witness.probe
coupled = witness.coupled


def shifted(surface, offset):
    result = object.__new__(witness.Surface)
    result.name = surface.name
    result.points = [point + offset for point in surface.points]
    result.triangles = surface.triangles
    result.tree = BVHTree.FromPolygons(result.points, result.triangles, all_triangles=True, epsilon=0)
    result.bounds = [tuple(bound[axis] + offset[axis] for axis in range(3)) for bound in surface.bounds]
    result.topology = surface.topology
    return result


def support(points, cushion, deps):
    try:
        value = probe.seat_support(points, cushion, deps)
        return dict(valid=True, measurement=value)
    except (AssertionError, ValueError) as error:
        return dict(valid=False, error=str(error))


def run(output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use background Blender and a new absolute output directory')
    output.mkdir(parents=True, exist_ok=False)
    source = probe.MODELS / probe.PROFILES['sofa']['source']
    files = {source, Path(__file__), Path(witness.__file__), Path(coupled.__file__), Path(probe.__file__)}
    for module in list(sys.modules.values()):
        filename = getattr(module, '__file__', None)
        if filename and Path(filename).resolve().is_relative_to(probe.MODELS):
            files.add(Path(filename).resolve())
    hashes = {str(path): probe.digest(path) for path in files}
    report = dict(state='running', pid=os.getpid(), background=True,
                  blender_version=bpy.app.version_string, inputs=hashes,
                  purpose='Sample supported outward body positions inside original cushions',
                  scope='Two phase-zero poses and rigid translations; not final fit or visual acceptance',
                  sample_step=.01, regions=[], assemblies=[])
    receipt = output / 'proof.json'

    def save():
        receipt.write_bytes((json.dumps(report, indent=2) + '\n').encode('utf-8'))

    save()
    try:
        scene, root, rigs, bodies, furniture, origins = witness.prepare(source)
        coupled.PARAMETERS = (0, .08, .18)
        cached = {}
        for action in ('sit', 'read'):
            for index, rig in enumerate(rigs):
                rig.matrix_world = origins[index].copy()
                if action == 'read':
                    probe.reading_pose(rig, 0.)
                else:
                    probe.apply(rig, 'sofa', 0.)
                coupled.coupled_arms(rig)
            bpy.context.view_layer.update()
            deps = bpy.context.evaluated_depsgraph_get()
            cached[action] = [{obj.get('probe_source_name', obj.name): witness.Surface(obj, deps)
                               for obj in body.all_objects if obj.type == 'MESH' and not obj.hide_render}
                              for body in bodies]
        deps = bpy.context.evaluated_depsgraph_get()
        solids = {obj.name: witness.Surface(obj, deps) for obj in furniture.all_objects if obj.type == 'MESH'}
        selected = {}
        for index, sign in ((0, -1), (1, 0), (2, 1)):
            cushion = bpy.data.objects[f'Seat cushion {index}']
            bounds = solids[cushion.name].bounds
            # The original cushion bounds define the sampled region; support and all furniture decide validity.
            half_width = (bounds[1][1] - bounds[0][1]) / 2.
            offsets = [0.] if sign == 0 else [step * .01 for step in range(math.floor(half_width / .01) + 1)]
            region = dict(seat=index, cushion_bounds=bounds, candidates=[])
            report['regions'].append(region)
            for distance in offsets:
                started = time.monotonic()
                offset = Vector((0, sign * distance, 0))
                row = dict(outward_distance=distance, offset=list(offset), actions=[], valid=True)
                for action in ('sit', 'read'):
                    owner = cached[action][index]
                    supported = support([point + offset for point in owner['Trouser hip bridge'].points], cushion, deps)
                    case = dict(action=action, support=supported, furniture_collisions=[])
                    if supported['valid']:
                        for name, original in owner.items():
                            # Skip disjoint boxes before constructing a translated tree.
                            shifted_bounds = [tuple(bound[axis] + offset[axis] for axis in range(3)) for bound in original.bounds]
                            possible = [(part, solid) for part, solid in solids.items()
                                        if not any(shifted_bounds[1][axis] < solid.bounds[0][axis]
                                            or solid.bounds[1][axis] < shifted_bounds[0][axis] for axis in range(3))]
                            if possible:
                                moved = shifted(original, offset)
                                for part, solid in possible:
                                    collision = witness.classify(moved, solid)
                                    if collision:
                                        case['furniture_collisions'].append(dict(body=name, furniture=part, evidence=collision))
                    case['valid'] = supported['valid'] and not case['furniture_collisions']
                    row['valid'] &= case['valid']
                    row['actions'].append(case)
                row['seconds'] = time.monotonic() - started
                region['candidates'].append(row)
                if row['valid']:
                    selected[index] = offset.copy()
                save()
            region['valid_outward_distances'] = [row['outward_distance'] for row in region['candidates'] if row['valid']]
            save()
        if len(selected) == 3:
            report['maximum_sampled_offsets'] = {str(index): list(offset) for index, offset in selected.items()}
            for actions in (('sit', 'sit', 'sit'), ('read', 'read', 'read'), ('sit', 'read', 'sit'), ('read', 'sit', 'read')):
                owners = [{name: shifted(surface, selected[index]) for name, surface in cached[action][index].items()}
                          for index, action in enumerate(actions)]
                case = dict(actions=actions, collisions=[])
                for index, owner in enumerate(owners):
                    for other_index in range(index + 1, 3):
                        for name, surface in owner.items():
                            for other, other_surface in owners[other_index].items():
                                collision = witness.classify(surface, other_surface)
                                if collision:
                                    case['collisions'].append(dict(owners=[index, other_index], parts=[name, other], evidence=collision))
                report['assemblies'].append(case)
                save()
        if any(probe.digest(Path(path)) != digest for path, digest in hashes.items()):
            raise ValueError('A measurement input changed')
        report['state'] = 'complete'
        report['acceptance'] = 'Unreviewed measurement only; remaining phases, every arrangement, hand/self contact and visuals are required'
    except BaseException as error:
        report['state'] = 'failed'
        report['error'] = repr(error)
        raise
    finally:
        save()


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--') + 1:]
    if len(arguments) != 1:
        raise ValueError('Pass one new absolute output directory')
    run(Path(arguments[0]))
