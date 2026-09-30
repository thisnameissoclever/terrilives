"""Editable dining chair with the existing toon shading and softened wood edges."""
from build_parts import box, material
from chair_layout import parts


def build(root):
    palette = {
        'oak': material('Dining chair warm oak', (.43, .275, .145)),
        'seat': material('Dining chair oak seat', (.49, .325, .18)),
    }
    for part in parts():
        obj = box(part['name'], part['center'], part['size'],
                  palette[part['material']], root, part['bevel'])
        obj['supports'] = part['supports']
        obj['grounded'] = part['grounded']
    return {'front': '-X', 'base_runtime_front': '+Y', 'seat_height': .535,
            'footprint': [1, 1], 'legs': 4, 'back_rails': 3,
            'seated_animation_proven': False}
