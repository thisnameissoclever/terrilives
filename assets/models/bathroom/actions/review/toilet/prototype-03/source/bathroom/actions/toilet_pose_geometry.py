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
                                  or not on_ring(p[0], p[1]) or side*p[0] <= 0 for p in points):
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
    return result


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
