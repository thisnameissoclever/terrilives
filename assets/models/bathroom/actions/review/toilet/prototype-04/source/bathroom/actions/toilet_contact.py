"""Measure complete body clearance and disjoint evaluated seat support."""
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parents[1]/'living'))
from armchair_contact import body_inventory, evaluated_surface, intersection
from toilet_pose_geometry import on_ring, validate_patches

SOLIDS = {'Toilet recessed bowl', 'Toilet open seat ring', 'Toilet pedestal',
          'Toilet rear ceramic neck', 'Toilet upper tank support', 'Toilet cistern',
          'Toilet cistern cap', 'Toilet flush button', 'Toilet seat bumper -1',
          'Toilet seat bumper 1', 'Toilet hinge mount -1', 'Toilet hinge mount 1',
          'Toilet hinge axle', 'Toilet upright lid'}


def support_grid(hip, seat, deps):
    surface = seat.evaluated_get(deps)
    inverse = surface.matrix_world.inverted()
    points = []
    for ix in range(-72, 73):
        x = ix*.003
        for iy in range(-95, 96):
            y = -.10+iy*.003
            if not on_ring(x, y):
                continue
            hit, position, _, _ = surface.ray_cast(inverse@Vector((x, y, 2)),
                                                 inverse.to_3x3()@Vector((0, 0, -1)))
            if not hit:
                continue
            top = surface.matrix_world@position
            bottom, _, _, _ = hip[1].ray_cast(Vector((x, y, -.2)), Vector((0, 0, 1)), 2)
            if bottom is None:
                continue
            points.append(dict(x=x, y=y, hip_z=bottom.z, seat_z=top.z, gap=bottom.z-top.z))
    if not points or any(not math.isfinite(v) for point in points for v in point.values()):
        raise ValueError('No finite evaluated hip-to-ring hits')
    return points


def support_patches(grid):
    near = {(round(p['x'], 6), round(p['y'], 6)):p for p in grid if 0 <= p['gap'] <= .01}
    patches = []
    for side in (-1, 1):
        found = None
        for x, y in sorted(near, key=lambda point: (-abs(point[0]), point[1])):
            if side*x < .08:
                continue
            rectangle = [near.get((round(x-side*ix*.003, 6), round(y+iy*.003, 6)))
                         for ix in range(7) for iy in range(16)]
            if all(p is not None and side*p['x'] >= .08 for p in rectangle):
                found = rectangle
                break
        if found is None:
            raise ValueError(f'No finite non-penetrating support patch on ring side {side}')
        patches.append(found)
    measured = validate_patches([[(p['x'], p['y'], p['seat_z']) for p in patch] for patch in patches])
    for result, patch in zip(measured, patches):
        result.update(min_gap=min(p['gap'] for p in patch), max_gap=max(p['gap'] for p in patch),
                      evaluated_witnesses=patch)
    return measured


def measure(root, rig, body, require=True):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    visible = {obj.name:obj for obj in body.all_objects if not obj.hide_render}
    if set(visible) != body_inventory() or any(obj.type != 'MESH' for obj in visible.values()):
        raise ValueError(f'Visible body inventory changed: {sorted(set(visible)^body_inventory())}')
    fixtures = {obj.name:obj for obj in root.children_recursive if obj.type == 'MESH'}
    if set(fixtures) != SOLIDS | {'Toilet bowl water'}:
        raise ValueError('Complete toilet inventory changed')
    if any(obj.hide_render for obj in fixtures.values()):
        raise ValueError('A required toilet surface is hidden')
    bodies = {name:evaluated_surface(obj, deps) for name, obj in visible.items()}
    solids = {name:evaluated_surface(fixtures[name], deps) for name in sorted(SOLIDS)}
    collisions = []
    for name, surface in sorted(bodies.items()):
        for other, solid in solids.items():
            collision = intersection(surface, solid)
            if collision:
                witnesses = [list(p) for p in surface[0] if .418 <= p.z <= .451 and on_ring(p.x, p.y)]
                collisions.append(dict(body=name, fixture=other, ring_band_vertices=witnesses,
                                       **collision))
    grid = support_grid(bodies['Trouser hip bridge'], fixtures['Toilet open seat ring'], deps)
    errors = {bone.name:abs((bone.tail-bone.head).length-rig.data.bones[bone.name].length)
              for bone in rig.pose.bones}
    soles = {name:dict(min_z=min(p.z for p in bodies[name][0]),
                       max_z=max(p.z for p in bodies[name][0]),
                       evaluated_vertex_count=len(bodies[name][0]))
             for name in ('Fitted rounded shoe sole', 'Fitted rounded shoe sole.001')}
    result = dict(body_inventory=sorted(visible), fixture_solids=sorted(solids),
                  excluded_non_solid=['Toilet bowl water'], collisions=collisions,
                  ring_ray_hits=len(grid), ring_min_gap=min(p['gap'] for p in grid),
                  ring_max_gap=max(p['gap'] for p in grid), soles=soles,
                  bone_length_errors=errors, complete_body_solid_pairs=len(bodies)*len(solids))
    if not require:
        return result
    if collisions:
        raise ValueError(f'Body intersects fixture: {collisions}')
    if not 0 <= result['ring_min_gap'] <= .003:
        raise ValueError('Hip lost actual open-ring support')
    result['ring_support_patches'] = support_patches(grid)
    if len(errors) != 17 or max(errors.values()) > 1e-5:
        raise ValueError('Anatomical bone lengths changed')
    if any(not .018 <= value['min_z'] <= .020 for value in soles.values()):
        raise ValueError('Actual shoe sole clearance changed')
    if any(abs(v-1) > 1e-6 for obj in (rig, root) for v in obj.scale):
        raise ValueError('Body or toilet object scale changed')
    result['state'] = 'passed'
    return result
