"""Named oak panels and uninterrupted dark-metal supports."""
from build_parts import box, material
from desk_layout import parts


def build(root):
    palette = {
        'wood': material('Desk warm oak pedestal', (.43, .265, .135)),
        'top': material('Desk honey oak surfaces', (.51, .33, .18)),
        'metal': material('Desk charcoal steel', (.115, .145, .15)),
    }
    for part in parts():
        obj = box(part['name'], part['center'], part['size'],
                  palette[part['material']], root, part['bevel'])
        obj['supports'] = part['supports']
        obj['grounded'] = part['grounded']
    return {'front': '-Y', 'width': 1.86, 'depth': .84, 'top_height': .78,
            'drawer_state': 'closed', 'room_facing': 'SW',
            'seated_animation_proven': False}
