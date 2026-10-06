"""Neutral clothed toilet idle fitted to the accepted open seat."""
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parents[1]/'sims/sim-01'))
from build_rig import direct_bone, pose
from toilet_pose_geometry import knee_first, two_link


def apply(rig, hip_z=.55, hip_y=-.16, phase=0):
    pose(rig, 'idle', 0)
    offset = Vector((0, hip_y, hip_z-.86))
    for name in ('hips', 'spine', 'head'):
        rest = rig.data.bones[name]
        direct_bone(rig, name, rest.head_local+offset, rest.tail_local+offset)
    for side, sign in (('L', -1), ('R', 1)):
        hip = Vector((sign*.124, hip_y, hip_z))
        thigh, shin, foot = [rig.data.bones[name+'.'+side] for name in ('thigh', 'shin', 'foot')]
        planned = knee_first(hip_y, hip_z, thigh.length, shin.length, lateral_delta=.035)
        knee = Vector((sign*.159, *planned['knee']))
        ankle = Vector((sign*.159, *planned['ankle']))
        direct_bone(rig, 'thigh.'+side, hip, knee)
        direct_bone(rig, 'shin.'+side, knee, ankle)
        pitch = math.radians(8.2023)
        direct_bone(rig, 'foot.'+side, ankle,
                    ankle+foot.length*Vector((0, -math.cos(pitch), -math.sin(pitch))))
        upper, lower, hand = [rig.data.bones[name+'.'+side] for name in ('upper_arm', 'forearm', 'hand')]
        shoulder = upper.head_local+offset
        wrist = Vector((sign*.18, -.32, .66+.003*math.sin(phase*math.tau)))
        elbow = Vector(two_link(shoulder, wrist, upper.length, lower.length,
                               (sign*.50, -.05, hip_z+.20)))
        direct_bone(rig, 'upper_arm.'+side, shoulder, elbow)
        direct_bone(rig, 'forearm.'+side, elbow, wrist)
        direction = Vector((-sign*.018, -.105, -.022)).normalized()
        direct_bone(rig, 'hand.'+side, wrist, wrist+direction*hand.length)
    rig['book_visible'] = 0.
    rig['eyes_closed'] = 0.
    bpy.context.view_layer.update()
