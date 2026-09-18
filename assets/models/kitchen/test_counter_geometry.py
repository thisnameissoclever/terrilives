"""Constrain real worktop openings rather than a painted dark rectangle."""
from collections import Counter
import unittest

from counter_geometry import worktop_mesh, basin_mesh


def top_hit(mesh, x, y):
    """Independent vertical ray/triangle test over the exported mesh."""
    vertices, faces = mesh
    hits = []
    for face in faces:
        for j in range(1,len(face)-1):
            a,b,c = [vertices[k] for k in (face[0],face[j],face[j+1])]
            det = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(det) < 1e-12:
                continue
            u = ((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det
            v = ((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det
            w = 1-u-v
            if min(u,v,w) >= -1e-9:
                hits.append(u*a[2]+v*b[2]+w*c[2])
    return max(hits) if hits else None


class CounterGeometryTests(unittest.TestCase):
    def test_plain_worktop_supports_the_middle_and_corners(self):
        for point in ((0,0),(.44,.44),(-.44,-.44),(.44,-.44)):
            self.assertAlmostEqual(top_hit(worktop_mesh(False),*point) or 0,.86)

    def test_sink_top_has_a_true_hole_but_retains_a_supporting_border(self):
        model = worktop_mesh(True)
        self.assertIsNone(top_hit(model,0,-.04))
        self.assertIsNone(top_hit(model,.20,.10))
        for point in ((.44,0),(-.44,0),(0,-.44),(0,.44)):
            self.assertAlmostEqual(top_hit(model,*point) or 0,.86)

    def test_worktops_are_closed_solids_without_internal_seams(self):
        for sink in (False,True):
            vertices,faces = worktop_mesh(sink)
            self.assertGreater(len(vertices),12)
            edges = Counter(tuple(sorted((a,b))) for face in faces
                            for a,b in zip(face,face[1:]+face[:1]))
            self.assertEqual(set(edges.values()),{2})

    def test_basin_floor_is_below_the_lip_and_drains_under_the_faucet(self):
        model = basin_mesh()
        self.assertAlmostEqual(top_hit(model,0,-.04) or 0,.63)
        self.assertAlmostEqual(top_hit(model,0,.11) or 0,.63)
        self.assertAlmostEqual(top_hit(model,.33,-.04) or 0,.867)
        wall = top_hit(model,.27,-.04)
        self.assertIsNotNone(wall)
        self.assertGreater(wall,.63)
        self.assertLess(wall,.867)


if __name__ == '__main__':
    unittest.main()
