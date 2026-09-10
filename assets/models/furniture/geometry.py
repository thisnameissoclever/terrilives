"""Shared physical landmarks; one model unit uses the accepted Sim's scale."""
import math

FACINGS = {'SE': 90, 'NW': 270, 'SW': 0, 'NE': 180}
AXLE = (0.0, -.12, .37)
CRANK_RADIUS = .21
HOUSING_HALF_WIDTH = .135
PEDAL_THICKNESS = .035
MAT_TOP = .025
HANDLE_RADIUS = .025
GRIPS = {'L': (-.255, -.365, 1.20), 'R': (.255, -.365, 1.20)}
HIP = (0.0, .16, .86)


def rotate(point, facing):
    x, y, z = point
    if facing == 'SE':
        return -y, x, z
    if facing == 'NW':
        return y, -x, z
    if facing == 'SW':
        return x, y, z
    if facing == 'NE':
        return -x, -y, z
    raise ValueError(f'unknown facing: {facing}')


def pedal(side, phase):
    if side not in ('L', 'R'):
        raise ValueError(f'unknown pedal side: {side}')
    sign = -1 if side == 'L' else 1
    angle = phase * math.tau + (0 if side == 'L' else math.pi)
    return (sign * .205, AXLE[1] + CRANK_RADIUS * math.sin(angle),
            AXLE[2] + CRANK_RADIUS * math.cos(angle))


def towel_section(t):
    """Upright U-shaped cloth section around a Y-axis handle tube, in X/Z."""
    radius = HANDLE_RADIUS + .001
    if .35 <= t <= .65:
        angle = math.pi * (1 - (t - .35) / .30)
        return radius * math.cos(angle), radius * math.sin(angle)
    if t < .35:
        fall = (.35 - t) / .35
        return -radius - .012 * fall * fall, -.33 * fall
    fall = (t - .65) / .35
    return radius + .012 * fall * fall, -.36 * fall
