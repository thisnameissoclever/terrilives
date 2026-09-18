"""An oven door must open outward without moving its lower hinge."""
import math
import unittest

from stove_geometry import door_point


class StoveDoorTests(unittest.TestCase):
    def test_closed_handle_is_above_and_in_front_of_lower_hinge(self):
        point = door_point((.25, -.055, .55), 0)
        for actual, expected in zip(point, (.25, -.531, .725)):
            self.assertAlmostEqual(actual, expected)

    def test_open_handle_moves_forward_not_into_the_oven(self):
        point = door_point((.25, -.055, .55), 90)
        for actual, expected in zip(point, (.25, -1.026, .120)):
            self.assertAlmostEqual(actual, expected)

    def test_hinge_stays_fixed_and_door_remains_rigid_through_swing(self):
        hinge = (0, -.476, .175)
        for angle in (0, 25, 55, 90):
            self.assertEqual(door_point((0, 0, 0), angle), hinge)
            self.assertAlmostEqual(math.dist(door_point((0, -.055, .55), angle), hinge),
                                   math.hypot(.055, .55))


if __name__ == '__main__':
    unittest.main()
