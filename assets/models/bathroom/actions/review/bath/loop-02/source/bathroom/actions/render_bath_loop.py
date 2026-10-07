"""Bake and check the closed bathing loop, then render its complete raw source matrix.

The accepted wall-backed source is the saved model of the reviewed prototype. Every sample
re-measures seat and wall support and complete clearance on the full 54-object body (the
thirteen hidden garment details are shown for measurement and hidden again for rendering),
then the loop is baked, saved, reopened and rendered in four facings, four frames and four
owners for the single bathing appearance, plus the body-owned ink pass.
"""
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import sys
import traceback

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

BASE = Path(__file__).resolve().parent
MODELS = BASE.parents[1]
sys.path[:0] = [str(BASE), str(BASE.parent), str(MODELS/'furniture'), str(MODELS/'sims/sim-01'), str(MODELS/'living')]
from bath_loop_v1 import ACTION_NAME, FACINGS, OWNERS, apply_phase, bake, capture_baseline
from bath_wall_backed import WATER_NAME, measure_wall_pose
from check_bathtub_scene import validate as validate_fixture
from render_toilet_use_v2 import canvas_margin
from animation_export import render_pass
from armchair_contact import body_inventory
from shower_pose_geometry import OMITTED_GARMENT_DETAILS

ACCEPTED = BASE/'review/bath/prototype-12-wall-backed-water'
SOURCE_PROOF = ACCEPTED/'proof.json'
SOURCE_MODEL = ACCEPTED/'bath-pose-authoring.blend'
CANVAS = (1280, 1408)
LOGICAL_CANVAS = [160, 176]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False)+'\n')


def geometry(collection, include_hidden=False):
    """Evaluated geometry digests; `include_hidden` adds the hidden garment details but never the book prop."""
    deps = bpy.context.evaluated_depsgraph_get()
    result = {}
    for obj in collection.all_objects:
        if obj.hide_render and not (include_hidden and obj.name in body_inventory()):
            continue
        if obj.type not in ('MESH', 'CURVE'):
            raise ValueError('Unhandled visible source geometry owner')
        evaluated = obj.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            points = [tuple(evaluated.matrix_world@v.co) for v in mesh.vertices]
            polygons = [tuple(p.vertices) for p in mesh.polygons]
            result[obj.name] = hashlib.sha256(repr((points, polygons)).encode()).hexdigest()
        finally:
            evaluated.to_mesh_clear()
    return result


def targets(rig):
    return {b.name:dict(head=list(b.head), tail=list(b.tail)) for b in rig.pose.bones}


def registration(scene, reference):
    if scene.camera.data.type != 'ORTHO' or [scene.render.resolution_x, scene.render.resolution_y] != list(CANVAS):
        raise ValueError('Accepted source camera/canvas changed')
    origin = world_to_camera_view(scene, scene.camera, Vector((0, 0, 0)))
    values = dict(original_render_dimensions=list(CANVAS), origin_pixels=[origin.x*CANVAS[0], (1-origin.y)*CANVAS[1]],
                  camera_matrix=[list(row) for row in scene.camera.matrix_world], ortho_scale=scene.camera.data.ortho_scale)
    if values['camera_matrix'] != reference['camera_matrix'] or values['ortho_scale'] != reference['ortho_scale'] or any(
            abs(a-b) > 1e-5 for a, b in zip(values['origin_pixels'], reference['origin_pixels'])):
        raise ValueError('Accepted camera or world-origin registration drifted')
    return values


def raster_record(path):
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Source output is not PNG')
    width, height = struct.unpack('>II', data[16:24])
    if (width, height) != CANVAS or data[24] != 8 or data[25] != 6:
        raise ValueError('Original source PNG size/8-bit RGBA mode changed')
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        if tuple(image.size) != (width, height) or image.channels != 4:
            raise ValueError('Decoded source image has wrong dimensions/channels')
        indices = {4*(y*width+x)+3 for y in (0, height-1) for x in range(width)}
        indices |= {4*(y*width+x)+3 for x in (0, width-1) for y in range(height)}
        alpha = max(image.pixels[i] for i in indices)
        if alpha != 0:
            raise ValueError('Original source output touches its transparent border')
    finally:
        bpy.data.images.remove(image)
    return dict(width=width, height=height, mode='RGBA', bit_depth=8, border_alpha_max=alpha)


