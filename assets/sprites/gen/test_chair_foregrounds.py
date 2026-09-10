"""Chair overlays retain the source art and only restore visible near surfaces."""

import hashlib
from pathlib import Path
import unittest

from PIL import Image, ImageDraw

import objects
from iso import canvas, emit
from offline_sims import FACINGS, load_export


BASELINES = {
    "loungeChair": ((50, 70), "6bf2ed59dafd7d307583a682634ff3393a7281ad11e6e62624e9f9b3ea41f82e"),
    "loungeChairSW": ((50, 60), "856c4c5b2c4cc5dd23389b33478be82124968e50a80a152b6a7ffc5ac9894552"),
    "loungeChairNW": ((50, 60), "a0c7f8ace1a5b271a2c1413171319c817d9554843821171161e2721b67477916"),
    "loungeChairNE": ((50, 70), "618f039606202ffa92a8ea9b462eee5e1d2238c20f7a7e1d2f73e68d4b45a4f0"),
    "loungeChairRelax": ((54, 81), "bfa30f51558fa42b0e632cf7de880e13ece38b324d62b7070ebc318b04a5670d"),
    "loungeChairRelaxSW": ((54, 81), "dd251c53ab8848390629fd568d18bc8a0d4e8ecc3aa2ed828214f513a97cefaa"),
    "loungeChairRelaxNW": ((54, 70), "7df5dee0d7657f2258bc04a410f3810e19b90e77be3b0dbdc622248937ae95b8"),
    "loungeChairRelaxNE": ((54, 70), "501ed273c4874c26bd0844c66026879a8177b472617315ecb82c94cac0334216"),
}


def render(name):
    drawers = {drawer.__name__: drawer for drawer in objects.SPRITES}
    image, draw = canvas()
    drawers[name](draw)
    return emit(image, *objects.EXACT.get(name, (None, None)))[0]


def contact_composite(export, base, facing, foreground, frame=0):
    """Use the authored chair opening and the game's pixel anchors."""
    body_facing = ({"SE": "SW", "SW": "NW", "NW": "NE", "NE": "SE"}[facing]
                   if base == "loungeChair" else facing)
    suffix = "" if facing == "SE" else facing
    chair = render(base + suffix)
    frames = {name: image for name, image, _, _ in export.sprites}
    sim = frames[f"rigSimRead{body_facing}{frame}"]
    anchor = export.clips["read"]["anchor"]
    image = Image.new("RGBA", (144, 150), (237, 232, 221, 255))
    position = (72 - chair.width // 2, 129 - chair.height)
    image.alpha_composite(chair, position)
    image.alpha_composite(sim, (round(72 - anchor[0]), round(129 - anchor[1])))
    if foreground:
        image.alpha_composite(render(base + "Foreground" + suffix), position)
    return image, body_facing


def load_reading_export():
    root = Path(__file__).resolve().parents[3]
    return load_export(root / "assets/models/sims/sim-01/export/manifest.json",
                       required_clips={"read"})


def write_contact_review(output):
    """Rebuild the before/after sheet without touching the production atlas."""
    export = load_reading_export()
    board = Image.new("RGBA", (4 * 144, 4 * 150), (237, 232, 221, 255))
    labels = ImageDraw.Draw(board)
    for chair_row, base in enumerate(("loungeChairRelax", "loungeChair")):
        for phase in (0, 1):
            row = chair_row * 2 + phase
            for column, facing in enumerate(FACINGS):
                composite, body_facing = contact_composite(export, base, facing, phase)
                board.alpha_composite(composite, (column * 144, row * 150))
                labels.text((column * 144 + 5, row * 150 + 4),
                            f"{base} {facing}", fill=(35, 32, 27))
                label = f"{'AFTER' if phase else 'BEFORE'} body {body_facing}"
                labels.text((column * 144 + 5, row * 150 + 17), label, fill=(35, 32, 27))
    board.convert("RGB").resize((board.width * 3, board.height * 3),
                                Image.Resampling.NEAREST).save(output)


class ChairForegroundTests(unittest.TestCase):
    def test_base_chair_pixels_are_unchanged(self):
        for name, (size, digest) in BASELINES.items():
            with self.subTest(name=name):
                image = render(name)
                self.assertEqual(image.size, size)
                self.assertEqual(hashlib.sha256(image.tobytes()).hexdigest(), digest)

    def test_foregrounds_append_without_moving_existing_indices(self):
        self.assertEqual([drawer.__name__ for drawer in objects.SPRITES[360:]], [
            "loungeChairForeground", "loungeChairForegroundSW",
            "loungeChairForegroundNW", "loungeChairForegroundNE",
            "loungeChairRelaxForeground", "loungeChairRelaxForegroundSW",
            "loungeChairRelaxForegroundNW", "loungeChairRelaxForegroundNE",
        ])

    def test_foreground_is_an_aligned_nonempty_subset_of_base_pixels(self):
        names = {drawer.__name__ for drawer in objects.SPRITES}
        for base in ("loungeChair", "loungeChairRelax"):
            for suffix in ("", "SW", "NW", "NE"):
                foreground_name = base + "Foreground" + suffix
                with self.subTest(name=foreground_name):
                    self.assertIn(foreground_name, names)
                    chair, foreground = render(base + suffix), render(foreground_name)
                    self.assertEqual(foreground.size, chair.size)
                    self.assertIsNotNone(foreground.getbbox())
                    self.assertLess(sum(a > 0 for a in foreground.getchannel("A").tobytes()),
                                    sum(a > 0 for a in chair.getchannel("A").tobytes()))
                    for y in range(chair.height):
                        for x in range(chair.width):
                            actual = foreground.getpixel((x, y))
                            if actual[3]:
                                self.assertEqual(actual, chair.getpixel((x, y)))

    def test_near_rims_cover_rear_facing_hips_without_hiding_the_head(self):
        export = load_reading_export()
        # Native contact pixels inspected on the registered before/after sheet.
        probes = (("loungeChair", "SW", (61, 96)),
                  ("loungeChair", "NW", (83, 100)),
                  ("loungeChairRelax", "NW", (63, 97)),
                  ("loungeChairRelax", "NE", (77, 97)))
        for base, facing, point in probes:
            with self.subTest(chair=base, facing=facing):
                before, _ = contact_composite(export, base, facing, False)
                after, _ = contact_composite(export, base, facing, True)
                chair = render(base + facing)
                source_point = (point[0] - 72 + chair.width // 2,
                                point[1] - 129 + chair.height)
                self.assertNotEqual(before.getpixel(point), after.getpixel(point))
                self.assertEqual(after.getpixel(point), chair.getpixel(source_point))
                self.assertEqual(before.crop((40, 35, 105, 65)).tobytes(),
                                 after.crop((40, 35, 105, 65)).tobytes())


if __name__ == "__main__":
    unittest.main()
