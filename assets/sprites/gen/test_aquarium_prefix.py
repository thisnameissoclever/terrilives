"""Append aquarium frames without changing the pinned current release."""
import hashlib
import json
from pathlib import Path
import re
import tomllib
import unittest

from PIL import Image
from atlas_pixels import AtlasPages
ROOT = Path(__file__).resolve().parents[3]
BASELINE = json.loads(Path(__file__).with_name('aquarium-preserved-main.json').read_text())


def table_value(source, name):
    match = re.search(r'^export const ' + re.escape(name) + r'\b[^\n]*=\s*([\[{].*?^[\]}]);',
                      source, re.M | re.S)
    if match is None:
        raise ValueError('Missing table: ' + name)
    text = re.sub(r'(?m)^(\s*)(\d+):', r'\1"\2":', match.group(1))
    value = json.loads(re.sub(r',\s*([}\]])', r'\1', text))
    if isinstance(value, dict) and all(key.isdecimal() for key in value):
        value = {key: item for key, item in value.items() if int(key) < BASELINE['count']}
    return value


class AquariumPrefixTests(unittest.TestCase):
    def test_architecture_keeps_geometry_resources_and_local_order_when_its_base_moves(self):
        source = (ROOT/'web/src/render/architecture-data.ts').read_text()
        match = re.search(r'export const ARCHITECTURE = (.*) as const;', source, re.S)
        self.assertIsNotNone(match)
        value = json.loads(match.group(1))
        base = value.pop('baseSpriteId')
        # Neutral seating appends 300 texture records and 240 scene aliases.
        # Quiet dining adds 36 records; cleaning adds 336 bodies, 32 lids and 80 masks.
        # The fitted toilet adds 60 texture layers and 48 scene aliases; the bath adds 36 layers and 16 aliases.
        self.assertEqual(base, BASELINE['count'] + 8 + 30 + 32 + 300 + 240 + 36 + 448 + 108 + 52)
        for index, row in enumerate(value['sprites']):
            self.assertEqual(row.pop('id'), base + index)
        digest = hashlib.sha256(json.dumps(value, sort_keys=True,
            separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        self.assertEqual(digest, '2a345967d080a65c42319e4eb2eaa96d92df7957ea0c2f376012b663355d1d5d')

    def test_preserves_every_released_record_and_decoded_pixel(self):
        rows = tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())['sprite']
        count = BASELINE['count']
        names = [prefix+suffix for prefix in ('offlineAquarium', 'offlineAquariumFrame1')
                 for suffix in ('', 'NW', 'SW', 'NE')]
        self.assertEqual([row['name'] for row in rows[count:count + 8]], names)
        digest = hashlib.sha256()
        with AtlasPages(ROOT) as image:
            for row in rows[:count]:
                digest.update(json.dumps([row['name'], row['w'], row['h'], row.get('pixel_density', 1)],
                                         separators=(',', ':')).encode())
                digest.update(image.crop(row).tobytes())
        self.assertEqual(digest.hexdigest(), BASELINE['pixel_sha256'])

    def test_preserves_bed_dining_coverage_surface_and_other_registration_tables(self):
        source = (ROOT/'web/src/render/atlas.ts').read_text()
        for name, expected in BASELINE['tables'].items():
            with self.subTest(table=name):
                value = table_value(source, name)
                if name == 'BED_CATALOG':
                    value = {key: value[key] for key in ('1133', '1134', '1135', '1136')}
                elif name in ('BED_COVERAGE', 'SPRITE_PAIR_MASKS'):
                    value = value[:expected['count']]
                elif name == 'INTERACTION_SPRITES':
                    value = {key: {field: item for field, item in profile.items() if field != 'idleFrames'}
                             for key, profile in value.items()}
                elif name == 'RIGGED_SIM_CLIPS':
                    value = {key: item for key, item in value.items()
                             if key not in ('mop', 'wipe_counter', 'wipe_table', 'empty_bin')}
                elif name == 'RIGGED_SIM_VARIANTS':
                    value = {key: {action: clip for action, clip in clips.items()
                             if action not in ('mop', 'wipe_counter', 'wipe_table', 'empty_bin')}
                             for key, clips in value.items()}
                self.assertEqual(len(value), expected['count'])
                digest = hashlib.sha256(json.dumps(value, sort_keys=True,
                    separators=(',', ':'), allow_nan=False).encode()).hexdigest()
                self.assertEqual(digest, expected['sha256'])


if __name__ == '__main__':
    unittest.main()
