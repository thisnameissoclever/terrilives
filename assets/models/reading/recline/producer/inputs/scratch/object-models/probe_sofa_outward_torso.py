"""Derive outward torso frames from evaluated lateral envelopes, then classify contacts."""
import itertools
import json
import math
import os
from pathlib import Path
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
import measure_sofa_depth as depth

witness = depth.witness
probe = depth.probe
PHASES = (0., .25, .5, .75)
CLEARANCE = .001
FRAME_LIMIT = .00001
BONES = ['spine', 'head', 'book'] + [part + '.' + side for side in ('L', 'R')
                                            for part in ('upper_arm', 'forearm', 'hand')]


def upper(name):
    return not any(token in name.lower() for token in ('trouser', 'shoe', 'sole'))


def surfaces(bodies):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    return [{obj.get('probe_source_name', obj.name): witness.Surface(obj, deps)
             for obj in body.all_objects if obj.type == 'MESH' and not obj.hide_render} for body in bodies]


def base_pose(rigs, origins, action, phase):
    for index, rig in enumerate(rigs):
        rig.matrix_world = Matrix.Translation(Vector((0, (-.06, 0, .06)[index], 0))) @ origins[index]
        (probe.reading_pose if action == 'read' else lambda r, p: probe.apply(r, 'sofa', p))(rig, phase)
        depth.coupled.coupled_arms(rig)


def derive(owner, pivot, sign, center_extent):
    target = center_extent + CLEARANCE - sign * pivot.y
    best = dict(angle=0., point=None)
    for name, surface in owner.items():
        if not upper(name):
            continue
        values = np.asarray(surface.points, dtype=np.float64)
        a = sign * (values[:, 1] - pivot.y)
        b = values[:, 2] - pivot.z
        bad = np.flatnonzero(a < target)
        if not len(bad):
            continue
        radius = np.hypot(a[bad], b[bad])
        if np.any(radius < abs(target)):
            raise ValueError('A limiting vertex cannot reach the required lateral half-space')
        roots = np.arctan2(b[bad], a[bad]) - np.arccos(target / radius)
        item = int(np.argmax(roots))
        if roots[item] > best['angle']:
            index = int(bad[item])
            best = dict(angle=float(roots[item]), part=name, vertex=index,
                        point=list(surface.points[index]), coefficients=[float(a[index]), float(b[index])],
                        target=target, equation='a*cos(angle) + b*sin(angle) >= target')
    if not 0 <= best['angle'] < math.pi / 2:
        raise ValueError('No modest outward-angle interval selected by the geometric bound')
    return best


def apply_torso(rig, angle, sign):
    pivot = rig.matrix_world @ rig.pose.bones['spine'].head
    world = Matrix.Translation(pivot) @ Matrix.Rotation(-sign * angle, 4, 'X') @ Matrix.Translation(-pivot)
    local = rig.matrix_world.inverted() @ world @ rig.matrix_world
    frames = {name: rig.pose.bones[name].matrix.copy() for name in BONES}
    for name in BONES:
        rig.pose.bones[name].matrix = local @ frames[name]
        bpy.context.view_layer.update()
    residual = max(abs(rig.pose.bones[name].matrix[r][c] - (local @ frames[name])[r][c])
                   for name in BONES for r in range(4) for c in range(4))
    joins = {f'{first}/{second}': (rig.pose.bones[first].tail - rig.pose.bones[second].head).length
             for first, second in [('hips', 'spine')] + [(part + '.' + side, following + '.' + side)
                for side in ('L', 'R') for part, following in [('upper_arm', 'forearm'), ('forearm', 'hand')]]}
    lengths = max(abs((bone.tail - bone.head).length - rig.data.bones[bone.name].length) for bone in rig.pose.bones)
    if residual > FRAME_LIMIT or lengths > FRAME_LIMIT or max(joins.values()) > FRAME_LIMIT:
        raise ValueError(f'Torso frame or skeletal continuity failed: {residual}, {lengths}, {joins}')
    return world, dict(pivot=list(pivot), frame_residual=residual, bone_length_error=lengths,
                       joins=joins, frames={name: [list(row) for row in rig.pose.bones[name].matrix] for name in BONES})


def self_correspondence(before, after):
    contacts = []
    for name, original in before.items():
        if not upper(name):
            continue
        for part, lower in before.items():
            if upper(part):
                continue
            prior = set(original.tree.overlap(lower.tree))
            current = set(after[name].tree.overlap(after[part].tree))
            if prior or current:
                added, removed = current - prior, prior - current
                contacts.append(dict(parts=[name, part], original_pairs=sorted(prior), current_pairs=sorted(current),
                    retained_count=len(prior & current), new_count=len(added), removed_count=len(removed),
                    new_witnesses=[dict(indices=[a, b], upper=after[name].triangle(a), lower=after[part].triangle(b))
                                   for a, b in sorted(added)],
                    classification='Exact triangle-index correspondence; added crossings require attachment review'))
    return contacts


def hand_distances(owner, action):
    targets = [name for name in owner if name.startswith(('Reading book cover', 'Reading book pages'))] if action == 'read' else [
        name for name in owner if name.startswith('Tailored trouser leg')]
    rows = []
    for name in [name for name in owner if name.startswith(('Relaxed palm', 'Resting thumb'))]:
        distances = []
        for index, point in enumerate(owner[name].points):
            result = min(((*owner[target].tree.find_nearest(point), target) for target in targets), key=lambda r: r[3])
            distances.append((result[3], index, result[4], list(point), list(result[0])))
        nearest = min(distances)
        rows.append(dict(part=name, targets=targets, minimum_distance=nearest[0],
                         vertex=nearest[1], target=nearest[2], point=nearest[3], nearest=nearest[4],
                         vertices_within_1mm=sum(d[0] <= .001 for d in distances),
                         classification='Measured proximity only; finite support/grip has not been certified'))
    return rows


