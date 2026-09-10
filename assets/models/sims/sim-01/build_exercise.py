"""Author two bike poses on a separate copy of the approved shared rig."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import traceback

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from bpy_extras.object_utils import world_to_camera_view

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from build_rig import direct_bone, arm_elbow
from exercise_math import pedal_target, project_se, VERTICAL_SCALE
from render_job import apply_render_job
from render_shirt_variants import SHIRT_COLORS, material_snapshot, set_shirt_colors, topology_sha256


def project(scene, point):
    value = world_to_camera_view(scene, scene.camera, point)
    return [value.x * scene.render.resolution_x / 16,
            (1 - value.y) * scene.render.resolution_y / 16]


def saved_contacts(scene, rig, clip):
    def relative(point):
        value = project(scene, rig.matrix_world @ point)
        return [value[index] - clip['world_origin'][index] for index in range(2)]
    result = {'hips': relative(rig.pose.bones['hips'].head)}
    for side, sign in (('L', -1), ('R', 1)):
        foot = rig.data.bones['foot.' + side]
        sole_rest = foot.head_local + Vector((-sign * .07, -.04, -.10))
        sole = rig.pose.bones[foot.name].matrix @ foot.matrix_local.inverted() @ sole_rest
        hand = rig.data.bones['hand.' + side]
        grip_rest = hand.head_local + (hand.tail_local - hand.head_local).normalized() * .073
        grip = rig.pose.bones[hand.name].matrix @ hand.matrix_local.inverted() @ grip_rest
        result[side] = {'pedal': relative(sole), 'grip': relative(grip)}
    return result


def pose(rig, phase):
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    rig['eyes_closed'] = 0.0
    rig['book_visible'] = 0.0
    bpy.context.view_layer.update()
    hip = Vector((-.37, -.37, .86))
    rest_hip = Vector((0, 0, .86))
    twist = Quaternion()
    for name in ('hips', 'spine', 'head'):
        rest = rig.data.bones[name]
        rotation = Quaternion() if name == 'hips' else twist
        direct_bone(rig, name, hip + rotation @ (rest.head_local - rest_hip),
                    hip + rotation @ (rest.tail_local - rest_hip))
    contacts = {}
    for side, sign in (('L', -1), ('R', 1)):
        ankle_values, contact = pedal_target(side, phase)
        ankle = Vector(ankle_values)
        thigh_head = hip + Vector((sign * .124, 0, 0))
        knee = arm_elbow(thigh_head, ankle, .37, .36, thigh_head + Vector((sign * .08, -.8, -.18)))
        direct_bone(rig, 'thigh.' + side, thigh_head, knee)
        direct_bone(rig, 'shin.' + side, knee, ankle)
        direct_bone(rig, 'foot.' + side, ankle, ankle + Vector((0, -.14, 0)))
        upper = rig.data.bones['upper_arm.' + side]
        lower = rig.data.bones['forearm.' + side]
        shoulder = hip + twist @ (upper.head_local - rest_hip)
        # These are the two authored handlebar tips, relative to the tile centre.
        grip_pixel = (-4, -17) if side == 'L' else (12, -18)
        hand_offset = Vector((0, -.073, 0))
        wrist_pixel = np.array(grip_pixel) - np.array(project_se(hand_offset))
        # Preserve anatomical lateral position instead of choosing the closest
        # point along the camera ray, which can fold a wrist into its shoulder.
        wrist_x = shoulder.x
        wrist_y = wrist_x - wrist_pixel[0] / 32
        wrist_z = (-wrist_pixel[1] - 21 * (wrist_x + wrist_y)) / VERTICAL_SCALE
        wrist = Vector((wrist_x, wrist_y, wrist_z))
        elbow = arm_elbow(shoulder, wrist, upper.length, lower.length,
                          shoulder + Vector((sign * .4, .12, -.4)))
        direct_bone(rig, 'upper_arm.' + side, shoulder, elbow)
        direct_bone(rig, 'forearm.' + side, elbow, wrist)
        direct_bone(rig, 'hand.' + side, wrist, wrist + Vector((0, -.11, 0)))
        contacts[side] = {'pedal': list(contact), 'grip': list(wrist + hand_offset),
                          'ankle': list(ankle), 'knee': list(knee)}
    return {'hips': list(hip), 'limbs': contacts}


def run(preview):
    assert bpy.app.background
    mode = 'preview' if preview else 'batch'
    status_path = BASE / f'exercise-{mode}-status.json'
    status_path.write_text(json.dumps({'state': 'running', 'completed': 0}))
    source = BASE / 'sim-01-rigged.blend'
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    assert 'exercise' not in bpy.data.actions
    action = bpy.data.actions.new('exercise')
    action.use_fake_user = True
    rig.animation_data.action = action
    contacts = []
    for index in range(3):
        contacts.append(pose(rig, (index % 2) / 2))
        for bone in rig.pose.bones:
            bone.rotation_mode = 'QUATERNION'
            for channel in ('location', 'rotation_quaternion', 'scale'):
                bone.keyframe_insert(channel, frame=index + 1)
        rig.keyframe_insert(data_path='["eyes_closed"]', frame=index + 1)
        rig.keyframe_insert(data_path='["book_visible"]', frame=index + 1)
    action['sample_fps'] = 1.25
    action['loop_samples'] = 2
    original = json.loads((BASE / 'registered-canvas-proof.json').read_text())['idle']
    scene.render.resolution_x = 104 * 16
    scene.render.resolution_y = 120 * 16
    scene.camera.data.ortho_scale = original['camera_ortho_scale'] * 120 / 88
    scene.camera.location = original['camera_location']
    bpy.context.view_layer.update()
    origin = project(scene, Vector((0, 0, 0)))
    clip = {'frame_count': 2, 'sample_fps': 1.25, 'loop': True, 'source_action': 'exercise',
            'width': 104, 'height': 120, 'world_origin': origin, 'anchor': [origin[0], origin[1] + 21],
            'camera_ortho_scale': scene.camera.data.ortho_scale, 'camera_location': list(scene.camera.location)}
    registration = {'exercise': clip}
    bpy.context.preferences.filepaths.save_version = 0
    saved = BASE / 'sim-01-exercise.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(saved))
    # Select samples from the saved additive action, as the ordinary variants do.
    bpy.ops.wm.open_mainfile(filepath=str(saved))
    scene = bpy.context.scene
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    materials = material_snapshot()
    topology = topology_sha256()
    jobs = [(facing, index) for facing in (('SE',) if preview else ('SE', 'SW', 'NW', 'NE')) for index in range(2)]
    baseline = {f'{facing}-{index}': apply_render_job(scene, rig, registration, 'exercise', facing, index)
                for facing, index in jobs}
    proof = {'state': 'running', 'source_rig_sha256': source_hash,
             'additive_rig_sha256': hashlib.sha256(saved.read_bytes()).hexdigest(),
             'topology_sha256': topology, 'clip': clip, 'contacts': contacts[:2], 'variants': {}}
    completed = 0
    for variant in (('green',) if preview else ('green', 'blue', 'red')):
        if variant != 'green':
            set_shirt_colors(SHIRT_COLORS[variant], materials)
        directory = BASE / 'review/exercise' / variant
        directory.mkdir(parents=True, exist_ok=True)
        frames = []
        for facing, index in jobs:
            state = apply_render_job(scene, rig, registration, 'exercise', facing, index)
            assert state == baseline[f'{facing}-{index}']
            assert topology_sha256() == topology
            path = directory / f'exercise-{facing}-{index}.png'
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            frames.append({'path': path.name, 'facing': facing, 'frame': index, 'state': state,
                           'projected_contacts': saved_contacts(scene, rig, clip),
                           'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
            completed += 1
            status_path.write_text(json.dumps({'state': 'running', 'completed': completed, 'last': f'{variant}/{path.name}'}))
        proof['variants'][variant] = frames
    assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
    proof['state'] = 'complete'
    (BASE / f'exercise-{mode}-proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    status_path.write_text(json.dumps({'state': 'complete', 'completed': completed}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    try:
        run(args.preview)
    except Exception:
        mode = 'preview' if args.preview else 'batch'
        (BASE / f'exercise-{mode}-status.json').write_text(json.dumps({'state': 'failed', 'traceback': traceback.format_exc()}, indent=2))
        raise
