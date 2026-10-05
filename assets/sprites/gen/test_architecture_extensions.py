"""Reviewed extensions cannot alter or replace the frozen base sprite prefix."""
import copy
import json
import unittest

from PIL import Image
import offline_architecture


class ArchitectureExtensions(unittest.TestCase):
    def setUp(self):
        self.prefix = [('released', Image.new('RGBA', (2, 2), (30, 40, 50, 255)), 2, 2)]
        self.extension = [('reviewed', Image.new('RGBA', (2, 2), (20, 180, 100, 255)), 2, 2)]
        self.config = {'historicalCount': 1,
                       'historicalPrefixSha256': '71573672a2c85c9191dea7d77344fdd3b58da0d68637bf0e2e2708cc71fce85f'}

    def verify(self, sprites, extensions):
        check = getattr(offline_architecture, 'validate_historical_sprites', None)
        self.assertTrue(callable(check), 'The importer must validate frozen and extended records separately')
        check(sprites, self.config, extensions)

    def test_accepts_only_the_exact_prefix_and_reviewed_extension(self):
        self.verify(self.prefix + self.extension, self.extension)

    def test_rejects_changed_prefix_pixels(self):
        changed = [('released', Image.new('RGBA', (2, 2), (31, 40, 50, 255)), 2, 2)]
        with self.assertRaisesRegex(AssertionError, 'historical atlas prefix changed'):
            self.verify(changed + self.extension, self.extension)

    def test_rejects_missing_prefix_without_blessing_extension_as_history(self):
        with self.assertRaisesRegex(AssertionError, 'historical atlas length changed'):
            self.verify(self.extension, self.extension)

    def test_rejects_undeclared_extra_records(self):
        with self.assertRaisesRegex(AssertionError, 'historical atlas length changed'):
            self.verify(self.prefix + self.extension + self.extension, self.extension)

    def test_rejects_swapped_extension_identity_and_pixels(self):
        for replacement in (
                [('unreviewed', self.extension[0][1], 2, 2)],
                [('reviewed', Image.new('RGBA', (2, 2), (21, 180, 100, 255)), 2, 2)]):
            with self.subTest(replacement=replacement[0][0]):
                with self.assertRaisesRegex(AssertionError, 'reviewed atlas extension changed'):
                    self.verify(self.prefix + replacement, self.extension)

    def test_loads_only_the_pinned_reviewed_aquarium_catalog(self):
        config = json.loads((offline_architecture.SOURCE / 'architecture.json').read_text())
        sprites = offline_architecture.load_historical_extensions(config)
        self.assertEqual([sprite[0] for sprite in sprites], [
            prefix + suffix for prefix in ('offlineAquarium', 'offlineAquariumFrame1')
            for suffix in ('', 'NW', 'SW', 'NE')])
        self.assertTrue(all(image.mode == 'RGBA' and (width, height) == (192, 240)
                            for _, image, width, height in sprites))
        changed = copy.deepcopy(config)
        changed['historicalExtensions'][0]['canonicalSha256'] = '0' * 64
        with self.assertRaisesRegex(AssertionError, 'architecture extension catalog changed'):
            offline_architecture.load_historical_extensions(changed)

    def test_rejects_duplicate_and_escaping_extension_catalogs(self):
        config = json.loads((offline_architecture.SOURCE / 'architecture.json').read_text())
        duplicate = copy.deepcopy(config)
        duplicate['historicalExtensions'] *= 2
        with self.assertRaisesRegex(AssertionError, 'duplicate architecture extension catalog'):
            offline_architecture.load_historical_extensions(duplicate)
        escaping = copy.deepcopy(config)
        escaping['historicalExtensions'][0]['catalog'] = '../outside.json'
        with self.assertRaisesRegex(AssertionError, 'architecture resource escapes batch'):
            offline_architecture.load_historical_extensions(escaping)


if __name__ == '__main__':
    unittest.main()
