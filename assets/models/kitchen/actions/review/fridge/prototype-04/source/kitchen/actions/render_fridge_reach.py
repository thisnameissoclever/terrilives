"""Measure, prototype or batch-render the fridge open-and-reach samples.

Run only in hidden background Blender:

    blender --background --threads 2 --python-exit-code 1 --python render_fridge_reach.py -- MODE OUTPUT [INK_OUTPUT]

MODE is `measure` (pose and measure all samples, no renders), `prototype`
(green beauty renders of the key samples in four facings) or `batch` (every
facing, shirt palette, sample and owner, plus body ink into INK_OUTPUT). The
proof journal written into OUTPUT is the only completion signal.
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
sys.path[:0] = [str(BASE), str(MODELS/'furniture'), str(MODELS/'sims/sim-01'), str(MODELS/'living'),
                str(MODELS/'bathroom/actions')]
import fridge_reach_geometry as geo
import fridge_reach_pose as fp
from animation_export import render_pass
from armchair_contact import body_inventory
from render_shirt_variants import SHIRT_COLORS, material_snapshot, set_shirt_colors, topology_sha256
from render_toilet_ink import render_body_ink

SOURCE = MODELS/'kitchen/owner-review-pending/refrigerator/candidate-03/refrigerator-authoring.blend'
SOURCE_PROOF = SOURCE.parent/'proof.json'
EXPECTED_SOURCE = '4bed8dfb3fb968725c99c8345ac5e17a4c75b45b5e487d867655ed17163a7b82'
RIG_SOURCE = MODELS/'sims/sim-01/sim-01-rigged.blend'
EXPECTED_RIG = '919e8994cbf7510a4d9947f173abec8b41ac77d61f6e829bcf5981c8d2fcddce'
FACINGS = {'SE': 90, 'NW': 270, 'SW': 0, 'NE': 180}
VARIANTS = ('green', 'blue', 'red')
OWNERS = ('beauty', 'sim', 'furniture', 'lines')
PROTOTYPE_SAMPLES = tuple(range(8))
ORIGINAL = (768, 960)
DENSITY = 8


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False)+'\n')


def configure_canvas(scene, padding):
    """Grow the accepted 96x120 canvas by whole logical pixels without moving the fixture.

    Padding is (left, top, right, bottom) logical pixels. The orthographic scale
    keeps the accepted pixels per metre and the camera shift keeps the original
    canvas at (left, top) inside the larger one, so the world origin lands
    exactly `padding` further from the corner and the static sprite's pixels are
    unchanged."""
    left, top, right, bottom = padding
    camera = scene.camera.data
    if camera.type != 'ORTHO' or camera.sensor_fit != 'AUTO' or [scene.render.resolution_x, scene.render.resolution_y] != list(ORIGINAL):
        raise ValueError('Accepted refrigerator camera or canvas changed')
    width, height = (96+left+right)*DENSITY, (120+top+bottom)*DENSITY
    per_metre = max(ORIGINAL)/camera.ortho_scale
    largest = max(width, height)
    camera.ortho_scale = largest/per_metre
    camera.shift_x = 4*(right-left)/largest
    camera.shift_y = -4*(bottom-top)/largest
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.resolution_percentage = 100
    bpy.context.view_layer.update()
    return [width, height]


def registration(scene):
    width, height = scene.render.resolution_x, scene.render.resolution_y
    origin = world_to_camera_view(scene, scene.camera, Vector((0, 0, 0)))
    return dict(render_dimensions=[width, height], origin_pixels=[origin.x*width, (1-origin.y)*height],
                camera_matrix=[list(row) for row in scene.camera.matrix_world],
                ortho_scale=scene.camera.data.ortho_scale,
                camera_shift=[scene.camera.data.shift_x, scene.camera.data.shift_y])


def projected_bounds(scene, collections):
    width, height = scene.render.resolution_x, scene.render.resolution_y
    deps = bpy.context.evaluated_depsgraph_get()
    xs, ys = [], []
    for collection in collections:
        for obj in collection.all_objects:
            if obj.hide_render or obj.type not in ('MESH', 'CURVE'):
                continue
            evaluated = obj.evaluated_get(deps)
            mesh = evaluated.to_mesh()
            try:
                for v in mesh.vertices:
                    p = world_to_camera_view(scene, scene.camera, evaluated.matrix_world@v.co)
                    xs.append(p.x*width)
                    ys.append((1-p.y)*height)
            finally:
                evaluated.to_mesh_clear()
    return [min(xs), min(ys), max(xs), max(ys)]


def geometry(collection):
    deps = bpy.context.evaluated_depsgraph_get()
    result, points = {}, {}
    for obj in collection.all_objects:
        if obj.hide_render:
            continue
        if obj.type not in ('MESH', 'CURVE'):
            raise ValueError('Unhandled visible source geometry owner')
        evaluated = obj.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            world = [tuple(evaluated.matrix_world@v.co) for v in mesh.vertices]
            polygons = [tuple(p.vertices) for p in mesh.polygons]
            result[obj.name] = hashlib.sha256(repr((world, polygons)).encode()).hexdigest()
            points[obj.name] = world
        finally:
            evaluated.to_mesh_clear()
    return result, points


def door_motion(closed, current, degrees, facing_degrees):
    """Largest distance of each door vertex from its closed position turned about the hinge."""
    turn = math.radians(facing_degrees)
    hx, hy = geo.HINGE
    hinge = (math.cos(turn)*hx - math.sin(turn)*hy, math.sin(turn)*hx + math.cos(turn)*hy)
    angle = math.radians(degrees)
    c, s = math.cos(angle), math.sin(angle)
    worst = 0.
    for (x, y, z), (u, v, w) in zip(closed, current):
        dx, dy = x-hinge[0], y-hinge[1]
        expected = (hinge[0]+c*dx-s*dy, hinge[1]+s*dx+c*dy, z)
        worst = max(worst, math.dist(expected, (u, v, w)))
    if len(closed) != len(current):
        raise ValueError('Door topology changed between samples')
    return worst


def raster_record(path, size):
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Source output is not PNG')
    width, height = struct.unpack('>II', data[16:24])
    if [width, height] != list(size) or data[24] != 8 or data[25] != 6:
        raise ValueError('Source PNG size or 8-bit RGBA mode changed')
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        pixels = image.pixels[:]
        alpha = max(max(pixels[4*(y*width+x)+3] for x in range(width)) for y in (0, height-1))
        alpha = max(alpha, max(max(pixels[4*(y*width+x)+3] for y in range(height)) for x in (0, width-1)))
        if alpha != 0:
            raise ValueError('Source output touches its transparent border')
    finally:
        bpy.data.images.remove(image)
    return dict(width=width, height=height, mode='RGBA', bit_depth=8, border_alpha_max=alpha)


def restore_green(materials):
    for name in SHIRT_COLORS['blue']:
        node = next(n for n in bpy.data.materials[name].node_tree.nodes if n.type == 'VALTORGB')
        for stop, source in zip(node.color_ramp.elements, materials[name][node.name+'/ramp']):
            stop.color = source['color']


def palette(name, materials):
    """Apply a shirt palette through the frozen setter and record exactly what changed."""
    if name == 'green':
        restore_green(materials)
    else:
        set_shirt_colors(SHIRT_COLORS[name], materials)
    after = material_snapshot()
    changes = []
    for material, values in materials.items():
        for field, old in values.items():
            new = after[material][field]
            if new != old:
                if material not in SHIRT_COLORS['blue'] or not field.endswith('/ramp'):
                    raise ValueError('Palette changed non-shirt or non-ramp source material state')
                changes.append(dict(material=material, field=field, before=old, after=new))
    if (name == 'green' and changes) or (name != 'green' and len(changes) != 3):
        raise ValueError('Palette did not use the exact three existing shirt ramps')
    return changes


def isolated_pass(scene, body, fixture, hidden, path):
    """Fixture-only furniture render with the named fixture parts hidden and no body.

    Object lists are captured before any visibility change: iterating a
    collection while the view layer re-evaluates crashed Blender 4.5 when
    this pass excluded the body's layer collection instead."""
    objects = list(body.all_objects) + list(fixture.all_objects)
    saved = [(obj, obj.hide_render) for obj in objects]
    body_names = {obj.name for obj in body.all_objects}
    try:
        for obj, _ in saved:
            if obj.name in body_names or obj.name in hidden:
                obj.hide_render = True
        bpy.context.view_layer.update()
        render_pass(scene, body, fixture, 'furniture', path, separate_lines=True)
    finally:
        for obj, state in saved:
            obj.hide_render = state
        bpy.context.view_layer.update()


