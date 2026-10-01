"""Media additions must leave every preceding sprite intact."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image


class MediaPrefixTests(unittest.TestCase):
    def test_keeps_all_1262_earlier_records_and_pixels(self):
        root = Path(__file__).resolve().parents[3]
        rows = tomllib.loads((root/'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([row['name'] for row in rows[1262:1270]],
                         [base+turn for base in ('offlineTelevision', 'offlineRadio')
                          for turn in ('', 'NW', 'SW', 'NE')])
        digest = hashlib.sha256()
        with Image.open(root/'web/public/atlas.png') as image:
            for row in rows[:1262]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop((row['x'], row['y'], row['x']+row['w'], row['y']+row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(), 'a573c237c978642df26f5cc057fd2541085129c5a5be43535e9130df4db91ea1')
        for row in rows[1262:1270]:
            self.assertEqual((row['w'], row['h'], row['pixel_density']), (192, 240, 2))


if __name__ == '__main__':
    unittest.main()
