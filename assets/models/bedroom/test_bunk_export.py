"""Padding removal must preserve every visible pixel and world registration."""
import unittest
from PIL import Image

from export_bunk import CROP, cropped_anchor, trim_padding


class BunkExportTests(unittest.TestCase):
    def test_padding_crop_preserves_pixels_and_anchor(self):
        image = Image.new('RGBA', (320,352))
        image.putpixel((70,55), (32,18,3,255))
        cropped = trim_padding(image)
        self.assertEqual(cropped.size, (200,272))
        self.assertEqual(cropped.getpixel((70-CROP[0],55-CROP[1])), (32,18,3,255))
        self.assertEqual(cropped_anchor([80,144]), [50,124])

    def test_nonempty_discarded_pixels_are_rejected(self):
        image = Image.new('RGBA', (320,352))
        image.putpixel((10,55), (0,0,0,1))
        with self.assertRaisesRegex(ValueError, 'visible pixels'):
            trim_padding(image)


if __name__ == '__main__':
    unittest.main()
