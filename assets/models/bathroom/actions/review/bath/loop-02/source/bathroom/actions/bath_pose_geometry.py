"""Pure sloped-basin contours, complete finite support grids and limb solves."""
import math


def basin_profile(z):
    if not math.isfinite(z) or not .15 <= z <= .57:
        raise ValueError('Basin profile height must remain between actual floor and rim')
    t = (z-.15)/.42
    return .23+.105*t, .64+.13*t, .14+.01*t


def basin_contains(x, y, z):
    if not all(math.isfinite(v) for v in (x, y, z)) or not .15 <= z <= .57:
        return False
    width, length, radius = basin_profile(z)
    dx, dy = max(abs(x)-(width-radius), 0), max(abs(y+.06)-(length-radius), 0)
    return dx*dx+dy*dy <= radius*radius+1e-12


def basin_contour(z, inset=.006, steps=8):
    if not math.isfinite(z) or not .15 < z < .57 or not 0 < inset < .02 or steps < 4:
        raise ValueError('Opaque water needs a finite inset contour strictly below the rim')
    width, length, radius = basin_profile(z)
    width, length, radius = width-inset, length-inset, radius-inset
    points = []
    for quadrant, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        for i in range(steps+1):
            angle = math.radians(quadrant*90+i*90/steps)
            points.append((sx*(width-radius)+radius*math.cos(angle),
                           sy*(length-radius)+radius*math.sin(angle)-.06, z))
    return points


def recline_vector(point, angle):
    if len(point) != 3 or not all(math.isfinite(v) for v in (*point, angle)):
        raise ValueError('Recline transform must be finite')
    x, y, z = point
    radians = math.radians(angle)
    sine, cosine = math.sin(radians), math.cos(radians)
    return -x, -cosine*y-sine*z, -sine*y+cosine*z


def validate_support_patch(points):
    fields = ('x', 'y', 'body_z', 'basin_z', 'gap')
    if len(points) < 9 or any(not all(field in p and math.isfinite(p[field]) for field in fields)
                             or not 0 <= p['gap'] <= .01
                             or abs(p['body_z']-p['basin_z']-p['gap']) > 1e-7 for p in points):
        raise ValueError('Support patch must contain finite non-penetrating actual surface hits')
    xs, ys = sorted({p['x'] for p in points}), sorted({p['y'] for p in points})
    occupied = {(p['x'], p['y']) for p in points}
    if len(occupied) != len(points) or len(xs) < 3 or len(ys) < 3 or occupied != {(x, y) for x in xs for y in ys}:
        raise ValueError('Support patch spans missing actual samples')
    width, depth = xs[-1]-xs[0], ys[-1]-ys[0]
    if width < .025 or depth < .03 or width*depth < .001:
        raise ValueError('Actual support neighborhood lacks finite area')
    return dict(area=width*depth, width=width, depth=depth, samples=len(points),
                xy_bounds=[[xs[0], ys[0]], [xs[-1], ys[-1]]],
                min_gap=min(p['gap'] for p in points), max_gap=max(p['gap'] for p in points),
                complete_cartesian_surface_grid=True, actual_witnesses=points)


def two_link(start, end, upper, lower, pole):
    if any(len(p) != 3 for p in (start, end, pole)) or not all(
            math.isfinite(v) for v in (*start, *end, *pole, upper, lower)) or min(upper, lower) <= 0:
        raise ValueError('Limb points and lengths must be finite and positive')
    delta = [b-a for a, b in zip(start, end)]
    distance = math.sqrt(sum(v*v for v in delta))
    if not abs(upper-lower) < distance < upper+lower:
        raise ValueError('Unreachable anatomical limb target')
    axis = [v/distance for v in delta]
    direction = [b-a for a, b in zip(start, pole)]
    projection = sum(a*b for a, b in zip(direction, axis))
    normal = [a-projection*b for a, b in zip(direction, axis)]
    length = math.sqrt(sum(v*v for v in normal))
    if length < 1e-10:
        raise ValueError('Limb pole cannot be parallel to target')
    along = (upper*upper-lower*lower+distance*distance)/(2*distance)
    height = math.sqrt(max(0, upper*upper-along*along))
    return tuple(a+along*b+height*c/length for a, b, c in zip(start, axis, normal))
