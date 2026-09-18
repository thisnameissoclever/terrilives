"""Catch detached rails, misaligned drawer fronts and incorrect room scale."""
import unittest

from desk_layout import parts


class DeskLayoutTests(unittest.TestCase):
    def test_desk_fits_two_by_one_tiles_at_counter_relative_height(self):
        rows = parts()
        self.assertGreater(len(rows), 12)
        top = next(row for row in rows if row['name'] == 'Desktop')
        self.assertAlmostEqual(top['center'][2]+top['size'][2]/2, .78)
        self.assertGreater(top['size'][0], 1.70)
        self.assertLess(top['size'][1], .90)
        for row in rows:
            for axis, limit in ((0, .98), (1, .49)):
                self.assertLessEqual(abs(row['center'][axis])+row['size'][axis]/2, limit)

    def test_every_support_join_overlaps_and_rails_connect_at_both_ends(self):
        rows = parts()
        self.assertGreater(len(rows), 12)
        by_name = {row['name']: row for row in rows}
        self.assertEqual(len(by_name), len(rows))
        for row in rows:
            for name in row['supports']:
                support = by_name[name]
                for axis in range(3):
                    self.assertLess(abs(row['center'][axis]-support['center'][axis]),
                                    (row['size'][axis]+support['size'][axis])/2,
                                    f'{row["name"]} detached from {name} on axis {axis}')
        rail = by_name['Front knee rail']
        self.assertEqual(set(rail['supports']), {'Left front leg', 'Pedestal'})
        self.assertEqual(rail['material'], 'metal')
        self.assertLess(rail['center'][0]-rail['size'][0]/2, -.80)
        self.assertGreater(rail['center'][0]+rail['size'][0]/2, .345)

    def test_drawers_share_front_plane_and_have_connected_handles(self):
        rows = parts()
        fronts = [row for row in rows if row['name'] in ('Drawer 1', 'Drawer 2', 'Drawer 3')]
        self.assertEqual(len(fronts), 3)
        self.assertEqual(len({row['center'][1]-row['size'][1]/2 for row in fronts}), 1)
        for lower, upper in zip(fronts, fronts[1:]):
            self.assertLess(lower['center'][2]+lower['size'][2]/2,
                            upper['center'][2]-upper['size'][2]/2)
        floor = [row for row in rows if row['grounded']]
        self.assertEqual(len(floor), 6)
        for row in floor:
            self.assertAlmostEqual(row['center'][2]-row['size'][2]/2, 0)


if __name__ == '__main__':
    unittest.main()
