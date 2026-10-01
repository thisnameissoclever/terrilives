import hashlib
import json
import unittest
from pathlib import Path

from PIL import Image

BASE = Path(__file__).resolve().parent
VARIANTS = ('green', 'blue', 'red')
ACTIONS = ('prepare', 'cook', 'wash')
FACINGS = ('SE', 'SW', 'NW', 'NE')


class DomesticExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifests = {variant: json.loads(
            (BASE / 'export/domestic' / variant / 'manifest.json').read_text())
            for variant in VARIANTS}
        cls.proof = json.loads((BASE / 'export/domestic/render-proof.json').read_text())

    def test_every_action_facing_phase_and_palette_exists(self):
        expected = {(action, facing, phase) for action in ACTIONS
                    for facing in FACINGS for phase in range(4)}
        for manifest in self.manifests.values():
            self.assertEqual(len(manifest['frames']), 48)
            self.assertEqual({(row['action'], row['facing'], row['frame'])
                              for row in manifest['frames']}, expected)
        self.assertEqual(len(self.proof), 144)
        self.assertEqual({(row['variant'], row['action'], row['facing'], row['frame'])
                          for row in self.proof},
                         {(variant, *sample) for variant in VARIANTS for sample in expected})

    def test_source_hash_registered_rgba_bytes_and_transparent_padding(self):
        source_hash = hashlib.sha256((BASE / 'sim-01-rigged.blend').read_bytes()).hexdigest()
        for variant, manifest in self.manifests.items():
            self.assertEqual(manifest['source_sha256'], source_hash)
            self.assertEqual(manifest['pixel_density'], 2)
            for row in manifest['frames']:
                clip = manifest['clips'][row['action']]
                path = BASE / 'export/domestic' / variant / row['path']
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), row['sha256'])
                with Image.open(path) as frame:
                    self.assertEqual(frame.mode, 'RGBA')
                    self.assertEqual(frame.size, (clip['width'] * 2, clip['height'] * 2))
                    x0, y0, x1, y1 = frame.getchannel('A').getbbox()
                    self.assertGreater(min(x0, y0), 0)
                    self.assertLess(x1, frame.width)
                    self.assertLess(y1, frame.height)
                self.assertAlmostEqual(clip['anchor'][0], clip['world_origin'][0], places=5)
                self.assertAlmostEqual(clip['anchor'][1], clip['world_origin'][1] + 21, places=5)

    def test_each_clip_moves_and_palette_changes_preserve_geometry_and_camera(self):
        for action in ACTIONS:
            for facing in FACINGS:
                rows = [row for row in self.proof
                        if row['action'] == action and row['facing'] == facing]
                self.assertGreater(len({row['geometry_sha256'] for row in rows}), 1)
                for phase in range(4):
                    samples = [row for row in rows if row['frame'] == phase]
                    for field in ('geometry_sha256', 'camera_matrix', 'camera_scale',
                                  'resolution', 'eyes_closed', 'book_visible', 'visibility'):
                        self.assertEqual(samples[0][field], samples[1][field])
                        self.assertEqual(samples[0][field], samples[2][field])
                    images = [Image.open(BASE / 'export/domestic' / variant /
                                         f'{action}-{facing}-{phase}.png').convert('RGBA')
                              for variant in VARIANTS]
                    self.assertEqual(images[0].getchannel('A').tobytes(),
                                     images[1].getchannel('A').tobytes())
                    self.assertEqual(images[0].getchannel('A').tobytes(),
                                     images[2].getchannel('A').tobytes())
                    self.assertNotEqual(images[0].tobytes(), images[1].tobytes())
                    self.assertNotEqual(images[0].tobytes(), images[2].tobytes())


if __name__ == '__main__':
    unittest.main()
