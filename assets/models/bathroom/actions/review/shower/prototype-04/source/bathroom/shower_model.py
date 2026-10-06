"""Open corner shower with opaque panels and attached satin-metal fittings."""
import bpy
from mathutils import Vector

from build_parts import box, cylinder, material, mesh, tube
from shower_geometry import tray_shell


def build(root):
    ceramic = material('Shower warm ceramic', (.83, .82, .77))
    panel = material('Shower muted blue grey panels', (.57, .64, .64))
    metal = material('Shower satin metal', (.43, .49, .51))
    dark = material('Shower nozzle and drain steel', (.12, .16, .17))
    tray = mesh('Shower recessed tray', *tray_shell(), ceramic, root)
    bevel = tray.modifiers.new('Rounded tray edges', 'BEVEL')
    bevel.width = .008
    bevel.segments = 4
    tray.modifiers.new('Tray weighted normals', 'WEIGHTED_NORMAL')
    box('Shower rear panel', (0, .405, 1.006), (.855, .045, 1.748), panel, root, .008)
    box('Shower side panel', (-.405, 0, 1.006), (.045, .81, 1.748), panel, root, .008)
    for label, x, y in (('corner', -.412, .412), ('left edge', -.405, -.405),
                         ('right edge', .405, .405)):
        cylinder(f'Shower trim {label}', (x, y, .132), (x, y, 1.89), .012, metal, root)
    cylinder('Shower arm flange', (0, .383, 1.68), (0, .357, 1.68), .043, metal, root)
    tube('Shower curved arm', [(0, .36, 1.68), (0, .28, 1.78),
                              (0, .035, 1.78), (0, -.055, 1.735)], .018, metal, root)
    cylinder('Shower head', (0, -.05, 1.75), (0, -.075, 1.71), .082, metal, root)
    cylinder('Shower nozzle face', (0, -.074, 1.712), (0, -.077, 1.706), .073, dark, root)
    box('Shower control plate', (0, .374, 1.02), (.16, .018, .20), metal, root, .012)
    cylinder('Shower control dial', (0, .372, 1.04), (0, .335, 1.04), .032, metal, root)
    cylinder('Shower control lever', (0, .328, 1.04), (0, .328, .96), .009, metal, root)
    cylinder('Shower drain', (.2, .12, .054), (.2, .12, .062), .034, dark, root)
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(p) for obj in root.children_recursive
               for p in obj.bound_box]
    dimensions = [max(p[axis] for p in corners)-min(p[axis] for p in corners)
                  for axis in range(3)]
    return {'front': '-Y', 'tray_floor': .055, 'tray_rim': .135,
            'fixture_bounds_m': dimensions, 'enclosure': 'two opaque panels, open entry',
            'water_animation': False}
