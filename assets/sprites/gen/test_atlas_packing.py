"""Reuse shelf gaps without overlapping pixels or relaxing portable limits."""
import unittest
from PIL import Image
from build import pack, compose, deduplicate_pixels, PADDING, AtlasHeightError
from rectangle_packing import pack_rectangles


class AtlasPackingTests(unittest.TestCase):
    def test_rectangle_packer_uses_vertical_gaps_and_is_deterministic(self):
        sizes = [(7, 6), (3, 10), (7, 4)]
        placed, width, height = pack_rectangles(sizes, 12, 12, 1)
        self.assertEqual((width, height), (12, 12))
        self.assertEqual(pack_rectangles(sizes, 12, 12, 1), (placed, width, height))
        boxes = []
        for i, (w, h) in enumerate(sizes):
            x, y = placed[i]
            box = (x, y, x+w+1, y+h+1)
            self.assertLessEqual(box[2], width)
            self.assertLessEqual(box[3], height)
            for other in boxes:
                self.assertTrue(box[0] >= other[2] or box[2] <= other[0] or
                                box[1] >= other[3] or box[3] <= other[1])
            boxes.append(box)

    def test_rectangle_packer_rejects_area_or_dimension_overflow(self):
        for sizes in ([(12, 1)], [(1, 12)], [(8, 8), (8, 8)]):
            with self.subTest(sizes=sizes), self.assertRaisesRegex(ValueError, 'dimension'):
                pack_rectangles(sizes, 12, 12, 1)

    def test_exact_pixel_aliases_preserve_each_named_record(self):
        image = Image.new('RGBA', (4, 5), (100, 50, 10, 127))
        records = [('first', image, 4, 5), ('second', image.copy(), 4, 5)]
        unique, aliases = deduplicate_pixels(records)
        self.assertEqual(aliases, [0, 0])
        self.assertEqual(len(unique), 1)
        placed, width, height = pack(unique, 32)
        sheet = compose(unique, placed, width, height)
        for index, (_, original, w, h) in enumerate(records):
            x, y = placed[aliases[index]]
            self.assertEqual(sheet.crop((x, y, x+w, y+h)).tobytes(), original.tobytes())
        self.assertEqual([row[0] for row in records], ['first', 'second'])

    def test_one_different_pixel_requires_a_separate_rectangle(self):
        image = Image.new('RGBA', (4, 5), (100, 50, 10, 127))
        changed = image.copy()
        changed.putpixel((2, 3), (100, 50, 11, 127))
        unique, aliases = deduplicate_pixels([('first', image, 4, 5), ('changed', changed, 4, 5)])
        self.assertEqual(aliases, [0, 1])
        self.assertEqual(len(unique), 2)

    def test_equal_pixel_bytes_with_different_dimensions_do_not_alias(self):
        records = [('wide', Image.new('RGBA', (4, 2), 'red'), 4, 2),
                   ('tall', Image.new('RGBA', (2, 4), 'red'), 2, 4)]
        self.assertEqual(deduplicate_pixels(records)[1], [0, 1])

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
