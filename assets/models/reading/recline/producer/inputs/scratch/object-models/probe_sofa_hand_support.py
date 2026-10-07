"""Measure one derived resting-hand candidate and independent reading support evidence."""
import json
import math
import os
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
import sofa_resting_hand_solver as hands
import sofa_book_support as reading
import audit_sofa_binding as audit

torso, probe, witness = audit.torso, audit.probe, audit.witness
ARM_PARTS = ('Relaxed shirt sleeve', 'Turned sleeve cuff', 'Forearm with elbow and wrist sections', 'Relaxed palm', 'Resting thumb')


def load_scene(root, prior):
    bpy.ops.wm.open_mainfile(filepath=str(root / 'derived-waist-binding.blend'))
    rigs = [bpy.data.objects[name] for name in prior['rest_contexts']['original']['restoration']['after_visibility']['rigs']]
    bodies = []
    for rig in rigs:
        found = [c for c in bpy.data.collections if any(o.type == 'MESH' and
                 any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers) for o in c.objects)]
        if len(found) != 1:
            raise ValueError('Derived body ownership is ambiguous')
        bodies.append(found[0])
    origin = rigs[0].matrix_world.copy()
    origins = [Matrix.Translation(Vector((0, (i - 1) * .52, 0))) @ origin for i in range(3)]
    return rigs, bodies, bpy.data.collections['Witness furniture'], origins


def pose(rigs, origins, action, phase):
    torso.depth.coupled.PARAMETERS = (0, .08, .18)
    for rig in rigs:
        rig.data.pose_position = 'POSE'
    torso.base_pose(rigs, origins, action, phase)
    for index, sign in ((0, -1), (2, 1)):
        torso.apply_torso(rigs[index], math.radians((17.305960723622544, 0, 17.305966041652816)[index]), sign)
    bpy.context.view_layer.update()


def cache_surface(arrays, prefix, surface):
    arrays[prefix + '/points'] = np.asarray(surface.points)
    arrays[prefix + '/triangles'] = np.asarray(surface.triangles, dtype=np.int32)


def compact_hit(arrays, key, first, second):
    value = torso.depth.collision(first, second)
    if not value:
        return None
    if value['kind'] == 'surface':
        arrays[key] = np.asarray(value['all_triangle_indices'], dtype=np.int32)
        return dict(kind='surface', triangle_pairs=value['triangle_pairs'], witness_array=key)
    return value


