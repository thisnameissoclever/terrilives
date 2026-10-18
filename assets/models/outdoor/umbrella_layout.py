"""Patio umbrella on a 1 by 1 footprint: weighted base, slim pole, octagonal canopy.

Pure Python: dimensions and the canopy mesh only, so the unit tests run
without Blender. The model is centered on the origin with its base on Z=0.
The canopy overhangs the tile, which is expected for this object.
"""
import math

FOOTPRINT = (1, 1)

# Weighted round base and the collar that grips the pole.
BASE_RADIUS = .20
BASE_HEIGHT = .06
COLLAR_RADIUS = .055
COLLAR_TOP = .14

# Slim pole up to the finial.
POLE_RADIUS = .02
TILT_COLLAR_Z = (1.20, 1.27)
TILT_COLLAR_RADIUS = .032

# Octagonal canopy. Rib tips sit on CANOPY_RADIUS; the fabric sags SAG
# between ribs and a short valance hangs VALANCE below the rim, so the
# lowest edge is CANOPY_LOW.
SIDES = 8
CANOPY_RADIUS = .78
CANOPY_LOW = 1.90
VALANCE = .06
SAG = .015
RIM_Z = CANOPY_LOW+VALANCE+SAG
APEX_Z = 2.19
APEX_RING = .03
DOME = .70                 # below 1 bows the canopy upward between apex and rim
FINIAL_BASE = APEX_Z-.02
FINIAL_RADIUS = .04
FINIAL_TOP = 2.25

RINGS = 12
COLUMNS_PER_PANEL = 6
START_ANGLE = math.radians(22.5)


def rib_angle(index):
    return START_ANGLE+index*2*math.pi/SIDES


def canopy_point(t, k):
    """Point at radial fraction t (0 apex ring, 1 rim) and column k."""
    panel, u = divmod(k, COLUMNS_PER_PANEL)
    u /= COLUMNS_PER_PANEL
    a0, a1 = rib_angle(panel), rib_angle(panel+1)
    ex = (1-u)*math.cos(a0)+u*math.cos(a1)
    ey = (1-u)*math.sin(a0)+u*math.sin(a1)
    scale = APEX_RING/CANOPY_RADIUS+(1-APEX_RING/CANOPY_RADIUS)*t
    r = CANOPY_RADIUS*scale
    z = RIM_Z+(APEX_Z-RIM_Z)*(1-t)**DOME-SAG*math.sin(math.pi*u)*t
    return (r*ex, r*ey, z)


def canopy_geometry():
    """Vertices, faces and per-face panel indices for fabric and valance."""
    columns = SIDES*COLUMNS_PER_PANEL
    vertices = [canopy_point(i/RINGS, k)
                for i in range(RINGS+1) for k in range(columns)]
    faces, panels = [], []
    for i in range(RINGS):
        for k in range(columns):
            n = (k+1) % columns
            faces.append((i*columns+k, (i+1)*columns+k,
                          (i+1)*columns+n, i*columns+n))
            panels.append(k//COLUMNS_PER_PANEL)
    rim = RINGS*columns
    hem = len(vertices)
    vertices += [(x, y, z-VALANCE) for x, y, z in vertices[rim:rim+columns]]
    for k in range(columns):
        n = (k+1) % columns
        faces.append((rim+k, hem+k, hem+n, rim+n))
        panels.append(k//COLUMNS_PER_PANEL)
    return vertices, faces, panels


def canopy_extent():
    """(width across rib tips, lowest Z, highest fabric Z)."""
    vertices = canopy_geometry()[0]
    width = 2*max(math.hypot(x, y) for x, y, _ in vertices)
    return width, min(z for *_, z in vertices), max(z for *_, z in vertices)


def outer_bounds():
    """(half extent of base, half extent of canopy, top Z)."""
    return (BASE_RADIUS, canopy_extent()[0]/2, FINIAL_TOP)
