"""Closed stacked washer and dryer with attached controls and door rims."""
import math

import bpy

from build_parts import box, cylinder, material, mesh
from laundry_geometry import door_ring


def build(root):
    enamel = material('Laundry blue grey enamel', (.52, .56, .58))
    front = material('Laundry warm pale fronts', (.72, .74, .72))
    metal = material('Laundry satin metal', (.43, .49, .51))
    rubber = material('Laundry seals and feet', (.08, .10, .11))
    glass = material('Laundry dark blue opaque window', (.10, .17, .20))
    for x in (-.29, .29):
        for y in (-.28, .28):
            cylinder(f'Laundry foot {x} {y}', (x, y, 0), (x, y, .10), .033, rubber, root)
    for label, base in (('Washer', .08), ('Dryer', .92)):
        box(label+' case', (0, 0, base+.41), (.76, .75, .82), enamel, root, .018)
        box(label+' front panel', (0, -.377, base+.40), (.71, .022, .75), front, root, .015)
        height = base+.35
        cylinder(label+' door seal', (0, -.378, height), (0, -.418, height), .245, rubber, root)
        rim = mesh(label+' door rim', *door_ring(), metal, root)
        rim.rotation_euler.x = math.pi/2
        rim.location = (0, -.412, height)
        bevel = rim.modifiers.new('Rounded door rim', 'BEVEL')
        bevel.width = .006
        bevel.segments = 4
        rim.modifiers.new('Door rim weighted normals', 'WEIGHTED_NORMAL')
        cylinder(label+' dark window', (0, -.414, height), (0, -.428, height), .194, glass, root)
        box(label+' door grip', (.211, -.445, height), (.040, .030, .135), rubber, root, .012)
        box(label+' hinge cover', (-.232, -.407, height), (.060, .032, .13), metal, root, .01)
        box(label+' control strip', (0, -.395, base+.714), (.665, .020, .12), metal, root, .009)
        dial_x = -.02 if label == 'Washer' else -.19
        indicator_x = .19 if label == 'Washer' else .13
        box(label+' indicator', (indicator_x, -.408, base+.716), (.15, .010, .044), glass, root, .004)
        cylinder(label+' dial', (dial_x, -.4, base+.716), (dial_x, -.437, base+.716), .04, rubber, root)
        box(label+' dial marker', (dial_x, -.438, base+.738), (.007, .008, .017), front, root, .002)
        box(label+' rear service panel', (0, .375, base+.40), (.63, .015, .67), metal, root, .012)
    box('Laundry stacking tray', (0, 0, .91), (.75, .74, .04), rubber, root, .007)
    box('Washer detergent drawer', (-.21, -.408, .794), (.15, .012, .077), front, root, .005)
    for z in (1.05, 1.09, 1.13):
        box(f'Dryer rear vent {z}', (0, .386, z), (.30, .010, .008), rubber, root, .002)
    for x in (-.14, .14):
        cylinder(f'Washer rear connector {x}', (x, .374, .68), (x, .407, .68), .026, rubber, root)
    bpy.context.view_layer.update()
    return {'front': '-Y', 'bounds_m': [.76, .867, 1.74], 'stacked_units': 2,
            'door_state': 'closed', 'windows': 'opaque dark material',
            'interaction_animation': False, 'utility_connections': 'not simulated'}
