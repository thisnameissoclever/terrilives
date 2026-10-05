"""Apply supported neutral sitting without changing the accepted rig source."""
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE),str(BASE.parent/'sims/sim-01')]
from build_rig import pose, direct_bone, arm_elbow
from pose_profiles import PROFILES, leg_targets


def apply(rig, kind, phase):
    profile = PROFILES[kind]
    pose(rig,'sit',phase)
    offset = Vector((0,profile['hip_y'],profile['z_offset']))
    shift = offset-Vector((0,-.06,-.33))
    torso = {name:(rig.pose.bones[name].head.copy(),rig.pose.bones[name].tail.copy())
             for name in ('hips','spine','head')}
    for name,(head,tail) in torso.items():
        direct_bone(rig,name,head+shift,tail+shift)
    for side,sign in (('L',-1),('R',1)):
        upper_leg = rig.data.bones['thigh.'+side].length
        lower_leg = rig.data.bones['shin.'+side].length
        planned = leg_targets(kind,upper_leg,lower_leg)
        hip,knee,ankle = [Vector((sign*.124,*planned[name])) for name in ('hip','knee','ankle')]
        direct_bone(rig,'thigh.'+side,hip,knee)
        direct_bone(rig,'shin.'+side,knee,ankle)
        pitch = math.radians(profile['foot_pitch'])
        foot = rig.data.bones['foot.'+side]
        direct_bone(rig,'foot.'+side,ankle,
                    ankle+foot.length*Vector((0,-math.cos(pitch),-math.sin(pitch))))
        upper = rig.data.bones['upper_arm.'+side]
        lower = rig.data.bones['forearm.'+side]
        shoulder = upper.head_local+offset
        if kind=='reading':
            wrist = Vector((sign*.155,-.39,.67+.004*math.sin(phase*math.tau)))
            pole = Vector((sign*.18,-.58,.72))
        else:
            wrist = Vector((sign*.205,-.12,.61+.004*math.sin(phase*math.tau)))+shift
            pole = Vector((sign*.5,.02,.68))+shift
        elbow = arm_elbow(shoulder,wrist,upper.length,lower.length,pole)
        direct_bone(rig,'upper_arm.'+side,shoulder,elbow)
        direct_bone(rig,'forearm.'+side,elbow,wrist)
        direct_bone(rig,'hand.'+side,wrist,wrist+Vector((-sign*.018,-.105,-.022)))
    rig['book_visible'] = 0.
    rig['eyes_closed'] = 0.
    bpy.context.view_layer.update()
