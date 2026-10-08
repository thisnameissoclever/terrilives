"""Finite open-ring support domains and rotation-only limb planning."""
import math


def on_ring(x, y):
    if not all(math.isfinite(v) for v in (x, y)):
        return False
    y += .10
    return (x/.218)**2+(y/.293)**2 <= 1 and (x/.163)**2+(y/.228)**2 >= 1


def validate_patches(patches):
    if len(patches) != 2:
        raise ValueError('Two independent side patches are required')
    result = []
    for side, points in zip((-1, 1), patches):
        if len(points) < 9 or any(len(p) != 3 or not all(math.isfinite(v) for v in p)
                                  or not on_ring(p[0], p[1]) or side*p[0] < .08 for p in points):
            raise ValueError('Support patch is outside its finite ring side')
        low = [min(p[i] for p in points) for i in range(3)]
        high = [max(p[i] for p in points) for i in range(3)]
        width, depth = high[0]-low[0], high[1]-low[1]
        if width < .015 or depth < .035 or width*depth < .0007:
            raise ValueError('Support patch lacks finite area')
        # A rectangle stays outside the inner ellipse when its closest point
        # does. Its four corners bound the maximum outer-ellipse value.
        closest_x = max(low[0], min(0, high[0]))
        closest_y = max(low[1], min(-.10, high[1]))
        if not on_ring(closest_x, closest_y) or not all(
                on_ring(x, y) for x in (low[0], high[0]) for y in (low[1], high[1])):
            raise ValueError('Support patch spans the empty opening')
        result.append(dict(side=side, area=width*depth, bounds=[low, high], samples=len(points)))
    left, right = [item['bounds'] for item in result]
    if any(abs(a-b) > 1e-8 for a, b in ((-left[0][0], right[1][0]),
                                       (-left[1][0], right[0][0]),
                                       (left[0][1], right[0][1]),
                                       (left[1][1], right[1][1]))):
        raise ValueError('Support patch planar bounds are not mirrored')
    return result


def knee_first(hip_y, hip_z, upper, lower, ankle_z=.15, lateral_delta=0):
    if not all(math.isfinite(v) for v in (hip_y, hip_z, upper, lower, ankle_z, lateral_delta)) or min(upper, lower) <= .001:
        raise ValueError('Knee-first inputs must be finite and reachable')
    knee_z = ankle_z+lower-.001
    thigh_y_squared = upper*upper-lateral_delta*lateral_delta-(hip_z-knee_z)**2
    shin_y_squared = lower*lower-(knee_z-ankle_z)**2
    if thigh_y_squared <= 0 or shin_y_squared <= 0:
        raise ValueError('Knee-first target is unreachable')
    knee_y = hip_y-math.sqrt(thigh_y_squared)
    return dict(knee=(knee_y, knee_z), ankle=(knee_y+math.sqrt(shin_y_squared), ankle_z))


def sole_ankle_height(points, pitch_degrees, floor_clearance=.019148):
    if not points or not all(math.isfinite(v) for v in (pitch_degrees, floor_clearance)) or any(
            len(p) != 3 or not all(math.isfinite(v) for v in p) for p in points):
        raise ValueError('Complete rigid sole vertices and pitch must be finite')
    pitch = math.radians(pitch_degrees)
    return floor_clearance-min(p[1]*math.sin(pitch)+p[2]*math.cos(pitch) for p in points)


def two_link(start, end, upper, lower, pole):
    values = (*start, *end, *pole, upper, lower)
    if len(start) != 3 or len(end) != 3 or len(pole) != 3 or not all(
            math.isfinite(v) for v in values) or min(upper, lower) <= 0:
        raise ValueError('Limb coordinates and lengths must be finite and positive')
    delta = [b-a for a, b in zip(start, end)]
    distance = math.sqrt(sum(v*v for v in delta))
    if not abs(upper-lower) < distance < upper+lower:
        raise ValueError('Unreachable two-link target')
    axis = [v/distance for v in delta]
    direction = [b-a for a, b in zip(start, pole)]
    projection = sum(a*b for a, b in zip(direction, axis))
    normal = [a-projection*b for a, b in zip(direction, axis)]
    norm = math.sqrt(sum(v*v for v in normal))
    if norm < 1e-10:
        raise ValueError('Limb pole is parallel to its target')
    along = (upper*upper-lower*lower+distance*distance)/(2*distance)
    height = math.sqrt(max(0, upper*upper-along*along))
    return tuple(a+along*b+height*c/norm for a, b, c in zip(start, axis, normal))
