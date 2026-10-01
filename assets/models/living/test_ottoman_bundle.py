"""Exercise the archived recipe boundary without the original output directory."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

from ottoman_bundle import load_bundle


def digest(value):
    return hashlib.sha256(value).hexdigest()


class OttomanBundleTests(unittest.TestCase):
    def fixture(self, root):
        source = root / 'assets/archive/author.py'
        source.parent.mkdir(parents=True)
        source.write_bytes(b'accepted source\r\n')
        data = {'version': 1, 'asset': 'ottoman_sit', 'files': [{
            'historical': 'output/author.py', 'path': 'assets/archive/author.py',
            'sha256': digest(source.read_bytes()),
        }]}
        catalog = root / 'assets/archive/bundle.json'
        catalog.write_text(json.dumps(data))
        return catalog, data, source

    def test_clean_checkout_resolves_windows_history_to_archived_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog, _, _ = self.fixture(root)
            bundle = load_bundle(catalog, root=root)
            self.assertEqual(bundle.resolve(r'output\author.py').read_bytes(), b'accepted source\r\n')
            self.assertFalse((root / 'output').exists())

    def test_changed_archived_bytes_are_rejected_even_when_original_output_exists(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog, _, source = self.fixture(root)
            (root / 'output').mkdir()
            (root / 'output/author.py').write_bytes(source.read_bytes())
            source.write_bytes(b'different recipe\n')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                load_bundle(catalog, root=root)

    def test_path_aliases_cannot_hide_duplicate_inputs(self):
        for alias in ('output/author.py', r'output\author.py', 'OUTPUT/author.py'):
            with self.subTest(alias=alias), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                catalog, data, _ = self.fixture(root)
                data['files'].append({**data['files'][0], 'historical': alias})
                catalog.write_text(json.dumps(data))
                with self.assertRaisesRegex(ValueError, 'Duplicate historical'):
                    load_bundle(catalog, root=root)

    def test_mapped_targets_cannot_alias_each_other(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog, data, _ = self.fixture(root)
            data['files'].append({**data['files'][0], 'historical': 'output/second.py'})
            catalog.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, 'Duplicate archive'):
                load_bundle(catalog, root=root)

    def test_unmapped_dependency_does_not_fall_back_to_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog, _, _ = self.fixture(root)
            (root / 'output').mkdir()
            (root / 'output/missing.py').write_bytes(b'local file is not an archive')
            with self.assertRaisesRegex(ValueError, 'Unmapped'):
                load_bundle(catalog, root=root).resolve('output/missing.py')

    def test_receipt_hash_must_agree_with_mapping_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog, _, _ = self.fixture(root)
            with self.assertRaisesRegex(ValueError, 'Receipt hash'):
                load_bundle(catalog, root=root).resolve('output/author.py', '0' * 64)

    def test_paths_cannot_escape_alias_or_target_temporary_sources(self):
        cases = [
            ('historical', '../author.py'), ('historical', '/author.py'),
            ('historical', 'C:/author.py'), ('historical', 'output//author.py'),
            ('historical', 'output/./author.py'), ('historical', 'output/author.py '),
            ('path', '../author.py'), ('path', '/author.py'),
            ('path', 'assets/archive/../archive/author.py'),
            ('path', 'assets\\archive\\author.py'), ('path', 'output/author.py'),
            ('path', '.tmp/author.py'), ('historical', r'output\..\author.py'),
            ('historical', r'\\server\author.py'),
            ('historical', 'output/NUL'), ('historical', 'output/CON.py'),
            ('historical', 'output/COM1/author.py'), ('historical', 'output/LPT9.txt'),
        ]
        for field, invalid in cases:
            with self.subTest(field=field, invalid=invalid), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                catalog, data, _ = self.fixture(root)
                data['files'][0][field] = invalid
                catalog.write_text(json.dumps(data))
                with self.assertRaisesRegex(ValueError, 'path'):
                    load_bundle(catalog, root=root)

    def test_schema_requires_nonempty_versioned_inventory_and_valid_hashes(self):
        cases = [({'version': True}, None), ({'asset': 'armchair'}, None),
                 ({'files': []}, None), ({}, {'sha256': 'not a digest'}),
                 ({}, {'unexpected': 'field'}), ({}, {'historical': None})]
        for change, record in cases:
            with self.subTest(change=change, record=record), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                catalog, data, _ = self.fixture(root)
                data.update(change)
                if record:
                    data['files'][0].update(record)
                catalog.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    load_bundle(catalog, root=root)

    def test_replay_uses_independent_copies_and_never_overwrites_a_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog, _, source = self.fixture(root)
            bundle = load_bundle(catalog, root=root)
            destination = root / 'replay'
            bundle.materialize(['output/author.py'], destination)
            replay = destination / 'output/author.py'
            self.assertEqual(replay.read_bytes(), source.read_bytes())
            replay.write_bytes(b'new generated journal')
            self.assertEqual(source.read_bytes(), b'accepted source\r\n')
            with self.assertRaises(FileExistsError):
                bundle.materialize(['output/author.py'], destination)
            self.assertEqual(replay.read_bytes(), b'new generated journal')

    def test_replay_validates_all_dependencies_before_creating_any_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog, _, _ = self.fixture(root)
            destination = root / 'replay'
            with self.assertRaisesRegex(ValueError, 'Unmapped'):
                load_bundle(catalog, root=root).materialize(
                    ['output/author.py', 'output/missing.py'], destination)
            self.assertFalse(destination.exists())

    def test_loaded_bundle_rechecks_changed_or_deleted_files_without_fallback(self):
        for replacement in (b'changed after loading', None):
            with self.subTest(replacement=replacement), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                catalog, _, source = self.fixture(root)
                bundle = load_bundle(catalog, root=root)
                (root / 'output').mkdir()
                shutil.copyfile(source, root / 'output/author.py')
                if replacement is None:
                    source.unlink()
                else:
                    source.write_bytes(replacement)
                with self.assertRaisesRegex(ValueError, 'Missing|hash mismatch'):
                    bundle.resolve('output/author.py')

    def test_case_only_target_alias_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog, data, _ = self.fixture(root)
            data['files'].append({**data['files'][0], 'historical': 'output/second.py',
                                  'path': 'assets/ARCHIVE/author.py'})
            catalog.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, 'Duplicate archive'):
                load_bundle(catalog, root=root)

    def test_resolved_archive_cannot_escape_through_a_link(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog, data, source = self.fixture(root)
            outside = root / 'outside.py'
            shutil.copyfile(source, outside)
            link = root / 'assets/archive/linked.py'
            try:
                os.symlink(outside, link)
            except OSError as error:
                self.skipTest(f'Host cannot create a symlink: {error}')
            data['files'][0]['path'] = 'assets/archive/linked.py'
            catalog.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, 'escaped assets'):
                load_bundle(catalog, root=root)

    def test_real_archive_loads_in_clean_copy_without_temporary_originals(self):
        repo = Path(__file__).resolve().parents[3]
        relative = Path('assets/models/living/owner-review-pending/ottoman/sitting-02/bundle.json')
        data = json.loads((repo / relative).read_text())
        self.assertEqual(len(data['files']), 119)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for row in data['files']:
                target = root / row['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(repo / row['path'], target)
            shutil.copyfile(repo / relative, root / relative)
            bundle = load_bundle(root / relative, root=root)
            self.assertEqual(digest(bundle.resolve(
                'output/ottoman-sit-candidate-02/ottoman-sit-authoring.blend').read_bytes()),
                'bc5144165be665cfdc62dae1ce2eb96e7d3b978040aabf2f542785313e55371f')
            for receipt, field in [('status.json', 'source_hashes'),
                                   ('strict-contact-proof-02.json', 'inputs'),
                                   ('occupancy-regression-proof.json', 'inputs'),
                                   ('contributions/raw-proof.json', 'signature')]:
                value = json.loads(bundle.resolve('output/ottoman-sit-candidate-02/' + receipt).read_text())
                for name, sha in value[field].items():
                    bundle.resolve(name, sha)
            self.assertFalse((root / 'output').exists())


if __name__ == '__main__':
    unittest.main()
