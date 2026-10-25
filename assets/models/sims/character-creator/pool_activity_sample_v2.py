"""Own the evaluated sample boundary and equivalent root-local pelvis placement."""
import bpy
import math
from mathutils import Matrix, Vector, Quaternion
import pool_activity_pose_v1 as reference


def reset_sample(rig):
    rig.matrix_world = Matrix.Identity(4)
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def sample_reference(rig, phase, paddle=0.):
    reset_sample(rig)
    return reference.apply(rig, phase, paddle)


def normalize_pelvis_placement(rig):
    root, hips = rig.pose.bones['root'], rig.pose.bones['hips']
    if root.parent is not None or hips.parent != root:
        raise ValueError('Pool pelvis placement requires the unchanged root/hips hierarchy')
    # Wroot * Lhips * Thips becomes Wroot * T(Lhips.rotation * hips.location) * Lhips.
    # Root basis axes must also participate when expressing that translation in its parent frame.
    local_hips = rig.data.bones['root'].matrix_local.inverted() @ rig.data.bones['hips'].matrix_local
    displacement = root.matrix_basis.to_3x3() @ (local_hips.to_3x3() @ hips.location)
    root.location = root.location + displacement
    hips.location = Vector((0, 0, 0))
    bpy.context.view_layer.update()


def capture_channels(rig):
    result = {}
    for bone in rig.pose.bones:
        if bone.rotation_mode != 'QUATERNION':
            raise ValueError('Pool raw channel interpolation requires the actual quaternion convention')
        result[bone.name] = {'location': tuple(bone.location), 'quaternion': tuple(bone.rotation_quaternion), 'scale': tuple(bone.scale)}
    return result


def restore_channels(bone, channels):
    bone.location = Vector(channels['location'])
    bone.rotation_quaternion = Quaternion(channels['quaternion'])
    bone.scale = Vector(channels['scale'])


def realize_neutral_channels(rig, basis):
    original = capture_channels(rig)
    reset_sample(rig)
    for bone in rig.pose.bones:
        values = basis[bone.name]
        bone.matrix_basis = Matrix([[values[column * 4 + row] for column in range(4)] for row in range(4)])
    bpy.context.view_layer.update()
    target = capture_channels(rig)
    for bone in rig.pose.bones:
        restore_channels(bone, original[bone.name])
    bpy.context.view_layer.update()
    return target


def blend_scalar(left, right, weight):
    return left + (right - left) * weight if weight <= .5 else right + (left - right) * (1 - weight)


def blend_quaternion(left, right, weight):
    if weight == 0 or left == right:
        return left
    if weight == 1:
        return right
    a, b = math.hypot(*left), math.hypot(*right)
    if a == 0 or b == 0:
        raise ValueError('Pool inherited quaternion endpoint is singular')
    u, v = [value / a for value in left], [value / b for value in right]
    dot = math.fsum(x * y for x, y in zip(u, v))
    sine = math.hypot(*(y - dot * x for x, y in zip(u, v)))
    if sine == 0:
        if dot <= 0:
            raise ValueError('Pool inherited quaternion endpoints are antipodal')
        return tuple(blend_scalar(x, y, weight) for x, y in zip(left, right))
    angle, magnitude = math.atan2(sine, dot), blend_scalar(a, b, weight)
    first = math.sin((1 - weight) * angle) / sine * magnitude / a
    second = math.sin(weight * angle) / sine * magnitude / b
    return tuple(first * x + second * y for x, y in zip(left, right))


def blend_channels(left, right, weight):
    if weight == 0:
        return left
    if weight == 1:
        return right
    return {'location': tuple(blend_scalar(x, y, weight) for x, y in zip(left['location'], right['location'])),
            'quaternion': blend_quaternion(left['quaternion'], right['quaternion'], weight),
            'scale': tuple(blend_scalar(x, y, weight) for x, y in zip(left['scale'], right['scale']))}
