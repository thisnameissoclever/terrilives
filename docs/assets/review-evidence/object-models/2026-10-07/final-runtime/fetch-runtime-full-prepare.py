"""Prepare hash-bound, reachable actual source references for fetch and return."""
import copy
import hashlib
import itertools
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
FACINGS = ('SE', 'NW', 'SW', 'NE')
PALETTES = ('green', 'blue', 'red')
FULL = 0xffffff


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(index_path, output):
    index_path, output = Path(index_path).resolve(), Path(output).resolve()
    index = json.loads(index_path.read_text())
    expected_views = {(slot, phase, facing) for slot in range(24) for phase in (0, 2) for facing in FACINGS}
    expected_views.update((0, 3, facing) for facing in FACINGS)
    seen_views, seen_aliases = set(), set()
    expected_aliases = set(itertools.product(FACINGS, (6, 7), range(24), range(4), range(3)))
    inputs, aliases, cases = {str(index_path): digest(index_path)}, [], []
    output.mkdir(parents=True, exist_ok=False)
    (output / 'references').mkdir()

    def source_path(ref, parent=index_path.parent):
        path = (parent / ref['path']).resolve()
        if not path.is_relative_to(ROOT) or not isinstance(ref.get('sha256'), str) or digest(path) != ref['sha256']:
            raise ValueError('Source is not captured, in this workspace, and hash-bound: ' + str(path))
        inputs[str(path)] = ref['sha256']
        return path

    def raster(ref, canvas, density, parent=index_path.parent):
        path = source_path(ref, parent)
        with Image.open(path) as image:
            if image.mode != 'RGBA' or image.size != tuple(v * density for v in canvas):
                raise ValueError('Actual source registration differs: ' + str(path))
            return np.asarray(image).astype(np.float32) / 255

    def reduce(value, canvas):
        width, height = [v * 2 for v in canvas]
        channels = value.shape[2]
        return value.reshape(height, 4, width, 4, channels).mean(axis=(1, 3))

    def linear(value):
        value = value.copy()
        rgb = value[:, :, :3]
        value[:, :, :3] = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4) * value[:, :, 3:4]
        return value

    manifest_bindings = index.get('exportManifests')
    if not isinstance(manifest_bindings, list) or {r.get('stage') for r in manifest_bindings} != {'fetch', 'shelve'}:
        raise ValueError('Require exact fetch and shelve exportManifest bindings')
    for ref in manifest_bindings:
        manifest = json.loads(source_path(ref).read_text())
        if manifest.get('importable') is not True or manifest['stage'] != ref['stage']:
            raise ValueError('Source index does not bind an importable stage manifest')

    for row in index['records']:
        slot, phase, facing = row['slot'], row['phase'], row['facing']
        identity = slot, phase, facing
        if identity not in expected_views or identity in seen_views:
            raise ValueError('Unexpected or duplicate actual pose/view')
        seen_views.add(identity)
        if (row['canvas'] != [124, 128] or row['density'] != 8 or row['outputDensity'] != 2
                or row['sourceFrame'] != slot * 4 + phase or row['suppressStock'] != (phase >= 2)
                or row['forceSelectedStock'] != (phase < 2)):
            raise ValueError('Actual pose source registration or stock ownership differs')
        for alias in row['aliases']:
            stage = {'fetch': 6, 'shelve': 7}[alias['stage']]
            source_phase = alias['frame'] if stage == 6 else 3 - alias['frame']
            expected_source = (0, 3) if source_phase == 3 else (alias['slot'], 0 if source_phase == 1 else source_phase)
            if (expected_source != (slot, phase) or alias['renderKey'] != row['sourceKey']
                    or alias['facing'] != facing or alias['sourceFrame'] != alias['slot'] * 4 + source_phase
                    or alias['suppressStock'] != (source_phase >= 2)
                    or alias['forceSelectedStock'] != (source_phase < 2)):
                raise ValueError('Declared phase or slot alias changes source identity')
            for palette in range(3):
                key = facing, stage, alias['slot'], alias['frame'], palette
                if key not in expected_aliases or key in seen_aliases:
                    raise ValueError('Unexpected or duplicate semantic pose alias')
                seen_aliases.add(key)
                aliases.append(dict(facing=facing, stage=stage, slot=alias['slot'], phase=alias['frame'], palette=palette,
                                    suppressStock=alias['suppressStock'], group=row['sourceKey'] + ':' + str(palette),
                                    canvas=row['canvas'], anchor=row['anchor']))
        proof_path = source_path(row['sourceProof'])
        proof = json.loads(proof_path.read_text())
        if proof.get('state') != 'complete' or proof.get('inputs_unchanged') is not True:
            raise ValueError('Actual source proof is incomplete or changed')

        def owner(name):
            ref = next(r for r in proof['renders'] if r['palette'] == 'green' and r['owner'] == name)
            return raster(ref, row['canvas'], 8, proof_path.parent)[:, :, 3]

        body, ink, owned_ink = owner('body'), owner('sharedInk'), owner('bodyInk')
        coverage = reduce(np.clip(body * (1 - ink) + owned_ink, 0, 1)[:, :, None], row['canvas'])[:, :, 0]
        empty = row['actualEmpty']
        if len(empty) != 3 or {r['paletteIndex'] for r in empty} != {0, 1, 2}:
            raise ValueError('Require all three actual empty palette sources')
        # Retain the hash proof for contact empty bases even though they are not
        # reachable production images while the selected copy is stationary.
        for ref in empty:
            source_path(ref)
            if ref['palette'] != PALETTES[ref['paletteIndex']] or ref['stockMask'] != 0:
                raise ValueError('Actual empty palette identity differs')
        reachable = row['actualSelectedOnly'] if phase == 0 else empty
        if len(reachable) != 3 or {r['paletteIndex'] for r in reachable} != {0, 1, 2}:
            raise ValueError('Require three reachable palette references')
        full = row['actualFull']
        if full['palette'] != 'green' or full['paletteIndex'] != 0 or full['stockMask'] != (FULL if phase == 0 else FULL ^ (1 << slot)):
            raise ValueError('Actual full-stock source mask differs')
        for ref in list(reachable) + [full]:
            expected_mask = full['stockMask'] if ref is full else (1 << slot if phase == 0 else 0)
            expected_kind = ('actual_full_stock_green_beauty' if ref is full else
                             'actual_reachable_selected_only_beauty' if phase == 0 else 'actual_empty_stock_beauty')
            if (ref['stockMask'] != expected_mask or ref['kind'] != expected_kind
                    or ref['palette'] != PALETTES[ref['paletteIndex']]):
                raise ValueError('Selected-only or empty reference is not reachable')
            path = source_path(ref)
            captures = [r for r in proof['renders'] if (proof_path.parent / r['path']).resolve() == path
                        and r['sha256'] == ref['sha256'] and r['palette'] == ref['palette']]
            if len(captures) != 1:
                raise ValueError('Comparison image does not belong to the bound actual source proof')
            rgba = reduce(linear(raster(ref, row['canvas'], 8)), row['canvas'])
            alpha = rgba[:, :, 3]
            key = row['sourceKey'] + '-' + ref['kind'] + '-' + ref['palette']
            rgba.astype('<f2').tofile(output / 'references' / (key + '.rgba.bin'))
            alpha.astype('<f2').tofile(output / 'references' / (key + '.alpha.bin'))
            picks = []
            for actor in (True, False):
                ys, xs = np.nonzero((alpha >= .99) & ((coverage >= .99) if actor else (coverage <= .001)))
                if not len(xs):
                    raise ValueError('Actual source has no independent actor/furniture picking witness: ' + key)
                chosen = np.linspace(0, len(xs) - 1, min(8, len(xs)), dtype=int)
                picks.append(dict(actor=actor, points=[[int(xs[i]), int(ys[i])] for i in chosen]))
            physical = expected_mask | (1 << slot)
            cases.append(dict(key=key, sourceKey=row['sourceKey'], facing=facing, stage=6, slot=slot, phase=phase,
                palette=ref['paletteIndex'], suppressStock=row['suppressStock'], physicalMask=physical,
                expectedStockMask=expected_mask, kind=ref['kind'], sourceBeautySHA256=ref['sha256'],
                canvas=row['canvas'], anchor=row['anchor'], picks=picks,
                referenceRGBA=key + '.rgba.bin', referenceAlpha=key + '.alpha.bin'))
        print(json.dumps(dict(preparedView=row['sourceKey'], cases=len(cases))), flush=True)
    if seen_views != expected_views or seen_aliases != expected_aliases:
        raise ValueError(f'Incomplete source index: {len(seen_views)}/196 views, {len(seen_aliases)}/2304 aliases')
    # Return reverses the same artwork. Draw those stage keys on slot zero in
    # every facing; all other equivalent keys receive resolved-appearance checks.
    originals = {(r['sourceKey'], r['kind']): r for r in cases}
    for facing in FACINGS:
        for stage, phase in [(6, 1)] + [(7, value) for value in range(4)]:
            source_phase = phase if stage == 6 else 3 - phase
            source_phase = 0 if source_phase == 1 else source_phase
            source_key = f'slot00-phase{source_phase}-{facing}'
            case = copy.deepcopy(originals[source_key, 'actual_full_stock_green_beauty'])
            case.update(key=case['key'] + f'-stage{stage}-phase{phase}', stage=stage, phase=phase, transitionWitness=True)
            if stage == 7:
                case['physicalMask'] &= FULL ^ 1
            cases.append(case)
    payload = dict(version=1, sourceIndex=str(index_path), sourceIndexSHA256=digest(index_path),
                   exportManifests=manifest_bindings, aliases=aliases, cases=cases, inputs=inputs,
                   sourceViews=196, semanticAliases=2304, baseReferences=784,
                   referenceMeaning='All comparison images are actual reachable beauty captures; no derived owner-palette or stock references')
    (output / 'prepared.json').write_text(json.dumps(payload, indent=2) + '\n')


if __name__ == '__main__':
    prepare(*sys.argv[1:])
