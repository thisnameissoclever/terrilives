"""Small wood-cased electronics in the accepted toon material family."""
from build_parts import box, material
from media_layout import parts


def build(root, kind):
    palette = {
        'wood': material('Media warm walnut', (.30, .185, .095)),
        'dark': material('Media charcoal trim', (.055, .065, .065)),
        'glass': material('Media muted glass', (.17, .28, .29)),
        'brass': material('Media aged brass controls', (.39, .31, .16)),
        'vent': material('Media dark ventilation slots', (.024, .029, .029)),
    }
    for part in parts(kind):
        obj = box(part['name'], part['center'], part['size'],
                  palette[part['material']], root, part['bevel'])
        obj['supports'] = part['supports']
        obj['grounded'] = part['grounded']
    return {'front': [0, -1, 0], 'base_footprint': [1, 1], 'feet': 4,
            'power_state': False, 'animated_screen': False, 'kind': kind}
