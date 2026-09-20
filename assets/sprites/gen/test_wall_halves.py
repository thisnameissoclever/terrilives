"""Endpoint half-panels must not fill their missing arm or alter old art."""
import unittest

from PIL import ImageChops

import objects
from build import render_sprites
from iso import canvas, P


def draw(drawer):
    image, painter = canvas()
    drawer(painter)
    return image


class WallHalfTests(unittest.TestCase):
    def test_each_endcap_draws_only_its_single_arm(self):
        positions = {1: (0, -.25), 2: (.25, 0), 4: (0, .25), 8: (-.25, 0)}
        drawers = objects.WALL_HALF_SPRITES
        self.assertEqual(len(drawers), 4)
        for drawer, bit in zip(drawers, (1, 2, 4, 8)):
            image = draw(drawer)
            for other, (x, y) in positions.items():
                point = tuple(round(v) for v in P(x, y, 1))
                # Opposite arms share a projected x coordinate with another axis.
                if other not in (bit, {1: 4, 2: 8, 4: 1, 8: 2}[bit]):
                    continue
                self.assertEqual(image.getpixel(point)[3], 255 if other == bit else 0)

    def test_halves_reassemble_the_straight_wall_silhouette_and_anchor(self):
        halves = {fn.__name__: draw(fn) for fn in objects.WALL_HALF_SPRITES}
        for a, b, full in ((1, 4, objects.wallNS), (8, 2, objects.wallEW)):
            combined = ImageChops.lighter(halves[f'wallHalf{a}'], halves[f'wallHalf{b}'])
            self.assertEqual(combined.getchannel('A').tobytes(), draw(full).getchannel('A').tobytes())
        for name, image, width, height in render_sprites(objects.WALL_HALF_SPRITES):
            self.assertEqual(width, 32, name)
            self.assertGreater(height, 70, name)


if __name__ == '__main__':
    unittest.main()
