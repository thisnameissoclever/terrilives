"""Append aquarium frames without changing the pinned current release."""
import copy
import hashlib
import json
from pathlib import Path
import re
import tomllib
import unittest

from PIL import Image
from atlas_pixels import AtlasPages
from atlas_test_tables import table
ROOT = Path(__file__).resolve().parents[3]
BASELINE = json.loads(Path(__file__).with_name('aquarium-preserved-main.json').read_text())
# Approved append from e8fdeefad; keep it independent of the live extension file.
PATIO_CATALOGUE = {
    'coverings': {'4': 'floor.outdoor-patio'},
    'patterns': {'floor.outdoor-patio': {
        'role': 'floor', 'period': [4, 2], 'resource': 'tiles'}},
    'palettes': {'stone-gray': {'multiply': [.55, .58, .60]}},
    'finishes': {'floor.outdoor-patio': {
        'patternKey': 'floor.outdoor-patio', 'paletteKey': 'stone-gray',
        'authoredContentLook': [0, 1, 0]}},
}


def table_value(source, name):
    value = table(source, name)
    if isinstance(value, dict) and all(key.isdecimal() for key in value):
        value = {key: item for key, item in value.items() if int(key) < BASELINE['count']}
    return value


class AquariumPrefixTests(unittest.TestCase):
    def architecture_descriptor(self):
        source = (ROOT/'web/src/render/architecture-data.ts').read_text()
        match = re.search(r'export const ARCHITECTURE = (.*) as const;', source, re.S)
        self.assertIsNotNone(match)
        return json.loads(match.group(1))

    def assert_preserved_architecture(self, descriptor, sprite_count):
        value = copy.deepcopy(descriptor)
        base = value.pop('baseSpriteId')
        # Architecture follows the complete historical atlas, including reviewed extensions.
        self.assertGreaterEqual(sprite_count, BASELINE['count'])
        self.assertEqual(base, sprite_count)
        for index, row in enumerate(value['sprites']):
            self.assertEqual(row.pop('id'), base + index)
        # Remove only the exact approved append before checking the immutable history.
        for section, entries in PATIO_CATALOGUE.items():
            for key, expected in entries.items():
                self.assertIn(key, value['catalogue'][section])
                self.assertEqual(value['catalogue'][section].pop(key), expected)
        digest = hashlib.sha256(json.dumps(value, sort_keys=True,
            separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        # Depth and role files ship as .gz since 2026-10-12; only their names changed.
        self.assertEqual(digest, '2c76b1dd414f57a69ecd72582454588fdbc28f20b54c2eb98f01e7d1688ba245')

    def test_architecture_keeps_geometry_resources_and_local_order_when_its_base_moves(self):
        rows = tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())['sprite']
        self.assert_preserved_architecture(self.architecture_descriptor(), len(rows))

    def test_architecture_guard_rejects_unrelated_descriptor_drift(self):
        original = self.architecture_descriptor()

        def reorder_sprites(value):
            value['sprites'][0], value['sprites'][1] = value['sprites'][1], value['sprites'][0]
            # Even reassigned consecutive IDs cannot conceal changed local ordering.
            for index, row in enumerate(value['sprites']):
                row['id'] = value['baseSpriteId'] + index

        for label, change in (
                ('base offset', lambda v: v.update(baseSpriteId=v['baseSpriteId'] + 1)),
                ('drawing ID', lambda v: v['sprites'][0].update(id=0)),
                ('geometry', lambda v: v['sprites'][0]['anchor'].__setitem__(0, 21)),
                ('local order', reorder_sprites),
                ('resource', lambda v: v['resources'].update(color='unreviewed.png')),
                ('resource pixels', lambda v: v['hashes'].update(color='0' * 64)),
                ('old covering', lambda v: v['catalogue']['coverings'].update({'1': 'floor.tiles'})),
                ('extra covering', lambda v: v['catalogue']['coverings'].update({'5': 'floor.tiles'})),
                ('extra palette', lambda v: v['catalogue']['palettes'].update(unreviewed={'multiply': [1, 1, 1]}))):
            with self.subTest(change=label):
                changed = copy.deepcopy(original)
                change(changed)
                with self.assertRaises(AssertionError):
                    self.assert_preserved_architecture(changed, original['baseSpriteId'])

    def test_architecture_guard_rejects_missing_or_corrupt_patio_entries(self):
        original = self.architecture_descriptor()
        for section, entries in PATIO_CATALOGUE.items():
            for key, expected in entries.items():
                corruptions = [('missing', None)]
                if isinstance(expected, dict):
                    for field in expected:
                        changed = copy.deepcopy(expected)
                        changed[field] = 'unreviewed'
                        corruptions.append((field, changed))
                    corruptions.append(('extra field', dict(expected, unreviewed=True)))
                else:
                    corruptions.append(('identity', 'floor.tiles'))
                for label, replacement in corruptions:
                    with self.subTest(section=section, change=label):
                        changed = copy.deepcopy(original)
                        if replacement is None:
                            del changed['catalogue'][section][key]
                        else:
                            changed['catalogue'][section][key] = replacement
                        with self.assertRaises(AssertionError):
                            self.assert_preserved_architecture(changed, original['baseSpriteId'])

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
