"""Render body-owned Freestyle lines with the complete scene still occluding."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

BASE = Path(__file__).resolve().parent
MODELS = BASE.parent
sys.path[:0] = [str(BASE), str(MODELS / 'sims/sim-01')]
from pose_profiles import PROFILES
from render_shirt_variants import material_snapshot, set_shirt_colors, SHIRT_COLORS

FACINGS = {'SE': 90, 'NW': 270, 'SW': 0, 'NE': 180}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def restore_green(materials):
    for name in SHIRT_COLORS['blue']:
        for node in bpy.data.materials[name].node_tree.nodes:
            if node.type == 'VALTORGB':
                for element, original in zip(node.color_ramp.elements, materials[name][f'{node.name}/ramp']):
                    element.color = original['color']


def geometry(collection):
    deps = bpy.context.evaluated_depsgraph_get()
    result = {}
    for obj in collection.all_objects:
        if obj.type not in ('MESH', 'CURVE'):
            continue
        evaluated = obj.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            values = [(tuple(evaluated.matrix_world @ v.co)) for v in mesh.vertices]
            result[obj.name] = hashlib.sha256(repr((values, [tuple(p.vertices) for p in mesh.polygons])).encode()).hexdigest()
        finally:
            evaluated.to_mesh_clear()
    return result


def quarter_turn_symmetry(collection):
    """Measure the saved furniture vertices against their quarter-turn image."""
    deps = bpy.context.evaluated_depsgraph_get()
    groups = {}
    for obj in collection.all_objects:
        if obj.type not in ('MESH', 'CURVE'):
            continue
        evaluated = obj.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            key = tuple(slot.material.name if slot.material else '' for slot in obj.material_slots)
            groups.setdefault(key, []).extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
        finally:
            evaluated.to_mesh_clear()
    maximum = 0
    for points in groups.values():
        tree = KDTree(len(points))
        for i, point in enumerate(points):
            tree.insert(point, i)
        tree.balance()
        for point in points:
            maximum = max(maximum, tree.find(Vector((-point.y, point.x, point.z)))[2])
    if not groups or maximum > .00001:
        raise ValueError(f'Ottoman saved geometry lacks quarter-turn symmetry: {maximum}')
    return dict(max_vertex_distance=maximum, material_groups=len(groups), tolerance=.00001)


def run(source_path, output):
    proof = json.loads(source_path.read_text())
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use hidden background Blender and an absolute new output directory')
    if proof.get('state') != 'complete' or proof.get('probe') is not False or len(proof['objects']) != 5:
        raise ValueError('Body ink requires the complete five-object source batch')
    for name, sha in proof['inputs'].items():
        if digest(MODELS / name) != sha:
            raise ValueError('Source dependency changed: ' + name)
    output.mkdir(parents=True, exist_ok=False)
    receipt = dict(state='running', source_proof_sha256=digest(source_path), objects=[],
                   producer_sha256=digest(Path(__file__)), inputs=dict(proof['inputs']))
    def save():
        (output / 'proof.json').write_text(json.dumps(receipt, indent=2) + '\n')
    save()
    try:
        for record in proof['objects']:
            model = source_path.parent / record['model_path']
            if digest(model) != record['model_sha256']:
                raise ValueError('New authoring model changed')
            bpy.ops.wm.open_mainfile(filepath=str(model))
            scene = bpy.context.scene
            rig = bpy.data.objects['SIM_01_SHARED_RIG']
            root = next(obj for obj in bpy.data.objects if obj.type == 'EMPTY' and obj.name.endswith('_MODEL_ROOT'))
            body = bpy.data.collections['Neutral seated body']
            furniture = bpy.data.collections['Neutral seat furniture']
            kind = record['kind']
            if rig.animation_data.action.name != 'neutral_media_' + kind:
                raise ValueError('Saved neutral action differs')
            camera = [list(row) for row in scene.camera.matrix_world]
            if camera != record['camera_matrix'] or scene.camera.data.ortho_scale != record['ortho_scale']:
                raise ValueError('Saved camera differs from source receipt')
            entry = {field: record[field] for field in ('kind', 'source_sha256', 'model_sha256', 'canvas',
                     'anchor', 'camera_matrix', 'ortho_scale')}
            entry.update(renders=[], geometry=[], body_parts=record['contacts'][0]['body_parts'],
                         furniture_solids=sorted(obj.name for obj in furniture.all_objects if obj.type == 'MESH'))
            receipt['objects'].append(entry)
            root.rotation_euler.z = 0
            bpy.context.view_layer.update()
            if kind == 'ottoman':
                entry['quarter_turn_symmetry'] = quarter_turn_symmetry(furniture)
            scene.render.threads_mode = 'FIXED'
            scene.render.threads = 2
            scene.render.resolution_percentage = 100
            scene.render.image_settings.file_format = 'PNG'
            scene.render.image_settings.color_mode = 'RGBA'
            scene.render.film_transparent = True
            layer = bpy.context.view_layer
            for collection in (body, furniture):
                layer.layer_collection.children[collection.name].holdout = False
            scene.render.use_freestyle = True
            layer.freestyle_settings.as_render_pass = True
            for lines in layer.freestyle_settings.linesets:
                lines.select_by_collection = True
                lines.collection = body
                lines.collection_negation = 'INCLUSIVE'
            scene.use_nodes = True
            tree = scene.node_tree
            tree.nodes.clear()
            source = tree.nodes.new('CompositorNodeRLayers')
            target = tree.nodes.new('CompositorNodeComposite')
            tree.links.new(source.outputs['Freestyle'], target.inputs['Image'])
            materials = material_snapshot()
            for facing, degrees in FACINGS.items():
                for frame in range(4):
                    scene.frame_set(frame + 1)
                    root.rotation_euler.z = math.radians(degrees)
                    rig.rotation_euler.z = math.radians(degrees + PROFILES[kind]['body_turn'])
                    bpy.context.view_layer.update()
                    snapshots = []
                    for palette in ('green', 'blue', 'red'):
                        if palette == 'green':
                            restore_green(materials)
                        else:
                            set_shirt_colors(SHIRT_COLORS[palette], materials)
                        bpy.context.view_layer.update()
                        snapshots.append(geometry(body))
                    if not snapshots[0] == snapshots[1] == snapshots[2]:
                        raise ValueError('Palette changes evaluated body geometry')
                    entry['geometry'].append(dict(facing=facing, frame=frame, variants=['green', 'blue', 'red'],
                                                  body=snapshots[0]))
                    restore_green(materials)
                    target_path = output / f'{kind}-{facing}-{frame}-body-ink.png'
                    scene.render.filepath = str(target_path)
                    bpy.ops.render.render(write_still=True)
                    entry['renders'].append(dict(facing=facing, frame=frame, path=target_path.name,
                                                 sha256=digest(target_path)))
                    save()
            if digest(model) != record['model_sha256']:
                raise ValueError('Body ink changed new authoring model')
        if digest(source_path) != receipt['source_proof_sha256']:
            raise ValueError('Source receipt changed during ink rendering')
        receipt['state'] = 'complete'
        save()
    except BaseException:
        receipt['state'] = 'failed'
        receipt['error'] = traceback.format_exc()
        save()
        raise


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:]
    run(Path(args[0]).resolve(), Path(args[1]).resolve())
