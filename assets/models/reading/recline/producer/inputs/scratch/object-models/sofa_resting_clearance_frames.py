"""Construct one source-defined elbow arc without altering verified frame helpers."""
import math
import numpy as np

import sofa_arm_frame_math as frames


def component_vertices(triangles):
    parent={int(v):int(v) for t in triangles for v in t}
    def root(v):
        while parent[v]!=v:
            parent[v]=parent[parent[v]]
            v=parent[v]
        return v
    for triangle in triangles:
        a=root(int(triangle[0]))
        for value in triangle[1:]:
            parent[root(int(value))]=a
    return sorted({root(v) for v in parent})


def winding(point, points, triangles):
    vectors=np.asarray(points)[np.asarray(triangles)]-np.asarray(point)
    lengths=np.linalg.norm(vectors,axis=2)
    a,b,c=vectors[:,0],vectors[:,1],vectors[:,2]
    numerator=np.einsum('ij,ij->i',a,np.cross(b,c))
    denominator=np.prod(lengths,axis=1)+(a*b).sum(1)*lengths[:,2]+(b*c).sum(1)*lengths[:,0]+(c*a).sum(1)*lengths[:,1]
    return float(np.sum(2*np.arctan2(numerator,denominator))/(4*math.pi))


def solve(data, world_matrix, fraction):
    original = frames.solve(data)
    matrices = {name: np.asarray(value, dtype=np.float64) for name, value in data['matrices'].items()}
    shoulder, wrist = original['shoulder'], original['wrist']
    axis = wrist - shoulder
    distance = np.linalg.norm(axis)
    axis /= distance
    upper_length, lower_length = original['endpoint_lengths']
    along = .5 * (distance + (upper_length-lower_length)*(upper_length+lower_length)/distance)
    centre = shoulder + axis * along
    initial = (original['elbow'] - centre) / original['circle_radius']
    # The torso intrusion lies behind the supported palm. The endpoint maximizes
    # forward elbow position on this exact circle; it is not an angle-grid sample.
    forward = np.linalg.inv(np.asarray(world_matrix, dtype=np.float64))[:3, :3] @ np.array([-1., 0., 0.])
    forward -= axis * (axis @ forward)
    forward /= np.linalg.norm(forward)
    cosine = float(np.clip(initial @ forward, -1., 1.))
    angle = math.acos(cosine)
    if angle < 1e-12:
        direction = initial
    else:
        tangent = forward - cosine * initial
        if np.linalg.norm(tangent) < 1e-12:
            raise ValueError('Antipodal elbow arc has no unique source-defined side')
        tangent /= np.linalg.norm(tangent)
        direction = initial*math.cos(angle*fraction) + tangent*math.sin(angle*fraction)
    elbow = centre + original['circle_radius'] * direction
    spine, hand = original['spine_deformation'], original['hand_deformation']
    upper_vector = matrices['forearm_rest'][:3,3] - matrices['upper_rest'][:3,3]
    lower_vector = matrices['hand_rest'][:3,3] - matrices['forearm_rest'][:3,3]
    upper = frames.apply_swing(spine @ matrices['upper_rest'],
        frames.rotation_between(spine[:3,:3] @ upper_vector, elbow-shoulder), shoulder)
    lower = frames.apply_swing(hand @ matrices['forearm_rest'],
        frames.rotation_between(hand[:3,:3] @ lower_vector, wrist-elbow), elbow)
    return dict(targets=dict(upper_arm=upper, forearm=lower, hand=matrices['hand_pose'].copy()),
                shoulder=shoulder, elbow=elbow, wrist=wrist, circle_radius=original['circle_radius'],
                arc_angle=angle, fraction=fraction, endpoint_lengths=original['endpoint_lengths'],
                wrist_rest_relative_degrees=frames.angle_degrees(
                    (lower @ np.linalg.inv(matrices['forearm_rest']))[:3,:3], hand[:3,:3]))
