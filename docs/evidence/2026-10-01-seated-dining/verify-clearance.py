import bpy
import hashlib
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'assets/models'
OUT = Path(__file__).with_name('cooking-clearance.json')
OUT.write_text(json.dumps({'state': 'running'}))
sys.path[:0] = [str(BASE / name) for name in ('domestic', 'kitchen', 'furniture', 'living')]
from stove_model import build as build_stove
from render_pot import build as build_pot
from armchair_contact import evaluated_surface, intersection, body_inventory

bpy.ops.wm.open_mainfile(filepath=str(BASE / 'domestic/dining.blend'))
rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
rig.animation_data.action = bpy.data.actions['cook_v2']
stove = bpy.data.objects.new('Adversary stove', None)
bpy.context.scene.collection.objects.link(stove)
build_stove(stove)
pot = bpy.data.objects.new('Adversary pot', None)
bpy.context.scene.collection.objects.link(pot)
build_pot(pot, 'pot')
utensil = next(obj for obj in bpy.data.objects['Cooking spoon'].children if obj.type == 'MESH')
report = {
    'state': 'running',
    'model_sha256': hashlib.sha256((BASE / 'domestic/dining.blend').read_bytes()).hexdigest(),
    'samples': [],
    'method': 'Existing armchair evaluated triangle-crossing and containment mechanism',
}
for facing, degrees in [('SE', 90), ('NW', 270), ('SW', 0), ('NE', 180)]:
    angle = math.radians(degrees)
    rig.rotation_euler.z = angle
    rig.location = (0, 0, 0)
    stove.rotation_euler.z = angle + math.pi
    stove.location = (math.sin(angle), -math.cos(angle), 0)
    center = Vector((.235, -.77, .882))
    pot.location = (center.x * math.cos(angle) - center.y * math.sin(angle),
                    center.x * math.sin(angle) + center.y * math.cos(angle), center.z)
    for frame in range(8):
        bpy.context.scene.frame_set(frame + 1)
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        stove_surfaces = {obj.name: evaluated_surface(obj, deps) for obj in stove.children_recursive if obj.type == 'MESH'}
        pot_metal = next(obj for obj in pot.children if obj.name.startswith('Cooking pot'))
        metal = evaluated_surface(pot_metal, deps)
        spoon = evaluated_surface(utensil, deps)
        collisions = []
        for name, other in [*stove_surfaces.items(), (pot_metal.name, metal)]:
            witness = intersection(spoon, other)
            if witness:
                collisions.append({'first': utensil.name, 'second': name, 'witness': witness})
        for name in sorted(body_inventory()):
            obj = bpy.data.objects.get(name)
            if obj is None:
                raise ValueError('Missing body part: ' + name)
            surface = evaluated_surface(obj, deps)
            for other_name, other in [*stove_surfaces.items(), (pot_metal.name, metal)]:
                witness = intersection(surface, other)
                if witness:
                    collisions.append({'first': name, 'second': other_name, 'witness': witness})
        report['samples'].append({'facing': facing, 'frame': frame, 'collisions': collisions})
        OUT.write_text(json.dumps(report, indent=2))
report['state'] = 'complete'
report['collision_count'] = sum(len(row['collisions']) for row in report['samples'])
OUT.write_text(json.dumps(report, indent=2))
assert report['collision_count'] == 0, report