def run(binding_dir, output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Background Blender and a new absolute output directory are required')
    output.mkdir(parents=True, exist_ok=False)
    prior = json.loads((binding_dir / 'proof.json').read_text())
    inputs = dict(prior['inputs'])
    for file in (Path(__file__), Path(hands.__file__), Path(reading.__file__), binding_dir / 'proof.json',
                 binding_dir / 'derived-waist-binding.blend', binding_dir / 'normalized-rest.npz'):
        inputs[str(file)] = probe.digest(file)
    if any(probe.digest(Path(path)) != sha for path, sha in prior['inputs'].items()):
        raise ValueError('A verified binding input changed')
    report = dict(state='running', pid=os.getpid(), background=True, blender_version=bpy.app.version_string,
                  inputs=inputs, stage='resting-hands', hands=[], reading=[],
                  scope='One phase-zero resting construction plus independent four-phase reading support; no render or complete-pose acceptance')

    def save():
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')

    save()
    try:
        rigs, bodies, furniture, origins = load_scene(binding_dir, prior)
        source_cache = np.load(binding_dir / 'normalized-rest.npz')
        pose(rigs, origins, 'sit', 0.)
        before = torso.surfaces(bodies)
        arrays = {}
        report['bone_names'] = [bone.name for bone in rigs[0].pose.bones]
        for index, owner in enumerate(before):
            arrays[f'before/{index}/bone_matrices'] = np.asarray([list(b.matrix) for b in rigs[index].pose.bones])
            arrays[f'before/{index}/rig_matrix_world'] = np.asarray(rigs[index].matrix_world)
            for name, surface in owner.items():
                cache_surface(arrays, f'before/{index}/{name}', surface)
        for seat in range(3):
            for side in ('L', 'R'):
                entry = dict(seat=seat, side=side, state='planning')
                report['hands'].append(entry)

                def progress(value):
                    entry['measurement'] = {key: item for key, item in value.items() if key not in ('rays', 'palm_collision')}
                    entry['state'] = value['stage']
                    save()

                try:
                    result = hands.fit(rigs[seat], bodies[seat], furniture, seat, source_cache, sides=(side,), on_result=progress)[0]
                    rays = result['rays']
                    key = f'hand/{seat}/{side}'
                    arrays[key + '/support_rays'] = np.asarray([[r['vertex'], *r['point'], *r['hit'], r['gap'], r['triangle']] for r in rays])
                    entry['ray_array'] = key + '/support_rays'
                    entry['state'] = 'measured'
                    if result['palm_collision']:
                        entry['palm_collision_kind'] = result['palm_collision']['kind']
                except ValueError as error:
                    entry['state'] = 'construction_rejected'
                    entry['error'] = str(error)
                    save()
        after = torso.surfaces(bodies)
        deps = bpy.context.evaluated_depsgraph_get()
        solids = {obj.name: witness.Surface(obj, deps) for obj in furniture.all_objects if obj.type == 'MESH'}
        for name, surface in solids.items():
            cache_surface(arrays, f'furniture/{name}', surface)
        report['sitting'] = dict(furniture=[], neighbors=[], self_contacts=[], internal=[], support=[], bones=[])
        for index, owner in enumerate(after):
            arrays[f'after/{index}/bone_matrices'] = np.asarray([list(b.matrix) for b in rigs[index].pose.bones])
            arrays[f'after/{index}/rig_matrix_world'] = np.asarray(rigs[index].matrix_world)
            for name, surface in owner.items():
                cache_surface(arrays, f'after/{index}/{name}', surface)
                for part, solid in solids.items():
                    hit = compact_hit(arrays, f'collision/furniture/{index}/{name}/{part}', surface, solid)
                    if hit:
                        report['sitting']['furniture'].append(dict(seat=index, body=name, furniture=part, evidence=hit))
                for neighbor in range(index + 1, 3):
                    for part, other in after[neighbor].items():
                        hit = compact_hit(arrays, f'collision/neighbor/{index}/{neighbor}/{name}/{part}', surface, other)
                        if hit:
                            report['sitting']['neighbors'].append(dict(seats=[index, neighbor], parts=[name, part], evidence=hit))
            for name, surface in owner.items():
                if not name.startswith(ARM_PARTS):
                    continue
                prior_surface = before[index][name]
                current_self = [(a, b) for a, b in surface.tree.overlap(surface.tree)
                                if a < b and not set(surface.triangles[a]) & set(surface.triangles[b])]
                old_self = [(a, b) for a, b in prior_surface.tree.overlap(prior_surface.tree)
                            if a < b and not set(prior_surface.triangles[a]) & set(prior_surface.triangles[b])]
                arrays[f'internal/{index}/{name}/before'] = np.asarray(old_self, dtype=np.int32).reshape((-1, 2))
                arrays[f'internal/{index}/{name}/after'] = np.asarray(current_self, dtype=np.int32).reshape((-1, 2))
                report['sitting']['internal'].append(dict(seat=index, part=name, before=len(old_self), after=len(current_self),
                                                        classification='Changed-mesh self intersections remain explicit; adjacency alone is excluded'))
                for part, other in owner.items():
                    if part == name or (part.startswith(ARM_PARTS) and part < name):
                        continue
                    old = before[index][name].tree.overlap(before[index][part].tree)
                    now = surface.tree.overlap(other.tree)
                    if old or now:
                        key = f'self/{index}/{name}/{part}'
                        arrays[key + '/before'] = np.asarray(old, dtype=np.int32).reshape((-1, 2))
                        arrays[key + '/after'] = np.asarray(now, dtype=np.int32).reshape((-1, 2))
                        report['sitting']['self_contacts'].append(dict(seat=index, parts=[name, part], before=len(old), after=len(now),
                            witness_prefix=key, classification='Named self contacts require source-region classification; no pair exemption'))
            report['sitting']['support'].append(torso.depth.regions.support(owner['Trouser hip bridge'].points,
                                                bpy.data.objects[f'Seat cushion {index}'], deps))
            rig = rigs[index]
            report['sitting']['bones'].append(dict(seat=index, maximum_length_error=max(abs((b.tail-b.head).length-rig.data.bones[b.name].length) for b in rig.pose.bones),
                maximum_scale_error=max(abs(value-1) for b in rig.pose.bones for value in b.scale),
                wrist_join_error={side:(rig.pose.bones['forearm.'+side].tail-rig.pose.bones['hand.'+side].head).length for side in ('L','R')}))
        np.savez(output / 'resting-geometry.npz', **arrays)
        report['resting_cache_sha256'] = probe.digest(output / 'resting-geometry.npz')
        save()
        # Reading measurements remain useful even if the resting construction fails.
        report['stage'] = 'reading-support'
        for phase in torso.PHASES:
            pose(rigs, origins, 'read', phase)
            owner = torso.surfaces([bodies[1]])[0]
            cache = {}
            cache['bone_matrices'] = np.asarray([list(b.matrix) for b in rigs[1].pose.bones])
            cache['rig_matrix_world'] = np.asarray(rigs[1].matrix_world)
            for name, surface in owner.items():
                if name.startswith(('Relaxed palm', 'Resting thumb', 'Reading book cover', 'Reading book pages')):
                    cache_surface(cache, name, surface)
            result = reading.measure(owner, cache)
            filename = f'reading-{len(report["reading"])}.npz'
            np.savez(output / filename, **cache)
            result.update(phase=phase, cache=dict(path=filename, sha256=probe.digest(output / filename)))
            report['reading'].append(result)
            save()
        if any(probe.digest(Path(path)) != sha for path, sha in inputs.items()):
            raise ValueError('A hand-probe input changed')
        report['state'] = 'complete'
        report['stage'] = 'complete'
        report['acceptance'] = 'Contact diagnostic only; all-phase final assembly, contact classification and owner visual acceptance remain required'
    except BaseException as error:
        report['state'] = 'failed'
        report['error'] = repr(error)
        raise
    finally:
        save()


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:]
    run(Path(args[0]), Path(args[1]))
