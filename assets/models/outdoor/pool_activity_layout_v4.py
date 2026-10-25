"""R60 fitted-ladder draft; square basin on a 2 by 2 tile footprint.

Pure Python: dimensions and vertex helpers only, so the unit tests run
without Blender. One tile is 1.0 world unit and the model is centered on
the origin with its base on Z=0.
"""
import math

FOOTPRINT = (2, 2)

# Stone coping slab that caps the wall.
COPING_HALF = .96          # outer edge, so the rim spans 1.92 by 1.92
COPING_INNER_HALF = .85    # inner edge, overhanging the liner slightly
COPING_TOP = .90
COPING_THICKNESS = .035
COPING_BOTTOM = COPING_TOP - COPING_THICKNESS

# Wood-clad wall under the coping, set back from the coping's outer edge.
WALL_HALF = .94
WALL_INNER_HALF = .86      # pale liner face inside the pool

# Opaque water surface a little below the coping. It reaches slightly into
# the wall so its edge is hidden under the coping overhang.
WATER_Z = .82
WATER_HALF = WALL_INNER_HALF + .005

# Darker trim bands proud of the outer wall face.
TRIM_OUT = .003
TRIM_BANDS = ((0, .035), (.20, .215), (.40, .415), (.60, .615), (.80, .815))

# Ladder: two chrome rails rise out of the water, arch over the coping on
# the +Y side and drop down the outside, where rubber bumpers meet the wall.
LADDER_SIDE_Y = 1
LADDER_RAIL_X = (-.76, -.24)
LADDER_RAIL_RADIUS = .013
# Compact exterior ladder; real toe recesses keep every solid inside the square.
LADDER_PATH = ((.70, .08), (.70, 1.15), (.76, 1.90), (.85, 2.15),
               (.98, 1.90), (.98, 1.15), (.98, .08))
LADDER_BUMPER_Z = ()
LADDER_OUTSIDE_TREADS = ((.955, .25), (.955, .50), (.955, .75))
LADDER_INSIDE_TREADS = ((.26, .25), (.42, .50), (.58, .75))
LADDER_STRINGERS = (((.10, .00), (.58, .75), (.70, .975)),)
TOE_RECESS_X = (-.83, -.17)
TOE_RECESS_BACK_Y = .86
BACKING_INNER_Y = .82
BACKING_OUTER_Y = .88
BACKING_SIDE_WEB = TOE_RECESS_BACK_Y - BACKING_INNER_Y
BACKING_X = (TOE_RECESS_X[0]-BACKING_SIDE_WEB, TOE_RECESS_X[1]+BACKING_SIDE_WEB)
TOE_RECESS_HEIGHTS = ((.25, .45), (.50, .70), (.75, .975))
OUTSIDE_RUNG_DEPTH = .09
INSIDE_RUNG_DEPTH = .18



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
    return (COPING_HALF, max(COPING_HALF, 1., ladder_y), max(COPING_TOP, ladder_z))

# Each tread offers a flat support surface with a measured sole contact.
LADDER_CENTER_X = -.50
RUNG_HEIGHTS = (.25, .50, .75)
RUNG_DEPTH = .18
RUNG_THICKNESS = .025
BASIN_FLOOR_Z = .06
CREST_LANDING_Y = .85
CREST_LANDING_DEPTH = .30
CREST_LANDING_TOP = 1.00


def recessed_wall_geometry():
    """Exact feature-plane cells form one closed wall and continuous inner lining."""
    xs=sorted({-WALL_HALF,-WALL_INNER_HALF,*TOE_RECESS_X,*BACKING_X,WALL_INNER_HALF,WALL_HALF})
    ys=sorted({-WALL_HALF,-WALL_INNER_HALF,BACKING_INNER_Y,TOE_RECESS_BACK_Y,WALL_HALF})
    zs=sorted({0,COPING_BOTTOM,*(z for pair in TOE_RECESS_HEIGHTS for z in pair if 0<z<COPING_BOTTOM)})
    axes=[xs,ys,zs];cells=set()
    for i in range(len(xs)-1):
        for j in range(len(ys)-1):
            for k in range(len(zs)-1):
                x=(xs[i]+xs[i+1])/2;y=(ys[j]+ys[j+1])/2;z=(zs[k]+zs[k+1])/2
                wall=max(abs(x),abs(y))>WALL_INNER_HALF
                strip=TOE_RECESS_X[0]<x<TOE_RECESS_X[1]
                backing=BACKING_X[0]<x<BACKING_X[1] and y>BACKING_INNER_Y
                pocket=strip and y>TOE_RECESS_BACK_Y and any(a<z<b for a,b in TOE_RECESS_HEIGHTS)
                if (wall or backing) and not pocket:cells.add((i,j,k))
    vertices=[];indices={};faces=[];materials=[]
    def vertex(point):
        if point not in indices:indices[point]=len(vertices);vertices.append(point)
        return indices[point]
    for cell in sorted(cells):
        i,j,k=cell;x0,x1=xs[i:i+2];y0,y1=ys[j:j+2];z0,z1=zs[k:k+2]
        boundaries=[(0,-1,[(x0,y0,z0),(x0,y0,z1),(x0,y1,z1),(x0,y1,z0)]),
                    (0,1,[(x1,y0,z0),(x1,y1,z0),(x1,y1,z1),(x1,y0,z1)]),
                    (1,-1,[(x0,y0,z0),(x1,y0,z0),(x1,y0,z1),(x0,y0,z1)]),
                    (1,1,[(x0,y1,z0),(x0,y1,z1),(x1,y1,z1),(x1,y1,z0)]),
                    (2,-1,[(x0,y0,z0),(x0,y1,z0),(x1,y1,z0),(x1,y0,z0)]),
                    (2,1,[(x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1)])]
        for axis,direction,corners in boundaries:
            neighbor=list(cell);neighbor[axis]+=direction
            if tuple(neighbor) in cells:continue
            empty=[]
            for component,index in enumerate(neighbor):
                values=axes[component]
                empty.append((values[index]+values[index+1])/2 if 0<=index<len(values)-1 else values[0]-1 if index<0 else values[-1]+1)
            faces.append(tuple(vertex(point) for point in corners))
            materials.append(int(axis!=2 and abs(empty[0])<WALL_INNER_HALF and abs(empty[1])<WALL_INNER_HALF))
    return vertices,faces,materials
