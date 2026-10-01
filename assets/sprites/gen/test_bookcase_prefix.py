"""The bookcase appends after the trash can without changing any published sprite."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image
from test_lamp_prefix import EXPECTED_METADATA, canonical_digest, preserved_table


class BookcasePrefixTests(unittest.TestCase):
    def test_keeps_all_1366_published_records_and_pixels(self):
        root = Path(__file__).resolve().parents[3]
        rows = tomllib.loads((root/'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([row['name'] for row in rows[1366:1370]],
                         ['offlineBookcase'+turn for turn in ('', 'NW', 'SW', 'NE')])
        digest = hashlib.sha256()
        with Image.open(root/'web/public/atlas.png') as image:
            for row in rows[:1366]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop((row['x'], row['y'], row['x']+row['w'], row['y']+row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(), '2a6bf2ccd83cb1236e365f7ed3fee82e4fedf427a858ab362fa40ec948c527cd')
        for row in rows[1366:1370]:
            self.assertEqual((row['w'], row['h'], row['pixel_density']), (192, 240, 2))

    def test_keeps_all_previous_registration_and_interaction_metadata(self):
        expected = {**EXPECTED_METADATA,
                    'SPRITE_ANCHORS': (956, '79cbad4e81917b1c8939b2a35329c31104747c2321b031cbc2af625111cd0fde'),
                    'SPRITE_CONTENT_BOUNDS': (519, 'e01fc705a3e9123abce7bdae3b4d7d8e1a0bf7ac46939de86a0d3ed56b0520db')}
        source = (Path(__file__).resolve().parents[3]/'web/src/render/atlas.ts').read_text()
        for name, (count, digest) in expected.items():
            with self.subTest(table=name):
                value = preserved_table(source, name, 1366)
                self.assertEqual(len(value), count)
                self.assertEqual(canonical_digest(value), digest)


if __name__ == '__main__':
    unittest.main()
