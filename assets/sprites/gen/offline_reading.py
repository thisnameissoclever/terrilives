"""Import completed reading and transport actions with exact registered owners."""
import base64
import hashlib
import itertools
import json
import math
from pathlib import Path
import tomllib
from PIL import Image
from content_sprites import model_sprites
from reading_joint_alpha import load_joint
from reading_stock_import import StockTableImporter, stock_scene

FACINGS = ('SE', 'NW', 'SW', 'NE')
SOFA_SEATS = ('seat_1', 'seat_2', 'seat_3')
SOFA_PALETTES = ('green', 'blue', 'red')


def sofa_actions(scene):
    return tuple(scene // (3 ** place) % 3 for place in range(3))


def sofa_record_key(row):
    return row['facing'], row['sceneKey'], row['frame'], tuple(row['paletteIndices'])


def validate_sofa_records(manifest):
    """Require every occupied action/palette tuple and explicit source geometry."""
    if (manifest['content'] != 'long_sofa' or manifest['stableSeatIds'] != list(SOFA_SEATS)
            or manifest['phases']['count'] != 4
            or manifest.get('layerOrder') != ['furniture', 'body0', 'body1', 'body2', 'sharedInk']):
        raise ValueError('Shared sofa requires three stable seats and registered owner layers')
    aliases = manifest['phases'].get('sourceAliases')
    if (not isinstance(aliases, list) or len(aliases) != 4
            or any(type(value) is not int or not 0 <= value < 4 for value in aliases)):
        raise ValueError('Shared sofa source phase aliases differ')
    expected = {(facing, scene, frame, palette)
                for facing, scene, frame in itertools.product(FACINGS, range(27), range(4))
                for palette in itertools.product(*(range(3) if action else (0,) for action in sofa_actions(scene)))}
    seen, appearances = set(), {}
    for row in manifest['records']:
        scene, frame, palettes = row.get('sceneKey'), row.get('frame'), row.get('paletteIndices')
        if (type(scene) is not int or not 0 <= scene < 27
                or type(frame) is not int or not 0 <= frame < 4
                or not isinstance(palettes, list) or len(palettes) != 3
                or any(type(value) is not int or not 0 <= value < 3 for value in palettes)):
            raise ValueError('Shared sofa action, phase or palette identity differs')
        actions = sofa_actions(scene)
        if (row.get('actions') != list(actions)
                or any(type(value) is not int for value in row['actions'])
                or ('sourceScene' in row and type(row['sourceScene']) is not int)
                or row.get('sourceScene', scene) != scene
                or type(row.get('sourceFrame')) is not int
                or row['sourceFrame'] != scene * 4 + aliases[frame]):
            raise ValueError('Shared sofa source must retain its exact actions and declared phase aliases')
        owners = row.get('owners')
        if (not isinstance(owners, list) or len(owners) != 3 or len(row['layers']) != 5
                or any((owner is None) != (action == 0)
                       or (owner is not None and owner.get('stableSeatId') != SOFA_SEATS[place])
                       for place, (owner, action) in enumerate(zip(owners, actions)))):
            raise ValueError('Shared sofa visible owners differ from occupied stable seats')
        key = sofa_record_key(row)
        if key not in expected or key in seen:
            raise ValueError('Shared sofa occupancy/palette identity is invalid or duplicated')
        seen.add(key)
        appearance = tuple(row.get(field) for field in ('layers', 'owners', 'canvas', 'anchor', 'alphaCoverage', 'ownerSources', 'composition'))
        source_key = row['facing'], row['sourceFrame'], tuple(palettes)
        if appearances.setdefault(source_key, appearance) != appearance:
            raise ValueError('Shared sofa source phase aliases change appearance or ownership')
    if seen != expected:
        raise ValueError('Shared sofa requires all 27 states, facings, phases and occupied palettes')
    return sorted(manifest['records'], key=sofa_record_key)


def validate_sofa_crop(ref, physical):
    """All visible and picking contributions use the same integer pixel registration."""
    crop, width, height = ref.get('rawCrop'), ref.get('width'), ref.get('height')
    if (not isinstance(crop, list) or len(crop) != 4 or any(type(value) is not int for value in crop)
            or type(width) is not int or type(height) is not int
            or crop[2] - crop[0] != width or crop[3] - crop[1] != height
            or not 0 <= crop[0] < crop[2] <= physical[0]
            or not 0 <= crop[1] < crop[3] <= physical[1]
            or ref.get('trim') != [value / 2 for value in (crop[0], crop[1], width, height)]):
        raise ValueError('Shared sofa crop registration differs')


def validate_sofa_witnesses(manifest, rows):
    """Derived palettes bind each body to an independently rendered uniform witness."""
    sources = {(row['facing'], row['sourceFrame']) for row in rows}
    expected = {(facing, frame, palette) for facing, frame in sources for palette in range(3)}
    witnesses = {}
    for witness in manifest.get('comparisons', []):
        palette = witness.get('palette')
        if type(palette) is not str or palette not in SOFA_PALETTES:
            raise ValueError('Shared sofa comparison palette identity differs')
        key = witness.get('facing'), witness.get('sourceFrame'), SOFA_PALETTES.index(palette)
        metrics = witness.get('scene', {})
        if (type(witness.get('sourceFrame')) is not int or type(witness.get('sceneKey')) is not int
                or witness['sceneKey'] != witness['sourceFrame'] // 4
                or key not in expected or key in witnesses or witness.get('kind') != 'actualUniform'
                or len(witness.get('layers', [])) != 5 or not isinstance(witness.get('sourceBeauty'), dict)
                or any(type(metrics.get(field)) not in (int, float) or not math.isfinite(metrics[field])
                       for field in ('max_error', 'p95_error', 'active_pixels'))
                or not 0 <= metrics['max_error'] <= 6 or not 0 <= metrics['p95_error'] <= 2
                or metrics['active_pixels'] <= 0):
            raise ValueError('Shared sofa comparison source or fidelity evidence differs')
        witnesses[key] = witness
    if set(witnesses) != expected:
        raise ValueError('Shared sofa requires exact nonempty rendered source/palette comparison coverage')
    for row in rows:
        sources = row.get('ownerSources')
        if not isinstance(sources, list) or len(sources) != 3:
            raise ValueError('Shared sofa derived owner source bindings are missing')
        occupied = [palette for action, palette in zip(row['actions'], row['paletteIndices']) if action]
        composition = 'actualUniform' if len(set(occupied)) <= 1 else 'derivedIndependentPalette'
        if row.get('composition') != composition:
            raise ValueError('Shared sofa actual and derived composition evidence differs')
        geometry = row['facing'], row['sourceFrame']
        for palette in range(3):
            witness = witnesses[(*geometry, palette)]
            density, beauty = witness.get('sourceDensity'), witness['sourceBeauty']
            if (type(density) is not int or density < 2 or witness.get('canvas') != row['canvas']
                    or witness.get('anchor') != row['anchor']
                    or witness.get('owners') != row['owners']
                    or type(beauty.get('width')) is not int or type(beauty.get('height')) is not int
                    or [beauty['width'], beauty['height']] != [value * density for value in row['canvas']]):
                raise ValueError('Shared sofa actual beauty registration or ownership differs')
        for place, (action, palette, source) in enumerate(zip(row['actions'], row['paletteIndices'], sources)):
            if action == 0:
                if source is not None:
                    raise ValueError('Shared sofa empty seat has a rendered body source')
                continue
            expected_source = dict(facing=geometry[0], sourceFrame=geometry[1], palette=SOFA_PALETTES[palette], place=place)
            witness = witnesses[(*geometry, palette)]
            if source != expected_source or row['layers'][place + 1] != witness['layers'][place + 1]:
                raise ValueError('Shared sofa body differs from its rendered owner/palette source')
        if any(row['layers'][place] != witnesses[(*geometry, 0)]['layers'][place] for place in (0, 4)):
            raise ValueError('Shared sofa shared layers differ from their rendered geometry source')
    return witnesses


def validate_sofa_registration(row, padding, static):
    if (not isinstance(padding, list) or len(padding) != 4
            or any(type(value) is not int or value < 0 for value in padding)):
        raise ValueError('Shared sofa requires explicit nonnegative canvas padding')
    canvas, anchor = row.get('canvas'), row.get('anchor')
    expected_canvas = [static['canvas'][0] + padding[0] + padding[2], static['canvas'][1] + padding[1] + padding[3]]
    expected_anchor = [static['anchor'][0] + padding[0], static['anchor'][1] + padding[1]]
    if (not isinstance(canvas, list) or len(canvas) != 2
            or any(type(value) is not int or value <= 0 for value in canvas) or canvas != expected_canvas
            or not isinstance(anchor, list) or len(anchor) != 2
            or any(type(value) not in (int, float) or not math.isfinite(value)
                   or abs(value - expected) > .0001 for value, expected in zip(anchor, expected_anchor))):
        raise ValueError('Shared sofa occupied canvas or anchor differs from its static facing registration')
    for owner in row['owners']:
        if owner is not None and (not isinstance(owner.get('marker'), list) or len(owner['marker']) != 2
                or any(type(value) not in (int, float) or not math.isfinite(value) for value in owner['marker'])):
            raise ValueError('Shared sofa visible owner marker is invalid')


def append_sofa(path, manifest, content, indices, sprites, anchors, densities, trims,
                bounds, tops, coverage, result):
    """Import complete scenes; empty-seat palettes alias the same registered geometry."""
    rows = validate_sofa_records(manifest)
    witnesses = validate_sofa_witnesses(manifest, rows)
    static = {}
    for facing in FACINGS:
        original = indices[content['long_sofa'] + ('' if facing == 'SE' else facing)]
        density = densities.get(original)
        if original not in anchors or type(density) not in (int, float) or not math.isfinite(density) or density <= 0:
            raise ValueError('Shared sofa static facing registration is missing')
        static[facing] = dict(canvas=[value / density for value in sprites[original][2:]], anchor=anchors[original])
        declared = manifest.get('sofaAnchor')
        if (not isinstance(declared, list) or len(declared) != 2
                or any(type(value) not in (int, float) or not math.isfinite(value)
                       or abs(value - expected) > .0001 for value, expected in zip(declared, anchors[original]))):
            raise ValueError('Shared sofa declared anchor differs from its static facing')
    for row in rows:
        validate_sofa_registration(row, manifest.get('canvasPadding'), static[row['facing']])
    joint = load_joint(path, manifest)
    images, references, textures, masks, alpha_ids, placeholders = {}, {}, {}, {}, {}, {}

    def image(ref, retain=True):
        previous = references.setdefault(ref['path'], ref)
        if previous != ref:
            raise ValueError('Shared sofa texture has conflicting metadata')
        if ref['path'] in images:
            return images[ref['path']] if retain else images[ref['path']].copy()
        else:
            raw = (path.parent / ref['path']).resolve()
            if not raw.is_relative_to(path.parent.resolve()) or hashlib.sha256(raw.read_bytes()).hexdigest() != ref['sha256']:
                raise ValueError('Shared sofa texture path or hash differs')
            with Image.open(raw) as source:
                if source.mode != 'RGBA' or source.size != (ref['width'], ref['height']):
                    raise ValueError('Shared sofa crop dimensions differ')
                decoded = source.copy()
            if hashlib.sha256(decoded.tobytes()).hexdigest() != ref['pixelsSha256']:
                raise ValueError('Shared sofa decoded pixels differ')
            if retain:
                images[ref['path']] = decoded
            return decoded

    for row in rows:
        physical = [round(value * 2) for value in row['canvas']]
        refs = []
        for ref in row['layers']:
            decoded = image(ref)
            validate_sofa_crop(ref, physical)
            if ref['path'] not in textures:
                index = len(sprites)
                textures[ref['path']] = index
                registration = '_'.join(str(value) for value in ref['rawCrop'])
                sprites.append(('readingLayer_' + path.parent.parent.name + '_' + ref['pixelsSha256'] + '_' + registration,
                                decoded, *decoded.size))
                densities[index] = 2; trims[index] = ref['trim'][:2]; anchors[index] = row['anchor']
            elif anchors[textures[ref['path']]] != row['anchor']:
                raise ValueError('Shared sofa layer registration differs between scenes')
            refs.append(textures[ref['path']])
        if any(row['actions'][place] == 0 and image(row['layers'][place + 1]).getchannel('A').getbbox()
               for place in range(3)):
            raise ValueError('Shared sofa empty seat retains visible body pixels')
        image(row['alphaCoverage'])
        validate_sofa_crop(row['alphaCoverage'], physical)
        source_key = row['facing'], row['sourceFrame']
        if joint[source_key]['size'] != physical:
            raise ValueError('Shared sofa joint coverage registration differs')
        if source_key not in alpha_ids:
            alpha_ids[source_key] = len(coverage); coverage.append(joint[source_key])
        alpha = alpha_ids[source_key]
        owners = []
        for owner in row['owners']:
            if owner is None:
                owners.append(None)
                continue
            ref = owner['coverage']; decoded = image(ref).getchannel('A')
            validate_sofa_crop(ref, physical)
            x, y = ref['rawCrop'][:2]
            if x < 0 or y < 0 or x + decoded.width > physical[0] or y + decoded.height > physical[1] or not decoded.getbbox():
                raise ValueError('Shared sofa visible owner coverage is empty or outside its scene')
            mask_key = ref['path'], tuple(physical)
            if mask_key not in masks:
                masks[mask_key] = len(coverage)
                coverage.append(dict(size=physical, box=[x, y, x + decoded.width, y + decoded.height],
                                     values=base64.b64encode(decoded.tobytes()).decode('ascii')))
            owners.append(dict(coverage=masks[mask_key], marker=[owner['marker'][axis] - row['anchor'][axis] for axis in range(2)]))
        index = len(sprites)
        palette = row['paletteIndices']; palette_key = palette[0] + 3 * palette[1] + 9 * palette[2]
        size = tuple(physical)
        if size not in placeholders:
            placeholders[size] = Image.new('RGBA', physical)
        sprites.append((f'ownedReading_{path.parent.parent.name}_{row["sceneKey"]}_{row["facing"]}_{row["frame"]}_{palette_key}', placeholders[size], *physical))
        result['aliases'].add(index); result['layers'][index] = refs; result['joint_ids'][index] = alpha
        anchors[index] = row['anchor']; densities[index] = 2
        bounds[index] = [value / 2 for value in row['alphaCoverage']['rawCrop']]; tops[index] = bounds[index][1]
        original = indices[content['long_sofa'] + ('' if row['facing'] == 'SE' else row['facing'])]
        profile = result['catalog'].setdefault(original, dict(model='long_sofa', seatIds=list(SOFA_SEATS), actions=[3, 8], cycleTicks=16, scenes={}))
        scene = dict(sprite=index, alpha=alpha, owners=owners)
        for expanded in itertools.product(*(range(3) if action == 0 else (palette[place],)
                                            for place, action in enumerate(row['actions']))):
            runtime_key = (row['sceneKey'] * 4 + row['frame']) * 27 + expanded[0] + 3 * expanded[1] + 9 * expanded[2]
            if runtime_key in profile['scenes']:
                raise ValueError('Shared sofa runtime scene identity is duplicated')
            profile['scenes'][runtime_key] = scene
    for witness in witnesses.values():
        image(witness['sourceBeauty'], retain=False).close()


def validate_reach_frames(manifest):
    """Each shelf slot owns four source poses; returning visits them in reverse."""
    stage = manifest['stage']
    if stage not in ('fetch', 'shelve'):
        return
    for row in manifest['records']:
        slot, phase, source = row.get('slot'), row.get('frame'), row.get('sourceFrame')
        if (type(slot) is not int or not 0 <= slot < 24
                or type(phase) is not int or not 0 <= phase < 4
                or type(source) is not int
                or source != slot * 4 + (phase if stage == 'fetch' else 3 - phase)):
            raise ValueError('Book reach source frame must identify its exact slot and ordered phase')
        if type(row.get('suppressStock')) is not bool or row['suppressStock'] != (source % 4 >= 2):
            raise ValueError('Book reach stock ownership differs from its source phase')


def reuse_reach_coverage(coverage, cache, record):
    """Reverse journeys can share bytes while retaining distinct source identities."""
    key = (tuple(record['size']), tuple(record['box']), record['encoding'], record['values'])
    if key not in cache:
        cache[key] = len(coverage)
        coverage.append(record)
    return cache[key]


def append_actions(root, sprites, anchors, densities, trims, bounds, tops, coverage):
    root = Path(root)
    content = model_sprites(tomllib.loads((root / 'content/objects.toml').read_text()))
    indices = {row[0]: index for index, row in enumerate(sprites)}
    catalog = json.loads((root / 'assets/models/reading/catalog.json').read_text())
    actual = {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
              for path in (root / 'assets/models/reading').glob('*/export/manifest.json')}
    if actual != catalog['manifests']:
        raise ValueError('Reading source manifest inventory differs from its bound catalogue')
    stock_importer = StockTableImporter(sprites, anchors, densities, trims)
    result = dict(catalog={}, bodies={}, recline={}, reaches={},
                  reach_shelves=dict(scenes={}, tables=stock_importer.tables), layers={}, aliases=set(), joint_ids={}, dropped=[])
    reach_alpha_ids = {}
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
        if manifest['content'] == 'long_sofa' and manifest['stage'] != 'recline':
            append_sofa(path, manifest, content, indices, sprites, anchors, densities, trims,
                        bounds, tops, coverage, result)
            continue
        reach = manifest['stage'] in ('fetch', 'shelve')
        if reach and (manifest['content'] != 'bookshelf' or manifest.get('slots') != 24 or frames != 4):
            raise ValueError('Book reach requires the authored 24-slot bookcase and four phases')
        expected = set(itertools.product(FACINGS, range(frames), range(3), range(24))) if reach else set(itertools.product(FACINGS, range(frames), range(3)))
        seen, texture_ids, joint_ids, mask_ids = set(), {}, {}, {}
        validate_reach_frames(manifest)
        stock_tables = stock_importer.manifest(path.parent, manifest) if reach else {}
        joint = load_joint(path, manifest)
        for row in manifest['records']:
            key = (row['facing'], row['frame'], row['paletteIndices'][0])
            if reach:
                key += (row['slot'],)
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
            identity = f'_{row["slot"]}' if reach else ''
            sprites.append((f'ownedReading_{path.parent.parent.name}{identity}_{row["facing"]}_{row["frame"]}_{key[2]}', Image.new('RGBA', physical), *physical))
            result['aliases'].add(index)
            result['layers'][index] = refs
            anchors[index] = row['anchor']; densities[index] = 2
            joint_key = (row['facing'], row.get('sourceFrame', row['frame']))
            if joint_key not in joint_ids:
                if reach:
                    joint_ids[joint_key] = reuse_reach_coverage(coverage, reach_alpha_ids, joint[joint_key])
                else:
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
                if reach:
                    if not isinstance(row.get('suppressStock'), bool):
                        raise ValueError('Book reach must declare selected stock visibility')
                    if original in anchors and any(abs(anchors[original][axis] - manifest['shelfAnchor'][axis]) > .0001 for axis in range(2)):
                        raise ValueError('Book reach changes the canonical shelf registration')
                    result['reach_shelves']['scenes'][index] = stock_scene(row, manifest, stock_tables)
                    profile = result['reaches'].setdefault(original, dict(model=manifest['content'], slots=24, phases=4, scenes={}))
                    stage = 6 if manifest['stage'] == 'fetch' else 7
                    profile['scenes'][f'{stage}:{row["slot"]}:{row["frame"]}:{key[2]}'] = dict(scene=scene, suppressStock=row['suppressStock'])
                    continue
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
    reach_keys = {f'{stage}:{slot}:{phase}:{palette}' for stage, slot, phase, palette in itertools.product((6, 7), range(24), range(4), range(3))}
    if any(set(profile['scenes']) != reach_keys for profile in result['reaches'].values()):
        raise ValueError('Book reach catalogue requires complete fetch and return coverage')
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


def architecture_sofa_inputs(root, content, sprites):
    """Seed descriptor-only imports from the exact hash-bound static furniture source."""
    from offline_props import registered_anchor
    matches = [record for catalog in (root / 'assets/models').glob('static-props-*.json')
               for record in json.loads(catalog.read_text())['objects'] if record['name'] == content['long_sofa']]
    if len(matches) != 1:
        raise ValueError('Reading architecture requires one exact static sofa source')
    proof_path = (root / 'assets/models' / matches[0]['directory'] / 'proof.json').resolve()
    if not proof_path.is_relative_to(root / 'assets/models'):
        raise ValueError('Reading architecture static sofa source leaves its model directory')
    proof = json.loads(proof_path.read_text())
    reviewed_digest = hashlib.sha256(json.dumps(proof, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if (reviewed_digest != matches[0]['proof_sha256'] or proof.get('state') != 'complete'
            or matches[0].get('review_status') not in ('accepted-independent-review', 'owner-approved')):
        raise ValueError('Reading architecture static sofa source hash differs')
    anchor = registered_anchor(proof)
    anchors, densities = {}, {}
    for facing in FACINGS:
        name = content['long_sofa'] + ('' if facing == 'SE' else facing)
        index = next(index for index, sprite in enumerate(sprites) if sprite[0] == name)
        sprites[index] = (name, None, *(value * 2 for value in proof['logical_canvas']))
        anchors[index] = list(anchor); densities[index] = 2
    return anchors, densities


def action_records(path):
    root = Path(path).resolve().parents[3]
    content = model_sprites(tomllib.loads((root / 'content/objects.toml').read_text()))
    sprites = [(name + ('' if facing == 'SE' else facing), None, 1, 1)
               for name in content.values() for facing in FACINGS]
    start = len(sprites)
    coverage = []
    manifests = (json.loads(path.read_text()) for path in (root / 'assets/models/reading').glob('*/export/manifest.json'))
    sofa = any(manifest['content'] == 'long_sofa' and manifest['stage'] != 'recline' for manifest in manifests)
    anchors, densities = architecture_sofa_inputs(root, content, sprites) if sofa else ({}, {})
    append_actions(root, sprites, anchors, densities, {}, {}, {}, coverage)
    append_dropped(root, sprites, {}, {}, {}, coverage)
    return sprites[start:]
