"""Pin Sit ownership and registration without renaming the reading-chair assets."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image
from offline_armchair import load_armchair, load_reviewed_armchair, verify_armchair_generation
from armchair_receipt import RENDER_INPUTS
from offline_furniture import furniture_tables


class ArmchairImportTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.refs = {}
        for label, color in (('green', (10, 60, 20, 100)), ('blue', (10, 20, 60, 100)),
                             ('red', (60, 10, 20, 100)), ('chair', (50, 30, 20, 100)),
                             ('lines', (5, 5, 5, 100))):
            image = Image.new('RGBA', (192, 240))
            image.putpixel((20, 30), color)
            path = self.root/f'{label}.png'
            image.save(path)
            self.refs[label] = {'path': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        self.data = {'version': 1, 'pixel_density': 2, 'width': 96, 'height': 120,
                     'anchor': [48, 116.00044], 'empty': [], 'frames': []}
        for facing in ('SE', 'NW', 'SW', 'NE'):
            self.data['empty'].append({'facing': facing, **self.refs['chair']})
            for variant in ('green', 'blue', 'red'):
                for frame in range(4):
                    self.data['frames'].append({'facing': facing, 'variant': variant, 'frame': frame,
                                               'body': dict(self.refs[variant]),
                                               'furniture': dict(self.refs['chair']),
                                               'outline': dict(self.refs['lines'])})

    def load(self, existing_names=()):
        path = self.root/'manifest.json'
        path.write_text(json.dumps(self.data))
        return load_armchair(path, existing_names=existing_names)

    def test_sit_profiles_preserve_four_samples_and_three_shirt_colors(self):
        result = self.load()
        self.assertEqual(len(result.sprites), 54)
        self.assertEqual(len(result.pairs), 48)
        self.assertEqual(set(result.profiles), {'offlineArmchair', 'offlineArmchairNW',
                                               'offlineArmchairSW', 'offlineArmchairNE'})
        anchors, _, bounds, density, pairs, catalog = furniture_tables(result, result.sprites)
        self.assertEqual(len(pairs), 48)
        self.assertTrue(all(value == [48, 116.00044] for value in anchors.values()))
        self.assertTrue(all(value == 2 for value in density.values()))
        self.assertTrue(all(value == [10, 15, 10.5, 15.5] for value in bounds.values()))
        for profile in catalog.values():
            self.assertEqual((profile['action'], profile['halfCycleTicks']), (8, 24))
            self.assertEqual({len(frames) for frames in profile['frames'].values()}, {4})

    def test_missing_duplicate_or_invalid_coverage_is_rejected(self):
        original = copy.deepcopy(self.data)
        for field in ('empty', 'frames'):
            for duplicate in (False, True):
                self.data = copy.deepcopy(original)
                if duplicate:
                    self.data[field].append(self.data[field][0])
                else:
                    self.data[field].pop()
                with self.assertRaisesRegex(ValueError, 'coverage'):
                    self.load()
        self.data = original
        self.data['frames'][0]['frame'] = True
        with self.assertRaisesRegex(ValueError, 'integer'):
            self.load()

    def test_registration_is_fixed(self):
        for key, value in (('width', 100), ('height', 136), ('pixel_density', 1),
                           ('version', True), ('anchor', [48, 115]), ('anchor', [48, float('nan')])):
            with self.subTest(key=key, value=value):
                before = self.data[key]
                self.data[key] = value
                with self.assertRaises(ValueError):
                    self.load()
                self.data[key] = before

    def test_every_reference_hash_path_and_shared_registration_is_checked(self):
        original = copy.deepcopy(self.data)
        for change, message in (({'sha256': '0'*64}, 'hash'),
                                ({'path': '../escape.png'}, 'path'),
                                ({'anchor': [0, 0]}, 'registration')):
            self.data = copy.deepcopy(original)
            self.data['frames'][-1]['outline'].update(change)
            with self.assertRaisesRegex(ValueError, message):
                self.load()
        self.data = original
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.load({'offlineArmchair'})

    def test_body_must_be_visible_and_premultiplied(self):
        for color, message in (((0, 0, 0, 0), 'visible'), ((150, 0, 0, 10), 'premultiplied')):
            image = Image.new('RGBA', (192, 240), color)
            path = self.root/'bad.png'
            image.save(path)
            self.data['frames'][0]['body'] = {'path': path.name,
                                            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            with self.assertRaisesRegex(ValueError, message):
                self.load()

    def test_palette_cannot_change_chair_ink_or_body_coverage(self):
        original = copy.deepcopy(self.data)
        for role in ('furniture', 'outline'):
            self.data = copy.deepcopy(original)
            self.data['frames'][4][role] = self.refs['blue']
            with self.assertRaisesRegex(ValueError, 'palette'):
                self.load()
        self.data = copy.deepcopy(original)
        for row in self.data['frames']:
            row['body'] = self.refs['green']
        with self.assertRaisesRegex(ValueError, 'three shirt'):
            self.load()

    def receipt_fixture(self):
        living = self.root/'models/living'
        models = living.parent
        living.mkdir(parents=True, exist_ok=True)
        for name in self.refs:
            (living/f'{name}.png').write_bytes((self.root/f'{name}.png').read_bytes())
        names = RENDER_INPUTS | {'living/candidate/armchair-authoring.blend', 'living/candidate/proof.json'}
        extra = {'living/export_armchair.py', 'living/check_armchair_scene.py',
                 'furniture/layer_partition.py', 'furniture/export_contributions.py'}
        for name in names | extra:
            target = models/name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(f'Synthetic dependency fixture: {name}')
        sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
        source = Path(__file__).resolve().parents[2]/'models/living/owner-review-pending/armchair/candidate-03/contact-check-02.json'
        self.contact = json.loads(source.read_text())
        self.contact['model_sha256'] = sha(living/'candidate/armchair-authoring.blend')
        self.raw = {'state': 'complete', 'blender_version': self.contact['blender_version'],
                    'blender_build_hash': self.contact['blender_build_hash'], 'anchor': self.data['anchor'],
                    'contact_samples': copy.deepcopy(self.contact['samples']), 'renders': [],
                    'signature': {'inputs': {name: sha(models/name) for name in names},
                                  'source_density': 8, 'logical_canvas': [96, 120], 'body_action': 'sit',
                                  'body_offset': [0, 0, 0], 'body_degrees_offset': -90}}
        image = Image.new('RGBA', (768, 960), (10, 20, 30, 255))
        first = living/'original.png'
        image.save(first)
        for f in ('SE', 'NW', 'SW', 'NE'):
            for i in range(4):
                for v in ('green', 'blue', 'red'):
                    owners = ('beauty', 'sim', 'furniture', 'lines')
                    if i == 0 and v == 'green':
                        owners += ('empty',)
                    for o in owners:
                        name = f'armchair-{v}-{f}-{i}-{o}.png'
                        (living/name).write_bytes(first.read_bytes())
                        self.raw['renders'].append(dict(facing=f, frame=i, variant=v, owner=o,
                                                       path=name, sha256=sha(living/name)))
        self.report = {'production_export': True, 'checked_groups': 48,
                       'encoder_sha256': sha(models/'living/export_armchair.py'),
                       'partition_sha256': sha(models/'furniture/layer_partition.py'),
                       'comparison_sha256': sha(models/'furniture/export_contributions.py'),
                       'comparisons': [dict(facing=f, variant=v, frame=i, max_error=20, p95_error=8,
                                            active_pixels=100, pixels_above_8=12)
                                       for f in ('SE', 'NW', 'SW', 'NE')
                                       for v in ('green', 'blue', 'red') for i in range(4)]}
        self.catalog = {'review_status': 'accepted-independent-review',
                        'contact_checker_sha256': sha(models/'living/check_armchair_scene.py')}
        self.receipt_root = living
        return self.resign_receipt()

    def resign_receipt(self):
        def write(name, value):
            path = self.receipt_root/name
            path.write_text(json.dumps(value))
            return {'path': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        self.catalog['raw_proof'] = write('raw-proof.json', self.raw)
        self.data['raw_proof_sha256'] = self.catalog['raw_proof']['sha256']
        self.catalog['manifest'] = write('manifest.json', self.data)
        self.report['manifest_sha256'] = self.catalog['manifest']['sha256']
        self.report['raw_proof_sha256'] = self.catalog['raw_proof']['sha256']
        self.catalog['comparison'] = write('comparison.json', self.report)
        self.catalog['contact_check'] = write('contact.json', self.contact)
        write('armchair-reviewed.json', self.catalog)
        return self.receipt_root/'armchair-reviewed.json'

    def test_receipt_and_full_original_verification_accept_valid_evidence(self):
        path = self.receipt_fixture()
        self.assertEqual(len(load_reviewed_armchair(path).pairs), 48)
        self.assertEqual(len(verify_armchair_generation(path).pairs), 48)

    def test_resigned_hip_penetration_or_zero_area_cannot_pass(self):
        self.receipt_fixture()
        original = copy.deepcopy(self.raw['contact_samples'])
        for field, value in (('min_gap', -.001), ('xy_hull_area', 0), ('contact_count', True),
                             ('min_gap', float('nan'))):
            self.raw['contact_samples'] = copy.deepcopy(original)
            self.raw['contact_samples'][0]['hip_support'][field] = value
            self.contact['samples'] = copy.deepcopy(self.raw['contact_samples'])
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'hip support'):
                load_reviewed_armchair(self.resign_receipt())

    def test_resigned_missing_geometry_contact_and_queries_fail(self):
        self.receipt_fixture()
        original = copy.deepcopy(self.raw['contact_samples'])
        for field, value in (('body_inventory', []), ('grounded_chair_feet', []),
                             ('structural_contacts', {}), ('body_chair_intersections', ['hit']),
                             ('excluded_visible_geometry', ['hand'])):
            self.raw['contact_samples'] = copy.deepcopy(original)
            self.raw['contact_samples'][0][field] = value
            self.contact['samples'] = copy.deepcopy(self.raw['contact_samples'])
            with self.subTest(field=field), self.assertRaises(ValueError):
                load_reviewed_armchair(self.resign_receipt())
        self.raw['contact_samples'] = original
        self.contact['samples'] = copy.deepcopy(original)
        self.contact['query_tests'].pop()
        with self.assertRaisesRegex(ValueError, 'collision-query'):
            load_reviewed_armchair(self.resign_receipt())

    def test_resigned_raw_coverage_and_comparison_damage_fail(self):
        self.receipt_fixture()
        original = copy.deepcopy(self.raw['renders'])
        self.raw['renders'] = original[:-1]
        with self.assertRaisesRegex(ValueError, 'raw coverage'):
            load_reviewed_armchair(self.resign_receipt())
        self.raw['renders'] = copy.deepcopy(original)
        self.raw['renders'][1]['path'] = self.raw['renders'][0]['path']
        with self.assertRaisesRegex(ValueError, 'filename'):
            load_reviewed_armchair(self.resign_receipt())
        self.raw['renders'] = original
        self.report['comparisons'][0]['max_error'] = 65
        with self.assertRaisesRegex(ValueError, 'acceptance limits'):
            load_reviewed_armchair(self.resign_receipt())

    def test_resigned_unrelated_rejection_reason_does_not_prove_a_physical_guard(self):
        self.receipt_fixture()
        self.contact['caught_mutations'][0]['rejection'] = 'Seat cushion dimensions changed'
        with self.assertRaisesRegex(ValueError, 'wrong reason'):
            load_reviewed_armchair(self.resign_receipt())

    def test_hash_matching_but_wrong_original_format_is_rejected(self):
        self.receipt_fixture()
        for mode, size in (('RGB', (768, 960)), ('RGBA', (192, 240))):
            row = self.raw['renders'][0]
            path = self.receipt_root/row['path']
            Image.new(mode, size).save(path)
            row['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            catalog = self.resign_receipt()
            load_reviewed_armchair(catalog)
            with self.assertRaisesRegex(ValueError, '768x960'):
                verify_armchair_generation(catalog)


if __name__ == '__main__':
    unittest.main()
