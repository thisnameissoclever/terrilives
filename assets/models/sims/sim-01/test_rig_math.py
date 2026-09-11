import math
import unittest
from rig_math import knee_point, blend, walk_ankle, walk_hip


class RigMathTests(unittest.TestCase):
    def test_blend_is_normalized_and_clamped(self):
        for i in range(-30, 31):
            value = blend(i / 10, 0.4, 0.6)
            self.assertGreaterEqual(value, 0)
            self.assertLessEqual(value, 1)
            self.assertAlmostEqual(value + (1 - value), 1)

    def test_two_link_lengths(self):
        for ankle in ((0, 0.13), (-0.20, 0.13), (0.2, 0.13)):
            hip = (0, .84)
            knee = knee_point(hip, ankle, .39, .36)
            self.assertAlmostEqual(math.dist(hip, knee), .39)
            self.assertAlmostEqual(math.dist(knee, ankle), .36)

    def test_walk_contact_and_loop(self):
        for phase in (0, .1, .3, .49):
            self.assertEqual(walk_ankle(phase)[1], .13)
        self.assertEqual(walk_ankle(0), walk_ankle(1))
        self.assertGreater(walk_ankle(.75)[1], .13)

    def test_one_tile_stride_has_fixed_stance_contact(self):
        for phase in (0,.125,.25,.375):
            # Character root travels toward -Y while planted foot moves back locally.
            self.assertAlmostEqual(walk_ankle(phase)[0]-phase,-.25)
            knee_point((0,walk_hip(phase)),walk_ankle(phase),.37,.36)

    def test_midstance_rises_without_stretching_either_leg(self):
        self.assertGreater(walk_hip(.25),walk_hip(0))
        for index in range(32):
            phase=index/32
            for foot_phase in (phase,phase+.5):
                knee_point((0,walk_hip(phase)),walk_ankle(foot_phase),.37,.36)


if __name__ == '__main__':
    unittest.main()
