"""Complete evaluated body/fixture clearance and actual rounded-floor support."""
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parents[1]/'living'))
from armchair_contact import body_inventory, evaluated_surface, intersection
from shower_pose_geometry import (OMITTED_GARMENT_DETAILS, SHOWER_RENDERED_BODY,
                                 spray_angle, validate_footprint, validate_shower_inventory)
from shower_pose import STEAM_NAMES, WATER_NAMES

SOLIDS = {'Shower arm flange', 'Shower control dial', 'Shower control lever',
          'Shower control plate', 'Shower curved arm', 'Shower drain', 'Shower head',
          'Shower nozzle face', 'Shower rear panel', 'Shower recessed tray',
          'Shower side panel', 'Shower trim corner', 'Shower trim left edge',
          'Shower trim right edge'}
LOWER_CLOTHING = {'Trouser hip bridge', 'Tailored trouser leg', 'Tailored trouser leg.001',
                 'Trouser hem', 'Trouser hem.001', 'Fitted rounded shoe sole',
                 'Fitted rounded shoe sole.001', 'Shaped shoe', 'Shaped shoe.001',
                 'Shoe apron stitch', 'Shoe apron stitch.001'}


def body_source_signature(body):
    result = {}
    for obj in body.all_objects:
        if obj.name not in body_inventory():
            continue
        data = dict(vertices=[list(v.co) for v in obj.data.vertices],
                    polygons=[list(p.vertices) for p in obj.data.polygons],
                    weights=[[(g.group, g.weight) for g in v.groups] for v in obj.data.vertices],
                    groups=[(g.index, g.name) for g in obj.vertex_groups],
                    modifiers=[(m.name, m.type, m.show_viewport, m.show_render,
                                getattr(m, 'use_deform_preserve_volume', None),
                                getattr(m, 'levels', None), getattr(m, 'render_levels', None))
                               for m in obj.modifiers], scale=list(obj.scale))
        result[obj.name] = hashlib.sha256(json.dumps(data, allow_nan=False).encode()).hexdigest()
    if set(result) != body_inventory():
        raise ValueError('Original body geometry/weight inventory changed')
    return result


def water_impact(root, body):
    deps = bpy.context.evaluated_depsgraph_get()
    surfaces = {obj.name:evaluated_surface(obj, deps) for obj in body.all_objects
                if obj.name in SHOWER_RENDERED_BODY}
    axis = Vector((0, -.003, -.006)).normalized()
    nozzle = evaluated_surface(bpy.data.objects['Shower nozzle face'], deps)
    center = bpy.data.objects['Shower nozzle face'].matrix_world.translation
    exit_point, _, _, _ = nozzle[1].ray_cast(center, axis, .02)
    if exit_point is None:
        raise ValueError('No evaluated outward nozzle exit')
    origin = exit_point+axis*.0005
    candidates = []
    for ix in range(-9, 10):
        for iy in range(2, 11):
            direction = Vector((ix*.05, -iy*.05, -1)).normalized()
            angle = spray_angle(direction)
            if angle > 35:
                continue
            hits = []
            for name, surface in surfaces.items():
                point, _, _, distance = surface[1].ray_cast(origin, direction, 1)
                if point is not None:
                    hits.append((distance, name, point))
            if not hits:
                continue
            distance, name, point = min(hits, key=lambda item:item[0])
            if name not in ('Overshirt body', 'Relaxed shirt sleeve', 'Relaxed shirt sleeve.001'):
                continue
            if not 1.18 <= point.z <= 1.36:
                continue
            # Prefer an actual upper-arm shoulder impact, then the upper torso.
            candidates.append((int(name == 'Overshirt body'), abs(abs(point.x)-.23),
                               angle, distance, name, point, direction))
    if not candidates:
        raise ValueError('Forward/down nozzle cone has no unobstructed shoulder or upper-back impact')
    _, _, angle, distance, name, point, direction = min(candidates, key=lambda item:item[:4])
    return dict(origin=list(origin), impact=list(point), body=name,
                nozzle_axis=list(axis), direction=list(direction), length=distance,
                nozzle_axis_angle_degrees=angle,
                nozzle_attachment_gap=nozzle[1].find_nearest(origin)[3],
                impact_surface_gap=surfaces[name][1].find_nearest(point)[3],
                first_rendered_body_hit=True, spray_model='one fixed bounded jet and seven droplets')


