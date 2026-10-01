"""Validate retained ottoman evidence before importing any occupied sprites."""
from pathlib import Path
import copy
import json
import hashlib
import shutil
import tempfile
import unittest

from ottoman_receipt import load_receipt, receipt_session
from offline_ottoman import load_reviewed_ottoman
from ottoman_originals import verify_originals
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
CATALOG = ROOT / 'assets/models/living/ottoman-reviewed.json'


class OttomanReceiptTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.catalog = self.root / CATALOG.relative_to(ROOT)
        self.bundle_path = self.root / 'assets/models/living/owner-review-pending/ottoman/sitting-02/bundle.json'
        self.bundle = json.loads((ROOT / self.bundle_path.relative_to(self.root)).read_text())
        self.mapping = {row['historical']: row for row in self.bundle['files']}
        for row in self.bundle['files']:
            target = self.root / row['path']
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / row['path'], target)
        shutil.copyfile(ROOT / self.bundle_path.relative_to(self.root), self.bundle_path)
        shutil.copyfile(CATALOG, self.catalog)

    def resign(self):
        self.bundle_path.write_text(json.dumps(self.bundle))
        catalog = json.loads(self.catalog.read_text())
        catalog['bundle']['sha256'] = hashlib.sha256(self.bundle_path.read_bytes()).hexdigest()
        self.catalog.write_text(json.dumps(catalog))

    def change_receipt(self, historical, change):
        row = self.mapping[historical]
        path = self.root / row['path']
        data = json.loads(path.read_text())
        change(data)
        path.write_text(json.dumps(data))
        changes = {row['sha256']: hashlib.sha256(path.read_bytes()).hexdigest()}
        row['sha256'] = changes[row['sha256']]
        # Re-sign dependents too, so malformed measurements reach semantic guards.
        for _ in range(len(self.mapping)):
            updated = False
            for other in self.mapping.values():
                if not other['historical'].endswith('.json'):
                    continue
                bound = self.root / other['path']
                before = bound.read_text()
                after = before
                for old, new in changes.items():
                    after = after.replace(old, new)
                if after != before:
                    bound.write_text(after)
                    new_sha = hashlib.sha256(bound.read_bytes()).hexdigest()
                    changes[other['sha256']] = new_sha
                    other['sha256'] = new_sha
                    updated = True
            if not updated:
                break
        else:
            raise AssertionError('Receipt fixture has a hash-reference cycle')
        self.resign()

    def test_reviewed_receipt_uses_archived_evidence_without_original_pngs(self):
        paths = load_receipt(self.catalog)
        self.assertTrue(paths['manifest'].is_file())
        self.assertTrue(paths['raw_proof'].is_file())
        self.assertIn('sitting-02', paths['manifest'].parts)
        self.assertFalse((paths['raw_proof'].parent / 'ottoman-sit-green-SE-0-empty.png').exists())

    def test_missing_required_mapping_is_rejected_after_resigning_catalog(self):
        self.bundle['files'].remove(self.mapping['output/build-ottoman-sit-refined.py'])
        self.resign()
        with self.assertRaisesRegex(ValueError, 'Unmapped'):
            load_receipt(self.catalog)

    def test_changed_dependency_digest_in_historical_journal_is_rejected(self):
        self.change_receipt('output/ottoman-sit-candidate-02/contributions/raw-proof.json',
            lambda data: data['signature'].update({'output\\surface_volume.py': '0' * 64}))
        with self.assertRaisesRegex(ValueError, 'Receipt hash'):
            load_receipt(self.catalog)

    def test_null_dependency_digest_cannot_disable_receipt_binding(self):
        for file, field in (('status.json', 'source_hashes'), ('strict-contact-proof-02.json', 'inputs'),
                            ('occupancy-regression-proof.json', 'inputs'), ('contributions/raw-proof.json', 'signature')):
            name = 'output/ottoman-sit-candidate-02/' + file
            inputs = json.loads((self.root / self.mapping[name]['path']).read_text())[field]
            dependency = next(iter(inputs))
            original = inputs[dependency]
            with self.subTest(file=file):
                self.change_receipt(name, lambda data: data[field].update({dependency: None}))
                try:
                    with self.assertRaisesRegex(ValueError, 'dependency digest'):
                        load_receipt(self.catalog)
                finally:
                    self.change_receipt(name, lambda data: data[field].update({dependency: original}))

    def test_render_inventory_cannot_omit_a_required_dependency(self):
        self.change_receipt('output/ottoman-sit-candidate-02/contributions/raw-proof.json',
            lambda data: data['signature'].pop('output\\surface_volume.py'))
        with self.assertRaisesRegex(ValueError, 'dependency inventory'):
            load_receipt(self.catalog)

    def test_resigned_missing_render_cannot_claim_complete_coverage(self):
        self.change_receipt('output/ottoman-sit-candidate-02/contributions/raw-proof.json',
            lambda data: data['renders'].pop())
        with self.assertRaisesRegex(ValueError, 'raw coverage'):
            load_receipt(self.catalog)

    def test_resigned_duplicate_render_is_not_a_second_sample(self):
        self.change_receipt('output/ottoman-sit-candidate-02/contributions/raw-proof.json',
            lambda data: data['renders'].append(copy.deepcopy(data['renders'][0])))
        with self.assertRaisesRegex(ValueError, 'raw coverage'):
            load_receipt(self.catalog)

    def test_resigned_boolean_frame_is_not_integer_one(self):
        self.change_receipt('output/ottoman-sit-candidate-02/contributions/raw-proof.json',
            lambda data: data['renders'][0].update(frame=False))
        with self.assertRaisesRegex(ValueError, 'raw coverage'):
            load_receipt(self.catalog)

    def test_resigned_raw_path_must_name_its_actual_sample(self):
        self.change_receipt('output/ottoman-sit-candidate-02/contributions/raw-proof.json',
            lambda data: data['renders'][0].update(path='../some-other.png'))
        with self.assertRaisesRegex(ValueError, 'raw path'):
            load_receipt(self.catalog)

    def test_resigned_palette_contacts_must_match_the_strict_source_check(self):
        self.change_receipt('output/ottoman-sit-candidate-02/contributions/raw-proof.json',
            lambda data: data['contact_samples']['red'].pop())
        with self.assertRaisesRegex(ValueError, 'palette contact'):
            load_receipt(self.catalog)

    def test_resigned_incomplete_render_journal_is_not_accepted(self):
        self.change_receipt('output/ottoman-sit-candidate-02/contributions/raw-proof.json',
            lambda data: data.update(state='running'))
        with self.assertRaisesRegex(ValueError, 'raw generation'):
            load_receipt(self.catalog)

    def change_contact(self, change):
        name = 'output/ottoman-sit-candidate-02/strict-contact-proof-02.json'
        self.change_receipt(name, change)
        samples = json.loads((self.root / self.mapping[name]['path']).read_text())['samples']
        self.change_receipt('output/ottoman-sit-candidate-02/contributions/raw-proof.json',
            lambda data: data.update(contact_samples={v: copy.deepcopy(samples) for v in ('green', 'blue', 'red')}))

    def test_resigned_unaccepted_contact_report_is_rejected(self):
        self.change_contact(lambda data: data.update(accepted=False))
        with self.assertRaisesRegex(ValueError, 'contact proof'):
            load_receipt(self.catalog)

    def test_resigned_missing_contact_frame_is_rejected(self):
        self.change_contact(lambda data: data['samples'].pop())
        with self.assertRaisesRegex(ValueError, 'contact samples'):
            load_receipt(self.catalog)

    def test_resigned_body_penetration_is_rejected(self):
        self.change_contact(lambda data: data['samples'][0]['body_self_intersections'].append('palm/thigh'))
        with self.assertRaisesRegex(ValueError, 'collision'):
            load_receipt(self.catalog)

    def test_resigned_unsupported_hip_is_rejected(self):
        self.change_contact(lambda data: data['samples'][0]['hip_support'].update(xy_hull_area=0))
        with self.assertRaisesRegex(ValueError, 'support footprint'):
            load_receipt(self.catalog)

    def test_resigned_foot_above_floor_is_rejected(self):
        def raise_sole(data):
            bounds = data['samples'][0]['floor_support']['Fitted rounded shoe sole']['contact_bounds']
            bounds[0][2], bounds[1][2] = .002, .0025
        self.change_contact(raise_sole)
        with self.assertRaisesRegex(ValueError, 'floor support'):
            load_receipt(self.catalog)

    def test_resigned_stretched_bone_is_rejected(self):
        self.change_contact(lambda data: data['samples'][0].update(maximum_bone_length_error=.1))
        with self.assertRaisesRegex(ValueError, 'bone length'):
            load_receipt(self.catalog)

    def test_resigned_failed_reconstruction_cannot_enter_the_atlas(self):
        self.change_receipt('output/ottoman-sit-candidate-02/offline-export/export-proof.json',
            lambda data: data['comparisons'][0].update(max_error=65))
        with self.assertRaisesRegex(ValueError, 'reconstruction'):
            load_receipt(self.catalog)

    def test_resigned_p95_reconstruction_error_cannot_exceed_its_own_limit(self):
        self.change_receipt('output/ottoman-sit-candidate-02/offline-export/export-proof.json',
            lambda data: data['comparisons'][0].update(max_error=21, p95_error=13))
        with self.assertRaisesRegex(ValueError, 'reconstruction'):
            load_receipt(self.catalog)

    def test_resigned_reconstruction_must_cover_every_sample(self):
        self.change_receipt('output/ottoman-sit-candidate-02/offline-export/export-proof.json',
            lambda data: data['comparisons'].pop())
        with self.assertRaisesRegex(ValueError, 'reconstruction coverage'):
            load_receipt(self.catalog)

    def test_resigned_duplicate_reconstruction_is_not_a_second_sample(self):
        self.change_receipt('output/ottoman-sit-candidate-02/offline-export/export-proof.json',
            lambda data: data['comparisons'].append(copy.deepcopy(data['comparisons'][0])))
        with self.assertRaisesRegex(ValueError, 'duplicate ottoman reconstruction'):
            load_receipt(self.catalog)

    def test_resigned_hip_gap_is_checked_independently_of_support_area(self):
        self.change_contact(lambda data: data['samples'][0]['hip_support'].update(min_gap=.004))
        with self.assertRaisesRegex(ValueError, 'hip support measurement'):
            load_receipt(self.catalog)

    def test_resigned_receipts_cannot_bind_unrelated_models_or_exports(self):
        fields = [('status.json', 'candidate_sha256'),
                  ('offline-export/export-proof.json', 'manifest_sha256'),
                  ('offline-export/export-proof.json', 'raw_proof_sha256'),
                  ('offline-export/export-proof.json', 'encoder_sha256'),
                  ('offline-export/manifest.json', 'raw_proof_sha256'),
                  ('action-cadence.json', 'model_sha256'),
                  ('offline-export/cadence-proof.json', 'preview_sha256')]
        for file, field in fields:
            name = 'output/ottoman-sit-candidate-02/' + file
            original = json.loads((self.root / self.mapping[name]['path']).read_text())[field]
            with self.subTest(file=file, field=field):
                self.change_receipt(name, lambda data: data.update({field: '0' * 64}))
                try:
                    with self.assertRaisesRegex(ValueError, 'Receipt hash'):
                        load_receipt(self.catalog)
                finally:
                    self.change_receipt(name, lambda data: data.update({field: original}))

    def test_resigned_preview_must_use_the_saved_action_cadence(self):
        self.change_receipt('output/ottoman-sit-candidate-02/offline-export/cadence-proof.json',
            lambda data: data.update(frame_durations_ms=[300] * 4))
        with self.assertRaisesRegex(ValueError, 'cadence'):
            load_receipt(self.catalog)

    def test_resigned_missing_occupancy_regression_cannot_claim_acceptance(self):
        self.change_receipt('output/ottoman-sit-candidate-02/occupancy-regression-proof.json',
            lambda data: data['cases'].pop())
        with self.assertRaisesRegex(ValueError, 'occupancy'):
            load_receipt(self.catalog)

    def test_unmapped_layer_is_rejected_even_when_its_file_is_available(self):
        name = 'output/ottoman-sit-candidate-02/offline-export/manifest.json'
        manifest = json.loads((self.root / self.mapping[name]['path']).read_text())
        image = 'output/ottoman-sit-candidate-02/offline-export/' + manifest['frames'][0]['body']['path']
        self.bundle['files'].remove(self.mapping[image])
        self.resign()
        with self.assertRaisesRegex(ValueError, 'Unmapped'):
            load_receipt(self.catalog)

    def test_reviewed_loader_rejects_an_unfinished_source_before_importing_sprites(self):
        name = 'output/ottoman-sit-candidate-02/status.json'
        for field, wrong in (('state', 'failed'), ('fit_passed', False), ('source_bytes_unchanged', False),
                             ('blender_version', 'other'), ('preserved_scene_fingerprint', '0' * 64)):
            original = json.loads((self.root / self.mapping[name]['path']).read_text())[field]
            with self.subTest(field=field):
                self.change_receipt(name, lambda data: data.update({field: wrong}))
                try:
                    with self.assertRaisesRegex(ValueError, 'authoring'):
                        load_reviewed_ottoman(self.catalog, existing_names=(
                            'offlineOttoman', 'offlineOttomanNW', 'offlineOttomanSW', 'offlineOttomanNE'))
                finally:
                    self.change_receipt(name, lambda data: data.update({field: original}))

    def test_full_verification_rejects_a_resigned_wrong_size_original(self):
        directory = self.root / 'originals'
        directory.mkdir()
        path = directory / 'ottoman-sit-green-SE-0-empty.png'
        Image.new('RGBA', (1, 1), (10, 10, 10, 255)).save(path)
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        def resign_image(data):
            row = next(r for r in data['renders'] if r['path'] == path.name)
            row['sha256'] = sha
        self.change_receipt('output/ottoman-sit-candidate-02/contributions/raw-proof.json', resign_image)
        with self.assertRaisesRegex(ValueError, 'original RGBA PNG at 768x960'):
            verify_originals(self.catalog, directory)

    def test_verification_session_rejects_a_replaced_but_valid_evidence_bundle(self):
        with self.assertRaisesRegex(ValueError, 'changed during verification'):
            with receipt_session(self.catalog) as (paths, bindings):
                self.assertEqual(bindings['catalog_sha256'], hashlib.sha256(self.catalog.read_bytes()).hexdigest())
                self.assertEqual(bindings['bundle_sha256'], hashlib.sha256(self.bundle_path.read_bytes()).hexdigest())
                self.assertTrue(paths['manifest'].is_file())
                self.change_receipt('output/ottoman-sit-candidate-02/status.json',
                    lambda data: data.update(scope='Independently valid replacement evidence'))
                load_receipt(self.catalog)


if __name__ == '__main__':
    unittest.main()
