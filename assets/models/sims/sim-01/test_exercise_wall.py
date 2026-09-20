"""Check current boundary clearance and the historical bike envelope separately."""
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
import export_exercise


class ExerciseWallTests(unittest.TestCase):
    @staticmethod
    def historical_upper_wall_overlap(draw_bike):
        body, draw = canvas()
        draw_bike(draw, 'se')
        wall, draw = canvas()
        objects.wallNS(draw)
        placed = Image.new('RGBA', body.size)
        placed.alpha_composite(wall, (32, 21))
        overlap = ImageChops.multiply(body.getchannel('A'), placed.getchannel('A'))
        return body, overlap.crop((0, 0, body.width, OY - 9)).getbbox()

    def test_proxy_projects_current_boundary_vertices_not_old_wall_cells(self):
        lot = tomllib.loads((ROOT / 'content/lot.toml').read_text())
        self.assertEqual(export_exercise.bike_wall_panels(lot), [
            ('wallHalf4', 5.5, 9.5),
            ('wallNS', 5.5, 10.5),
            ('wallHalf1', 5.5, 11.5),
        ])
        # Independent worked projection from bike (4,11), at 32x21 px per axis.
        self.assertEqual([
            (name, dx, dy) for name, dx, dy in export_exercise.bike_wall_offsets(lot)
        ], [('wallHalf4', 96, 0), ('wallNS', 64, 21), ('wallHalf1', 32, 42)])

    def test_upper_assembly_clears_current_boundary_wall(self):
        lot = tomllib.loads((ROOT / 'content/lot.toml').read_text())
        body, draw = canvas()
        objects._bike(draw, 'se')
        wall = Image.new('RGBA', body.size)
        export_exercise.draw_bike_wall(wall, (OX, OY), lot)
        # Registered native raster at origin (200,200), including the +21 anchor.
        self.assertEqual(wall.getbbox(), (232, 123, 297, 242))
        overlap = ImageChops.multiply(body.getchannel('A'), wall.getchannel('A'))
        self.assertIsNone(overlap.crop((0, 0, body.width, OY - 9)).getbbox())

    def test_historical_upper_assembly_keeps_original_forward_envelope(self):
        body, overlap = self.historical_upper_wall_overlap(objects._bike)
        self.assertIsNone(overlap,
                          'Bar or console overlaps the historical wall at (5,11)')
        bounds = body.getchannel('A').crop((0, 0, body.width, OY - 9)).getbbox()
        self.assertLessEqual(bounds[2], OX + 16, 'Upper bike assembly exceeds original forward envelope')

    def test_historical_wall_gate_rejects_previous_forward_translation(self):
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
        _, overlap = self.historical_upper_wall_overlap(namespace['_bike'])
        self.assertEqual(overlap, (216, 158, 232, 178),
                         'The wall gate must catch the previously rejected assembly')


if __name__ == '__main__':
    unittest.main()
