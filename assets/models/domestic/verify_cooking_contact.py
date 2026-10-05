"""Measure and render the cook, stove and pot together in all registered views."""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent / 'kitchen'), str(BASE.parent / 'furniture')]
from stove_model import build as build_stove
from render_pot import build as build_pot


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    assert bpy.app.background
    contact = json.loads((BASE / 'cooking-contact.json').read_text())
    out = BASE / 'export/cooking-contact'
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(BASE / 'dining.blend'))
    scene = bpy.context.scene
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    holder = bpy.data.objects['Cooking spoon']
    utensil = next(o for o in holder.children if o.type == 'MESH')
    stove = bpy.data.objects.new('Contact fixture stove', None)
    scene.collection.objects.link(stove)
    build_stove(stove)
    pot = bpy.data.objects.new('Contact fixture pot', None)
    scene.collection.objects.link(pot)
    build_pot(pot, 'pot')
    rig.animation_data.action = bpy.data.actions['cook_v2']
    scene.render.resolution_x = 384
    scene.render.resolution_y = 384
    scene.render.resolution_percentage = 100
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 2
    scene.camera.data.ortho_scale = 3.4
    # Preserve the accepted camera orientation and center the composed fixture.
    scene.camera.location += Vector((0, 0, .35))
    report = {'state': 'running', 'model_sha256': digest(BASE / 'dining.blend'),
              'inputs': {str(p.relative_to(BASE.parent)): digest(p) for p in
                         (Path(__file__), BASE / 'cooking-contact.json',
                          BASE.parent / 'kitchen/stove_model.py', BASE / 'render_pot.py')},
              'samples': []}
    journal = out / 'proof.json'
    journal.write_text(json.dumps(report, indent=2) + '\n')
    for facing, degrees in (('SE', 90), ('NW', 270), ('SW', 0), ('NE', 180)):
        angle = math.radians(degrees)
        rig.rotation_euler.z = angle
        rig.location = (0, 0, 0)
        stove.rotation_euler.z = angle + math.pi
        stove.location = (math.sin(angle), -math.cos(angle), 0)
        center = Vector(contact['pot_center_sim'])
        pot.location = (center.x * math.cos(angle) - center.y * math.sin(angle),
                        center.x * math.sin(angle) + center.y * math.cos(angle), center.z)
        for frame in range(8):
            scene.frame_set(frame + 1)
            bpy.context.view_layer.update()
            palm = rig.matrix_world @ rig.pose.bones['hand.R'].matrix @ rig.data.bones['hand.R'].matrix_local.inverted() @ Vector((.303, -.075, .737))
            grip = holder.matrix_world.translation
            bowl = utensil.matrix_world @ Vector((0, .36, 0))
            delta = bowl - pot.location
            grip_error = (grip - palm).length
            radius = math.hypot(delta.x, delta.y)
            assert grip_error < .001, (facing, frame, 'detached grip', grip_error)
            assert radius < .08, (facing, frame, 'bowl misses pot', radius)
            assert .065 < delta.z < .12, (facing, frame, 'bowl height', delta.z)
            path = out / f'{facing}-{frame}.png'
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            report['samples'].append(dict(facing=facing, frame=frame, grip_error=grip_error,
                                          bowl_radius=radius, bowl_height=delta.z,
                                          path=path.name, sha256=digest(path)))
            journal.write_text(json.dumps(report, indent=2) + '\n')
    report['state'] = 'complete'
    journal.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
