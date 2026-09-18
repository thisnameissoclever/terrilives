"""Physical bounds of the closed bedroom storage models."""
import unittest

from storage_layout import parts


class StorageLayoutTests(unittest.TestCase):
    def test_all_attached_parts_overlap_their_support(self):
        for kind in ('nightstand', 'dresser'):
            rows = parts(kind)
            by_name = {row['name']: row for row in rows}
            for row in rows:
                if not row['support']:
                    continue
                support = by_name[row['support']]
                for axis in range(3):
                    gap = abs(row['center'][axis]-support['center'][axis])
                    reach = (row['size'][axis]+support['size'][axis])/2
                    self.assertLess(gap, reach, f'{kind}: {row["name"]} detached on axis {axis}')

    def test_nightstand_is_bedside_height_and_stays_inside_one_tile(self):
        rows = parts('nightstand')
        top = next(row for row in rows if row['name'] == 'Top')
        self.assertAlmostEqual(top['center'][2]+top['size'][2]/2, .52)
        feet = [row for row in rows if row['name'].startswith('Foot ')]
        self.assertEqual(len(feet), 4)
        for foot in feet:
            self.assertAlmostEqual(foot['center'][2]-foot['size'][2]/2, 0)
        for row in rows:
            for axis in (0, 1):
                self.assertLessEqual(abs(row['center'][axis])+row['size'][axis]/2, .45)

    def test_dresser_has_three_separate_fronts_and_is_taller_than_nightstand(self):
        rows = parts('dresser')
        fronts = [row for row in rows if row['name'] in ('Drawer 1', 'Drawer 2', 'Drawer 3')]
        self.assertEqual(len(fronts), 3)
        top = next(row for row in rows if row['name'] == 'Top')
        self.assertAlmostEqual(top['center'][2]+top['size'][2]/2, .95)
        for lower, upper in zip(fronts, fronts[1:]):
            self.assertGreater(upper['center'][2]-upper['size'][2]/2,
                               lower['center'][2]+lower['size'][2]/2)
        for row in rows:
            for axis in (0, 1):
                self.assertLessEqual(abs(row['center'][axis])+row['size'][axis]/2, .45)


if __name__ == '__main__':
    unittest.main()
