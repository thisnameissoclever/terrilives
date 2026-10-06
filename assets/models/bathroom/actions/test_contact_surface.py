"""Certify actual triangle coverage and continuous gaps, not corner rays alone."""
import unittest

from contact_surface import certify_cell, connected_regions


def square(z):
    a, b, c, d = (0, 0, z), (1, 0, z), (1, 1, z), (0, 1, z)
    return [(a, b, c), (a, c, d)]


class ContactSurfaceTests(unittest.TestCase):
    def test_complete_piecewise_affine_surfaces_certify_gap(self):
        result = certify_cell((0, 0, 1, 1), square(.001), square(0))
        self.assertAlmostEqual(result['area'], 1)
        self.assertAlmostEqual(result['min_gap'], .001)
        self.assertAlmostEqual(result['max_gap'], .001)

    def test_interior_peak_fails_even_with_four_good_corners(self):
        a, b, c, d = (0, 0, .001), (1, 0, .001), (1, 1, .001), (0, 1, .001)
        center = (.5, .5, .02)
        with self.assertRaisesRegex(ValueError, 'gap'):
            certify_cell((0, 0, 1, 1), [(a, b, center), (b, c, center), (c, d, center), (d, a, center)], square(0))

    def test_missing_interior_area_cannot_be_counted_as_supported(self):
        with self.assertRaisesRegex(ValueError, 'coverage'):
            certify_cell((0, 0, 1, 1), square(.001), square(0)[:1])

    def test_duplicate_surface_cannot_double_count_area(self):
        with self.assertRaisesRegex(ValueError, 'overlap'):
            certify_cell((0, 0, 1, 1), square(.001)+square(.001)[:1], square(0))

    def test_corner_touch_does_not_connect_contact_regions(self):
        regions = connected_regions({(0, 0): .000009, (1, 1): .000009}, .003)
        self.assertEqual(len(regions), 2)
        self.assertTrue(all(r['area'] == .000009 for r in regions))

    def test_edge_connected_region_counts_actual_area_not_bounds(self):
        regions = connected_regions({(0, 0): .000009, (1, 0): .000009, (1, 1): .000009}, .003)
        self.assertEqual(len(regions), 1)
        self.assertAlmostEqual(regions[0]['area'], .000027)
        self.assertAlmostEqual(regions[0]['width'], .006)
        self.assertAlmostEqual(regions[0]['depth'], .006)

    def test_nonfinite_surface_evidence_rejects(self):
        with self.assertRaises(ValueError):
            certify_cell((0, 0, 1, 1), [[(float('nan'), 0, 0), (1, 0, 0), (1, 1, 0)]], square(0))

    def test_physical_three_millimetre_cell_retains_area_and_tilted_extrema(self):
        def tile(tilt):
            a, b, c, d = (0, 0, .001), (.003, 0, .001+tilt), (.003, .003, .001+tilt), (0, .003, .001)
            return [(a, b, c), (a, c, d)]
        seat = [tuple((x, y, 0) for x, y, _ in tri) for tri in tile(0)]
        result = certify_cell((0, 0, .003, .003), tile(.002), seat)
        self.assertAlmostEqual(result['area'], .000009, places=14)
        self.assertAlmostEqual(result['min_gap'], .001)
        self.assertAlmostEqual(result['max_gap'], .003)

    def test_tiny_positive_area_does_not_hide_an_out_of_range_surface(self):
        extra = ((.5, .5, .02), (.5000001, .5, .02), (.5, .5000001, .02))
        with self.assertRaises(ValueError):
            certify_cell((0, 0, 1, 1), square(.001)+[extra], square(0))


if __name__ == '__main__':
    unittest.main()
