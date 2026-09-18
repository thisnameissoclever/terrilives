"""Verify cavity depth without relying on a painted dark oval."""
from collections import Counter
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'kitchen'))
from test_counter_geometry import top_hit
from toilet_geometry import bowl_shell, seat_ring


class ToiletGeometryTests(unittest.TestCase):
    def test_bowl_has_a_recessed_floor_and_closed_outer_shell(self):
        geometry = bowl_shell()
        self.assertAlmostEqual(top_hit(geometry, 0, -.12) or 0, .245)
        self.assertAlmostEqual(top_hit(geometry, .193, -.10) or 0, .415)
        wall = top_hit(geometry, .13, -.12)
        self.assertIsNotNone(wall)
        self.assertGreater(wall, .245)
        self.assertLess(wall, .415)
        _, faces = geometry
        counts = Counter(tuple(sorted((a, b))) for face in faces
                         for a, b in zip(face, face[1:] + face[:1]))
        self.assertEqual(set(counts.values()), {2})

    def test_seat_has_an_open_center_and_sits_on_the_bowl(self):
        geometry = seat_ring()
        self.assertIsNone(top_hit(geometry, 0, -.10))
        self.assertAlmostEqual(top_hit(geometry, .193, -.10) or 0, .45)
        vertices, faces = geometry
        self.assertAlmostEqual(min(point[2] for point in vertices), .419)
        counts = Counter(tuple(sorted((a, b))) for face in faces
                         for a, b in zip(face, face[1:] + face[:1]))
        self.assertEqual(set(counts.values()), {2})


if __name__ == '__main__':
    unittest.main()
