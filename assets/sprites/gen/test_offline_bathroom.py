"""Bathroom scenes append independent action profiles and visible-owner layers."""
import importlib
import itertools
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image


class BathroomImportTests(unittest.TestCase):
    def fixture(self):
        api = importlib.import_module('offline_bathroom')
        layers = {name:Image.new('RGBA', (8, 8)) for name in ('body', 'furniture', 'ink')}
        layers['body'].putpixel((2, 2), (40, 20, 10, 255))
        layers['furniture'].putpixel((5, 5), (80, 60, 40, 255))
        layers['ink'].putpixel((2, 1), (32, 32, 32, 255))
        masks = {role:image.getchannel('A') for role, image in layers.items()}
        masks['bodyInk'] = masks['ink'].copy()
        scenes = [dict(facing=f, variant=v, frame=i, layers={r:r for r in layers},
                       coverage={r:r for r in masks})
                  for f, v, i in itertools.product(('SE', 'NW', 'SW', 'NE'), ('green', 'blue', 'red'), range(4))]
        obj = dict(kind='toilet', content='toilet', canvas=[4, 4], anchor=[2, 4], scenes=scenes)
        return api, api.BathroomExport(dict(objects=[obj], halfCycleTicks=8, action=15), layers, masks)

    def test_records_append_layer_textures_and_registered_scene_aliases(self):
        api, export = self.fixture()
        records = api.records(export)
        self.assertEqual(len(records), 51)
        self.assertTrue(all(row[0].startswith('bathroom') for row in records))

    def test_all_facings_select_four_frames_of_toilet_action(self):
        api, export = self.fixture()
        empties = [('offlineToilet'+suffix, Image.new('RGBA', (1, 1)), 1, 1)
                   for suffix in ('', 'NW', 'SW', 'NE')]
        tables = api.tables(export, empties+api.records(export))
        self.assertEqual(set(tables['profiles']), {0, 1, 2, 3})
        for profile in tables['profiles'].values():
            self.assertEqual(profile['action'], 15)
            self.assertEqual(profile['halfCycleTicks'], 8)
            self.assertTrue(all(len(frames) == 4 for frames in profile['frames'].values()))
        self.assertEqual(len(tables['layers']), 48)
        self.assertEqual(len(tables['coverage']), 48)

    def test_missing_exact_empty_facing_rejects(self):
        api, export = self.fixture()
        with self.assertRaises(ValueError):
            api.tables(export, api.records(export))

    def test_unsupported_manifest_is_rejected_before_source_loading(self):
        api, _ = self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'manifest.json'
            path.write_text(json.dumps(dict(version=9, action=8)))
            with self.assertRaises(ValueError):
                api.load_bathroom(path)


if __name__ == '__main__':
    unittest.main()
