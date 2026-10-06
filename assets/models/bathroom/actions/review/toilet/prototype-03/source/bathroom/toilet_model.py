"""Warm ceramic toilet with an open seat and a real lid hinge."""
import math

import bpy
from mathutils import Vector

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
    loops = [oval(.145, .26, z, .04) for z in (0, .03)]
    loops += [oval(.105, .18, .23, .045)]
    n = len(loops[0])
    faces = [tuple(reversed(range(n))), tuple(range(2*n, 3*n))]
    for layer in range(2):
        for i in range(n):
            j = (i + 1) % n
            faces.append((layer*n+i, layer*n+j, (layer+1)*n+j, (layer+1)*n+i))
    soften(mesh('Toilet pedestal', [p for loop in loops for p in loop],
                faces, ceramic, root), .009)
    box('Toilet rear ceramic neck', (0, .20, .2775), (.25, .22, .335), ceramic, root, .035)
    box('Toilet upper tank support', (0, .30, .3925), (.25, .14, .155), ceramic, root, .018)
    box('Toilet cistern', (0, .335, .665), (.435, .20, .40), ceramic, root, .035)
    box('Toilet cistern cap', (0, .335, .875), (.455, .22, .035), ceramic, root, .015)
    cylinder('Toilet flush button', (0, .34, .89), (0, .34, .901), .022, metal, root)
    for side in (-1, 1):
        cylinder(f'Toilet seat bumper {side}', (side*.19, -.1, .414),
                 (side*.19, -.1, .42), .012, rubber, root)
        box(f'Toilet hinge mount {side}', (side*.08, .174, .433),
            (.05, .06, .04), metal, root, .008)
    cylinder('Toilet hinge axle', (-.11, .19, .457), (.11, .19, .457), .015, metal, root)
    # The lid is modeled flat, then rigidly rotated around its rear hinge.
    lid_loops = [oval(.21, .282, z) for z in (0, .024)]
    lid_vertices = [(x, y-.19, z) for loop in lid_loops for x, y, z in loop]
    lid_faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    lid_faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
    lid = soften(mesh('Toilet upright lid', lid_vertices, lid_faces,
                      seat_material, root), .008)
    lid.location = (0, .19, .457)
    lid.rotation_euler.x = -math.pi / 2
    # A small still surface sits inside the actual cavity, not over a solid cap.
    pool = oval(.072, .095, .25, -.10)
    mesh('Toilet bowl water', pool, [tuple(range(len(pool)))], water, root)
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(p) for obj in root.children_recursive
               for p in obj.bound_box]
    dimensions = [max(p[axis] for p in corners)-min(p[axis] for p in corners)
                  for axis in range(3)]
    return {'front': '-Y', 'bowl_floor': .245, 'bowl_rim': .415,
            'seat_height': .45, 'lid_pose': 'upright, seat down',
            'fixture_bounds_m': dimensions}
