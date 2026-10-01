"""The hanging fabric wraps its rail and stays clear of the wooden upright."""
import math
import unittest

from coat_rack_layout import drape_point, parts


class CoatRackLayoutTests(unittest.TestCase):
    def test_drape_has_two_attached_tails_and_clears_the_upright(self):
        front, top, rear = [drape_point(t, .5) for t in (0, .5, 1)]
        self.assertLess(front[1], -.02)
        self.assertGreater(rear[1], .02)
        self.assertAlmostEqual(top[2], 1.291, places=6)
        self.assertAlmostEqual(front[2], .50, places=6)
        self.assertAlmostEqual(rear[2], .64, places=6)
        for row in range(161):
            for column in range(25):
                x, y, z = drape_point(row/160, column/24)
                self.assertGreaterEqual(x, .045)
                self.assertLess(x, .31)
                self.assertGreater(z, .48)
                self.assertLessEqual(z, 1.292)
                self.assertGreaterEqual(math.hypot(y, z-1.27), .02099)


if __name__ == '__main__':
    unittest.main()
