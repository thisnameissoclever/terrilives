"""Causal topology contract for the real recessed pool wall source."""
from collections import Counter
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
import pool_activity_layout_v4 as layout


class CompactWallTests(unittest.TestCase):
    def test_wall_has_no_open_or_edge_only_volume_joins(self):
        vertices,faces,materials=layout.recessed_wall_geometry()
        self.assertGreater(len(faces),0)
        self.assertEqual(len(faces),len(materials))
        edges=Counter(tuple(sorted((a,b))) for face in faces for a,b in zip(face,face[1:]+face[:1]))
        bad=[(vertices[a],vertices[b],count) for (a,b),count in edges.items() if count!=2]
        self.assertEqual(bad,[])

    def test_liner_continues_behind_each_real_toe_recess(self):
        vertices,faces,materials=layout.recessed_wall_geometry()
        for height in [.30,.55,.80]:
            faces_at=[]
            for face,material in zip(faces,materials):
                points=[vertices[index] for index in face]
                if len({p[1] for p in points})!=1:continue
                if min(p[0] for p in points)<-.5<max(p[0] for p in points) and min(p[2] for p in points)<height<max(p[2] for p in points):
                    if points[0][1]>.7:faces_at.append((points[0][1],material))
            self.assertEqual(sorted(faces_at),[(layout.BACKING_INNER_Y,1),(layout.TOE_RECESS_BACK_Y,0)])


if __name__=='__main__':unittest.main()
