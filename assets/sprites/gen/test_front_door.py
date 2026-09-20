"""The career portal stays registered while its leaf visibly swings."""
from pathlib import Path
import sys
import unittest

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build
import front_door
from iso import HW, HH, Z_UNIT


class FrontDoorTests(unittest.TestCase):
    def setUp(self):
        self.records = build.render_sprites(
            front_door.SPRITES,
            exact=front_door.EXACT,
        )
        self.by_name = {
            name: (image, width, height)
            for name, image, width, height in self.records
        }

    def test_portal_records_have_one_registered_envelope(self):
        self.assertEqual(
            [record[0] for record in self.records],
            [
                "frontDoorFrameSELeft",
                "frontDoorClosedSELeft",
                "frontDoorAjarSELeft",
                "frontDoorOpenSELeft",
            ],
        )
        for name, image, width, height in self.records:
            self.assertEqual((width, height), front_door.ENVELOPE, name)
            self.assertIsNotNone(image.getchannel("A").getbbox(), name)

    def test_leaf_states_keep_the_hinge_planted_and_change_silhouette(self):
        leaf_names = [
            "frontDoorClosedSELeft",
            "frontDoorAjarSELeft",
            "frontDoorOpenSELeft",
        ]
        leaf_images = [self.by_name[name][0] for name in leaf_names]
        self.assertEqual(len({image.tobytes() for image in leaf_images}), 3)

        width, height = front_door.ENVELOPE
        hinge_x, hinge_y = front_door.HINGE

        def registered_point(z):
            x = round(width / 2 + (hinge_x - hinge_y) * HW)
            y = round(
                height - HH - 1
                + (hinge_x + hinge_y) * HH
                - z * Z_UNIT
            )
            return x, y

        for image in leaf_images:
            for z in (front_door.LEAF_BOTTOM, 0.9, front_door.LEAF_TOP):
                x, y = registered_point(z)
                alpha = image.getchannel("A").crop((x - 2, y - 2, x + 3, y + 3))
                self.assertIsNotNone(alpha.getbbox(), f"hinge detached at z={z}")

        silhouettes = [image.getchannel("A").getbbox() for image in leaf_images]
        self.assertEqual(len(set(silhouettes)), 3)
        open_x, open_y = front_door.LEAF_EDGES["open"]
        ajar_x, ajar_y = front_door.LEAF_EDGES["ajar"]
        self.assertLess(open_x, hinge_x)
        self.assertEqual(open_y, hinge_y)
        self.assertLess(ajar_x, hinge_x)
        self.assertGreater(ajar_y, hinge_y)

    def test_append_keeps_the_existing_catalog_in_place(self):
        existing = Image.new("RGBA", (1, 1), (1, 2, 3, 255))
        records = [("existing", existing, 1, 1)]
        original = records[0]

        start = build.append_front_door_sprites(records)

        self.assertEqual(start, 1)
        self.assertIs(records[0], original)
        self.assertEqual(
            [record[0] for record in records[1:]],
            [sprite.__name__ for sprite in front_door.SPRITES],
        )


if __name__ == "__main__":
    unittest.main()
