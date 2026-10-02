"""Require occupied ownership and reject incomplete or displaced exports."""
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from offline_dining import load_dining, coverage_tables

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = ROOT / 'assets/models/domestic/export/seated-dining/manifest.json'
EMPTY = {'offlineDiningChair' + suffix for suffix in ('', 'SW', 'NW', 'NE')}


class OccupiedDiningTests(unittest.TestCase):
    def test_complete_export_keeps_old_chairs_and_distinct_visible_owners(self):
        result = load_dining(MANIFEST, existing_names=EMPTY)
        self.assertEqual(len(result.pairs), 96)
        self.assertEqual(set(result.profiles), EMPTY)
        sprites = [(name, None, 1, 1) for name in sorted(EMPTY)] + result.sprites
        catalog, masks = coverage_tables(result, sprites)
        self.assertEqual(len(catalog), 96)
        self.assertLess(len(masks), 384)
        for body, wood, ink, body_ink in catalog.values():
            self.assertNotEqual(body, wood)
            self.assertEqual(masks[body]['size'], [160, 224])
            self.assertEqual(masks[ink]['size'], [160, 224])
        self.assertFalse(EMPTY.intersection(name for name, *_ in result.sprites))

    def test_incomplete_and_displaced_payloads_fail_before_import(self):
        original = json.loads(MANIFEST.read_text())
        real_loads = json.loads
        for mutation in ('missing-frame', 'duplicate-frame', 'registration', 'missing-wood'):
            data = copy.deepcopy(original)
            if mutation == 'missing-frame':
                data['frames'].pop()
            elif mutation == 'duplicate-frame':
                data['frames'].append(data['frames'][0])
            elif mutation == 'registration':
                data['anchor'][1] -= 1
            else:
                data['frames'][0]['furniture']['sha256'] = '0' * 64
            def altered(text):
                parsed = real_loads(text)
                return data if 'comparisons' in parsed else parsed
            with self.subTest(mutation=mutation), patch('offline_dining.json.loads', side_effect=altered):
                with self.assertRaises(AssertionError):
                    load_dining(MANIFEST, existing_names=EMPTY)


if __name__ == '__main__':
    unittest.main()
