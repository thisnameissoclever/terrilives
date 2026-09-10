"""Preserve a toon ramp's channel shading ratios while changing its base hue."""


def recolor_stop(stop, source, target):
    if any(channel <= 0 for channel in source[:3]):
        raise ValueError('Source RGB channels must be positive for shading ratios')
    return tuple(stop[index] * target[index] / source[index] for index in range(3)) + (stop[3],)
