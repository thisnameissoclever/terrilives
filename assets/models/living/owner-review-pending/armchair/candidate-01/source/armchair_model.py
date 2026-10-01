"""Separate low-backed red armchair, fitted to the unchanged seated Sim."""
from build_parts import box, material
from armchair_layout import parts


def build(root):
    palette = {
        'fabric': material('Armchair muted brick', (.39, .16, .125)),
        'cushion': material('Armchair brick cushions', (.47, .21, .16)),
        'wood': material('Armchair walnut feet', (.115, .075, .045)),
    }
    for part in parts():
        obj = box(part['name'], part['center'], part['size'],
                  palette[part['material']], root, part['bevel'])
        obj['supports'] = part['supports']
        obj['grounded'] = part['grounded']
    return {'front': [-1, 0, 0], 'base_footprint': [1, 1], 'seat_height': .47,
            'back_height': 1.06, 'feet': 4, 'body_action': 'sit',
            'occupied_contact_proven': False}
