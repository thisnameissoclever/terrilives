"""The trash can appends after the ottoman without changing any published sprite."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image
from atlas_pixels import AtlasPages
from test_lamp_prefix import EXPECTED_METADATA, canonical_digest, preserved_table


class TrashcanPrefixTests(unittest.TestCase):
    def test_keeps_all_1362_published_records_and_pixels(self):
        root = Path(__file__).resolve().parents[3]
        rows = tomllib.loads((root/'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([row['name'] for row in rows[1362:1366]],
                         ['offlineTrashcan'+turn for turn in ('', 'NW', 'SW', 'NE')])
        digest = hashlib.sha256()
        with AtlasPages(root) as image:
            for row in rows[:1362]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop(row).tobytes())
        self.assertEqual(digest.hexdigest(), '29e2939094325705caceda38e912a45f989f16d1f13ae3e89b1abab74b30adca')
        for row in rows[1362:1366]:
            self.assertEqual((row['w'], row['h'], row['pixel_density']), (192, 240, 2))

    def test_keeps_all_previous_registration_and_interaction_metadata(self):
        expected = {**EXPECTED_METADATA,
                    'SPRITE_ANCHORS': (952, '66e2819c054d5c364b1a9c6384fb54448ee44b18cc567eb973be6a749d27cc96'),
                    'SPRITE_CONTENT_BOUNDS': (515, '4f216244559869d38a1bdbff18a587aebb195b83508d2b7066cf3e8595530f19')}
        source = (Path(__file__).resolve().parents[3]/'web/src/render/atlas.ts').read_text()
        for name, (count, digest) in expected.items():
            with self.subTest(table=name):
                value = preserved_table(source, name, 1362)
                self.assertEqual(len(value), count)
                self.assertEqual(canonical_digest(value), digest)


if __name__ == '__main__':
    unittest.main()
