"""Pure rounded-floor containment and rotation-only two-link solves."""
import math

SHOWER_RENDERED_BODY = {
    'HAIR_01_TRIPO_CURL', 'Natural neck', 'Overshirt body', 'Quiet closed smile',
    'Sculpted head', 'Small rounded nose', 'Trouser hip bridge',
    'Dark pupil', 'Dark pupil.001', 'Ear', 'Ear.001', 'Eye white', 'Eye white.001',
    'Fitted rounded shoe sole', 'Fitted rounded shoe sole.001',
    'Forearm with elbow and wrist sections', 'Forearm with elbow and wrist sections.001',
    'Hazel iris', 'Hazel iris.001', 'Inner ear', 'Inner ear.001',
    'Relaxed palm', 'Relaxed palm.001', 'Relaxed shirt sleeve', 'Relaxed shirt sleeve.001',
    'Resting thumb', 'Resting thumb.001', 'Shaped shoe', 'Shaped shoe.001',
    'Shoe apron stitch', 'Shoe apron stitch.001',
    'Small eye catchlight', 'Small eye catchlight.001', 'Soft eyebrow', 'Soft eyebrow.001',
    'Tailored trouser leg', 'Tailored trouser leg.001', 'Trouser hem', 'Trouser hem.001',
    'Upper lid outline', 'Upper lid outline.001',
}
OMITTED_GARMENT_DETAILS = {
    'Collar stand', 'Folded fabric collar leaf', 'Folded fabric collar leaf.001',
    'One sewn breast pocket', 'Pocket top seam', 'Shirt lower hem', 'Shirt placket',
    'Turned sleeve cuff', 'Turned sleeve cuff.001', 'Small horn button',
    'Small horn button.001', 'Small horn button.002', 'Small horn button.003',
}


def validate_shower_inventory(original, visible):
    if set(original) != SHOWER_RENDERED_BODY | OMITTED_GARMENT_DETAILS or len(original) != 54:
        raise ValueError('Complete original 54-object body inventory changed')
    if set(visible) != SHOWER_RENDERED_BODY or len(visible) != 41:
        raise ValueError('Explicit 41-object shower rendering inventory changed')


def spray_angle(direction):
    if len(direction) != 3 or not all(math.isfinite(v) for v in direction):
        raise ValueError('Spray direction must be finite')
    length = math.sqrt(sum(v*v for v in direction))
    if length < 1e-10:
        raise ValueError('Spray direction cannot be zero')
    axis = (0, -1/math.sqrt(5), -2/math.sqrt(5))
    unit = tuple(v/length for v in direction)
    dot = sum(a*b for a, b in zip(axis, unit))
    cross = (axis[1]*unit[2]-axis[2]*unit[1],
             axis[2]*unit[0]-axis[0]*unit[2],
             axis[0]*unit[1]-axis[1]*unit[0])
    return math.degrees(math.atan2(math.sqrt(sum(v*v for v in cross)), dot))


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
