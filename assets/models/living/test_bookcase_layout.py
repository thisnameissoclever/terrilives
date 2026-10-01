"""Wall-biased shelving retains the shipped dimensions and supported books."""
import unittest

from bookcase_layout import parts


class BookcaseLayoutTests(unittest.TestCase):
    def test_back_and_crown_preserve_wall_edge_and_height(self):
        rows = {part['name']: part for part in parts()}
        self.assertEqual(rows['Back panel']['center'], (0, .47, .74))
        self.assertEqual(rows['Back panel']['size'], (.86, .06, 1.48))
        self.assertEqual(rows['Crown']['size'], (.90, .30, .08))
        for part in rows.values():
            low = [v-s/2 for v, s in zip(part['center'], part['size'])]
            high = [v+s/2 for v, s in zip(part['center'], part['size'])]
            self.assertGreaterEqual(low[2], -1e-9)
            self.assertLessEqual(high[2], 1.54+1e-9)
            self.assertLessEqual(high[1], .5+1e-9)
            self.assertGreaterEqual(low[1], .2-1e-9)
            self.assertLessEqual(max(abs(low[0]), abs(high[0])), .45+1e-9)

    def test_four_rows_of_books_stand_on_real_shelves(self):
        rows = {part['name']: part for part in parts()}
        books = [p for p in rows.values() if p['material'] != 'wood']
        self.assertEqual(len(books), 24)
        for shelf in range(4):
            support = rows['Base' if shelf == 0 else f'Shelf {shelf}']
            top = support['center'][2]+support['size'][2]/2
            above = rows['Crown' if shelf == 3 else f'Shelf {shelf+1}']
            ceiling = above['center'][2]-above['size'][2]/2
            group = [rows[f'Book {shelf} {index}'] for index in range(6)]
            for book in group:
                self.assertEqual(book['supports'], [support['name']])
                self.assertAlmostEqual(book['center'][2]-book['size'][2]/2, top-.002)
                self.assertLessEqual(book['center'][2]+book['size'][2]/2, top+.29)
                self.assertLess(book['center'][2]+book['size'][2]/2, ceiling)
            for first, second in zip(group, group[1:]):
                self.assertGreater(second['center'][0]-second['size'][0]/2,
                                   first['center'][0]+first['size'][0]/2)


if __name__ == '__main__':
    unittest.main()
