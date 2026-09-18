"""Test the visible basin cavity independently of Blender shading."""
from pathlib import Path
from collections import Counter
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'kitchen'))
from test_counter_geometry import top_hit
from basin_geometry import ceramic_basin


class BasinGeometryTests(unittest.TestCase):
    def test_ceramic_bowl_has_recessed_floor_and_supported_faucet_deck(self):
        bowl = ceramic_basin()
        self.assertAlmostEqual(top_hit(bowl,0,-.055) or 0,.655)
        self.assertAlmostEqual(top_hit(bowl,0,.23) or 0,.82)
        self.assertAlmostEqual(top_hit(bowl,.32,0) or 0,.82)
        wall = top_hit(bowl,.245,-.055)
        self.assertIsNotNone(wall)
        self.assertGreater(wall,.655)
        self.assertLess(wall,.82)

    def test_bowl_is_a_closed_shell_and_a_missing_floor_is_detectable(self):
        vertices,faces = ceramic_basin()
        self.assertGreater(len(vertices),20)
        def edge_counts(polygons):
            return Counter(tuple(sorted((a,b))) for face in polygons
                           for a,b in zip(face,face[1:]+face[:1]))
        self.assertEqual(set(edge_counts(faces).values()),{2})
        self.assertIn(1,edge_counts(faces[:-1]).values())


if __name__ == '__main__':
    unittest.main()
