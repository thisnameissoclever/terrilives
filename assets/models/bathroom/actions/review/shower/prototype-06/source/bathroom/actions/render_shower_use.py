"""Render a mechanically checked four-facing shower source prototype."""
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
from shower_pose import (STEAM_NAMES, WATER_NAMES, apply, apply_wardrobe, build_steam, build_water)
from shower_contact import (body_source_signature, clothing_coverage, fixture_signature,
                            lower_clothing_diagnostic, measure, water_impact)
from check_shower_scene import validate as validate_fixture
from animation_export import render_pass

SOURCE = MODELS/'bathroom/owner-review-pending/shower/candidate-01/shower-authoring.blend'
RIG_SOURCE = MODELS/'sims/sim-01/sim-01-rigged.blend'
EXPECTED_SOURCE = 'c57a911a5e3964e4d23278e1a48150e2fcf3e940ad91183b9480db8a78e60865'
EXPECTED_RIG = '919e8994cbf7510a4d9947f173abec8b41ac77d61f6e829bcf5981c8d2fcddce'
FACINGS = {'SE':90, 'NW':270, 'SW':0, 'NE':180}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def partition(scene, root, rig):
    fixtures, bodies = set(root.children_recursive), set(rig.children_recursive)
    body = bpy.data.collections.new('Shower action body')
    furniture = bpy.data.collections.new('Shower action fixture and coverage')
    scene.collection.children.link(body)
    scene.collection.children.link(furniture)
    for obj in list(bpy.data.objects):
        if obj.type not in ('MESH', 'CURVE'):
            continue
        target = furniture if obj in fixtures else body if obj in bodies else None
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


def canvas_bounds(scene, collections):
    deps = bpy.context.evaluated_depsgraph_get()
    projected = []
    for collection in collections:
        for obj in collection.all_objects:
            if obj.hide_render:
                continue
            evaluated = obj.evaluated_get(deps)
            data = evaluated.to_mesh()
            try:
                projected += [world_to_camera_view(scene, scene.camera,
                    evaluated.matrix_world@vertex.co) for vertex in data.vertices]
            finally:
                evaluated.to_mesh_clear()
    low = [min(p[i] for p in projected) for i in range(2)]
    high = [max(p[i] for p in projected) for i in range(2)]
    margin = min(low[0]*scene.render.resolution_x, low[1]*scene.render.resolution_y,
                 (1-high[0])*scene.render.resolution_x, (1-high[1])*scene.render.resolution_y)
    if margin < 8:
        raise ValueError(f'Geometry lacks full-canvas stroke margin: {margin}')
    return dict(normalized_bounds=[low, high], min_source_pixel_margin=margin)


def negative_controls(root, rig, body, baseline, ankle_z, source_body):
    results = []
    for name, expected in (('hidden-required-panel', 'Required shower or coverage'),
                           ('shifted-nozzle', 'Immutable fixture'),
                           ('raised-feet', 'Complete shoes lost'),
                           ('steam-as-support', 'Steam and water must remain'),
                           ('missing-upper-arm', 'Explicit 41-object'),
                           ('unapproved-garment-visible', 'Explicit 41-object')):
        obj = bpy.data.objects['Shower rear panel']
        nozzle = bpy.data.objects['Shower nozzle face']
        nozzle_location = nozzle.location.copy()
        steam = bpy.data.objects[sorted(STEAM_NAMES)[0]]
        sleeve = bpy.data.objects['Relaxed shirt sleeve']
        collar = bpy.data.objects['Collar stand']
        try:
            if name == 'hidden-required-panel':
                obj.hide_render = True
            elif name == 'shifted-nozzle':
                nozzle.location.x += .1
            elif name == 'raised-feet':
                apply(rig, ankle_z=ankle_z+.03)
            elif name == 'steam-as-support':
                steam['structural_support'] = True
            elif name == 'missing-upper-arm':
                sleeve.hide_render = True
            else:
                collar.hide_render = False
            try:
                measure(root, rig, body, baseline, source_body=source_body)
            except ValueError as failure:
                if expected not in str(failure):
                    raise ValueError(f'Unrelated control failure: {failure}') from failure
                results.append(dict(control=name, caught=str(failure)))
            else:
                raise ValueError(f'Negative control survived: {name}')
        finally:
            obj.hide_render = False
            if name == 'shifted-nozzle':
                nozzle.location = nozzle_location
            steam['structural_support'] = False
            sleeve.hide_render = False
            collar.hide_render = True
            apply(rig, ankle_z=ankle_z)
    measure(root, rig, body, baseline, source_body=source_body)
    return results


