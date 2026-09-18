"""Refrigerator local axes match furniture: front -Y, right +X, up +Z."""
import math

HINGE = (.35, -.396)


def door_point(point, degrees):
    x, y, z = point
    angle = math.radians(degrees)
    c, s = math.cos(angle), math.sin(angle)
    return HINGE[0] + c*x - s*y, HINGE[1] + s*x + c*y, z
