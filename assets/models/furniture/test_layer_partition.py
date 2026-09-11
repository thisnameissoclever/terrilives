"""Independent visible contributions combine before the GPU alpha test."""
import unittest

from PIL import Image

from layer_partition import encode_contribution, reconstruct_layers


class LayerPartitionTests(unittest.TestCase):
    def test_shared_outline_is_overlaid_once_after_base_addition(self):
        body = Image.new('RGBA',(1,1),(50,30,10,128))
        furniture = Image.new('RGBA',(1,1),(10,30,50,127))
        ink = Image.new('RGBA',(1,1),(10,5,0,128))
        actual = reconstruct_layers(body,furniture,ink).getpixel((0,0))
        self.assertEqual(actual,(40,35,30,255))

    def test_half_coverage_contacts_remain_opaque(self):
        body = encode_contribution(Image.new('RGBA', (8, 8), (120, 80, 40, 128)), (2, 2))
        furniture = encode_contribution(Image.new('RGBA', (8, 8), (40, 80, 120, 127)), (2, 2))
        actual = reconstruct_layers(body, furniture).getpixel((0, 0))
        self.assertEqual(actual[3], 255)
        for channel in actual[:3]:
            self.assertLessEqual(abs(channel-80), 1)

    def test_resize_does_not_premultiply_a_second_time(self):
        encoded = encode_contribution(Image.new('RGBA', (8, 8), (200, 100, 50, 128)), (2, 2))
        self.assertEqual(encoded.getpixel((0, 0)), (100, 50, 25, 128))

    def test_rejects_overlapping_opaque_ownership(self):
        opaque = Image.new('RGBA', (2, 2), (100, 100, 100, 255))
        with self.assertRaisesRegex(ValueError, 'coverage'):
            reconstruct_layers(opaque, opaque)

    def test_requires_matching_dimensions(self):
        with self.assertRaisesRegex(ValueError, 'dimensions'):
            reconstruct_layers(Image.new('RGBA', (8, 8)), Image.new('RGBA', (4, 4)))


if __name__ == '__main__':
    unittest.main()