def with_full_body(body, action):
    """Run `action` with the thirteen hidden garment details shown, then hide them again."""
    hidden = [obj for obj in body.all_objects if obj.hide_render and obj.name in body_inventory()]
    if {obj.name for obj in hidden} != OMITTED_GARMENT_DETAILS:
        raise ValueError('Bathing appearance hides a different detail set than the declared thirteen')
    for obj in hidden:
        obj.hide_render = False
    bpy.context.view_layer.update()
    try:
        return action()
    finally:
        for obj in hidden:
            obj.hide_render = True
        bpy.context.view_layer.update()


def physical(root, rig, body, plane):
    measurement = with_full_body(body, lambda: measure_wall_pose(root, rig, body, plane))
    if measurement['support_state'] != 'passed':
        raise ValueError('Loop sample lost seat or wall support or gained a collision')
    return dict(measurement=measurement, support_state=measurement['support_state'])


def render_bath_ink(scene, body, fixture, path):
    """Body-owned ink with the fixture and water still occluding."""
    visible = {obj.name for obj in body.all_objects if not obj.hide_render}
    if visible | OMITTED_GARMENT_DETAILS != body_inventory() or len(visible) != 41:
        raise ValueError('Body ink changed the declared 41-object bathing owner inventory')
    layer = bpy.context.view_layer
    for collection in (body, fixture):
        layer.layer_collection.children[collection.name].holdout = False
    for lines in layer.freestyle_settings.linesets:
        lines.select_by_collection = True
        lines.collection = body
        lines.collection_negation = 'INCLUSIVE'
    scene.render.use_freestyle = True
    layer.freestyle_settings.as_render_pass = True
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    source = tree.nodes.new('CompositorNodeRLayers')
    target = tree.nodes.new('CompositorNodeComposite')
    tree.links.new(source.outputs['Freestyle'], target.inputs['Image'])
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return dict(body_owned_stroke_inventory=sorted(visible), full_scene_occlusion=True,
                fixture_geometry_hidden=False, body_and_fixture_holdout=False)


def configure_source(scene):
    scene.render.resolution_percentage = 100
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 2
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    bpy.context.preferences.filepaths.save_version = 0