def effects_measure(fixtures, deps):
    names = STEAM_NAMES | WATER_NAMES
    for name in names:
        obj = fixtures[name]
        if obj.get('collision_solid') is not False or obj.get('structural_support') is not False:
            raise ValueError('Steam and water must remain non-solid coverage, not support')
        for mat in obj.data.materials:
            if mat.diffuse_color[3] != 1 or any(node.type == 'BSDF_TRANSPARENT' for node in mat.node_tree.nodes):
                raise ValueError('Opaque shower effects material changed')
            for node in mat.node_tree.nodes:
                if node.type == 'VALTORGB' and any(stop.color[3] != 1 for stop in node.color_ramp.elements):
                    raise ValueError('Opaque shower effects ramp changed')
    clouds = {name:evaluated_surface(fixtures[name], deps) for name in sorted(STEAM_NAMES)}
    footprints = {name:validate_footprint([list(p) for p in surface[0]])
                  for name, surface in clouds.items()}
    edges = []
    connected = {next(iter(clouds))}
    for name, surface in clouds.items():
        for other, other_surface in clouds.items():
            if name < other and intersection(surface, other_surface):
                edges.append((name, other))
    while True:
        expanded = connected | {n for edge in edges if set(edge)&connected for n in edge}
        if expanded == connected:
            break
        connected = expanded
    if connected != STEAM_NAMES:
        raise ValueError('Opaque steam lobes do not form continuous coverage')
    jet = fixtures['Shower nozzle attached jet']
    origin, impact = Vector(jet['measured_origin']), Vector(jet['measured_impact'])
    target = evaluated_surface(bpy.data.objects[jet['impact_target']], deps)
    nozzle = evaluated_surface(fixtures['Shower nozzle face'], deps)
    impact_gap = target[1].find_nearest(impact)[3]
    nozzle_gap = nozzle[1].find_nearest(origin)[3]
    angle = spray_angle(impact-origin)
    if nozzle_gap > .001 or impact_gap > .0001 or angle > 35:
        raise ValueError('Modeled jet lost its measured nozzle/shoulder attachment')
    points = [jet.matrix_world@p.co for p in jet.data.splines[0].bezier_points]
    if len(points) != 2 or (points[0]-origin).length > 1e-6 or (points[1]-impact).length > 1e-6:
        raise ValueError('Rendered jet no longer follows measured endpoints')
    return dict(steam=dict(opaque=True, continuous=True, structural_support=False,
                           collision_solid=False, lobes=len(clouds), overlap_edges=edges,
                           complete_lobe_footprints=footprints),
                water=dict(collision_solid=False, structural_support=False,
                           nozzle_attachment_gap=nozzle_gap, impact_surface_gap=impact_gap,
                           nozzle_axis_angle_degrees=angle, body=jet['impact_target'],
                           origin=list(origin), impact=list(impact)))


def clothing_coverage(scene, root, body):
    deps = bpy.context.evaluated_depsgraph_get()
    occluders = {obj.name:evaluated_surface(obj, deps) for obj in root.children_recursive
                 if obj.name in STEAM_NAMES | SOLIDS}
    direction = scene.camera.matrix_world.to_3x3()@Vector((0, 0, 1))
    results = {}
    for obj in body.all_objects:
        if obj.name not in LOWER_CLOTHING:
            continue
        points = evaluated_surface(obj, deps)[0]
        counts, exposed = {}, []
        for point in points:
            hits = []
            for name, surface in occluders.items():
                hit, _, _, distance = surface[1].ray_cast(point+direction*.00001, direction, 10)
                if hit is not None:
                    hits.append((distance, name))
            if hits:
                _, name = min(hits)
                counts[name] = counts.get(name, 0)+1
            else:
                exposed.append(list(point))
        results[obj.name] = dict(evaluated_vertices=len(points), occlusion_counts=counts,
                                 exposed_vertices=len(exposed), exposed_witnesses=exposed[:16])
    if set(results) != LOWER_CLOTHING:
        raise ValueError('Lower-body coverage measurement inventory changed')
    return dict(state='passed' if all(r['exposed_vertices'] == 0 for r in results.values()) else 'failed',
                camera_ray_contract='orthographic toward-camera rays; actual opaque steam or fixture hit',
                lower_clothing=results)


def fixture_signature(root):
    deps = bpy.context.evaluated_depsgraph_get()
    inverse = root.matrix_world.inverted()
    result = {}
    for obj in root.children_recursive:
        if obj.name in SOLIDS:
            surface = evaluated_surface(obj, deps)
            points = [list(inverse@p) for p in surface[0]]
            result[obj.name] = dict(type=obj.type, vertices=len(points),
                evaluated_sha256=hashlib.sha256(json.dumps(points, allow_nan=False).encode()).hexdigest(),
                local_matrix=[list(row) for row in obj.matrix_local])
    return result


