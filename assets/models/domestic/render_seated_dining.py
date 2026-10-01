"""Render a physically fitted diner and chair as reciprocal owned contributions."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback
import time

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

BASE = Path(__file__).resolve().parent
MODELS = BASE.parent
sys.path[:0] = [str(MODELS / name) for name in ('domestic', 'dining', 'furniture', 'sims/sim-01')]
from dining_pose import seated_pose, prepare_spoon
from dining_contact import measure
from chair_model import build as build_chair
from table_model import build as build_table
from animation_export import render_pass
from render_shirt_variants import material_snapshot, set_shirt_colors, SHIRT_COLORS

FACINGS = {'SE': 90, 'SW': 0, 'NW': 270, 'NE': 180}
OWNERS = ('beauty', 'sim', 'furniture', 'lines')
OUT = BASE / 'seated-dining'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def signature():
    names = ('domestic/render_seated_dining.py', 'domestic/dining_pose.py',
             'domestic/dining_contact.py', 'domestic/render_dining.py', 'domestic/dining.blend',
             'dining/chair_model.py', 'dining/chair_layout.py', 'dining/table_model.py',
             'dining/table_layout.py', 'furniture/build_parts.py', 'furniture/animation_export.py',
             'living/armchair_contact.py', 'living/armchair_support.py',
             'sims/sim-01/build_rig.py', 'sims/sim-01/rig_math.py',
             'sims/sim-01/render_shirt_variants.py', 'sims/sim-01/registered-canvas-proof.json')
    return {name: digest(MODELS / name) for name in names}


def main():
    assert bpy.app.background
    check_only = '--check-only' in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    journal = OUT / ('contact-proof.json' if check_only else 'proof.json')
    inputs = signature()
    proof = dict(state='running', inputs=inputs, renders=[], contact_samples=[],
                 width=80, height=112, density=8, blender_version=bpy.app.version_string,
                 blender_build_hash=bpy.app.build_hash.decode())
    if journal.exists():
        previous = json.loads(journal.read_text())
        assert previous['inputs'] == inputs, 'Seating producer changed during checkpoint'
        proof = previous
        proof['state'] = 'running'
    def save():
        checkpoints = OUT / '.checkpoints'
        checkpoints.mkdir(exist_ok=True)
        snapshot = checkpoints / f'{time.time_ns():020}.json'
        snapshot.write_text(json.dumps(proof, indent=2) + '\n')
        if proof['state'] in ('complete', 'failed'):
            journal.write_text(snapshot.read_text())
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(BASE / 'dining.blend'))
        scene = bpy.context.scene
        rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
        rig.animation_data.action = bpy.data.actions.new('fitted_seated_dining')
        rig.rotation_euler.z = 0
        rig.location = (0, 0, 0)
        prepare_spoon()
        for frame in range(9):
            seated_pose(rig, (frame % 8) / 8)
            for bone in rig.pose.bones:
                bone.rotation_mode = 'QUATERNION'
                for field in ('location', 'rotation_quaternion', 'scale'):
                    bone.keyframe_insert(field, frame=frame + 1)
            for field in ('eyes_closed', 'book_visible', 'meal_mode'):
                rig.keyframe_insert(data_path=f'["{field}"]', frame=frame + 1)
            for field in ('location', 'rotation_quaternion', 'scale'):
                bpy.data.objects['Eating spoon'].keyframe_insert(field, frame=frame + 1)
        body = bpy.data.collections.new('Seated dining body')
        scene.collection.children.link(body)
        for obj in list(bpy.data.objects):
            if obj.type not in ('MESH', 'CURVE'):
                continue
            for collection in list(obj.users_collection):
                collection.objects.unlink(obj)
            body.objects.link(obj)
        chair = bpy.data.objects.new('Seated dining chair', None)
        scene.collection.objects.link(chair)
        build_chair(chair)
        furniture = bpy.data.collections.new('Seated dining furniture')
        scene.collection.children.link(furniture)
        for obj in chair.children_recursive:
            for collection in list(obj.users_collection):
                collection.objects.unlink(obj)
            furniture.objects.link(obj)
        table = bpy.data.objects.new('Seating table clearance', None)
        scene.collection.objects.link(table)
        build_table(table)
        for obj in table.children_recursive:
            obj.hide_render = True
        registration = json.loads((MODELS / 'sims/sim-01/registered-canvas-proof.json').read_text())['walk']
        scene.camera.location = registration['camera_location']
        scene.camera.data.ortho_scale = registration['camera_ortho_scale'] * 112 / 104
        scene.render.resolution_x, scene.render.resolution_y = 640, 896
        scene.render.resolution_percentage = 100
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 2
        point = world_to_camera_view(scene, scene.camera, Vector((0, 0, 0)))
        proof['anchor'] = [point.x * 80, (1 - point.y) * 112 + 21]
        if not check_only:
            bpy.context.preferences.filepaths.save_version = 0
            model = BASE / 'seated-dining.blend'
            bpy.ops.wm.save_as_mainfile(filepath=str(model))
            proof['model_sha256'] = digest(model)
            save()
        materials = material_snapshot()
        existing = {(row['facing'], row['frame'], row['variant'], row['owner']): row
                    for row in proof['renders']}
        for row in existing.values():
            assert digest(OUT / row['path']) == row['sha256'], 'Checkpoint image changed'
        proof['contact_samples'] = []
        for variant in ('green', 'blue', 'red'):
            if variant != 'green':
                set_shirt_colors(SHIRT_COLORS[variant], materials)
            for facing, degrees in FACINGS.items():
                angle = math.radians(degrees)
                rig.rotation_euler.z = angle - math.pi / 2
                chair.rotation_euler.z = angle
                for frame in range(8):
                    scene.frame_set(frame + 1)
                    if variant == 'green':
                        for arrangement, distance, table_angle, tangent in (
                                ('end', 1.5, angle - math.pi / 2, 0),
                                ('side-left', 1., angle, -.5),
                                ('side-right', 1., angle, .5)):
                            table.rotation_euler.z = table_angle
                            table.location = (-distance * math.cos(angle) - tangent * math.sin(angle),
                                              -distance * math.sin(angle) + tangent * math.cos(angle), 0)
                            sample = measure(rig, chair, table)
                            if frame == 4:
                                assert .054 < sample['spoon_mouth_distance'] < .056, 'Raised spoon misses mouth'
                            proof['contact_samples'].append(dict(facing=facing, frame=frame,
                                                                 arrangement=arrangement, **sample))
                            save()
                    for owner in (() if check_only else OWNERS):
                        key = (facing, frame, variant, owner)
                        if key in existing:
                            continue
                        path = OUT / f'{variant}-{facing}-{frame}-{owner}.png'
                        render_pass(scene, body, furniture, owner, path, separate_lines=True)
                        row = dict(facing=facing, frame=frame, variant=variant, owner=owner,
                                   path=path.name, sha256=digest(path))
                        proof['renders'].append(row)
                        save()
        assert len(proof['renders']) == (0 if check_only else 384) and len(proof['contact_samples']) == 96
        assert signature() == inputs, 'Seating inputs changed during render'
        proof['state'] = 'complete'
        save()
    except BaseException:
        proof['state'] = 'failed'
        proof['error'] = traceback.format_exc()
        save()
        raise


if __name__ == '__main__':
    main()