def run(output, render=True, diagnostic=False):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use hidden background Blender and a new absolute directory')
    output.mkdir(parents=True, exist_ok=False)
    scripts = {Path(module.__file__).resolve() for module in sys.modules.values()
               if getattr(module, '__file__', None) and str(module.__file__).endswith('.py')
               and Path(module.__file__).resolve().is_relative_to(MODELS.resolve())}
    scripts.update((SOURCE, RIG_SOURCE, MODELS/'sims/sim-01/registered-canvas-proof.json',
                    SOURCE.parent/'proof.json', MODELS/'bathroom/shower_model.py',
                    MODELS/'bathroom/shower_geometry.py'))
    prior_appearance = BASE/'review/shower/prototype-03/proof.json'
    if output.name != 'prototype-03':
        scripts.add(prior_appearance)
    inputs = {path.relative_to(MODELS).as_posix():digest(path) for path in sorted(scripts)}
    for path in sorted(scripts):
        if path.suffix == '.py':
            snapshot = output/'source'/path.relative_to(MODELS)
            snapshot.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, snapshot)
    proof = dict(state='running', mode='complete-measure-only-coverage-diagnostic' if diagnostic
                 else 'green-four-facing-source-prototype', inputs=inputs,
                 blender_version=bpy.app.version_string, renders=[],
                 residual_limits=['One quiet phase only; no full loop or palette matrix.',
                    'Steam is opaque modeled coverage, not fluid simulation or structural support.',
                    'One bounded nozzle-to-shoulder jet is measured; no fluid simulation or control contact is claimed.',
                    'The shower-specific PG appearance reuses existing body meshes and skin material, not new anatomy.',
                    'Source mechanics do not certify visual acceptance or runtime picking.'])
    journal = output/'proof.json'
    def save():
        journal.write_text(json.dumps(proof, indent=2, allow_nan=False)+'\n')
    save()
    try:
        if digest(SOURCE) != EXPECTED_SOURCE or digest(RIG_SOURCE) != EXPECTED_RIG:
            raise ValueError('Immutable source hashes do not match')
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
        scene = bpy.context.scene
        if scene.camera.data.type != 'ORTHO':
            raise ValueError('Accepted shower camera must remain orthographic')
        root, rig = bpy.data.objects['SHOWER_MODEL_ROOT'], bpy.data.objects['SIM_01_SHARED_RIG']
        root.rotation_euler.z = 0
        rig.rotation_euler.z = 0
        rig.animation_data.action = None
        scene.frame_set(1)
        proof['fixture_validation'] = validate_fixture()
        baseline = fixture_signature(root)
        body, furniture = partition(scene, root, rig)
        source_body = body_source_signature(body)
        proof['original_body_source_signature'] = source_body
        proof['wardrobe'] = apply_wardrobe(body)
        if [scene.render.resolution_x, scene.render.resolution_y] != [768, 960]:
            raise ValueError('Accepted source dimensions changed')
        scene.render.resolution_percentage = 100
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 2
        scene.render.film_transparent = True
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        origin = world_to_camera_view(scene, scene.camera, Vector((0, 0, 0)))
        proof.update(original_render_dimensions=[768, 960], origin_pixels=[origin.x*768, (1-origin.y)*960],
                     camera_matrix=[list(row) for row in scene.camera.matrix_world],
                     ortho_scale=scene.camera.data.ortho_scale,
                     colour_management=dict(view=scene.view_settings.view_transform, look=scene.view_settings.look))
        apply(rig)
        build_steam(root)
        proof['initial_water_impact'] = water_impact(root, body)
        build_water(root, proof['initial_water_impact'])
        for obj in root.children_recursive:
            if obj.name in STEAM_NAMES | WATER_NAMES:
                for collection in list(obj.users_collection):
                    collection.objects.unlink(obj)
                furniture.objects.link(obj)
        initial = measure(root, rig, body, baseline, require=False, source_body=source_body)
        proof['initial_fit'] = initial
        save()
        ankle_z = .185+.019148-initial['soles']['Fitted rounded shoe sole']['min_floor_gap']
        proof['fitted_ankle_z'] = ankle_z
        apply(rig, ankle_z=ankle_z)
        proof['fitted_diagnostics'] = measure(root, rig, body, baseline, require=False, source_body=source_body)
        if output.name != 'prototype-03':
            reference = json.loads(prior_appearance.read_text())
            previous = reference['fitted_diagnostics']['joint_targets']
            current = proof['fitted_diagnostics']['joint_targets']
            if set(previous) != set(current) or any(abs(a-b) > 1e-7
                    for name in previous for field in ('head', 'tail')
                    for a, b in zip(previous[name][field], current[name][field])):
                raise ValueError('Coverage-only revision changed the prototype 03 pose')
            if proof['initial_water_impact'] != reference['initial_water_impact']:
                raise ValueError('Coverage-only revision changed the measured jet attachment or impact')
            if proof['wardrobe'] != reference['wardrobe'] or source_body != reference['original_body_source_signature']:
                raise ValueError('Coverage-only revision changed wardrobe or immutable body geometry')
            proof['prototype_03_pose_wardrobe_jet_byte_equivalent'] = True
        save()
        proof['contact'] = measure(root, rig, body, baseline, source_body=source_body)
        proof['complete_lower_clothing_diagnostic'] = lower_clothing_diagnostic(root, body)
        proof['negative_controls'] = negative_controls(root, rig, body, baseline, ankle_z, source_body)
        proof['four_facing_canvas'] = {}
        proof['four_facing_clothing_coverage'] = {}
        for facing, degrees in FACINGS.items():
            root.rotation_euler.z = math.radians(degrees)
            rig.rotation_euler.z = math.radians(degrees)
            bpy.context.view_layer.update()
            proof['four_facing_canvas'][facing] = canvas_bounds(scene, (body, furniture))
            coverage = clothing_coverage(scene, root, body)
            proof['four_facing_clothing_coverage'][facing] = coverage
            save()
        failures = {facing:sum(r['exposed_vertices'] for r in result['lower_clothing'].values())
                    for facing, result in proof['four_facing_clothing_coverage'].items()
                    if result['state'] != 'passed'}
        if failures:
            raise ValueError(f'Trousers or shoes lack opaque coverage after all four facings: {failures}')
        if diagnostic:
            proof['immutable_sources_byte_identical'] = all(digest(MODELS/name) == expected
                                                           for name, expected in inputs.items())
            if not proof['immutable_sources_byte_identical']:
                raise ValueError('Diagnostic changed an immutable input')
            proof['state'] = 'complete'
            save()
            return
        root.rotation_euler.z = 0
        rig.rotation_euler.z = 0
        bpy.context.view_layer.update()
        bpy.context.preferences.filepaths.save_version = 0
        model = output/'shower-pose-authoring.blend'
        bpy.ops.wm.save_as_mainfile(filepath=str(model))
        proof['editable_model'] = dict(path=model.name, sha256=digest(model))
        bpy.ops.wm.open_mainfile(filepath=str(model))
        scene = bpy.context.scene
        root, rig = bpy.data.objects['SHOWER_MODEL_ROOT'], bpy.data.objects['SIM_01_SHARED_RIG']
        body = bpy.data.collections['Shower action body']
        furniture = bpy.data.collections['Shower action fixture and coverage']
        proof['saved_scene_contact'] = measure(root, rig, body, baseline, source_body=source_body)
        proof['saved_scene_fixture'] = validate_fixture()
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
        if not all(digest(MODELS/name) == expected for name, expected in inputs.items()):
            raise ValueError('Immutable input changed')
        proof['immutable_sources_byte_identical'] = True
        proof['state'] = 'complete'
        save()
    except BaseException:
        proof['state'] = 'failed'
        proof['error'] = traceback.format_exc()
        proof['immutable_sources_byte_identical'] = all(digest(MODELS/name) == expected for name, expected in inputs.items())
        save()
        raise


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    run(Path(args[0]), '--measure-only' not in args, '--coverage-diagnostic' in args)
