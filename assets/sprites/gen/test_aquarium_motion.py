"""Fish animation cannot move the cabinet, glass or other static pixels."""
from pathlib import Path
import unittest

from PIL import Image
from aquarium_motion import validate_pair


class AquariumMotionTests(unittest.TestCase):
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
