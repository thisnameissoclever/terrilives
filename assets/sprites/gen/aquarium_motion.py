"""Reviewed projected fish envelopes, including outline and downsampling padding."""
from PIL import ImageChops
import hashlib
import json
import math
from pathlib import Path
from offline_props import inside


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


def validate_swim_loop(frames, regions):
    if len(frames) != 8 or len(regions) != 3:
        raise ValueError('Swimming loop needs eight samples and three fish envelopes')
    changed = [False]*3
    for frame in frames:
        if frame.size != (192,240) or frame.mode != 'RGBA':
            raise ValueError('Swimming frame registration changed')
        difference = ImageChops.difference(frames[0], frame)
        if difference.getchannel('A').getbbox():
            raise ValueError('Aquarium alpha changes between swimming samples')
        for y in range(frame.height):
            for x in range(frame.width):
                if difference.getpixel((x,y)) == (0,0,0,0):
                    continue
                owners = [i for i,(left,top,right,bottom) in enumerate(regions)
                          if left <= x < right and top <= y < bottom]
                if not owners:
                    raise ValueError(f'Changed pixel outside fish motion at {(x,y)}')
                if len(owners) == 1:
                    changed[owners[0]] = True
    if not all(changed):
        raise ValueError('Swimming loop contains a frozen fish')
    if len({frame.tobytes() for frame in frames}) != 8:
        raise ValueError('Swimming samples are not individually distinct')


def validate_swimming_catalog(sprites, catalog_path):
    path = Path(catalog_path).resolve()
    catalog = json.loads(path.read_text())
    checks = []
    if len(catalog['objects']) != 8:
        raise ValueError('Swimming catalog must contain eight complete samples')
    for frame, entry in enumerate(catalog['objects']):
        if entry['name'] != f'offlineAquariumSwim{frame}':
            raise ValueError('Swimming sample order changed')
        directory = inside(path.parent, entry['directory'])
        raw = (directory/'scene-check.json').read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry['scene_check_sha256']:
            raise ValueError('Reviewed swimming scene checks changed')
        check = json.loads(raw)
        proof = json.loads((directory/'proof.json').read_text())
        if check['state'] != 'passed' or check['model_sha256'] != proof['model_sha256']:
            raise ValueError('Swimming validation belongs to a different model')
        rows = check['visibility']
        expected = {(facing,fish) for facing in REGIONS
                    for fish in ('Amber fish','Blue fish','Coral fish')}
        if len(rows) != 12 or {(r['facing'],r['fish']) for r in rows} != expected:
            raise ValueError('Incomplete fish visibility checks')
        if any(r['lid_blocked_vertices'] != 0 or r['total_vertices'] <= 0 for r in rows):
            raise ValueError('Lid blocks a swimming fish')
        checks.append(rows)
    images = {name:image for name,image,_,_ in sprites}
    for facing in REGIONS:
        regions = []
        for fish in ('Amber fish','Blue fish','Coral fish'):
            bounds = [next(r['pixel_bounds'] for r in rows
                           if r['facing'] == facing and r['fish'] == fish) for rows in checks]
            regions.append((math.floor(min(b[0] for b in bounds)/4)-4,
                            math.floor(min(b[1] for b in bounds)/4)-4,
                            math.ceil(max(b[2] for b in bounds)/4)+4,
                            math.ceil(max(b[3] for b in bounds)/4)+4))
        suffix = '' if facing == 'SE' else facing
        frames = [images[f'offlineAquariumSwim{i}'+suffix] for i in range(8)]
        validate_swim_loop(frames, regions)
        # The released cabinet and glass must also match outside those regions.
        validate_swim_loop([images['offlineAquarium'+suffix], *frames[1:]], regions)
