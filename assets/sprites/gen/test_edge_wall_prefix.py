"""New wall endcaps append without changing the complete preceding atlas."""
import hashlib
import json
from pathlib import Path
import tomllib
import unittest
from PIL import Image
from atlas_pixels import AtlasPages

ROOT = Path(__file__).resolve().parents[3]


class EdgeWallPrefixTests(unittest.TestCase):
    def test_preserves_main_1221_record_prefix_before_front_door_append(self):
        rows = tomllib.loads((ROOT / 'assets/sprites/atlas.toml').read_text())['sprite']
        self.assertGreaterEqual(len(rows), 1229)
        self.assertEqual([r['name'] for r in rows[1217:1221]],
                         ['wallHalf1', 'wallHalf2', 'wallHalf4', 'wallHalf8'])
        self.assertEqual(
            [r['name'] for r in rows[1221:1229]],
            [
                'frontDoorFrameSELeft',
                'frontDoorClosedSELeft',
                'frontDoorAjarSELeft',
                'frontDoorOpenSELeft',
                'wallBookcase',
                'wallBookcaseSW',
                'wallBookcaseNW',
                'wallBookcaseNE',
            ],
        )
        digest = hashlib.sha256()
        with AtlasPages(ROOT) as image:
            for row in rows[:1221]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop(row).tobytes())
        self.assertEqual(digest.hexdigest(), '0f6dc3c0eece7e4ac672c5057b26c5747cc689f35ad9fde01fd9a6ed4c736d90')


if __name__ == '__main__':
    unittest.main()
