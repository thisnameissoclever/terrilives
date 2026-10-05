"""The accepted aquarium fits without rotating or shrinking any source rectangle."""
import hashlib
import json
from pathlib import Path
import unittest

from rectangle_packing import pack_rectangles

FIXTURE = json.loads(Path(__file__).with_name('aquarium-packing-inputs.json').read_text())


class AquariumPacking(unittest.TestCase):
    def test_retains_the_published_successful_rectangle_layout(self):
        placed, width, height = pack_rectangles(FIXTURE['sizes'], 8192, 8192, 1)
        self.assertEqual((width, height), (8192, 8192))
        positions = [placed[index] for index in range(len(FIXTURE['sizes']))]
        digest = hashlib.sha256(json.dumps(positions, separators=(',', ':')).encode()).hexdigest()
        self.assertEqual(digest, FIXTURE['positions_sha256'])

    def test_fits_the_complete_release_and_eight_full_resolution_aquarium_views(self):
        sizes = FIXTURE['sizes'] + [[192, 240]] * 8
        try:
            placed, width, height = pack_rectangles(sizes, 8192, 8192, 1)
        except ValueError as error:
            self.fail(f'The admissible published-plus-aquarium input must fit: {error}')
        self.assertEqual(width, 8192)
        self.assertLessEqual(height, 8192)
        self.assertEqual(set(placed), set(range(len(sizes))))
        rectangles = []
        for index, (w, h) in enumerate(sizes):
            x, y = placed[index]
            self.assertGreaterEqual(min(x, y), 0)
            self.assertLessEqual(x + w + 1, width)
            self.assertLessEqual(y + h + 1, height)
            rectangles.append((x, y, x + w + 1, y + h + 1))
        for index, (left, top, right, bottom) in enumerate(rectangles):
            for other_left, other_top, other_right, other_bottom in rectangles[index + 1:]:
                self.assertTrue(right <= other_left or other_right <= left or
                                bottom <= other_top or other_bottom <= top,
                                f'Overlapping padded rectangles at {index}')


if __name__ == '__main__':
    unittest.main()
