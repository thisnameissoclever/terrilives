"""Search complete mirrored ring patches before authoring another full pose."""
import unittest

from toilet_support_search import support_candidates


def grid():
    return [dict(x=side*(.12+ix*.003), y=-.32+iy*.003,
                 seat_z=.45, hip_z=.458, gap=.008)
            for side in (-1, 1) for ix in range(6) for iy in range(17)]


class SupportSearchTests(unittest.TestCase):
    def test_complete_minimum_area_patch_returns_height_interval(self):
        candidates = support_candidates(grid())
        self.assertTrue(candidates)
        self.assertAlmostEqual(candidates[0]['height_interval'][0], -.008)
        self.assertAlmostEqual(candidates[0]['height_interval'][1], -.005)
        self.assertEqual([len(p) for p in candidates[0]['patches']], [102, 102])

    def test_missing_interior_witness_rejects_rectangle(self):
        points = grid()
        del points[2*17+8]
        self.assertEqual(support_candidates(points), [])

    def test_global_penetration_can_conflict_with_local_support(self):
        points = grid()+[dict(x=.2, y=-.1, seat_z=.45, hip_z=.42, gap=-.03)]
        self.assertEqual(support_candidates(points), [])

    def test_duplicate_and_nonfinite_measurements_reject(self):
        for points in (grid()+[grid()[0]], [dict(grid()[0], gap=float('nan'))]):
            with self.assertRaises(ValueError):
                support_candidates(points)


if __name__ == '__main__':
    unittest.main()
