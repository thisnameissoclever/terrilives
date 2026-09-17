"""Pin a hinged door's motion rather than its appearance in one view."""
import math
import unittest

from fridge_geometry import HINGE, door_point


class FridgeDoorTests(unittest.TestCase):
    def test_closed_door_has_its_handle_opposite_the_hinge(self):
        self.assertEqual(door_point((-.60, -.07, .70), 0), (-.25, -.466, .70))

    def test_open_door_moves_outward_and_retains_its_hinge(self):
        hinge = (*HINGE, .70)
        for angle in (0, 25, 55, 90):
            self.assertEqual(door_point((0, 0, .70), angle), hinge)
            handle = door_point((-.60, -.07, .70), angle)
            self.assertAlmostEqual(math.dist(handle, hinge), math.hypot(.60, .07))
        self.assertAlmostEqual(door_point((-.60, 0, .70), 90)[1], HINGE[1] - .60)


if __name__ == '__main__':
    unittest.main()
