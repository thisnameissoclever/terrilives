"""Render registered tabletop props through the existing orthographic camera."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from dishes import lathe, material

def build(parent, kind):
    metal=material("Cooking pot dark steel",(.14,.17,.18))
    food=material("Simmering vegetables",(.42,.34,.17))
    lathe("Cooking pot",[(0,0),(.14,0),(.17,.015),(.18,.13),(.18,.14),(.164,.14),(.15,.023),(0,.023)],metal,parent)
    lathe("Simmering meal",[(0,.08),(.14,.08),(.15,.09),(0,.09)],food,parent)
    return {"base_z":0,"diameter":.36}

SIM = BASE.parent / 'sims/sim-01'
OUT = BASE / 'export/pot'
FACINGS = {'SE': 90, 'NW': 270, 'SW': 0, 'NE': 180}
KINDS = {'cookingPot': 'pot'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    assert bpy.app.background
    OUT.mkdir(parents=True, exist_ok=True)
    proof = {'state': 'running', 'background': True, 'renders': [], 'source_sha256':
             digest(SIM / 'sim-01-rigged.blend'), 'blender': bpy.app.version_string}
    proof['inputs'] = {path.name: digest(path) for path in (Path(__file__), BASE / 'dishes.py')}
    journal = OUT / 'proof.json'
    def save():
        journal.write_text(json.dumps(proof, indent=2) + '\n')
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(SIM / 'sim-01-rigged.blend'))
        for obj in bpy.data.objects:
            if obj.type in ('MESH', 'CURVE'):
                obj.hide_render = True
        scene = bpy.context.scene
        registration = json.loads((SIM / 'registered-canvas-proof.json').read_text())['idle']
        scene.render.resolution_x = scene.render.resolution_y = 192
        scene.render.resolution_percentage = 100
        scene.camera.data.ortho_scale = registration['camera_ortho_scale'] * 24 / 88
        scene.camera.location = Vector(registration['camera_location']) - Vector((0, 0, 1.01))
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.film_transparent = True
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 2
        bpy.context.preferences.filepaths.save_version = 0
        bpy.context.view_layer.update()
        point = world_to_camera_view(scene, scene.camera, Vector((0, 0, 0)))
        proof['origin'] = [point.x * 24, (1 - point.y) * 24]
        proof['anchor'] = [proof['origin'][0], proof['origin'][1] + 21]
        proof['logical_size'] = [24, 24]
        proof['camera_matrix'] = [list(row) for row in scene.camera.matrix_world]
        proof['camera_scale'] = scene.camera.data.ortho_scale
        roots = []
        for name, kind in KINDS.items():
            root = bpy.data.objects.new(name, None)
            scene.collection.objects.link(root)
            proof[name] = build(root, kind)
            roots.append(root)
        bpy.ops.wm.save_as_mainfile(filepath=str(BASE / 'pot.blend'))
        proof['model_sha256'] = digest(BASE / 'pot.blend')
        for root in roots:
            for other in roots:
                for obj in other.children_recursive:
                    obj.hide_render = other != root
            for facing, degrees in FACINGS.items():
                root.rotation_euler.z = math.radians(degrees)
                bpy.context.view_layer.update()
                name = root.name + ('' if facing == 'SE' else facing)
                path = OUT / (name + '.png')
                scene.render.filepath = str(path)
                bpy.ops.render.render(write_still=True)
                proof['renders'].append({'name': name, 'path': path.name, 'kind': KINDS[root.name],
                                         'facing': facing, 'sha256': digest(path)})
                save()
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
