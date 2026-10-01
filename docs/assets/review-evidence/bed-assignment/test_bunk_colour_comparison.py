"""Counterexamples for the opaque-interior colour measurement."""

import importlib.util
from pathlib import Path
import tempfile
import unittest

from PIL import Image


spec = importlib.util.spec_from_file_location(
    "bunk_colours", Path(__file__).with_name("compare-bunk-colours.py"))
colours = importlib.util.module_from_spec(spec)
spec.loader.exec_module(colours)


class ColourComparisonTests(unittest.TestCase):
    def test_detects_opaque_rgb_change_but_excludes_image_boundary(self):
        first = Image.new("RGBA", (11, 11), (80, 90, 100, 255))
        second = first.copy()
        second.putpixel((5, 5), (80, 97, 100, 255))
        second.putpixel((0, 0), (255, 0, 0, 255))
        result = colours.compare(first, second, 4)
        self.assertEqual(result["common_opaque_interior_pixels"], 9)
        self.assertEqual(result["different_rgb_pixels"], 1)
        self.assertEqual(result["maximum_channel_difference"], 7)

    def test_partial_coverage_in_either_sample_excludes_the_neighborhood(self):
        for affected_sample in (0, 1):
            with self.subTest(affected_sample=affected_sample):
                images = [Image.new("RGBA", (11, 11), (80, 90, 100, 255)) for _ in range(2)]
                images[affected_sample].putpixel((5, 5), (200, 90, 100, 254))
                with self.assertRaisesRegex(ValueError, "No common opaque interior"):
                    colours.compare(*images, 4)

    def test_identical_state_reports_zero_difference(self):
        image = Image.new("RGBA", (11, 11), (80, 90, 100, 255))
        result = colours.compare(image, image.copy(), 4)
        self.assertEqual(result["common_opaque_interior_pixels"], 9)
        self.assertEqual(result["different_rgb_pixels"], 0)
        self.assertEqual(result["maximum_channel_difference"], 0)

    def test_changed_source_cannot_keep_its_old_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source.png"
            source.write_bytes(b"first source")
            record = {"path": source.name, "sha256": colours.digest(source)}
            self.assertEqual(colours.checked_path(base, record), source)
            source.write_bytes(b"different source")
            with self.assertRaisesRegex(ValueError, "Receipt hash differs"):
                colours.checked_path(base, record)


if __name__ == "__main__":
    unittest.main()
