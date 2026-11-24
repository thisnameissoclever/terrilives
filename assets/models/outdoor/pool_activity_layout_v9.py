"""Rectangular basin and exterior ladder within a three-by-two footprint."""
import pool_activity_layout_v8 as flight

# Keep the ladder coordinates shared with the fitted entry and exit. The
# extra tile extends the water behind the swimmer. Sprite registration uses
# the centre of the complete footprint, including the ladder.
ORIGIN_Y = -.5
WALL = (-.94, .94, -1.94, .39)
LINER = (-.86, .86, -1.86, .31)
COPING = (-.96, .96, -1.96, .41)
OPENING = (-.85, .85, -1.85, .30)
WATER = (-.865, .865, -1.865, .315)


def corners(bounds, z):
    left, right, rear, front = bounds
    return [(left, rear, z), (right, rear, z), (right, front, z), (left, front, z)]


def shell(outer, inner, bottom, top):
    vertices = corners(outer, bottom) + corners(outer, top)
    vertices += corners(inner, bottom) + corners(inner, top)
    faces, materials = [], []
    for index in range(4):
        following = (index + 1) % 4
        faces.extend([
            (index, following, following + 4, index + 4),
            (following + 8, index + 8, index + 12, following + 12),
            (index + 4, following + 4, following + 12, index + 12),
            (following, index, index + 8, following + 8),
        ])
        materials.extend([0, 1, 0, 0])
    return vertices, faces, materials


def surface(bounds, height, columns=1, rows=1):
    left, right, rear, front = bounds
    vertices = [
        (left + i * (right - left) / columns, rear + j * (front - rear) / rows, height)
        for j in range(rows + 1)
        for i in range(columns + 1)
    ]
    stride = columns + 1
    starts = [j * stride + i for j in range(rows) for i in range(columns)]
    faces = [(i, i + 1, i + stride + 1, i + stride) for i in starts]
    return vertices, faces
