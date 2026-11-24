"""A level turning platform entirely inside the square pool."""
import pool_activity_layout_v4 as original

LANDING_INNER_Y = .52
LANDING_OUTER_Y = 1.
CREST_LANDING_DEPTH = LANDING_OUTER_Y - LANDING_INNER_Y
CREST_LANDING_Y = (LANDING_OUTER_Y + LANDING_INNER_Y) / 2
LADDER_RAIL_X = (-.84, -.16)
# The original recess spans the complete space between the inner rail faces.
# The exterior uprights stand outside the coping in Y.
TOE_RECESS_X = original.TOE_RECESS_X
INNER_OFFSET = LANDING_INNER_Y - original.LADDER_PATH[0][0]
LADDER_INSIDE_TREADS = tuple((y + INNER_OFFSET, z) for y, z in original.LADDER_INSIDE_TREADS)
LADDER_STRINGERS = tuple(tuple((y + INNER_OFFSET, z) for y, z in flight)
                         for flight in original.LADDER_STRINGERS)
LADDER_PATH = ((LANDING_INNER_Y, .08), (LANDING_INNER_Y, 1.15), (.60, 1.90),
               (CREST_LANDING_Y, 2.15), *original.LADDER_PATH[4:])


def ladder_rail_points(x):
    return [(x, y, z) for y, z in LADDER_PATH]


def recessed_wall_geometry():
    return original.recessed_wall_geometry()
