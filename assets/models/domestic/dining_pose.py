"""Fit the preserved character to the dining chair's measured seat surface."""
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector, Matrix

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent / 'sims/sim-01')]
from build_rig import direct_bone, arm_elbow
from rig_math import knee_point
from render_dining import set_pose

# The generic pose penetrates this chair's board by .130700886 model units.
# Preserve the accepted body and soles; put the hip underside .0005 above wood.
HIP_OFFSET = Vector((0, -.28, -.1988))
ANKLE = (-.575, .13)
GRIP_OFFSET = Vector((-.02870364, -.08156237, .03415751))
SPOON_LENGTH = .175


def prepare_spoon():
    holder = bpy.data.objects['Eating spoon']
    utensil = next(obj for obj in holder.children if obj.type == 'MESH')
    utensil.rotation_euler = (0, 0, 0)
    for vertex in utensil.data.vertices:
        vertex.co.y += .08
        vertex.co.z -= .02
    holder.rotation_mode = 'QUATERNION'


def mouth_position():
    evaluated = bpy.data.objects['Quiet closed smile'].evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        return sum(points, Vector()) / len(points) + Vector((0, -.055, 0))
    finally:
        evaluated.to_mesh_clear()


def eating_wrist(raised, mouth):
    bowl = Vector((.08, -.67, .835)).lerp(mouth, raised)
    x = .14 - .06 * raised
    lateral = bowl.x - x - GRIP_OFFSET.x
    radius = math.sqrt(SPOON_LENGTH ** 2 - lateral ** 2)
    angle = .35 + (math.pi - .35) * raised
    wrist = Vector((x, bowl.y + radius * math.cos(angle) - GRIP_OFFSET.y,
                    bowl.z + radius * math.sin(angle) - GRIP_OFFSET.z))
    return wrist, bowl


def seated_pose(rig, phase):
    set_pose(rig, 'seated_eat', phase)
    rig['meal_mode'] = 1.
    shift = HIP_OFFSET - Vector((0, -.06, -.33))
    torso = {name: (bone.head.copy(), bone.tail.copy())
             for name in ('hips', 'spine', 'head')
             for bone in (rig.pose.bones[name],)}
    for name, (head, tail) in torso.items():
        direct_bone(rig, name, head + shift, tail + shift)
    mouth = mouth_position()
    raised = (1 - math.cos(phase * math.tau)) / 2
    for side, sign in (('L', -1), ('R', 1)):
        hip = Vector((sign * .124, HIP_OFFSET.y, .86 + HIP_OFFSET.z))
        knee_y, knee_z = knee_point((hip.y, hip.z), ANKLE, .37, .36)
        knee = Vector((sign * .124, knee_y, knee_z))
        ankle = Vector((sign * .124, *ANKLE))
        direct_bone(rig, 'thigh.' + side, hip, knee)
        direct_bone(rig, 'shin.' + side, knee, ankle)
        direct_bone(rig, 'foot.' + side, ankle, ankle + Vector((0, -.14, 0)))
        upper = rig.data.bones['upper_arm.' + side]
        lower = rig.data.bones['forearm.' + side]
        shoulder = upper.head_local + HIP_OFFSET
        wrist, bowl = eating_wrist(raised, mouth) if side == 'R' else (Vector((-.19, -.45, .83)), None)
        elbow = arm_elbow(shoulder, wrist, upper.length, lower.length,
                          Vector((sign * .6, .02, shoulder.z - .2)))
        direct_bone(rig, 'upper_arm.' + side, shoulder, elbow)
        direct_bone(rig, 'forearm.' + side, elbow, wrist)
        direct_bone(rig, 'hand.' + side, wrist, wrist + Vector((-sign * .025, -.09, -.015)))
        if side == 'R':
            grip = rig.pose.bones['hand.R'].matrix @ rig.data.bones['hand.R'].matrix_local.inverted() @ Vector((.303, -.075, .737))
            direction = bowl - grip
            assert abs(direction.length - SPOON_LENGTH) < .0001, 'Eating spoon length changed'
            rotation = Vector((0, 1, 0)).rotation_difference(direction.normalized())
            bpy.data.objects['Eating spoon'].matrix_world = rig.matrix_world @ Matrix.Translation(grip) @ rotation.to_matrix().to_4x4()
