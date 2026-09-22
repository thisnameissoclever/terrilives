"""Every sprite with transparent padding must ship its visible-art box.

Picking and camera framing read SPRITE_CONTENT_BOUNDS and fall back to the
whole padded canvas when a sprite has none. The empty reading chair once
had none, so a click in the empty space above it selected the chair.
"""
import json
from pathlib import Path
import re
import tomllib
import unittest

from PIL import Image

from build import LEGACY_SIM_BODY, fill_padded_bounds, sim_body_indices

ROOT = Path(__file__).resolve().parents[3]


def shipped_table(name):
    source = (ROOT / "web/src/render/atlas.ts").read_text()
    match = re.search(name + r"[^=]*= (\{.*?\n\});", source, re.S)
    if match is None:
        raise ValueError(f"atlas.ts has no {name} table")
    return json.loads(match.group(1))


def shipped_sim_bodies(records):
    # Read from the shipped runtime table and names, not the generator under test.
    variants = shipped_table("RIGGED_SIM_VARIANTS")
    rigged = {index for clips in variants.values() for clip in clips.values()
              for facing in clip["frames"] for index in facing}
    legacy = {index for index, row in enumerate(records)
              if re.match(r"sim[23]?(?=[A-Z]|$)", row["name"])}
    return rigged | legacy


def sprite(name, size, box=None):
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    if box is not None:
        image.paste((200, 100, 50, 255), box)
    return (name, image, *size)


class ShippedAtlasTests(unittest.TestCase):
    def test_every_sprite_whose_art_misses_the_canvas_top_has_bounds(self):
        records = tomllib.loads((ROOT / "assets/sprites/atlas.toml").read_text())["sprite"]
        bounds = {int(index): box for index, box in shipped_table("SPRITE_CONTENT_BOUNDS").items()}
        sim_bodies = shipped_sim_bodies(records)
        padded, missing = [], []
        with Image.open(ROOT / "web/public/atlas.png") as atlas:
            for index, row in enumerate(records):
                crop = atlas.crop((row["x"], row["y"], row["x"] + row["w"], row["y"] + row["h"]))
                art = crop.getchannel("A").getbbox()
                if art is None or art[1] == 0 or index in sim_bodies:
                    continue
                padded.append(row["name"])
                if index not in bounds:
                    missing.append(row["name"])
        # The reading chair is the recorded instance; an empty scan proves nothing.
        self.assertIn("offlineChair", padded)
        self.assertEqual(missing, [])

    def test_sim_bodies_keep_their_whole_canvas_as_the_click_target(self):
        records = tomllib.loads((ROOT / "assets/sprites/atlas.toml").read_text())["sprite"]
        bounds = {int(index) for index in shipped_table("SPRITE_CONTENT_BOUNDS")}
        sim_bodies = shipped_sim_bodies(records)
        # 219 legacy figures plus 156 rigged samples in each of three palettes.
        self.assertEqual(len(sim_bodies), 687)
        self.assertEqual(sorted(sim_bodies & bounds), [])


class FillPaddedBoundsTests(unittest.TestCase):
    def test_padded_sprite_gets_its_logical_art_box(self):
        sprites = [sprite("padded", (8, 10), (2, 4, 6, 10))]
        bounds = {}
        fill_padded_bounds(sprites, {0: 2}, bounds)
        self.assertEqual(bounds, {0: [1.0, 2.0, 3.0, 5.0]})

    def test_tightly_cropped_and_empty_sprites_get_none(self):
        sprites = [sprite("tight", (6, 6), (0, 0, 6, 6)), sprite("blank", (6, 6))]
        bounds = {}
        fill_padded_bounds(sprites, {}, bounds)
        self.assertEqual(bounds, {})

    def test_side_padding_alone_still_counts(self):
        sprites = [sprite("narrow", (10, 6), (3, 0, 7, 6))]
        bounds = {}
        fill_padded_bounds(sprites, {}, bounds)
        self.assertEqual(bounds, {0: [3, 0, 7, 6]})

    def test_sim_bodies_are_left_whole(self):
        sprites = [sprite("sim", (8, 10), (2, 4, 6, 10)), sprite("chair", (8, 10), (2, 4, 6, 10))]
        bounds = {}
        fill_padded_bounds(sprites, {}, bounds, whole_canvas={0})
        self.assertEqual(bounds, {1: [2, 4, 6, 10]})

    def test_recorded_bounds_are_kept(self):
        # Occupied bodies deliberately exclude the furniture silhouette.
        sprites = [sprite("body", (8, 8), (0, 2, 8, 8))]
        bounds = {0: [1, 3, 5, 7]}
        fill_padded_bounds(sprites, {}, bounds)
        self.assertEqual(bounds, {0: [1, 3, 5, 7]})


class SimBodyIndicesTests(unittest.TestCase):
    def test_legacy_figures_and_every_rigged_sample(self):
        names = ["floor", "sim", "sim2TalkSE0", "simulator", "rigSimIdleSE0", "offlineChair"]
        sprites = [sprite(name, (2, 2)) for name in names]
        variants = {"green": {"idle": {"frames": [[4]]}}}
        self.assertEqual(sim_body_indices(sprites, 4, variants), {1, 2, 4})
        self.assertIsNone(LEGACY_SIM_BODY.match("simulator"))


if __name__ == "__main__":
    unittest.main()