def run(output, ink_output):
    if not bpy.app.background or not output.is_absolute() or not ink_output.is_absolute():
        raise ValueError('Use hidden background Blender and two new absolute owned directories')
    output.mkdir(parents=True, exist_ok=False)
    ink_output.mkdir(parents=True, exist_ok=False)
    reference = json.loads(SOURCE_PROOF.read_text())
    if reference['state'] != 'complete' or digest(SOURCE_MODEL) != reference['editable_model']['sha256']:
        raise ValueError('Accepted source receipt/model is incomplete or changed')
    inputs = dict(reference['inputs'])
    paths = {Path(module.__file__).resolve() for module in sys.modules.values()
             if getattr(module, '__file__', None) and str(module.__file__).endswith('.py')
             and Path(module.__file__).resolve().is_relative_to(MODELS.resolve())}
    paths.update((SOURCE_PROOF, SOURCE_MODEL, BASE/'bath_loop_v1.py', BASE/'test_bath_loop.py'))
    for name, expected in inputs.items():
        if digest(MODELS/name) != expected:
            raise ValueError('Accepted pinned producer/input changed: '+name)
    inputs.update({p.relative_to(MODELS).as_posix():digest(p) for p in paths})
    for name in inputs:
        path = MODELS/name
        if path.suffix == '.py':
            snapshot = output/'source'/name
            snapshot.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, snapshot)
    proof = dict(schema=1, state='running', inputs=inputs, blender_version=bpy.app.version_string,
                 blender_build_hash=bpy.app.build_hash.decode(),
                 action=dict(name=ACTION_NAME, samples=4, closure_frame=4, half_cycle_ticks=8, loop_ticks=16, sample_fps=2.5),
                 accepted_source=dict(proof_path=SOURCE_PROOF.relative_to(MODELS).as_posix(), proof_sha256=digest(SOURCE_PROOF),
                                      model_path=SOURCE_MODEL.relative_to(MODELS).as_posix(), model_sha256=digest(SOURCE_MODEL)),
                 logical_canvas=LOGICAL_CANVAS, source_density=8, palette_independent=True,
                 bathing_appearance=reference['wardrobe'], water=reference['water'], plane=reference['plane'],
                 contacts=[], reopened_contacts=[], manual_contacts=[], renders=[], raster_checks=[],
                 geometry_checks=[], source_export_acceptance=False,
                 body_ink=dict(directory='../'+ink_output.name, proof='proof.json', expected_frames=16))
    ink = dict(schema=1, state='running', inputs=inputs, renders=[], raster_checks=[], stroke_ownership=[],
               producer_sha256=digest(Path(__file__).resolve()))
    journal, ink_journal = output/'proof.json', ink_output/'proof.json'
    def save():
        save_json(journal, proof)
        save_json(ink_journal, ink)
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE_MODEL))
        scene = bpy.context.scene
        rig, root = bpy.data.objects['SIM_01_SHARED_RIG'], bpy.data.objects['BATHTUB_MODEL_ROOT']
        rig.animation_data.action = None
        root.rotation_euler.z = rig.rotation_euler.z = 0
        scene.frame_set(1)
        body, fixture = bpy.data.collections['Bath diagnostic body'], bpy.data.collections['Bath diagnostic fixture']
        if WATER_NAME not in fixture.objects:
            raise ValueError('Accepted model lost its opaque water surface')
        configure_source(scene)
        proof.update(registration(scene, reference))
        proof['fixture_validation'] = validate_fixture()
        plane = reference['plane']
        baseline = capture_baseline(rig)
        accepted_geometry = geometry(body, include_hidden=True)
        static_fixture = geometry(fixture)
        original_targets = targets(rig)
        if any(abs(a-b) > 1e-7 for name in original_targets for field in ('head', 'tail')
               for a, b in zip(original_targets[name][field], reference['measurement']['joint_targets'][name][field])):
            raise ValueError('Saved model pose differs from the accepted prototype joint targets')
        for frame in range(5):
            motion = apply_phase(rig, baseline, frame/4)
            contact = physical(root, rig, body, plane)
            current = geometry(body, include_hidden=True)
            proof['manual_contacts'].append(dict(frame=frame, phase=frame/4, motion=motion, **contact))
            if frame in (0, 4) and (current != accepted_geometry or targets(rig) != original_targets):
                raise ValueError('Exact phase0/endpoint baseline geometry or targets changed')
            if geometry(fixture) != static_fixture:
                raise ValueError('Loop moved immutable fixture or water geometry')
            save()
        proof['closure'] = dict(manual_exact_phase0=True, manual_exact_endpoint=True,
                                complete_body_inventory=sorted(accepted_geometry), all54_evaluated=True,
                                limb_movement=False, head_nod_only=True)
        action = bake(rig, baseline)
        scene.frame_set(1)
        bpy.context.view_layer.update()
        if geometry(body, include_hidden=True) != accepted_geometry or targets(rig) != original_targets:
            raise ValueError('Baked first sample is not the exact accepted baseline')
        model = output/'bath-loop-authoring.blend'
        bpy.ops.wm.save_as_mainfile(filepath=str(model))
        proof['editable_model'] = dict(path=model.name, sha256=digest(model))
        bpy.ops.wm.open_mainfile(filepath=str(model))
        scene = bpy.context.scene
        rig, root = bpy.data.objects['SIM_01_SHARED_RIG'], bpy.data.objects['BATHTUB_MODEL_ROOT']
        body, fixture = bpy.data.collections['Bath diagnostic body'], bpy.data.collections['Bath diagnostic fixture']
        if rig.animation_data.action.name != ACTION_NAME:
            raise ValueError('Saved loop action is missing or changed')
        proof['saved_fixture_validation'] = validate_fixture()
        proof.update(registration(scene, reference))
        for frame in range(5):
            scene.frame_set(frame+1)
            bpy.context.view_layer.update()
            contact = physical(root, rig, body, plane)
            proof['contacts'].append(dict(frame=frame, phase=frame/4, **contact))
            proof['reopened_contacts'].append(dict(frame=frame, phase=frame/4, **contact))
            if frame in (0, 4) and (geometry(body, include_hidden=True) != accepted_geometry or targets(rig) != original_targets):
                raise ValueError('Saved closure changed accepted complete-body geometry/targets')
            save()
        proof['closure'].update(saved_exact_phase0=True, saved_exact_endpoint=True, named_bones=original_targets)
        proof['rendered_body_inventory'] = sorted(o.name for o in body.all_objects if not o.hide_render)
        if set(proof['rendered_body_inventory']) | OMITTED_GARMENT_DETAILS != body_inventory() or len(proof['rendered_body_inventory']) != 41:
            raise ValueError('Rendered bathing inventory is not the declared 41 objects')
        for facing, degrees in FACINGS.items():
            root.rotation_euler.z = rig.rotation_euler.z = math.radians(degrees)
            for frame in range(4):
                scene.frame_set(frame+1)
                bpy.context.view_layer.update()
                margin = canvas_margin(scene, (body, fixture))
                proof['geometry_checks'].append(dict(facing=facing, frame=frame, minimum_canvas_margin=margin,
                                                     body=geometry(body), fixture=geometry(fixture)))
                for owner in OWNERS:
                    path = output/f'{facing}-green-{frame}-{owner}.png'
                    render_pass(scene, body, fixture, owner, path, separate_lines=True)
                    proof['renders'].append(dict(facing=facing, variant='green', frame=frame, owner=owner,
                                                 path=path.name, sha256=digest(path)))
                    proof['raster_checks'].append(dict(path=path.name, **raster_record(path)))
                    save()
                path = ink_output/f'{facing}-green-{frame}-body_ink.png'
                ink['stroke_ownership'].append(dict(facing=facing, frame=frame, **render_bath_ink(scene, body, fixture, path)))
                ink['renders'].append(dict(facing=facing, variant='green', frame=frame, owner='body_ink',
                                           path=path.name, sha256=digest(path)))
                ink['raster_checks'].append(dict(path=path.name, **raster_record(path)))
                save()
        if len(proof['renders']) != 64 or len(ink['renders']) != 16 or len(proof['contacts']) != 5:
            raise ValueError('Complete loop/facing/owner/closure source matrix is missing')
        proof['immutable_inputs_preserved'] = all(digest(MODELS/name) == sha for name, sha in inputs.items())
        if not proof['immutable_inputs_preserved'] or digest(model) != proof['editable_model']['sha256']:
            raise ValueError('Loop generation changed a pinned input or saved model')
        proof['state'] = 'complete'
        save_json(journal, proof)
        ink.update(state='complete', source_proof_sha256=digest(journal), source_model_sha256=digest(model),
                   original_render_dimensions=proof['original_render_dimensions'], origin_pixels=proof['origin_pixels'],
                   camera_matrix=proof['camera_matrix'], ortho_scale=proof['ortho_scale'], immutable_inputs_preserved=True)
        save_json(ink_journal, ink)
    except BaseException:
        proof.update(state='failed', error=traceback.format_exc())
        ink.update(state='failed', error=proof['error'])
        save()
        raise


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    run(Path(args[0]), Path(args[1]))
