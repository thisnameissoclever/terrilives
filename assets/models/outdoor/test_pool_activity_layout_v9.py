"""The ladder stands outside an uninterrupted water rectangle."""
import unittest

import pool_activity_layout_v9 as pool


class RectangularPool(unittest.TestCase):
    def test_whole_water_rectangle_has_no_ladder_cutout(self):
        left, right, rear, front = pool.WATER
        vertices, faces = pool.surface(pool.WATER, .82, 3, 5)
        self.assertEqual(len(faces), 15)
        actual_corners = [vertices[i] for i in (0, 3, 23, 20)]
        for actual, expected in zip(actual_corners, pool.corners(pool.WATER, .82)):
            for observed, bound in zip(actual, expected):
                self.assertAlmostEqual(observed, bound)
        self.assertAlmostEqual(right - left, 1.73)
        self.assertAlmostEqual(front - rear, 2.18)

    def test_wall_is_closed_and_ladder_stays_outside_basin(self):
        _, faces, _ = pool.shell(pool.WALL, pool.LINER, 0, .82)
        edges = {}
        for face in faces:
            for a, b in zip(face, face[1:] + face[:1]):
                edge = tuple(sorted((a, b)))
                edges[edge] = edges.get(edge, 0) + 1
        self.assertEqual(set(edges.values()), {2})
        self.assertGreater(min(y for y, _ in pool.flight.LADDER_OUTSIDE_TREADS), pool.WALL[3])
        self.assertLess(max(y for y, _ in pool.flight.LADDER_PATH) + .013, pool.ORIGIN_Y + 1.5)
