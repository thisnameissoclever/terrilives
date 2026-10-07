"""Render one actual fetch source pose with registered joint owner contributions."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import traceback

import bpy
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / 'assets/models/sims/sim-01'))
from render_shirt_variants import material_snapshot, set_shirt_colors, SHIRT_COLORS


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(manifest_path, output):
    manifest = json.loads(manifest_path.read_text())
    inputs = dict(manifest['inputs'])
    inputs[str(manifest_path)] = digest(manifest_path)
    if output.exists() or any(digest(p) != h for p, h in inputs.items()):
        raise ValueError('Require a new render and unchanged actual source inputs')
    output.mkdir()
    began = time.monotonic()
    report = dict(state='running', pid=os.getpid(), inputs=inputs, acceptance=False, renders=[])

    def save():
        report['elapsed_seconds'] = time.monotonic() - began
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n')

    save()
    try:
        plan = json.loads(Path(manifest['plan']).read_text())
        definition = plan['slots'][manifest['slot']]
        stationary_contact = manifest.get('stationary_contact', False)
        source_pose = 0 if stationary_contact else manifest['phase']
        phase = definition['phases'][source_pose]
        camera = json.loads(Path(manifest['camera_fixture']).read_text())
        bpy.ops.wm.open_mainfile(filepath=manifest['seed_scene'])
        rig = bpy.data.objects[manifest['rig']]
        body = bpy.data.collections[manifest['body_collection']]
        furniture = bpy.data.collections['Witness furniture']
        rig.animation_data.action = None
        rig.matrix_world = Matrix(phase['world'])
        for name, matrix in phase['frames'].items():
            rig.pose.bones[name].matrix = Matrix(matrix)
            bpy.context.view_layer.update()
        canonical = phase.get('canonical_carry', False)
        moving = bpy.data.objects[definition['source_book']]
        if canonical:
            for obj in bpy.data.objects:
                if obj.name in phase['canonical_visibility']:
                    obj.hide_render = not phase['canonical_visibility'][obj.name]['render']
            rig['book_visible'] = 1.
            moving.hide_render = True
        else:
            rig['book_visible'] = 0.
            for obj in bpy.data.objects:
                if obj.get('probe_source_name', obj.name).startswith(('Reading book', 'Printed book')):
                    obj.hide_render = True
            moving.matrix_world = Matrix.Translation(phase['book_translation']) @ moving.matrix_world
            if not stationary_contact:
                for collection in list(moving.users_collection):
                    collection.objects.unlink(moving)
                body.objects.link(moving)
        rotation = Matrix.Rotation(manifest['facing_radians'], 4, 'Z')
        rig.matrix_world = rotation @ rig.matrix_world
        for obj in list(furniture.all_objects):
            if obj.type in ('MESH', 'CURVE'):
                obj.matrix_world = rotation @ obj.matrix_world
        if not canonical and not stationary_contact:
            moving.matrix_world = rotation @ moving.matrix_world
        stocks = [obj for obj in furniture.all_objects if obj.name.startswith('Book ') and (stationary_contact or obj != moving)]
        scene = bpy.context.scene
        scene.camera.matrix_world = Matrix(camera['camera_matrix'])
        scene.camera.data.ortho_scale = camera['ortho_scale']
        density = manifest.get('density', 8)
        original_canvas = camera['logical_canvas']
        canvas = manifest.get('canvas', original_canvas)
        pixel_offset = manifest.get('pixel_offset', [0, 0])
        scene.render.resolution_x, scene.render.resolution_y = [v * density for v in original_canvas]
        scene.render.resolution_percentage = 100
        def projected(point, dimensions):
            value = world_to_camera_view(scene, scene.camera, Vector(point))
            return Vector((value.x * dimensions[0], (1 - value.y) * dimensions[1]))
        witness_points = [(0., 0., 0.), (1., 0., 0.), (0., 1., 0.), (0., 0., 1.), (.43, .5, 1.48), (-.43, .22, 0.), (0., -1., 0.)]
        before_projection = [projected(point, original_canvas) for point in witness_points]
        old_scale = (before_projection[1] - before_projection[0]).length
        scene.render.resolution_x, scene.render.resolution_y = [v * density for v in canvas]
        scene.render.resolution_percentage = 100
        if canvas != original_canvas or pixel_offset != [0, 0]:
            new_scale = (projected((1., 0., 0.), canvas) - projected((0., 0., 0.), canvas)).length
            scene.camera.data.ortho_scale *= new_scale / old_scale
            bpy.context.view_layer.update()
            now = projected((0., 0., 0.), canvas)
            desired = before_projection[0] + Vector(pixel_offset)
            matrix = scene.camera.matrix_world.copy()
            right, up = matrix.to_3x3().col[0], matrix.to_3x3().col[1]
            right_pixels = (projected(right, canvas) - now).x
            up_pixels = (projected(up, canvas) - now).y
            matrix.translation += right * (-(desired.x - now.x) / right_pixels) + up * (-(desired.y - now.y) / up_pixels)
            scene.camera.matrix_world = matrix
            bpy.context.view_layer.update()
        projection_errors = [(projected(point, canvas) - before_projection[index] - Vector(pixel_offset)).length for index, point in enumerate(witness_points)]
        if max(projection_errors) > 1e-4:
            raise ValueError('Expanded canvas changed fixture world pixel registration')
        report['world_registration'] = dict(original_canvas=original_canvas, canvas=canvas, pixel_offset=pixel_offset,
                                           maximum_pixel_residual=max(projection_errors), unchanged_scale=True,
                                           points=[dict(world=list(point), before=list(before_projection[index]), after=list(projected(point, canvas))) for index, point in enumerate(witness_points)])
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 2
        scene.render.film_transparent = True
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.image_settings.color_depth = '8'
        layer = bpy.context.view_layer
        if manifest.get('linked_light_policy'):
            actor_objects = [o for o in body.all_objects if o.type == 'MESH' and not o.hide_render]
            stationary_objects = [o for o in furniture.all_objects if o.type == 'MESH' and (stationary_contact or o != moving)]
            wood_objects = [o for o in stationary_objects if not o.name.startswith('Book ')]
            def group(name, members):
                collection = bpy.data.collections.new(name)
                for obj in members:
                    collection.objects.link(obj)
                return collection
            stationary = group('__FetchStaticReceiverBlocker', stationary_objects)
            actors = group('__FetchActorReceivers', actor_objects)
            actor_blockers = group('__FetchActorBlockers', actor_objects + wood_objects)
            originals = [o for o in bpy.data.objects if o.type == 'LIGHT']
            clones = []
            for original in originals:
                if not hasattr(original, 'light_linking'):
                    raise ValueError('Actual Blender does not expose documented Object.light_linking')
                original.light_linking.receiver_collection = stationary
                original.light_linking.blocker_collection = stationary
                clone = original.copy()
                clone.data = original.data.copy()
                clone.name = '__FetchActorLight_' + original.name
                scene.collection.objects.link(clone)
                clone.matrix_world = original.matrix_world.copy()
                clone.light_linking.receiver_collection = actors
                clone.light_linking.blocker_collection = actor_blockers
                clones.append(clone)
            report['lighting_contract'] = dict(policy='Explicit new fetch art: independent static inventory and actor light/shadow groups; actor self-shadow and case-structure blockers retained',
                blender_version=bpy.app.version_string, groups_unlinked_from_scene=True,
                groups={c.name: sorted(o.name for o in c.objects) for c in (stationary, actors, actor_blockers)},
                lights=[dict(name=o.name, receiver=o.light_linking.receiver_collection.name,
                             blocker=o.light_linking.blocker_collection.name, matrix=[list(r) for r in o.matrix_world],
                             energy=o.data.energy, color=list(o.data.color)) for o in originals + clones])
            if any(c in scene.collection.children.values() for c in (stationary, actors, actor_blockers)):
                raise ValueError('Light-link groups changed render holdout hierarchy')
            if any(o.light_linking.receiver_collection != stationary or o.light_linking.blocker_collection != stationary for o in originals):
                raise ValueError('Static light receiver/blocker readback differs')
            if any(o.light_linking.receiver_collection != actors or o.light_linking.blocker_collection != actor_blockers for o in clones):
                raise ValueError('Actor light receiver/blocker readback differs')
            save()
        marker = world_to_camera_view(scene, scene.camera, rig.matrix_world @ rig.pose.bones['head'].head + Vector((0., 0., .34)))
        report.update(content='bookshelf', slot=manifest['slot'], phase=manifest['phase'], sourceFrame=manifest['slot'] * 4 + manifest['phase'], sourcePose=source_pose,
                      facing=manifest['facing'], canvas=canvas, anchor=[v / 8 + (21 if index == 1 else 0) + pixel_offset[index] for index, v in enumerate(camera['origin_pixels'])],
                      density=density, marker=[marker.x * canvas[0], (1 - marker.y) * canvas[1]],
                      suppressStock=not stationary_contact, forceSelectedStock=stationary_contact, canonical_carry=canonical,
                      camera_matrix=[list(r) for r in scene.camera.matrix_world], ortho_scale=scene.camera.data.ortho_scale,
                      moving_book_owner='Stationary inventory; actor-only coverage' if stationary_contact else ('Canonical carry book' if canonical else definition['source_book']))
        sys.path.insert(0,str(HERE))
        from pose_complete_fetch_spine_geometric_ink_v2 import author
        style = layer.freestyle_settings.linesets[0].linestyle
        geometric_ink, report['geometric_ink_contract'] = author(scene, furniture, body, stocks, style.thickness, tuple(style.color))
        materials = material_snapshot()

        def render(owner, palette, full_stock=False, stock_mask=None, tag=None):
            if time.monotonic() - began > 200:
                raise TimeoutError('Actual fetch render exceeded its bounded producer budget')
            for obj in stocks:
                index = int(obj.name.split()[1]) * 6 + int(obj.name.split()[2])
                obj.hide_render = not (bool(stock_mask & (1 << index)) if stock_mask is not None else full_stock)
            for original, ink_object in geometric_ink.items():
                ink_object.hide_render = bpy.data.objects[original].hide_render
            if canonical:
                moving.hide_render = True
            fill = owner in ('body', 'furniture')
            layer.layer_collection.children[body.name].holdout = fill and owner != 'body'
            layer.layer_collection.children[furniture.name].holdout = fill and owner != 'furniture'
            for lines in layer.freestyle_settings.linesets:
                lines.select_by_collection = True
                lines.collection = body
                lines.collection_negation = 'INCLUSIVE'
                if owner == 'bodyInk':
                    lines.collection = body
                    lines.collection_negation = 'INCLUSIVE'
            scene.render.use_freestyle = False
            ink = owner in ('sharedInk', 'bodyInk')
            layer.freestyle_settings.as_render_pass = False
            scene.use_nodes = ink
            if ink:
                tree = scene.node_tree
                tree.nodes.clear()
                source = tree.nodes.new('CompositorNodeRGB')
                source.outputs[0].default_value = (0,0,0,0)
                target = tree.nodes.new('CompositorNodeComposite')
                tree.links.new(source.outputs[0], target.inputs['Image'])
            label = f'stockMask{stock_mask:06x}' if stock_mask is not None else (('fullStockOwner' if owner == 'body' else 'fullStockBeauty') if full_stock else owner)
            label = tag if tag is not None else label
            filename = palette + '-' + label + '.png'
            path = output / filename
            scene.render.filepath = str(path)
            report['pass_owner_visibility']=dict(actor_collection_hidden=body.hide_render, ink_bindings={original:dict(source_hidden=bpy.data.objects[original].hide_render,ink_hidden=ink_object.hide_render) for original,ink_object in geometric_ink.items()})
            started = time.monotonic()
            bpy.ops.render.render(write_still=True)
            report['renders'].append(dict(owner=label, stock_mask=stock_mask, palette=palette, path=filename,
                                          sha256=digest(path), seconds=time.monotonic() - started, owner_visibility=report['pass_owner_visibility']))
            save()

        if manifest.get('stock_basis_only'):
            report['capture_mode']='Finite geometric-ink static rows and held-out inventory captures'
            body.hide_render=True
            bpy.context.view_layer.update()
            masks=[0]+[state<<(row*6) for row in range(4) for state in range(1,64)]
            masks+= [0xffffff,0x555555,0x924925]+[0xffffff & ~(1<<slot) for slot in range(24)]
            for mask in dict.fromkeys(masks):
                render('beauty','green',stock_mask=mask,tag=f'stockMask{mask:06x}')
            report['state']='complete'
            return
        if manifest.get('geometric_pilot_only'):
            report['capture_mode'] = 'One matched empty/full/alternate depth-tested-ink pilot'
            for owner in ('beauty','body','furniture','sharedInk','bodyInk'):
                render(owner,'green',tag='actor-empty-'+owner)
            render('beauty','green',True,tag='actor-full')
            render('beauty','green',stock_mask=0x555555,tag='actor-alternate')
            owner_hidden=body.hide_render
            body.hide_render=True
            bpy.context.view_layer.update()
            render('beauty','green',tag='static-empty')
            render('beauty','green',True,tag='static-full')
            render('beauty','green',stock_mask=0x555555,tag='static-alternate')
            body.hide_render=owner_hidden
            bpy.context.view_layer.update()
            report['state']='complete'
            return
        if manifest.get('owner_full_only'):
            report['capture_mode'] = 'Actual full-stock actor-only owner fill'
            render('body', 'green', True)
            report['state'] = 'complete'
            return
        for palette in ('green', 'blue', 'red'):
            if palette != 'green':
                set_shirt_colors(SHIRT_COLORS[palette], materials)
            for owner in (('beauty', 'body', 'furniture', 'sharedInk', 'bodyInk') if palette == 'green' else ('beauty', 'body')):
                render(owner, palette)
        for name in SHIRT_COLORS['blue']:
            material = bpy.data.materials[name]
            node = next(node for node in material.node_tree.nodes if node.type == 'VALTORGB')
            for element, original in zip(node.color_ramp.elements, materials[name][node.name + '/ramp']):
                element.color = original['color']
        render('beauty', 'green', True)
        if manifest.get('row_witness_masks'):
            for mask in manifest['row_witness_masks']:
                render('beauty', 'green', stock_mask=mask)
        report['state'] = 'complete'
    except BaseException as error:
        report.update(state='failed', error=repr(error), traceback=traceback.format_exc())
        raise
    finally:
        report['inputs_unchanged'] = all(digest(p) == h for p, h in inputs.items())
        save()


if __name__ == '__main__':
    run(*(Path(v).resolve() for v in sys.argv[sys.argv.index('--') + 1:]))
