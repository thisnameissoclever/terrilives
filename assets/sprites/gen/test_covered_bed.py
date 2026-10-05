"""Pin published pixels and compare covered-bed owners to original grayscale PNGs."""
import base64
import hashlib
import json
from pathlib import Path
import re
import tomllib
import unittest

from PIL import Image
from atlas_pixels import AtlasPages
from offline_double_bed import load_covered_bed, scene_key
from test_lamp_prefix import canonical_digest, preserved_table

ROOT = Path(__file__).resolve().parents[3]
EXPORT = ROOT / 'assets/models/bedroom/export/double-bed-covered'


class CoveredBedTests(unittest.TestCase):
    def test_preserves_all_1700_published_sprite_pixels_and_dimensions(self):
        rows = tomllib.loads((ROOT / 'assets/sprites/atlas.toml').read_text())['sprite']
        digest = hashlib.sha256()
        with AtlasPages(ROOT) as image:
            for row in rows[:1700]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop(row).tobytes())
        self.assertEqual(digest.hexdigest(), 'a96852795c4f5f02f483fab6f58f854a492a81491286a7fa23759c84a693f22c')
        self.assertGreaterEqual(len(rows), 1833)

    def test_preserves_prior_registration_and_interaction_metadata(self):
        expected = {
            'SPRITE_ANCHORS': 'a407877ace0fd24c323c6878d88d66868690bbad20c8e8e4568d39230125a989',
            'SPRITE_CONTENT_TOPS': '639b051e34d0c69f4a855e7815af6cbd5bb6b140996292f05e802e62d9e970ff',
            'SPRITE_CONTENT_BOUNDS': '4df4ebf931d3d7e0bd20ce090fcda9e865e6fee8cc28bed6472048b4c8004f02',
            'SPRITE_PAIRS': 'bae5d03b7e2fb459fbe6dc9f962da206799cccbf886220bd4d0dab75acce6cfc',
            'INTERACTION_SPRITES': 'cdb23229084fe45e97a3fe3a79285a607a4266cc033c9b4005de389258dd49cf',
            'SPRITE_HAND_ANCHORS': '44a758ed55f551cfe734ec20cf03608f951a4666873d266ed6d24bc45fc85e76',
            'SPRITE_HAND_FOREGROUND': '92e3ec14b47074f23dc72bc43083966b57e768915425e2c160187e38ec5b0d50',
            'RIGGED_SIM_CLIPS': '7ff02faa4edb562b43981ed20a3b32ea453d9420d53cfd41e18e6c729be3e0fc',
            'RIGGED_SIM_VARIANTS': '294ccca9695c1ec4b3a49095cf6de0120b3fe33b06487f7579e3e03fa731e64a',
        }
        source = (ROOT / 'web/src/render/atlas.ts').read_text()
        for name, digest in expected.items():
            with self.subTest(table=name):
                self.assertEqual(canonical_digest(preserved_table(source, name, 1700)), digest)

    def test_generated_owner_masks_are_original_l_values_by_exact_place(self):
        source = (ROOT / 'web/src/render/atlas.ts').read_text()
        catalog = preserved_table(source, 'BED_CATALOG', 10000)
        match = re.search(r'export const BED_COVERAGE[^\n]*= (\[.*?^\]);', source, re.M | re.S)
        records = json.loads(match.group(1))
        rows = tomllib.loads((ROOT / 'assets/sprites/atlas.toml').read_text())['sprite']
        names = {row['name']: index for index, row in enumerate(rows)}
        manifest = json.loads((EXPORT / 'manifest.json').read_text())
        count = 0
        for scene in manifest['scenes']:
            target = names['offlineDoubleBed' + ('' if scene['facing'] == 'SE' else scene['facing'])]
            generated = catalog[str(target)][str(scene_key(scene['occupancy'], scene['palettes']))]
            for owner in scene['bodies']:
                record = records[generated['owners'][owner['place']]['coverage']]
                self.assertNotIn('bitDepth', record)
                with Image.open(EXPORT / owner['coverage']['path']) as original:
                    self.assertEqual(original.mode, 'L')
                    restored = Image.new('L', tuple(record['size']))
                    left, top, right, bottom = record['box']
                    crop = Image.frombytes('L', (right-left, bottom-top), base64.b64decode(record['values']))
                    restored.paste(crop, (left, top))
                    self.assertEqual(restored.tobytes(), original.tobytes())
                    self.assertGreater(original.tobytes().count(0), 1000)
                    count += 1
        self.assertEqual(count, 96)

    def test_approved_export_has_complete_layer_and_coverage_hashes(self):
        manifest, layers, masks, scenes = load_covered_bed(EXPORT / 'manifest.json')
        self.assertEqual((len(layers), len(masks), len(scenes)), (69, 10, 64))
        self.assertTrue(manifest['static'])


if __name__ == '__main__':
    unittest.main()
