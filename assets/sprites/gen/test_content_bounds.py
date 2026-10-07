"""Every sprite whose art starts below its canvas top must ship a box.

Picking and camera framing read SPRITE_CONTENT_BOUNDS and fall back to the
whole padded canvas when a sprite has none. The empty reading chair once
had none, so a click in the empty space above it selected the chair.
"""
import json
from pathlib import Path
import re
import tomllib
import unittest
import base64
import struct
from functools import lru_cache

from PIL import Image, ImageChops
from atlas_pixels import AtlasPages
from atlas_test_tables import table

from build import LEGACY_SIM_BODY, fill_padded_bounds, sim_body_indices

ROOT = Path(__file__).resolve().parents[3]


@lru_cache(maxsize=None)
def shipped_table(name):
    source = (ROOT / "web/src/render/atlas.ts").read_text()
    return table(source, name)


def coverage_alpha(record):
    left, top, right, bottom = record['box']
    raw = base64.b64decode(record['values'])
    if record.get('encoding') == 'float16':
        values = bytes(255 if value[0] > 0 else 0 for value in struct.iter_unpack('<e', raw))
    elif record.get('bitDepth') == 16:
        values = bytes(255 if value[0] > 0 else 0 for value in struct.iter_unpack('<H', raw))
    else:
        values = bytes(255 if value else 0 for value in raw)
    if len(values) != (right-left)*(bottom-top):
        raise ValueError('Registered scene coverage dimensions differ')
    result = Image.new('L', tuple(record['size']))
    result.paste(Image.frombytes('L', (right-left, bottom-top), values), (left, top))
    return result


def non_target_textures():
    textures = set()
    for name in ('BED_LAYERS', 'SEATING_LAYERS', 'BATHROOM_LAYERS', 'SHARED_SEAT_LAYERS'):
        textures.update(index for layers in shipped_table(name).values() for index in layers if index >= 0)
    for profile in shipped_table('SHELF_PROFILES').values():
        textures.add(profile['base'])
        textures.update(index for pair in profile['rows'] for index in pair if index >= 0)
    textures.update(index for rows in shipped_table('BOOK_REACH_SHELVES')['tables']
                    for pair in rows for index in pair if index >= 0)
    return textures - {int(index) for index in shipped_table('JOINT_SCENE_ALPHA_IDS')}


