"""Occupied ottoman frames append without moving or repainting accepted sprites."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image
from test_lamp_prefix import EXPECTED_METADATA, canonical_digest, preserved_table

ROOT = Path(__file__).resolve().parents[3]
OTTOMAN_KEYS = {'1358', '1359', '1360', '1361'}


class OttomanSittingPrefixTests(unittest.TestCase):
    def test_preserves_1378_existing_records_and_decoded_pixels(self):
        rows = tomllib.loads((ROOT / 'assets/sprites/atlas.toml').read_text())['sprite']
        digest = hashlib.sha256()
        with Image.open(ROOT / 'web/public/atlas.png') as image:
            for row in rows[:1378]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop((row['x'], row['y'], row['x'] + row['w'], row['y'] + row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(), '057f7dc57ab4ea7a6848440c335d8aa817355da339320cafac0ef04b16a51b55')
        self.assertEqual(len(rows[1378:1450]), 72)
        self.assertTrue(all(row['name'].startswith('offlineOttoman') for row in rows[1378:1450]))

    def test_only_the_four_existing_ottoman_records_gain_profiles(self):
        source = (ROOT / 'web/src/render/atlas.ts').read_text()
        rows = tomllib.loads((ROOT / 'assets/sprites/atlas.toml').read_text())['sprite']
        profiles = preserved_table(source, 'INTERACTION_SPRITES', 1450)
        self.assertTrue(OTTOMAN_KEYS.issubset(profiles))
        for key, facing in zip(('1358', '1359', '1360', '1361'), ('SE', 'NW', 'SW', 'NE')):
            profile = profiles[key]
            self.assertEqual((profile['action'], profile['halfCycleTicks']), (8, 10))
            self.assertEqual(set(profile['frames']), {'green', 'blue', 'red'})
            for variant, frames in profile['frames'].items():
                self.assertEqual(len(frames), 4)
                self.assertTrue(all(1378 <= frame < 1450 for frame in frames))
                self.assertEqual([rows[frame]['name'] for frame in frames],
                                 [f'offlineOttoman{facing}{variant.title()}{i}' for i in range(4)])
        old = {key: value for key, value in profiles.items() if key not in OTTOMAN_KEYS}
        self.assertEqual((len(old), canonical_digest(old)), EXPECTED_METADATA['INTERACTION_SPRITES'])

    def test_existing_registration_and_other_interactions_are_unchanged(self):
        expected = {**EXPECTED_METADATA,
                    'SPRITE_ANCHORS': (968, '79fa3a5f8f136d7e74796b8b6a435106e577709adf92e9e613a134c1f739d4e6'),
                    'SPRITE_CONTENT_BOUNDS': (531, 'bb0f29443a8238f29d3222d8b772d2385e73027dc7f6fb3cbcf713430abc6603')}
        source = (ROOT / 'web/src/render/atlas.ts').read_text()
        for name, pair in expected.items():
            with self.subTest(table=name):
                value = preserved_table(source, name, 1378)
                if name == 'INTERACTION_SPRITES':
                    value = {key: item for key, item in value.items() if key not in OTTOMAN_KEYS}
                self.assertEqual((len(value), canonical_digest(value)), pair)


if __name__ == '__main__':
    unittest.main()
