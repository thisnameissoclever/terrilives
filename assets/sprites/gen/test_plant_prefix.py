"""The plant appends after the coat rack without changing any published sprite."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image
from test_lamp_prefix import EXPECTED_METADATA, canonical_digest, preserved_table


class PlantPrefixTests(unittest.TestCase):
    def test_keeps_all_1354_published_records_and_pixels(self):
        root = Path(__file__).resolve().parents[3]
        rows = tomllib.loads((root/'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([row['name'] for row in rows[1354:1358]],
                         ['offlinePottedPlant'+turn for turn in ('', 'NW', 'SW', 'NE')])
        digest = hashlib.sha256()
        with Image.open(root/'web/public/atlas.png') as image:
            for row in rows[:1354]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop((row['x'], row['y'], row['x']+row['w'], row['y']+row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(), '41d3c356f636c14be614b99e713f334d54b9c0358a188e1f38ea7837890ba936')
        for row in rows[1354:1358]:
            self.assertEqual((row['w'], row['h'], row['pixel_density']), (192, 240, 2))

    def test_keeps_all_previous_registration_and_interaction_metadata(self):
        expected = {**EXPECTED_METADATA,
                    'SPRITE_ANCHORS': (944, '3a42abc58567efeebd6fc4fd2fa0e27bfde3e987756e03f9c9c4e55aa8a4dbd2'),
                    'SPRITE_CONTENT_BOUNDS': (507, 'bd910d7d43a6df85167a5fd7bb01850dafb5c2c54800d5d6de9890f25830dc45')}
        source = (Path(__file__).resolve().parents[3]/'web/src/render/atlas.ts').read_text()
        for name, (count, digest) in expected.items():
            with self.subTest(table=name):
                value = preserved_table(source, name, 1354)
                self.assertEqual(len(value), count)
                self.assertEqual(canonical_digest(value), digest)


if __name__ == '__main__':
    unittest.main()
