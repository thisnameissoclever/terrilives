"""Physical constraints for a static one-tile office chair."""
import math
from pathlib import Path
import sys
import unittest

from chair_layout import bounds, parts
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'furniture'))
from geometry import FACINGS


class ChairLayoutTests(unittest.TestCase):
    def test_physical_front_preserves_existing_saved_facing_directions(self):
        by_name = {p['name']: p for p in parts()}
        seat, back = (by_name[name]['center'] for name in ('Seat cushion', 'Back cushion'))
        front = (seat[0]-back[0], seat[1]-back[1])
        length = math.hypot(*front)
        expected = {'SE': (0, 1), 'NW': (0, -1), 'SW': (-1, 0), 'NE': (1, 0)}
        for facing, degrees in FACINGS.items():
            angle = math.radians(degrees)
            x = (front[0]*math.cos(angle)-front[1]*math.sin(angle))/length
            y = (front[0]*math.sin(angle)+front[1]*math.cos(angle))/length
            # Blender +X is game +X; Blender +Y is game -Y for this camera.
            self.assertAlmostEqual(x, expected[facing][0], msg=facing)
            self.assertAlmostEqual(-y, expected[facing][1], msg=facing)

    def test_complete_grounded_five_spoke_base_fits_one_tile(self):
        rows = parts()
        self.assertEqual(len({p['name'] for p in rows}), len(rows))
        spokes = [p for p in rows if p['name'].startswith('Base spoke ')]
        wheels = [p for p in rows if p['grounded']]
        self.assertEqual(len(spokes), 5)
        self.assertEqual(len(wheels), 10)
        angles = sorted(math.atan2(p['b'][1], p['b'][0]) % math.tau for p in spokes)
        for i, angle in enumerate(angles):
            self.assertAlmostEqual((angles[(i+1) % 5]-angle) % math.tau, math.tau/5)
        for part in rows:
            low, high = bounds(part)
            self.assertGreaterEqual(low[0], -.49)
            self.assertGreaterEqual(low[1], -.49)
            self.assertLessEqual(high[0], .49)
            self.assertLessEqual(high[1], .49)
            self.assertGreaterEqual(low[2], -1e-8)
        for wheel in wheels:
            self.assertAlmostEqual(bounds(wheel)[0][2], 0)

    def test_every_declared_joint_has_positive_overlap(self):
        rows = parts()
        by_name = {p['name']: p for p in rows}
        joints = 0
        for part in rows:
            low, high = bounds(part)
            for other in part['supports']:
                other_low, other_high = bounds(by_name[other])
                for axis in range(3):
                    self.assertGreater(min(high[axis], other_high[axis])
                                       - max(low[axis], other_low[axis]), 0,
                                       f'{part["name"]} detached from {other}')
                joints += 1
        self.assertGreater(joints, 25)

    def test_seat_is_below_desk_and_back_is_on_the_rear_side(self):
        by_name = {p['name']: p for p in parts()}
        seat = by_name['Seat cushion']
        back = by_name['Back cushion']
        self.assertLess(bounds(seat)[1][2], .60)
        self.assertGreater(bounds(seat)[1][2], .48)
        self.assertGreater(back['center'][0], 0)
        self.assertGreater(bounds(back)[1][2], 1.0)
        self.assertEqual(back['material'], 'fabric')
        self.assertIn('Back shell', back['supports'])

    def test_hidden_back_spine_cannot_break_through_the_rear_shell(self):
        by_name = {p['name']: p for p in parts()}
        self.assertLessEqual(bounds(by_name['Back spine'])[1][0],
                             bounds(by_name['Back shell'])[1][0]-.01)


if __name__ == '__main__':
    unittest.main()