def left_arm_owner_check(body):
    """The suffix-free arm surfaces must deform with the left arm bones."""
    result = {}
    for name in fp.LEFT_ARM:
        obj = body.all_objects[name]
        groups = {g.name for g in obj.vertex_groups}
        result[name] = sorted(groups)
        if not any(g.endswith('.L') for g in groups) or any(g.endswith('.R') for g in groups):
            raise ValueError('Left arm surface is not bound to left arm bones: '+name)
    return result


def measure_sample(index, rig, body, fixture, door_names, arms):
    plans = fp.apply_sample(rig, index, *arms[index])
    errors = fp.bone_length_errors(rig)
    if max(errors.values()) > 1e-5:
        raise ValueError('Fridge pose changed an anatomical bone length')
    record = dict(sample=index, door_degrees=geo.DOOR_DEGREES[index], left_hand=plans['L'],
                  lean_degrees=geo.LEAN_DEGREES[index], twist_degrees=geo.TWIST_DEGREES[index],
                  bone_length_errors=errors, joint_targets=fp.joint_targets(rig),
                  clearance=fp.clearance(body, fixture, door_names))
    if plans['L'] == 'reach':
        record['palm'] = fp.palm_inside_cabinet(body)
    record['stance'] = list(geo.stance(index))
    record['body_extent'] = fp.body_extent(body)
    return record