def registered_scenes():
    result = {}
    def visit(value):
        if isinstance(value, dict):
            if isinstance(value.get('sprite'), int) and 'owners' in value:
                result[value['sprite']] = value
            for item in value.values():
                visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
    for name in ('BED_CATALOG', 'SEATING_SPRITES', 'BATHROOM_SPRITES',
                 'SHARED_SEAT_CATALOG', 'SHARED_SEAT_PREVIEW_CATALOG',
                 'READING_BODY_CATALOG', 'SOFA_RECLINE_CATALOG', 'BOOK_REACH_CATALOG'):
        visit(shipped_table(name))
    return result


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
        textures = non_target_textures()
        padded, missing = [], []
        with AtlasPages(ROOT) as atlas:
            for index, row in enumerate(records):
                crop = atlas.crop(row)
                art = crop.getchannel("A").getbbox()
                if art is None or art[1] == 0 or index in sim_bodies or index in textures:
                    continue
                padded.append(row["name"])
                if index not in bounds:
                    missing.append(row["name"])
        # The reading chair is the recorded instance; an empty scan proves nothing.
        self.assertIn("offlineChair", padded)
        self.assertEqual(missing, [])

    def test_every_shipped_box_starts_at_its_sprite_s_art_top(self):
        # Holds for both kinds of record: a generated box is cut to the art
        # top, and an imported one is the art's own box. Nothing else pins the
        # values of the 29 generated boxes appended after the kitchen digest.
        records = tomllib.loads((ROOT / "assets/sprites/atlas.toml").read_text())["sprite"]
        bounds = {int(index): box for index, box in shipped_table("SPRITE_CONTENT_BOUNDS").items()}
        self.assertGreater(len(bounds), 300)
        bed_layers = {int(index): layers for index, layers in shipped_table("BED_LAYERS").items()}
        seating_layers = {int(index): layers for index, layers in shipped_table("SEATING_LAYERS").items()}
        self.assertEqual(len(seating_layers), 5 * 4 * 3 * 4)
        bathroom_layers = {int(index): layers for index, layers in shipped_table("BATHROOM_LAYERS").items()}
        self.assertEqual(len(bathroom_layers), 4 * 3 * 4 + 4 * 4)
        shared_layers = {int(index): layers for index, layers in shipped_table('SHARED_SEAT_LAYERS').items()}
        visible_layers = {**bed_layers, **seating_layers, **bathroom_layers, **shared_layers}
        joint = {int(index): coverage for index, coverage in shipped_table('JOINT_SCENE_ALPHA_IDS').items()}
        coverages = shipped_table('BED_COVERAGE')
        shelves = {int(index): coverage for index, coverage in shipped_table('SHELF_COVERAGE').items()}
        scenes = registered_scenes()
        self.assertEqual(set(joint) - set(scenes), set())
        pair_coverage = {int(index) for index in shipped_table("SPRITE_PAIR_COVERAGE")}
        pairs = {int(index): layers for index, layers in shipped_table("SPRITE_PAIRS").items()}
        trims = {int(index): offset for index, offset in shipped_table("BED_LAYER_TRIMS").items()}
        wrong = []
        with AtlasPages(ROOT) as atlas:
            for index, box in bounds.items():
                row = records[index]
                density = row.get("pixel_density", 1)
                crop = atlas.crop(row)
                if index in visible_layers or index in pair_coverage:
                    # A scene alias reuses furniture texels but draws all visible layers.
                    # Independently union their alpha support rather than inspecting only furniture.
                    alpha = Image.new("L", crop.size)
                    layers = visible_layers[index] if index in visible_layers else [index, *pairs[index].values()]
                    for layer in layers:
                        if layer < 0:
                            continue
                        term = records[layer]
                        pixels = atlas.crop(term)
                        contribution = Image.new('L', alpha.size)
                        offset = [round(value*term.get('pixel_density', 1)) for value in trims.get(layer, (0, 0))]
                        contribution.paste(pixels.getchannel('A'), tuple(offset))
                        alpha = ImageChops.lighter(alpha, contribution)
                    crop.putalpha(alpha)
                art = crop.getchannel("A").getbbox()
                # Imported joint scenes retain one neutral filtering texel around
                # their trimmed visible layers; ordinary sprites use the art top.
                expected_top = max(0, art[1]-1) / density if art and index in joint else (art[1] / density if art else None)
                if art is None or box[1] != expected_top:
                    wrong.append(row["name"])
                if index in joint or index in shelves:
                    records_to_check = [coverages[joint[index]]] if index in joint else [shelves[index]]
                    if index in joint:
                        self.assertEqual(scenes[index]['alpha'], joint[index])
                        records_to_check += [coverages[owner['coverage']] for owner in scenes[index]['owners'] if owner]
                    for record in records_to_check:
                        support = coverage_alpha(record).getbbox()
                        if support and not (box[0] <= support[0]/density and box[1] <= support[1]/density
                                            and box[2] >= support[2]/density and box[3] >= support[3]/density):
                            wrong.append(row['name'] + ' registered coverage')
                if not 0 <= box[0] < box[2] <= row["w"] / density:
                    wrong.append(row["name"] + " sides")
                if not 0 <= box[1] < box[3] <= row["h"] / density:
                    wrong.append(row["name"] + " height")
        self.assertEqual(wrong, [])

    def test_sim_bodies_keep_their_whole_canvas_as_the_click_target(self):
        records = tomllib.loads((ROOT / "assets/sprites/atlas.toml").read_text())["sprite"]
        bounds = {int(index) for index in shipped_table("SPRITE_CONTENT_BOUNDS")}
        sim_bodies = shipped_sim_bodies(records)
        # Preserve the existing figures, dining poses and 336 cleaning samples.
        self.assertEqual(len(sim_bodies), 975 + 336 + 336)
        self.assertEqual(sorted(sim_bodies & bounds), [])


class FillPaddedBoundsTests(unittest.TestCase):
    def test_the_band_above_the_art_is_cut_in_logical_units(self):
        sprites = [sprite("padded", (8, 10), (2, 4, 6, 10))]
        bounds = {}
        fill_padded_bounds(sprites, {0: 2}, bounds)
        self.assertEqual(bounds, {0: [0.0, 2.0, 4.0, 5.0]})

    def test_the_sides_and_the_base_stay_on_the_canvas(self):
        # A sprite draws nothing on the south half of its own tile, and that
        # half is inside its canvas. Trimming there would remove it from the
        # object's click target.
        sprites = [sprite("trashcan", (16, 52), (1, 6, 15, 31))]
        bounds = {}
        fill_padded_bounds(sprites, {}, bounds)
        self.assertEqual(bounds, {0: [0, 6, 16, 52]})

    def test_tightly_cropped_and_empty_sprites_get_none(self):
        sprites = [sprite("tight", (6, 6), (0, 0, 6, 6)), sprite("blank", (6, 6))]
        bounds = {}
        fill_padded_bounds(sprites, {}, bounds)
        self.assertEqual(bounds, {})

    def test_side_padding_alone_is_left_alone(self):
        sprites = [sprite("narrow", (10, 6), (3, 0, 7, 6))]
        bounds = {}
        fill_padded_bounds(sprites, {}, bounds)
        self.assertEqual(bounds, {})

    def test_sim_bodies_are_left_whole(self):
        sprites = [sprite("sim", (8, 10), (2, 4, 6, 10)), sprite("chair", (8, 10), (2, 4, 6, 10))]
        bounds = {}
        fill_padded_bounds(sprites, {}, bounds, whole_canvas={0})
        self.assertEqual(bounds, {1: [0, 4, 8, 10]})

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
