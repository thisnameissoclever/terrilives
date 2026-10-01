"""A restrained grey pedal bin with a fitted lid and rounded manufactured edges."""
from build_parts import box, cylinder, material
from trashcan_layout import parts


def build(root):
    palette = {
        'rubber': material('Bin rubber base', (.055, .065, .06)),
        'enamel': material('Bin grey enamel', (.34, .36, .34)),
        'lid': material('Bin pale grey lid', (.42, .445, .42)),
        'dark': material('Bin dark hardware', (.10, .12, .115)),
    }
    for part in parts():
        if part['kind'] == 'cylinder':
            obj = cylinder(part['name'], (0, 0, part['bottom']), (0, 0, part['top']),
                           part['radius'], palette[part['material']], root)
            for face in obj.data.polygons:
                face.use_smooth = len(face.vertices) == 4
        else:
            obj = box(part['name'], part['center'], part['size'],
                      palette[part['material']], root, .008)
        obj['supports'] = part['supports']
    return {'base_footprint': [1, 1], 'maximum_height': .64,
            'closed_lid': True, 'front': '-Y', 'interactive': False}
