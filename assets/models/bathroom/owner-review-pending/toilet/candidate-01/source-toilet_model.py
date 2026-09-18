"""Warm ceramic toilet with an open seat and a real lid hinge."""
import math

import bpy

from build_parts import box, cylinder, material, mesh
from toilet_geometry import bowl_shell, oval, seat_ring


def soften(obj, width):
    bevel = obj.modifiers.new('Soft ceramic edge', 'BEVEL')
    bevel.width = width
    bevel.segments = 4
    obj.modifiers.new('Ceramic weighted normals', 'WEIGHTED_NORMAL')
    return obj


def build(root):
    ceramic = material('Toilet warm ceramic', (.83, .82, .77))
    seat_material = material('Toilet cream seat', (.76, .75, .70))
    metal = material('Toilet satin metal', (.43, .49, .51))
    rubber = material('Toilet seat bumpers', (.22, .235, .22))
    water = material('Toilet still water', (.37, .49, .51))
    soften(mesh('Toilet recessed bowl', *bowl_shell(), ceramic, root), .006)
    soften(mesh('Toilet open seat ring', *seat_ring(), seat_material, root), .007)
    loops = [oval(.145, .20, z, -.025) for z in (0, .03)]
    loops += [oval(.105, .14, .23, -.025)]
    n = len(loops[0])
    faces = [tuple(reversed(range(n))), tuple(range(2*n, 3*n))]
    for layer in range(2):
        for i in range(n):
            j = (i + 1) % n
            faces.append((layer*n+i, layer*n+j, (layer+1)*n+j, (layer+1)*n+i))
    soften(mesh('Toilet pedestal', [p for loop in loops for p in loop],
                faces, ceramic, root), .009)
    box('Toilet rear ceramic neck', (0, .16, .365), (.25, .22, .33), ceramic, root, .045)
    box('Toilet cistern', (0, .255, .665), (.435, .22, .40), ceramic, root, .035)
    box('Toilet cistern cap', (0, .255, .875), (.455, .24, .035), ceramic, root, .015)
    cylinder('Toilet flush button', (0, .27, .89), (0, .27, .901), .022, metal, root)
    for side in (-1, 1):
        cylinder(f'Toilet seat bumper {side}', (side*.19, -.1, .414),
                 (side*.19, -.1, .42), .012, rubber, root)
        box(f'Toilet hinge mount {side}', (side*.08, .159, .433),
            (.05, .05, .04), metal, root, .008)
    cylinder('Toilet hinge axle', (-.11, .159, .457), (.11, .159, .457), .015, metal, root)
    # The lid is modeled flat, then rigidly rotated around its rear hinge.
    lid_loops = [oval(.21, .282, z) for z in (0, .024)]
    lid_vertices = [(x, y-.159, z) for loop in lid_loops for x, y, z in loop]
    lid_faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    lid_faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
    lid = soften(mesh('Toilet upright lid', lid_vertices, lid_faces,
                      seat_material, root), .008)
    lid.location = (0, .159, .457)
    lid.rotation_euler.x = -math.pi / 2
    # A small still surface sits inside the actual cavity, not over a solid cap.
    pool = oval(.072, .095, .25, -.10)
    mesh('Toilet bowl water', pool, [tuple(range(len(pool)))], water, root)
    bpy.context.view_layer.update()
    return {'front': '-Y', 'bowl_floor': .245, 'bowl_rim': .415,
            'seat_height': .45, 'lid_pose': 'upright, seat down',
            'fixture_bounds_m': [.455, .775, 1.006]}
