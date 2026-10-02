"""Bake food transport, seated eating and cooking with registered contact geometry."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
from mathutils import Vector, Matrix

BASE = Path(__file__).resolve().parent
SIM = BASE.parent / 'sims/sim-01'
sys.path[:0] = [str(BASE), str(SIM)]
from build_rig import pose, direct_bone, arm_elbow
from dishes import build
from render_job import apply_render_job
from render_shirt_variants import material_snapshot, set_shirt_colors, SHIRT_COLORS

CONTACT = json.loads((BASE / 'cooking-contact.json').read_text())
OUT = BASE / 'dining'
ACTIONS = {'food_walk': ('FoodWalk', 8), 'food_idle': ('FoodIdle', 4), 'seated_eat': ('SeatedEat', 8), 'cook_v2': ('CookV2', 8)}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cooking_target(phase):
    tip = Vector(CONTACT['pot_center_sim'])
    tip.z = CONTACT['bowl_height']
    tip.x += CONTACT['stir_radius'] * math.sin(phase * math.tau)
    tip.y += CONTACT['stir_radius'] * math.cos(phase * math.tau)
    return tip


def cooking_wrist(phase):
    wrist = Vector(CONTACT['wrist'])
    offset = Vector(CONTACT['grip_offset'])
    tip = cooking_target(phase)
    lateral = tip.x - wrist.x - offset.x
    vertical = tip.z - wrist.z - offset.z
    wrist.y = tip.y + math.sqrt(CONTACT['spoon_length']**2 - lateral**2 - vertical**2) - offset.y
    return wrist


def set_pose(rig, action, phase):
    pose(rig, 'walk' if action == 'food_walk' else 'sit' if action == 'seated_eat' else 'idle', phase)
    bpy.context.view_layer.update()
    for side, sign in (('L', -1), ('R', 1)):
        upper = rig.data.bones['upper_arm.' + side]
        lower = rig.data.bones['forearm.' + side]
        shoulder = upper.head_local.copy() + (Vector((0,-.06,-.33)) if action == 'seated_eat' else Vector((0,0,0)))
        if action == 'seated_eat':
            raised = (1 - math.cos(phase * math.tau)) / 2
            wrist = Vector((.14, -.43 + .20*raised, .86 + .22*raised)) if side == 'R' else Vector((-.19, -.45, .83))
        elif action == 'cook_v2':
            wrist = cooking_wrist(phase) if side == 'R' else Vector((-.19, -.30, 1.04))
        else:
            wrist = Vector((sign*.13, -.26, 1.0))
        elbow = arm_elbow(shoulder, wrist, upper.length, lower.length, Vector((sign*.6, .02, shoulder.z-.2)))
        direct_bone(rig, 'upper_arm.' + side, shoulder, elbow)
        direct_bone(rig, 'forearm.' + side, elbow, wrist)
        direct_bone(rig, 'hand.' + side, wrist, wrist + Vector((-sign*.025, -.09, -.015)))


def visibility(obj, rig, mode):
    driver = obj.driver_add('hide_render').driver
    v=driver.variables.new(); v.name='mode'; v.targets[0].id=rig; v.targets[0].data_path='["meal_mode"]'
    driver.expression=f'mode != {mode}'


def main():
    assert bpy.app.background
    OUT.mkdir(parents=True, exist_ok=True)
    proof = {'state': 'running', 'background': True, 'completed': 0, 'expected': 336,
             'source_sha256': digest(SIM / 'sim-01-rigged.blend'), 'jobs': [],
             'inputs': {name: digest(BASE / name) for name in ('render_dining.py', 'cooking-contact.json', 'dishes.py')}}
    journal = OUT / 'proof.json'
    def save():
        journal.write_text(json.dumps(proof, indent=2) + '\n')
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(SIM / 'sim-01-rigged.blend'))
        scene = bpy.context.scene
        rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
        rig['meal_mode']=0.0
        for label, kind, position, mode in (('Carried dinner', 'meal', (0,-.35,1.0),0),
                                            ('Dinner on table', 'meal', (0,-.69,.79),1)):
            held=bpy.data.objects.new(label,None); scene.collection.objects.link(held)
            held.parent=rig; held.location=position
            build(held,kind)
            for obj in held.children: visibility(obj,rig,mode)
        from dishes import spoon, material
        for label, mode in (('Eating spoon',1),('Cooking spoon',2)):
            held=bpy.data.objects.new(label,None); scene.collection.objects.link(held)
            held.parent=rig; held.parent_type='BONE'; held.parent_bone='hand.R'
            held.location=(0,-.035,0)
            utensil=spoon(held, material(label+' wood',(.45,.29,.13)))
            utensil.rotation_euler=(0,0,0)
            if mode == 2:
                cooking_holder = held
                cooking_utensil = utensil
                for vertex in utensil.data.vertices:
                    y = vertex.co.y
                    vertex.co.y = -.04 if y < 0 else .30 + (y - .048) if y >= .048 else y * .30 / .048
                    vertex.co.z = 0
            visibility(utensil,rig,mode)
        rig.animation_data_create()
        for action, (_, count) in ACTIONS.items():
            clip = bpy.data.actions.new(action)
            clip.use_fake_user = True
            rig.animation_data.action = clip
            for index in range(count + 1):
                phase = (index % count) / count
                set_pose(rig, action, phase)
                if action == 'cook_v2':
                    bpy.context.view_layer.update()
                    grip_local = rig.data.bones['hand.R'].matrix_local.inverted() @ Vector((.303,-.075,.737))
                    wrist = rig.pose.bones['hand.R'].matrix @ grip_local
                    tip = cooking_target(phase)
                    direction = tip - wrist
                    rotation = Vector((0,1,0)).rotation_difference(direction.normalized())
                    cooking_holder.matrix_world = rig.matrix_world @ Matrix.Translation(wrist) @ rotation.to_matrix().to_4x4()
                    assert abs(direction.length - CONTACT['spoon_length']) < .0001
                    cooking_utensil.scale.y = 1.0
                    cooking_holder.rotation_mode = 'QUATERNION'
                    for field in ('location','rotation_quaternion','scale'):
                        cooking_holder.keyframe_insert(field, frame=index + 1)
                    cooking_utensil.keyframe_insert('scale', frame=index + 1)
                rig['meal_mode'] = 1.0 if action == 'seated_eat' else 2.0 if action == 'cook_v2' else 0.0
                for bone in rig.pose.bones:
                    bone.rotation_mode = 'QUATERNION'
                    for field in ('location', 'rotation_quaternion', 'scale'):
                        bone.keyframe_insert(field, frame=index + 1)
                for field in ('eyes_closed', 'book_visible', 'meal_mode'):
                    rig.keyframe_insert(data_path=f'["{field}"]', frame=index + 1)
            clip['loop_samples'] = count
        registration = json.loads((SIM / 'registered-canvas-proof.json').read_text())
        upright = registration['walk']
        registrations = {action: dict(upright) for action in ACTIONS}
        for reg in registrations.values():
            reg['width']=80
            reg['anchor']=[upright['anchor'][0]+14,upright['anchor'][1]]
            reg['world_origin']=[upright['world_origin'][0]+14,upright['world_origin'][1]]
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 2
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(BASE / 'dining.blend'))
        proof['model_sha256'] = digest(BASE / 'dining.blend')
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
            clips['food_walk']['distance_per_cycle_model_units'] = 1.0
            clips['food_walk']['sample_fps'] = 10
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
