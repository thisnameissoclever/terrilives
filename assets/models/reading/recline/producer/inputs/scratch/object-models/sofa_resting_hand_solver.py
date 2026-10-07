"""Derive an intentional resting hand from a measured lap or armrest surface."""
import math
import numpy as np
from mathutils import Matrix, Vector
import bpy

import probe_sofa_outward_torso as torso

CONTACT_GAP = .0005
NEAR_GAP = .0015


def patch(points, normal):
    if len(points) < 3:
        return dict(vertices=len(points), area=0., spans=[0., 0.])
    normal = np.asarray(normal, dtype=float)
    tangent = np.asarray([-1., 0., 0.])
    tangent -= normal * (tangent @ normal)
    if np.linalg.norm(tangent) < 1e-8:
        tangent = np.asarray([0., 1., 0.])
        tangent -= normal * (tangent @ normal)
    tangent /= np.linalg.norm(tangent)
    width = np.cross(normal, tangent)
    p = np.asarray(points)
    planar = sorted(set(zip(p @ tangent, p @ width)))

    def cross(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    def half(sequence):
        values = []
        for p in sequence:
            while len(values) > 1 and cross(values[-2], values[-1], p) <= 0:
                values.pop()
            values.append(p)
        return values

    hull = half(planar)[:-1] + half(reversed(planar))[:-1]
    area = abs(sum(a[0] * b[1] - a[1] * b[0] for a, b in zip(hull, hull[1:] + hull[:1]))) / 2 if hull else 0.
    return dict(vertices=len(points), area=area,
                spans=[float(np.ptp(p @ tangent)), float(np.ptp(p @ width))], hull=[list(v) for v in hull])


def palm_frame(points, thumb, hand_direction):
    centered = points - points.mean(0)
    eigenvalues, axes = np.linalg.eigh(np.cov(centered.T))
    major, normal = axes[:, -1], axes[:, 0]
    if major @ hand_direction < 0:
        major = -major
    # Use the broad face opposite the source thumb projection as the initial
    # resting surface. Its posture remains subject to the contact and visual checks.
    if normal @ (thumb.mean(0) - points.mean(0)) > 0:
        normal = -normal
    normal -= major * (normal @ major)
    normal /= np.linalg.norm(normal)
    width = np.cross(major, normal)
    return np.column_stack((width, major, normal)), eigenvalues


def support_rays(points, solid, normal):
    rows = []
    for index, point in enumerate(points):
        p = Vector(point)
        hit, face_normal, face, distance = solid.tree.ray_cast(p + normal * 2., -normal, 4.)
        if hit is not None:
            rows.append(dict(vertex=index, point=list(p), hit=list(hit), gap=(p - hit).dot(normal), triangle=face))
    return rows


def nearest_elbow(shoulder, wrist, upper, lower, old_elbow):
    delta = wrist - shoulder
    distance = delta.length
    if not abs(upper - lower) < distance < upper + lower:
        raise ValueError(f'Resting hand is outside arm reach: distance={distance}, upper={upper}, lower={lower}')
    axis = delta / distance
    along = (upper * upper - lower * lower + distance * distance) / (2 * distance)
    centre = shoulder + axis * along
    radius = math.sqrt(max(0., upper * upper - along * along))
    direction = old_elbow - centre
    direction -= axis * direction.dot(axis)
    if direction.length < 1e-8:
        direction = Vector((-1, 0, 0))
        direction -= axis * direction.dot(axis)
    direction.normalize()
    return centre + direction * radius


def transported_frame(frame, old_head, old_tail, head, tail):
    rotation = (old_tail - old_head).rotation_difference(tail - head).to_matrix().to_4x4()
    result = rotation @ frame
    result.translation = head
    return result


def fit(rig, body, furniture, seat, source_cache, sides=('L', 'R'), on_result=None):
    """Fit lap/armrest contacts without changing source meshes or segment lengths."""
    objects = {obj.get('probe_source_name', obj.name): obj for obj in body.all_objects}
    furniture_objects = {obj.name: obj for obj in furniture.all_objects}
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    results = []
    for side, suffix in (('L', ''), ('R', '.001')):
        if side not in sides:
            continue
        palm_name, thumb_name = 'Relaxed palm' + suffix, 'Resting thumb' + suffix
        palm = source_cache[palm_name + '/rest_points']
        thumb = source_cache[thumb_name + '/rest_points']
        hand_rest = rig.data.bones['hand.' + side]
        original_frame, eigenvalues = palm_frame(palm, thumb, np.asarray(hand_rest.tail_local - hand_rest.head_local))
        outer = (seat == 0 and side == 'R') or (seat == 2 and side == 'L')
        if outer:
            target_name = 'Arm left' if seat == 0 else 'Arm right'
            target = torso.witness.Surface(furniture_objects[target_name], deps)
            palm_length = float(np.ptp(palm @ original_frame[:, 1]))
            x = target.bounds[0][0] + palm_length / 2 + CONTACT_GAP
            y = (target.bounds[0][1] + target.bounds[1][1]) / 2
        else:
            target_name = 'Tailored trouser leg' + suffix
            target = torso.witness.Surface(objects[target_name], deps)
            thigh = rig.pose.bones['thigh.' + side]
            midpoint = rig.matrix_world @ ((thigh.head + thigh.tail) / 2)
            x, y = midpoint.x, midpoint.y
        contact, normal, face, distance = target.tree.ray_cast(Vector((x, y, 2.)), Vector((0, 0, -1)), 4.)
        if contact is None:
            raise ValueError(f'No support at the source-derived center of {target_name}')
        if normal.z < 0:
            normal = -normal
        forward = Vector((-1, 0, 0))
        forward -= normal * forward.dot(normal)
        forward.normalize()
        volar = -normal
        desired = np.column_stack((np.cross(forward, volar), np.asarray(forward), np.asarray(volar)))
        rotation = desired @ original_frame.T
        translation = np.asarray(contact + normal * .2) - rotation @ palm.mean(0)
        placed = palm @ rotation.T + translation
        rays = support_rays(placed, target, normal)
        if not rays:
            raise ValueError(f'Palm does not project onto {target_name}')
        translation += np.asarray(normal) * (CONTACT_GAP - min(row['gap'] for row in rays))
        world_hand = Matrix(rotation.tolist()).to_4x4()
        world_hand.translation = Vector(translation)
        world_hand = world_hand @ hand_rest.matrix_local
        wrist = world_hand.translation
        plan = dict(side=side, support=target_name, support_normal=list(normal),
                    support_triangle=face, source_palm_eigenvalues=eigenvalues.tolist(),
                    contact_gap=CONTACT_GAP, near_gap=NEAR_GAP, wrist=list(wrist), stage='contact-planned')
        results.append(plan)
        if on_result:
            on_result(plan)
        upper, lower = (rig.pose.bones[part + '.' + side] for part in ('upper_arm', 'forearm'))
        upper_frame, lower_frame = rig.matrix_world @ upper.matrix, rig.matrix_world @ lower.matrix
        shoulder, old_elbow, old_wrist = (rig.matrix_world @ p for p in (upper.head, upper.tail, lower.tail))
        elbow = nearest_elbow(shoulder, wrist, rig.data.bones[upper.name].length,
                              rig.data.bones[lower.name].length, old_elbow)
        inverse = rig.matrix_world.inverted()
        rig.pose.bones[upper.name].matrix = inverse @ transported_frame(upper_frame, shoulder, old_elbow, shoulder, elbow)
        bpy.context.view_layer.update()
        rig.pose.bones[lower.name].matrix = inverse @ transported_frame(lower_frame, old_elbow, old_wrist, elbow, wrist)
        bpy.context.view_layer.update()
        rig.pose.bones['hand.' + side].matrix = inverse @ world_hand
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        actual = torso.witness.Surface(objects[palm_name], deps)
        measured = support_rays(actual.points, target, normal)
        near = [row['point'] for row in measured if 0 <= row['gap'] <= NEAR_GAP]
        neighborhood = patch(near, normal)
        expected = palm @ rotation.T + translation
        replay = float(np.linalg.norm(np.asarray(actual.points) - expected, axis=1).max())
        collision = torso.depth.collision(actual, target)
        plan.update(stage='contact-measured', rays=measured, patch=neighborhood, palm_collision=collision,
                    elbow=list(elbow), rigid_palm_replay_error=replay,
                    status='Measured resting contact; complete reach, garment, furniture, neighbor and visual checks remain required')
        if on_result:
            on_result(plan)
    return results
