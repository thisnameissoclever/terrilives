"""A support neighborhood needs area, not just long diagonal extents."""
import unittest

from armchair_support import contact_footprint


class ArmchairSupportTests(unittest.TestCase):
    def test_two_dimensional_contact_patch(self):
        points = [(x, y, .405) for x in (-.05, 0, .05) for y in (-.08, 0, .08)]
        result = contact_footprint(points)
        self.assertAlmostEqual(result['xy_hull_area'], .016)
        self.assertEqual(result['contact_bounds'], [[-.05, -.08, .405], [.05, .08, .405]])

    def test_collinear_diagonal_and_duplicate_samples_cannot_fake_area(self):
        for points in ([(x, x*2, .405) for x in (-.05, 0, .05)],
                       [(-.05, -.08, .405)]*6 + [(.05, .08, .405)]*6):
            with self.subTest(points=points), self.assertRaisesRegex(ValueError, 'area'):
                contact_footprint(points)

    def test_a_tiny_patch_cannot_fake_support(self):
        with self.assertRaisesRegex(ValueError, 'extents'):
            contact_footprint([(0, 0, .405), (.005, 0, .405), (0, .005, .405)])

    def test_missing_or_nonfinite_points_are_rejected(self):
        for points in ([], [(0, 0, .4)]*2, [(0, 0, .4), (1, 0, .4), (0, float('nan'), .4)]):
            with self.subTest(points=points), self.assertRaisesRegex(ValueError, 'samples'):
                contact_footprint(points)


if __name__ == '__main__':
    unittest.main()
