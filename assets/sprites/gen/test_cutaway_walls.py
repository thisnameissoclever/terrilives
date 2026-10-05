import unittest
import hashlib
import json
import tomllib
from pathlib import Path
from PIL import Image
from atlas_pixels import AtlasPages
from build import render_sprites
from cutaway_walls import SPRITES, HEIGHT, EXACT
from iso import canvas, OX, OY, Z_UNIT


class CutawayWallTests(unittest.TestCase):
    def test_all_masks_and_passages_have_short_art(self):
        records = render_sprites(SPRITES, exact=EXACT)
        self.assertEqual([r[0] for r in records],
                         [f"wallLow{m}" for m in range(1, 16)] +
                         ["doorwayLowNS", "doorwayLowEW"])
        for _, image, _, height in records:
            self.assertLessEqual(height, 59)
            self.assertIsNotNone(image.getbbox())
            self.assertEqual(image.width, 32)
        self.assertAlmostEqual(HEIGHT, 2 / 3)

    def test_doorways_have_no_lintel_or_blocked_passage(self):
        for draw in SPRITES[-2:]:
            image, pen = canvas()
            draw(pen)
            self.assertEqual(image.getpixel((OX, OY - 5))[3], 0)
            self.assertEqual(image.getpixel((OX, int(OY - Z_UNIT * HEIGHT)))[3], 0)

    def test_previous_1229_records_and_decoded_pixels_are_unchanged(self):
        root = Path(__file__).resolve().parents[3]
        rows = tomllib.loads((root / 'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([r['name'] for r in rows[1229:1246]], [draw.__name__ for draw in SPRITES])
        digest = hashlib.sha256()
        with AtlasPages(root) as image:
            for row in rows[:1229]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop(row).tobytes())
        self.assertEqual(digest.hexdigest(), '7a53e9b9a1dcdb1a9830ced83a1b8e2a46296460a9c33af17e9b62a392893613')


if __name__ == '__main__':
    unittest.main()
