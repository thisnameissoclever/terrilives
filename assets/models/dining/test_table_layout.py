"""Dining table support and footprint contracts, independent of Blender."""
import math
from pathlib import Path
import sys
import unittest

from table_layout import parts
from chair_layout import bounds

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'furniture'))
from geometry import FACINGS


class DiningTableTests(unittest.TestCase):
    def test_four_grounded_legs_support_one_centered_top(self):
        rows = parts()
        self.assertEqual(len(rows), 9)
        self.assertEqual(len({p['name'] for p in rows}), 9)
        feet = [p for p in rows if p['grounded']]
        self.assertEqual(len(feet), 4)
        self.assertEqual({p['center'][:2] for p in feet},
                         {(-.32, -.76), (-.32, .76), (.32, -.76), (.32, .76)})
        for foot in feet:
            self.assertAlmostEqual(bounds(foot)[0][2], 0)
            self.assertEqual(foot['size'], (.09, .09, .735))
            self.assertLess(bounds(foot)[1][2], .79-.04)
        top = next(p for p in rows if p['name'] == 'Tabletop')
        self.assertEqual(top['center'][:2], (0, 0))
        self.assertEqual(top['size'][:2], (.88, 1.86))
        self.assertAlmostEqual(bounds(top)[1][2], .79)
        self.assertEqual(len(top['supports']), 8)

    def test_all_sixteen_joints_have_positive_solid_overlap(self):
        rows = parts()
        by_name = {p['name']: p for p in rows}
        joints = 0
        for part in rows:
            low, high = bounds(part)
            for name in part['supports']:
                other_low, other_high = bounds(by_name[name])
                for axis in range(3):
                    self.assertGreater(min(high[axis], other_high[axis])
                                       - max(low[axis], other_low[axis]), .015,
                                       f'{part["name"]} / {name}')
                joints += 1
        self.assertEqual(joints, 16)

    def test_long_axis_rotates_with_the_existing_two_tile_footprint(self):
        expected = {'SE': (2, 1), 'NW': (2, 1), 'SW': (1, 2), 'NE': (1, 2)}
        for facing, degrees in FACINGS.items():
            angle = math.radians(degrees)
            width, depth = expected[facing]
            for part in parts():
                low, high = bounds(part)
                for x in (low[0], high[0]):
                    for y in (low[1], high[1]):
                        game_x = x*math.cos(angle)-y*math.sin(angle)
                        game_y = -(x*math.sin(angle)+y*math.cos(angle))
                        self.assertLessEqual(abs(game_x), width/2-.03, facing)
                        self.assertLessEqual(abs(game_y), depth/2-.03, facing)
            top = next(p for p in parts() if p['name'] == 'Tabletop')
            long_axis_x = abs(top['size'][1]*math.sin(angle))
            self.assertAlmostEqual(long_axis_x, 1.86 if width == 2 else 0, msg=facing)

    def test_aprons_leave_space_above_the_matching_chair_seat(self):
        aprons = [p for p in parts() if 'apron' in p['name']]
        self.assertEqual(len(aprons), 4)
        for apron in aprons:
            self.assertGreater(bounds(apron)[0][2]-.535, .09)


if __name__ == '__main__':
    unittest.main()
