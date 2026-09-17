"""Kitchen appends must preserve all decoded art already shipped on main."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]


class KitchenPrefixTests(unittest.TestCase):
    def test_preserves_all_1089_prior_records_and_decoded_pixels(self):
        rows = tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())['sprite'][:1089]
        self.assertEqual(len(rows),1089)
        digest = hashlib.sha256()
        with Image.open(ROOT/'web/public/atlas.png') as image:
            for row in rows:
                metadata = [row['name'],row['w'],row['h'],row.get('pixel_density',1)]
                digest.update(json.dumps(metadata,separators=(',',':')).encode())
                digest.update(image.crop((row['x'],row['y'],row['x']+row['w'],row['y']+row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(),
                         '23f80e402b082a50b8b9df64e10da8f765f81f578ffee7487b05ec4c47d20582')


if __name__ == '__main__':
    unittest.main()
