"""Pool lounger on a 1 by 2 footprint, long axis along world Y.

Pure Python: dimensions and the backrest transform only, so the unit tests
run without Blender. The model is centered on the origin with its feet on
Z=0 and the raised backrest at the +Y end, matching how the bathtub is
authored.
"""
import math

FOOTPRINT = (1, 2)
WIDTH = .62
LENGTH = 1.80
HALF_W = WIDTH/2
HALF_L = LENGTH/2

# Frame: side rails along Y, end rails across X, four short legs.
RAIL_W = .035
RAIL_H = .07
RAIL_TOP = .33
RAIL_Z = RAIL_TOP-RAIL_H/2
LEG = .045
LEG_INSET = .025           # leg center distance in from the frame corner

# Flat deck board on top of the frame and the padded cushion on it. People
# sit on the cushion edge with the generic chair pose, so keep the top at
# 0.42.
BOARD_W = .60
BOARD_T = .02
BOARD_TOP = RAIL_TOP+BOARD_T
CUSHION_W = .58
CUSHION_TOP = .42
CUSHION_T = CUSHION_TOP-BOARD_TOP
CUSHION_FOOT_Y = -HALF_L+.02
CUSHION_HEAD_Y = .45        # tucks under the raised back cushion

# Backrest hinged at HINGE_Y on top of the frame, raised BACK_ANGLE degrees.
HINGE_Y = .42
BACK_ANGLE = 40
BACK_LENGTH = .62
BACK_CUSHION_T = .07
PROP_X = (-.28, .28)        # over the side rails, under the back board
PROP_FOOT_Y = .84
PROP_ALONG = .45           # where the prop meets the back board


def back_axes():
    angle = math.radians(BACK_ANGLE)
    along = (math.cos(angle), math.sin(angle))
    normal = (-math.sin(angle), math.cos(angle))
    return along, normal


def back_point(s, t):
    """(y, z) at distance s along the backrest and t above its underside."""
    along, normal = back_axes()
    return (HINGE_Y+s*along[0]+t*normal[0],
            RAIL_TOP+s*along[1]+t*normal[1])


def back_slab(t0, t1):
    """Center (y, z) and size (along, thickness) of a backrest layer."""
    center = back_point(BACK_LENGTH/2, (t0+t1)/2)
    return center, (BACK_LENGTH, t1-t0)


def back_top():
    """Highest point of the raised back cushion."""
    return back_point(BACK_LENGTH, BOARD_T+BACK_CUSHION_T)[1]


def back_far_y():
    """Farthest +Y reach of the backrest (its lower far corner)."""
    return back_point(BACK_LENGTH, 0)[0]


def leg_centers():
    x = HALF_W-LEG_INSET
    y = HALF_L-LEG_INSET
    return [(sx*x, sy*y) for sx in (-1, 1) for sy in (-1, 1)]


def outer_bounds():
    return (HALF_W, HALF_L, back_top())
