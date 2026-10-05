"""Exercise bounded texture pages without rotation or missing rectangles."""
import importlib
import unittest


class AtlasPageTests(unittest.TestCase):
    def pack(self, sizes, size=10):
        try:
            module = importlib.import_module('atlas_pages')
        except ModuleNotFoundError:
            self.fail('Missing the bounded paginated atlas allocator')
        return module.pack_pages(sizes, size, 1)

    def test_overfull_single_page_allocates_more_pages_without_losing_pixels(self):
        placements, count = self.pack([(5, 5), (5, 5), (5, 5)])
        self.assertEqual(count, 3)
        self.assertEqual(placements, {0: (0, 0, 0), 1: (1, 0, 0), 2: (2, 0, 0)})

    def test_reuses_shelves_and_preserves_original_record_keys(self):
        placements, count = self.pack([(3, 3), (5, 5), (3, 3)])
        self.assertEqual(count, 1)
        self.assertEqual(placements, {1: (0, 0, 0), 0: (0, 6, 0), 2: (0, 0, 6)})

    def test_every_padded_rectangle_is_in_bounds_and_nonoverlapping(self):
        sizes = [(i % 7 + 1, i % 5 + 1) for i in range(60)]
        placed, count = self.pack(sizes)
        self.assertEqual(set(placed), set(range(60)))
        self.assertEqual((placed, count), self.pack(sizes))
        for index, (page, x, y) in placed.items():
            width, height = sizes[index]
            self.assertTrue(0 <= page < count and x >= 0 and y >= 0)
            self.assertLessEqual(x+width+1, 10)
            self.assertLessEqual(y+height+1, 10)
            for other, (q, a, b) in placed.items():
                if other <= index or q != page:
                    continue
                w, h = sizes[other]
                self.assertTrue(x+width+1 <= a or a+w+1 <= x or y+height+1 <= b or b+h+1 <= y)

    def test_rejects_oversize_and_invalid_geometry(self):
        for sizes in ([(10, 1)], [(0, 4)], [(1, -1)], [(1.5, 2)]):
            with self.subTest(sizes=sizes), self.assertRaises(ValueError):
                self.pack(sizes)


if __name__ == '__main__':
    unittest.main()
