"""Import fitted fixture scenes without changing released seating or bed tables.

Three fixture kinds share one import path. The toilet loop renders three shirt palettes on a
one-tile canvas; the bathing loop renders one declared bathing appearance on the two-tile tub
canvas, and every shirt variant selects the same scenes. The fridge reach renders three
palettes and eight progress samples on the fridge's one-tile canvas grown by whole logical
pixels, because the Sim stands on the neighbouring tile; its anchor is the empty fridge's
anchor moved by exactly that padding, so the fixture draws on the same screen point.
"""
import base64
from dataclasses import dataclass
import hashlib
import itertools
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'assets/models/bathroom/actions'))
sys.path.insert(0, str(ROOT/'assets/models/kitchen/actions'))
import bathroom_export_contract as toilet_contract
import bath_export_contract as bath_contract
from bathroom_export_contract import (MODELS, FACINGS, PALETTES, OWNERS, USE_TOILET_ACTION, checked_file, read_png, digest)
from bath_export_contract import BATHE_ACTION, TUB_SOURCE
from export_toilet_loop import ENCODING, scene_anchor, read_ink as read_toilet_ink
from seat_export_contract import check_exported_images, check_palettes, inside
from double_bed_linear import reconstruct
import fridge_export_contract as fridge_contract
import export_fridge_reach as fridge_export


class _LoopContract:
    """The toilet and bath receipts: a looping batch read through `read_loop`."""
    def __init__(self, module, read_ink):
        self.module, self.read_ink = module, read_ink

    def read(self, source_path, ink_path):
        source = self.module.read_loop(source_path, process_exited=True)
        ink, ink_rows = self.read_ink(ink_path, source_path, source)
        return source, ink_rows, self.module.validate_render_rows(source['renders'])

    def identity(self, source, accepted_inputs, spec):
        return dict(source_sha256=accepted_inputs[spec['source_key']], model_sha256=source['editable_model']['sha256'],
                    canvas=spec['canvas'], anchor=scene_anchor(source['origin_pixels']),
                    camera_matrix=source['camera_matrix'], ortho_scale=source['ortho_scale'])


class _FridgeContract:
    """The fridge reach receipt: a progress batch read through `read_batch`."""
    def read(self, source_path, ink_path):
        source = fridge_contract.read_batch(source_path, process_exited=True)
        ink, ink_rows = fridge_contract.read_ink(ink_path, source_path, source)
        return source, ink_rows, fridge_contract.render_rows(source)

    def identity(self, source, accepted_inputs, spec):
        return dict(source_sha256=source['inputs'][spec['source_key']], canvas=spec['canvas'],
                    anchor=fridge_export.registered_anchor(),
                    camera_matrix=source['camera_matrix'], ortho_scale=source['ortho_scale'])

