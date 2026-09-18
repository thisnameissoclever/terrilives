"""Local -Y is the working face; the oven door pivots about local X."""
import math

HINGE = (0, -.476, .175)


def door_point(point, degrees):
    x, y, z = point
    angle = math.radians(degrees)
    c, s = math.cos(angle), math.sin(angle)
    return x, HINGE[1] + c*y - s*z, HINGE[2] + s*y + c*z
