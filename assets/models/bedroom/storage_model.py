"""Matched warm-wood storage, closed drawers and supported satin pulls."""
from build_parts import box, material
from storage_layout import parts


def build(root, kind):
    palette = {
        'wood': material('Storage warm oak case', (.43, .265, .135)),
        'top': material('Storage honey oak fronts', (.51, .33, .18)),
        'dark': material('Storage recessed walnut', (.25, .145, .075)),
        'metal': material('Storage satin pewter handles', (.32, .37, .37)),
        'book': material('Bedside muted teal cover', (.11, .25, .25)),
        'paper': material('Bedside cream paper', (.75, .69, .55)),
    }
    for part in parts(kind):
        obj = box(part['name'], part['center'], part['size'],
                  palette[part['material']], root, part['bevel'])
        if part['support']:
            obj['support'] = part['support']
    return {'front': '-Y', 'kind': kind, 'drawer_state': 'closed',
            'interaction_animation': False, 'decorative_only': True}
