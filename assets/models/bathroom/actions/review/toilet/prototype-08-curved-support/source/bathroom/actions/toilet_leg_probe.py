"""Measure bounded sole-derived leg plans with continuous curved hip support."""
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from render_toilet_use import SOURCE, MODELS, digest, partition, validate_fixture
from toilet_pose import apply
from toilet_leg_plan import leg_plan
from toilet_contact import measure
from build_rig import direct_bone
from capture_toilet_contact import capture
from contact_surface import certify_cell, connected_regions


def facets(surface, positive):
    result = []
    for indices in surface['triangles']:
        a, b, c = [surface['vertices'][i] for i in indices]
        normal_z = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
        if (normal_z > 0 if positive else normal_z < 0):
            result.append((a, b, c))
    return result


def curved_support(hip, seat, requested):
    body, furniture = facets(hip, False), facets(seat, True)
    cells, evidence, failures = {}, [], []
    for ix, iy in sorted(requested):
        pair = []
        for x in (ix, -ix-1):
            try:
                pair.append(certify_cell((x*.003, -.1+iy*.003, (x+1)*.003, -.1+(iy+1)*.003), body, furniture))
            except ValueError as failure:
                failures.append(dict(cell=[x, iy], reason=str(failure)))
                break
        if len(pair) == 2:
            cells[ix, iy] = min(row['area'] for row in pair)
            evidence.append(dict(cell=[ix, iy], mirrored_pair=pair))
    regions = connected_regions(cells, .003)
    eligible = [r for r in regions if r['area'] >= .0007 and r['width'] >= .015 and r['depth'] >= .035]
    return dict(state='passed' if eligible else 'failed', regions=regions, eligible_regions=eligible,
                continuous_cells=evidence, rejected_cells=failures,
                certificate_shape='mirrored edge-connected actual-surface cell union')


def run(output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use background Blender and a new absolute diagnostic directory')
    output.mkdir(parents=True, exist_ok=False)
    prior_path = BASE/'review/toilet/prototype-07-diagnostics/proof.json'
    facets_path = BASE/'review/toilet/contact-facets-01/proof.json'
    prior, contact = [json.loads(path.read_text()) for path in (prior_path, facets_path)]
    baseline = contact['cases'][0]
    requested = {tuple(cell) for r in baseline['proposed_regions'] for cell in r['cell_indices']}
    inputs = dict(prior['inputs'])
    inputs.update({p.relative_to(MODELS).as_posix():digest(p) for p in (Path(__file__),
        BASE/'toilet_leg_plan.py', BASE/'contact_surface.py', BASE/'capture_toilet_contact.py',
        BASE/'shower_cloud_exterior.py', prior_path, facets_path)})
    proof = dict(state='running', mode='sole-derived-leg-diagnostic-not-source-acceptance', inputs=inputs, cases=[])
    def save():
        (output/'proof.json').write_text(json.dumps(proof, indent=2, allow_nan=False)+'\n')
    save()
    try:
        if any(digest(MODELS/name) != sha for name, sha in inputs.items()):
            raise ValueError('Source inputs changed')
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
        root, rig = bpy.data.objects['TOILET_MODEL_ROOT'], bpy.data.objects['SIM_01_SHARED_RIG']
        root.rotation_euler.z = rig.rotation_euler.z = 0
        rig.animation_data.action = None
        bpy.context.scene.frame_set(1)
        body, _ = partition(bpy.context.scene, root, rig)
        proof['fixture_validation'] = validate_fixture()
        hip_z = prior['fitted_hip_z']+baseline['proposed_height_delta']
        for pitch in (16.4, 24):
            apply(rig, hip_z=hip_z, hip_y=-.16)
            plans = {}
            for side, sign in (('L', -1), ('R', 1)):
                original = next(row for row in prior['fitted_diagnostics']['shoe_pitch_analysis'] if row['side'] == side)
                plan = leg_plan(-.16, hip_z, original['relative_vertices'], pitch)
                hip = Vector((sign*.124, -.16, hip_z))
                knee, ankle = [Vector((sign*.159, *plan[field])) for field in ('knee', 'ankle')]
                direct_bone(rig, 'thigh.'+side, hip, knee)
                direct_bone(rig, 'shin.'+side, knee, ankle)
                direction = Vector((0, -math.cos(math.radians(pitch)), -math.sin(math.radians(pitch))))
                direct_bone(rig, 'foot.'+side, ankle, ankle+direction*rig.data.bones['foot.'+side].length)
                plans[side] = plan
            metrics = measure(root, rig, body, require=False)
            support = curved_support(capture(bpy.data.objects['Trouser hip bridge']),
                                     capture(bpy.data.objects['Toilet open seat ring']), requested)
            passed = (not metrics['collisions'] and not any(p['intersection'] for p in metrics['hand_clothing_proximity'])
                and support['state'] == 'passed' and 0 <= metrics['ring_min_gap'] <= .003
                and len(metrics['bone_length_errors']) == 17 and max(metrics['bone_length_errors'].values()) <= 1e-5
                and all(.018 <= value['min_z'] <= .020 for value in metrics['soles'].values())
                and all(abs(v-1) <= 1e-6 for obj in (root, rig) for v in obj.scale))
            proof['cases'].append(dict(pitch=pitch, plans=plans, physical_metrics=metrics,
                curved_support=support, mechanical_candidate_passed=passed, source_accepted=False))
            save()
            if passed:
                break
        proof['immutable_inputs_preserved'] = all(digest(MODELS/name) == sha for name, sha in inputs.items())
        if not proof['immutable_inputs_preserved']:
            raise ValueError('Leg diagnostic changed source inputs')
        proof['state'] = 'complete'
        save()
    except BaseException:
        proof.update(state='failed', error=traceback.format_exc())
        save()
        raise


if __name__ == '__main__':
    run(Path(sys.argv[sys.argv.index('--')+1]))
