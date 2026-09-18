"""Ceramic shell geometry, independent of Blender materials and camera."""
import math


def oval(half_x, half_y, z, shift_y=-.10, segments=64):
    return [(half_x * math.cos(i * math.tau / segments),
             shift_y + half_y * math.sin(i * math.tau / segments), z)
            for i in range(segments)]


def bowl_shell():
    loops = [oval(.215, .29, .415), oval(.165, .23, .415),
             oval(.08, .105, .245), oval(.135, .19, .21, -.06)]
    n = len(loops[0])
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces += [(i, j, n+j, n+i), (n+i, n+j, 2*n+j, 2*n+i),
                  (i, 3*n+i, 3*n+j, j)]
    faces += [tuple(range(2*n, 3*n)), tuple(reversed(range(3*n, 4*n)))]
    return [point for loop in loops for point in loop], faces


def seat_ring():
    loops = [oval(.218, .293, .45), oval(.163, .228, .45),
             oval(.218, .293, .419), oval(.163, .228, .419)]
    n = len(loops[0])
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces += [(i, j, n+j, n+i), (i, 2*n+i, 2*n+j, j),
                  (n+i, n+j, 3*n+j, 3*n+i),
                  (2*n+i, 3*n+i, 3*n+j, 2*n+j)]
    return [point for loop in loops for point in loop], faces
