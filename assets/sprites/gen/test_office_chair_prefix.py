"""New chair art must not alter or renumber any accepted sprite."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image


class OfficeChairPrefixTests(unittest.TestCase):
    def test_keeps_all_1246_earlier_records_and_pixels(self):
        root = Path(__file__).resolve().parents[3]
        rows = tomllib.loads((root/'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([row['name'] for row in rows[1246:1250]],
                         ['offlineDeskChair', 'offlineDeskChairNW',
                          'offlineDeskChairSW', 'offlineDeskChairNE'])
        digest = hashlib.sha256()
        with Image.open(root/'web/public/atlas.png') as image:
            for row in rows[:1246]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop((row['x'], row['y'], row['x']+row['w'], row['y']+row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(), '8e68ba22a49d0c01e3bfc4886ba6f01e22d9d8360a94c5dfcc9c84924c75b731')
        for row in rows[1246:1250]:
            self.assertEqual((row['w'], row['h'], row['pixel_density']), (192, 240, 2))


if __name__ == '__main__':
    unittest.main()
