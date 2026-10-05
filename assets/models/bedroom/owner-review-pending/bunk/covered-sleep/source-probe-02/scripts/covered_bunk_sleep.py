"""Replay a centered, sleeping-only pose and one occupied lower-bunk duvet."""
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

from bunk_sleep_cloth import geometry
from double_bed_sleep import (FACINGS, apply_approved_pose, digest,
                              prepare_palettes, ray_heights, surfaces, tree)
from double_bed_sleep import set_palette as set_owner_palette

BASE = Path(__file__).resolve().parent
SOURCE = BASE / 'owner-review-pending/bunk/candidate-03/bunk-authoring.blend'
SOURCE_SHA256 = '10b507a6dfcbbec05457cf7c9c857ee1f3fc08b80915967b743cace15b9fa9fa'
POSE = BASE / 'double-bed-sleep-pose.json'
POSE_SHA256 = '53bd65cc4c42ee60a3e68e5710e8da827e160f19c026da64237d58720eb31058'


def build():
    """Load immutable sources; change only this scene's lower sleeping place."""
    if digest(SOURCE) != SOURCE_SHA256 or digest(POSE) != POSE_SHA256:
        raise ValueError('Approved bunk source or sleeping recipe changed')
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene = bpy.context.scene
    scene.frame_set(1)
    root = bpy.data.objects['BUNK_MODEL_ROOT']
    root.rotation_euler.z = 0
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    body = bpy.data.collections['Preserved Sim reference - hidden']
    body.hide_render = False
    body.name = 'Covered bunk sleeper'
    config = json.loads(POSE.read_text(encoding='utf-8'))
    config['rig_location'][0] = 0
    config['world_offset'][0] = 0
    config['world_offset'][2] -= .00960552
    apply_approved_pose(rig, config)
    furniture = bpy.data.collections.new('Covered bunk furniture')
    scene.collection.children.link(furniture)
    for obj in list(root.children_recursive):
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        furniture.objects.link(obj)
    mattress = bpy.data.objects['Lower mattress']
    source_materials = [slot.material for slot in mattress.material_slots]
    for slot in mattress.material_slots:
        slot.link = 'OBJECT'
    state = {'scene': scene, 'root': root, 'rig': rig, 'body': body,
             'furniture': furniture, 'origin': rig.matrix_world.copy(),
             'blanket': None, 'source_materials': source_materials, 'config': config,
             'palettes': [prepare_palettes(body, 0)]}
    scene.render.threads_mode, scene.render.threads = 'FIXED', 2
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    if (scene.render.resolution_x, scene.render.resolution_y,
            scene.render.resolution_percentage) != (1280, 1408, 100):
        raise ValueError('Bunk registered render canvas changed')
    set_occupancy(state, 1)
    return state


def set_occupancy(state, occupancy):
    """Replace the occupied cover; never retain it in an empty scene."""
    if type(occupancy) is not int or occupancy not in (0, 1):
        raise ValueError('Expected one-place occupancy 0 or 1')
    state['root'].rotation_euler.z = 0
    state['rig'].matrix_world = state['origin'].copy()
    state['body'].hide_render = not bool(occupancy)
    if state['blanket'] is not None:
        obj = state['blanket']
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)
        state['blanket'] = None
    for slot, original in zip(bpy.data.objects['Lower mattress'].material_slots,
                              state['source_materials']):
        slot.material = bpy.data.materials['Bunk warm linen'] if occupancy else original
    bpy.context.view_layer.update()
    if occupancy:
        body_trees = {name: tree(value) for name, value in surfaces(state['body']).items()}

        def height(x, y):
            hits = ray_heights(Vector((x, y, 0)), body_trees)
            return max(hit[0] for hit in hits) if hits else None

        vertices, faces, materials = geometry(height)
        mesh = bpy.data.meshes.new('Covered bunk occupied duvet geometry')
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        blanket = bpy.data.objects.new('Covered bunk occupied duvet', mesh)
        state['furniture'].objects.link(blanket)
        blanket.parent = state['root']
        for name in ('Bunk sage duvet', 'Bunk turned duvet edge'):
            mesh.materials.append(bpy.data.materials[name])
        for polygon, material in zip(mesh.polygons, materials):
            polygon.material_index = material
            polygon.use_smooth = True
        modifier = blanket.modifiers.new('Continuous cloth thickness', 'SOLIDIFY')
        modifier.thickness, modifier.offset = .008, -1
        state['blanket'] = blanket
    state['occupancy'] = occupancy
    bpy.context.view_layer.update()


def set_facing(state, facing):
    """Rotate the frame, cover and unchanged whole posed rig together."""
    if facing not in FACINGS:
        raise ValueError('Unknown bunk facing')
    angle = math.radians(FACINGS[facing])
    state['root'].rotation_euler.z = angle
    state['rig'].matrix_world = Matrix.Rotation(angle, 4, 'Z') @ state['origin']
    bpy.context.view_layer.update()


def set_palette(state, variant):
    """Change the one sleeper's clothes without recoloring bedding or skin."""
    set_owner_palette(state, 0, variant)
