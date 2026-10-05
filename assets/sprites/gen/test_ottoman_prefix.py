"""The ottoman appends after the plant without changing any published sprite."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image
from atlas_pixels import AtlasPages
from test_lamp_prefix import EXPECTED_METADATA, canonical_digest, preserved_table


class OttomanPrefixTests(unittest.TestCase):
    def test_keeps_all_1358_published_records_and_pixels(self):
        root = Path(__file__).resolve().parents[3]
        rows = tomllib.loads((root/'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([row['name'] for row in rows[1358:1362]],
                         ['offlineOttoman'+turn for turn in ('', 'NW', 'SW', 'NE')])
        digest = hashlib.sha256()
        with AtlasPages(root) as image:
            for row in rows[:1358]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop(row).tobytes())
        self.assertEqual(digest.hexdigest(), '1a19f4ce3516bdd7e19216565865c9e34a4c34aea3072740beb8e581862ac573')
        for row in rows[1358:1362]:
            self.assertEqual((row['w'], row['h'], row['pixel_density']), (192, 240, 2))

    def test_keeps_all_previous_registration_and_interaction_metadata(self):
        expected = {**EXPECTED_METADATA,
                    'SPRITE_ANCHORS': (948, '9af1a7e87171bbf5d2ec3aec53d1791e8f5d0034efcdb45261f624247ccb0878'),
                    'SPRITE_CONTENT_BOUNDS': (511, 'bc46fde134f0917b5c9a94dffdb2da1921eeb75ff6515c33321174729f2fea14')}
        source = (Path(__file__).resolve().parents[3]/'web/src/render/atlas.ts').read_text()
        for name, (count, digest) in expected.items():
            with self.subTest(table=name):
                value = preserved_table(source, name, 1358)
                self.assertEqual(len(value), count)
                self.assertEqual(canonical_digest(value), digest)


if __name__ == '__main__':
    unittest.main()
