"""Kitchen appends must preserve all decoded art already shipped on main."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]


class KitchenPrefixTests(unittest.TestCase):
    def test_preserves_prior_records_and_decoded_pixels_including_the_fridge(self):
        records = tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())['sprite']
        for count, expected in (
            (1089,'23f80e402b082a50b8b9df64e10da8f765f81f578ffee7487b05ec4c47d20582'),
            (1093,'69d92462b8465ee6385619c88fc6c34acd94bd80fdd2558dc3ed6c2f606994e1'),
            (1097,'89e29612c0661ef22999dcc80fcfe55f68e9bbf174561252b3b41225c2faea12'),
        ):
            with self.subTest(count=count), Image.open(ROOT/'web/public/atlas.png') as image:
                rows = records[:count]
                self.assertEqual(len(rows),count)
                digest = hashlib.sha256()
                for row in rows:
                    metadata = [row['name'],row['w'],row['h'],row.get('pixel_density',1)]
                    digest.update(json.dumps(metadata,separators=(',',':')).encode())
                    digest.update(image.crop((row['x'],row['y'],row['x']+row['w'],row['y']+row['h'])).tobytes())
                self.assertEqual(digest.hexdigest(),expected)


if __name__ == '__main__':
    unittest.main()
