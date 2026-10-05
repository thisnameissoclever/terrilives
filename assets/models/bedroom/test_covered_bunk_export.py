"""Check lossless body trimming, retained filter borders and empty rejection."""
import unittest
from PIL import Image
import export_covered_bunk_sleep as export


class CoveredBunkTrimTests(unittest.TestCase):
    def trim(self, image):
        self.assertTrue(hasattr(export, 'trim_body'), 'Missing registered lossless body trimming')
        return export.trim_body(image)

    def test_sparse_body_retains_exact_offset_and_zero_filter_border(self):
        source = Image.new('RGBA', (188, 262))
        source.putpixel((70, 100), (17, 9, 4, 220))
        source.putpixel((74, 104), (1, 2, 3, 28))
        cropped, box = self.trim(source)
        self.assertEqual(box, [68, 98, 77, 107])
        self.assertEqual(cropped.size, (9, 9))
        self.assertEqual(cropped.getpixel((2, 2)), (17, 9, 4, 220))
        restored = Image.new('RGBA', source.size)
        restored.paste(cropped, (box[0], box[1]))
        self.assertEqual(restored.tobytes(), source.tobytes())
        self.assertTrue(all(cropped.getpixel((x, 0)) == (0, 0, 0, 0) for x in range(9)))
        self.assertTrue(all(cropped.getpixel((0, y)) == (0, 0, 0, 0) for y in range(9)))

    def test_empty_or_unpadded_body_is_not_a_valid_trimmed_layer(self):
        with self.assertRaises(ValueError):
            self.trim(Image.new('RGBA', (8, 8)))
        source = Image.new('RGBA', (8, 8))
        source.putpixel((0, 3), (1, 2, 3, 255))
        with self.assertRaises(ValueError):
            self.trim(source)


if __name__ == '__main__':
    unittest.main()
