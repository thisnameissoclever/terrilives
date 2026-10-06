"""Actual-basin domains, finite support neighborhoods and rotation-only limbs."""
import math
import unittest

from bath_pose_geometry import (basin_contains, basin_contour, recline_vector,
                                two_link, validate_support_patch)


class BathGeometryTests(unittest.TestCase):
    def test_actual_sloped_rounded_basin_domain(self):
        self.assertTrue(basin_contains(0, -.06, .15))
        self.assertTrue(basin_contains(.30, -.06, .50))
        self.assertFalse(basin_contains(.34, -.06, .50))
        self.assertFalse(basin_contains(.22, .57, .15))
        self.assertFalse(basin_contains(0, -.06, .14))
        self.assertFalse(basin_contains(float('nan'), 0, .4))

    def test_contour_is_below_rim_and_inside_real_basin(self):
        points = basin_contour(.45)
        self.assertGreater(len(points), 16)
        self.assertTrue(all(basin_contains(*p) for p in points))
        self.assertAlmostEqual(sum(p[1] for p in points)/len(points), -.06, places=12)
        for height in (.15, .57, float('nan')):
            with self.assertRaises(ValueError):
                basin_contour(height)

    def test_full_recline_transform_faces_up_and_head_away_from_tap(self):
        face = recline_vector((0, -1, 0), 80)
        head_axis = recline_vector((0, 0, 1), 80)
        self.assertGreater(face[2], .98)
        self.assertLess(head_axis[1], -.98)
        self.assertAlmostEqual(math.dist((0, 0, 0), face), 1, places=12)

    def test_finite_support_patch_cannot_bridge_missing_samples(self):
        points = [dict(x=x, y=y, body_z=.151, basin_z=.15, gap=.001)
                  for x in (-.015, 0, .015) for y in (-.02, 0, .02)]
        result = validate_support_patch(points)
        self.assertGreaterEqual(result['area'], .0012)
        for invalid in (points[:-1], [points[0]]*9,
                        [dict(p, gap=-.001) for p in points],
                        [dict(p, body_z=float('nan')) for p in points]):
            with self.assertRaises(ValueError):
                validate_support_patch(invalid)

    def test_reachable_limb_retains_anatomical_lengths(self):
        start, end = (0, .35, .28), (0, .5, .24)
        joint = two_link(start, end, .37, .36, (0, .6, .8))
        self.assertAlmostEqual(math.dist(start, joint), .37, places=12)
        self.assertAlmostEqual(math.dist(joint, end), .36, places=12)
        with self.assertRaises(ValueError):
            two_link(start, (0, 2, .24), .37, .36, (0, .6, .8))


if __name__ == '__main__':
    unittest.main()
