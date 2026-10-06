"""Actual rear-body and basin support measurements before bath limb fitting."""
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parents[1]/'living'))
from armchair_contact import body_inventory, evaluated_surface, intersection
from bath_pose_geometry import basin_contains, validate_support_patch

SOLIDS = {'Bathtub continuous shell', 'Bathtub curved spout', 'Bathtub drain',
          'Bathtub inset plinth', 'Bathtub overflow', 'Bathtub tap foot',
          'Bathtub tap base -0.135', 'Bathtub tap base 0.135',
          'Bathtub tap stem -0.135', 'Bathtub tap stem 0.135',
          'Bathtub tap handle -0.135', 'Bathtub tap handle 0.135'}


def rear_query_surface(obj, rig, bone_name, low_z, high_z, deps):
    groups = {group.index:group.name for group in obj.vertex_groups}
    if any(len(vertex.groups) != 1 or groups[vertex.groups[0].group] != bone_name
           or abs(vertex.groups[0].weight-1) > 1e-6 for vertex in obj.data.vertices):
        raise ValueError('Support query requires a verified rigid single-bone body surface')
    deform = rig.matrix_world@rig.pose.bones[bone_name].matrix@rig.data.bones[bone_name].matrix_local.inverted()
    inverse = deform.inverted()
    evaluated = obj.evaluated_get(deps)
    data = evaluated.to_mesh()
    try:
        data.calc_loop_triangles()
        points = [evaluated.matrix_world@v.co for v in data.vertices]
        triangles, retained = [], []
        for index, tri in enumerate(data.loop_triangles):
            original = [inverse@points[v] for v in tri.vertices]
            if not all(low_z <= p.z <= high_z and p.y >= .025 for p in original):
                continue
            a, b, c = [points[v] for v in tri.vertices]
            normal = (b-a).cross(c-a).normalized()
            if normal.z >= -.10:
                continue
            triangles.append(tuple(tri.vertices))
            retained.append(dict(triangle_id=index, world_vertices=[list(p) for p in (a, b, c)],
                                 rest_vertices=[list(p) for p in original], world_normal=list(normal)))
    finally:
        evaluated.to_mesh_clear()
    if not triangles:
        raise ValueError('No evaluated rear support triangles in the declared anatomical region')
    selected = [points[v] for tri in triangles for v in tri]
    return BVHTree.FromPolygons(points, triangles, all_triangles=True), selected, retained


def support_grid(obj, rig, bone_name, rest_window, shell, deps):
    tree, selected, triangles = rear_query_surface(obj, rig, bone_name, *rest_window, deps)
    surface = shell.evaluated_get(deps)
    inverse = surface.matrix_world.inverted()
    step = .006
    xs = range(math.ceil(min(p.x for p in selected)/step), math.floor(max(p.x for p in selected)/step)+1)
    ys = range(math.ceil(min(p.y for p in selected)/step), math.floor(max(p.y for p in selected)/step)+1)
    grid = []
    for ix in xs:
        for iy in ys:
            x, y = round(ix*step, 6), round(iy*step, 6)
            hit, basin, normal, _ = surface.ray_cast(inverse@Vector((x, y, 1.5)),
                inverse.to_3x3()@Vector((0, 0, -1)))
            if not hit:
                continue
            basin = surface.matrix_world@basin
            if basin.z >= .56 or not basin_contains(x, y, max(.15, basin.z)):
                continue
            body, body_normal, _, _ = tree.ray_cast(Vector((x, y, -.2)), Vector((0, 0, 1)), 2)
            if body is None:
                continue
            grid.append(dict(x=x, y=y, body_z=body.z, basin_z=basin.z, gap=body.z-basin.z,
                             actual_basin_normal=list(normal), actual_body_normal=list(body_normal)))
    if not grid:
        raise ValueError('No actual rear-body to inner-basin ray hits')
    near = {(p['x'], p['y']):p for p in grid if 0 <= p['gap'] <= .01}
    patch = None
    for x, y in sorted(near, key=lambda key:near[key]['gap']):
        proposed = [near.get((round(x+i*step, 6), round(y+j*step, 6))) for i in range(7) for j in range(9)]
        if all(p is not None for p in proposed):
            patch = validate_support_patch(proposed)
            break
    return dict(body=obj.name, anatomical_region=dict(bone=bone_name, source_z_window=list(rest_window),
                source_rear_y_min=.025, gravity_facing_normal_z_max=-.10),
                grid_step=step, actual_surface_ray_hits=len(grid), min_gap=min(p['gap'] for p in grid),
                max_gap=max(p['gap'] for p in grid), finite_patch=patch,
                complete_actual_grid=grid, evaluated_rear_query_triangles=triangles,
                state='passed' if patch is not None and 0 <= min(p['gap'] for p in grid) <= .003 else 'failed')


def measure_support(root, rig, body):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    visible = {obj.name:obj for obj in body.all_objects if not obj.hide_render}
    if set(visible) != body_inventory() or any(obj.type != 'MESH' for obj in visible.values()):
        raise ValueError('Original 54-object body diagnostic inventory changed')
    fixtures = {obj.name:obj for obj in root.children_recursive if obj.type in ('MESH', 'CURVE')}
    if set(fixtures) != SOLIDS or any(obj.hide_render for obj in fixtures.values()):
        raise ValueError('Complete immutable twelve-solid bath fixture inventory changed')
    shell = fixtures['Bathtub continuous shell']
    support = {}
    for label, name, bone, window in (('hip', 'Trouser hip bridge', 'hips', (.76, .97)),
                                     ('back', 'Overshirt body', 'spine', (1.12, 1.31))):
        support[label] = support_grid(visible[name], rig, bone, window, shell, deps)
    surfaces = {name:evaluated_surface(obj, deps) for name, obj in fixtures.items()}
    collisions = []
    for name in ('Trouser hip bridge', 'Overshirt body'):
        surface = evaluated_surface(visible[name], deps)
        for other, fixture in surfaces.items():
            witness = intersection(surface, fixture)
            if witness:
                collisions.append(dict(body=name, fixture=other, **witness))
    errors = {bone.name:abs((bone.tail-bone.head).length-rig.data.bones[bone.name].length) for bone in rig.pose.bones}
    if len(errors) != 17 or max(errors.values()) > 1e-5 or any(abs(v-1) > 1e-6 for obj in (root, rig) for v in obj.scale):
        raise ValueError('Bath support frame changed anatomical lengths or scale')
    return dict(support=support, hip_back_fixture_collisions=collisions, bone_length_errors=errors,
                original_body_inventory=sorted(visible), fixture_solids=sorted(fixtures),
                full_body_clearance_certified=False, limbs_fitted=False, water_present=False,
                support_state='passed' if not collisions and all(r['state']=='passed' for r in support.values()) else 'failed',
                joint_targets={bone.name:dict(head=list(bone.head), tail=list(bone.tail)) for bone in rig.pose.bones})