def measure(root, rig, body, baseline, require=True, source_body=None):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    visible = {obj.name:obj for obj in body.all_objects if not obj.hide_render}
    original = {obj.name:obj for obj in body.all_objects if obj.name in body_inventory()}
    validate_shower_inventory(original, visible)
    if any(obj.type != 'MESH' for obj in original.values()):
        raise ValueError('Original body contains unhandled geometry')
    if source_body is not None and body_source_signature(body) != source_body:
        raise ValueError('Original body mesh, weights or modifiers changed')
    for name in ('Overshirt body', 'Relaxed shirt sleeve', 'Relaxed shirt sleeve.001'):
        if not original[name].data.materials or any(m.name != 'Warm ochre skin' for m in original[name].data.materials):
            raise ValueError('Shower PG skin material assignment changed')
    fixtures = {obj.name:obj for obj in root.children_recursive if obj.type in ('MESH', 'CURVE')}
    if set(fixtures) != SOLIDS | STEAM_NAMES | WATER_NAMES:
        raise ValueError('Complete shower and coverage inventory changed')
    if any(obj.hide_render for obj in fixtures.values()):
        raise ValueError('Required shower or coverage geometry is hidden')
    if fixture_signature(root) != baseline:
        raise ValueError('Immutable fixture geometry or transforms changed')
    bodies = {name:evaluated_surface(obj, deps) for name, obj in original.items()}
    solids = {name:evaluated_surface(fixtures[name], deps) for name in sorted(SOLIDS)}
    collisions = []
    for name, surface in sorted(bodies.items()):
        for other, solid in solids.items():
            collision = intersection(surface, solid)
            if collision:
                collisions.append(dict(body=name, fixture=other, **collision))
    tray = fixtures['Shower recessed tray'].evaluated_get(deps)
    inverse = tray.matrix_world.inverted()
    soles = {}
    for name in ('Fitted rounded shoe sole', 'Fitted rounded shoe sole.001'):
        points = bodies[name][0]
        try:
            footprint = validate_footprint([list(point) for point in points])
            gaps = []
            for point in points:
                hit, position, _, _ = tray.ray_cast(inverse@Vector((point.x, point.y, 2.1)),
                    inverse.to_3x3()@Vector((0, 0, -1)))
                if not hit or abs((tray.matrix_world@position).z-.055) > 1e-5:
                    raise ValueError('Sole footprint is not above the actual recessed floor')
                gaps.append(point.z-(tray.matrix_world@position).z)
            footprint.update(state='passed', min_z=min(p.z for p in points),
                min_floor_gap=min(gaps), max_floor_gap=max(gaps), actual_floor_rays=len(gaps))
        except ValueError as failure:
            footprint = dict(state='failed', error=str(failure))
        soles[name] = footprint
    errors = {bone.name:abs((bone.tail-bone.head).length-rig.data.bones[bone.name].length)
              for bone in rig.pose.bones}
    clearances = []
    for name in ('Sculpted head', 'HAIR_01_TRIPO_CURL', 'Relaxed shirt sleeve',
                 'Relaxed shirt sleeve.001', 'Forearm with elbow and wrist sections',
                 'Forearm with elbow and wrist sections.001'):
        for fixture in ('Shower curved arm', 'Shower head', 'Shower nozzle face',
                        'Shower rear panel', 'Shower side panel'):
            clearances.append(dict(body=name, fixture=fixture,
                min_vertex_surface_distance=min(solids[fixture][1].find_nearest(p)[3]
                                                for p in bodies[name][0])))
    effects = effects_measure(fixtures, deps)
    result = dict(body_inventory=sorted(visible), fixture_solids=sorted(solids),
        original_collision_body_inventory=sorted(original), omitted_render_details=sorted(OMITTED_GARMENT_DETAILS),
        excluded_non_solid=sorted(STEAM_NAMES | WATER_NAMES), complete_body_solid_pairs=len(bodies)*len(solids),
        retained_body_solid_pairs=len(visible)*len(solids),
        original_54_body_collision_diagnostic=dict(pairs=len(bodies)*len(solids), collisions=collisions),
        rendered_41_body_collision_diagnostic=dict(pairs=len(visible)*len(solids),
            collisions=[c for c in collisions if c['body'] in visible]),
        collisions=collisions, soles=soles, bone_length_errors=errors,
        joint_targets={bone.name:dict(head=list(bone.head), tail=list(bone.tail)) for bone in rig.pose.bones},
        hardware_panel_clearances=clearances, immutable_fixture_signature=baseline,
        **effects, control_hand_contact_claimed=False)
    if not require:
        return result
    if collisions:
        raise ValueError(f'Body intersects immutable shower: {collisions}')
    if any(item['state'] != 'passed' or not .018 <= item['min_floor_gap'] <= .020
           for item in soles.values()):
        raise ValueError('Complete shoes lost rounded-floor support or inherited clearance')
    if len(errors) != 17 or max(errors.values()) > 1e-5:
        raise ValueError('Anatomical bone lengths changed')
    if any(abs(v-1) > 1e-6 for obj in (root, rig) for v in obj.scale):
        raise ValueError('Fixture or body scale changed')
    result['state'] = 'passed'
    return result
