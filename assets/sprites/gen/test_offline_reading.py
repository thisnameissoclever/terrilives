import unittest
import copy
import hashlib
import itertools
import json
from pathlib import Path
import random
import tempfile

from PIL import Image
from joint_alpha_runtime import joint_alpha

from offline_reading import (append_actions, append_sofa, sofa_actions, validate_sofa_records,
                             architecture_sofa_inputs,
                             validate_sofa_crop, validate_sofa_registration, validate_sofa_witnesses,
                             reuse_reach_coverage, validate_reach_frames)


def complete_sofa_manifest():
    rows = []
    for facing, scene, frame in itertools.product(('SE', 'NW', 'SW', 'NE'), range(27), range(4)):
        actions = sofa_actions(scene)
        for palette in itertools.product(*(range(3) if action else (0,) for action in actions)):
            rows.append(dict(facing=facing, sceneKey=scene, frame=frame, sourceFrame=scene * 4 + frame,
                             actions=list(actions), paletteIndices=list(palette), layers=[{}] * 5,
                             owners=[dict(stableSeatId=f'seat_{place + 1}') if action else None
                                     for place, action in enumerate(actions)]))
    return dict(content='long_sofa', stableSeatIds=['seat_1', 'seat_2', 'seat_3'],
                layerOrder=['furniture', 'body0', 'body1', 'body2', 'sharedInk'],
                phases=dict(count=4, cycleTicks=16, sourceAliases=[0, 1, 2, 3]), records=rows)


