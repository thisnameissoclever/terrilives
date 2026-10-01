"""Build the approved static sleeping pose and one duvet for either occupancy."""
import hashlib
import json
import math
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

BASE = Path(__file__).resolve().parent
CONFIG_PATH = BASE / 'double-bed-sleep-pose.json'
FACINGS = {'SE': 90, 'NW': 270, 'SW': 0, 'NE': 180}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def surface(obj, deps):
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    try:
        mesh.calc_loop_triangles()
        return ([evaluated.matrix_world @ vertex.co for vertex in mesh.vertices],
                [tuple(triangle.vertices) for triangle in mesh.loop_triangles])
    finally:
        evaluated.to_mesh_clear()


def surfaces(collection):
    deps = bpy.context.evaluated_depsgraph_get()
    return {obj.name: surface(obj, deps) for obj in collection.all_objects
            if obj.type == 'MESH' and not obj.hide_render}


def tree(value):
    return BVHTree.FromPolygons(*value, all_triangles=True)


def ray_heights(point, trees):
    return [(hit.z, name) for name, bvh in trees.items()
            for hit, _, _, _ in [bvh.ray_cast(Vector((point.x, point.y, 3)),
                                             Vector((0, 0, -1)), 4)]
            if hit is not None]


def point_bone(rig, name, direction):
    bone = rig.pose.bones[name]
    parent = bone.parent
    inherited = (rig.matrix_world.to_quaternion().normalized()
                 @ parent.matrix.to_quaternion().normalized()
                 @ parent.bone.matrix_local.to_quaternion().normalized().inverted()).normalized()
    rest_direction = bone.bone.tail_local - bone.bone.head_local
    target_direction = Vector(direction).normalized()
    swing = (inherited @ rest_direction).normalized().rotation_difference(target_direction)
    deformation = (swing @ inherited).normalized()
    rest = bone.bone.matrix_local.to_quaternion().normalized()
    target = (rig.matrix_world.to_quaternion().normalized().inverted() @ deformation @ rest).normalized()
    local_parent = (parent.matrix.to_quaternion().normalized()
                    @ parent.bone.matrix_local.to_quaternion().normalized().inverted() @ rest).normalized()
    bone.rotation_mode = 'QUATERNION'
    bone.rotation_quaternion = (local_parent.inverted() @ target).normalized()
    bpy.context.view_layer.update()
    actual = (rig.matrix_world.to_3x3() @ (bone.tail - bone.head)).normalized()
    assert (actual - target_direction).length < 2e-6, name



