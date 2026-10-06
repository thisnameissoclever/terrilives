"""Measure complete body clearance and disjoint evaluated seat support."""
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parents[1]/'living'))
from armchair_contact import body_inventory, evaluated_surface, intersection
from toilet_pose_geometry import knee_first, on_ring, sole_ankle_height, validate_patches

SOLIDS = {'Toilet recessed bowl', 'Toilet open seat ring', 'Toilet pedestal',
          'Toilet rear ceramic neck', 'Toilet upper tank support', 'Toilet cistern',
          'Toilet cistern cap', 'Toilet flush button', 'Toilet seat bumper -1',
          'Toilet seat bumper 1', 'Toilet hinge mount -1', 'Toilet hinge mount 1',
          'Toilet hinge axle', 'Toilet upright lid'}


def modifier_inventory(obj):
    result = []
    for modifier in obj.modifiers:
        item = dict(name=modifier.name, type=modifier.type,
                    show_render=modifier.show_render, show_viewport=modifier.show_viewport)
        if modifier.type == 'ARMATURE':
            item.update(rig=modifier.object.name if modifier.object else None,
                        use_deform_preserve_volume=modifier.use_deform_preserve_volume,
                        use_vertex_groups=modifier.use_vertex_groups,
                        use_bone_envelopes=modifier.use_bone_envelopes,
                        deformation_mode='dual-quaternion' if modifier.use_deform_preserve_volume
                        else 'linear-blend-skinning')
        for field in ('levels', 'render_levels', 'width', 'segments'):
            if hasattr(modifier, field):
                item[field] = getattr(modifier, field)
        result.append(item)
    return result


def triangle_diagnostics(obj, surface, triangle_ids, deps):
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    try:
        mesh.calc_loop_triangles()
        if len(mesh.vertices) != len(surface[0]):
            raise ValueError('Collision vertex count differs from evaluated diagnostics')
        identifiers = sorted(set(triangle_ids))
        if not all(0 <= index < len(mesh.loop_triangles) for index in identifiers):
            raise ValueError('BVH triangle ID is outside the evaluated triangle inventory')
        vertices = sorted({index for triangle_id in identifiers
                           for index in mesh.loop_triangles[triangle_id].vertices})
        modifiers = modifier_inventory(obj)
        topology_preserving = {'ARMATURE', 'WEIGHTED_NORMAL', 'NORMAL_EDIT', 'SMOOTH',
                               'CORRECTIVE_SMOOTH', 'LAPLACIANSMOOTH', 'DISPLACE',
                               'SIMPLE_DEFORM', 'CAST', 'SHRINKWRAP'}
        matching = len(mesh.vertices) == len(obj.data.vertices) and all(
            not m['show_viewport'] or m['type'] in topology_preserving for m in modifiers)
        groups = {group.index:group.name for group in obj.vertex_groups}
        def original(vertex):
            weights = {groups[group.group]:group.weight for group in vertex.groups}
            return dict(vertex_id=vertex.index, mesh_coordinates=list(vertex.co),
                        weights=weights, weight_sum=sum(weights.values()))
        return dict(evaluated_vertex_count=len(mesh.vertices),
                    original_vertex_count=len(obj.data.vertices),
                    evaluated_triangle_count=len(mesh.loop_triangles),
                    original_polygon_count=len(obj.data.polygons), modifiers=modifiers,
                    correspondence_state='index-preserved' if matching else 'unproven-topology-change',
                    correspondence_limit=None if matching else
                    'Final modifier topology differs or is not proven index-preserving; no original vertex is assigned to an evaluated vertex.',
                    triangles=[dict(triangle_id=index,
                                    evaluated_vertex_ids=list(mesh.loop_triangles[index].vertices),
                                    world_coordinates=[list(surface[0][v]) for v in mesh.loop_triangles[index].vertices])
                               for index in identifiers],
                    evaluated_vertices=[dict(vertex_id=index, world_coordinates=list(surface[0][index]),
                                             original=original(obj.data.vertices[index]) if matching else None)
                                        for index in vertices],
                    original_vertices=[original(vertex) for vertex in obj.data.vertices])
    finally:
        evaluated.to_mesh_clear()


