"""Render actual static sit/read poses with registered ownership for each sofa state."""
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time

import bpy
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

ROOT = next(path for path in Path(__file__).resolve().parents if (path / 'assets/models/sims/sim-01').is_dir())
sys.path[:0] = [str(ROOT / 'assets/models/seating'), str(ROOT / 'assets/models/sims/sim-01')]
from neutral_pose import apply as sit_pose
from render_shirt_variants import material_snapshot, set_shirt_colors, SHIRT_COLORS


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def clone_actor(source, rig, name):
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    objects = set(source.all_objects) | {rig}
    copies = {}
    for original in objects:
        duplicate = original.copy()
        if original.type == 'ARMATURE':
            duplicate.data = original.data.copy()
        collection.objects.link(duplicate)
        copies[original] = duplicate
    for original, duplicate in copies.items():
        matrix = original.matrix_world.copy()
        if original.parent in copies:
            duplicate.parent = copies[original.parent]
        duplicate.matrix_world = matrix
        for modifier in duplicate.modifiers:
            if modifier.type == 'ARMATURE' and modifier.object in copies:
                modifier.object = copies[modifier.object]
        if duplicate.animation_data:
            duplicate.animation_data.action = None
            for driver in duplicate.animation_data.drivers:
                for variable in driver.driver.variables:
                    for target in variable.targets:
                        if target.id in copies:
                            target.id = copies[target.id]
    return collection, copies[rig]


