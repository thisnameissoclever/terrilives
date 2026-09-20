"""New wall endcaps append without changing the complete preceding atlas."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]


class EdgeWallPrefixTests(unittest.TestCase):
    def test_preserves_main_1221_record_prefix_before_front_door_append(self):
        rows = tomllib.loads((ROOT / 'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertEqual(len(rows), 1225)
        self.assertEqual([r['name'] for r in rows[1217:1221]],
                         ['wallHalf1', 'wallHalf2', 'wallHalf4', 'wallHalf8'])
        self.assertEqual(
            [r['name'] for r in rows[1221:]],
            [
                'frontDoorFrameSELeft',
                'frontDoorClosedSELeft',
                'frontDoorAjarSELeft',
                'frontDoorOpenSELeft',
            ],
        )
        digest = hashlib.sha256()
        with Image.open(ROOT / 'web/public/atlas.png') as image:
            for row in rows[:1221]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop((row['x'], row['y'], row['x'] + row['w'], row['y'] + row['h'])).tobytes())
        self.assertEqual(digest.hexdigest(), '0f6dc3c0eece7e4ac672c5057b26c5747cc689f35ad9fde01fd9a6ed4c736d90')


if __name__ == '__main__':
    unittest.main()
