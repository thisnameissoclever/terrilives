"""New wall endcaps append without changing the complete preceding atlas."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]


class EdgeWallPrefixTests(unittest.TestCase):
    def test_preserves_all_1217_prior_records_and_appends_four_endcaps(self):
        rows = tomllib.loads((ROOT / 'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual([r['name'] for r in rows[1217:1221]],
                         ['wallHalf1', 'wallHalf2', 'wallHalf4', 'wallHalf8'])
        digest = hashlib.sha256()
        with Image.open(ROOT / 'web/public/atlas.png') as image:
            for row in rows[:1217]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop((row['x'], row['y'], row['x'] + row['w'], row['y'] + row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(), 'a515c86ef643a1addeb0805b1c33768785f470abcb4d456cfe0f758d99b31c85')


if __name__ == '__main__':
    unittest.main()
