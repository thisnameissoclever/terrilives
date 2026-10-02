"""Measure dining support in furniture coordinates and reject solid crossings."""
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE.parent / n) for n in ('living', 'dining', 'furniture')]
from armchair_contact import evaluated_surface, intersection, body_inventory
from armchair_support import contact_footprint
from chair_layout import parts as chair_parts
from table_layout import parts as table_parts


def hip_support(points, seat, deps):
    surface = seat.evaluated_get(deps)
    inverse = surface.matrix_world.inverted()
    gaps, near = [], []
    for point in points:
        hit, position, _, _ = surface.ray_cast(inverse @ Vector((point.x, point.y, 2)),
                                              inverse.to_3x3() @ Vector((0, 0, -1)))
        if hit:
            gap = point.z - (surface.matrix_world @ position).z
            gaps.append(gap)
            if 0 <= gap <= .01:
                near.append(inverse @ point)
    assert gaps and 0 <= min(gaps) <= .003, 'Dining hip lacks non-penetrating seat support'
    return dict(min_gap=min(gaps), ray_hits=len(gaps), contact_count=len(near),
                coordinates='seat local', **contact_footprint(near))


def inventory(root, expected):
    objects = list(root.children_recursive)
    assert {obj.name for obj in objects} == {part['name'] for part in expected}, 'Dining furniture inventory changed'
    assert all(obj.type == 'MESH' for obj in objects), 'Unsupported dining solid'
    return objects


def measure(rig, chair, table):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    bodies = {name: evaluated_surface(bpy.data.objects[name], deps) for name in sorted(body_inventory())}
    assert all(not bpy.data.objects[name].hide_render for name in body_inventory()), 'Dining body part hidden'
    furniture = inventory(chair, chair_parts()) + inventory(table, table_parts())
    solids = {obj.name: evaluated_surface(obj, deps) for obj in furniture}
    collisions = []
    for name, surface in bodies.items():
        for other, solid in solids.items():
            witness = intersection(surface, solid)
            if witness:
                collisions.append(dict(body=name, furniture=other, witness=witness))
    assert not collisions, f'Dining body intersects furniture: {collisions}'
    seat = next(obj for obj in chair.children_recursive if obj.name == 'Seat')
    support = hip_support(bodies['Trouser hip bridge'][0], seat, deps)
    soles = {}
    for name in ('Fitted rounded shoe sole', 'Fitted rounded shoe sole.001'):
        low = min(point.z for point in bodies[name][0])
        assert .018 <= low <= .020, f'Dining sole clearance changed: {name}: {low}'
        soles[name] = low
    plate = next(obj for obj in bpy.data.objects['Dinner on table'].children if obj.name.startswith('Ceramic dinner plate'))
    plate_points = evaluated_surface(plate, deps)[0]
    low = min(point.z for point in plate_points)
    tabletop = next(obj for obj in table.children_recursive if obj.name == 'Tabletop').evaluated_get(deps)
    inverse = tabletop.matrix_world.inverted()
    gaps = []
    for point in plate_points:
        if point.z > low + .00001:
            continue
        hit, position, _, _ = tabletop.ray_cast(inverse @ Vector((point.x, point.y, 2)),
                                                inverse.to_3x3() @ Vector((0, 0, -1)))
        assert hit, 'Meal plate foot is outside the table'
        gaps.append(point.z - (tabletop.matrix_world @ position).z)
    assert gaps and max(abs(gap) for gap in gaps) < .003, 'Meal plate lost tabletop support'
    holder = bpy.data.objects['Eating spoon']
    spoon = next(obj for obj in holder.children if obj.type == 'MESH')
    spoon_surface = evaluated_surface(spoon, deps)
    for name, solid in solids.items():
        assert intersection(spoon_surface, solid) is None, f'Eating spoon intersects {name}'
    palm = rig.matrix_world @ rig.pose.bones['hand.R'].matrix @ rig.data.bones['hand.R'].matrix_local.inverted() @ Vector((.303, -.075, .737))
    grip_error = (holder.matrix_world.translation - palm).length
    assert grip_error < .001, 'Eating spoon detached from palm'
    bowl = spoon.matrix_world @ Vector((0, .175, 0))
    mouth_points = bodies['Quiet closed smile'][0]
    mouth = sum(mouth_points, Vector()) / len(mouth_points)
    return dict(body_inventory=sorted(bodies), checked_solids=sorted(solids),
                collisions=collisions, hip_support=support, sole_clearance=soles,
                plate_support=dict(foot_samples=len(gaps), max_gap=max(abs(gap) for gap in gaps)),
                spoon_grip_error=grip_error, spoon_mouth_distance=(bowl-mouth).length)
