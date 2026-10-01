"""Bake walking, holding and washing dishes, including real hand occlusion."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
SIM = BASE.parent / 'sims/sim-01'
sys.path[:0] = [str(BASE), str(SIM)]
from build_rig import pose, direct_bone, arm_elbow
from dishes import build
from render_job import apply_render_job
from render_shirt_variants import material_snapshot, set_shirt_colors, SHIRT_COLORS

OUT = BASE / 'cleanup'
ACTIONS = {'carry_walk': ('CarryWalk', 8), 'carry_idle': ('CarryIdle', 4), 'wash': ('Wash', 4)}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def set_pose(rig, action, phase):
    pose(rig, 'walk' if action == 'carry_walk' else 'idle', phase)
    for side, sign in (('L', -1), ('R', 1)):
        upper = rig.data.bones['upper_arm.' + side]
        lower = rig.data.bones['forearm.' + side]
        shoulder = upper.head_local.copy()
        if action == 'wash':
            wrist = Vector((-.11, -.40, 1.125)) if side == 'L' else Vector((
                .08 + .02 * math.sin(phase * math.tau),
                -.40 + .02 * math.cos(phase * math.tau), 1.16))
        else:
            wrist = Vector((sign * .13, -.26, 1.00))
        elbow = arm_elbow(shoulder, wrist, upper.length, lower.length, Vector((sign * .6, .02, 1.0)))
        direct_bone(rig, 'upper_arm.' + side, shoulder, elbow)
        direct_bone(rig, 'forearm.' + side, elbow, wrist)
        direct_bone(rig, 'hand.' + side, wrist, wrist + Vector((-sign * .025, -.09, -.015)))
    if action == 'wash':
        direct_bone(rig, 'root', Vector((0, -.30, 0)), Vector((0, -.30, .1)))


def main():
    assert bpy.app.background
    OUT.mkdir(parents=True, exist_ok=True)
    proof = {'state': 'running', 'background': True, 'completed': 0, 'expected': 192,
             'source_sha256': digest(SIM / 'sim-01-rigged.blend'), 'jobs': []}
    journal = OUT / 'proof.json'
    def save():
        journal.write_text(json.dumps(proof, indent=2) + '\n')
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(SIM / 'sim-01-rigged.blend'))
        scene = bpy.context.scene
        rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
        held = bpy.data.objects.new('Held used plate', None)
        scene.collection.objects.link(held)
        held.parent = rig
        build(held, 'plate')
        rig['dish_washing'] = 0.0
        for axis, expression in ((1, '-0.35 - 0.44 * wash'), (2, '1.0 + 0.12 * wash')):
            driver = held.driver_add('location', axis).driver
            variable = driver.variables.new()
            variable.name = 'wash'
            variable.targets[0].id = rig
            variable.targets[0].data_path = '["dish_washing"]'
            driver.expression = expression
        rig.animation_data_create()
        for action, (_, count) in ACTIONS.items():
            clip = bpy.data.actions.new(action)
            clip.use_fake_user = True
            rig.animation_data.action = clip
            for index in range(count + 1):
                set_pose(rig, action, (index % count) / count)
                rig['dish_washing'] = float(action == 'wash')
                for bone in rig.pose.bones:
                    bone.rotation_mode = 'QUATERNION'
                    for field in ('location', 'rotation_quaternion', 'scale'):
                        bone.keyframe_insert(field, frame=index + 1)
                for field in ('eyes_closed', 'book_visible', 'dish_washing'):
                    rig.keyframe_insert(data_path=f'["{field}"]', frame=index + 1)
            clip['loop_samples'] = count
        registration = json.loads((SIM / 'registered-canvas-proof.json').read_text())
        upright = registration['walk']
        registrations = {action: dict(upright) for action in ACTIONS}
        wash = registrations['wash']
        wash['width'] = 80
        wash['anchor'] = [upright['anchor'][0] + 14, upright['anchor'][1]]
        wash['world_origin'] = [upright['world_origin'][0] + 14, upright['world_origin'][1]]
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 2
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(BASE / 'cleanup.blend'))
        proof['model_sha256'] = digest(BASE / 'cleanup.blend')
        materials = material_snapshot()
        for variant in ('green', 'blue', 'red'):
            folder = OUT / variant
            folder.mkdir(exist_ok=True)
            if variant != 'green':
                set_shirt_colors(SHIRT_COLORS[variant], materials)
            prefix = 'rigSim' + (variant.title() if variant != 'green' else '')
            frames = []
            for action, (stem, count) in ACTIONS.items():
                for facing in ('SE', 'SW', 'NW', 'NE'):
                    for index in range(count):
                        job = apply_render_job(scene, rig, registrations, action, facing, index)
                        scene.render.resolution_x = registrations[action]['width'] * 8
                        scene.render.resolution_y = registrations[action]['height'] * 8
                        job['resolution'] = [scene.render.resolution_x, scene.render.resolution_y]
                        path = folder / f'{action}-{facing}-{index}.png'
                        scene.render.filepath = str(path)
                        bpy.ops.render.render(write_still=True)
                        frames.append(dict(name=f'{prefix}{stem}{facing}{index}', action=action,
                                           facing=facing, frame=index, path=path.name, sha256=digest(path)))
                        proof['jobs'].append(dict(action=action, facing=facing, frame=index,
                                                   variant=variant, **job))
                        proof['completed'] += 1
                        save()
            clips = {action: dict(frame_count=count, sample_fps=2, loop=True, source_action=action,
                                  width=registrations[action]['width'], height=registrations[action]['height'],
                                  anchor=registrations[action]['anchor'], world_origin=registrations[action]['world_origin'])
                     for action, (_, count) in ACTIONS.items()}
            clips['carry_walk']['distance_per_cycle_model_units'] = 1.0
            clips['carry_walk']['sample_fps'] = 10
            manifest = dict(schema_version=1, width=38, height=88, anchor=registration['idle']['anchor'],
                            source_sha256=proof['source_sha256'], variant=variant, pixel_density=8,
                            frames=frames, clips=clips)
            (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        assert digest(SIM / 'sim-01-rigged.blend') == proof['source_sha256']
        proof['state'] = 'complete'
        save()
    except Exception:
        proof['state'] = 'failed'
        proof['error'] = traceback.format_exc()
        save()
        raise


if __name__ == '__main__':
    main()
