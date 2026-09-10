import hashlib
from pathlib import Path
import tempfile
import unittest

from PIL import Image
import export_density


class SourceTests(unittest.TestCase):
    def test_source_hash_dimensions_and_native_reproduction_are_independent_guards(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.png'
            native = Path(directory) / 'native.png'
            Image.new('RGBA', (32, 32), (10, 20, 30, 255)).save(source)
            Image.new('RGBA', (2, 2), (10, 20, 30, 255)).save(native)
            good_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            self.assertEqual(export_density.verify_source(source, native, (2, 2), good_hash), good_hash)
            with self.assertRaisesRegex(ValueError, 'hash'):
                export_density.verify_source(source, native, (2, 2), '0' * 64)
            with self.assertRaisesRegex(ValueError, 'dimensions'):
                export_density.verify_source(source, native, (3, 3), good_hash)
            Image.new('RGBA', (2, 2), (50, 20, 30, 255)).save(native)
            with self.assertRaisesRegex(ValueError, 'reproduction'):
                export_density.verify_source(source, native, (2, 2), good_hash)
            with self.assertRaisesRegex(ValueError, 'missing'):
                export_density.verify_source(Path(directory) / 'missing.png', native, (2, 2), None)

    def test_parallel_exports_preserve_metadata_and_match_all_recorded_hashes(self):
        root = export_density.BASE / 'export'
        import json
        proof = json.loads((root / 'hd/proof.json').read_text())
        self.assertEqual(len(proof['frames']), 468)
        for row in proof['frames']:
            self.assertEqual(export_density.digest(export_density.BASE / row['path']), row['sha256'])
        for relative in ('', 'blue', 'red', 'exercise/green', 'exercise/blue', 'exercise/red'):
            native = json.loads((root / relative / 'manifest.json').read_text())
            dense = json.loads((root / 'hd' / relative / 'manifest.json').read_text())
            self.assertEqual(dense.pop('pixel_density'), 2)
            for old, new in zip(native['frames'], dense['frames']):
                self.assertNotEqual(old['sha256'], new['sha256'])
                new['sha256'] = old['sha256']
            self.assertEqual(native, dense)


if __name__ == '__main__':
    unittest.main()
