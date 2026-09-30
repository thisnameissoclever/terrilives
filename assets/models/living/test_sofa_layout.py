"""Sofa construction, source orientation and unchanged two-tile envelope."""
import math
from pathlib import Path
import sys
import unittest

from sofa_layout import bounds, parts

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'furniture'))
from geometry import FACINGS


class SofaLayoutTests(unittest.TestCase):
    def test_inventory_and_grounded_supports(self):
        rows = parts()
        self.assertEqual(len(rows), 14)
        self.assertEqual(len({p['name'] for p in rows}), 14)
        feet = [p for p in rows if p['grounded']]
        self.assertEqual(len(feet), 4)
        self.assertEqual({p['center'][:2] for p in feet},
                         {(x, y) for x in (-.29, .29) for y in (-.75, .75)})
        for foot in feet:
            self.assertEqual(foot['size'], (.10, .11, .22))
            self.assertAlmostEqual(bounds(foot)[0][2], 0)

    def test_upholstery_has_connected_supports(self):
        by_name = {p['name']: p for p in parts()}
        joints = 0
        for part in by_name.values():
            self.assertTrue(part['grounded'] or part['supports'])
            low, high = bounds(part)
            for name in part['supports']:
                other_low, other_high = bounds(by_name[name])
                for axis in range(3):
                    self.assertGreater(min(high[axis], other_high[axis])
                                       - max(low[axis], other_low[axis]), .02,
                                       f'{part["name"]} / {name}')
                joints += 1
        self.assertEqual(joints, 18)

    def test_three_equal_seats_and_back_pads_do_not_overlap_each_other(self):
        rows = parts()
        for prefix in ('Seat cushion', 'Back cushion'):
            cushions = [p for p in rows if p['name'].startswith(prefix)]
            self.assertEqual(len(cushions), 3)
            self.assertEqual(len({p['size'] for p in cushions}), 1)
            self.assertEqual([p['center'][1] for p in cushions], [-.52, 0, .52])
            for left, right in zip(cushions, cushions[1:]):
                self.assertAlmostEqual(bounds(right)[0][1]-bounds(left)[1][1], .01)
        seats = [p for p in rows if p['name'].startswith('Seat cushion')]
        for seat in seats:
            self.assertAlmostEqual(bounds(seat)[1][2], .56)
            self.assertEqual(seat['size'], (.66, .51, .18))

    def test_front_is_local_negative_x_and_default_runtime_positive_y(self):
        by_name = {p['name']: p for p in parts()}
        self.assertEqual(by_name['Upholstered back']['center'], (.335, 0, .68))
        self.assertEqual(by_name['Upholstered back']['size'], (.20, 1.78, .74))
        for index in range(3):
            self.assertEqual(by_name[f'Back cushion {index}']['center'][0], .21)
            self.assertEqual(by_name[f'Seat cushion {index}']['center'][0], -.075)
        expected = {'SE': (0, 1), 'NW': (0, -1), 'SW': (-1, 0), 'NE': (1, 0)}
        for facing, degrees in FACINGS.items():
            radians = math.radians(degrees)
            front = (-math.cos(radians), math.sin(radians))
            self.assertLess(math.dist(front, expected[facing]), 1e-8)

    def test_all_facings_stay_inside_the_existing_footprint(self):
        for facing, degrees in FACINGS.items():
            angle = math.radians(degrees)
            width, depth = (2, 1) if facing in ('SE', 'NW') else (1, 2)
            for part in parts():
                low, high = bounds(part)
                self.assertGreaterEqual(low[2], 0)
                self.assertLessEqual(high[2], 1.05)
                for x in (low[0], high[0]):
                    for y in (low[1], high[1]):
                        gx = x*math.cos(angle)-y*math.sin(angle)
                        gy = -(x*math.sin(angle)+y*math.cos(angle))
                        self.assertLessEqual(abs(gx), width/2-.03, facing)
                        self.assertLessEqual(abs(gy), depth/2-.03, facing)


if __name__ == '__main__':
    unittest.main()
