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
from shower_pose import CORE_NAME, STEAM_NAMES, WATER_NAMES
from shower_convex import certify_convex
from shower_cloud_exterior import (EXTERIOR_NAME, MATERIAL_NAME, closed_surface_certificate,
                                   material_spec, validate_exterior_inventory)

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


def effects_measure(fixtures, deps, require_core=True):
    names = STEAM_NAMES | WATER_NAMES | ({CORE_NAME} if require_core else set())
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
    validate_exterior_inventory(clouds)
    footprints = {name:validate_footprint([list(p) for p in surface[0]])
                  for name, surface in clouds.items()}
    exterior = fixtures[EXTERIOR_NAME]
    evaluated = exterior.evaluated_get(deps)
    data = evaluated.to_mesh()
    try:
        data.calc_loop_triangles()
        inverse = exterior.parent.matrix_world.inverted()
        cloud_vertices = [list(inverse@evaluated.matrix_world@v.co) for v in data.vertices]
        cloud_triangles = [list(t.vertices) for t in data.loop_triangles]
    finally:
        evaluated.to_mesh_clear()
    exterior_certificate = closed_surface_certificate(cloud_vertices, cloud_triangles)
    material_records = {}
    for name in STEAM_NAMES | ({CORE_NAME} if require_core else set()):
        obj = fixtures[name]
        if len(obj.data.materials) != 1 or obj.data.materials[0].name != MATERIAL_NAME:
            raise ValueError('Cloud-wide emission material inventory changed')
        mat = obj.data.materials[0]
        node_types = sorted(node.bl_idname for node in mat.node_tree.nodes)
        if node_types != sorted(material_spec()['node_types']) or len(mat.node_tree.links) != 1:
            raise ValueError('Cloud shader restored normal-based solid shading')
        emission = next(n for n in mat.node_tree.nodes if n.type == 'EMISSION')
        output = next(n for n in mat.node_tree.nodes if n.type == 'OUTPUT_MATERIAL')
        link = next(iter(mat.node_tree.links))
        if link.from_node != emission or link.to_node != output or link.to_socket.name != 'Surface':
            raise ValueError('Cloud emission is not the ordinary opaque surface output')
        if emission.inputs['Color'].default_value[3] != 1 or emission.inputs['Strength'].default_value != 1:
            raise ValueError('Cloud opacity/emission strength changed')
        material_records[name] = dict(material=mat.name, shader='constant-emission',
            rgba=list(emission.inputs['Color'].default_value), node_types=node_types,
            normal_based_shading=False, ordinary_opaque_surface=True)
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
    return dict(steam=dict(opaque=True, structural_support=False, collision_solid=False,
                           exterior_inventory=sorted(clouds), exterior_certificate=exterior_certificate,
                           geometry_construction=json.loads(exterior['construction_json']),
                           evaluated_vertices_local=cloud_vertices, evaluated_triangles=cloud_triangles,
                           complete_exterior_footprints=footprints, material_records=material_records,
                           modifiers_evaluated=[dict(name=m.name, type=m.type, show_viewport=m.show_viewport,
                                                    show_render=m.show_render) for m in exterior.modifiers]),
                water=dict(collision_solid=False, structural_support=False,
                           nozzle_attachment_gap=nozzle_gap, impact_surface_gap=impact_gap,
                           nozzle_axis_angle_degrees=angle, body=jet['impact_target'],
                           origin=list(origin), impact=list(impact)))


