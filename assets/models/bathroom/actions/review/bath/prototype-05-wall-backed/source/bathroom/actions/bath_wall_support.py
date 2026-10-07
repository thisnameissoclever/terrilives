"""Derive the actual head-end wall plane and one translation that seats hips and back together.

The floor-recline sweep failed because it guessed angles. Here the evaluated shell facets at the
head end (negative Y, away from the taps) decide the torso pitch: the pelvis and back share one
rigid recline angle equal to the wall's pitch from vertical, so the back lies along the wall, and a
single translation then places the lowest hip point one millimetre above the basin floor and the
nearest back point one millimetre off the wall plane. Nothing here reads Blender; the Blender job
supplies evaluated vertices and reads back the frame to apply and measure.
"""
import math

from bath_pose_geometry import recline_vector

FLOOR_Z = .15
INTENDED_GAP = .001
COPLANAR_TOLERANCE_DEGREES = 1.


def _finite(values):
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
        raise ValueError('Wall geometry must contain finite numbers')


def _sub(a, b):
    return [x-y for x, y in zip(a, b)]


def _cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def _dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def _unit(v):
    length = math.sqrt(_dot(v, v))
    if length < 1e-12:
        raise ValueError('Degenerate wall facet')
    return [x/length for x in v]


def derive_head_end_plane(vertices, triangles):
    """Return the inward wall plane fitted to the given shell facets.

    Facets wind so that their right-hand normal points out of the shell, away from the water;
    the inward (body-facing) normal is its negation and must point toward positive Y and upward.
    Facets must agree within one degree, so a bevel or a floor triangle cannot be averaged into
    the wall. The pitch is the angle of the wall from vertical in the Y-Z plane.
    """
    for v in vertices:
        if len(v) != 3:
            raise ValueError('Wall vertices need three coordinates')
        _finite(v)
    if not triangles:
        raise ValueError('Wall plane needs at least one actual facet')
    normals, weights, ids, centroid, total = [], [], [], [0., 0., 0.], 0.
    for index, tri in enumerate(triangles):
        if len(tri) != 3 or len(set(tri)) != 3 or any(type(i) is not int or not 0 <= i < len(vertices) for i in tri):
            raise ValueError('Wall facet must index three distinct vertices')
        a, b, c = (vertices[i] for i in tri)
        raw = _cross(_sub(b, a), _sub(c, a))
        area = math.sqrt(_dot(raw, raw))/2
        if area < 1e-12:
            raise ValueError('Degenerate wall facet')
        inward = [-x/(2*area) for x in raw]
        if inward[1] <= 0 or inward[2] <= 0:
            raise ValueError('Head-end facet does not face the body (inward normal must point +Y and up)')
        normals.append(inward)
        weights.append(area)
        ids.append(index)
        for k in range(3):
            centroid[k] += area*(a[k]+b[k]+c[k])/3
        total += area
    mean = _unit([sum(n[k]*w for n, w in zip(normals, weights)) for k in range(3)])
    for n in normals:
        if math.degrees(math.acos(max(-1., min(1., _dot(n, mean))))) > COPLANAR_TOLERANCE_DEGREES:
            raise ValueError('Head-end facets are not one plane')
    point = [c/total for c in centroid]
    used = sorted({i for tri in triangles for i in tri})
    return dict(normal=mean, point=point, pitch_degrees=math.degrees(math.atan2(mean[2], mean[1])),
                actual_triangle_ids=ids, facet_area=total,
                domain=dict(x=[min(vertices[i][0] for i in used), max(vertices[i][0] for i in used)],
                            y=[min(vertices[i][1] for i in used), max(vertices[i][1] for i in used)],
                            z=[min(vertices[i][2] for i in used), max(vertices[i][2] for i in used)]))


def plane_gap(point, plane):
    """Signed distance of a point from the wall along the inward normal; positive is clear of the wall."""
    return _dot(_sub(point, plane['point']), plane['normal'])


def solve_translation(hips, back, plane, floor_z=FLOOR_Z, gap=INTENDED_GAP):
    """One recline angle for pelvis and back, equal to the wall pitch, and one translation.

    `hips` and `back` are rest-pose world points of the lowest pelvis surface and the rear upper
    back. Both sets are reclined by the wall pitch through `recline_vector`, then translated in
    Y and Z so the lowest hip point sits `gap` above the floor and the nearest back point sits
    `gap` off the wall plane. X stays centred.
    """
    if not hips or not back:
        raise ValueError('Translation needs actual hip and back witnesses')
    for p in (*hips, *back):
        if len(p) != 3:
            raise ValueError('Witness points need three coordinates')
        _finite(p)
    _finite((floor_z, gap, *plane['normal'], *plane['point']))
    if gap <= 0 or plane['normal'][1] <= 0:
        raise ValueError('Gap must be positive and the wall must face the body')
    angle = plane['pitch_degrees']
    hips_r = [list(recline_vector(p, angle)) for p in hips]
    back_r = [list(recline_vector(p, angle)) for p in back]
    tz = floor_z+gap-min(p[2] for p in hips_r)
    n = plane['normal']
    lowest = min(plane_gap([p[0], p[1], p[2]+tz], plane) for p in back_r)
    ty = (gap-lowest)/n[1]
    translation = [0., ty, tz]
    moved_hips = [[p[0]+translation[0], p[1]+ty, p[2]+tz] for p in hips_r]
    moved_back = [[p[0]+translation[0], p[1]+ty, p[2]+tz] for p in back_r]
    return dict(hip_angle=angle, back_angle=angle, translation=translation,
                predicted_hip_min_z=min(p[2] for p in moved_hips),
                predicted_back_min_plane_gap=min(plane_gap(p, plane) for p in moved_back),
                face_direction=list(recline_vector((0, -1, 0), angle)),
                head_axis=list(recline_vector((0, 0, 1), angle)),
                transform='Pelvis and back share the wall pitch; one Y/Z translation seats hips on the floor and back on the wall')
