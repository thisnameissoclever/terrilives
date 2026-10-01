"""Editable sage upholstery in the accepted Sim's toon material family."""
from build_parts import box, material
from sofa_layout import parts


def build(root):
    palette = {
        'fabric': material('Sofa muted sage', (.245, .30, .225)),
        'cushion': material('Sofa sage cushions', (.31, .365, .275)),
        'wood': material('Sofa walnut feet', (.115, .075, .045)),
    }
    for part in parts():
        obj = box(part['name'], part['center'], part['size'],
                  palette[part['material']], root, part['bevel'])
        obj['supports'] = part['supports']
        obj['grounded'] = part['grounded']
    return {'long_axis': 'Y', 'front': [-1, 0, 0], 'base_footprint': [2, 1],
            'seat_height': .56, 'back_height': 1.05, 'feet': 4,
            'seat_cushions': 3, 'back_cushions': 3, 'reclining_animation_proven': False}
