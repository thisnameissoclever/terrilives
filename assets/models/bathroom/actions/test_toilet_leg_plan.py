"""Reachable knees derive from the complete pitched sole, not guessed height."""
import math
import unittest

from toilet_leg_plan import leg_plan


class ToiletLegPlanTests(unittest.TestCase):
    def test_actual_sole_minimum_and_both_bone_lengths_remain_fixed(self):
        points = [(0, -.14, -.11), (0, .04, -.11), (.05, 0, -.10)]
        plan = leg_plan(-.16, .55, points, 16.4)
        hip = (0, -.16, .55)
        knee = (.035, *plan['knee'])
        ankle = (.035, *plan['ankle'])
        self.assertAlmostEqual(math.dist(hip, knee), .37, places=12)
        self.assertAlmostEqual(math.dist(knee, ankle), .36, places=12)
        pitch = math.radians(16.4)
        minimum = min(plan['ankle'][1]+y*math.sin(pitch)+z*math.cos(pitch) for _, y, z in points)
        self.assertAlmostEqual(minimum, .019148, places=12)


if __name__ == '__main__':
    unittest.main()
