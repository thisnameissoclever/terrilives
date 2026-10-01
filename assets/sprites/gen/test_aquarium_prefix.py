"""New fish frames preserve the complete published atlas and registration."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image
from test_lamp_prefix import EXPECTED_METADATA, canonical_digest, preserved_table


class AquariumPrefixTests(unittest.TestCase):
    def test_preserves_1370_published_records_and_decoded_pixels(self):
        root = Path(__file__).resolve().parents[3]
        rows = tomllib.loads((root/'assets/sprites/atlas.toml').read_text())['sprite']
        names = [prefix+suffix for prefix in ('offlineAquarium', 'offlineAquariumFrame1')
                 for suffix in ('', 'NW', 'SW', 'NE')]
        self.assertEqual([row['name'] for row in rows[1370:1378]], names)
        digest = hashlib.sha256()
        with Image.open(root/'web/public/atlas.png') as image:
            for row in rows[:1370]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop((row['x'], row['y'], row['x']+row['w'], row['y']+row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(), '0223784572d8960d192c90125bb1d3cd0dd49d7904c88c2f49084c51007eeddf')

    def test_preserves_all_prior_registration_and_interaction_tables(self):
        expected = {**EXPECTED_METADATA,
                    'SPRITE_ANCHORS': (960, '3bca7a47549c0773f4e000adc84229477d8ef3db879f83556fe467da89da70e7'),
                    'SPRITE_CONTENT_BOUNDS': (523, '65c97c99728f3bfa067dd7e938b33f5d0a20be15205b2a6156a5c854abfb0bdf')}
        source = (Path(__file__).resolve().parents[3]/'web/src/render/atlas.ts').read_text()
        for name, (count, digest) in expected.items():
            with self.subTest(table=name):
                value = preserved_table(source, name, 1370)
                if name == 'INTERACTION_SPRITES':
                    # The later sitting batch adds only these four formerly static targets.
                    value = {key: item for key, item in value.items() if key not in {'1358', '1359', '1360', '1361'}}
                self.assertEqual(len(value), count)
                self.assertEqual(canonical_digest(value), digest)


if __name__ == '__main__':
    unittest.main()
