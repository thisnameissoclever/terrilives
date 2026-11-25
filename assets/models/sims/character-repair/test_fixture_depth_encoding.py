import unittest

import numpy as np

from fixture_depth_encoding import decode_fixture_depth, encode_fixture_depth


class FixtureDepthEncodingTest(unittest.TestCase):
    def test_keeps_legacy_bytes_and_rejects_out_of_range_samples(self):
        depth = np.array([[-2.0, 0.0, 2.0, np.nan]])
        covered = np.isfinite(depth)
        expected = np.array([[[0, 0, 0, 255], [128, 0, 0, 255],
                              [255, 255, 0, 255], [128, 0, 0, 0]]], dtype=np.uint8)
        self.assertTrue(np.array_equal(encode_fixture_depth(depth, covered, 2), expected))
        np.testing.assert_allclose(decode_fixture_depth(expected, 2)[covered], depth[covered],
                                   atol=2 / 65535)
        with self.assertRaisesRegex(ValueError, r'\[-2, 2\]'):
            encode_fixture_depth(np.array([[2.25]]), np.array([[True]]), 2)

    def test_wide_depth_retains_near_and_far_samples_and_marks_only_covered_pixels(self):
        depth = np.array([[-2.45, 0.0, 2.45, np.nan]])
        covered = np.isfinite(depth)
        pixels = encode_fixture_depth(depth, covered, 3)
        np.testing.assert_array_equal(pixels[:, :, 2], [[128, 128, 128, 0]])
        np.testing.assert_allclose(decode_fixture_depth(pixels, 3)[covered], depth[covered],
                                   atol=3 / 65535)
        with self.assertRaisesRegex(ValueError, 'range flag'):
            decode_fixture_depth(pixels, 2)
        pixels[0, 1, 2] = 0
        with self.assertRaisesRegex(ValueError, 'range flag'):
            decode_fixture_depth(pixels, 3)

    def test_larger_registered_surfaces_preserve_depth_at_both_limits(self):
        for limit in (4, 5, 6, 7):
            values = np.array([[-limit, 0., limit, np.nan]])
            covered = np.isfinite(values)
            pixels = encode_fixture_depth(values, covered, limit)
            self.assertTrue(np.all(pixels[:, :, 2][covered] == 128 + limit - 3))
            self.assertEqual(pixels[0, 3, 2], 0)
            np.testing.assert_allclose(decode_fixture_depth(pixels, limit)[covered],
                                       values[covered], atol=limit / 65535)
