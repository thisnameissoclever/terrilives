"""Editable office-chair geometry using the accepted Sim's toon materials."""
from build_parts import box, cylinder, material
from chair_layout import parts


def build(root):
    palette = {
        'fabric': material('Office chair muted slate upholstery', (.18, .265, .30)),
        'shell': material('Office chair charcoal shell', (.065, .085, .095)),
        'metal': material('Office chair graphite hardware', (.15, .18, .18)),
        'rubber': material('Office chair rubber casters', (.030, .035, .035)),
    }
    for part in parts():
        mat = palette[part['material']]
        if part['shape'] == 'box':
            obj = box(part['name'], part['center'], part['size'], mat, root, part['bevel'])
        else:
            obj = cylinder(part['name'], part['a'], part['b'], part['radius'], mat, root)
        obj['supports'] = part['supports']
        obj['grounded'] = part['grounded']
    return {'front': '-X', 'base_runtime_front': '+Y', 'seat_height': .5675, 'casters': 5,
            'footprint': [1, 1], 'seated_animation_proven': False}