def configure_output(scene):
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 2
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    bpy.context.preferences.filepaths.save_version = 0


def collect_inputs():
    paths = {Path(module.__file__).resolve() for module in sys.modules.values()
             if getattr(module, '__file__', None) and str(module.__file__).endswith('.py')
             and Path(module.__file__).resolve().is_relative_to(MODELS.resolve())}
    paths.update((SOURCE, SOURCE_PROOF, RIG_SOURCE, MODELS/'sims/sim-01/registered-canvas-proof.json',
                  MODELS/'kitchen/fridge_model.py', MODELS/'kitchen/fridge_geometry.py'))
    return {p.relative_to(MODELS).as_posix(): digest(p) for p in sorted(paths)}


def render_batch(scene, root, pivot, rig, body, fixture, arms, door_names, proof, ink, output, ink_output, save):
    """Every facing, palette, sample and owner, the body ink, and the fixture references.

    The empty reference is the fixture alone with the door closed; the door
    references are the door assembly alone at each sample. Together they let
    the exporter prove that every pixel of the case outside the door and the
    body is the empty fixture's pixel."""
    materials = material_snapshot()
    topology = topology_sha256()
    proof['palettes'] = {variant: dict(material_changes=palette(variant, materials),
                                       setter='immutable render_shirt_variants.set_shirt_colors')
                         for variant in VARIANTS}
    restore_green(materials)
    proof['references'] = []
    proof['geometry_palette_checks'] = []
    for facing, degrees in FACINGS.items():
        fp.set_facing(root, pivot, degrees)
        fp.apply_sample(rig, 0, *arms[0])
        path = output/f'{facing}-empty-furniture.png'
        isolated_pass(scene, body, fixture, set(), path)
        proof['references'].append(dict(facing=facing, frame=None, owner='empty', path=path.name, sha256=digest(path)))
        for index in range(geo.SAMPLES):
            fp.apply_sample(rig, index, *arms[index])
            path = output/f'{facing}-{index}-door.png'
            isolated_pass(scene, body, fixture, {o.name for o in fixture.all_objects} - door_names, path)
            proof['references'].append(dict(facing=facing, frame=index, owner='door', path=path.name, sha256=digest(path)))
            baseline = None
            for variant in VARIANTS:
                palette(variant, materials)
                state = dict(body=geometry(body)[0], fixture=geometry(fixture)[0], topology=topology_sha256(),
                             visible_body=sorted(o.name for o in body.all_objects if not o.hide_render))
                if baseline is None:
                    baseline = state
                elif state != baseline:
                    raise ValueError('Palette changed geometry or visible ownership')
                proof['geometry_palette_checks'].append(dict(facing=facing, variant=variant, frame=index,
                                                             geometry=state, complete_owner_consistency=True))
                for owner in OWNERS:
                    path = output/f'{facing}-{variant}-{index}-{owner}.png'
                    render_pass(scene, body, fixture, owner, path, separate_lines=True)
                    proof['renders'].append(dict(facing=facing, variant=variant, frame=index, owner=owner,
                                                 path=path.name, sha256=digest(path)))
                save()
            restore_green(materials)
            path = ink_output/f'{facing}-green-{index}-body_ink.png'
            ink['stroke_ownership'].append(dict(facing=facing, frame=index,
                                                **render_body_ink(scene, body, fixture, path)))
            ink['renders'].append(dict(facing=facing, variant='green', frame=index, owner='body_ink',
                                       path=path.name, sha256=digest(path)))
            save()
    fp.set_facing(root, pivot, 0)
    for variant in VARIANTS:
        # Every palette was checked against the green geometry for each facing and sample above.
        proof['palettes'][variant]['geometry_consistent'] = True
    if material_snapshot() != materials or topology_sha256() != topology:
        raise ValueError('Palette rendering changed green source materials or topology')
    expected = len(FACINGS)*geo.SAMPLES
    if len(proof['renders']) != expected*len(VARIANTS)*len(OWNERS) or len(ink['renders']) != expected:
        raise ValueError('Complete facing, palette, sample and owner matrix is missing')


