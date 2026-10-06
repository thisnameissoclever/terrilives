"""Pure rounded-floor containment and rotation-only two-link solves."""
import math


def on_floor(x, y):
    if not all(math.isfinite(value) for value in (x, y)):
        return False
    dx, dy = max(abs(x)-.345, 0), max(abs(y)-.345, 0)
    return dx*dx+dy*dy <= .03*.03


def validate_footprint(points):
    if not points or any(len(point) != 3 or not all(math.isfinite(v) for v in point)
                         or not on_floor(point[0], point[1]) for point in points):
        raise ValueError('Complete sole footprint leaves the rounded tray floor')
    return dict(vertex_count=len(points),
                bounds=[[min(p[i] for p in points) for i in range(3)],
                        [max(p[i] for p in points) for i in range(3)]])


def two_link(start, end, upper, lower, pole):
    if any(len(point) != 3 for point in (start, end, pole)) or not all(
            math.isfinite(v) for v in (*start, *end, *pole, upper, lower)) or min(upper, lower) <= 0:
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
