"""Render all game facings from the same saved Blender model used by the contact fixture."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

MODELS = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(MODELS/'bathroom'), str(MODELS/'furniture')]
from geometry import FACINGS
from render_wide_static import CANVAS, DENSITY


def digest(path):
    with path.open('rb') as inp:
        return hashlib.file_digest(inp, 'sha256').hexdigest()


def render(source, directory):
    model = source/'pool-authoring.blend'
    fixture_path = source/'contacts.json'
    fixture = json.loads(fixture_path.read_bytes())
    if fixture['revisions']['model'] != digest(model):
        raise ValueError('The sprite and contact fixture must use the same saved model.')
    directory.mkdir(parents=True, exist_ok=True)
    output = directory/'proof.json'
    if output.exists() or any((directory/f'closed-{facing}.png').exists() for facing in FACINGS):
        raise ValueError('Render outputs already exist.')
    bpy.ops.wm.open_mainfile(filepath=str(model), load_ui=False, use_scripts=False)
    root = bpy.data.objects['POOL_MODEL_ROOT']
    cameras = [s for s in bpy.data.scenes if s.camera is not None]
    if len(cameras) != 1:
        raise ValueError('Missing unique original registered Sim camera scene.')
    scene = cameras[0]
    bpy.context.window.scene = scene
    # Character animation keys can override an object's visibility at render time.
    # Keep the entire reference geometry in a hidden collection as the registered exporter does.
    hidden = bpy.data.collections.new('Preserved Sim reference - hidden')
    scene.collection.children.link(hidden)
    for obj in list(scene.objects):
        if obj.type in ('MESH', 'CURVE'):
            for owner in list(obj.users_collection):
                owner.objects.unlink(obj)
            hidden.objects.link(obj)
    hidden.hide_render = True
    for obj in [root, *root.children_recursive]:
        if obj.name not in scene.objects:
            scene.collection.objects.link(obj)
    registration = json.loads((MODELS/'sims/sim-01/registered-canvas-proof.json').read_bytes())['idle']
    width, height = (n*DENSITY for n in CANVAS)
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.resolution_percentage = 100
    scene.camera.data.ortho_scale = registration['camera_ortho_scale']*max(CANVAS)/88
    scene.camera.location = registration['camera_location']
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = True
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 1
    bpy.context.view_layer.update()
    p = world_to_camera_view(scene, scene.camera, Vector((0, 0, 0)))
    origin = [p.x*width, (1-p.y)*height]
    if any(abs(a-b) >= .01 for a,b in zip(origin, (640, 984.0035))):
        raise ValueError('Registered camera origin drift.')
    sources = [Path(__file__), MODELS/'outdoor/export_pool_fixture_v5.py',
               MODELS/'outdoor/pool_activity_model_v5.py', MODELS/'outdoor/pool_activity_layout_v5.py',
               MODELS/'outdoor/pool_activity_model_v4.py', MODELS/'outdoor/pool_activity_layout_v4.py',
               MODELS/'outdoor/pool_activity_rail_v4.py', MODELS/'furniture/build_parts.py',
               MODELS/'furniture/geometry.py', MODELS/'bathroom/render_wide_static.py',
               MODELS/'sims/sim-01/registered-canvas-proof.json', MODELS/'sims/sim-01/sim-01-rigged.blend']
    definition = json.loads((source/'motion.json').read_bytes())
    if definition['modelSource'] == 'outdoor/pool_activity_model_v6.py':
        sources.extend([MODELS/'outdoor/export_pool_fixture_v6.py', MODELS/definition['modelSource']])
    if definition['modelSource'] == 'outdoor/pool_activity_model_v7.py':
        sources.extend([MODELS/'outdoor/export_pool_fixture_v7.py', MODELS/'outdoor/pool_activity_layout_v7.py',
                        MODELS/definition['modelSource']])
    if definition['modelSource'] == 'outdoor/pool_activity_model_v8.py':
        sources.extend([MODELS/'outdoor/export_pool_fixture_v7.py', MODELS/'outdoor/pool_activity_layout_v7.py',
                        MODELS/'outdoor/export_pool_fixture_v8.py', MODELS/'outdoor/pool_activity_layout_v8.py',
                        MODELS/definition['modelSource']])
    rectangular = definition['modelSource'] == 'outdoor/pool_activity_model_v9.py'
    wide = rectangular and definition.get('rectangularPool') != 'compact'
    if rectangular:
        sources.extend(MODELS/f'outdoor/{name}' for name in (
            'export_pool_fixture_v9.py', 'pool_activity_layout_v9.py',
            'pool_activity_model_v9.py', 'pool_activity_layout_v8.py',
            'pool_activity_model_v8.py', 'pool_activity_layout_v7.py',
        ))
        sys.path.insert(0, str(MODELS/'outdoor'))
        from pool_activity_layout_v9 import ORIGIN_Y
    proof = {'state':'rendering', 'object':'pool', 'inputs':{s.relative_to(MODELS).as_posix():digest(s) for s in sources},
             'blender_version':bpy.app.version_string, 'logical_canvas':list(CANVAS),
             'source_density':DENSITY, 'origin_pixels':origin, 'camera_matrix':[list(v) for v in scene.camera.matrix_world],
             'ortho_scale':scene.camera.data.ortho_scale, 'parts':[o.name for o in root.children_recursive],
             'model_sha256':digest(model), 'fixture_sha256':digest(fixture_path),
             'model_checks':{'footprint':[3,2] if wide else [2,2], 'water_z':fixture['waterHeight'],
                             'rail_centers_x':[rail['points'][0]['point'][0] for rail in fixture['rails']]},
             'color_management':{'view':scene.view_settings.view_transform, 'look':scene.view_settings.look},
             'approval':'Unreviewed offline candidate; independent visual review required.', 'renders':[]}
    for facing, degrees in FACINGS.items():
        root.rotation_euler.z = math.radians(degrees)
        if wide:
            root.location = root.rotation_euler.to_matrix() @ Vector((0, -ORIGIN_Y, 0))
        path = directory/f'closed-{facing}.png'
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        proof['renders'].append({'facing':facing, 'degrees':degrees, 'path':path.name, 'sha256':digest(path)})
        output.write_text(json.dumps(proof, indent=2)+'\n', encoding='utf8')
    if digest(model) != fixture['revisions']['model']:
        raise ValueError('Render changed the authored fixture model.')
    if directory != source:
        if (directory/model.name).exists():
            raise ValueError('Destination already contains an authoring model.')
        shutil.copyfile(model, directory/model.name)
    proof['state']='complete'
    output.write_text(json.dumps(proof, indent=2)+'\n', encoding='utf8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    render(args.directory.resolve(), (args.output or args.directory).resolve())