def run(mode, output, ink_output=None):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use hidden background Blender and a new absolute output directory')
    if mode not in ('measure', 'prototype', 'batch') or (mode == 'batch') != (ink_output is not None):
        raise ValueError('Unknown mode or missing ink directory')
    output.mkdir(parents=True, exist_ok=False)
    if ink_output is not None:
        ink_output.mkdir(parents=True, exist_ok=False)
    inputs = collect_inputs()
    for name in inputs:
        if name.endswith('.py'):
            snapshot = output/'source'/name
            snapshot.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(MODELS/name, snapshot)
    proof = dict(schema=1, state='running', mode=mode, inputs=inputs, blender_version=bpy.app.version_string,
                 blender_build_hash=bpy.app.build_hash.decode(),
                 action=dict(name='fridge_reach_v1', samples=geo.SAMPLES, door_degrees=list(geo.DOOR_DEGREES),
                             reach_samples=list(geo.REACH_SAMPLES), left_hand=list(geo.LEFT_HAND),
                             lean_degrees=list(geo.LEAN_DEGREES), twist_degrees=list(geo.TWIST_DEGREES),
                             playback='progress'),
                 stances={k: list(v) for k, v in geo.STANCES.items()}, stance_by_sample=list(geo.STANCE_BY_SAMPLE),
                 padding=list(geo.PADDING), source_density=DENSITY,
                 logical_canvas=[96+geo.PADDING[0]+geo.PADDING[2], 120+geo.PADDING[1]+geo.PADDING[3]],
                 samples=[], sweeps=[], fixture_checks=[], renders=[], raster_checks=[], margins=[])
    journal = output/'proof.json'
    ink = None
    if ink_output is not None:
        ink = dict(schema=1, state='running', inputs=inputs, renders=[], raster_checks=[], stroke_ownership=[],
                   producer_sha256=digest(MODELS/'bathroom/actions/render_toilet_ink.py'))
    def save():
        save_json(journal, proof)
        if ink is not None:
            save_json(ink_output/'proof.json', ink)
    save()
    try:
        if digest(SOURCE) != EXPECTED_SOURCE or digest(RIG_SOURCE) != EXPECTED_RIG:
            raise ValueError('Immutable source hash does not match')
        geo.validate_schedule()
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
        scene = bpy.context.scene
        proof['accepted_registration'] = registration(scene)
        root, rig, pivot, body, fixture = fp.prepare(scene)
        configure_output(scene)
        proof['canvas'] = configure_canvas(scene, geo.PADDING)
        proof.update(registration(scene))
        expected_origin = [proof['accepted_registration']['origin_pixels'][0]+DENSITY*geo.PADDING[0],
                           proof['accepted_registration']['origin_pixels'][1]+DENSITY*geo.PADDING[1]]
        if any(abs(a-b) > 1e-3 for a, b in zip(proof['origin_pixels'], expected_origin)):
            raise ValueError('Padded canvas moved the fixture origin')
        proof['left_arm_owners'] = left_arm_owner_check(body)
        door_names = set(fp.door_parts())
        proof['door_parts'] = sorted(door_names)
        if body_inventory() != {o.name for o in body.all_objects if not o.hide_render}:
            raise ValueError('Visible body differs from the approved 54-object inventory')
        arms = []
        for index in range(geo.SAMPLES):
            offset, pole, gap = fp.settle(rig, body, fixture, index)
            arms.append((offset, pole))
            proof.setdefault('hand_settle', []).append(dict(sample=index, offset=offset, pole=pole, gap=gap))
            save()
        for index in range(geo.SAMPLES):
            proof['samples'].append(measure_sample(index, rig, body, fixture, door_names, arms))
            save()
        for index in range(geo.SAMPLES-1):
            proof['sweeps'].append(fp.sweep(body, fixture, rig, index, arms))
            save()
        for facing, degrees in FACINGS.items():
            fp.set_facing(root, pivot, degrees)
            closed = None
            for index in range(geo.SAMPLES):
                fp.apply_sample(rig, index, *arms[index])
                hashes, points = geometry(fixture)
                if closed is None:
                    closed = (hashes, points)
                static = {n: h for n, h in hashes.items() if n not in door_names}
                motion = {n: door_motion(closed[1][n], points[n], geo.DOOR_DEGREES[index], degrees)
                          for n in sorted(door_names)}
                if static != {n: h for n, h in closed[0].items() if n not in door_names}:
                    raise ValueError('A non-door fixture part moved between samples')
                if max(motion.values()) > 1e-5:
                    raise ValueError('The door moved other than by its hinge angle')
                bounds = projected_bounds(scene, (body, fixture))
                width, height = proof['canvas']
                margin = min(bounds[0], bounds[1], width-bounds[2], height-bounds[3])
                proof['fixture_checks'].append(dict(facing=facing, sample=index, fixture=hashes,
                                                    static_identical=True, door_hinge_deviation=motion))
                proof['margins'].append(dict(facing=facing, sample=index, bounds=bounds, minimum_margin=margin))
                save()
        fp.set_facing(root, pivot, 0)
        if mode == 'measure':
            proof['state'] = 'complete'
            save()
            return
        if mode == 'batch':
            render_batch(scene, root, pivot, rig, body, fixture, arms, door_names, proof, ink, output, ink_output, save)
        if mode == 'prototype':
            for facing, degrees in FACINGS.items():
                fp.set_facing(root, pivot, degrees)
                for index in PROTOTYPE_SAMPLES:
                    fp.apply_sample(rig, index, *arms[index])
                    path = output/f'{facing}-green-{index}-beauty.png'
                    render_pass(scene, body, fixture, 'beauty', path, separate_lines=True)
                    proof['renders'].append(dict(facing=facing, variant='green', frame=index, owner='beauty',
                                                 path=path.name, sha256=digest(path)))
                    save()
            fp.set_facing(root, pivot, 0)
        if any(digest(MODELS/name) != sha for name, sha in inputs.items()):
            raise ValueError('An immutable input changed during the job')
        proof['immutable_inputs_preserved'] = True
        proof['state'] = 'complete'
        save()
        if ink is not None:
            ink.update(state='complete', source_proof_sha256=digest(journal), immutable_inputs_preserved=True,
                       **{key: proof[key] for key in ('render_dimensions', 'origin_pixels', 'camera_matrix', 'ortho_scale')})
            save_json(ink_output/'proof.json', ink)
    except BaseException:
        proof['state'] = 'failed'
        proof['error'] = traceback.format_exc()
        if ink is not None:
            ink.update(state='failed', error=proof['error'])
        save()
        raise


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    run(args[0], Path(args[1]), Path(args[2]) if len(args) > 2 else None)
