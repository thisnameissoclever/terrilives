"""Check the door rim's opening and closed mesh independently of Blender."""
from collections import Counter
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'kitchen'))
from test_counter_geometry import top_hit
from laundry_geometry import door_ring


class LaundryGeometryTests(unittest.TestCase):
    def test_door_rim_has_an_open_center_and_solid_annulus(self):
        geometry = door_ring()
        self.assertIsNone(top_hit(geometry, 0, 0))
        self.assertAlmostEqual(top_hit(geometry, .215, 0) or 0, .035)
        self.assertIsNone(top_hit(geometry, .26, 0))
        vertices, faces = geometry
        self.assertAlmostEqual(min(point[2] for point in vertices), 0)
        edges = Counter(tuple(sorted((a, b))) for face in faces
                        for a, b in zip(face, face[1:] + face[:1]))
        self.assertEqual(set(edges.values()), {2})


if __name__ == '__main__':
    unittest.main()
