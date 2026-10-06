"""A restrained clothed wash stance with a forward torso lean."""
import math
from pathlib import Path
import sys

import bpy
from mathutils import Quaternion, Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE.parents[1]/'sims/sim-01'), str(BASE.parents[1]/'furniture')]
from build_rig import direct_bone, pose
from build_parts import material, mesh
from shower_pose_geometry import two_link


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
        wrist = Vector((sign*.13+.015, -.295,
                        (1.32 if side == 'R' else 1.15)+sway))
        elbow = Vector(two_link(shoulder, wrist, upper.length, lower.length,
                                (sign*.34+.015, -.20, 1.07)))
        direct_bone(rig, 'upper_arm.'+side, shoulder, elbow)
        direct_bone(rig, 'forearm.'+side, elbow, wrist)
        direction = Vector((-sign*.015, -.025, .09)).normalized()
        direct_bone(rig, 'hand.'+side, wrist, wrist+direction*hand.length)
    rig['book_visible'] = 0.
    rig['eyes_closed'] = 0.
    bpy.context.view_layer.update()


def build_steam(root):
    mat = material('Shower opaque pale steam coverage', (.78, .84, .83))
    profiles = ((.079, .28), (.22, .35), (.55, .35), (.90, .34),
                (1.10, .32), (1.29, .28), (1.39, .18), (1.42, .035))
    columns = 64
    vertices = []
    for row, (z, radius) in enumerate(profiles):
        for i in range(columns):
            angle = math.tau*i/columns
            r = radius+.007*math.sin(7*angle+row*.65)
            vertices.append((r*math.cos(angle), r*math.sin(angle), z))
    faces = [tuple(reversed(range(columns)))]
    faces += [(row*columns+i, row*columns+(i+1)%columns,
               (row+1)*columns+(i+1)%columns, (row+1)*columns+i)
              for row in range(len(profiles)-1) for i in range(columns)]
    faces.append(tuple(range((len(profiles)-1)*columns, len(profiles)*columns)))
    obj = mesh('Shower opaque steam coverage', vertices, faces, mat, root)
    obj['collision_solid'] = False
    obj['structural_support'] = False
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj
