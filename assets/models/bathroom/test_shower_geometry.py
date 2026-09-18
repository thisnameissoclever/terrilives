"""Tray geometry checks independent of Blender's renderer."""
from collections import Counter
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'kitchen'))
from test_counter_geometry import top_hit
from shower_geometry import tray_shell


class ShowerGeometryTests(unittest.TestCase):
    def test_tray_has_a_recessed_floor_and_closed_rim(self):
        tray = tray_shell()
        self.assertAlmostEqual(top_hit(tray, 0, 0) or 0, .055)
        for x, y in ((.43, 0), (-.43, 0), (0, .43), (0, -.43)):
            self.assertAlmostEqual(top_hit(tray, x, y) or 0, .135)
        vertices, faces = tray
        self.assertAlmostEqual(min(point[2] for point in vertices), 0)
        counts = Counter(tuple(sorted((a, b))) for face in faces
                         for a, b in zip(face, face[1:] + face[:1]))
        self.assertEqual(set(counts.values()), {2})


if __name__ == '__main__':
    unittest.main()
