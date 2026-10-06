import math
import unittest
from toilet_support_planner import height_interval, minimal_grid_rectangles


class SupportPlannerTests(unittest.TestCase):
    def test_contact_and_patch_constraints_share_one_height_interval(self):
        result = height_interval([-.02, -.015, -.014], [-.015, -.014])
        self.assertAlmostEqual(result[0], .02)
        self.assertAlmostEqual(result[1], .023)
        for shift in result:
            self.assertGreaterEqual(min(gap+shift for gap in [-.02, -.015, -.014]), 0)
            self.assertLessEqual(max(gap+shift for gap in [-.015, -.014]), .01)

    def test_one_close_point_does_not_certify_a_distant_patch(self):
        self.assertIsNone(height_interval([-.02, .001], [.001]))

    def test_patch_points_participate_in_nonpenetration(self):
        self.assertIsNone(height_interval([0], [-.02, -.019]))

    def test_nonfinite_and_empty_inputs_are_rejected(self):
        for global_gaps, patch in [([], [0]), ([0], []), ([math.nan], [0]), ([0], [math.inf])]:
            with self.subTest(global_gaps=global_gaps, patch=patch):
                with self.assertRaises(ValueError):
                    height_interval(global_gaps, patch)

    def test_grid_search_enumerates_all_minimal_admissible_shapes(self):
        self.assertEqual(minimal_grid_rectangles(.003, .015, .035, .0007),
                         [(5, 16), (6, 13), (7, 12)])
        for width in range(5, 25):
            for depth in range(12, 40):
                if width*depth* .003**2 >= .0007:
                    self.assertTrue(any(a <= width and b <= depth for a, b in
                                        minimal_grid_rectangles(.003, .015, .035, .0007)))

    def test_invalid_search_parameters_are_rejected(self):
        for parameters in [(0, .015, .035, .0007), (.003, math.inf, .035, .0007),
                           (.003, .015, .035, -1)]:
            with self.assertRaises(ValueError):
                minimal_grid_rectangles(*parameters)