def run(manifest_path, output):
    manifest = json.loads(manifest_path.read_text())
    inputs = dict(manifest['inputs']); inputs[str(manifest_path)] = digest(manifest_path)
    if not bpy.app.background or output.exists() or any(digest(path) != sha for path, sha in inputs.items()):
        raise ValueError('Sofa source requires background mode, a new output and unchanged frozen inputs')
    output.mkdir(); began = time.monotonic()
    report = dict(state='running', pid=os.getpid(), inputs=inputs, renders=[], acceptance=False,
                  scope='Static source poses with four explicit aliases; exact occupied scene ownership')
    def save():
        report['elapsed_seconds'] = time.monotonic() - began
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n')
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=manifest['source_scene'])
        states = json.loads(Path(manifest['pose_receipt']).read_text())['full_states']
        # The retained center actor has the actual corrected reader and book pose.
        candidates = [obj for obj in bpy.data.objects if obj.type == 'ARMATURE'
                      and abs(obj.matrix_world.translation.y) < .01]
        if len(candidates) != 1:
            raise ValueError('Corrected center-reader source rig is ambiguous')
        reader = candidates[0]
        original_bodies = []
        for rig in [obj for obj in bpy.data.objects if obj.type == 'ARMATURE']:
            bodies = [collection for collection in bpy.data.collections
                      if any(obj.type == 'MESH' and any(modifier.type == 'ARMATURE' and modifier.object == rig
                                                      for modifier in obj.modifiers) for obj in collection.objects)]
            if len(bodies) != 1:
                raise ValueError('Source actor collection is ambiguous')
            original_bodies.append((rig, bodies[0]))
        source_body = next(body for rig, body in original_bodies if rig == reader)
        actions = [manifest['sceneKey'] // (3 ** place) % 3 for place in range(3)]
        actors = []
        rotation = Matrix.Rotation(manifest['facing_radians'], 4, 'Z')
        for place, action in enumerate(actions):
            body, rig = clone_actor(source_body, reader, 'Sofa owner ' + str(place))
            if action == 1:
                sit_pose(rig, 'sofa', 0)
            else:
                for name, value in states[1]['bone_matrices'].items():
                    rig.pose.bones[name].matrix = Matrix(value)
            rig.matrix_world = rotation @ Matrix.Translation((0, (place - 1) * .58, 0)) @ Matrix(states[1]['rig_matrix_world'])
            for obj in body.all_objects:
                if action != 2 and obj.name.startswith(('Reading book cover', 'Reading book pages', 'Printed book line')):
                    obj.hide_render = True
            body.hide_render = action == 0
            actors.append((body, rig))
        for rig, body in original_bodies:
            body.hide_render = True
        furniture = bpy.data.collections['Witness furniture']
        for obj in furniture.all_objects:
            if obj.type in ('MESH', 'CURVE'):
                obj.matrix_world = rotation @ obj.matrix_world
        scene = bpy.context.scene; layer = bpy.context.view_layer
        scene.camera.matrix_world = Matrix(manifest['camera_matrix'])
        scene.camera.data.type = 'ORTHO'; scene.camera.data.ortho_scale = manifest['ortho_scale']
        scene.render.resolution_x, scene.render.resolution_y = [value * 8 for value in manifest['canvas']]
        scene.render.resolution_percentage = 100; scene.render.threads_mode = 'FIXED'; scene.render.threads = 2
        scene.render.film_transparent = True; scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'; scene.render.image_settings.color_depth = '8'
        bpy.context.view_layer.update()
        markers = []
        for body, rig in actors:
            marker = world_to_camera_view(scene, scene.camera, rig.matrix_world @ rig.pose.bones['head'].head + Vector((0, 0, .34)))
            markers.append([marker.x * manifest['canvas'][0], (1 - marker.y) * manifest['canvas'][1]])
        report.update(content='long_sofa', sceneKey=manifest['sceneKey'], actions=actions,
                      stableSeatIds=['seat_1', 'seat_2', 'seat_3'], facing=manifest['facing'],
                      canvas=manifest['canvas'], anchor=manifest['anchor'], markers=markers,
                      camera_matrix=manifest['camera_matrix'], ortho_scale=manifest['ortho_scale'],
                      phase_aliases=[0, 0, 0, 0], source_density=8,
                      poses=[dict(place=place, action=actions[place], rig_matrix_world=[list(row) for row in rig.matrix_world],
                                  bone_matrices={bone.name: [list(row) for row in bone.matrix] for bone in rig.pose.bones})
                             for place, (body, rig) in enumerate(actors)])
        materials = material_snapshot(); collections = [body for body, rig in actors] + [furniture]
        def render(owner, palette):
            if time.monotonic() - began > manifest.get('seconds', 210):
                raise TimeoutError('Bounded sofa source job exhausted')
            fill = owner == 'furniture' or owner.startswith('body') and not owner.startswith('bodyInk')
            selected = furniture if owner == 'furniture' else actors[int(owner[-1])][0] if owner.startswith('body') else None
            for collection in collections:
                layer.layer_collection.children[collection.name].holdout = fill and collection != selected
            ink = owner == 'sharedInk' or owner.startswith('bodyInk')
            for lines in layer.freestyle_settings.linesets:
                lines.select_by_collection = owner.startswith('bodyInk')
                if lines.select_by_collection:
                    lines.collection = selected; lines.collection_negation = 'INCLUSIVE'
            scene.render.use_freestyle = not fill
            layer.freestyle_settings.as_render_pass = ink; scene.use_nodes = ink
            if ink:
                tree = scene.node_tree; tree.nodes.clear()
                source = tree.nodes.new('CompositorNodeRLayers'); target = tree.nodes.new('CompositorNodeComposite')
                tree.links.new(source.outputs['Freestyle'], target.inputs['Image'])
            path = output / (palette + '-' + owner + '.png'); scene.render.filepath = str(path)
            start = time.monotonic(); bpy.ops.render.render(write_still=True)
            report['renders'].append(dict(palette=palette, owner=owner, path=path.name, sha256=digest(path),
                                          seconds=time.monotonic() - start)); save()
        for palette in ('green', 'blue', 'red'):
            if palette != 'green':
                set_shirt_colors(SHIRT_COLORS[palette], materials)
            render('beauty', palette)
            for place, action in enumerate(actions):
                if action:
                    render('body' + str(place), palette)
            if palette == 'green':
                render('furniture', palette); render('sharedInk', palette)
                for place, action in enumerate(actions):
                    if action:
                        render('bodyInk' + str(place), palette)
        report.update(state='complete', render_count=len(report['renders']))
    except BaseException as error:
        report.update(state='failed', error=repr(error)); raise
    finally:
        report['inputs_unchanged'] = all(digest(path) == sha for path, sha in inputs.items())
        save()


if __name__ == '__main__':
    run(*(Path(value).resolve() for value in sys.argv[sys.argv.index('--') + 1:]))
