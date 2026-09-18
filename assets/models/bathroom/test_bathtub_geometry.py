"""Probe the tub cavity, closed shell and authored two-tile placement."""
from collections import Counter
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'kitchen'))
from test_counter_geometry import top_hit
from bathtub_geometry import ceramic_tub


class BathtubGeometryTests(unittest.TestCase):
    def test_tub_has_a_recessed_floor_and_solid_faucet_deck(self):
        tub = ceramic_tub()
        self.assertAlmostEqual(top_hit(tub,0,0),.15)
        self.assertAlmostEqual(top_hit(tub,0,.84),.57)
        self.assertAlmostEqual(top_hit(tub,.38,0),.57)
        slope = top_hit(tub,.29,0)
        self.assertGreater(slope,.15)
        self.assertLess(slope,.57)

    def test_shell_is_closed_and_fits_the_two_authored_tiles_after_se_rotation(self):
        vertices,faces = ceramic_tub()
        edges = Counter(tuple(sorted((a,b))) for face in faces
                        for a,b in zip(face,face[1:]+face[:1]))
        self.assertEqual(set(edges.values()),{2})
        # RenderBuffer centers a 2x1 object's row half a tile after its origin.
        game_x = [.5-y for x,y,z in vertices]
        game_y = [-x for x,y,z in vertices]
        self.assertAlmostEqual(min(game_x),-.42)
        self.assertAlmostEqual(max(game_x),1.42)
        self.assertAlmostEqual(min(game_y),-.41)
        self.assertAlmostEqual(max(game_y),.41)


if __name__ == '__main__':
    unittest.main()
