"""Import completed reading and transport actions with exact registered owners."""
import base64
import hashlib
import itertools
import json
from pathlib import Path
import tomllib
from PIL import Image
from content_sprites import model_sprites
from reading_joint_alpha import load_joint

FACINGS = ('SE', 'NW', 'SW', 'NE')

def append_actions(root, sprites, anchors, densities, trims, bounds, tops, coverage):
    root = Path(root)
    content = model_sprites(tomllib.loads((root / 'content/objects.toml').read_text()))
    indices = {row[0]: index for index, row in enumerate(sprites)}
    catalog = json.loads((root / 'assets/models/reading/catalog.json').read_text())
    actual = {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
              for path in (root / 'assets/models/reading').glob('*/export/manifest.json')}
    if actual != catalog['manifests']:
        raise ValueError('Reading source manifest inventory differs from its bound catalogue')
    result = dict(catalog={}, bodies={}, recline={}, layers={}, aliases=set(), joint_ids={}, dropped=[])
    for path in sorted((root / 'assets/models/reading').glob('*/export/manifest.json')):
        manifest = json.loads(path.read_text())
        if manifest.get('spriteMode') == 'normalSprite':
            continue
        receipt = json.loads((path.parent / 'export-process-exit.json').read_text())
        if manifest.get('importable') is not True or receipt['exit_code'] != 0 or receipt['manifest']['sha256'] != hashlib.sha256(path.read_bytes()).hexdigest():
            raise ValueError('Reading action is not bound to a completed exporter')
        if manifest['encoding'] != 'scene-linear-premultiplied-visible-additive' or manifest['pixelDensity'] != 2:
            raise ValueError('Reading action encoding differs')
        if hashlib.sha256((path.parent / manifest['physicalReceipt']['path']).read_bytes()).hexdigest() != manifest['physicalReceipt']['sha256']:
            raise ValueError('Reading physical source receipt differs')
        if any(row['scene']['max_error'] > 6 or row['scene']['p95_error'] > 2 for row in manifest['comparisons']):
            raise ValueError('Reading action beauty exceeds six/two')
        frames = manifest['phases']['count']
        if frames not in (4, 8) or manifest['phases']['cycleTicks'] != 16:
            raise ValueError('Reading action phase schedule differs')
        expected = set(itertools.product(FACINGS, range(frames), range(3)))
        seen, texture_ids, joint_ids, mask_ids = set(), {}, {}, {}
        joint = load_joint(path, manifest)
        for row in manifest['records']:
            key = (row['facing'], row['frame'], row['paletteIndices'][0])
            if key in seen or key not in expected or len(row['owners']) != 1 or len(row['layers']) != 5:
                raise ValueError('Reading action owners or frame identities differ')
            seen.add(key)
            refs = []
            for ref in row['layers']:
                if ref['path'] not in texture_ids:
                    raw = path.parent / ref['path']
                    if not raw.resolve().is_relative_to(path.parent.resolve()) or hashlib.sha256(raw.read_bytes()).hexdigest() != ref['sha256']:
                        raise ValueError('Reading layer hash differs')
                    with Image.open(raw) as source:
                        image = source.convert('RGBA')
                    if hashlib.sha256(image.tobytes()).hexdigest() != ref['pixelsSha256']:
                        raise ValueError('Reading layer decoded pixels differ')
                    index = len(sprites)
                    texture_ids[ref['path']] = index
                    sprites.append(('readingLayer_' + path.parent.parent.name + '_' + ref['pixelsSha256'], image, image.width, image.height))
                    densities[index] = 2
                    trims[index] = ref['trim'][:2]
                    anchors[index] = row['anchor']
                refs.append(texture_ids[ref['path']])
            physical = [round(value * 2) for value in row['canvas']]
            index = len(sprites)
            sprites.append((f'ownedReading_{path.parent.parent.name}_{row["facing"]}_{row["frame"]}_{key[2]}', Image.new('RGBA', physical), *physical))
            result['aliases'].add(index)
            result['layers'][index] = refs
            anchors[index] = row['anchor']; densities[index] = 2
            joint_key = (row['facing'], row.get('sourceFrame', row['frame']))
            if joint_key not in joint_ids:
                joint_ids[joint_key] = len(coverage); coverage.append(joint[joint_key])
            alpha = joint_ids[joint_key]
            result['joint_ids'][index] = alpha
            owner = row['owners'][0]
            ref = owner['coverage']
            if ref['path'] not in mask_ids:
                raw = path.parent / ref['path']
                if hashlib.sha256(raw.read_bytes()).hexdigest() != ref['sha256']:
                    raise ValueError('Reading owner mask hash differs')
                with Image.open(raw) as source:
                    image = source.convert('RGBA').getchannel('A')
                x, y = ref['rawCrop'][:2]
                mask_ids[ref['path']] = len(coverage)
                coverage.append(dict(size=physical, box=[x, y, x + image.width, y + image.height], values=base64.b64encode(image.tobytes()).decode('ascii')))
            scene = dict(sprite=index, alpha=alpha, owners=[dict(coverage=mask_ids[ref['path']],
                marker=[owner['marker'][axis] - row['anchor'][axis] for axis in range(2)])])
            bounds[index] = [value / 2 for value in row['alphaCoverage']['rawCrop']]
            tops[index] = bounds[index][1]
            if manifest['content'] != 'sim':
                original = indices[content[manifest['content']] + ('' if row['facing'] == 'SE' else row['facing'])]
                if manifest['stage'] == 'recline':
                    if manifest.get('exclusive') is not True or manifest['stableSeatIds'] != ['whole_sofa'] or owner['stableSeatId'] != 'whole_sofa':
                        raise ValueError('Recline must have exactly one exclusive whole-sofa owner')
                    profile = result['recline'].setdefault(original, dict(model=manifest['content'], wholeSeatId='whole_sofa', cycleTicks=16, scenes={}))
                    profile['scenes'][row['frame'] * 3 + key[2]] = scene
                    continue
                # These five one-seat rig exports call the bone seat_1; authored physical claims use seat.
                if manifest['stableSeatIds'] != ['seat_1'] or owner['stableSeatId'] != 'seat_1':
                    raise ValueError('Single-seat art identity differs from its explicit physical-seat adapter')
                profile = result['catalog'].setdefault(original, dict(model=manifest['content'], seatIds=['seat'], actions=[3], cycleTicks=16, scenes={}))
                profile['scenes'][(2 * 4 + row['frame']) * 27 + key[2]] = scene
            else:
                action = 'standingRead' if manifest['stage'] == 'standingRead' else 'carry_' + manifest['action']
                profile = result['bodies'].setdefault(action, dict(frameTicks=16 / frames, frames={}))
                profile['frames'][f'{row["facing"]}:{key[2]}'] = profile['frames'].get(f'{row["facing"]}:{key[2]}', []) + [scene]
        if seen != expected:
            raise ValueError('Reading action missing a facing, frame or palette')
    return result


