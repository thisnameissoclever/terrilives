"""Fit a two-position crank to the shipped SE bike's unchanged contact pixels."""
import math

VERTICAL_SCALE = 34.147
# Model origin is at the tile centre. The bike's legacy bottom anchor is 21px below it.
CRANK_X = -.37
CRANK_Y = CRANK_X + 9.5 / 32
CRANK_Z = (.5 - 21 * (CRANK_X + CRANK_Y)) / VERTICAL_SCALE
CRANK = (CRANK_X, CRANK_Y, CRANK_Z)
OFFSET_Y = -4.5 / 32
OFFSET_Z = (-8.5 - 21 * OFFSET_Y) / VERTICAL_SCALE


def project_se(point):
    x, y, z = point
    return (32 * (x - y), -21 * (x + y) - VERTICAL_SCALE * z)


def pedal_target(side, phase):
    sign = -1 if side == 'L' else 1
    angle = math.tau * phase + (0 if side == 'L' else math.pi)
    dy = OFFSET_Y * math.cos(angle) - OFFSET_Z * math.sin(angle)
    dz = OFFSET_Y * math.sin(angle) + OFFSET_Z * math.cos(angle)
    contact = (CRANK_X, CRANK_Y + dy, CRANK_Z + dz)
    # Each shoe's inner sole edge rests on the pedal. The ankle sits above and behind it.
    ankle = (contact[0] + sign * .07, contact[1] + .04, contact[2] + .10)
    return ankle, contact
