"""Apply recorded float64 arm solutions without replacing the source rest basis."""
import bpy
import numpy as np
from mathutils import Matrix

import sofa_arm_frame_math as geometry


def solve(rig, side, on_measurement=None):
    upper_name, forearm_name, hand_name = (part + '.' + side for part in ('upper_arm', 'forearm', 'hand'))
    upper, forearm, hand = (rig.data.bones[name] for name in (upper_name, forearm_name, hand_name))
    inputs = dict(matrices=dict(spine_pose=[list(row) for row in rig.pose.bones['spine'].matrix],
        spine_rest=[list(row) for row in rig.data.bones['spine'].matrix_local],
        upper_rest=[list(row) for row in upper.matrix_local], forearm_rest=[list(row) for row in forearm.matrix_local],
        hand_rest=[list(row) for row in hand.matrix_local], hand_pose=[list(row) for row in rig.pose.bones[hand_name].matrix]),
        endpoints=dict(upper_head=list(upper.head_local), upper_tail=list(upper.tail_local),
                       forearm_head=list(forearm.head_local), forearm_tail=list(forearm.tail_local)))
    record = dict(side=side, stage='inputs-recorded', inputs=inputs, stored_lengths=[upper.length, forearm.length],
                  rig_matrix_world=[list(row) for row in rig.matrix_world])
    if on_measurement:
        on_measurement(record)
    solution = geometry.solve(inputs)
    shoulder_error = float(np.linalg.norm(solution['shoulder'] - np.asarray(rig.pose.bones[upper_name].head, dtype=np.float64)))
    names = {'upper_arm': upper_name, 'forearm': forearm_name, 'hand': hand_name}
    desired = {names[name]: matrix for name, matrix in solution['targets'].items()}
    record.update(stage='solution-recorded', endpoint_lengths=solution['endpoint_lengths'],
                  endpoint_representation=solution['source_endpoint_representation'],
                  source_endpoint_differences={name: value.tolist() for name, value in solution['source_endpoint_differences'].items()},
                  circle_radius=solution['circle_radius'], projected_direction_length=solution['projected_direction_length'],
                  source_shoulder=list(solution['shoulder']), elbow=list(solution['elbow']), wrist=list(solution['wrist']),
                  source_shoulder_residual=shoulder_error,
                  target_frames={name: matrix.tolist() for name, matrix in desired.items()},
                  construction=solution['construction'], hand_target_unchanged=True)
    if on_measurement:
        on_measurement(record)
    if shoulder_error > .00001:
        raise ValueError(f'Shoulder does not match its inherited source frame: {shoulder_error}')
    for name, matrix in desired.items():
        rig.pose.bones[name].matrix = Matrix(matrix.tolist())
        bpy.context.view_layer.update()
    actual = {name: np.asarray(rig.pose.bones[name].matrix, dtype=np.float64) for name in desired}
    residual = max(float(np.max(np.abs(actual[name] - desired[name]))) for name in desired)
    actual_forearm_deformation = actual[forearm_name] @ np.linalg.inv(np.asarray(inputs['matrices']['forearm_rest']))
    actual_hand_deformation = actual[hand_name] @ np.linalg.inv(np.asarray(inputs['matrices']['hand_rest']))
    record.update(stage='actual-frames-recorded', actual_frames={name: matrix.tolist() for name, matrix in actual.items()},
                  actual_joints={name: dict(head=list(rig.pose.bones[name].head), tail=list(rig.pose.bones[name].tail),
                                          scale=list(rig.pose.bones[name].scale)) for name in desired},
                  maximum_frame_residual=residual,
                  wrist_rest_relative_degrees=geometry.angle_degrees(actual_forearm_deformation[:3, :3], actual_hand_deformation[:3, :3]))
    if on_measurement:
        on_measurement(record)
    if residual > .00001:
        raise ValueError(f'Constructed source-relative frame did not replay: {residual}')
    return record
