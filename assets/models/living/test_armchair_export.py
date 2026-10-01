"""Original images must be readable full-size RGBA, not merely hash-matching files."""
import tempfile
from pathlib import Path
import unittest

from PIL import Image

from export_armchair import read_original, validate_anchor


class ArmchairExportTests(unittest.TestCase):
    def test_source_format_and_decoding(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'source.png'
            Image.new('RGBA', (768, 960), (10, 20, 30, 255)).save(path)
            self.assertEqual(read_original(path).size, (768, 960))
            for mode, size in (('RGB', (768, 960)), ('RGBA', (192, 240))):
                Image.new(mode, size).save(path)
                with self.assertRaisesRegex(ValueError, 'full-resolution'):
                    read_original(path)
            Image.new('RGBA', (768, 960)).save(path, format='BMP')
            with self.assertRaisesRegex(ValueError, 'full-resolution'):
                read_original(path)
            path.write_bytes(b'not a png')
            with self.assertRaises(OSError):
                read_original(path)

    def test_camera_anchor_requires_finite_correct_registration(self):
        validate_anchor([48.000011, 116.000437])
        for anchor in (None, [], [48], [48, 116, 0], [False, 116], [48, float('nan')],
                       [48, float('inf')], [48, 115]):
            with self.subTest(anchor=anchor), self.assertRaisesRegex(ValueError, 'registration'):
                validate_anchor(anchor)


if __name__ == '__main__':
    unittest.main()
