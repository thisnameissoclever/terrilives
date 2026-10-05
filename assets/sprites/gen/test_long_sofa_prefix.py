"""Protect every released sprite when appending the long sofa."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image
from atlas_pixels import AtlasPages


class LongSofaPrefixTests(unittest.TestCase):
    def test_keeps_all_1258_earlier_records_and_pixels(self):
        root = Path(__file__).resolve().parents[3]
        rows = tomllib.loads((root/'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([row['name'] for row in rows[1258:1262]],
                         ['offlineLongSofa', 'offlineLongSofaNW',
                          'offlineLongSofaSW', 'offlineLongSofaNE'])
        digest = hashlib.sha256()
        with AtlasPages(root) as image:
            for row in rows[:1258]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop(row).tobytes())
        self.assertEqual(digest.hexdigest(), 'ca15e11ea383748e9e6cbd5971c067ebb37177ccc0fb54054195e94e6eec1e3c')
        for row in rows[1258:1262]:
            self.assertEqual((row['w'], row['h'], row['pixel_density']), (320, 352, 2))


if __name__ == '__main__':
    unittest.main()
