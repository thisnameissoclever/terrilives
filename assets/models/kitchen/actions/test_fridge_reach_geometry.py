"""The fridge reach schedule, stance and playback rule stay inside their declared limits."""
import math
import unittest

import fridge_reach_geometry as geo


class FridgeReachGeometryTests(unittest.TestCase):
    def test_schedule_opens_reaches_and_closes(self):
        self.assertTrue(geo.validate_schedule())
        self.assertEqual(geo.DOOR_DEGREES, (0, 20, 55, 80, 80, 80, 45, 0))
        self.assertEqual(geo.REACH_SAMPLES, (3, 4, 5))
        self.assertEqual(geo.LEFT_HAND[0], 'rest')
        self.assertEqual(geo.LEFT_HAND[-1], 'rest')

    def test_hinge_matches_the_accepted_model_at_its_root_scale(self):
        self.assertEqual(geo.HINGE, (.35*1.2, -.396*1.2))
        # Closed, the handle sits at its authored place on the door.
        x, y = geo.door_point(geo.HANDLE, 0)
        self.assertAlmostEqual(x, -.245*1.2)
        self.assertAlmostEqual(y, -.491*1.2)
        # Opening swings the free edge forward, toward -Y, into the front tile.
        self.assertLess(geo.door_point(geo.DOOR_TIP, 80)[1], geo.door_point(geo.DOOR_TIP, 20)[1])

    def test_the_standing_shoulders_stay_outside_the_door_sweep(self):
        (x, y), facing, left = geo.stance_frame()
        shoulder = (x+.23*left[0], y+.23*left[1])
        self.assertGreater(math.dist(shoulder, geo.HINGE), geo.sweep_radius()+.05)
        # The feet stand on the front tile row, in front of the case.
        self.assertTrue(-1.5 < y < -.5)

    def test_reach_targets_lie_in_the_cabinet(self):
        for index in geo.REACH_SAMPLES:
            for x, y, z in geo.REACH[index].values():
                self.assertTrue(geo.CABINET['x'][0] < x < geo.CABINET['x'][1])
                self.assertGreater(y, geo.CABINET['y_front'])
                self.assertTrue(geo.CABINET['z'][0] < z < geo.CABINET['z'][1])

    def test_progress_selects_every_sample_in_order_and_reduced_motion_rests(self):
        for total in range(12, 49):
            seen = []
            for elapsed in range(total):
                sample = geo.sample_for_progress(elapsed*1000//total)
                if not seen or seen[-1] != sample:
                    seen.append(sample)
            self.assertEqual(seen, list(range(geo.SAMPLES)), total)
        self.assertEqual(geo.sample_for_progress(600, reduced_motion=True), 0)
        self.assertEqual(geo.sample_for_progress(-5), 0)
        self.assertEqual(geo.sample_for_progress(4000), geo.SAMPLES-1)
        with self.assertRaises(ValueError):
            geo.sample_for_progress(1.5)

    def test_padding_is_whole_logical_pixels(self):
        self.assertEqual(len(geo.PADDING), 4)
        self.assertTrue(all(type(v) is int and v >= 0 for v in geo.PADDING))


if __name__ == '__main__':
    unittest.main()
