"""Import a checked center-reader preview without activating incomplete sofa art."""
import base64
import hashlib
import itertools
import json
from pathlib import Path
from PIL import Image
from reading_joint_alpha import load_joint


def load_subset(path):
    path = Path(path)
    manifest = json.loads(path.read_text())
    receipt = json.loads((path.parent / 'export-process-exit.json').read_text())
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    if (manifest.get('state') != 'complete_subset' or manifest.get('importable') is not True
            or receipt.get('exit_code') != 0 or receipt.get('manifest', {}).get('sha256') != sha):
        raise ValueError('Reader subset is not bound to a completed writer')
    if (manifest['encoding'] != 'scene-linear-premultiplied-visible-additive'
            or manifest['pixelDensity'] != 2 or manifest['stableSeatIds'] != ['seat_1', 'seat_2', 'seat_3']
            or manifest['actions'] != [0, 2, 0] or manifest['sceneKey'] != 6
            or manifest['layerOrder'] != ['furniture', 'body0', 'body1', 'body2', 'sharedInk']
            or manifest['phases']['cycleTicks'] != 16 or manifest['phases']['phaseTicks'] != [0, 4, 8, 12]):
        raise ValueError('Reader subset contract differs')
    physical = (path.parent / manifest['physicalReceipt']['path']).resolve()
    if hashlib.sha256(physical.read_bytes()).hexdigest() != manifest['physicalReceipt']['sha256']:
        raise ValueError('Reader physical receipt differs')
    expected = set(itertools.product(('SE', 'NW', 'SW', 'NE'), range(4), range(3)))
    seen, images = set(), {}
    for row in manifest['records']:
        key = (row['facing'], row['frame'], row['paletteIndices'][1])
        if key in seen or key not in expected or row['owners'][0] is not None or row['owners'][2] is not None:
            raise ValueError('Reader subset occupancy is missing or duplicated')
        seen.add(key)
        if row['owners'][1]['stableSeatId'] != 'seat_2' or len(row['layers']) != 5:
            raise ValueError('Reader visible owner differs')
        for ref in row['layers'] + [row['alphaCoverage'], row['owners'][1]['coverage']]:
            source = (path.parent / ref['path']).resolve()
            if not source.is_relative_to(path.parent.resolve()) or hashlib.sha256(source.read_bytes()).hexdigest() != ref['sha256']:
                raise ValueError('Reader texture path or hash differs')
            if ref['path'] not in images:
                with Image.open(source) as raw:
                    if raw.mode != 'RGBA' or raw.size != (ref['width'], ref['height']):
                        raise ValueError('Reader crop dimensions differ')
                    image = raw.copy()
                if hashlib.sha256(image.tobytes()).hexdigest() != ref['pixelsSha256']:
                    raise ValueError('Reader texture pixels differ')
                images[ref['path']] = image
    if seen != expected:
        raise ValueError('Reader subset does not cover every declared phase, palette and facing')
    if any(row['scene']['max_error'] > 6 or row['scene']['p95_error'] > 2 for row in manifest['comparisons']):
        raise ValueError('Reader beauty comparison exceeds six/two')
    return manifest, images


def append_subset(path, sprites, anchors, densities, trims, bounds, tops, coverage):
    manifest, images = load_subset(path)
    joint = load_joint(path, manifest)
    indices = {row[0]: index for index, row in enumerate(sprites)}
    texture_ids, refs = {}, {}
    for row in manifest['records']:
        for ref in row['layers']:
            refs.setdefault(ref['path'], ref)
    for name, ref in sorted(refs.items()):
        image = images[name]
        index = len(sprites)
        texture_ids[name] = index
        sprites.append(('readerSubsetLayer_' + ref['pixelsSha256'], image, image.width, image.height))
        densities[index] = 2
        trims[index] = ref['trim'][:2]
    catalog, layers, aliases, joint_ids = {}, {}, set(), {}
    joint_masks = {}
    mask_ids = {}
    def mask(ref, full_layers=None):
        key = ('sum', tuple(layer['path'] for layer in full_layers)) if full_layers else ref['path']
        if key in mask_ids:
            return mask_ids[key]
        size = [320, 352]
        if full_layers:
            values = [0] * (size[0] * size[1])
            for layer in full_layers:
                alpha = images[layer['path']].getchannel('A')
                x, y = layer['rawCrop'][:2]
                for py in range(alpha.height):
                    for px in range(alpha.width):
                        values[(py + y) * size[0] + px + x] += alpha.getpixel((px, py))
            data = b''.join(value.to_bytes(2, 'little') for value in values)
            record = dict(size=size, box=[0, 0, *size], values=base64.b64encode(data).decode('ascii'), bitDepth=16)
        else:
            image = images[ref['path']].getchannel('A')
            x, y = ref['rawCrop'][:2]
            record = dict(size=size, box=[x, y, x + image.width, y + image.height],
                          values=base64.b64encode(image.tobytes()).decode('ascii'))
        mask_ids[key] = len(coverage)
        coverage.append(record)
        return mask_ids[key]
    for row in manifest['records']:
        phase, palette = row['frame'], row['paletteIndices'][1]
        index = len(sprites)
        sprites.append((f'readerSubset_{row["facing"]}_{palette}_{phase}', Image.new('RGBA', (320, 352)), 320, 352))
        aliases.add(index)
        anchors[index] = row['anchor']; densities[index] = 2
        layers[index] = [texture_ids[ref['path']] for ref in row['layers']]
        for layer in layers[index]:
            anchors[layer] = row['anchor']
        joint_key = (row['facing'], row.get('sourceFrame', row['frame']))
        if joint_key not in joint_masks:
            joint_masks[joint_key] = len(coverage)
            coverage.append(joint[joint_key])
        alpha = joint_masks[joint_key]
        joint_ids[index] = alpha
        owner = row['owners'][1]
        marker = [owner['marker'][axis] - row['anchor'][axis] for axis in range(2)]
        scene = dict(sprite=index, alpha=alpha, owners=[None, dict(coverage=mask(owner['coverage']), marker=marker), None])
        original = indices['offlineLongSofa' + ('' if row['facing'] == 'SE' else row['facing'])]
        profile = catalog.setdefault(original, dict(model=manifest['content'], seatIds=manifest['stableSeatIds'], cycleTicks=16, scenes={}))
        profile['scenes'][(6 * 4 + phase) * 27 + 3 * palette] = scene
        crop = row['alphaCoverage']['rawCrop']
        bounds[index] = [value / 2 for value in crop]
        tops[index] = crop[1] / 2
    return dict(catalog=catalog, layers=layers, aliases=aliases, joint_ids=joint_ids)


def subset_records(path):
    sprites = [('offlineLongSofa' + facing, None, 320, 352) for facing in ('', 'NW', 'SW', 'NE')]
    append_subset(path, sprites, {}, {}, {}, {}, {}, [])
    return sprites[4:]