def core_certificate(root, body, diagnostic=None):
    diagnostic = diagnostic or lower_clothing_diagnostic(root, body)
    obj = bpy.data.objects[CORE_NAME]
    deps = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(deps)
    data = evaluated.to_mesh()
    inverse = root.matrix_world.inverted()
    try:
        data.calc_loop_triangles()
        vertices = [list(inverse@evaluated.matrix_world@v.co) for v in data.vertices]
        triangles = [list(t.vertices) for t in data.loop_triangles]
    finally:
        evaluated.to_mesh_clear()
    points = [p for record in diagnostic['lower_clothing'].values() for p in record['vertices_local']]
    certificate = certify_convex(vertices, triangles, points, obj['required_positive_margin'])
    planes = diagnostic['actual_floor_domain']['outward_planes']
    clearance = min(plane['offset']-sum(a*b for a, b in zip(plane['normal'], p))
                    for p in vertices for plane in planes)
    minimum_z = min(p[2] for p in vertices)
    if clearance <= 0 or not diagnostic['actual_floor_domain']['height'] < minimum_z < min(p[2] for p in points):
        raise ValueError('Protected core lost actual floor-domain clearance or below-sole cap')
    cloud_surfaces = {name:evaluated_surface(bpy.data.objects[name], deps) for name in STEAM_NAMES}
    core_surface = evaluated_surface(obj, deps)
    decorations = {}
    for name, surface in cloud_surfaces.items():
        outside = [p for p in surface[0] if any(sum(a*b for a, b in zip(plane['normal'], inverse@p))
                   > plane['offset']+1e-6 for plane in certificate['plane_inventory'])]
        overlap = intersection(surface, core_surface)
        floor_clearance = min(plane['offset']-sum(a*b for a, b in zip(plane['normal'], inverse@p))
                              for p in surface[0] for plane in planes)
        if not outside or not overlap or floor_clearance <= 0:
            raise ValueError(f'Graphic cloud exterior lost outward/core overlap or actual floor containment: {name}')
        decorations[name] = dict(outward_evaluated_vertices=len(outside), overlaps_protected_core=True,
                                actual_floor_xy_clearance=floor_clearance)
    certificate.update(state='passed', protected=True, collision_solid=False, structural_support=False,
                       actual_floor_xy_clearance=clearance, bottom_z=minimum_z,
                       enclosed_clothing_triangles=diagnostic['total_triangles'],
                       evaluated_vertices_local=vertices, evaluated_triangles=triangles,
                       decorative_outward_exterior=decorations,
                       modifiers_evaluated=[dict(name=m.name, type=m.type, show_viewport=m.show_viewport,
                                                show_render=m.show_render) for m in obj.modifiers])
    return certificate


def clothing_coverage(scene, root, body):
    if scene.camera.data.type != 'ORTHO':
        raise ValueError('Shower coverage requires the accepted orthographic camera')
    deps = bpy.context.evaluated_depsgraph_get()
    occluders = {obj.name:evaluated_surface(obj, deps) for obj in root.children_recursive
                 if obj.name in STEAM_NAMES | SOLIDS | {CORE_NAME}}
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
                                 exposed_vertices=len(exposed), exposed_witnesses=exposed)
    if set(results) != LOWER_CLOTHING:
        raise ValueError('Lower-body coverage measurement inventory changed')
    return dict(state='passed' if all(r['exposed_vertices'] == 0 for r in results.values()) else 'failed',
                camera_ray_contract='orthographic toward-camera rays; actual opaque steam or fixture hit',
                camera_type=scene.camera.data.type, direction_world=list(direction),
                lower_clothing=results)


