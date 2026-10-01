"""Physical construction of the one-place, low-backed living-room chair."""
import math
from pathlib import Path
import sys
import unittest

from armchair_layout import parts
from sofa_layout import bounds

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'furniture'))
from geometry import FACINGS


class ArmchairLayoutTests(unittest.TestCase):
    def test_seat_is_supported_by_four_grounded_feet(self):
        rows = parts()
        by_name = {part['name']: part for part in rows}
        self.assertEqual(len(by_name), 10)
        feet = {part['name'] for part in rows if part['grounded']}
        self.assertEqual(feet, {f'Foot {x} {y}' for x in (-.18, .28) for y in (-.30, .30)})
        self.assertEqual(set(by_name['Upholstered base']['supports']), feet)
        self.assertEqual(by_name['Seat cushion']['supports'], ['Upholstered base'])
        for name in feet:
            foot = by_name[name]
            self.assertAlmostEqual(foot['center'][2]-foot['size'][2]/2, 0)
        cushion = by_name['Seat cushion']
        self.assertAlmostEqual(cushion['center'][2]+cushion['size'][2]/2, .404)
        self.assertAlmostEqual(bounds(by_name['Upholstered base'])[0][0], -.23)
        self.assertAlmostEqual(bounds(by_name['Arm left'])[1][2], .59)

    def test_every_part_has_a_cycle_free_solid_support_path(self):
        by_name = {part['name']: part for part in parts()}

        def grounded(name, visited):
            self.assertNotIn(name, visited, 'Support cycle')
            part = by_name[name]
            if part['grounded']:
                return
            self.assertTrue(part['supports'], name)
            low, high = bounds(part)
            for other in part['supports']:
                other_low, other_high = bounds(by_name[other])
                for axis in range(3):
                    self.assertGreater(min(high[axis], other_high[axis])
                                       - max(low[axis], other_low[axis]), .015,
                                       f'{name} / {other}')
                grounded(other, visited | {name})

        for name in by_name:
            grounded(name, set())

    def test_low_back_and_front_preserve_the_existing_seat_direction(self):
        by_name = {part['name']: part for part in parts()}
        self.assertEqual(by_name['Upholstered back']['center'], (.30, 0, .68))
        self.assertEqual(by_name['Upholstered back']['size'], (.18, .78, .76))
        self.assertEqual(by_name['Seat cushion']['center'], (.02, 0, .349))
        self.assertAlmostEqual(bounds(by_name['Back cushion'])[0][2], .38)
        expected = {'SE': (0, 1), 'SW': (-1, 0), 'NW': (0, -1), 'NE': (1, 0)}
        for facing, degrees in FACINGS.items():
            angle = math.radians(degrees)
            self.assertLess(math.dist((-math.cos(angle), math.sin(angle)), expected[facing]), 1e-8)
            for part in by_name.values():
                low, high = bounds(part)
                self.assertGreaterEqual(low[2], 0)
                self.assertLessEqual(high[2], 1.06)
                for x in (low[0], high[0]):
                    for y in (low[1], high[1]):
                        self.assertLessEqual(abs(x*math.cos(angle)-y*math.sin(angle)), .44)
                        self.assertLessEqual(abs(x*math.sin(angle)+y*math.cos(angle)), .44)


if __name__ == '__main__':
    unittest.main()
