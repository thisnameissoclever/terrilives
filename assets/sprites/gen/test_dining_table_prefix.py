"""Protect the released sprite prefix when appending the dining table."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image
from atlas_pixels import AtlasPages


class DiningTablePrefixTests(unittest.TestCase):
    def test_keeps_all_1254_earlier_records_and_pixels(self):
        root = Path(__file__).resolve().parents[3]
        rows = tomllib.loads((root/'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([row['name'] for row in rows[1254:1258]],
                         ['offlineDiningTable', 'offlineDiningTableNW',
                          'offlineDiningTableSW', 'offlineDiningTableNE'])
        digest = hashlib.sha256()
        with AtlasPages(root) as image:
            for row in rows[:1254]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop(row).tobytes())
        self.assertEqual(digest.hexdigest(), '646e4dc2a7e3d403505234661cdc9d5c9713bb014db0a66ae027e80303590946')
        for row in rows[1254:1258]:
            self.assertEqual((row['w'], row['h'], row['pixel_density']), (320, 352, 2))


if __name__ == '__main__':
    unittest.main()
