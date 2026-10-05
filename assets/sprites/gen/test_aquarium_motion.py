"""Fish animation cannot move the cabinet, glass or other static pixels."""
from pathlib import Path
import unittest
import aquarium_motion
import hashlib
import json
import tempfile
from offline_props import load_props

from PIL import Image
from aquarium_motion import validate_pair


class AquariumMotionTests(unittest.TestCase):
    def test_reviewed_swimming_catalog_and_forged_visibility_reports(self):
        root = Path(__file__).resolve().parents[2]/'models'
        catalog_path = root/'static-props-06.json'
        frames = load_props(catalog_path)[0] + load_props(root/'static-props-05.json')[0]
        aquarium_motion.validate_swimming_catalog(frames, catalog_path)
        for fault, message in (('blocked', 'Lid blocks'), ('duplicate', 'Incomplete fish'),
                               ('model', 'different model'), ('hash', 'scene checks changed')):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                catalog = json.loads(catalog_path.read_text())
                for i, entry in enumerate(catalog['objects']):
                    source = root/entry['directory']
                    target = directory/f'frame-{i}'
                    target.mkdir()
                    entry['directory'] = f'frame-{i}'
                    (target/'proof.json').write_bytes((source/'proof.json').read_bytes())
                    (target/'scene-check.json').write_bytes((source/'scene-check.json').read_bytes())
                check_path = directory/'frame-0/scene-check.json'
                check = json.loads(check_path.read_text())
                if fault in ('blocked','hash'):
                    check['visibility'][0]['lid_blocked_vertices'] = 1
                elif fault == 'duplicate':
                    check['visibility'][0] = check['visibility'][1]
                else:
                    check['model_sha256'] = '0'*64
                check_path.write_text(json.dumps(check))
                if fault != 'hash':
                    catalog['objects'][0]['scene_check_sha256'] = hashlib.sha256(check_path.read_bytes()).hexdigest()
                path = directory/'catalog.json'
                path.write_text(json.dumps(catalog))
                with self.assertRaisesRegex(ValueError, message):
                    aquarium_motion.validate_swimming_catalog(frames, path)

    def test_swim_loop_rejects_frozen_fish_and_static_pixel_changes(self):
        self.assertTrue(hasattr(aquarium_motion, 'validate_swim_loop'),
                        'The aquarium has no complete-loop pixel validation')
        regions = [(10,10,20,20), (25,10,35,20), (40,10,50,20)]
        frames = []
        for sample in range(8):
            image = Image.new('RGBA', (192,240), (80,90,90,255))
            for x in (10,25,40):
                image.putpixel((x+sample,12), (200,100,30,255))
            frames.append(image)
        aquarium_motion.validate_swim_loop(frames, regions)
        with self.assertRaisesRegex(ValueError, 'frozen fish'):
            aquarium_motion.validate_swim_loop([frames[0]]*8, regions)
        broken = frames[-1].copy()
        broken.putpixel((96,190), (90,90,90,255))
        with self.assertRaisesRegex(ValueError, 'outside fish motion'):
            aquarium_motion.validate_swim_loop(frames[:-1]+[broken], regions)
        broken = frames[-1].copy()
        broken.putpixel((11,12), (200,100,30,254))
        with self.assertRaisesRegex(ValueError, 'alpha changes'):
            aquarium_motion.validate_swim_loop(frames[:-1]+[broken], regions)

    def test_reviewed_pairs_and_deliberate_rgb_only_escape(self):
        directory = Path(__file__).resolve().parents[2]/'models/living/owner-review-pending/aquarium/candidate-06'
        for facing in ('SE', 'SW', 'NW', 'NE'):
            frames = []
            for frame in (0, 1):
                with Image.open(directory/f'frame-{frame}'/f'closed-{facing}.png') as image:
                    frames.append(image.resize((192, 240), Image.Resampling.LANCZOS))
            validate_pair(*frames, facing)
            broken = frames[1].copy()
            rgba = broken.getpixel((96, 190))
            broken.putpixel((96, 190), ((rgba[0]+1)%256, *rgba[1:]))
            with self.assertRaisesRegex(ValueError, 'outside fish motion'):
                validate_pair(frames[0], broken, facing)
            with self.assertRaisesRegex(ValueError, 'frozen fish'):
                validate_pair(frames[0], frames[0].copy(), facing)


if __name__ == '__main__':
    unittest.main()
