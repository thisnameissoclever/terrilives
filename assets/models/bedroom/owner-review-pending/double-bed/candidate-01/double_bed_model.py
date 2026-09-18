"""Warm oak double bed with supported linen pillows and sage bedding."""
from build_parts import box, material
from double_bed_layout import parts


def build(root):
    palette = {
        'wood': material('Double bed warm oak frame', (.43, .265, .135)),
        'wood_light': material('Double bed inset oak panel', (.51, .33, .18)),
        'linen': material('Double bed warm linen', (.79, .77, .68)),
        'sage': material('Double bed sage duvet', (.30, .43, .37)),
        'sage_light': material('Double bed turned duvet edge', (.39, .52, .45)),
    }
    for part in parts():
        obj = box(part['name'], part['center'], part['size'],
                  palette[part['material']], root, part['bevel'])
        if part['support']:
            obj['support'] = part['support']
    return {'footprint': [2, 2], 'canonical_center': [0, 0, 0],
            'head_end': '+Y', 'foot_end': '-Y', 'mattress_size': [1.60, 1.76, .19],
            'duvet_top': .55, 'sleep_pose_added': False,
            'foreground_added': False, 'slots': 2}
