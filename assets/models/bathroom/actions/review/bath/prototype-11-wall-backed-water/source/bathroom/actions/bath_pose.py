"""Support-first bath torso frames; limb fitting follows measured support."""
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parents[1]/'sims/sim-01'))
from build_rig import pose


def recline_rotation(angle):
    return Quaternion((0, 0, 1), math.pi) @ Quaternion((1, 0, 0), -math.radians(angle))


def oriented_bone(rig, name, head, rotation):
    rest = rig.data.bones[name]
    rig.pose.bones[name].matrix = Matrix.Translation(head) @ rotation.to_matrix().to_4x4() @ rest.matrix_local.to_3x3().to_4x4()
    bpy.context.view_layer.update()


def apply_support_frame(rig, hip_y=.35, hip_z=.35, hip_angle=105, back_angle=90, head_angle=65):
    """Keep connected torso joints and full bone roll; do not fit limbs yet."""
    pose(rig, 'idle', 0)
    hip_rotation, back_rotation, head_rotation = [recline_rotation(angle)
                                                for angle in (hip_angle, back_angle, head_angle)]
    hip = Vector((0, hip_y, hip_z))
    shift = hip-hip_rotation@rig.data.bones['hips'].head_local
    oriented_bone(rig, 'root', shift, hip_rotation)
    oriented_bone(rig, 'spine', rig.pose.bones['hips'].tail.copy(), back_rotation)
    head = rig.pose.bones['spine'].head+back_rotation@(
        rig.data.bones['head'].head_local-rig.data.bones['spine'].head_local)
    oriented_bone(rig, 'head', head, head_rotation)
    rig['book_visible'] = 0.
    rig['eyes_closed'] = 0.
    bpy.context.view_layer.update()
    return dict(hip_y=hip_y, hip_z=hip_z, hip_angle=hip_angle, back_angle=back_angle,
                head_angle=head_angle, face_direction=list(head_rotation@Vector((0, -1, 0))),
                head_axis=list(head_rotation@Vector((0, 0, 1))), limbs_fitted=False,
                transform='Full rigid bone frames, connected spine head at hip tail')
