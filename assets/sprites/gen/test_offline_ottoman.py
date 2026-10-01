"""Reuse the published ottoman and append its target-specific occupied layers."""
from pathlib import Path
import unittest

from offline_ottoman import load_ottoman, load_reviewed_ottoman
from offline_furniture import furniture_tables

ROOT = Path(__file__).resolve().parents[3]
EXPORT = ROOT / 'assets/models/living/owner-review-pending/ottoman/sitting-02/archive/output/ottoman-sit-candidate-02/offline-export'
EMPTY = ('offlineOttoman', 'offlineOttomanNW', 'offlineOttomanSW', 'offlineOttomanNE')


class OttomanImportTests(unittest.TestCase):
    def test_reviewed_entrypoint_requires_evidence_before_importing_frames(self):
        result = load_reviewed_ottoman(ROOT / 'assets/models/living/ottoman-reviewed.json', existing_names=EMPTY)
        self.assertEqual(len(result.sprites), 72)
        self.assertEqual(set(result.profiles), set(EMPTY))

    def test_reused_empty_requires_every_published_facing(self):
        for names in [(), *[EMPTY[:i] + EMPTY[i+1:] for i in range(4)]]:
            with self.subTest(names=names):
                with self.assertRaisesRegex(ValueError, 'Missing existing empty seating sprites'):
                    load_ottoman(EXPORT / 'manifest.json', existing_names=names)

    def test_occupied_profiles_reuse_existing_empty_sprites_and_authored_cadence(self):
        result = load_ottoman(EXPORT / 'manifest.json', existing_names=EMPTY)
        self.assertEqual(len(result.sprites), 72)
        self.assertEqual(set(result.profiles), set(EMPTY))
        self.assertEqual(len(result.pairs), 48)
        self.assertFalse(set(name for name, *_ in result.sprites) & set(EMPTY))
        self.assertFalse(set(result.bounds) & set(EMPTY))
        for profile in result.profiles.values():
            self.assertEqual((profile['action'], profile['halfCycleTicks']), (8, 10))
            self.assertEqual(set(profile['frames']), {'green', 'blue', 'red'})
            self.assertTrue(all(len(frames) == 4 for frames in profile['frames'].values()))
        existing = [(name, None, 192, 240) for name in EMPTY]
        anchors, _, bounds, density, pairs, profiles = furniture_tables(result, existing + result.sprites)
        self.assertEqual(set(profiles), {0, 1, 2, 3})
        self.assertEqual(len(pairs), 48)
        self.assertTrue(all(index >= 4 for index in anchors))
        self.assertEqual(set(bounds), set(pairs))
        self.assertEqual(set(density.values()), {2})


if __name__ == '__main__':
    unittest.main()
