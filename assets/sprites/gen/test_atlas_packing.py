"""Reuse shelf gaps without overlapping pixels or relaxing portable limits."""
import unittest
from PIL import Image
from build import pack, PADDING, AtlasHeightError


class AtlasPackingTests(unittest.TestCase):
    def test_a_short_record_fills_a_tall_shelf_gap(self):
        records = [('tall', None, 70, 100), ('wide', None, 80, 90), ('small', None, 20, 80)]
        placed, width, height = pack(records, 100)
        self.assertEqual(placed[2], (70 + PADDING, 0))
        self.assertEqual(height, 190 + 2 * PADDING)
        self.assertEqual(width, 100)

    def test_packed_rectangles_are_disjoint_and_pixels_stay_with_their_indices(self):
        records = [(str(i), Image.new('RGBA', (w, h), (i * 17, 20, 30, 255)), w, h)
                   for i, (w, h) in enumerate([(40, 70), (30, 65), (45, 50), (20, 40), (25, 35)])]
        placed, width, height = pack(records, 100)
        occupied = set()
        for i, (_, _, w, h) in enumerate(records):
            x, y = placed[i]
            region = {(px, py) for px in range(x, x + w + PADDING) for py in range(y, y + h + PADDING)}
            self.assertFalse(occupied.intersection(region))
            self.assertLessEqual(x + w + PADDING, width)
            self.assertLessEqual(y + h + PADDING, height)
            occupied.update(region)
        with self.assertRaises(AtlasHeightError):
            pack([('too-tall', None, 5, 8192)], 100)


if __name__ == '__main__':
    unittest.main()
