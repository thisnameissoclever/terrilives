"""Editable oak table using the accepted Sim's toon materials."""
from build_parts import box, material
from table_layout import parts


def build(root):
    palette = {
        'oak': material('Dining table warm oak', (.43, .275, .145)),
        'top': material('Dining table oak top', (.49, .325, .18)),
    }
    for part in parts():
        obj = box(part['name'], part['center'], part['size'],
                  palette[part['material']], root, part['bevel'])
        obj['supports'] = part['supports']
        obj['grounded'] = part['grounded']
    return {'long_axis': 'Y', 'base_runtime_long_axis': 'X', 'top_height': .79,
            'base_footprint': [2, 1], 'legs': 4, 'aprons': 4,
            'seated_animation_proven': False}
