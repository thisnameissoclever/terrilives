"""Import the completed signed16 shelf pages without changing their packing."""
import base64
import hashlib
import json
from pathlib import Path
from PIL import Image


def load_shelf(path, sprites, anchors, densities, trims):
    path = Path(path)
    manifest = json.loads(path.read_text())
    if manifest['state'] != 'complete' or manifest['registration']['logical_canvas'] != [96, 120]:
        raise ValueError('Incomplete shelf registration')
    receipt = json.loads((path.parent / 'writer-exit.json').read_text())
    if receipt['state'] != 'exited' or receipt.get('exit_code') != 0:
        raise ValueError('Shelf writer has not exited successfully')
    manifest_sha = hashlib.sha256(path.read_bytes()).hexdigest()
    proof = json.loads((path.parent / 'cpu-proof.json').read_text())
    if (receipt.get('proof_sha256') != manifest_sha or proof.get('pass') is not True
            or proof.get('export_manifest_sha256') != manifest_sha):
        raise ValueError('Shelf manifest is not bound to its completed CPU proof and writer')

    def checked_source(row):
        source = (path.parent / row['path']).resolve()
        if not source.is_relative_to(path.parent.resolve()):
            raise ValueError('Shelf source path leaves its immutable export')
        if hashlib.sha256(source.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('Shelf source hash differs')
        return source
    records, positions, page_ids, images = {}, {}, {}, {}
    sheets = []
    for row in manifest['pages']:
        source = checked_source(row)
        image = Image.open(source).convert('RGBA')
        if image.size != (2048, 2048):
            raise ValueError('Shelf page is outside the portable dimensions')
        sheets.append(image)
    origin = manifest['registration']['origin_pixels']
    anchor = [origin[0] / 8, origin[1] / 8 + 21]
    for row in manifest['images']:
        if 'key' not in row:
            continue
        source = checked_source(row)
        image = Image.open(source).convert('RGBA')
        p = row['packed']
        restored = sheets[p['page']].crop((p['x'], p['y'], p['x'] + p['width'], p['y'] + p['height']))
        if image.size != tuple(row['size']) or image.tobytes() != restored.tobytes():
            raise ValueError('Shelf packed image differs from its source')
        index = len(sprites)
        records[row['key']] = index
        sprites.append(('shelfMask_' + row['key'], image, image.width, image.height))
        anchors[index] = anchor
        densities[index] = 2
        positions[index] = (p['x'], p['y'])
        page_ids[index] = p['page']
        if row['key'] not in manifest['bases'].values():
            trims[index] = row['registration']
        images[row['key']] = image
    indices = {row[0]: index for index, row in enumerate(sprites)}
    profiles, coverage = {}, {}
    for facing in ('SE', 'NW', 'SW', 'NE'):
        original = indices['offlineBookcase' + ('' if facing == 'SE' else facing)]
        rows = manifest['rows'][facing]
        if len(rows) != 4 or any(len(states) != 64 for states in rows):
            raise ValueError('Shelf row coverage is incomplete')
        pairs = []
        for states in rows:
            for state, row in enumerate(states):
                if row['state'] != state or (row['high'] is None) != (row['low'] is None):
                    raise ValueError('Shelf signed pair identity differs')
                pairs.append([-1, -1] if row['high'] is None else [records[row['high']], records[row['low']]])
        profiles[original] = dict(base=records[manifest['bases'][facing]], rows=pairs)
        alpha = images[manifest['bases'][facing]].getchannel('A')
        box = alpha.getbbox()
        coverage[original] = dict(size=list(alpha.size), box=list(box),
                                 values=base64.b64encode(alpha.crop(box).tobytes()).decode('ascii'))
    return dict(profiles=profiles, sheets=sheets, positions=positions, pages=page_ids,
                slot_transforms=manifest['slot_transforms'], coverage=coverage)


def shelf_records(path):
    sprites = [('offlineBookcase' + facing, None, 192, 240) for facing in ('', 'NW', 'SW', 'NE')]
    load_shelf(path, sprites, {}, {}, {})
    return sprites[4:]
