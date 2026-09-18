"""Mesh data for the stacked laundry unit's circular door rims."""
import math


def door_ring():
    count = 96
    vertices = [(radius * math.cos(i * math.tau / count),
                 radius * math.sin(i * math.tau / count), z)
                for radius, z in ((.238, 0), (.238, .035), (.19, .035), (.19, 0))
                for i in range(count)]
    faces = []
    for ring in range(4):
        next_ring = (ring + 1) % 4
        for i in range(count):
            j = (i + 1) % count
            faces.append((ring*count+i, ring*count+j,
                          next_ring*count+j, next_ring*count+i))
    return vertices, faces
