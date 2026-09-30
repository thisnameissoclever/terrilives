"""Keep the dining chair grounded, joined and physically true to saved facings."""
import math
from pathlib import Path
import sys
import unittest

from chair_layout import parts, bounds

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'furniture'))
from geometry import FACINGS


class DiningChairTests(unittest.TestCase):
    def test_four_feet_and_every_part_stays_inside_one_tile(self):
        rows = parts()
        self.assertEqual(len({p['name'] for p in rows}), len(rows))
        feet = [p for p in rows if p['grounded']]
        self.assertEqual(len(feet), 4)
        self.assertEqual(len({(p['center'][0], p['center'][1]) for p in feet}), 4)
        for part in rows:
            low, high = bounds(part)
            for axis in (0, 1):
                self.assertGreaterEqual(low[axis], -.49)
                self.assertLessEqual(high[axis], .49)
            self.assertGreaterEqual(low[2], -1e-8)
        for foot in feet:
            self.assertAlmostEqual(bounds(foot)[0][2], 0)

    def test_all_named_connections_overlap_in_three_dimensions(self):
        rows = parts()
        by_name = {p['name']: p for p in rows}
        joints = 0
        for part in rows:
            low, high = bounds(part)
            for name in part['supports']:
                other_low, other_high = bounds(by_name[name])
                for axis in range(3):
                    self.assertGreater(min(high[axis], other_high[axis])
                                       - max(low[axis], other_low[axis]), .005,
                                       f'{part["name"]} / {name}')
                joints += 1
        self.assertGreaterEqual(joints, 20)

    def test_back_rails_are_even_and_seat_stays_below_the_table(self):
        rows = parts()
        rails = [p for p in rows if p['name'].startswith('Back rail ')]
        self.assertEqual(len(rails), 3)
        self.assertEqual(len({p['size'] for p in rails}), 1)
        self.assertAlmostEqual(rails[1]['center'][2]-rails[0]['center'][2],
                               rails[2]['center'][2]-rails[1]['center'][2])
        seat = next(p for p in rows if p['name'] == 'Seat')
        self.assertAlmostEqual(bounds(seat)[1][2], .535)

    def test_physical_front_matches_the_original_dining_chair_in_every_facing(self):
        by_name = {p['name']: p for p in parts()}
        seat, back = (by_name[name]['center'] for name in ('Seat', 'Back rail 1'))
        front = (seat[0]-back[0], seat[1]-back[1])
        length = math.hypot(*front)
        expected = {'SE': (0, 1), 'NW': (0, -1), 'SW': (-1, 0), 'NE': (1, 0)}
        for facing, degrees in FACINGS.items():
            angle = math.radians(degrees)
            x = (front[0]*math.cos(angle)-front[1]*math.sin(angle))/length
            y = (front[0]*math.sin(angle)+front[1]*math.cos(angle))/length
            self.assertAlmostEqual(x, expected[facing][0], msg=facing)
            self.assertAlmostEqual(-y, expected[facing][1], msg=facing)


if __name__ == '__main__':
    unittest.main()