def append_dropped(root, sprites, anchors, densities, bounds, coverage):
    path = Path(root) / 'assets/models/reading/dropped/export/manifest.json'
    manifest = json.loads(path.read_text())
    receipt = json.loads((path.parent / 'export-process-exit.json').read_text())
    if manifest['spriteMode'] != 'normalSprite' or manifest['encoding'] != 'straight-srgb-rgba8' or receipt['exit_code'] != 0 or receipt['manifest']['sha256'] != hashlib.sha256(path.read_bytes()).hexdigest():
        raise ValueError('Dropped book export is not a completed ordinary sprite')
    result = []
    for facing in FACINGS:
        row = next(row for row in manifest['records'] if row['facing'] == facing)
        ref = row['sprite']; raw = path.parent / ref['path']
        if hashlib.sha256(raw.read_bytes()).hexdigest() != ref['sha256']:
            raise ValueError('Dropped book sprite hash differs')
        with Image.open(raw) as source:
            image = source.convert('RGBA')
        if hashlib.sha256(image.tobytes()).hexdigest() != ref['pixelsSha256']:
            raise ValueError('Dropped book pixels differ')
        index = len(sprites)
        sprites.append(('ownedDroppedBook' + facing, image, image.width, image.height))
        anchors[index] = [row['anchor'][axis] - ref['trim'][axis] for axis in range(2)]; densities[index] = 2
        box = image.getchannel('A').getbbox()
        if not box:
            raise ValueError('Dropped book has no visible pixels')
        bounds[index] = [value / 2 for value in box]
        alpha = len(coverage)
        coverage.append(dict(size=list(image.size), box=list(box), values=base64.b64encode(image.getchannel('A').crop(box).tobytes()).decode('ascii')))
        result.append(dict(sprite=index, alpha=alpha))
    return result


def action_records(path):
    root = Path(path).resolve().parents[3]
    content = model_sprites(tomllib.loads((root / 'content/objects.toml').read_text()))
    sprites = [(name + ('' if facing == 'SE' else facing), None, 1, 1)
               for name in content.values() for facing in FACINGS]
    start = len(sprites)
    coverage = []
    append_actions(root, sprites, {}, {}, {}, {}, {}, coverage)
    append_dropped(root, sprites, {}, {}, {}, coverage)
    return sprites[start:]
