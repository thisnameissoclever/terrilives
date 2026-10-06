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
from shower_pose_geometry import validate_footprint

SOLIDS = {'Shower arm flange', 'Shower control dial', 'Shower control lever',
          'Shower control plate', 'Shower curved arm', 'Shower drain', 'Shower head',
          'Shower nozzle face', 'Shower rear panel', 'Shower recessed tray',
          'Shower side panel', 'Shower trim corner', 'Shower trim left edge',
          'Shower trim right edge'}
STEAM = 'Shower opaque steam coverage'


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


def measure(root, rig, body, baseline, require=True):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    visible = {obj.name:obj for obj in body.all_objects if not obj.hide_render}
    if set(visible) != body_inventory() or any(obj.type != 'MESH' for obj in visible.values()):
        raise ValueError('Complete visible body inventory changed')
    fixtures = {obj.name:obj for obj in root.children_recursive if obj.type in ('MESH', 'CURVE')}
    if set(fixtures) != SOLIDS | {STEAM}:
        raise ValueError('Complete shower and coverage inventory changed')
    if any(obj.hide_render for obj in fixtures.values()):
        raise ValueError('Required shower or coverage geometry is hidden')
    if fixture_signature(root) != baseline:
        raise ValueError('Immutable fixture geometry or transforms changed')
    steam = fixtures[STEAM]
    if steam.get('collision_solid') is not False or steam.get('structural_support') is not False:
        raise ValueError('Steam must remain non-solid coverage, not support')
    bodies = {name:evaluated_surface(obj, deps) for name, obj in visible.items()}
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
    coverage = evaluated_surface(steam, deps)
    coverage_footprint = validate_footprint([list(p) for p in coverage[0]])
    result = dict(body_inventory=sorted(visible), fixture_solids=sorted(solids),
        excluded_non_solid=[STEAM], complete_body_solid_pairs=len(bodies)*len(solids),
        collisions=collisions, soles=soles, bone_length_errors=errors,
        joint_targets={bone.name:dict(head=list(bone.head), tail=list(bone.tail)) for bone in rig.pose.bones},
        hardware_panel_clearances=clearances, immutable_fixture_signature=baseline,
        steam=dict(opaque=True, structural_support=False, collision_solid=False,
                   footprint=coverage_footprint), control_hand_contact_claimed=False)
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
