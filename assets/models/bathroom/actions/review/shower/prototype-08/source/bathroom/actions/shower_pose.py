"""A shower-specific PG appearance and restrained washing gestures."""
import math
from pathlib import Path
import sys

import bpy
from mathutils import Quaternion, Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE.parents[1]/'sims/sim-01'), str(BASE.parents[1]/'furniture')]
from build_rig import direct_bone, pose
from build_parts import finish, material, mesh, tube
from shower_pose_geometry import OMITTED_GARMENT_DETAILS, STEAM_SHAPES, two_link
from shower_convex import enclosing_prism

STEAM_PREFIX = 'Shower opaque steam lobe '
STEAM_NAMES = {STEAM_PREFIX+str(i+1).zfill(2) for i in range(len(STEAM_SHAPES))}
CORE_NAME = 'Shower protected opaque convex core'
WATER_NAMES = {'Shower nozzle attached jet'} | {
    'Shower water droplet '+str(i+1).zfill(2) for i in range(7)}


def apply_wardrobe(body):
    skin = bpy.data.materials['Warm ochre skin']
    changes = {}
    for name in ('Overshirt body', 'Relaxed shirt sleeve', 'Relaxed shirt sleeve.001'):
        obj = body.objects[name]
        changes[name] = dict(original_materials=[m.name for m in obj.data.materials],
                             shower_material=skin.name)
        for slot in obj.material_slots:
            slot.material = skin
    for name in OMITTED_GARMENT_DETAILS:
        body.objects[name].hide_render = True
    return dict(material_assignments=changes, omitted_render_details=sorted(OMITTED_GARMENT_DETAILS),
                preserved_geometry_weights=True, explicit_anatomy_added=False)


def apply(rig, phase=0, hip_z=.86, ankle_z=.185, lean_degrees=20):
    pose(rig, 'idle', 0)
    offset = Vector((.015, -.15, hip_z-.86))
    pivot = Vector((0, 0, 1.03))+offset
    lean = Quaternion((1, 0, 0), math.radians(lean_degrees))
    def torso(point):
        return pivot+lean@(point+offset-pivot)
    for name in ('hips', 'spine', 'head'):
        rest = rig.data.bones[name]
        direct_bone(rig, name, torso(rest.head_local), torso(rest.tail_local))
    head = rig.data.bones['head']
    head_direction = Quaternion((1, 0, 0), math.radians(-4))
    direct_bone(rig, 'head', torso(head.head_local),
                torso(head.head_local)+lean@head_direction@(head.tail_local-head.head_local))
    for side, sign in (('L', -1), ('R', 1)):
        thigh, shin, foot = [rig.data.bones[name+'.'+side] for name in ('thigh', 'shin', 'foot')]
        hip = torso(thigh.head_local)
        ankle = Vector((sign*.124+.015, .025, ankle_z))
        knee = Vector(two_link(hip, ankle, thigh.length, shin.length,
                               (hip.x, -.5, .5)))
        direct_bone(rig, 'thigh.'+side, hip, knee)
        direct_bone(rig, 'shin.'+side, knee, ankle)
        direct_bone(rig, 'foot.'+side, ankle, ankle+Vector((0, -foot.length, 0)))
        upper, lower, hand = [rig.data.bones[name+'.'+side] for name in ('upper_arm', 'forearm', 'hand')]
        shoulder = torso(upper.head_local)
        sway = .006*math.sin(phase*math.tau)
        wrist = Vector((.17, -.31, 1.31+sway) if side == 'L'
                       else (.205, -.445, 1.47+sway))
        elbow = Vector(two_link(shoulder, wrist, upper.length, lower.length,
                                (sign*.34+.015, -.29, 1.07)))
        direct_bone(rig, 'upper_arm.'+side, shoulder, elbow)
        direct_bone(rig, 'forearm.'+side, elbow, wrist)
        direction = Vector((.06, .045, .035) if side == 'L' else (-.035, .03, .085)).normalized()
        direct_bone(rig, 'hand.'+side, wrist, wrist+direction*hand.length)
    rig['book_visible'] = 0.
    rig['eyes_closed'] = 0.
    bpy.context.view_layer.update()


def ellipsoid(name, center, radii, mat, root):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, location=center)
    obj = bpy.context.object
    obj.scale = radii
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(obj, name, mat, root)
    obj['collision_solid'] = False
    obj['structural_support'] = False
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def build_steam(root):
    mat = material('Shower opaque cool off-white steam', (.72, .79, .81))
    return [ellipsoid(STEAM_PREFIX+str(i+1).zfill(2), center, radii, mat, root)
            for i, (center, radii) in enumerate(STEAM_SHAPES)]


def build_core(root, diagnostic):
    points = [p for record in diagnostic['lower_clothing'].values() for p in record['vertices_local']]
    vertices, triangles, proposal = enclosing_prism(points,
        diagnostic['actual_floor_domain']['outward_planes'], diagnostic['actual_floor_domain']['height'])
    mat = bpy.data.materials['Shower opaque cool off-white steam']
    obj = mesh(CORE_NAME, vertices, triangles, mat, root)
    obj['collision_solid'] = False
    obj['structural_support'] = False
    obj['required_positive_margin'] = proposal['required_margin']
    obj['protected_enclosing_core'] = True
    return proposal


def build_water(root, impact):
    mat = material('Shower restrained blue water', (.40, .64, .73))
    start, end = Vector(impact['origin']), Vector(impact['impact'])
    jet = tube('Shower nozzle attached jet', [start, end], .006, mat, root)
    jet['collision_solid'] = False
    jet['structural_support'] = False
    jet['impact_target'] = impact['body']
    jet['measured_origin'] = list(start)
    jet['measured_impact'] = list(end)
    jet['spray_angle_degrees'] = impact['nozzle_axis_angle_degrees']
    direction = (end-start).normalized()
    for i, t in enumerate((.12, .25, .39, .52, .65, .79, .92)):
        drop = ellipsoid('Shower water droplet '+str(i+1).zfill(2), start.lerp(end, t),
                         (.010, .010, .017), mat, root)
        drop.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    return jet
