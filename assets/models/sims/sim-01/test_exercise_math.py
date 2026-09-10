"""Require the two exercise poses to meet the unchanged bike's pedal endpoints."""
import importlib.util
import hashlib
import json
import math
from pathlib import Path
import unittest

from PIL import Image

BASE = Path(__file__).resolve().parent


class ExerciseMathTests(unittest.TestCase):
    def module(self):
        spec = importlib.util.find_spec('exercise_math')
        self.assertIsNotNone(spec, 'Exercise contact calculation is absent')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_two_poses_swap_exact_existing_pedal_contacts(self):
        module = self.module()
        for phase, targets in ((0, {'L': (-5, 8), 'R': (-14, -9)}),
                               (.5, {'L': (-14, -9), 'R': (-5, 8)})):
            for side, expected in targets.items():
                ankle, contact = module.pedal_target(side, phase)
                projected = module.project_se(contact)
                for actual, target in zip(projected, expected):
                    self.assertAlmostEqual(actual, target, places=6)
                self.assertGreater(ankle[2], .13)

    def test_endpoints_are_opposite_about_one_crank(self):
        module = self.module()
        for phase in (0, .125, .25, .5, .75, 1):
            _, left = module.pedal_target('L', phase)
            _, right = module.pedal_target('R', phase)
            for axis in range(3):
                self.assertAlmostEqual((left[axis] + right[axis]) / 2, module.CRANK[axis])
            self.assertAlmostEqual(math.dist(left, module.CRANK), math.dist(right, module.CRANK))


class ExerciseExportTests(unittest.TestCase):
    def test_all_palettes_have_two_registered_poses_in_every_facing(self):
        expected_clip = None
        alpha = {}
        for variant in ('green', 'blue', 'red'):
            folder = BASE / 'export/exercise' / variant
            self.assertTrue((folder / 'manifest.json').is_file(), f'{variant} exercise supplement is absent')
            manifest = json.loads((folder / 'manifest.json').read_text())
            clip = manifest['clips']['exercise']
            self.assertEqual((clip['frame_count'], clip['sample_fps']), (2, 1.25))
            self.assertEqual(set(manifest['clips']), {'exercise'})
            self.assertEqual(len(manifest['frames']), 8)
            self.assertEqual({(frame['facing'], frame['frame']) for frame in manifest['frames']},
                             {(facing, index) for facing in ('SE', 'SW', 'NW', 'NE') for index in range(2)})
            if expected_clip is None:
                expected_clip = clip
            self.assertEqual(clip, expected_clip)
            self.assertAlmostEqual(clip['anchor'][1], clip['world_origin'][1] + 21)
            for frame in manifest['frames']:
                path = folder / frame['path']
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), frame['sha256'])
                with Image.open(path) as image:
                    self.assertEqual(image.mode, 'RGBA')
                    self.assertEqual(image.size, (clip['width'], clip['height']))
                    if variant == 'green':
                        alpha[frame['path']] = image.getchannel('A').tobytes()
                    self.assertEqual(image.getchannel('A').tobytes(), alpha[frame['path']])

    def test_saved_action_contact_and_phase_preservation(self):
        path = BASE / 'exercise-batch-proof.json'
        self.assertTrue(path.is_file(), 'Completed exercise proof is absent')
        proof = json.loads(path.read_text())
        self.assertEqual(proof['state'], 'complete')
        self.assertEqual(hashlib.sha256((BASE / 'sim-01-rigged.blend').read_bytes()).hexdigest(), proof['source_rig_sha256'])
        self.assertEqual(hashlib.sha256((BASE / 'sim-01-exercise.blend').read_bytes()).hexdigest(), proof['additive_rig_sha256'])
        for variant in ('green', 'blue', 'red'):
            samples = {frame['frame']: frame for frame in proof['variants'][variant] if frame['facing'] == 'SE'}
            for index in (0, 1):
                contacts = samples[index]['projected_contacts']
                self.assertAlmostEqual(contacts['hips'][1], -13.82642, places=2)
                for side, expected in (('L', (-4, -17)), ('R', (12, -18))):
                    for actual, target in zip(contacts[side]['grip'], expected):
                        self.assertAlmostEqual(actual, target, places=2)
                targets = {'L': (-5, 8), 'R': (-14, -9)} if index == 0 else {'L': (-14, -9), 'R': (-5, 8)}
                for side, expected in targets.items():
                    for actual, target in zip(contacts[side]['pedal'], expected):
                        self.assertAlmostEqual(actual, target, places=2)


if __name__ == '__main__':
    unittest.main()
