import unittest
import numpy as np

from reading_stock import RawDifference, SCALE, block_average, encode_difference, raw_difference, registered_visibility


class ReadingStock(unittest.TestCase):
    def test_visibility_is_applied_before_filtering(self):
        source = np.zeros((8, 8, 3), np.float32)
        source[:2, :2] = -.8
        visible = np.zeros((8, 8), np.float32)
        visible[:2, :2] = 1
        difference = RawDifference((0, 0), source)
        actual = difference.stock() + difference.correction(visible)
        expected = block_average(source * (1 - visible[:, :, None]))
        np.testing.assert_allclose(actual, expected)
        wrong = difference.stock() * (1 - block_average(visible[:, :, None]))
        self.assertGreater(float(np.abs(wrong - expected).max()), .1)

    def test_signed_coefficients_retain_a_neutral_filter_border(self):
        value = np.zeros((4, 4, 3), np.float32)
        value[1, 1] = [.5, -.5, 1]
        high, low, crop = encode_difference(value, (10, 20))
        self.assertEqual(crop, [10, 20, 13, 23])
        decoded = (np.asarray(high)[:, :, :3].astype(np.int32) * 256
                   + np.asarray(low)[:, :, :3].astype(np.int32) - 32768) / SCALE
        np.testing.assert_allclose(decoded[1, 1], value[1, 1], atol=.5 / SCALE + 1e-7)
        self.assertTrue(np.all(decoded[0] == 0) and np.all(decoded[-1] == 0))
        self.assertTrue(np.all(decoded[:, 0] == 0) and np.all(decoded[:, -1] == 0))
        self.assertIsNone(encode_difference(np.zeros_like(value)))

    def test_source_silhouette_changes_are_not_silently_discarded(self):
        empty = np.zeros((8, 8, 4), np.float32)
        stocked = empty.copy()
        stocked[2, 2, 3] = 1
        with self.assertRaisesRegex(ValueError, 'silhouette'):
            raw_difference(empty, stocked)
        stocked[:, :, 3] = 0
        stocked[2, 2, 0] = .25
        difference = raw_difference(empty, stocked)
        self.assertEqual(difference.origin, (0, 0))
        self.assertEqual(difference.values.shape, (4, 4, 3))

    def test_canvas_padding_does_not_move_stock_coordinates(self):
        visible = np.zeros((1024, 992), np.float32)
        visible[20, 112 + 30] = 1
        registered = registered_visibility(visible, [62, 116], [48, 116])
        self.assertEqual(registered.shape, (960, 768))
        self.assertEqual(registered[20, 30], 1)
        with self.assertRaisesRegex(ValueError, 'pixel grid'):
            registered_visibility(visible, [62.01, 116], [48, 116])


if __name__ == '__main__':
    unittest.main()