def run(output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Background Blender and a new absolute output directory are required')
    output.mkdir(parents=True, exist_ok=False)
    source = probe.MODELS / probe.PROFILES['sofa']['source']
    files = {source, Path(__file__), Path(depth.__file__), Path(depth.regions.__file__),
             Path(witness.__file__), Path(depth.coupled.__file__), Path(probe.__file__)}
    for module in list(sys.modules.values()):
        name = getattr(module, '__file__', None)
        if name and Path(name).resolve().is_relative_to(probe.MODELS):
            files.add(Path(name).resolve())
    inputs = {str(file): probe.digest(file) for file in files}
    report = dict(state='running', pid=os.getpid(), background=True, inputs=inputs,
                  blender_version=bpy.app.version_string, lateral_clearance=CLEARANCE,
                  source_frame_tolerance=FRAME_LIMIT, derivations=[], phases=[], stage='derive')

    def save():
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')

    save()
    try:
        scene, root, rigs, bodies, furniture, origins = witness.prepare(source)
        depth.coupled.PARAMETERS = (0, .08, .18)
        angles = {0: 0., 2: 0.}
        for phase in PHASES:
            cached = {}
            for action in ('sit', 'read'):
                base_pose(rigs, origins, action, phase)
                cached[action] = surfaces(bodies)
            for index, sign in ((0, -1), (2, 1)):
                pivot = rigs[index].matrix_world @ rigs[index].pose.bones['spine'].head
                extent = max(sign * point.y for action in cached for surface in cached[action][1].values() for point in surface.points)
                for action in cached:
                    result = derive(cached[action][index], pivot, sign, extent)
                    report['derivations'].append(dict(phase=phase, action=action, seat=index, center_extent=extent,
                                                       pivot=list(pivot), **result))
                    angles[index] = max(angles[index], result['angle'])
            save()
            del cached
        # This is a frame-rounding margin, not a relaxed intersection or support tolerance.
        angles = {index: value + 1e-5 for index, value in angles.items()}
        report['angles_radians'] = angles
        report['angles_degrees'] = {index: math.degrees(value) for index, value in angles.items()}
        report['stage'] = 'contacts'
        save()
        for phase in PHASES:
            started = time.monotonic()
            row = dict(phase=phase, actors=[], neighbors=[])
            report['phases'].append(row)
            cached_after = {}
            for action in ('sit', 'read'):
                base_pose(rigs, origins, action, phase)
                before = surfaces(bodies)
                frame_proof = {}
                worlds = {1: Matrix.Identity(4)}
                for index, sign in ((0, -1), (2, 1)):
                    worlds[index], frame_proof[index] = apply_torso(rigs[index], angles[index], sign)
                after = surfaces(bodies)
                cached_after[action] = after
                deps = bpy.context.evaluated_depsgraph_get()
                solids = {obj.name: witness.Surface(obj, deps) for obj in furniture.all_objects if obj.type == 'MESH'}
                for index in range(3):
                    rigid_error = max((point - (worlds[index] @ old if upper(name) else old)).length
                                      for name, surface in after[index].items()
                                      for point, old in zip(surface.points, before[index][name].points))
                    if rigid_error > FRAME_LIMIT:
                        raise ValueError(f'Rigid body-part correspondence failed: {index}, {action}, {phase}, {rigid_error}')
                    actor = dict(seat=index, action=action, frame_proof=frame_proof.get(index),
                                 rigid_replay_error=rigid_error, furniture=[],
                                 hip_support=depth.regions.support(after[index]['Trouser hip bridge'].points,
                                             bpy.data.objects[f'Seat cushion {index}'], deps),
                                 self_contact=self_correspondence(before[index], after[index]),
                                 hands_before=hand_distances(before[index], action),
                                 hands_after=hand_distances(after[index], action),
                                 soles={name: surface.bounds[0][2] for name, surface in after[index].items()
                                        if name.startswith('Fitted rounded shoe sole')})
                    for name, surface in after[index].items():
                        for part, solid in solids.items():
                            hit = depth.collision(surface, solid)
                            if hit:
                                actor['furniture'].append(dict(body=name, furniture=part, evidence=hit))
                    row['actors'].append(actor)
                save()
            # Pairwise factorization covers all eight complete sit/read assignments at this shared phase.
            for first_index, second_index in ((0, 1), (1, 2), (0, 2)):
                for first_action, second_action in itertools.product(('sit', 'read'), repeat=2):
                    entry = dict(seats=[first_index, second_index], actions=[first_action, second_action], collisions=[])
                    for name, surface in cached_after[first_action][first_index].items():
                        for part, other in cached_after[second_action][second_index].items():
                            hit = depth.collision(surface, other)
                            if hit:
                                entry['collisions'].append(dict(parts=[name, part], evidence=hit))
                    row['neighbors'].append(entry)
            row['seconds'] = time.monotonic() - started
            save()
            del cached_after
        if any(probe.digest(Path(path)) != sha for path, sha in inputs.items()):
            raise ValueError('An input changed during torso measurement')
        report['state'] = 'complete'
        report['stage'] = 'complete'
        report['acceptance'] = 'No render or acceptance: added waist contacts and measured hand support require review'
    except BaseException as error:
        report['state'] = 'failed'
        report['error'] = repr(error)
        raise
    finally:
        save()


if __name__ == '__main__':
    run(Path(sys.argv[sys.argv.index('--') + 1]))
