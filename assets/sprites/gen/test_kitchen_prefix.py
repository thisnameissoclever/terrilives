"""Preserve shipped artwork outside the explicit refrigerator correction."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]


class KitchenPrefixTests(unittest.TestCase):
    def test_preserves_prior_records_and_decoded_pixels_except_corrected_fridge(self):
        records = tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())['sprite']
        for count, expected in (
            (1089,'23f80e402b082a50b8b9df64e10da8f765f81f578ffee7487b05ec4c47d20582'),
            (1105,'c360e7e68bab407603c36e3f49bb7e43a19cc4f6b1f9554a2abd6bc2a62d8d8d'),
        ):
            with self.subTest(count=count), Image.open(ROOT/'web/public/atlas.png') as image:
                rows = records[:count]
                self.assertEqual(len(rows),count)
                digest = hashlib.sha256()
                for index, row in enumerate(rows):
                    if 1089 <= index < 1093:
                        self.assertEqual(row['name'],
                            ('offlineFridge','offlineFridgeNW','offlineFridgeSW','offlineFridgeNE')[index-1089])
                        # These four images are intentionally replaced for the
                        # owner's room-scale correction, not new appended art.
                        continue
                    metadata = [row['name'],row['w'],row['h'],row.get('pixel_density',1)]
                    digest.update(json.dumps(metadata,separators=(',',':')).encode())
                    digest.update(image.crop((row['x'],row['y'],row['x']+row['w'],row['y']+row['h'])).tobytes())
                self.assertEqual(digest.hexdigest(),expected)


if __name__ == '__main__':
    unittest.main()
