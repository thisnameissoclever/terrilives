"""Physical invariants for authoring, independent of Blender or image style."""
import importlib.util
import math
from pathlib import Path
import unittest


class FurnitureGeometryTests(unittest.TestCase):
    def geometry(self):
        path = Path(__file__).with_name('geometry.py')
        self.assertTrue(path.is_file(), 'furniture geometry contract is missing')
        spec = importlib.util.spec_from_file_location('furniture_geometry', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_asymmetric_landmark_makes_four_rotations_not_mirrors(self):
        g = self.geometry()
        expected = {'SE': (-2, 1, 3), 'NW': (2, -1, 3),
                    'SW': (1, 2, 3), 'NE': (-1, -2, 3)}
        for facing, point in expected.items():
            self.assertEqual(g.rotate((1, 2, 3), facing), point)
        with self.assertRaises(ValueError):
            g.rotate((1, 2, 3), 'north')

    def test_cranks_stay_on_opposite_sides_and_half_cycle_apart(self):
        g = self.geometry()
        for index in range(32):
            left = g.pedal('L', index / 32)
            right = g.pedal('R', index / 32)
            self.assertLess(left[0], -g.HOUSING_HALF_WIDTH)
            self.assertGreater(right[0], g.HOUSING_HALF_WIDTH)
            for axis in (1, 2):
                self.assertAlmostEqual(left[axis] + right[axis], 2 * g.AXLE[axis])
            self.assertAlmostEqual(math.dist(left[1:], g.AXLE[1:]), g.CRANK_RADIUS)
            self.assertGreater(left[2] - g.PEDAL_THICKNESS / 2, g.MAT_TOP)
            self.assertGreater(right[2] - g.PEDAL_THICKNESS / 2, g.MAT_TOP)
        self.assertNotEqual(g.pedal('L', 0), g.pedal('L', .25))
        with self.assertRaises(ValueError):
            g.pedal('front', 0)

    def test_towel_crown_contacts_tube_without_entering_it(self):
        g = self.geometry()
        for i in range(101):
            x, z = g.towel_section(i / 100)
            self.assertGreaterEqual(math.hypot(x, z), g.HANDLE_RADIUS + .001 - 1e-8)
        x, z = g.towel_section(.5)
        self.assertAlmostEqual(x, 0)
        self.assertAlmostEqual(z, g.HANDLE_RADIUS + .001)
        self.assertLess(g.towel_section(0)[1], -.25)
        self.assertLess(g.towel_section(1)[1], -.25)


if __name__ == '__main__':
    unittest.main()
