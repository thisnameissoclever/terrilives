"""Plan reachable knee/ankle coordinates from evaluated rigid sole geometry."""
from toilet_pose_geometry import knee_first, sole_ankle_height


def leg_plan(hip_y, hip_z, relative_sole, pitch_degrees, upper=.37, lower=.36, lateral_delta=.035):
    ankle_z = sole_ankle_height(relative_sole, pitch_degrees)
    result = knee_first(hip_y, hip_z, upper, lower, ankle_z=ankle_z, lateral_delta=lateral_delta)
    return dict(result, pitch_degrees=pitch_degrees, inherited_min_floor_gap=.019148)
