"""Square above-ground backyard pool on a 2 by 2 tile footprint.

Pure Python: dimensions and vertex helpers only, so the unit tests run
without Blender. One tile is 1.0 world unit and the model is centered on
the origin with its base on Z=0.
"""
import math

FOOTPRINT = (2, 2)

# Stone coping slab that caps the wall.
COPING_HALF = .96          # outer edge, so the rim spans 1.92 by 1.92
COPING_INNER_HALF = .85    # inner edge, overhanging the liner slightly
COPING_TOP = .33
COPING_THICKNESS = .035
COPING_BOTTOM = COPING_TOP - COPING_THICKNESS

# Wood-clad wall under the coping, set back from the coping's outer edge.
WALL_HALF = .94
WALL_INNER_HALF = .86      # pale liner face inside the pool

# Opaque water surface a little below the coping. It reaches slightly into
# the wall so its edge is hidden under the coping overhang.
WATER_Z = .27
WATER_HALF = WALL_INNER_HALF + .005

# Darker trim bands proud of the outer wall face.
TRIM_OUT = .003
TRIM_BANDS = ((0, .035), (.13, .145))

# Ladder: two chrome rails rise out of the water, arch over the coping on
# the +Y side and drop down the outside, where rubber bumpers meet the wall.
LADDER_SIDE_Y = 1
LADDER_RAIL_X = (-.16, .16)
LADDER_RAIL_RADIUS = .013
LADDER_PATH = ((.78, .18), (.785, .40), (.83, .52), (.91, .555),
               (.972, .50), (.985, .38), (.985, .10))
LADDER_BUMPER_Z = (.13,)


def square_ring(outer, inner, z0, z1):
    """Closed hollow square: outer and inner walls, top and bottom rings.

    Returns (vertices, faces, inner_face_indices). Face winding points
    outward from the solid.
    """
    corners = ((1, 1), (-1, 1), (-1, -1), (1, -1))
    vertices = [(sx*half, sy*half, z) for half, z in
                ((outer, z0), (outer, z1), (inner, z0), (inner, z1))
                for sx, sy in corners]
    ob, ot, ib, it = 0, 4, 8, 12
    faces, inner_faces = [], []
    for i in range(4):
        j = (i+1) % 4
        faces.append((ob+i, ob+j, ot+j, ot+i))         # outer wall
        inner_faces.append(len(faces))
        faces.append((ib+j, ib+i, it+i, it+j))         # inner wall
        faces.append((ot+i, ot+j, it+j, it+i))         # top ring
        faces.append((ob+j, ob+i, ib+i, ib+j))         # bottom ring
    return vertices, faces, inner_faces


# Lighter ripple highlights painted into the water surface itself, as faces
# of one connected grid, so the line art draws no outline around them:
# (center x, center y, axis 'x' or 'y', length).
WATER_GRID = 256
RIPPLE_WIDTH = .03
RIPPLE_AMPLITUDE = .018
RIPPLES = ((-.38, -.22, 'x', .34), (.30, .36, 'y', .30),
           (.42, -.42, 'x', .26), (-.30, .40, 'y', .24), (.02, -.02, 'x', .22))


def in_ripple(x, y):
    """True when (x, y) on the water lies inside a ripple highlight."""
    for cx, cy, axis, length in RIPPLES:
        along, across = (x-cx, y-cy) if axis == 'x' else (y-cy, x-cx)
        if abs(along) > length/2:
            continue
        t = along/length+.5
        wave = RIPPLE_AMPLITUDE*math.sin(t*2*math.pi)
        half = RIPPLE_WIDTH/2*math.sin(math.pi*t)**.5
        if abs(across-wave) <= half:
            return True
    return False


def water_grid():
    """Flat water grid: (vertices, faces, ripple flag per face), normals up."""
    n, h = WATER_GRID, WATER_HALF
    step = 2*h/n
    vertices = [(-h+i*step, -h+j*step, WATER_Z)
                for j in range(n+1) for i in range(n+1)]
    faces, ripple = [], []
    for j in range(n):
        for i in range(n):
            a = j*(n+1)+i
            faces.append((a, a+1, a+n+2, a+n+1))
            ripple.append(in_ripple(-h+(i+.5)*step, -h+(j+.5)*step))
    return vertices, faces, ripple


def ladder_rail_points(x):
    sign = LADDER_SIDE_Y
    return [(x, sign*y, z) for y, z in LADDER_PATH]


def outer_bounds():
    """Axis-aligned extents (half X, half Y, top Z) of everything modeled."""
    ladder_y = max(abs(y) for y, _ in LADDER_PATH)+LADDER_RAIL_RADIUS
    ladder_z = max(z for _, z in LADDER_PATH)+LADDER_RAIL_RADIUS
    return (COPING_HALF, max(COPING_HALF, ladder_y), max(COPING_TOP, ladder_z))
