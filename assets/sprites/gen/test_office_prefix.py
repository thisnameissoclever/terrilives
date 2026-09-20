"""Keep all non-bunk assets byte-identical while replacing the bunk ladder."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]


class OfficePrefixTests(unittest.TestCase):
    def test_preserves_all_1141_non_bunk_names_indices_dimensions_density_and_pixels(self):
        atlas = tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual(len(atlas), 1221)
        self.assertEqual([row['name'] for row in atlas[1217:]],
                         ['wallHalf1', 'wallHalf2', 'wallHalf4', 'wallHalf8'])
        # Only the reviewed bunk interval is authorized to change. Include
        # the desk after it, so a shifted append index is also rejected.
        rows = [(index, row) for index, row in enumerate(atlas[:1217]) if not 1137 <= index < 1213]
        self.assertEqual(len(rows), 1141)
        digest = hashlib.sha256()
        with Image.open(ROOT/'web/public/atlas.png') as image:
            for index, row in rows:
                digest.update(json.dumps([index, row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop((row['x'], row['y'], row['x']+row['w'], row['y']+row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(), '12c76daaaec022e850baa092eb8a4bca739e44173ca717f33556c7e784101b42')


if __name__ == '__main__':
    unittest.main()