def lower_clothing_diagnostic(root, body):
    deps = bpy.context.evaluated_depsgraph_get()
    inverse = root.matrix_world.inverted()
    tray = bpy.data.objects['Shower recessed tray'].evaluated_get(deps)
    data = tray.to_mesh()
    try:
        data.calc_loop_triangles()
        floor_points = {tuple((inverse@tray.matrix_world@data.vertices[index].co)[:2])
                        for tri in data.loop_triangles
                        if all(abs((inverse@tray.matrix_world@data.vertices[i].co).z-.055) < 1e-6
                               for i in tri.vertices)
                        for index in tri.vertices}
    finally:
        tray.to_mesh_clear()
    if len(floor_points) < 8:
        raise ValueError('Actual evaluated tray floor polygon was not found')
    ordered = sorted(floor_points)
    def cross(o, a, b):
        return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    halves = []
    for sequence in (ordered, list(reversed(ordered))):
        half = []
        for point in sequence:
            while len(half) >= 2 and cross(half[-2], half[-1], point) <= 0:
                half.pop()
            half.append(point)
        halves += half[:-1]
    planes = []
    for first, second in zip(halves, halves[1:]+halves[:1]):
        edge = Vector((second[0]-first[0], second[1]-first[1], 0))
        normal = Vector((edge.y, -edge.x, 0)).normalized()
        planes.append(dict(normal=list(normal), offset=normal.x*first[0]+normal.y*first[1]))
    result = {}
    all_points = []
    for obj in body.all_objects:
        if obj.name not in LOWER_CLOTHING:
            continue
        evaluated = obj.evaluated_get(deps)
        data = evaluated.to_mesh()
        try:
            data.calc_loop_triangles()
            vertices = [list(inverse@evaluated.matrix_world@v.co) for v in data.vertices]
            triangles = [list(tri.vertices) for tri in data.loop_triangles]
        finally:
            evaluated.to_mesh_clear()
        all_points += vertices
        clearances = [min(plane['offset']-sum(a*b for a, b in zip(plane['normal'], p))
                          for plane in planes) for p in vertices]
        result[obj.name] = dict(vertices_local=vertices, triangles=triangles,
             evaluated_vertex_count=len(vertices), evaluated_triangle_count=len(triangles),
             local_bounds=[[min(p[i] for p in vertices) for i in range(3)],
                           [max(p[i] for p in vertices) for i in range(3)]],
             actual_floor_domain_min_xy_clearance=min(clearances),
             floor_clearance_min_vertex_id=clearances.index(min(clearances)))
    if set(result) != LOWER_CLOTHING:
        raise ValueError('Complete lower-clothing diagnostic inventory changed')
    return dict(lower_clothing=result, actual_floor_domain=dict(height=.055,
                    polygon_xy=[list(p) for p in halves], outward_planes=planes,
                    source='flat evaluated tray floor triangles, before any coverage geometry'),
                complete_lower_bounds=[[min(p[i] for p in all_points) for i in range(3)],
                                       [max(p[i] for p in all_points) for i in range(3)]],
                total_vertices=len(all_points), total_triangles=sum(r['evaluated_triangle_count'] for r in result.values()),
                min_actual_floor_domain_xy_clearance=min(r['actual_floor_domain_min_xy_clearance'] for r in result.values()),
                complete_coordinates_and_triangles_retained=True)


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


def measure(root, rig, body, baseline, require=True, source_body=None, require_core=True):
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
    core_names = {CORE_NAME} if require_core else set()
    if set(fixtures) != SOLIDS | STEAM_NAMES | WATER_NAMES | core_names:
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
    effects = effects_measure(fixtures, deps, require_core)
    result = dict(body_inventory=sorted(visible), fixture_solids=sorted(solids),
        original_collision_body_inventory=sorted(original), omitted_render_details=sorted(OMITTED_GARMENT_DETAILS),
        excluded_non_solid=sorted(STEAM_NAMES | WATER_NAMES | core_names), complete_body_solid_pairs=len(bodies)*len(solids),
        retained_body_solid_pairs=len(visible)*len(solids),
        original_54_body_collision_diagnostic=dict(pairs=len(bodies)*len(solids), collisions=collisions),
        rendered_41_body_collision_diagnostic=dict(pairs=len(visible)*len(solids),
            collisions=[c for c in collisions if c['body'] in visible]),
        collisions=collisions, soles=soles, bone_length_errors=errors,
        joint_targets={bone.name:dict(head=list(bone.head), tail=list(bone.tail)) for bone in rig.pose.bones},
        hardware_panel_clearances=clearances, immutable_fixture_signature=baseline,
        **effects, control_hand_contact_claimed=False)
    if not require_core:
        result['lower_clothing_enclosed'] = dict(state='unproven-lobes-only', diagnostic=True)
    if not require:
        if require_core:
            result['lower_clothing_enclosed'] = core_certificate(root, body)
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
    if require_core:
        result['lower_clothing_enclosed'] = core_certificate(root, body)
    result['state'] = 'passed'
    return result
