"""Pale wood sun lounger with a padded teal cushion and a raised backrest."""
import math

from build_parts import box, cylinder, material
import lounger_layout as L


def back_layer(name, t0, t1, width, mat, root, bevel):
    (y, z), (along, thickness) = L.back_slab(t0, t1)
    obj = box(name, (0, y, z), (width, along, thickness), mat, root, bevel)
    obj.rotation_euler.x = math.radians(L.BACK_ANGLE)
    return obj


def build(root):
    wood = material('Lounger pale wood frame', (.50, .36, .21))
    cushion = material('Lounger muted teal cushion', (.09, .30, .30))

    rail_x = L.HALF_W-L.RAIL_W/2
    for sign in (-1, 1):
        box(f'Lounger side rail {sign}', (sign*rail_x, 0, L.RAIL_Z),
            (L.RAIL_W, L.LENGTH, L.RAIL_H), wood, root, .008)
        box(f'Lounger end rail {sign}', (0, sign*(L.HALF_L-L.RAIL_W/2), L.RAIL_Z),
            (L.WIDTH, L.RAIL_W, L.RAIL_H), wood, root, .008)
    leg_top = L.RAIL_TOP-.01
    for x, y in L.leg_centers():
        box(f'Lounger leg {x:+.2f} {y:+.2f}', (x, y, leg_top/2),
            (L.LEG, L.LEG, leg_top), wood, root, .006)

    deck = L.HINGE_Y+L.HALF_L
    box('Lounger deck board', (0, (L.HINGE_Y-L.HALF_L)/2, L.RAIL_TOP+L.BOARD_T/2),
        (L.BOARD_W, deck, L.BOARD_T), wood, root, .005)
    seat = L.CUSHION_HEAD_Y-L.CUSHION_FOOT_Y
    box('Lounger seat cushion', (0, (L.CUSHION_HEAD_Y+L.CUSHION_FOOT_Y)/2,
        L.BOARD_TOP+L.CUSHION_T/2), (L.CUSHION_W, seat, L.CUSHION_T),
        cushion, root, .028)

    back_layer('Lounger back board', 0, L.BOARD_T, L.BOARD_W, wood, root, .005)
    back_layer('Lounger back cushion', L.BOARD_T, L.BOARD_T+L.BACK_CUSHION_T,
               L.CUSHION_W, cushion, root, .028)
    top_y, top_z = L.back_point(L.PROP_ALONG, .004)
    for x in L.PROP_X:
        cylinder(f'Lounger back prop {x:+.2f}', (x, L.PROP_FOOT_Y, L.RAIL_TOP-.01),
                 (x, top_y, top_z), .012, wood, root)
    half_x, half_y, top = L.outer_bounds()
    return {'footprint': list(L.FOOTPRINT), 'long_axis': 'Y',
            'backrest_end': '+Y', 'outer_bounds': [2*half_x, 2*half_y, top],
            'cushion_top': L.CUSHION_TOP, 'back_angle_degrees': L.BACK_ANGLE,
            'sitting_pose': 'generic chair edge sit'}
