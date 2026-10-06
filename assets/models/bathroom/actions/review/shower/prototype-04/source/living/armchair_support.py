"""Finite near-support area for a rounded rigid hip above a flat cushion."""
import math


def contact_footprint(points):
    if (len(points) < 3 or any(len(p) != 3 or any(not math.isfinite(v) for v in p) for p in points)):
        raise ValueError('Hip support lacks finite contact samples')
    low = [min(p[i] for p in points) for i in range(3)]
    high = [max(p[i] for p in points) for i in range(3)]
    if high[0]-low[0] < .08 or high[1]-low[1] < .12:
        raise ValueError('Hip support footprint lacks width or depth extents')
    planar = sorted({(p[0], p[1]) for p in points})

    def cross(o, a, b):
        return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])

    def half(sequence):
        result = []
        for point in sequence:
            while len(result) >= 2 and cross(result[-2], result[-1], point) <= 0:
                result.pop()
            result.append(point)
        return result

    hull = half(planar)[:-1]+half(reversed(planar))[:-1]
    area = abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(hull, hull[1:]+hull[:1])))/2
    # One quarter of the minimum 0.08 x 0.12 footprint excludes diagonal strips.
    if area < .0024:
        raise ValueError('Hip support neighborhood has insufficient area')
    return {'contact_bounds': [low, high], 'xy_hull_area': area}