def create_blanket(body_surfaces, root):
    nx, ny = 81, 71
    xs, ys = np.linspace(-.765, .765, nx), np.linspace(-.94, .225, ny)
    body_trees = {name: tree(surface) for name, surface in body_surfaces.items()}
    heights = np.full((ny, nx), .478, dtype=float)
    for iy, y in enumerate(ys):
        for ix, x in enumerate(xs):
            hits = ray_heights(Vector((x, y, 0)), body_trees)
            if hits:
                heights[iy, ix] = max(heights[iy, ix], max(hit[0] for hit in hits) + .045)
    # Broad drape spans between nearby contact points instead of tracing every fold.
    draped = heights.copy()
    radius = .24
    dx, dy = xs[1] - xs[0], ys[1] - ys[0]
    for oy in range(-int(radius/dy), int(radius/dy)+1):
        for ox in range(-int(radius/dx), int(radius/dx)+1):
            distance_squared = (ox*dx)**2 + (oy*dy)**2
            if distance_squared > radius**2:
                continue
            target_y = slice(max(0, oy), min(ny, ny+oy))
            source_y = slice(max(0, -oy), min(ny, ny-oy))
            target_x = slice(max(0, ox), min(nx, nx+ox))
            source_x = slice(max(0, -ox), min(nx, nx-ox))
            draped[target_y, target_x] = np.maximum(
                draped[target_y, target_x], heights[source_y, source_x] - 6*distance_squared)
    vertices = [(float(x), float(y), float(draped[iy, ix]))
                for iy, y in enumerate(ys) for ix, x in enumerate(xs)]
    faces, material_ids = [], []
    for iy in range(ny-1):
        for ix in range(nx-1):
            a = iy*nx+ix
            faces.append((a, a+1, a+nx+1, a+nx))
            material_ids.append(1 if ys[iy] >= .105 else 0)
    # Continue the same cloth over both sides and the foot, not across its neckline.
    edge = [iy*nx for iy in range(ny-1, -1, -1)]
    edge += list(range(1, nx))
    edge += [iy*nx+nx-1 for iy in range(1, ny)]
    previous = edge
    for theta in (math.pi/8, math.pi/4, 3*math.pi/8, math.pi/2):
        current = []
        for index in edge:
            x, y, z = vertices[index]
            outward_x = -.02 if x == float(xs[0]) else .02 if x == float(xs[-1]) else 0
            outward_y = -.025 if y == float(ys[0]) else 0
            current.append(len(vertices))
            vertices.append((x+outward_x*math.sin(theta),
                             y+outward_y*math.sin(theta), .43+(z-.43)*math.cos(theta)))
        for ia in range(len(edge)-1):
            faces.append((previous[ia], current[ia], current[ia+1], previous[ia+1]))
            material_ids.append(1 if vertices[edge[ia]][1] >= .105 else 0)
        previous = current
    mesh = bpy.data.meshes.new('Double bed occupied duvet geometry')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new('Double bed occupied duvet', mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = root
    for material in ('Double bed sage duvet', 'Double bed turned duvet edge'):
        mesh.materials.append(bpy.data.materials[material])
    for polygon, index in zip(mesh.polygons, material_ids):
        polygon.material_index = index
        polygon.use_smooth = True
    solidify = obj.modifiers.new('Occupied blanket thickness', 'SOLIDIFY')
    solidify.thickness = .008
    solidify.offset = -1
    return obj


def apply_approved_pose(rig, config):
    rig.animation_data.action = None
    rig.rotation_euler = (0, 0, 0)
    rig['eyes_closed'], rig['book_visible'] = 1.0, 0.0
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = Quaternion(config['pose_quaternions'][bone.name])
    rig.pose.bones['root'].location = (
        rig.data.bones['root'].matrix_local.to_3x3().inverted()
        @ Vector(config['root_translation']))
    rig.location = config['rig_location']
    bpy.context.view_layer.update()
    for side in ('L', 'R'):
        point_bone(rig, 'thigh.'+side, (0, -1, 0))
        angle = math.radians(config['knee_degrees'])
        point_bone(rig, 'shin.'+side, (0, -math.cos(angle), -math.sin(angle)))
        point_bone(rig, 'foot.'+side, (0, 0, 1))
    offset = Vector(config['world_offset'])
    rig.matrix_world = Matrix.Translation(offset) @ Matrix.Scale(
        config['sleeping_scale'], 4) @ rig.matrix_world
    bpy.context.view_layer.update()
    angle = math.radians(config['head_degrees'])
    point_bone(rig, 'head', (0, math.cos(angle), math.sin(angle)))
    bpy.context.view_layer.update()


def clone_owner(rig, original):
    collection = bpy.data.collections.new('Double bed sleeper 1')
    bpy.context.scene.collection.children.link(collection)
    mapping = {}
    for obj in [rig] + [obj for obj in original.all_objects if obj != rig]:
        duplicate = obj.copy()
        duplicate.name = 'Place 1 ' + obj.name
        if obj.type == 'ARMATURE':
            duplicate.data = obj.data.copy()
        collection.objects.link(duplicate)
        mapping[obj] = duplicate
    for obj, duplicate in mapping.items():
        if obj.parent in mapping:
            duplicate.parent = mapping[obj.parent]
        for modifier in duplicate.modifiers:
            if modifier.type == 'ARMATURE' and modifier.object in mapping:
                modifier.object = mapping[modifier.object]
        for constraint in duplicate.constraints:
            if hasattr(constraint, 'target') and constraint.target in mapping:
                constraint.target = mapping[constraint.target]
        if duplicate.animation_data:
            for curve in duplicate.animation_data.drivers:
                for variable in curve.driver.variables:
                    for target in variable.targets:
                        if target.id in mapping:
                            target.id = mapping[target.id]
    second = mapping[rig]
    second.location.x -= .75
    second['double_bed_place'] = 1
    rig['double_bed_place'] = 0
    bpy.context.view_layer.update()
    return second, collection


def prepare_palettes(collection, owner):
    colors = {
        'blue': {'Washed sage overshirt': (.045, .18, .38, 1),
                 'Sage seam and cuff': (.035, .135, .285, 1),
                 'Sage folded collar fabric': (.055, .205, .42, 1)},
        'red': {'Washed sage overshirt': (.40, .06, .045, 1),
                'Sage seam and cuff': (.30, .045, .034, 1),
                'Sage folded collar fabric': (.44, .075, .055, 1)},
    }
    result = {}
    for obj in collection.all_objects:
        for slot in obj.material_slots:
            original = slot.material
            if original is None or original.name not in colors['blue']:
                continue
            name = original.name
            if name not in result:
                material = original.copy()
                material.name = f'Double bed place {owner} {name}'
                ramps = [node for node in material.node_tree.nodes if node.type == 'VALTORGB']
                if len(ramps) != 1 or len(ramps[0].color_ramp.elements) != 4:
                    raise ValueError('Approved clothing ramp changed')
                result[name] = {'material': material, 'ramp': ramps[0].color_ramp,
                                'stops': [tuple(stop.color) for stop in ramps[0].color_ramp.elements],
                                'source': tuple(original.diffuse_color), 'colors': colors}
            slot.link = 'OBJECT'
            slot.material = result[name]['material']
    if set(result) != set(colors['blue']):
        raise ValueError('Missing independent clothing materials')
    return result


def set_palette(state, owner, variant):
    if owner not in (0, 1) or variant not in ('green', 'blue', 'red'):
        raise ValueError('Unknown sleeping owner or palette')
    for name, record in state['palettes'][owner].items():
        target = record['source'] if variant == 'green' else record['colors'][variant][name]
        source = record['source']
        if any(channel <= 0 for channel in source[:3]):
            raise ValueError('Clothing shading ratios require positive source channels')
        for stop, original in zip(record['ramp'].elements, record['stops']):
            stop.color = tuple(original[i]*target[i]/source[i] for i in range(3))+(original[3],)
    bpy.context.view_layer.update()


def build():
    config = json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
    source = BASE / config['source_model']
    if digest(source) != config['source_sha256']:
        raise ValueError('Approved bed source bytes changed')
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    scene.frame_set(1)
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    root = bpy.data.objects['DOUBLE-BED_MODEL_ROOT']
    root.rotation_euler.z = 0
    body = bpy.data.collections['Preserved Sim reference - hidden']
    body.hide_render = False
    body.name = 'Double bed sleeper 0'
    apply_approved_pose(rig, config)
    original_surfaces = surfaces(body)
    second, second_body = clone_owner(rig, body)
    furniture = bpy.data.collections.new('Double bed furniture')
    scene.collection.children.link(furniture)
    for obj in list(root.children_recursive):
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        furniture.objects.link(obj)
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 2
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = True
    if (scene.render.resolution_x, scene.render.resolution_y) != (1280, 1408):
        raise ValueError('Approved registered canvas changed')
    result = {'scene': scene, 'root': root, 'rigs': [rig, second],
              'bodies': [body, second_body], 'furniture': furniture,
              'origins': [actor.matrix_world.copy() for actor in (rig, second)],
              'blanket': None, 'config': config, 'single_surfaces': original_surfaces}
    result['palettes'] = [prepare_palettes(body, 0), prepare_palettes(second_body, 1)]
    set_occupancy(result, 1)
    return result


def set_occupancy(state, occupancy):
    if type(occupancy) is not int or occupancy not in (0, 1, 2, 3):
        raise ValueError('Expected two-place occupancy bits')
    state['root'].rotation_euler.z = 0
    for index, rig in enumerate(state['rigs']):
        rig.matrix_world = state['origins'][index].copy()
        state['bodies'][index].hide_render = not bool(occupancy & (1 << index))
    if state['blanket'] is not None:
        obj = state['blanket']
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)
        state['blanket'] = None
    bpy.data.objects['Sage duvet'].hide_render = bool(occupancy)
    bpy.data.objects['Folded duvet edge'].hide_render = bool(occupancy)
    bpy.context.view_layer.update()
    if occupancy:
        body = {}
        for index, collection in enumerate(state['bodies']):
            if occupancy & (1 << index):
                body.update(surfaces(collection))
        obj = create_blanket(body, state['root'])
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        state['furniture'].objects.link(obj)
        state['blanket'] = obj
    state['occupancy'] = occupancy
    bpy.context.view_layer.update()


def set_facing(state, facing):
    angle = math.radians(FACINGS[facing])
    rotation = Matrix.Rotation(angle, 4, 'Z')
    state['root'].rotation_euler.z = angle
    for rig, origin in zip(state['rigs'], state['origins']):
        rig.matrix_world = rotation @ origin
    bpy.context.view_layer.update()
