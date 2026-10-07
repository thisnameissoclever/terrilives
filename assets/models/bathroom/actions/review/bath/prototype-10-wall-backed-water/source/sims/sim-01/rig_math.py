"""Deterministic joint planning, independent of Blender."""
import math


def blend(value, low, high):
    t = max(0.0, min(1.0, (value - low) / (high - low)))
    return t * t * (3 - 2 * t)


def knee_point(hip, ankle, upper, lower, bend=-1):
    dy, dz = ankle[0] - hip[0], ankle[1] - hip[1]
    distance = math.hypot(dy, dz)
    if not abs(upper - lower) < distance < upper + lower + 1e-6:
        raise ValueError(f'Unreachable two-link target: {distance}, lengths {upper}, {lower}')
    along = (upper * upper - lower * lower + distance * distance) / (2 * distance)
    height = math.sqrt(max(0, upper * upper - along * along))
    return (hip[0] + along * dy / distance + bend * height * -dz / distance,
            hip[1] + along * dz / distance + bend * height * dy / distance)


def walk_ankle(phase):
    phase %= 1.0
    stride = .50
    if phase < .5:
        return (-stride / 2 + stride * phase * 2, .13)
    swing = (phase - .5) * 2
    return (stride / 2 - stride * swing, .13 + .075 * math.sin(math.pi * swing))


def walk_hip(phase):
    return .808+.042*math.sin(phase*math.tau)**2
