"""Reviewed projected fish envelopes, including outline and downsampling padding."""
from PIL import ImageChops


REGIONS = {
    'SE': [(67, 101, 91, 122), (101, 127, 123, 148), (83, 110, 106, 131)],
    'NW': [(101, 124, 125, 145), (69, 104, 91, 125), (86, 113, 109, 133)],
    'SW': [(101, 101, 124, 122), (68, 127, 91, 147), (86, 110, 108, 131)],
    'NE': [(68, 124, 91, 145), (101, 104, 124, 125), (84, 113, 106, 134)],
}


def validate_pair(first, second, facing):
    if first.size != (192, 240) or second.size != first.size or first.mode != 'RGBA' or second.mode != 'RGBA':
        raise ValueError('Aquarium frames must be 192x240 RGBA')
    difference = ImageChops.difference(first, second)
    if difference.getchannel('A').getbbox():
        raise ValueError('Aquarium alpha changes between frames')
    changed = [False, False, False]
    for y in range(first.height):
        for x in range(first.width):
            if difference.getpixel((x, y)) == (0, 0, 0, 0):
                continue
            inside = [i for i, (left, top, right, bottom) in enumerate(REGIONS[facing])
                      if left <= x < right and top <= y < bottom]
            if not inside:
                raise ValueError(f'{facing}: changed pixel outside fish motion at {(x, y)}')
            if len(inside) == 1:
                changed[inside[0]] = True
    if not all(changed):
        raise ValueError(f'{facing}: frozen fish or no independently visible motion')


def validate_aquarium_motion(sprites):
    images = {name: image for name, image, _, _ in sprites}
    for facing in REGIONS:
        suffix = '' if facing == 'SE' else facing
        validate_pair(images['offlineAquarium'+suffix], images['offlineAquariumFrame1'+suffix], facing)
