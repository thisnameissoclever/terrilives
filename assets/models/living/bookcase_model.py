"""Warm wooden shelving with twenty-four individually editable books."""
from build_parts import box, material
from bookcase_layout import parts


def build(root):
    colours = {'wood': (.24, .135, .070), 'clay': (.38, .16, .11),
               'sage': (.23, .30, .20), 'ochre': (.46, .32, .15),
               'slate': (.15, .24, .29), 'plum': (.26, .16, .20),
               'linen': (.53, .45, .31)}
    palette = {name: material('Bookcase '+name, colour) for name, colour in colours.items()}
    for part in parts():
        obj = box(part['name'], part['center'], part['size'],
                  palette[part['material']], root, part['bevel'])
        obj['supports'] = part['supports']
    return {'base_footprint': [1, 1], 'wall_back_y': .5, 'front': '-Y',
            'maximum_height': 1.54, 'book_rows': 4, 'books': 24,
            'standing_read_animation_unchanged': True}