class SharedSofaImport(unittest.TestCase):
    def test_architecture_descriptors_use_hash_bound_static_furniture_facts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); model = root / 'assets/models/static-sofa'; model.mkdir(parents=True)
            proof = model / 'proof.json'
            proof_value = dict(state='complete', logical_canvas=[160, 176], origin_pixels=[640, 984.0035], source_density=8)
            proof.write_text(json.dumps(proof_value, indent=2))
            catalog = root / 'assets/models/static-props-01.json'
            catalog.write_text(json.dumps(dict(objects=[dict(name='exactSofa', directory='static-sofa',
                proof_sha256=hashlib.sha256(json.dumps(proof_value, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
                review_status='owner-approved')])))
            sprites = [(name, None, 1, 1) for name in ('exactSofa', 'exactSofaNW', 'exactSofaSW', 'exactSofaNE')]
            anchors, densities = architecture_sofa_inputs(root, {'long_sofa': 'exactSofa'}, sprites)
            self.assertTrue(all(row[2:] == (320, 352) for row in sprites))
            self.assertEqual(densities, dict.fromkeys(range(4), 2))
            self.assertTrue(all(abs(value[1] - 144.0004375) < .000001 for value in anchors.values()))
            proof.write_text('{}')
            with self.assertRaisesRegex(ValueError, 'source hash differs'):
                architecture_sofa_inputs(root, {'long_sofa': 'exactSofa'}, sprites)

    def test_aliases_require_explicit_schedule_and_identical_visible_state(self):
        missing = complete_sofa_manifest(); del missing['phases']['sourceAliases']
        with self.assertRaisesRegex(ValueError, 'source phase aliases'):
            validate_sofa_records(missing)
        for field in ('layers', 'owners', 'canvas', 'anchor', 'alphaCoverage'):
            manifest = complete_sofa_manifest(); manifest['phases']['sourceAliases'] = [0, 0, 0, 0]
            for row in manifest['records']:
                row['sourceFrame'] = row['sceneKey'] * 4
            row = next(row for row in manifest['records'] if row['sceneKey'] == 6 and row['frame'] == 1)
            if field == 'owners':
                row['owners'][1]['marker'] = [4, 5]
            elif field == 'layers':
                row['layers'] = [dict(path='different')] * 5
            else:
                row[field] = ['different']
            with self.assertRaisesRegex(ValueError, 'aliases change appearance'):
                validate_sofa_records(manifest)

    def test_all_registered_contributions_require_integer_bounded_crops(self):
        ref = dict(width=2, height=2, rawCrop=[0, 0, 2, 2], trim=[0, 0, 1, 1])
        validate_sofa_crop(ref, [2, 2])
        for change in (dict(rawCrop=[True, 0, 2, 2]), dict(rawCrop=[0, 0, 2.0, 2]),
                       dict(width=2.0), dict(height=-1), dict(rawCrop=[-1, 0, 1, 2]),
                       dict(rawCrop=[1, 0, 3, 2]), dict(trim=[1, 0, 1, 1])):
            with self.assertRaisesRegex(ValueError, 'crop registration'):
                validate_sofa_crop(dict(ref, **change), [2, 2])

    def test_occupied_registration_uses_static_facing_and_explicit_padding(self):
        static = dict(canvas=[160, 176], anchor=[80, 144])
        row = dict(canvas=[160, 176], anchor=[80, 144], owners=[None] * 3)
        validate_sofa_registration(row, [0, 0, 0, 0], static)
        padded = dict(row, canvas=[163, 183], anchor=[81, 146])
        validate_sofa_registration(padded, [1, 2, 2, 5], static)
        for changed in (dict(row, anchor=[80.5, 144]), dict(row, canvas=[161, 176]),
                        dict(row, anchor=[float('nan'), 144])):
            with self.assertRaisesRegex(ValueError, 'static facing registration'):
                validate_sofa_registration(changed, [0, 0, 0, 0], static)
        with self.assertRaisesRegex(ValueError, 'explicit'):
            validate_sofa_registration(row, None, static)
    def test_existing_single_seat_catalog_keeps_its_owner_adapter(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'content').mkdir()
            (root / 'content/objects.toml').write_text('[[object]]\nid="reading_chair"\nsprite="chair"\n')
            path = root / 'assets/models/reading/solo/export/manifest.json'
            path.parent.mkdir(parents=True)
            source = path.parent / 'pixels.png'
            pixels = Image.new('RGBA', (2, 2), (0, 90, 0, 255)); pixels.save(source)
            sha = hashlib.sha256(source.read_bytes()).hexdigest()
            ref = dict(path=source.name, sha256=sha, pixelsSha256=hashlib.sha256(pixels.tobytes()).hexdigest(),
                       width=2, height=2, rawCrop=[0, 0, 2, 2], trim=[0, 0, 1, 1])
            manifest = dict(content='reading_chair', stage='seatedRead', importable=True,
                            encoding='scene-linear-premultiplied-visible-additive', pixelDensity=2,
                            stableSeatIds=['seat_1'], phases=dict(count=4, cycleTicks=16), comparisons=[],
                            physicalReceipt=dict(path=source.name, sha256=sha), records=[])
            for facing, frame, palette in itertools.product(('SE', 'NW', 'SW', 'NE'), range(4), range(3)):
                manifest['records'].append(dict(facing=facing, frame=frame, paletteIndices=[palette],
                    sourceFrame=frame, layers=[ref] * 5, canvas=[1, 1], anchor=[1, 1], alphaCoverage=ref,
                    owners=[dict(stableSeatId='seat_1', coverage=ref, marker=[1, 1])]))
            path.write_text(json.dumps(manifest)); digest = hashlib.sha256(path.read_bytes()).hexdigest()
            (path.parent / 'export-process-exit.json').write_text(json.dumps(dict(exit_code=0, manifest=dict(sha256=digest))))
            (root / 'assets/models/reading/catalog.json').write_text(json.dumps(dict(manifests={
                path.relative_to(root).as_posix(): digest})))
            (path.parent / 'joint-alpha.json').write_text(json.dumps(dict(manifestSHA256=digest, records=[
                dict(facing=facing, sourceFrame=frame, source=dict(path=source.name, sha256=sha),
                     coverage=joint_alpha(source, [2, 2], sha))
                for facing, frame in itertools.product(('SE', 'NW', 'SW', 'NE'), range(4))])))
            sprites = [(name, None, 1, 1) for name in ('chair', 'chairNW', 'chairSW', 'chairNE')]
            result = append_actions(root, sprites, {}, {}, {}, {}, {}, [])
            for profile in result['catalog'].values():
                self.assertEqual(profile['seatIds'], ['seat'])
                self.assertEqual(profile['actions'], [3])
                self.assertEqual(len(profile['scenes']), 12)
                self.assertEqual(len(profile['scenes'][216]['owners']), 1)

    def test_complete_matrix_and_canonical_empty_palettes(self):
        manifest = complete_sofa_manifest()
        self.assertEqual(len(validate_sofa_records(manifest)), 4 * 4 * 7 ** 3)
        for state in range(27):
            self.assertTrue(any(row['sceneKey'] == state for row in manifest['records']))

    def test_missing_state_palette_facing_and_phase_are_rejected(self):
        for predicate in (lambda row: row['sceneKey'] == 26,
                          lambda row: row['facing'] == 'SW',
                          lambda row: row['frame'] == 3,
                          lambda row: row['sceneKey'] == 26 and row['paletteIndices'] == [2, 1, 0]):
            manifest = complete_sofa_manifest()
            manifest['records'] = [row for row in manifest['records'] if not predicate(row)]
            with self.assertRaisesRegex(ValueError, 'all 27 states'):
                validate_sofa_records(manifest)

    def test_duplicate_identity_wrong_owner_and_action_are_rejected(self):
        for change in ('duplicate', 'owner', 'action', 'empty_palette', 'boolean'):
            manifest = complete_sofa_manifest()
            row = next(row for row in manifest['records'] if row['sceneKey'] == 6)
            if change == 'duplicate':
                manifest['records'].append(copy.deepcopy(row))
            elif change == 'owner':
                row['owners'][1]['stableSeatId'] = 'seat_1'
            elif change == 'action':
                row['actions'] = [2, 0, 0]
            elif change == 'empty_palette':
                row['paletteIndices'][0] = 1
            else:
                row['paletteIndices'][1] = True
            with self.assertRaises(ValueError):
                validate_sofa_records(manifest)

    def test_phase_aliases_keep_occupancy_geometry_distinct(self):
        manifest = complete_sofa_manifest()
        manifest['phases']['sourceAliases'] = [0, 0, 0, 0]
        for row in manifest['records']:
            row['sourceFrame'] = row['sceneKey'] * 4
        validate_sofa_records(manifest)
        manifest['records'][-1]['sourceFrame'] = 0
        with self.assertRaisesRegex(ValueError, 'exact actions'):
            validate_sofa_records(manifest)

    def test_full_import_retains_three_owners_and_is_order_independent(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sofa' / 'export' / 'manifest.json'
            path.parent.mkdir(parents=True)
            image = Image.new('RGBA', (2, 2), (70, 80, 90, 255))
            source = path.parent / 'registered.png'; image.save(source)
            sha = hashlib.sha256(source.read_bytes()).hexdigest()
            ref = dict(path=source.name, sha256=sha, pixelsSha256=hashlib.sha256(image.tobytes()).hexdigest(),
                       width=2, height=2, trim=[0, 0, 1, 1], rawCrop=[0, 0, 2, 2])
            empty = Image.new('RGBA', (2, 2)); empty_path = path.parent / 'empty.png'; empty.save(empty_path)
            empty_ref = dict(ref, path=empty_path.name, sha256=hashlib.sha256(empty_path.read_bytes()).hexdigest(),
                             pixelsSha256=hashlib.sha256(empty.tobytes()).hexdigest())
            shirt_colors = ((20, 100, 30, 255), (20, 40, 130, 255), (140, 20, 30, 255))
            palette_refs = []
            for palette, color in enumerate(shirt_colors):
                body = Image.new('RGBA', (2, 2), color); body_path = path.parent / f'body-{palette}.png'; body.save(body_path)
                palette_refs.append(dict(ref, path=body_path.name,
                    sha256=hashlib.sha256(body_path.read_bytes()).hexdigest(),
                    pixelsSha256=hashlib.sha256(body.tobytes()).hexdigest()))
            manifest = complete_sofa_manifest()
            for row in manifest['records']:
                row.update(layers=[ref] + [palette_refs[row['paletteIndices'][place]] if action else empty_ref
                                          for place, action in enumerate(row['actions'])] + [ref],
                           alphaCoverage=ref, anchor=[1, 1], canvas=[1, 1])
                for owner in row['owners']:
                    if owner is not None:
                        owner.update(coverage=ref, marker=[1, 1])
                occupied = [value for action, value in zip(row['actions'], row['paletteIndices']) if action]
                row['composition'] = 'actualUniform' if len(set(occupied)) <= 1 else 'derivedIndependentPalette'
                row['ownerSources'] = [dict(facing=row['facing'], sourceFrame=row['sourceFrame'],
                    palette=('green', 'blue', 'red')[row['paletteIndices'][place]], place=place) if action else None
                    for place, action in enumerate(row['actions'])]
            manifest.update(canvasPadding=[0, 0, 0, 0], sofaAnchor=[1, 1], comparisons=[])
            representatives = {(row['facing'], row['sourceFrame']): row for row in manifest['records']}
            for (facing, frame), row in representatives.items():
                for palette, name in enumerate(('green', 'blue', 'red')):
                    manifest['comparisons'].append(dict(facing=facing, sceneKey=frame // 4, sourceFrame=frame, palette=name,
                        kind='actualUniform', sourceBeauty=ref,
                        sourceDensity=2, canvas=row['canvas'], anchor=row['anchor'], owners=row['owners'],
                        layers=[ref] + [palette_refs[palette] if action else empty_ref for action in row['actions']] + [ref],
                        scene=dict(max_error=0, p95_error=0, active_pixels=4)))
            originals = {'sofa': 0, 'sofaNW': 1, 'sofaSW': 2, 'sofaNE': 3}
            def static_inputs():
                return ([(name, None, 2, 2) for name in originals],
                        {index: [1, 1] for index in range(4)}, {index: 2 for index in range(4)})
            def run():
                path.write_text(json.dumps(manifest))
                joints = [dict(facing=facing, sourceFrame=scene * 4 + frame,
                               source=dict(path=source.name, sha256=sha),
                               coverage=joint_alpha(source, [2, 2], sha))
                          for facing, scene, frame in itertools.product(('SE', 'NW', 'SW', 'NE'), range(27), range(4))]
                (path.parent / 'joint-alpha.json').write_text(json.dumps(dict(
                    manifestSHA256=hashlib.sha256(path.read_bytes()).hexdigest(), records=joints)))
                sprites, anchors, densities = static_inputs(); coverage = []
                result = dict(catalog={}, aliases=set(), layers={}, joint_ids={})
                append_sofa(path, manifest, {'long_sofa': 'sofa'}, originals, sprites, anchors, densities, {}, {}, {}, coverage, result)
                return sprites, coverage, result
            sprites, coverage, result = run()
            transparent = [sprites[index][1] for index in result['aliases']]
            self.assertEqual(len({id(image) for image in transparent}), 1)
            self.assertIsNone(transparent[0].getchannel('A').getbbox())
            self.assertEqual(len(result['catalog']), 4)
            for profile in result['catalog'].values():
                self.assertEqual(len(profile['scenes']), 27 * 4 * 27)
                self.assertEqual(profile['seatIds'], ['seat_1', 'seat_2', 'seat_3'])
                for state in range(27):
                    scene = profile['scenes'][state * 4 * 27]
                    self.assertEqual([owner is not None for owner in scene['owners']],
                                     [action != 0 for action in sofa_actions(state)])
                self.assertIs(profile['scenes'][0], profile['scenes'][26])
                self.assertNotEqual(profile['scenes'][6 * 4 * 27]['alpha'], profile['scenes'][2 * 4 * 27]['alpha'])
                mixed = profile['scenes'][26 * 4 * 27 + 2 + 3]
                body_layers = result['layers'][mixed['sprite']][1:4]
                self.assertEqual([sprites[index][1].getpixel((0, 0)) for index in body_layers],
                                 [shirt_colors[2], shirt_colors[1], shirt_colors[0]])
            random.Random(17).shuffle(manifest['records'])
            again, again_coverage, again_result = run()
            self.assertEqual([row[0] for row in sprites], [row[0] for row in again])
            self.assertEqual(result, again_result)
            self.assertEqual(coverage, again_coverage)
            for change in ('missing', 'duplicate', 'foreign_source', 'derived_as_actual'):
                changed = copy.deepcopy(manifest)
                if change == 'missing':
                    changed['comparisons'].pop()
                elif change == 'duplicate':
                    changed['comparisons'].append(copy.deepcopy(changed['comparisons'][0]))
                elif change == 'foreign_source':
                    changed['records'][0]['ownerSources'] = [None] * 3
                else:
                    changed['comparisons'][0]['kind'] = 'derivedIndependentPalette'
                with self.assertRaises(ValueError):
                    validate_sofa_witnesses(changed, changed['records'])
            ghost = next(row for row in manifest['records'] if row['sceneKey'] == 0)
            ghost['layers'] = [ref] * 5
            ghost_sprites, ghost_anchors, ghost_densities = static_inputs()
            with self.assertRaisesRegex(ValueError, 'empty seat retains visible'):
                append_sofa(path, manifest, {'long_sofa': 'sofa'}, originals, ghost_sprites, ghost_anchors, ghost_densities, {}, {}, {}, [],
                            dict(catalog={}, aliases=set(), layers={}, joint_ids={}))
            ghost['layers'] = [ref, empty_ref, empty_ref, empty_ref, ref]
            # Hash validation is part of importing the real registered files.
            source.write_bytes(b'changed')
            changed_sprites, changed_anchors, changed_densities = static_inputs()
            with self.assertRaisesRegex(ValueError, 'hash differs'):
                append_sofa(path, manifest, {'long_sofa': 'sofa'}, originals, changed_sprites, changed_anchors, changed_densities, {}, {}, {}, [],
                            dict(catalog={}, aliases=set(), layers={}, joint_ids={}))


class ReachSourceFrames(unittest.TestCase):
    def test_every_slot_keeps_its_source_poses_in_both_directions(self):
        for stage in ('fetch', 'shelve'):
            rows = [dict(slot=slot, frame=phase,
                         sourceFrame=slot * 4 + (phase if stage == 'fetch' else 3 - phase),
                         suppressStock=(phase if stage == 'fetch' else 3 - phase) >= 2)
                    for slot in range(24) for phase in range(4)]
            validate_reach_frames(dict(stage=stage, records=rows))

    def test_different_slots_cannot_alias_one_source_silhouette(self):
        rows = [dict(slot=0, frame=0, sourceFrame=0, suppressStock=False),
                dict(slot=1, frame=0, sourceFrame=0, suppressStock=False)]
        with self.assertRaisesRegex(ValueError, 'exact slot'):
            validate_reach_frames(dict(stage='fetch', records=rows))

    def test_return_cannot_reuse_forward_phase_order(self):
        with self.assertRaisesRegex(ValueError, 'ordered phase'):
            validate_reach_frames(dict(stage='shelve', records=[dict(slot=23, frame=0, sourceFrame=92)]))

    def test_boolean_and_missing_source_identities_are_rejected(self):
        for row in (dict(slot=True, frame=0, sourceFrame=4), dict(slot=0, frame=0)):
            with self.assertRaises(ValueError):
                validate_reach_frames(dict(stage='fetch', records=[row]))

    def test_reverse_sources_reuse_only_identical_registered_coverage(self):
        coverage, cache = [], {}
        original = dict(size=[2, 3], box=[0, 0, 2, 3], encoding='float16', values='source bytes')
        self.assertEqual(reuse_reach_coverage(coverage, cache, original), 0)
        self.assertEqual(reuse_reach_coverage(coverage, cache, dict(original)), 0)
        self.assertEqual(len(coverage), 1)
        changed = dict(original, values='different bytes')
        self.assertEqual(reuse_reach_coverage(coverage, cache, changed), 1)
        registered_elsewhere = dict(original, box=[1, 0, 3, 3])
        self.assertEqual(reuse_reach_coverage(coverage, cache, registered_elsewhere), 2)

    def test_stock_ownership_cannot_be_flipped_in_either_direction(self):
        for stage, phase, source in (('fetch', 2, 2), ('shelve', 2, 1)):
            with self.assertRaisesRegex(ValueError, 'stock ownership'):
                validate_reach_frames(dict(stage=stage, records=[dict(slot=0, frame=phase,
                    sourceFrame=source, suppressStock=source < 2)]))


if __name__ == '__main__':
    unittest.main()
