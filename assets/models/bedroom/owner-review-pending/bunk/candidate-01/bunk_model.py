"""Editable oak bunk with two mattresses, guard rails and a supported ladder."""
from build_parts import box, material
from bunk_layout import parts


def build(root):
    palette = {
        'wood': material('Bunk warm oak', (.43, .265, .135)),
        'linen': material('Bunk warm linen', (.79, .77, .68)),
        'sage': material('Bunk sage duvet', (.30, .43, .37)),
        'sage_light': material('Bunk turned duvet edge', (.39, .52, .45)),
    }
    for part in parts():
        obj = box(part['name'], part['center'], part['size'],
                  palette[part['material']], root, part['bevel'])
        if part['support']:
            obj['support'] = part['support']
    return {'footprint_SE': [2, 1], 'canonical_center': [0, 0, 0],
            'head_end': '+Y', 'lower_mattress_top': .46739448,
            'source_views_only': True, 'occupied_review_pending': True}
