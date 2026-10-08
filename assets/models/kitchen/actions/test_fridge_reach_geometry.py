"""The fridge reach schedule, stance and playback rule stay inside their declared limits."""
import math
import unittest

import fridge_reach_geometry as geo


class FridgeReachGeometryTests(unittest.TestCase):
    def test_schedule_opens_reaches_and_closes(self):
        self.assertTrue(geo.validate_schedule())
        self.assertEqual(geo.DOOR_DEGREES, (0, 20, 55, 80, 80, 80, 80, 0))
        self.assertEqual(geo.REACH_SAMPLES, (4, 5))
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

    def test_the_body_stays_in_the_front_tile_column_and_out_of_the_moving_door(self):
        for index in range(geo.SAMPLES):
            x, y = geo.stance(index)
            self.assertLessEqual(abs(x)+geo.BODY_HALF_WIDTH, geo.TILE_HALF_WIDTH+1e-9)
            self.assertLess(y, -.5)
        # While the door moves, the near shoulder corner of the BACK stance is outside
        # the door's sweep; the REACH stance is used only while the door stands open.
        x, y = geo.STANCES['BACK']
        corner = (x+geo.BODY_HALF_WIDTH, y+.16)
        self.assertGreater(math.dist(corner, geo.HINGE), geo.sweep_radius())
        for index in range(geo.SAMPLES-1):
            if geo.DOOR_DEGREES[index] != geo.DOOR_DEGREES[index+1]:
                self.assertNotIn('REACH', (geo.STANCE_BY_SAMPLE[index], geo.STANCE_BY_SAMPLE[index+1]))

    def test_a_stance_outside_the_column_is_refused(self):
        saved = dict(geo.STANCES)
        try:
            geo.STANCES['FRONT'] = (-.55, -1.03)
            with self.assertRaises(ValueError):
                geo.validate_schedule()
        finally:
            geo.STANCES.clear()
            geo.STANCES.update(saved)

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
