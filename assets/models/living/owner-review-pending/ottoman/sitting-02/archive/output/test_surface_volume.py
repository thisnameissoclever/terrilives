"""Containment must follow a closed surface, not its box or nearest face."""
import unittest

from surface_volume import ClosedSurface, unexpected_triangle_contact, cap_planar_loop


def prism(polygon, bottom=0, top=1):
    count = len(polygon)
    points = [(x, y, z) for z in (bottom, top) for x, y in polygon]
    if count == 6:
        cap = [(0, 1, 3), (1, 2, 3), (0, 3, 5), (3, 4, 5)]
    else:
        cap = [(0, 1, 2), (0, 2, 3)]
    triangles = [(c, b, a) for a, b, c in cap]
    triangles += [(a+count, b+count, c+count) for a, b, c in cap]
    for index in range(count):
        other = (index+1) % count
        triangles += [(index, other, other+count), (index, other+count, index+count)]
    return points, triangles


class SurfaceVolumeTests(unittest.TestCase):
    def test_only_the_named_original_neck_loop_can_be_capped_for_analysis(self):
        points, triangles = prism([(0, 0), (1, 0), (1, 1), (0, 1)])
        open_faces = triangles[:2]+triangles[4:]
        expected = {(4, 5), (5, 6), (6, 7), (4, 7)}
        capped_points, capped_faces = cap_planar_loop(points, open_faces, expected)
        self.assertEqual(capped_points[:len(points)], points)
        self.assertEqual(capped_faces[:len(open_faces)], open_faces)
        self.assertTrue(ClosedSurface(capped_points, capped_faces).contains((.5, .5, .5)))
        with self.assertRaisesRegex(ValueError, 'boundary'):
            cap_planar_loop(points, open_faces[2:], expected)

    def test_warped_or_crossed_neck_loop_is_not_auto_closed(self):
        points, triangles = prism([(0, 0), (1, 0), (1, 1), (0, 1)])
        faces = triangles[:2]+triangles[4:]
        expected = {(4, 5), (5, 6), (6, 7), (4, 7)}
        warped = list(points)
        warped[4] = (0, 0, 1.1)
        with self.assertRaisesRegex(ValueError, 'planar'):
            cap_planar_loop(warped, faces, expected)
        crossed = list(points)
        crossed[5], crossed[6] = crossed[6], crossed[5]
        with self.assertRaises(ValueError):
            cap_planar_loop(crossed, faces, expected)

    def test_shared_edge_is_allowed_but_an_actual_crossing_is_not(self):
        points = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0),
                  (.5, .5, -1), (.5, .5, 1), (1.5, .5, 0)]
        self.assertFalse(unexpected_triangle_contact(points, (0, 1, 2), (0, 2, 3)))
        self.assertTrue(unexpected_triangle_contact(points, (0, 1, 2), (4, 5, 6)))

    def test_concave_surface_excludes_notch_inside_its_bounding_box(self):
        shape = ClosedSurface(*prism([(0, 0), (2, 0), (2, 1), (1, 1), (1, 2), (0, 2)]))
        self.assertFalse(shape.contains((1.5, 1.5, .5)))
        self.assertTrue(shape.contains((.5, 1.5, .5)))
        self.assertTrue(shape.contains((1.5, .5, .5)))

    def test_open_and_inconsistently_oriented_meshes_are_not_volumes(self):
        points, triangles = prism([(0, 0), (1, 0), (1, 1), (0, 1)])
        with self.assertRaisesRegex(ValueError, 'closed'):
            ClosedSurface(points, triangles[:-1])
        reversed_face = [tuple(reversed(triangles[0])), *triangles[1:]]
        with self.assertRaisesRegex(ValueError, 'oriented'):
            ClosedSurface(points, reversed_face)

    def test_boundary_points_are_not_silently_inside_or_outside(self):
        shape = ClosedSurface(*prism([(0, 0), (1, 0), (1, 1), (0, 1)]))
        for point in ((0, 0, 0), (.5, .5, 0), (0, .5, .5)):
            with self.subTest(point=point), self.assertRaisesRegex(ValueError, 'boundary'):
                shape.contains(point)

    def test_every_disconnected_component_is_checked_for_containment(self):
        outside, outer_faces = prism([(3, 3), (4, 3), (4, 4), (3, 4)])
        inside, inner_faces = prism([(.2, .2), (.3, .2), (.3, .3), (.2, .3)], .2, .3)
        combined = ClosedSurface(outside+inside, outer_faces+[
            tuple(i+len(outside) for i in face) for face in inner_faces])
        container = ClosedSurface(*prism([(0, 0), (1, 0), (1, 1), (0, 1)]))
        self.assertEqual(combined.enclosed_components(container), [1])
        self.assertEqual(container.enclosed_components(combined), [])

    def test_globally_reversing_winding_preserves_volume_occupancy(self):
        points, triangles = prism([(0, 0), (1, 0), (1, 1), (0, 1)])
        reversed_shell = ClosedSurface(points, [tuple(reversed(t)) for t in triangles])
        self.assertTrue(reversed_shell.contains((.5, .5, .5)))
        self.assertFalse(reversed_shell.contains((2, .5, .5)))

    def test_coplanar_overlap_beyond_a_shared_vertex_is_not_adjacency(self):
        points = [(0, 0, 0), (2, 0, 0), (0, 2, 0),
                  (1, .2, 0), (.2, 1, 0), (-1, -1, 0), (-2, -1, 0)]
        self.assertTrue(unexpected_triangle_contact(points, (0, 1, 2), (0, 3, 4)))
        self.assertFalse(unexpected_triangle_contact(points, (0, 1, 2), (0, 5, 6)))

    def test_thin_crossing_triangles_need_not_have_an_enclosed_vertex(self):
        points = [(-2, -1, 0), (2, -1, 0), (0, 2, 0),
                  (0, -2, -1), (0, 2, -1), (0, 0, 2)]
        self.assertTrue(unexpected_triangle_contact(points, (0, 1, 2), (3, 4, 5)))

    def test_self_intersecting_components_are_rejected(self):
        first, a = prism([(0, 0), (1, 0), (1, 1), (0, 1)])
        second, b = prism([(.5, .5), (1.5, .5), (1.5, 1.5), (.5, 1.5)], .5, 1.5)
        shape = ClosedSurface(first+second, a+[tuple(i+len(first) for i in t) for t in b])
        with self.assertRaisesRegex(ValueError, 'Self-intersecting'):
            shape.validate_self_intersections((i, j) for i in range(len(shape.triangles))
                                              for j in range(i+1, len(shape.triangles)))


if __name__ == '__main__':
    unittest.main()