KINDS = {
    'toilet': dict(action=USE_TOILET_ACTION, prefix='bathroomToilet', empty='offlineToilet', content='toilet',
                   size=(192, 240), source_size=(768, 960), canvas=[96, 120], variants=PALETTES,
                   source_key='bathroom/owner-review-pending/toilet/candidate-03/toilet-authoring.blend',
                   contract=_LoopContract(toilet_contract, read_toilet_ink), palette_independent=False,
                   samples=4, half_cycle_ticks=8, padding=(0, 0, 0, 0), depth=False, feet=None,
                   dependencies={'bathroom/actions/bathroom_export_contract.py', 'bathroom/actions/export_toilet_loop.py',
                                 'bathroom/actions/contact_surface.py', 'seating/seat_export_contract.py',
                                 'bedroom/double_bed_linear.py', 'bedroom/double_bed_layers.py',
                                 'sims/sim-01/shirt-source-materials.json'}),
    'bathtub': dict(action=BATHE_ACTION, prefix='bathroomBath', empty='offlineBathtub', content='bathtub',
                    size=(320, 352), source_size=(1280, 1408), canvas=[160, 176], variants=('green',),
                    source_key=TUB_SOURCE, contract=_LoopContract(bath_contract, bath_contract.read_ink),
                    palette_independent=True, samples=4, half_cycle_ticks=8, padding=(0, 0, 0, 0), depth=False,
                    feet=None,
                    dependencies={'bathroom/actions/bath_export_contract.py', 'bathroom/actions/export_bath_loop.py',
                                  'bathroom/actions/bathroom_export_contract.py', 'bathroom/actions/export_toilet_loop.py',
                                  'bathroom/actions/contact_surface.py', 'seating/seat_export_contract.py',
                                  'bedroom/double_bed_linear.py', 'bedroom/double_bed_layers.py',
                                  'sims/sim-01/shirt-source-materials.json'}),
    # Progress-driven: halfCycleTicks is unused by playback and kept for the shared profile shape.
    'fridge': dict(action=fridge_contract.FETCH_ACTION, prefix='kitchenFridgeReach', empty='offlineFridge',
                   content='fridge', size=fridge_contract.export_size(),
                   source_size=tuple(fridge_contract.canvas()), canvas=[v//8 for v in fridge_contract.canvas()],
                   variants=PALETTES, source_key=fridge_contract.SOURCE, contract=_FridgeContract(),
                   palette_independent=False, samples=fridge_contract.geo.SAMPLES, half_cycle_ticks=None,
                   padding=tuple(fridge_contract.geo.PADDING), depth=True, feet=fridge_contract.feet,
                   dependencies={'kitchen/actions/fridge_export_contract.py', 'kitchen/actions/export_fridge_reach.py',
                                 'kitchen/actions/fridge_reach_geometry.py',
                                 'bathroom/actions/bathroom_export_contract.py', 'bathroom/actions/export_toilet_loop.py',
                                 'bathroom/actions/contact_surface.py', 'seating/seat_export_contract.py',
                                 'bedroom/double_bed_linear.py', 'bedroom/double_bed_layers.py',
                                 'sims/sim-01/shirt-source-materials.json'}),
}


def manifest_supported(manifest, spec):
    common = (manifest.get('version') == 1 and manifest.get('encoding') == ENCODING
              and manifest.get('pixel_density') == 2 and manifest.get('action') == spec['action']
              and manifest.get('comparison_reference') == 'independent-beauty-float-linear-box-display-once')
    if spec['half_cycle_ticks'] is None:
        return (common and manifest.get('samples') == spec['samples'] and manifest.get('playback') == 'progress'
                and manifest.get('padding') == list(spec['padding']) and 'halfCycleTicks' not in manifest)
    return (common and manifest.get('halfCycleTicks') == spec['half_cycle_ticks']
            and bool(manifest.get('palette_independent', False)) == spec['palette_independent'])


@dataclass
class BathroomExport:
    manifest: dict
    layers: dict
    masks: dict
    kind: str = 'toilet'
    depths: dict = None


def load_bathroom(manifest_path):
    path = Path(manifest_path).resolve()
    manifest = json.loads(path.read_text())
    objects = manifest.get('objects') or []
    kind = objects[0].get('kind') if len(objects) == 1 else None
    if kind not in KINDS:
        raise ValueError('Unsupported bathroom export fixture kind')
    spec = KINDS[kind]
    if not manifest_supported(manifest, spec):
        raise ValueError('Unsupported bathroom export contract')
    source_copy = checked_file(path.parent, manifest['source_receipt'])
    ink_copy = checked_file(path.parent, manifest['ink_receipt'])
    source_path, ink_path = [inside(MODELS, manifest[field]) for field in ('source_batch', 'ink_batch')]
    if digest(source_path) != digest(source_copy) or digest(ink_path) != digest(ink_copy):
        raise ValueError('Bathroom export receipts differ from their retained source batches')
    contract = spec['contract']
    source, ink_rows, raw_rows = contract.read(source_path, ink_path)
    if set(manifest['dependencies']) != spec['dependencies']:
        raise ValueError('Incomplete bathroom export dependency inventory')
    for name, sha in manifest['dependencies'].items():
        checked_file(MODELS, dict(path=name, sha256=sha))
    obj = objects[0]
    if obj['content'] != spec['content']:
        raise ValueError('Bathroom export fixture identity changed')
    accepted = (json.loads((MODELS/source['accepted_source']['proof_path']).read_text())['inputs']
                if 'accepted_source' in source else None)
    expected_identity = contract.identity(source, accepted, spec)
    if any(obj.get(key) != value for key, value in expected_identity.items()):
        raise ValueError('Bathroom exported model/camera/anchor identity differs from source')
    variants = spec['variants']
    expected = set(itertools.product(FACINGS, variants, range(spec['samples'])))
    scenes, paths = {}, {}
    layers, masks, depths = {}, {}, {}
    size = spec['size']
    size_key = f'{size[0]}x{size[1]}-'
    for scene in obj['scenes']:
        key = (scene['facing'], scene['variant'], scene['frame'])
        if key not in expected or key in scenes or type(scene['frame']) is not int:
            raise ValueError('Duplicate or unexpected bathroom scene')
        scenes[key] = scene
        for field, mode, inventory in (('layers', 'RGBA', layers), ('coverage', 'L', masks)):
            if set(scene[field]) != ({'body', 'furniture', 'ink'} if field == 'layers' else {'body', 'furniture', 'ink', 'bodyInk'}):
                raise ValueError('Bathroom visible owner inventory is incomplete')
            decoded = {}
            for role, ref in scene[field].items():
                previous = paths.setdefault(ref['path'], ref)
                if previous != ref:
                    raise ValueError('Conflicting bathroom image reference')
                image = read_png(path.parent, ref, size, mode)
                image_key = size_key+ref['pixels_sha256']
                inventory.setdefault(image_key, image)
                decoded[role] = image_key
            scene[field] = decoded
        if spec['depth']:
            # Per-pixel game-space X+Y of the nearest surface, one per facing and sample.
            ref = scene.get('depth')
            if not isinstance(ref, dict):
                raise ValueError('Fixture scene is missing its per-pixel depth')
            previous = paths.setdefault(ref['path'], ref)
            if previous != ref:
                raise ValueError('Conflicting fixture depth reference')
            image = read_png(path.parent, ref, size, 'RGBA')
            depth_key = size_key+ref['pixels_sha256']
            depths.setdefault(depth_key, image)
            scene['depth'] = depth_key
        elif 'depth' in scene:
            raise ValueError('Only the fridge reach carries per-pixel depth')
        retained = read_png(path.parent, scene['reconstruction'], size)
        actual = reconstruct([layers[scene['layers'][role]] for role in ('furniture', 'body', 'ink')])
        if retained.tobytes() != actual.tobytes():
            raise ValueError('Retained bathroom reconstruction differs from its decoded layers')
        if ImageChops.subtract(masks[scene['coverage']['bodyInk']], masks[scene['coverage']['ink']]).getbbox():
            raise ValueError('Body-owned ink exceeds full scene ink')
    if set(scenes) != expected or len(obj['scenes']) != len(expected):
        raise ValueError('Missing bathroom scene facing/palette/sample matrix')
    for facing, frame in itertools.product(FACINGS, range(spec['samples'])):
        raw_palettes = [{owner:read_png(source_path.parent, raw_rows[facing, variant, frame, owner], spec['source_size'])
                         for owner in OWNERS} for variant in variants]
        if len(variants) > 1:
            check_palettes(raw_palettes)
        body_ink = read_png(ink_path.parent, ink_rows[facing, 'green', frame, 'body_ink'], spec['source_size'])
        for variant, raw in zip(variants, raw_palettes):
            scene = scenes[facing, variant, frame]
            measured = check_exported_images(raw, body_ink,
                {role:layers[key] for role, key in scene['layers'].items()},
                {role:masks[key] for role, key in scene['coverage'].items()})
            if measured != scene['comparison']:
                raise ValueError('Bathroom comparison receipt differs from actual original renders')
    if spec['depth']:
        for facing, frame in itertools.product(FACINGS, range(spec['samples'])):
            rows = {scenes[facing, variant, frame]['depth'] for variant in variants}
            if len(rows) != 1:
                raise ValueError('Shirt palettes must share one scene depth')
    return BathroomExport(manifest, layers, masks, kind, depths if spec['depth'] else None)


def scene_name(row, kind='toilet'):
    return f'{KINDS[kind]["prefix"]}_{row["facing"]}_{row["variant"]}_{row["frame"]}'


def records(export):
    result = [('bathroomLayer_'+key, image, image.width, image.height)
              for key, image in sorted(export.layers.items())]
    result += [('bathroomDepth_'+key, image, image.width, image.height)
               for key, image in sorted((export.depths or {}).items())]
    for obj in export.manifest['objects']:
        for row in obj['scenes']:
            image = export.layers[row['layers']['furniture']]
            result.append((scene_name(row, export.kind), image, image.width, image.height))
    return result


def registered(empty, anchor, padding):
    """An occupied scene registers on its empty fixture: the same anchor on the same canvas,
    or, on a canvas grown by whole logical pixels, the empty anchor moved by that padding
    to within a millionth of a pixel."""
    if empty is None:
        return False
    if not any(padding):
        return empty == anchor
    expected = [empty[0]+padding[0], empty[1]+padding[1]]
    return all(abs(a-b) <= 1e-6 for a, b in zip(anchor, expected))


def tables(export, sprites, anchors=None):
    """Build the bathroom tables; `anchors`, when given, must register each occupied scene exactly on its empty fixture."""
    spec = KINDS[export.kind]
    indices = {row[0]:index for index, row in enumerate(sprites)}
    if len(indices) != len(sprites):
        raise ValueError('Duplicate sprite name while importing bathroom scenes')
    result = {key:{} for key in ('anchors', 'tops', 'bounds', 'density', 'profiles', 'layers', 'coverage', 'depths')}
    result['masks'] = []
    mask_ids = {}
    for key, mask in sorted(export.masks.items()):
        box = mask.getbbox()
        if box is None:
            raise ValueError('Bathroom visible owner has empty coverage')
        mask_ids[key] = len(result['masks'])
        result['masks'].append(dict(size=list(mask.size), box=list(box),
            values=base64.b64encode(mask.crop(box).tobytes()).decode('ascii')))
    for obj in export.manifest['objects']:
        if obj['kind'] != export.kind or obj['content'] != spec['content']:
            raise ValueError('Unsupported bathroom fixture identity')
        frames = {f:{v:[] for v in PALETTES} for f in FACINGS}
        for row in sorted(obj['scenes'], key=lambda r:r['frame']):
            index = indices[scene_name(row, export.kind)]
            refs = row['layers']
            layers = [indices['bathroomLayer_'+refs[role]] for role in ('furniture', 'body', 'ink')]
            result['layers'][index] = [layers[0], layers[1], -1, layers[2]]
            result['coverage'][index] = [mask_ids[row['coverage'][role]] for role in ('body', 'furniture', 'ink', 'bodyInk')]
            if export.depths:
                depth = indices['bathroomDepth_'+row['depth']]
                result['depths'][index] = depth
                result['anchors'][depth] = obj['anchor']
                result['density'][depth] = 2
            alpha = Image.new('L', export.layers[refs['body']].size)
            for role in ('body', 'furniture', 'ink'):
                alpha = ImageChops.lighter(alpha, export.layers[refs[role]].getchannel('A'))
            box = alpha.getbbox()
            body_alpha = ImageChops.lighter(export.masks[row['coverage']['body']], export.masks[row['coverage']['bodyInk']])
            body_box = body_alpha.getbbox()
            if box is None or body_box is None:
                raise ValueError('Bathroom scene or visible body is empty')
            for sprite_index in [index]+layers:
                result['anchors'][sprite_index] = obj['anchor']
                result['density'][sprite_index] = 2
            result['bounds'][index] = [v/2 for v in box]
            result['tops'][index] = body_box[1]/2
            targets = PALETTES if spec['palette_independent'] else (row['variant'],)
            for variant in targets:
                frames[row['facing']][variant].append(index)
        for facing in frames:
            name = spec['empty']+('' if facing == 'SE' else facing)
            if name not in indices:
                raise ValueError('Missing exact empty fixture facing: '+name)
            if anchors is not None and not registered(anchors.get(indices[name]), obj['anchor'], spec['padding']):
                raise ValueError('Occupied bathroom scene anchor differs from its empty fixture: '+name)
            if any(len(frames[facing][variant]) != spec['samples'] for variant in PALETTES):
                raise ValueError('Fixture profile needs every sample for every shirt variant')
            half_cycle = export.manifest.get('halfCycleTicks', spec['samples']//2)
            result['profiles'][indices[name]] = dict(action=spec['action'], halfCycleTicks=half_cycle,
                                                    frames=frames[facing])
            if spec['feet'] is not None:
                result['profiles'][indices[name]]['feet'] = spec['feet'](facing)
    return result
