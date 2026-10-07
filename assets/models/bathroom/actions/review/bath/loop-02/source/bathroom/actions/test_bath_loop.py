"""The quiet bathing loop closes exactly, nods only the head, and names its sample matrix."""
import math
import unittest

from bath_loop_v1 import (ACTION_NAME, FACINGS, MAX_NOD_DEGREES, OWNERS, STATIC_BONES, head_nod,
                          ink_jobs, render_jobs, sample_phase)


class BathLoopTests(unittest.TestCase):
    def test_head_nod_closes_and_peaks_at_half_phase(self):
        self.assertEqual(head_nod(0), 0)
        self.assertEqual(head_nod(1), 0)
        self.assertAlmostEqual(head_nod(.5), MAX_NOD_DEGREES, places=12)
        self.assertAlmostEqual(head_nod(.25), head_nod(.75), places=12)
        self.assertLess(0, head_nod(.25))
        with self.assertRaises(ValueError):
            head_nod(float('nan'))

    def test_sample_phases_are_quarter_steps_and_reduced_motion_rests(self):
        self.assertEqual([sample_phase(i) for i in range(4)], [0, .25, .5, .75])
        self.assertEqual([sample_phase(i, True) for i in range(4)], [0, 0, 0, 0])
        for bad in (4, -1, 1.0, True):
            with self.assertRaises(ValueError):
                sample_phase(bad)

    def test_static_bones_cover_everything_but_the_head(self):
        self.assertNotIn('head', STATIC_BONES)
        self.assertEqual(len(STATIC_BONES), 16)
        self.assertEqual(len(set(STATIC_BONES)), 16)

    def test_render_matrix_is_four_facings_four_frames_four_owners_one_palette(self):
        jobs = render_jobs()
        self.assertEqual(len(jobs), 4*4*4)
        self.assertEqual(len(set(jobs)), len(jobs))
        self.assertEqual(set(FACINGS), {'SE', 'NW', 'SW', 'NE'})
        self.assertEqual(OWNERS, ('beauty', 'sim', 'furniture', 'lines'))
        self.assertEqual(len(ink_jobs()), 16)
        self.assertEqual(ACTION_NAME, 'bath_idle_v1')
        self.assertTrue(math.isfinite(MAX_NOD_DEGREES) and 0 < MAX_NOD_DEGREES <= 5)


if __name__ == '__main__':
    unittest.main()
