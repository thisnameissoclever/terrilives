"""Render an immutable-source four-facing toilet pose prototype."""
import hashlib
import json
import math
from pathlib import Path
import shutil
import sys
import traceback

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

BASE = Path(__file__).resolve().parent
MODELS = BASE.parents[1]
sys.path[:0] = [str(BASE), str(BASE.parent), str(MODELS/'furniture')]
from toilet_pose import apply
from toilet_contact import measure
from check_toilet_scene import validate as validate_fixture
from animation_export import render_pass

SOURCE = MODELS/'bathroom/owner-review-pending/toilet/candidate-03/toilet-authoring.blend'
EXPECTED_SOURCE = '7eac6444f15d540cfc025c3d5c650ba694c2f30c6cdaebb119853b08f7651859'
RIG_SOURCE = MODELS/'sims/sim-01/sim-01-rigged.blend'
EXPECTED_RIG = '919e8994cbf7510a4d9947f173abec8b41ac77d61f6e829bcf5981c8d2fcddce'
FACINGS = {'SE':90, 'NW':270, 'SW':0, 'NE':180}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def partition(scene, root, rig):
    fixture_members = set(root.children_recursive)
    body_members = set(rig.children_recursive)
    body = bpy.data.collections.new('Toilet action body')
    furniture = bpy.data.collections.new('Toilet action fixture')
    scene.collection.children.link(body)
    scene.collection.children.link(furniture)
    for obj in list(bpy.data.objects):
        if obj.type not in ('MESH', 'CURVE'):
            continue
        target = furniture if obj in fixture_members else body if obj in body_members else None
        if target is None:
            if not obj.hide_render:
                raise ValueError(f'Unowned visible geometry: {obj.name}')
            continue
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        target.objects.link(obj)
    for collection in bpy.data.collections:
        collection.hide_render = False
        collection.hide_viewport = False
    bpy.context.view_layer.update()
    return body, furniture


def run(output, render=True):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use hidden background Blender and a new absolute output directory')
    output.mkdir(parents=True, exist_ok=False)
    scripts = {Path(module.__file__).resolve() for module in sys.modules.values()
               if getattr(module, '__file__', None) and str(module.__file__).endswith('.py')
               and Path(module.__file__).resolve().is_relative_to(MODELS.resolve())}
    scripts.update((SOURCE, RIG_SOURCE, MODELS/'sims/sim-01/registered-canvas-proof.json',
                    SOURCE.parent/'proof.json', MODELS/'bathroom/toilet_model.py',
                    MODELS/'bathroom/toilet_geometry.py'))
    inputs = {path.relative_to(MODELS).as_posix():digest(path) for path in sorted(scripts)}
    for path in sorted(scripts):
        if path.suffix == '.py':
            snapshot = output/'source'/path.relative_to(MODELS)
            snapshot.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, snapshot)
    proof = dict(state='running', mode='green-four-facing-source-prototype', inputs=inputs,
                 blender_version=bpy.app.version_string, renders=[])
    journal = output/'proof.json'
    def save():
        journal.write_text(json.dumps(proof, indent=2, allow_nan=False)+'\n')
    save()
    try:
        if digest(SOURCE) != EXPECTED_SOURCE or digest(RIG_SOURCE) != EXPECTED_RIG:
            raise ValueError('Immutable source hash does not match')
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
        scene = bpy.context.scene
        root = bpy.data.objects['TOILET_MODEL_ROOT']
        rig = bpy.data.objects['SIM_01_SHARED_RIG']
        root.rotation_euler.z = 0
        rig.rotation_euler.z = 0
        rig.animation_data.action = None
        scene.frame_set(1)
        body, furniture = partition(scene, root, rig)
        proof['fixture_validation'] = validate_fixture()
        proof['original_render_dimensions'] = [scene.render.resolution_x, scene.render.resolution_y]
        if proof['original_render_dimensions'] != [768, 960]:
            raise ValueError('Accepted source dimensions changed')
        scene.render.resolution_percentage = 100
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 2
        scene.render.film_transparent = True
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        origin = world_to_camera_view(scene, scene.camera, Vector((0, 0, 0)))
        proof['origin_pixels'] = [origin.x*768, (1-origin.y)*960]
        proof['camera_matrix'] = [list(row) for row in scene.camera.matrix_world]
        proof['ortho_scale'] = scene.camera.data.ortho_scale
        apply(rig)
        initial = measure(root, rig, body, require=False)
        proof['initial_fit'] = initial
        hip_z = .60+.001-initial['ring_min_gap']
        proof['fitted_hip_z'] = hip_z
        apply(rig, hip_z=hip_z)
        proof['fitted_diagnostics'] = measure(root, rig, body, require=False)
        save()
        proof['contact'] = measure(root, rig, body)
        bpy.context.preferences.filepaths.save_version = 0
        model = output/'toilet-pose-authoring.blend'
        bpy.ops.wm.save_as_mainfile(filepath=str(model))
        proof['editable_model'] = dict(path=model.name, sha256=digest(model))
        if render:
            for facing, degrees in FACINGS.items():
                root.rotation_euler.z = math.radians(degrees)
                rig.rotation_euler.z = math.radians(degrees)
                bpy.context.view_layer.update()
                path = output/f'{facing}-green-0-beauty.png'
                render_pass(scene, body, furniture, 'beauty', path, separate_lines=True)
                proof['renders'].append(dict(facing=facing, variant='green', frame=0, owner='beauty',
                                             path=path.name, sha256=digest(path)))
                save()
        for name, expected in inputs.items():
            if digest(MODELS/name) != expected:
                raise ValueError(f'Immutable input changed: {name}')
        proof['immutable_sources_byte_identical'] = True
        proof['state'] = 'complete'
        save()
    except BaseException:
        proof['state'] = 'failed'
        proof['error'] = traceback.format_exc()
        proof['immutable_sources_byte_identical'] = all(digest(MODELS/name) == expected
                                                       for name, expected in inputs.items())
        save()
        raise


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    run(Path(args[0]), '--measure-only' not in args)
