"""Keep bubble geometry readable and every historical atlas record intact."""
import hashlib
from pathlib import Path
import tomllib
import unittest

from PIL import Image

from activity_icons import ICONS, icon_image, render_icons


class ActivityIconTests(unittest.TestCase):
    def test_all_active_codes_have_distinct_high_density_art(self):
        self.assertEqual([row[0] for row in ICONS], [n for n in range(1, 24) if n != 6])
        sprites = render_icons()
        self.assertEqual(len({image.tobytes() for _, image, _, _ in sprites}), 22)
        for name, image, width, height in sprites:
            with self.subTest(icon=name):
                self.assertEqual((width, height), (52, 52))
                self.assertEqual(image.getchannel('A').getbbox(), (0, 0, 52, 52))
                # Every glyph uses the same circle and leaves its rim intact.
                reference = icon_image('wait')
                for x, y in ((26, 2), (2, 26), (49, 26), (26, 49)):
                    self.assertEqual(image.getpixel((x, y)), reference.getpixel((x, y)))

    def test_fish_ink_is_centered_and_separate_from_the_circle(self):
        image = icon_image('fish').convert('RGB')
        ink = []
        for y in range(8, 44):
            for x in range(8, 44):
                if (x - 26) ** 2 + (y - 26) ** 2 < 20 ** 2 and max(image.getpixel((x, y))) < 100:
                    ink.append((x, y))
        self.assertGreater(len(ink), 50)
        x0, x1 = min(x for x, _ in ink), max(x for x, _ in ink)
        self.assertLessEqual(abs((x0 + x1) / 2 - 26), 1.5)
        self.assertGreaterEqual(x0, 9)
        self.assertLessEqual(x1, 42)

    def test_new_icons_append_after_all_1370_historical_records(self):
        root = Path(__file__).resolve().parents[3]
        records = tomllib.loads((root / 'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([row['name'] for row in records[1370:]],
                         [row[0] for row in render_icons()])
        digest = hashlib.sha256()
        with Image.open(root / 'web/public/atlas.png') as atlas:
            for row in records[:1370]:
                digest.update(row['name'].encode() + b'\0')
                for key in ('w', 'h', 'pixel_density'):
                    digest.update(str(row.get(key, 1)).encode() + b'\0')
                digest.update(atlas.crop((row['x'], row['y'], row['x'] + row['w'],
                                         row['y'] + row['h'])).tobytes())
            for row in records[1370:]:
                self.assertEqual(row['pixel_density'], 2)
        self.assertEqual(digest.hexdigest(),
                         '23fd4d4740d65c1010e23820faceeef5b345d14a1fea3beac67e3f1f34f0d732')


if __name__ == '__main__':
    unittest.main()
