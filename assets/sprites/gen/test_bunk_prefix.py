"""Preserve every pre-bunk record, including the corrected refrigerator."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]


class BunkPrefixTests(unittest.TestCase):
    def test_preserves_all_1137_preceding_names_dimensions_density_and_pixels(self):
        rows = tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())['sprite'][:1137]
        self.assertEqual(len(rows),1137)
        digest = hashlib.sha256()
        with Image.open(ROOT/'web/public/atlas.png') as image:
            for row in rows:
                digest.update(json.dumps([row['name'],row['w'],row['h'],row.get('pixel_density',1)],
                                         separators=(',',':')).encode())
                digest.update(image.crop((row['x'],row['y'],row['x']+row['w'],row['y']+row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(),'0f83ad823c288923f6cf7d13b4ef8db1e655a0a511286426920c1e3873f84336')


if __name__ == '__main__':
    unittest.main()
