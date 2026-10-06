"""Reject imaginary seat support and stretched two-link limbs."""
import importlib.util
import math
from pathlib import Path
import unittest


class ToiletGeometryTests(unittest.TestCase):
    def setUp(self):
        source = Path(__file__).with_name('toilet_pose_geometry.py')
        self.assertTrue(source.exists(), 'Toilet pose geometry is not implemented')
        spec = importlib.util.spec_from_file_location('toilet_geometry_under_test', source)
        self.geometry = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.geometry)

    def test_annular_membership_rejects_the_empty_centre(self):
        for point, expected in (((0, -.1), False), ((.19, -.1), True),
                                ((-.19, -.1), True), ((.23, -.1), False),
                                ((0, -.36), True), ((float('nan'), -.1), False)):
            self.assertEqual(self.geometry.on_ring(*point), expected)

    def test_support_requires_two_separate_finite_patches(self):
        patches = [[(side*x, y, .45) for x in (.18, .19, .20)
                    for y in (-.13, -.11, -.09)] for side in (-1, 1)]
        result = self.geometry.validate_patches(patches)
        self.assertEqual(len(result), 2)
        self.assertTrue(all(item['area'] >= .0007 for item in result))
        with self.assertRaises(ValueError):
            self.geometry.validate_patches([[(0, -.1, .45)]*9, patches[1]])
        with self.assertRaises(ValueError):
            self.geometry.validate_patches([patches[0], patches[0]])
        with self.assertRaises(ValueError):
            self.geometry.validate_patches([[(-.19, -.1, .45)]*9, patches[1]])
        front_only = [[(side*x, y, .45) for x in (.003, .012, .021)
                       for y in (-.376, -.3535, -.331)] for side in (-1, 1)]
        with self.assertRaises(ValueError):
            self.geometry.validate_patches(front_only)

    def test_two_link_solver_preserves_both_anatomical_lengths(self):
        for hip, ankle in (((-.124, -.12, .60), (-.124, -.50, .13)),
                           ((.124, -.12, .60), (.124, -.50, .13))):
            knee = self.geometry.two_link(hip, ankle, .37, .36, (hip[0], -1, .50))
            self.assertAlmostEqual(math.dist(hip, knee), .37, places=10)
            self.assertAlmostEqual(math.dist(knee, ankle), .36, places=10)
            self.assertLess(knee[1], hip[1])
            self.assertGreater(knee[2], ankle[2])

    def test_unreachable_and_nonfinite_limbs_are_rejected(self):
        for target in ((0, 0, 2), (0, 0, 0), (float('inf'), 0, 0)):
            with self.assertRaises(ValueError):
                self.geometry.two_link((0, 0, 0), target, .37, .36, (0, -1, 0))

    def test_knee_first_plan_preserves_lengths_at_the_reviewers_target(self):
        self.assertTrue(hasattr(self.geometry, 'knee_first'), 'Knee-first planning is missing')
        result = self.geometry.knee_first(-.12, .547968734, .37, .36)
        self.assertAlmostEqual(result['knee'][1], .509, places=10)
        self.assertAlmostEqual(result['knee'][0], -.487942166, places=8)
        self.assertAlmostEqual(result['ankle'][0], -.461127991, places=8)
        self.assertAlmostEqual(result['ankle'][1], .15, places=10)
        self.assertAlmostEqual(math.dist((-.12, .547968734), result['knee']), .37, places=10)
        self.assertAlmostEqual(math.dist(result['knee'], result['ankle']), .36, places=10)
        with self.assertRaises(ValueError):
            self.geometry.knee_first(-.12, 1.2, .37, .36)

    def test_individually_valid_but_unmirrored_patches_are_rejected(self):
        left = [(-x, y, .45) for x in (.18, .19, .20) for y in (-.13, -.11, -.09)]
        right = [(x, y, .45) for x in (.18, .19, .20) for y in (-.12, -.10, -.08)]
        with self.assertRaisesRegex(ValueError, 'mirrored'):
            self.geometry.validate_patches([left, right])

    def test_outward_knee_route_preserves_three_dimensional_thigh_length(self):
        try:
            result = self.geometry.knee_first(-.16, .55, .37, .36, lateral_delta=.035)
        except TypeError:
            self.fail('Knee-first planner does not support the reviewed lateral route')
        self.assertAlmostEqual(result['knee'][0], -.526051909, places=8)
        self.assertAlmostEqual(result['ankle'][0], -.499237734, places=8)
        self.assertAlmostEqual(math.dist((.124, -.16, .55), (.159, *result['knee'])), .37, places=10)
        self.assertAlmostEqual(math.dist((.159, *result['knee']), (.159, *result['ankle'])), .36, places=10)
        with self.assertRaises(ValueError):
            self.geometry.knee_first(-.16, .55, .37, .36, lateral_delta=.38)

    def test_rigid_sole_pitch_derives_ankle_height_from_every_actual_vertex(self):
        self.assertTrue(hasattr(self.geometry, 'sole_ankle_height'), 'Rigid sole planning is missing')
        points = [(0, -.14, -.10), (0, 0, -.11), (0, -.07, -.105)]
        self.assertAlmostEqual(self.geometry.sole_ankle_height(points, 0), .129148, places=10)
        self.assertAlmostEqual(self.geometry.sole_ankle_height(points, 90), .159148, places=10)
        for vertices, pitch in (([], 0), ([(0, float('nan'), 0)], 0), (points, float('inf'))):
            with self.assertRaises(ValueError):
                self.geometry.sole_ankle_height(vertices, pitch)

    def test_pitch_candidate_rejects_anatomically_unreachable_high_sole(self):
        self.assertTrue(hasattr(self.geometry, 'sole_ankle_height'), 'Rigid sole planning is missing')
        ankle_z = self.geometry.sole_ankle_height([(0, 0, -1)], 0)
        with self.assertRaises(ValueError):
            self.geometry.knee_first(-.16, .55, .37, .36, ankle_z=ankle_z, lateral_delta=.035)


if __name__ == '__main__':
    unittest.main()
