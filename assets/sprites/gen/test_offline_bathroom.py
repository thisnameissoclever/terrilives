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
        return api, api.BathroomExport(dict(objects=[obj], halfCycleTicks=8, action=18), layers, masks)

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
            self.assertEqual(profile['action'], 18)
            self.assertEqual(profile['halfCycleTicks'], 8)
            self.assertTrue(all(len(frames) == 4 for frames in profile['frames'].values()))
        self.assertEqual(len(tables['layers']), 48)
        self.assertEqual(len(tables['coverage']), 48)

    def bath_fixture(self):
        api = importlib.import_module('offline_bathroom')
        layers = {name:Image.new('RGBA', (8, 8)) for name in ('body', 'furniture', 'ink')}
        layers['body'].putpixel((2, 2), (40, 20, 10, 255))
        layers['furniture'].putpixel((5, 5), (80, 60, 40, 255))
        layers['ink'].putpixel((2, 1), (32, 32, 32, 255))
        masks = {role:image.getchannel('A') for role, image in layers.items()}
        masks['bodyInk'] = masks['ink'].copy()
        scenes = [dict(facing=f, variant='green', frame=i, layers={r:r for r in layers}, coverage={r:r for r in masks})
                  for f, i in itertools.product(('SE', 'NW', 'SW', 'NE'), range(4))]
        obj = dict(kind='bathtub', content='bathtub', canvas=[4, 4], anchor=[2, 4], scenes=scenes)
        export = api.BathroomExport(dict(objects=[obj], halfCycleTicks=8, action=19, palette_independent=True), layers, masks, 'bathtub')
        empties = [('offlineBathtub'+suffix, Image.new('RGBA', (1, 1)), 1, 1) for suffix in ('', 'NW', 'SW', 'NE')]
        return api, export, empties

    def test_bathing_scenes_serve_every_shirt_variant_from_one_appearance(self):
        api, export, empties = self.bath_fixture()
        records = api.records(export)
        self.assertEqual(len(records), 3+16)
        self.assertEqual(sum(row[0].startswith('bathroomBath_') for row in records), 16)
        tables = api.tables(export, empties+records, anchors={index:[2, 4] for index in range(4)})
        self.assertEqual(set(tables['profiles']), {0, 1, 2, 3})
        for profile in tables['profiles'].values():
            self.assertEqual(profile['action'], 19)
            self.assertEqual(profile['frames']['green'], profile['frames']['blue'])
            self.assertEqual(profile['frames']['green'], profile['frames']['red'])
            self.assertEqual(len(profile['frames']['green']), 4)
        self.assertEqual(len(tables['layers']), 16)
        with self.assertRaises(ValueError):
            api.tables(export, empties+records, anchors={0:[2, 4], 1:[2, 4], 2:[2, 4], 3:[2, 25]})

    def test_occupied_scene_must_register_on_its_empty_fixture_anchor(self):
        api, export = self.fixture()
        empties = [('offlineToilet'+suffix, Image.new('RGBA', (1, 1)), 1, 1)
                   for suffix in ('', 'NW', 'SW', 'NE')]
        sprites = empties+api.records(export)
        api.tables(export, sprites, anchors={index:[2, 4] for index in range(4)})
        with self.assertRaises(ValueError):
            api.tables(export, sprites, anchors={0:[2, 4], 1:[2, 4], 2:[2, 4], 3:[2, 25]})

    def test_fridge_reach_serves_eight_progress_samples_on_a_padded_canvas(self):
        api = importlib.import_module('offline_bathroom')
        layers = {name:Image.new('RGBA', (8, 8)) for name in ('body', 'furniture', 'ink')}
        layers['body'].putpixel((2, 2), (40, 20, 10, 255))
        layers['furniture'].putpixel((5, 5), (80, 60, 40, 255))
        layers['ink'].putpixel((2, 1), (32, 32, 32, 255))
        masks = {role:image.getchannel('A') for role, image in layers.items()}
        masks['bodyInk'] = masks['ink'].copy()
        scenes = [dict(facing=f, variant=v, frame=i, layers={r:r for r in layers}, coverage={r:r for r in masks})
                  for f, v, i in itertools.product(('SE', 'NW', 'SW', 'NE'), ('green', 'blue', 'red'), range(8))]
        empty = [48.0000114440918, 116.0004369020462]
        left, top = api.KINDS['fridge']['padding'][:2]
        obj = dict(kind='fridge', content='fridge', canvas=[156, 166], anchor=[empty[0]+left, empty[1]+top], scenes=scenes)
        export = api.BathroomExport(dict(objects=[obj], action=22, samples=8, playback='progress'), layers, masks, 'fridge')
        empties = [('offlineFridge'+suffix, Image.new('RGBA', (1, 1)), 1, 1) for suffix in ('', 'NW', 'SW', 'NE')]
        records = api.records(export)
        self.assertEqual(sum(row[0].startswith('kitchenFridgeReach_') for row in records), 96)
        tables = api.tables(export, empties+records, anchors={index:empty for index in range(4)})
        for profile in tables['profiles'].values():
            self.assertEqual(profile['action'], 22)
            self.assertTrue(all(len(frames) == 8 for frames in profile['frames'].values()))
        # The unpadded anchor, or one moved by a pixel, does not register on the empty fridge.
        for wrong in ([e for e in empty], [empty[0]+left+1, empty[1]+top]):
            obj['anchor'] = wrong
            with self.assertRaises(ValueError):
                api.tables(export, empties+records, anchors={index:empty for index in range(4)})

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
