"""Float64 arm construction using consistent endpoints and untouched full rest frames."""
import math
import numpy as np


def rotation_between(first, second):
    a, b = np.asarray(first, dtype=np.float64), np.asarray(second, dtype=np.float64)
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    cross = np.cross(a, b)
    cosine = float(np.clip(a @ b, -1, 1))
    if cosine < -1 + 1e-12:
        raise ValueError('An antiparallel swing requires a source-defined bend axis')
    skew = np.asarray([[0., -cross[2], cross[1]], [cross[2], 0., -cross[0]], [-cross[1], cross[0], 0.]])
    return np.eye(3) + skew + skew @ skew / (1 + cosine)


def apply_swing(reference, rotation, head):
    result = np.asarray(reference, dtype=np.float64).copy()
    result[:3, :3] = rotation @ result[:3, :3]
    result[:3, 3] = head
    return result


def solve(data):
    matrices = {name: np.asarray(value, dtype=np.float64) for name, value in data['matrices'].items()}
    endpoints = {name: np.asarray(value, dtype=np.float64) for name, value in data['endpoints'].items()}
    spine_deformation = matrices['spine_pose'] @ np.linalg.inv(matrices['spine_rest'])
    hand_deformation = matrices['hand_pose'] @ np.linalg.inv(matrices['hand_rest'])
    # Use one connected endpoint representation. Blender's separately exposed
    # head/tail and length fields can differ slightly from the saved frame origins.
    upper_head = matrices['upper_rest'][:3, 3]
    forearm_head = matrices['forearm_rest'][:3, 3]
    hand_head = matrices['hand_rest'][:3, 3]
    shoulder = (spine_deformation @ np.append(upper_head, 1.))[:3]
    wrist = matrices['hand_pose'][:3, 3]
    upper_vector = forearm_head - upper_head
    forearm_vector = hand_head - forearm_head
    upper_length, lower_length = float(np.linalg.norm(upper_vector)), float(np.linalg.norm(forearm_vector))
    wanted = hand_deformation[:3, :3] @ forearm_vector
    wanted /= np.linalg.norm(wanted)
    delta = wrist - shoulder
    distance = float(np.linalg.norm(delta))
    if not abs(upper_length - lower_length) < distance < upper_length + lower_length:
        raise ValueError('The unchanged hand target is outside the saved endpoint reach lengths')
    axis = delta / distance
    along = .5 * (distance + (upper_length - lower_length) * (upper_length + lower_length) / distance)
    factors = [math.fsum([upper_length, lower_length, -distance]),
               math.fsum([upper_length, lower_length, distance]),
               math.fsum([distance, upper_length, -lower_length]),
               math.fsum([distance, -upper_length, lower_length])]
    radius = math.sqrt(math.prod(factors)) / (2 * distance)
    centre = shoulder + along * axis
    projected = np.cross(axis, np.cross(wanted, axis))
    projection_length = float(np.linalg.norm(projected))
    if projection_length < 1e-12:
        source_elbow = (hand_deformation @ np.append(forearm_head, 1.))[:3]
        projected = centre - source_elbow
        projected -= axis * (projected @ axis)
        projection_length = float(np.linalg.norm(projected))
    if projection_length < 1e-12:
        raise ValueError('Saved rest geometry does not choose a unique elbow bend side')
    elbow = centre - radius * projected / projection_length
    upper_reference = spine_deformation @ matrices['upper_rest']
    forearm_reference = hand_deformation @ matrices['forearm_rest']
    upper_rotation = rotation_between(spine_deformation[:3, :3] @ upper_vector, elbow - shoulder)
    forearm_rotation = rotation_between(hand_deformation[:3, :3] @ forearm_vector, wrist - elbow)
    upper_pose = apply_swing(upper_reference, upper_rotation, shoulder)
    forearm_pose = apply_swing(forearm_reference, forearm_rotation, elbow)
    return dict(targets=dict(upper_arm=upper_pose, forearm=forearm_pose, hand=matrices['hand_pose'].copy()),
                shoulder=shoulder, elbow=elbow, wrist=wrist, circle_radius=radius,
                projected_direction_length=projection_length,
                endpoint_lengths=[upper_length, lower_length],
                source_endpoint_representation='Connected upper-arm, forearm and hand rest-matrix origins',
                source_endpoint_differences=dict(upper_head=(upper_head-endpoints['upper_head']),
                    elbow=(forearm_head-endpoints['forearm_head']), wrist=(hand_head-endpoints['forearm_tail'])),
                spine_deformation=spine_deformation, hand_deformation=hand_deformation,
                construction='Float64 rig-local circle; factored radius; rigid swings composed onto complete saved rest frames')


def proper_rotation(matrix):
    u, singular, v = np.linalg.svd(np.asarray(matrix, dtype=np.float64))
    return u @ v


def angle_degrees(first, second):
    delta = proper_rotation(first).T @ proper_rotation(second)
    return math.degrees(math.acos(float(np.clip((np.trace(delta) - 1) / 2, -1, 1))))
