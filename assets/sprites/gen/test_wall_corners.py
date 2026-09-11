"""Corner folds stay visible without altering the wall silhouette or straight runs."""

import unittest
from unittest.mock import patch

from PIL import ImageChops

import objects
from iso import canvas, OX, OY


def render(drawer):
    image, draw = canvas()
    drawer(draw)
    return image


class WallCornerTests(unittest.TestCase):
    def assert_crease(self, shaded, plain, column, bounds):
        # An opaque fill outside the old outline would create a spike or post.
        self.assertEqual(shaded.getchannel("A").tobytes(), plain.getchannel("A").tobytes())
        before = plain.getpixel((column, OY - 40))
        after = shaded.getpixel((column, OY - 40))
        self.assertEqual(after[3], 255)
        self.assertGreaterEqual(before[0] - after[0], 25)
        difference = ImageChops.difference(shaded.convert("RGB"), plain.convert("RGB"))
        changed = difference.getbbox()
        self.assertIsNotNone(changed)
        self.assertGreaterEqual(changed[0], bounds[0])
        self.assertLessEqual(changed[2], bounds[1])

    def test_visible_corners_have_a_narrow_fold_with_the_same_silhouette(self):
        for drawer in objects.WALL_JOIN_SPRITES:
            if drawer.__name__ in ("wallJoin11", "wallJoin13"):
                continue
            with self.subTest(junction=drawer.__name__):
                with patch.object(objects, "_wall_crease"):
                    plain = render(drawer)
                bounds = (OX - 2, OX + 1) if drawer.__name__ == "wallJoin12" else (OX, OX + 3)
                self.assert_crease(render(drawer), plain, OX, bounds)

    def test_rear_branches_leave_the_visible_through_wall_unmarked(self):
        # North behind an east-west run, and west behind a north-south run.
        # Both visible faces are continuous planes despite having three arms.
        for mask in (11, 13):
            with self.subTest(connections=mask):
                drawer = objects._joined_wall(mask)
                with patch.object(objects, "_wall_crease"):
                    plain = render(drawer)
                self.assertEqual(render(drawer).tobytes(), plain.tobytes())

    def test_boundary_folds_shade_only_the_connecting_end_of_each_panel(self):
        for drawer, straight, column, bounds in (
            (objects.wallCornerStartNS, objects.wallNS, OX + 15, (OX + 13, OX + 16)),
            (objects.wallCornerStartEW, objects.wallEW, OX - 16, (OX - 16, OX - 13)),
        ):
            with self.subTest(panel=drawer.__name__):
                self.assert_crease(render(drawer), render(straight), column, bounds)


if __name__ == "__main__":
    unittest.main()
