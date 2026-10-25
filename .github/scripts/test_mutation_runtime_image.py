"""Fail closed on image publication and recipe/inventory mismatches."""

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('mutation_runtime_image',
                                            Path(__file__).with_name('mutation_runtime_image.py'))
IMAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMAGE)


class RuntimeImageTests(unittest.TestCase):
    def inventory(self, directory, **changes):
        value = {'version': 1, 'architecture': 'x86_64', 'recipe_inputs': IMAGE.recipe_files(),
                 'files': {'/usr/bin/python3.12': 'a' * 64}, 'tools': {}}
        value.update(changes)
        path = Path(directory) / 'inventory.json'
        path.write_bytes(IMAGE.canonical(value))
        return path

    def test_receipt_binds_actual_inventory_and_recipe(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(IMAGE, 'command', return_value='b' * 40):
            inventory = self.inventory(directory)
            receipt = IMAGE.receipt(IMAGE.REGISTRY_REPOSITORY + '@sha256:' + 'a' * 64, inventory)
            self.assertEqual(receipt['inventory_sha256'], IMAGE.sha256(inventory))
            self.assertEqual(receipt['recipe_files'], IMAGE.recipe_files())
            self.assertEqual(receipt['source_sha'], 'b' * 40)

    def test_rejects_rolling_or_unowned_images(self):
        for image in [IMAGE.REGISTRY_REPOSITORY + ':latest',
                      'ghcr.io/stranger/runtime@sha256:' + 'a' * 64,
                      IMAGE.REGISTRY_REPOSITORY + '@sha256:invalid']:
            with self.subTest(image=image), self.assertRaises(ValueError):
                IMAGE.validate_image(image)

    def test_rejects_wrong_recipe_or_noncanonical_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            image = IMAGE.REGISTRY_REPOSITORY + '@sha256:' + 'a' * 64
            path = self.inventory(directory, recipe_inputs={})
            with self.assertRaisesRegex(ValueError, 'another recipe'):
                IMAGE.receipt(image, path)
            path = self.inventory(directory)
            path.write_text(json.dumps(json.loads(path.read_text()), indent=2))
            with self.assertRaisesRegex(ValueError, 'canonical'):
                IMAGE.receipt(image, path)

    def test_tokens_are_removed_from_build_environment(self):
        with mock.patch.dict(os.environ, {name: 'private-value' for name in IMAGE.TOKEN_NAMES}):
            environment = IMAGE.clean_environment()
            self.assertFalse(set(environment) & set(IMAGE.TOKEN_NAMES))

    def test_recipe_is_whitelisted_and_all_downloads_are_pinned(self):
        lock = json.loads((IMAGE.RECIPE / 'inputs.lock.json').read_text())
        dockerfile = (IMAGE.RECIPE / 'Dockerfile').read_text()
        self.assertIn('FROM ' + lock['ubuntu_image'], dockerfile)
        self.assertIn('ADD --checksum=sha256:' + lock['ca_bootstrap']['sha256'], dockerfile)
        self.assertRegex(lock['buildkit_image'], r'@sha256:[0-9a-f]{64}$')
        for item in [*lock['rust_archives'], lock['gh_archive']]:
            self.assertRegex(item['sha256'], r'^[0-9a-f]{64}$')
            self.assertTrue(item['url'].startswith(('https://static.rust-lang.org/', 'https://github.com/cli/cli/')))
        for package, version in lock['apt_packages'].items():
            self.assertIn(package + '=' + version, dockerfile)
        self.assertEqual((IMAGE.RECIPE / '.dockerignore').read_text().splitlines(),
                         ['*', '!Dockerfile', '!inputs.lock.json', '!inventory.py', '!.dockerignore'])

    def test_failed_build_removes_only_its_own_bounded_builder(self):
        calls = []
        def command(args, **kwargs):
            calls.append(args)
            if args[1:3] == ['buildx', 'build']:
                raise RuntimeError('build failed')
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(IMAGE, 'command', side_effect=command):
            with self.assertRaisesRegex(RuntimeError, 'build failed'):
                IMAGE.build(IMAGE.REGISTRY_REPOSITORY + ':source-test', Path(directory))
        self.assertIn('memory=4g', calls[0])
        self.assertIn('cpu-quota=200000', calls[0])
        self.assertEqual(calls[-1], ['docker', 'buildx', 'rm', calls[0][4]])
        self.assertEqual(calls[1][-1], str(IMAGE.RECIPE))

    def test_local_build_can_reduce_memory_but_cannot_increase_above_cap(self):
        with mock.patch.object(IMAGE, 'command') as command:
            for memory in (0, 5, '2'):
                with self.assertRaises(ValueError):
                    IMAGE.build(IMAGE.REGISTRY_REPOSITORY + ':source-test', Path('unused'), memory)
            command.assert_not_called()

    def test_actual_image_fault_controls_gate_verification(self):
        calls = []
        def command(args, **kwargs):
            calls.append(args)
            if kwargs.get('capture'):
                return IMAGE.canonical({'recipe_inputs': IMAGE.recipe_files()}).decode().strip()
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(IMAGE, 'command', side_effect=command):
            IMAGE.verify('local-reviewed-image', Path(directory), 2)
        self.assertEqual(calls[1][-1], IMAGE.SMOKE)
        self.assertEqual(calls[2][-1], IMAGE.NEGATIVE_CONTROLS)
        self.assertIn('--memory=2g', calls[2])
        self.assertIn('--network=none', calls[2])
        self.assertFalse(any('mount' in item for item in calls[2]))
        compile(IMAGE.NEGATIVE_CONTROLS, '<runtime negative controls>', 'exec')

    def test_image_fault_control_failure_prevents_inventory_receipt(self):
        calls = []
        def command(args, **kwargs):
            calls.append(args)
            if args[-1] == IMAGE.NEGATIVE_CONTROLS:
                raise RuntimeError('runtime guard accepted deliberate fault')
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(IMAGE, 'command', side_effect=command):
            with self.assertRaisesRegex(RuntimeError, 'deliberate fault'):
                IMAGE.verify('local-reviewed-image', Path(directory), 2)
            self.assertFalse((Path(directory) / 'inventory.json').exists())
        self.assertEqual(len(calls), 3)


if __name__ == '__main__':
    unittest.main()
