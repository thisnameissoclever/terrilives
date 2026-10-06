"""Bounded pelvic support search; no complete pose or image is accepted here."""
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
from mathutils import Quaternion

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from render_toilet_use import SOURCE, MODELS, digest, validate_fixture
from toilet_pose import apply
from toilet_contact import support_grid
from armchair_contact import evaluated_surface
from build_rig import direct_bone
from toilet_support_search import support_candidates


def run(output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use background Blender and a new absolute diagnostic directory')
    output.mkdir(parents=True, exist_ok=False)
    prior_path = BASE/'review/toilet/prototype-07-diagnostics/proof.json'
    prior = json.loads(prior_path.read_text())
    inputs = dict(prior['inputs'])
    inputs.update({path.relative_to(MODELS).as_posix(): digest(path) for path in
        (Path(__file__), BASE/'toilet_support_search.py', BASE/'toilet_support_planner.py', prior_path)})
    receipt = dict(state='running', mode='pelvic-support-only-not-complete-pose', inputs=inputs, cases=[],
        scope='Actual hip-to-ring support only. Other body clearance, joint continuity, feet and visual fit are not accepted.')
    def save():
        (output/'proof.json').write_text(json.dumps(receipt, indent=2, allow_nan=False)+'\n')
    save()
    try:
        if any(digest(MODELS/name) != sha for name, sha in inputs.items()):
            raise ValueError('Retained pose inputs changed')
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
        root, rig = bpy.data.objects['TOILET_MODEL_ROOT'], bpy.data.objects['SIM_01_SHARED_RIG']
        root.rotation_euler.z = rig.rotation_euler.z = 0
        rig.animation_data.action = None
        bpy.context.scene.frame_set(1)
        receipt['fixture_validation'] = validate_fixture()
        hip, seat = bpy.data.objects['Trouser hip bridge'], bpy.data.objects['Toilet open seat ring']
        for hip_y in (-.12, -.16, -.20):
            for angle in (-20, -10, 0, 10, 20):
                rig.location.z = 0
                apply(rig, hip_z=prior['fitted_hip_z'], hip_y=hip_y)
                bone = rig.pose.bones['hips']
                head, tail = bone.head.copy(), bone.tail.copy()
                direct_bone(rig, 'hips', head, head+Quaternion((1, 0, 0), math.radians(angle))@(tail-head))
                bpy.context.view_layer.update()
                deps = bpy.context.evaluated_depsgraph_get()
                grid = support_grid(evaluated_surface(hip, deps), seat, deps)
                candidates = support_candidates(grid)
                row = dict(hip_y=hip_y, pelvic_pitch_degrees=angle, base_hip_z=prior['fitted_hip_z'],
                           grid=grid, support_candidate_count=len(candidates), candidates=candidates, validated=[])
                receipt['cases'].append(row)
                for candidate in candidates[:1]:
                    low, high = candidate['height_interval']
                    delta = low+min(.001, (high-low)/2)
                    rig.location.z = delta
                    bpy.context.view_layer.update()
                    moved = support_grid(evaluated_surface(hip, bpy.context.evaluated_depsgraph_get()),
                                         seat, bpy.context.evaluated_depsgraph_get())
                    actual = support_candidates(moved)
                    if (not any(c['height_interval'][0] <= 0 <= c['height_interval'][1] for c in actual)
                            or not 0 <= min(p['gap'] for p in moved) <= .003):
                        raise ValueError('Whole-rig height translation did not replay the predicted support interval')
                    row['validated'].append(dict(proposed_whole_body_height_delta=delta,
                        nearest_actual_gap=min(p['gap'] for p in moved), actual_grid=moved,
                        supported_candidates=actual,
                        complete_pose_acceptance=False))
                rig.location.z = 0
                save()
        receipt['immutable_inputs_preserved'] = all(digest(MODELS/name) == sha for name, sha in inputs.items())
        if not receipt['immutable_inputs_preserved']:
            raise ValueError('Support diagnostic changed input files')
        receipt['state'] = 'complete'
        save()
    except BaseException:
        receipt.update(state='failed', error=traceback.format_exc())
        save()
        raise


if __name__ == '__main__':
    run(Path(sys.argv[sys.argv.index('--')+1]))
