"""Closed quiet hand motion and complete source render matrices."""
import unittest

from toilet_loop_v1 import hand_lift, sample_phase, render_jobs, ink_jobs


class ToiletLoopTests(unittest.TestCase):
    def test_closed_upward_only_four_sample_motion(self):
        self.assertEqual(hand_lift(0),0)
        self.assertEqual(hand_lift(1),0)
        self.assertAlmostEqual(hand_lift(.5),.008,places=12)
        self.assertAlmostEqual(hand_lift(.25),.004,places=12)
        self.assertAlmostEqual(hand_lift(.75),.004,places=12)
        self.assertTrue(all(0<=hand_lift(i/100)<=.008 for i in range(101)))
        for phase in (0,.1,.5,.9):
            self.assertAlmostEqual(hand_lift(phase),hand_lift(phase+1),places=12)
        with self.assertRaises(ValueError):
            hand_lift(float('nan'))

    def test_quiet_reduced_motion_holds_approved_first_sample(self):
        self.assertEqual([sample_phase(i) for i in range(4)],[0,.25,.5,.75])
        self.assertEqual([sample_phase(i,reduced_motion=True) for i in range(4)],[0,0,0,0])
        self.assertTrue(all(hand_lift(sample_phase(i,reduced_motion=True))==0 for i in range(4)))
        with self.assertRaises(ValueError):
            sample_phase(4)

    def test_complete_unique_colour_and_body_ink_matrices(self):
        jobs=render_jobs()
        self.assertEqual(len(jobs),192)
        self.assertEqual(len(set(jobs)),192)
        self.assertEqual({j[0] for j in jobs},{'SE','NW','SW','NE'})
        self.assertEqual({j[1] for j in jobs},{'green','blue','red'})
        self.assertEqual({j[3] for j in jobs},{'beauty','sim','furniture','lines'})
        self.assertEqual(len(ink_jobs()),16)
        self.assertEqual(len(set(ink_jobs())),16)


if __name__ == '__main__':
    unittest.main()
