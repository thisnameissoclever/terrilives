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
            (1109,'f9353a052fe42c7fff9988e7d247d5aac1dd3949d237ed161b209bccd23fdfda'),
            (1113,'1f9998a88f536e80d90aa8e9e7d274650fdd878577e1c597d0966ac210401454'),
            (1117,'7df64f812c534cd7a2f16f4e6aa1b92c5038199ff9bbed01d72785f2c1b66488'),
            (1121,'6c6e9938a5de9ed35a62a45bb5dc63114a5a1c9358ced3592781e00987f6685e'),
            (1125,'303d593494271f880caa13190dccebe5d5e9a00bcd4b353e0345f2d114eaef66'),
            (1133,'cc6bf794b7def991014d55e12798c4993c87d33b240c00eb059f07f913625b4e'),
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
