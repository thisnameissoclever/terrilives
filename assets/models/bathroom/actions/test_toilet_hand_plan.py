"""Move hands by measured clearance, with a bounded readable gesture."""
import unittest

from toilet_hand_plan import vertical_hand_lift


class HandPlanTests(unittest.TestCase):
    def test_measured_penetration_requires_only_the_contact_clearance(self):
        self.assertAlmostEqual(vertical_hand_lift([-.014, .006, .010]), .015)

    def test_clear_hand_is_not_moved_arbitrarily(self):
        self.assertEqual(vertical_hand_lift([.005, .02]), 0)

    def test_nonfinite_or_unbounded_lift_rejects(self):
        for gaps in ([], [float('nan')], [-.10]):
            with self.assertRaises(ValueError):
                vertical_hand_lift(gaps)


if __name__ == '__main__':
    unittest.main()
