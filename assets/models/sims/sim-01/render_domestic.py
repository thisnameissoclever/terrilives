"""Bake domestic work on the accepted rig and render three shirt palettes."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from build_rig import pose, direct_bone, arm_elbow
from render_job import apply_render_job
from render_shirt_variants import material_snapshot, set_shirt_colors, SHIRT_COLORS

OUT = BASE / 'export' / 'domestic'
STATUS = BASE / 'domestic-status.json'
ACTIONS = ('prepare', 'cook', 'wash')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def status(state, **fields):
    STATUS.write_text(json.dumps(dict(state=state, background=bpy.app.background,
                                     version=bpy.app.version_string, **fields), indent=2))


def domestic_pose(rig, action, phase):
    pose(rig, 'idle', phase)
    wave = math.sin(phase * math.tau)
    for side, sign in (('L', -1), ('R', 1)):
        upper = rig.data.bones['upper_arm.' + side]
        lower = rig.data.bones['forearm.' + side]
        shoulder = upper.head_local.copy()
        if action == 'prepare':
            wrist = Vector((sign * .16, -.32, 1.08 + (.055 * wave if side == 'R' else 0)))
        elif action == 'cook':
            wrist = Vector((sign * .16 + (.055 * wave if side == 'R' else 0),
                            -.31 + (.045 * math.cos(phase * math.tau) if side == 'R' else 0), 1.12))
        else:
            wrist = Vector((sign * .075, -.28, 1.13 + sign * .035 * wave))
        elbow = arm_elbow(shoulder, wrist, upper.length, lower.length,
                          Vector((sign * .6, .02, 1.0)))
        direct_bone(rig, 'upper_arm.' + side, shoulder, elbow)
        direct_bone(rig, 'forearm.' + side, elbow, wrist)
        direct_bone(rig, 'hand.' + side, wrist, wrist + Vector((-sign * .025, -.09, -.015)))


def main():
    assert bpy.app.background, 'Background rendering is required.'
    OUT.mkdir(parents=True, exist_ok=True)
    status('running', stage='opening rig')
    source = BASE / 'sim-01-rigged.blend'
    source_hash = digest(source)
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
    rig.animation_data_create()
    for action in ACTIONS:
        assert action not in bpy.data.actions, action
        clip = bpy.data.actions.new(action)
        clip.use_fake_user = True
        rig.animation_data.action = clip
        for index in range(5):
            domestic_pose(rig, action, (index % 4) / 4)
            for bone in rig.pose.bones:
                bone.rotation_mode = 'QUATERNION'
                for field in ('location', 'rotation_quaternion', 'scale'):
                    bone.keyframe_insert(field, frame=index + 1)
            for field in ('eyes_closed', 'book_visible'):
                rig.keyframe_insert(data_path=f'["{field}"]', frame=index + 1)
        clip['sample_fps'] = 2
        clip['loop_samples'] = 4
    bpy.ops.wm.save_as_mainfile(filepath=str(BASE / 'sim-01-domestic.blend'))
    registration = json.loads((BASE / 'registered-canvas-proof.json').read_text())
    upright = registration['talk']
    registrations = {action: dict(upright) for action in ACTIONS}
    materials = material_snapshot()
    completed = 0
    jobs = []
    for variant in ('green', 'blue', 'red'):
        folder = OUT / variant
        folder.mkdir(exist_ok=True)
        if variant != 'green':
            set_shirt_colors(SHIRT_COLORS[variant], materials)
        prefix = 'rigSim' + (variant.title() if variant != 'green' else '')
        frames = []
        for action in ACTIONS:
            for facing in ('SE', 'SW', 'NW', 'NE'):
                for index in range(4):
                    proof = apply_render_job(scene, rig, registrations, action, facing, index)
                    name = f'{action}-{facing}-{index}.png'
                    path = folder / ('raw-' + name)
                    scene.render.filepath = str(path)
                    bpy.ops.render.render(write_still=True)
                    frames.append(dict(name=f'{prefix}{action.title()}{facing}{index}', action=action,
                                       facing=facing, frame=index, path=name, raw_sha256=digest(path)))
                    jobs.append(dict(variant=variant, action=action, facing=facing, frame=index, **proof))
                    completed += 1
                    status('running', stage='rendering', completed=completed, expected=144)
        manifest = dict(schema_version=1, width=38, height=88, anchor=registration['idle']['anchor'],
                        source_sha256=source_hash, variant=variant, pixel_density=2, frames=frames,
                        clips={action: dict(frame_count=4, sample_fps=2, loop=True, source_action=action,
                                            width=upright['width'], height=upright['height'],
                                            anchor=upright['anchor'], world_origin=upright['world_origin'])
                               for action in ACTIONS})
        (folder / 'render-manifest.json').write_text(json.dumps(manifest, indent=2))
    assert digest(source) == source_hash, 'Accepted rig was modified.'
    (OUT / 'render-proof.json').write_text(json.dumps(jobs, indent=2))
    status('complete', completed=completed, expected=144, source_sha256=source_hash,
           domestic_sha256=digest(BASE / 'sim-01-domestic.blend'))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        status('failed', traceback=traceback.format_exc())
        raise
