"""Protect material shading and the native variant export contract."""
import importlib.util
import json
import hashlib
from pathlib import Path
import unittest

from PIL import Image

BASE = Path(__file__).resolve().parent


class ShirtRampTests(unittest.TestCase):
    def recolor(self, stop, source, target):
        spec = importlib.util.find_spec('shirt_colors')
        self.assertIsNotNone(spec, 'Shirt ramp transformation has not been implemented')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.recolor_stop(stop, source, target)

    def test_preserves_each_channels_shading_ratio_and_alpha(self):
        actual = self.recolor((0.1, 0.15, 0.2, 0.8), (0.2, 0.3, 0.8, 1), (0.6, 0.4, 0.2, 1))
        for value, expected in zip(actual, (0.3, 0.2, 0.05, 0.8)):
            self.assertAlmostEqual(value, expected)

    def test_identity_target_preserves_ramp(self):
        stop = (0.08, 0.15, 0.2, 1)
        actual = self.recolor(stop, (0.2, 0.3, 0.4, 1), (0.2, 0.3, 0.4, 1))
        for value, expected in zip(actual, stop):
            self.assertAlmostEqual(value, expected)

    def test_rejects_undefined_source_ratio(self):
        with self.assertRaises(ValueError):
            self.recolor((0.1, 0.2, 0.3, 1), (0, 0.3, 0.4, 1), (0.4, 0.2, 0.1, 1))


class ShirtExportTests(unittest.TestCase):
    def test_complete_exports_preserve_registration_attachments_and_alpha(self):
        source = json.loads((BASE / 'export/manifest.json').read_text())
        for variant in ('blue', 'red'):
            manifest_path = BASE / 'export' / variant / 'manifest.json'
            self.assertTrue(manifest_path.is_file(), f'{variant} export is absent')
            manifest = json.loads(manifest_path.read_text())
            self.assertEqual(manifest['variant'], variant)
            self.assertEqual(manifest['clips'], source['clips'])
            self.assertEqual(len(manifest['frames']), 148)
            for original, frame in zip(source['frames'], manifest['frames']):
                self.assertEqual(frame['name'], original['name'].replace('rigSim', f'rigSim{variant.title()}', 1))
                self.assertEqual({key: value for key, value in frame.items() if key not in ('name', 'sha256')},
                                 {key: value for key, value in original.items() if key not in ('name', 'sha256')})
                path = BASE / 'export' / variant / frame['path']
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), frame['sha256'])
                with Image.open(path) as actual, Image.open(BASE / 'export' / original['path']) as green:
                    self.assertEqual(actual.mode, 'RGBA')
                    self.assertEqual(actual.size, green.size)
                    self.assertEqual(actual.getchannel('A').tobytes(), green.getchannel('A').tobytes())
                    self.assertNotEqual(actual.tobytes(), green.tobytes())

    def test_saved_source_and_original_green_files_remain_byte_identical(self):
        path = BASE / 'shirt-variants-batch-proof.json'
        self.assertTrue(path.is_file(), 'Completed material-only batch proof is absent')
        proof = json.loads(path.read_text())
        self.assertEqual(proof['state'], 'complete')
        self.assertTrue(proof['original_files_byte_identical'])
        for relative, expected in proof['preserved_sha256'].items():
            self.assertNotIn('\\', relative, 'Preservation paths must work on Linux and Windows')
            self.assertEqual(hashlib.sha256((BASE / relative).read_bytes()).hexdigest(), expected, relative)


if __name__ == '__main__':
    unittest.main()
