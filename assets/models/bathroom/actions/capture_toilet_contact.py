"""Capture actual contact triangles without accepting a complete toilet pose."""
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
from build_rig import direct_bone
from shower_cloud_exterior import closed_surface_certificate


def capture(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    data = evaluated.to_mesh()
    try:
        data.calc_loop_triangles()
        vertices = [list(evaluated.matrix_world@v.co) for v in data.vertices]
        triangles = [list(t.vertices) for t in data.loop_triangles]
    finally:
        evaluated.to_mesh_clear()
    return dict(vertices=vertices, triangles=triangles,
                closed_surface=closed_surface_certificate(vertices, triangles))


def run(output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use background Blender and a new absolute diagnostic directory')
    output.mkdir(parents=True, exist_ok=False)
    prior_path = BASE/'review/toilet/prototype-07-diagnostics/proof.json'
    diagnostics = MODELS.parents[1]/'output/curved-toilet-support-diagnostic.json'
    prior = json.loads(prior_path.read_text())
    candidates = json.loads(diagnostics.read_text())['results']
    inputs = dict(prior['inputs'])
    inputs.update({p.relative_to(MODELS).as_posix():digest(p)
                   for p in (Path(__file__), BASE/'shower_cloud_exterior.py', prior_path)})
    receipt = dict(state='running', mode='actual-contact-triangle-capture-not-pose-acceptance',
                   inputs=inputs, candidate_diagnostic_sha256=digest(diagnostics), cases=[])
    def save():
        (output/'proof.json').write_text(json.dumps(receipt, indent=2, allow_nan=False)+'\n')
    save()
    try:
        if any(digest(MODELS/name) != sha for name, sha in inputs.items()):
            raise ValueError('Retained source inputs changed')
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
        root, rig = bpy.data.objects['TOILET_MODEL_ROOT'], bpy.data.objects['SIM_01_SHARED_RIG']
        root.rotation_euler.z = rig.rotation_euler.z = 0
        rig.animation_data.action = None
        bpy.context.scene.frame_set(1)
        receipt['fixture_validation'] = validate_fixture()
        for hip_y, pitch in ((-.16, 0), (-.20, -10)):
            proposal = next(c for c in candidates if c['hip_y'] == hip_y
                            and c['pelvic_pitch_degrees'] == pitch and c['nearest_gap'] == .001)
            rig.location.z = 0
            apply(rig, hip_z=prior['fitted_hip_z'], hip_y=hip_y)
            bone = rig.pose.bones['hips']
            head, tail = bone.head.copy(), bone.tail.copy()
            direct_bone(rig, 'hips', head,
                        head+Quaternion((1, 0, 0), math.radians(pitch))@(tail-head))
            rig.location.z = proposal['proposed_height_delta']
            bpy.context.view_layer.update()
            receipt['cases'].append(dict(hip_y=hip_y, pelvic_pitch_degrees=pitch,
                proposed_height_delta=rig.location.z, proposed_regions=proposal['components'],
                hip=capture(bpy.data.objects['Trouser hip bridge']),
                seat=capture(bpy.data.objects['Toilet open seat ring']),
                complete_pose_accepted=False))
            save()
        rig.location.z = 0
        receipt['immutable_inputs_preserved'] = all(digest(MODELS/name) == sha for name, sha in inputs.items())
        if not receipt['immutable_inputs_preserved'] or digest(diagnostics) != receipt['candidate_diagnostic_sha256']:
            raise ValueError('Contact capture changed an input')
        receipt['state'] = 'complete'
        save()
    except BaseException:
        receipt.update(state='failed', error=traceback.format_exc())
        save()
        raise


if __name__ == '__main__':
    run(Path(sys.argv[sys.argv.index('--')+1]))
