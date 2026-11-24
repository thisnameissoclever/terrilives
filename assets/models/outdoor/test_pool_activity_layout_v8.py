"""Physical dimensions of the inward-facing pool ladder and its dry opening."""
import unittest
import pool_activity_layout_v4 as body
import pool_activity_layout_v8 as bay


class DryLadderBay(unittest.TestCase):
    def test_landing_and_incline_fit_one_square_pool(self):
        self.assertAlmostEqual(bay.CREST_LANDING_DEPTH,.48)
        self.assertAlmostEqual(bay.LADDER_RAIL_X[1]-bay.LADDER_RAIL_X[0]-2*body.LADDER_RAIL_RADIUS,.654)
        noses=[y+body.OUTSIDE_RUNG_DEPTH/2 for y,_ in reversed(bay.LADDER_OUTSIDE_TREADS)]
        for actual,expected in zip(noses,[.60,.75,.90]):self.assertAlmostEqual(actual,expected)
        self.assertLess(max(y for y,_ in bay.LADDER_PATH)+body.LADDER_RAIL_RADIUS,1)

    def test_wall_closes_and_wet_area_follows_inner_liner(self):
        vertices,faces,materials=bay.recessed_wall_geometry()
        self.assertEqual(len(faces),len(materials))
        self.assertTrue(all(max(abs(x),abs(y))<=1 for x,y,_ in vertices))
        edges={}
        for face in faces:
            for a,b in zip(face,face[1:]+face[:1]):
                edge=tuple(sorted((a,b)));edges[edge]=edges.get(edge,0)+1
        self.assertEqual(set(edges.values()),{2})
        wet,_,centres=bay.surface(bay.WATER,body.WATER_Z,8)
        self.assertTrue(wet)
        self.assertTrue(all(bay.contains(bay.WATER,*c) for c in centres))
        for outline in [bay.WET,bay.WATER]:
            self.assertFalse(bay.contains(outline,-.5,.60))
            self.assertTrue(bay.contains(outline,.25,.60))
            self.assertTrue(bay.contains(outline,-.5,0))


if __name__=='__main__':
    unittest.main()
