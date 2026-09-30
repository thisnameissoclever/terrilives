"""Protect every earlier decoded sprite when appending the dining chair."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image


class DiningChairPrefixTests(unittest.TestCase):
    def test_keeps_all_1250_earlier_records_and_pixels(self):
        root = Path(__file__).resolve().parents[3]
        rows = tomllib.loads((root/'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([row['name'] for row in rows[1250:1254]],
                         ['offlineDiningChair', 'offlineDiningChairNW',
                          'offlineDiningChairSW', 'offlineDiningChairNE'])
        digest = hashlib.sha256()
        with Image.open(root/'web/public/atlas.png') as image:
            for row in rows[:1250]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop((row['x'], row['y'], row['x']+row['w'], row['y']+row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(), 'e1bb3a60a41c7f8aa0859f3a443210f22f93c4999987a5da6c5861ae4ec32305')
        for row in rows[1250:1254]:
            self.assertEqual((row['w'], row['h'], row['pixel_density']), (192, 240, 2))


if __name__ == '__main__':
    unittest.main()
