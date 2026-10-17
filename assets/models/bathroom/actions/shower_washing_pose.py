"""A continuous washing cycle for the shower pose.

`shower_pose.py` is a pinned input of the shipped bath loop (the receipt in
`export/bath-05/source-proof.json` records its hash), so it cannot change
until the bath is exported again. This module carries the washing cycle
that pull request 259 wrote into that file, unchanged. The character
creator's shower clip (`sims/character-creator/clips/clips.json`) was
exported from this cycle through `source_adapters.py`, which imports it
from here; the shower atlas art has not been rendered from it yet.
"""
import math
from pathlib import Path
import sys

import bpy
from mathutils import Quaternion, Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE.parents[1]/'sims/sim-01'), str(BASE.parents[1]/'furniture')]
from build_rig import direct_bone, pose
from shower_pose_geometry import two_link


def apply(rig, phase=0, hip_z=.86, ankle_z=.185, lean_degrees=20):
    pose(rig, 'idle', 0)
    angle = phase*math.tau
    offset = Vector((.015+.018*math.sin(angle), -.15, hip_z-.86))
    pivot = Vector((0, 0, 1.03))+offset
    lean = Quaternion((1, 0, 0), math.radians(lean_degrees+4*math.sin(angle)))
    def torso(point):
        return pivot+lean@(point+offset-pivot)
    for name in ('hips', 'spine', 'head'):
        rest = rig.data.bones[name]
        direct_bone(rig, name, torso(rest.head_local), torso(rest.tail_local))
    head = rig.data.bones['head']
    head_direction = Quaternion((1, 0, 0), math.radians(-4+5*math.sin(angle-math.pi/3)))
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
        washing = Vector((-.18+.12*math.sin(angle), -.30, 1.17+.16*math.cos(angle)) if side == 'L'
                         else (.20+.08*math.cos(angle), -.30, 1.34+.16*math.sin(angle)))
        wrist = torso(washing)
        elbow = Vector(two_link(shoulder, wrist, upper.length, lower.length,
                                (sign*.34+.015, -.29, 1.07)))
        direct_bone(rig, 'upper_arm.'+side, shoulder, elbow)
        direct_bone(rig, 'forearm.'+side, elbow, wrist)
        direction = Vector((.06, .045, .035) if side == 'L' else (-.035, .03, .085)).normalized()
        direct_bone(rig, 'hand.'+side, wrist, wrist+direction*hand.length)
    rig['book_visible'] = 0.
    rig['eyes_closed'] = 0.
    bpy.context.view_layer.update()
