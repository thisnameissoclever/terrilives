import unittest
from bob import geometry, lock_geometry


class BobGeometryTests(unittest.TestCase):
    def test_each_lock_faces_outward_independently_of_the_cap(self):
        points, faces = lock_geometry(((0, 0, 2.1), (.1, -.1, 2), (.2, -.1, 1.9), (.24, 0, 1.6)), .06, .02)
        volume = 0
        for face in faces:
            a = points[face[0]]
            for i in range(1, len(face)-1):
                b, c = points[face[i]], points[face[i+1]]
                volume += (a[0]*(b[1]*c[2]-b[2]*c[1]) + a[1]*(b[2]*c[0]-b[0]*c[2]) + a[2]*(b[0]*c[1]-b[1]*c[0]))/6
        self.assertGreater(volume, 0)

    def test_closed_shell_has_outward_winding_and_two_faces_at_every_edge(self):
        vertices, faces = geometry()
        edges = {}
        volume = 0.
        for face in faces:
            for a, b in zip(face, face[1:] + face[:1]):
                key = tuple(sorted((a, b)))
                edges[key] = edges.get(key, 0) + 1
            a = vertices[face[0]]
            for i in range(1, len(face)-1):
                b, c = vertices[face[i]], vertices[face[i+1]]
                volume += (a[0]*(b[1]*c[2]-b[2]*c[1]) + a[1]*(b[2]*c[0]-b[0]*c[2]) + a[2]*(b[0]*c[1]-b[1]*c[0]))/6
        self.assertTrue(edges)
        self.assertEqual(set(edges.values()), {2})
        self.assertGreater(volume, .001, 'Outward shell must have positive signed volume')


if __name__ == '__main__':
    unittest.main()
