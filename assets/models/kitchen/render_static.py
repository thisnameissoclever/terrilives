"""Registered four-facing exports for new static kitchen models."""
import hashlib
import json
import math
from pathlib import Path
import traceback

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

from geometry import FACINGS

BASE = Path(__file__).resolve().parent
FURNITURE = BASE.parent/'furniture'
SIM = BASE.parent/'sims/sim-01'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(directory, name, build, source_files):
    assert bpy.app.background, 'Use background Blender, not the desktop session'
    directory.mkdir(parents=True,exist_ok=False)
    inputs = [Path(__file__),*source_files,FURNITURE/'build_parts.py',
              FURNITURE/'geometry.py',SIM/'sim-01-rigged.blend',
              SIM/'registered-canvas-proof.json']
    def input_hashes():
        return {path.relative_to(BASE.parent).as_posix():digest(path) for path in inputs}
    hashes = input_hashes()
    proof = {'state':'running','object':name,'inputs':hashes,'renders':[],
             'logical_canvas':[96,120],'source_density':8,
             'blender_version':bpy.app.version_string,
             'approval':'Unreviewed offline candidate; independent visual review required.'}
    journal = directory/'proof.json'
    def save():
        journal.write_text(json.dumps(proof,indent=2)+'\n')
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(SIM/'sim-01-rigged.blend'))
        scene = bpy.context.scene
        hidden = bpy.data.collections.new('Preserved Sim reference - hidden')
        scene.collection.children.link(hidden)
        for obj in list(bpy.data.objects):
            if obj.type in ('MESH','CURVE'):
                for collection in list(obj.users_collection):
                    collection.objects.unlink(obj)
                hidden.objects.link(obj)
        hidden.hide_render = True
        root = bpy.data.objects.new(name.upper()+'_MODEL_ROOT',None)
        scene.collection.objects.link(root)
        proof['model_checks'] = build(root)
        registration = json.loads((SIM/'registered-canvas-proof.json').read_text())['idle']
        scene.render.resolution_x,scene.render.resolution_y = 768,960
        scene.render.resolution_percentage = 100
        scene.camera.data.ortho_scale = registration['camera_ortho_scale']*120/88
        scene.camera.location = registration['camera_location']
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.film_transparent = True
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 2
        bpy.context.preferences.filepaths.save_version = 0
        bpy.context.view_layer.update()
        p = world_to_camera_view(scene,scene.camera,Vector((0,0,0)))
        proof['origin_pixels'] = [p.x*768,(1-p.y)*960]
        proof['camera_matrix'] = [list(row) for row in scene.camera.matrix_world]
        proof['ortho_scale'] = scene.camera.data.ortho_scale
        proof['parts'] = [obj.name for obj in root.children_recursive]
        proof['color_management'] = {'view':scene.view_settings.view_transform,
                                     'look':scene.view_settings.look}
        model = directory/f'{name}-authoring.blend'
        bpy.ops.wm.save_as_mainfile(filepath=str(model))
        proof['model_sha256'] = digest(model)
        for facing,degrees in FACINGS.items():
            root.rotation_euler.z = math.radians(degrees)
            scene.render.filepath = str(directory/f'closed-{facing}.png')
            bpy.ops.render.render(write_still=True)
            proof['renders'].append({'facing':facing,'degrees':degrees,
                                     'path':f'closed-{facing}.png',
                                     'sha256':digest(Path(scene.render.filepath))})
            save()
        assert hashes == input_hashes(), 'Render inputs changed during the batch'
        proof['state'] = 'complete'
        save()
    except Exception:
        proof['state'] = 'failed'
        proof['error'] = traceback.format_exc()
        save()
        raise
