"""Leaves keep distinct tips and share their roots with supported branches."""
import math
import unittest

from plant_layout import leaf_point, leaves, pot_geometry, soil_geometry


class PlantLayoutTests(unittest.TestCase):
    def test_soil_reaches_floor_without_piercing_outer_walls(self):
        vertices, _ = soil_geometry()
        self.assertLess(min(v[2] for v in vertices), .055)
        self.assertLess(max(v[2] for v in vertices), .305)
        for x, y, z in vertices:
            outside_half_width = .135 + (.18-.135)*min(z/.285, 1)
            self.assertLess(max(abs(x), abs(y)), outside_half_width)

    def test_leaf_roots_and_tips_are_single_points(self):
        for leaf in leaves():
            for t in (0, 1):
                points = [leaf_point(leaf, t, u) for u in (-1, 0, 1)]
                for point in points:
                    self.assertLess(math.dist(point, points[0]), 1e-12)
            self.assertEqual(leaf_point(leaf, 0, 0), leaf['root'])
            for row in range(41):
                for column in range(9):
                    x, y, z = leaf_point(leaf, row/40, column/4-1)
                    self.assertLess(math.hypot(x, y), .36)
                    self.assertGreaterEqual(z, .38)
                    self.assertLessEqual(z, .96)

    def test_planter_has_an_open_cavity_and_closed_floor(self):
        vertices, faces = pot_geometry()
        edges = {}
        for face in faces:
            self.assertEqual(len(set(face)), len(face))
            for a, b in zip(face, face[1:]+face[:1]):
                pair = tuple(sorted((a, b)))
                edges[pair] = edges.get(pair, 0)+1
        self.assertTrue(all(count == 2 for count in edges.values()))
        self.assertEqual(min(v[2] for v in vertices), 0)
        self.assertEqual(max(v[2] for v in vertices), .305)
        # The top is a rim, never a lid across the opening.
        for face in faces:
            if all(vertices[i][2] == .305 for i in face):
                self.assertLessEqual(len(face), 4)
                self.assertGreater(min(math.hypot(*vertices[i][:2]) for i in face), .22)


if __name__ == '__main__':
    unittest.main()
