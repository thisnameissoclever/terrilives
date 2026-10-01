"""Load registered four-sample seating layers with target-specific timing."""
import hashlib
import json
import math
from pathlib import Path
import re

from PIL import Image, ImageChops
from offline_furniture import FurnitureExport
from offline_props import inside

FACINGS = ('SE', 'NW', 'SW', 'NE')
VARIANTS = ('green', 'blue', 'red')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def empty_name(prefix, facing):
    return f"{prefix}{'' if facing == 'SE' else facing}"


def load_seating(manifest_path, *, prefix, half_cycle_ticks, reuse_empty, existing_names=()):
    path = Path(manifest_path).resolve()
    data = json.loads(path.read_text(encoding='utf-8'))
    for key, want in (('version', 1), ('width', 96), ('height', 120), ('pixel_density', 2)):
        if type(data.get(key)) is not int or data[key] != want:
            raise ValueError('Unsupported seating version or registration')
    anchor = data.get('anchor')
    if (not isinstance(anchor, list) or len(anchor) != 2
            or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v-want) > .002
                   for v, want in zip(anchor, (48, 116.00044)))):
        raise ValueError('Seating anchor registration changed')
    sprites, pairs, profiles, bounds = [], {}, {}, {}
    names, cache, shared = set(existing_names), {}, {}
    if reuse_empty and not {empty_name(prefix, f) for f in FACINGS}.issubset(names):
        raise ValueError('Missing existing empty seating sprites')

    def read(ref, contribution):
        if not isinstance(ref, dict):
            raise ValueError('Missing seating image reference')
        for key in ('width', 'height', 'pixel_density', 'anchor'):
            if key in ref and ref[key] != data[key]:
                raise ValueError('Image registration differs from manifest')
        image_path = inside(path.parent, ref.get('path'))
        sha = ref.get('sha256')
        if not isinstance(sha, str) or not re.fullmatch(r'[0-9a-f]{64}', sha):
            raise ValueError('Invalid seating image hash')
        if digest(image_path) != sha:
            raise ValueError('Seating image hash mismatch')
        if sha not in cache:
            with Image.open(image_path) as image:
                if image.format != 'PNG' or image.mode != 'RGBA' or image.size != (192, 240):
                    raise ValueError('Expected seating RGBA PNG at 192x240')
                image.load()
                cache[sha] = image.copy()
        image = cache[sha]
        if contribution:
            alpha = image.getchannel('A')
            if any(ImageChops.subtract(image.getchannel(channel), alpha).getbbox()
                   for channel in ('R', 'G', 'B')):
                raise ValueError('Seating contribution must contain premultiplied RGB')
        return image, sha

    def add(name, image):
        if name in names:
            raise ValueError(f'duplicate seating sprite name: {name}')
        names.add(name)
        sprites.append((name, image, 192, 240))
        return name

    empty = {}
    for row in data.get('empty', []):
        facing = row.get('facing')
        if facing in empty:
            raise ValueError('Duplicate empty seating coverage')
        empty[facing] = row
    if set(empty) != set(FACINGS):
        raise ValueError('Missing or invalid empty seating coverage')
    for facing in FACINGS:
        image, _ = read(empty[facing], False)
        box = image.getchannel('A').getbbox()
        if not box:
            raise ValueError('Empty seating must be visible')
        name = empty_name(prefix, facing)
        if not reuse_empty:
            add(name, image)
            bounds[name] = [v/2 for v in box]
        profiles[name] = {'action': 8, 'halfCycleTicks': half_cycle_ticks,
                          'frames': {variant: [] for variant in VARIANTS}}
    frames = {}
    for row in data.get('frames', []):
        if type(row.get('frame')) is not int:
            raise ValueError('Seating frame sample must be an integer')
        key = (row.get('facing'), row.get('variant'), row['frame'])
        if key in frames:
            raise ValueError('Duplicate occupied seating coverage')
        frames[key] = row
    expected = [(f, v, i) for f in FACINGS for v in VARIANTS for i in range(4)]
    if set(frames) != set(expected):
        raise ValueError('Missing or invalid occupied seating coverage')
    palettes = {}
    for facing, variant, index in expected:
        row = frames[facing, variant, index]
        image, body_sha = read(row.get('body'), True)
        box = image.getchannel('A').getbbox()
        if not box:
            raise ValueError('Occupied seating body must be visible')
        name = add(f'{prefix}{facing}{variant.title()}{index}', image)
        bounds[name] = [v/2 for v in box]
        ownership = {'body_sha': body_sha, 'alpha': image.getchannel('A').tobytes()}
        layers = {}
        for role in ('furniture', 'outline'):
            image, sha = read(row.get(role), True)
            ownership[role] = sha
            key = (role, sha)
            if key not in shared:
                shared[key] = add(f'{prefix}{role.title()}{len(shared)}', image)
            layers[role] = shared[key]
        palettes.setdefault((facing, index), []).append(ownership)
        pairs[name] = layers
        profiles[empty_name(prefix, facing)]['frames'][variant].append(name)
    for group in palettes.values():
        if len({row['body_sha'] for row in group}) != 3:
            raise ValueError('Seating body must contain three shirt palettes')
        if any(len({row[role] for row in group}) != 1 for role in ('alpha', 'furniture', 'outline')):
            raise ValueError('Seating palette changed coverage or furniture/outline ownership')
    return FurnitureExport(sprites, anchor, pairs, profiles, bounds)
