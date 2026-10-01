"""The coat rack appends after the lamp without changing any published sprite."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image
from test_lamp_prefix import EXPECTED_METADATA, canonical_digest, preserved_table


class CoatRackPrefixTests(unittest.TestCase):
    def test_keeps_all_1350_published_records_and_pixels(self):
        root = Path(__file__).resolve().parents[3]
        rows = tomllib.loads((root/'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([row['name'] for row in rows[1350:1354]],
                         ['offlineCoatRack'+turn for turn in ('', 'NW', 'SW', 'NE')])
        digest = hashlib.sha256()
        with Image.open(root/'web/public/atlas.png') as image:
            for row in rows[:1350]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop((row['x'], row['y'], row['x']+row['w'], row['y']+row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(), '1009056971762c537c044fda941938285e8661d038650059866905e7d60c4bd8')
        for row in rows[1350:1354]:
            self.assertEqual((row['w'], row['h'], row['pixel_density']), (192, 240, 2))

    def test_keeps_all_previous_registration_and_interaction_metadata(self):
        expected = {**EXPECTED_METADATA,
                    'SPRITE_ANCHORS': (940, '3de1ef1282e849acdc91e5c9fd19b0fdb8b73dd8d7241e60a112719455287408'),
                    'SPRITE_CONTENT_BOUNDS': (503, '6a61146398ae2ebc2606186d64eb602600e86b49e5be303e3abebd1795c7b965')}
        source = (Path(__file__).resolve().parents[3]/'web/src/render/atlas.ts').read_text()
        for name, (count, digest) in expected.items():
            with self.subTest(table=name):
                value = preserved_table(source, name, 1350)
                self.assertEqual(len(value), count)
                self.assertEqual(canonical_digest(value), digest)


if __name__ == '__main__':
    unittest.main()