def shoe_pitch_diagnostics(rig, bodies):
    result = []
    for side, suffix in (('L', ''), ('R', '.001')):
        name = 'Fitted rounded shoe sole'+suffix
        obj = bpy.data.objects[name]
        group_names = {group.index:group.name for group in obj.vertex_groups}
        for vertex in obj.data.vertices:
            weights = [(group_names[g.group], g.weight) for g in vertex.groups if g.weight > 1e-8]
            if len(weights) != 1 or weights[0][0] != 'foot.'+side or abs(weights[0][1]-1) > 1e-6:
                raise ValueError('Sole is not a completely rigid single-foot attachment')
        rest = rig.data.bones['foot.'+side]
        posed = rig.pose.bones['foot.'+side]
        deform = rig.matrix_world@posed.matrix@rest.matrix_local.inverted()
        inverse = deform.inverted()
        points = [list(inverse@point-rest.head_local) for point in bodies[name][0]]
        hip = rig.pose.bones['thigh.'+side].head
        upper = rig.data.bones['thigh.'+side].length
        lower = rig.data.bones['shin.'+side].length
        pitches = []
        for pitch in (0, 8.2023, 16.4, 24):
            ankle_z = sole_ankle_height(points, pitch)
            candidate = dict(pitch_degrees=pitch, derived_ankle_z=ankle_z,
                             exact_vertical_knee_ceiling=ankle_z+lower,
                             reserved_knee_z=ankle_z+lower-.001,
                             simulated_sole_clearance=.019148, fit_evaluated=False)
            try:
                planned = knee_first(hip.y, hip.z, upper, lower, ankle_z=ankle_z, lateral_delta=.035)
                candidate.update(reachable=True,
                                 hip=[hip.x, hip.y, hip.z],
                                 knee=[(-1 if side == 'L' else 1)*.159, *planned['knee']],
                                 ankle=[(-1 if side == 'L' else 1)*.159, *planned['ankle']])
            except ValueError as failure:
                candidate.update(reachable=False, error=str(failure))
            pitches.append(candidate)
        result.append(dict(side=side, sole=name, vertex_count=len(points),
                           rigid_foot_weights_verified=True, relative_vertices=points,
                           pitches=pitches, modifiers=modifier_inventory(obj)))
    return result


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
    patches = None
    for x, y in sorted(near, key=lambda point: (-abs(point[0]), point[1])):
        if x < .08:
            continue
        pair = [[near.get((round(side*(x-ix*.003), 6), round(y+iy*.003, 6)))
                 for ix in range(7) for iy in range(16)] for side in (-1, 1)]
        if all(p is not None and abs(p['x']) >= .08 for patch in pair for p in patch):
            patches = pair
            break
    if patches is None:
        raise ValueError('No mirrored finite non-penetrating ring support patches')
    measured = validate_patches([[(p['x'], p['y'], p['seat_z']) for p in patch] for patch in patches])
    for result, patch in zip(measured, patches):
        result.update(min_gap=min(p['gap'] for p in patch), max_gap=max(p['gap'] for p in patch),
                      evaluated_witnesses=patch)
    return measured


def hand_clothing_proximity(bodies):
    result = []
    for side, suffix in (('L', ''), ('R', '.001')):
        for hand_name in ('Relaxed palm'+suffix, 'Resting thumb'+suffix):
            hand = bodies[hand_name]
            for clothing_name in ('Trouser hip bridge', 'Tailored trouser leg', 'Tailored trouser leg.001'):
                clothing = bodies[clothing_name]
                distances = [clothing[1].find_nearest(p)[3] for p in hand[0]]
                result.append(dict(side=side, hand=hand_name, clothing=clothing_name,
                                   min_surface_distance=min(distances), max_surface_distance=max(distances),
                                   intersection=intersection(hand, clothing)))
    return result


def measure(root, rig, body, require=True, diagnostics=False):
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
                record = dict(body=name, fixture=other, ring_band_vertices=witnesses, **collision)
                if diagnostics:
                    pairs = surface[1].overlap(solid[1])
                    record.update(exact_evaluated_triangle_pairs=[list(pair) for pair in pairs],
                                  body_triangles=triangle_diagnostics(visible[name], surface, [p[0] for p in pairs], deps),
                                  fixture_triangles=triangle_diagnostics(fixtures[other], solid, [p[1] for p in pairs], deps))
                collisions.append(record)
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
                  bone_length_errors=errors, complete_body_solid_pairs=len(bodies)*len(solids),
                  hand_clothing_proximity=hand_clothing_proximity(bodies),
                  joint_targets={bone.name:dict(head=list(bone.head), tail=list(bone.tail))
                                 for bone in rig.pose.bones})
    try:
        result['ring_support_patches'] = support_patches(grid)
        result['independent_ring_support'] = dict(state='passed', mirrored_planar_bounds=True)
    except ValueError as failure:
        result['independent_ring_support'] = dict(state='failed', error=str(failure),
                                                  near_witness_counts={str(side):sum(
                                                      0 <= p['gap'] <= .01 and side*p['x'] >= .08
                                                      for p in grid) for side in (-1, 1)})
    if diagnostics:
        result['actual_ring_grid'] = grid
        result['shoe_pitch_analysis'] = shoe_pitch_diagnostics(rig, bodies)
        result['complete_body_modifiers'] = {name:modifier_inventory(obj) for name, obj in sorted(visible.items())}
        result['pose_changed_for_pitch_analysis'] = False
    if not require:
        return result
    if collisions:
        raise ValueError(f'Body intersects fixture: {collisions}')
    hand_crossings = [p for p in result['hand_clothing_proximity'] if p['intersection']]
    if hand_crossings:
        raise ValueError(f'Hand intersects trouser clothing: {hand_crossings}')
    if not 0 <= result['ring_min_gap'] <= .003:
        raise ValueError('Hip lost actual open-ring support')
    if result['independent_ring_support']['state'] != 'passed':
        raise ValueError(result['independent_ring_support']['error'])
    if len(errors) != 17 or max(errors.values()) > 1e-5:
        raise ValueError('Anatomical bone lengths changed')
    if any(not .018 <= value['min_z'] <= .020 for value in soles.values()):
        raise ValueError('Actual shoe sole clearance changed')
    if any(abs(v-1) > 1e-6 for obj in (rig, root) for v in obj.scale):
        raise ValueError('Body or toilet object scale changed')
    result['state'] = 'passed'
    return result
