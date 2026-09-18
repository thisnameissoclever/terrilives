"""Keep the accepted bunk, Sims and previous furniture byte-identical."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]


class OfficePrefixTests(unittest.TestCase):
    def test_preserves_all_1213_previous_names_dimensions_density_and_pixels(self):
        rows = tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())['sprite'][:1213]
        self.assertEqual(len(rows), 1213)
        digest = hashlib.sha256()
        with Image.open(ROOT/'web/public/atlas.png') as image:
            for row in rows:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop((row['x'], row['y'], row['x']+row['w'], row['y']+row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(), '113def9c18395bcd35b74476812074d66b88b8dc5ad514368cde0bcb7c3ea556')


if __name__ == '__main__':
    unittest.main()
