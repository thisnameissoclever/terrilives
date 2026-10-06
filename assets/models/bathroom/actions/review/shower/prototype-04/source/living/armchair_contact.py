"""Evaluated chair construction, seated support and all-visible-body clearance."""
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'bathroom'), str(BASE.parent/'kitchen'),
               str(BASE.parent/'bedroom')]
from armchair_layout import parts
from armchair_support import contact_footprint
from bunk_contact import point_bounds
from check_toilet_scene import overlap_witness


def body_inventory():
    singles = ('Collar stand', 'HAIR_01_TRIPO_CURL', 'Natural neck', 'One sewn breast pocket',
               'Overshirt body', 'Pocket top seam', 'Quiet closed smile', 'Sculpted head',
               'Shirt lower hem', 'Shirt placket', 'Small rounded nose', 'Trouser hip bridge')
    pairs = ('Dark pupil', 'Ear', 'Eye white', 'Fitted rounded shoe sole',
             'Folded fabric collar leaf', 'Forearm with elbow and wrist sections', 'Hazel iris',
             'Inner ear', 'Relaxed palm', 'Relaxed shirt sleeve', 'Resting thumb', 'Shaped shoe',
             'Shoe apron stitch', 'Small eye catchlight', 'Soft eyebrow', 'Tailored trouser leg',
             'Trouser hem', 'Turned sleeve cuff', 'Upper lid outline')
    return set(singles) | {name+suffix for name in pairs for suffix in ('', '.001')} | {
        'Small horn button'+suffix for suffix in ('', '.001', '.002', '.003')}


def evaluated_surface(obj, deps):
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    try:
        mesh.calc_loop_triangles()
        points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        triangles = [tuple(triangle.vertices) for triangle in mesh.loop_triangles]
        assert points and triangles, f'Empty evaluated geometry: {obj.name}'
        return points, BVHTree.FromPolygons(points, triangles, all_triangles=True, epsilon=0)
    finally:
        evaluated.to_mesh_clear()


def intersection(first, second):
    """Check triangle crossings and full containment in either direction."""
    a, a_tree = first
    b, b_tree = second
    a_low, a_high = point_bounds(a)
    b_low, b_high = point_bounds(b)
    if any(a_high[i] < b_low[i] or b_high[i] < a_low[i] for i in range(3)):
        return None
    crossings = a_tree.overlap(b_tree)
    if crossings:
        return {'kind': 'surface', 'triangle_pairs': len(crossings)}
    for label, points, tree in (('body_inside_chair', a, b_tree),
                                ('chair_inside_body', b, a_tree)):
        for point in points:
            closest, normal, _, distance = tree.find_nearest(point)
            if closest is not None and distance > 1e-6 and (point-closest).dot(normal) < -1e-6:
                return {'kind': label, 'point': list(point)}
    return None


def seat_support(points, surface, deps):
    seat = surface.evaluated_get(deps)
    inverse = seat.matrix_world.inverted()
    gaps, near = [], []
    for point in points:
        hit, location, _, _ = seat.ray_cast(inverse @ Vector((point.x, point.y, 2)),
                                           inverse.to_3x3() @ Vector((0, 0, -1)))
        if hit:
            gap = point.z-(seat.matrix_world @ location).z
            gaps.append(gap)
            # Rounded rigid hips have a wider near-support neighborhood than the
            # closest point. This is proximity, not simulated cushion compression.
            if 0 <= gap <= .01:
                near.append(point)
    assert gaps and 0 <= min(gaps) <= .003, 'Hip lost non-penetrating seat support'
    return {'min_gap': min(gaps), 'ray_hits': len(gaps), 'contact_count': len(near),
            'near_gap_limit': .01, **contact_footprint(near)}


def measure(root, body, frame):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    expected = parts()
    solids = {obj.name: obj for obj in root.children_recursive}
    assert set(solids) == {part['name'] for part in expected}, 'Armchair inventory changed'
    assert root.location.length < 1e-6 and max(abs(v) for v in root.rotation_euler) < 1e-6, 'Armchair authored basis changed'
    assert all(obj.type == 'MESH' and not obj.hide_render for obj in solids.values()), 'Chair solid hidden or unsupported'
    visible = {obj.name: obj for obj in body.all_objects if not obj.hide_render}
    assert set(visible) == body_inventory(), 'Visible Sim inventory changed'
    assert all(obj.type == 'MESH' for obj in visible.values()), 'Unhandled visible Sim geometry'
    chair_surfaces = {name: evaluated_surface(obj, deps) for name, obj in solids.items()}
    body_surfaces = {name: evaluated_surface(obj, deps) for name, obj in visible.items()}
    # Fit guards run before authoring dimensions so mutation failures identify the actual defect.
    for name, surface in body_surfaces.items():
        for other, chair in chair_surfaces.items():
            collision = intersection(surface, chair)
            assert collision is None, f'Body intersects chair: {name} / {other} / {collision}'
    support = seat_support(body_surfaces['Trouser hip bridge'][0], solids['Seat cushion'], deps)
    soles = {}
    for name in ('Fitted rounded shoe sole', 'Fitted rounded shoe sole.001'):
        low, high = point_bounds(body_surfaces[name][0])
        assert .018 <= low[2] <= .020, f'Inherited shoe clearance changed: {name}'
        soles[name] = low[2]
    contacts, grounded = {}, []
    for part in expected:
        obj = solids[part['name']]
        low, high = point_bounds(chair_surfaces[obj.name][0])
        assert low[2] >= -1e-6, f'{obj.name} below floor'
        if part['grounded']:
            assert abs(low[2]) < 1e-5, f'{obj.name} lost floor contact'
            grounded.append(obj.name)
        for other in part['supports']:
            witness = overlap_witness(obj, solids[other], deps)
            assert witness, f'{obj.name} detached from {other}'
            contacts[f'{obj.name} / {other}'] = witness
    for part in expected:
        obj = solids[part['name']]
        low, high = point_bounds(chair_surfaces[obj.name][0])
        assert math.dist([high[i]-low[i] for i in range(3)], part['size']) < 1e-5, f'{obj.name} dimensions changed'
        assert math.dist(obj.location, part['center']) < 1e-5, f'{obj.name} center changed'
    assert len(grounded) == 4 and len(contacts) == 12, 'Armchair support coverage changed'
    return {'frame': frame, 'body_inventory': sorted(visible), 'chair_inventory': sorted(solids),
            'excluded_visible_geometry': [], 'body_chair_intersections': [],
            'hip_support': support, 'shoe_floor_clearance': soles,
            'grounded_chair_feet': grounded, 'structural_contacts': contacts}
