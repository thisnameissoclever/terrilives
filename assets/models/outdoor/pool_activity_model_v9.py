"""Build the uninterrupted rectangular pool with its inclined exterior ladder."""
import bpy

from pool_activity_model_v8 import build as build_ladder_pool, replace_mesh
import pool_activity_layout_v4 as materials
import pool_activity_layout_v9 as layout


def build(root, *, compact=False):
    build_ladder_pool(root)
    objects = {obj.name: obj for obj in root.children_recursive}
    def bounds(rectangle):
        left, right, rear, front = rectangle
        return left, right, rear + int(compact), front

    replace_mesh(objects['Pool wall'], *layout.shell(
        bounds(layout.WALL), bounds(layout.LINER), 0, materials.COPING_BOTTOM))
    stone, faces, _ = layout.shell(
        bounds(layout.COPING), bounds(layout.OPENING), materials.COPING_BOTTOM, materials.COPING_TOP)
    replace_mesh(objects['Pool stone coping'], stone, faces, [0] * len(faces), bevel=.003)

    left, right, rear, front = bounds(layout.WALL)
    for index, (bottom, top) in enumerate(materials.TRIM_BANDS, 1):
        outside = (left - .003, right + .003, rear - .003, front + .003)
        inside = (left + .01, right - .01, rear + .01, front - .01)
        band, faces, _ = layout.shell(outside, inside, bottom, top)
        replace_mesh(objects[f'Pool wall trim band {index}'], band, faces, [0] * len(faces))

    floor, faces = layout.surface(bounds(layout.LINER), materials.BASIN_FLOOR_Z)
    replace_mesh(objects['Pool basin floor'], floor, faces, [0] * len(faces))
    water, faces = layout.surface(bounds(layout.WATER), materials.WATER_Z, 256, 192 if compact else 320)
    ripples = []
    for face in faces:
        x, y, _ = water[face[0]]
        x1, y1, _ = water[face[2]]
        ripples.append(int(materials.in_ripple((x + x1) / 2, (y + y1) / 2 + (.27 if compact else .54))))
    replace_mesh(objects['Pool water surface'], water, faces, ripples)
    bpy.context.view_layer.update()
