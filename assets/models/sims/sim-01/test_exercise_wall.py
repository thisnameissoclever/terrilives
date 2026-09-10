"""Keep the bike's upper assembly clear of its real neighboring divider tile."""
from pathlib import Path
import inspect
import sys
import tomllib
import unittest

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / 'assets/sprites/gen'))
import objects
from iso import OX, OY, canvas


class ExerciseWallTests(unittest.TestCase):
    @staticmethod
    def upper_wall_overlap(draw_bike):
        body, draw = canvas()
        draw_bike(draw, 'se')
        wall, draw = canvas()
        objects.wallNS(draw)
        placed = Image.new('RGBA', body.size)
        placed.alpha_composite(wall, (32, 21))
        overlap = ImageChops.multiply(body.getchannel('A'), placed.getchannel('A'))
        return body, overlap.crop((0, 0, body.width, OY - 9)).getbbox()

    def test_upper_assembly_does_not_enter_neighboring_wall(self):
        lot = tomllib.loads((ROOT / 'content/lot.toml').read_text())
        bike = next(row for row in lot['place'] if row['object'] == 'moving_box')
        self.assertEqual((bike['x'], bike['y']), (4, 11))
        self.assertIn({'x': 5, 'y': 11}, lot['wall'])
        body, overlap = self.upper_wall_overlap(objects._bike)
        self.assertIsNone(overlap,
                          'Bar or console overlaps the actual wall at (5,11)')
        bounds = body.getchannel('A').crop((0, 0, body.width, OY - 9)).getbbox()
        self.assertLessEqual(bounds[2], OX + 16, 'Upper bike assembly exceeds original forward envelope')

    def test_wall_gate_rejects_previous_forward_translation(self):
        source = inspect.getsource(objects._bike)
        previous_points = {
            'pt(3, -32)': 'pt(21, -48)', 'pt(12, -39)': 'pt(30, -55)',
            'pt(-4, -38)': 'pt(14, -54)', 'pt(-8, -47)': 'pt(10, -63)',
            'pt(5, -35)': 'pt(23, -51)', 'pt(-5, -44)': 'pt(13, -60)',
            'pt(2, -38)': 'pt(20, -54)',
        }
        for current, previous in previous_points.items():
            self.assertIn(current, source)
            source = source.replace(current, previous)
        namespace = dict(vars(objects))
        exec(compile(source, '<previous-bike-wall-mutation>', 'exec'), namespace)
        _, overlap = self.upper_wall_overlap(namespace['_bike'])
        self.assertEqual(overlap, (216, 158, 232, 178),
                         'The wall gate must catch the previously rejected assembly')


if __name__ == '__main__':
    unittest.main()
