"""Compare published pool geometry with the foot supports used by the swimmer."""
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
POOL = HERE/'owner-review-pending/pool'
CONTACTS = HERE.parent/'sims/character-creator/clips/pool/contacts-v12.json'


def solids(path):
    return {row['id']:row for row in json.loads(path.read_bytes())['solids']}


class PoolSupportGeometryTests(unittest.TestCase):
    def test_lodge_preserves_the_six_treads_and_turning_platform(self):
        baseline = solids(CONTACTS)
        installed = solids(POOL/'lodge/geometry.json')
        names = ['Pool ladder crest landing'] + [f'Pool {side} ladder tread {i}'
                for side in ('inside', 'outside') for i in (1, 2, 3)]
        for name in names:
            with self.subTest(name=name):
                self.assertEqual(installed[name],baseline[name])

    def test_submerged_ladder_uses_translated_swimmer_supports(self):
        baseline = solids(CONTACTS)
        installed = solids(POOL/'in-ground/geometry.json')
        for i in (1,2,3):
            name = f'Pool inside ladder tread {i}'
            original, target = baseline[name], installed[name]
            self.assertEqual(original['triangles'],target['triangles'])
            for source, vertex in zip(original['vertices'],target['vertices'],strict=True):
                for old,new,offset in zip(source,vertex,(.5,3,-1),strict=True):
                    self.assertAlmostEqual(old+offset,new,places=6)

    def test_ladder_reaches_into_the_water_and_mounts_on_dry_stone(self):
        geometry = json.loads((POOL/'in-ground/geometry.json').read_bytes())
        x0,x1,y0,y1 = geometry['water']
        items = {s['id']:s for s in geometry['solids']}
        self.assertLess(geometry['floorHeight'],geometry['waterHeight'])
        self.assertLess(geometry['waterHeight'],0)
        for side,rail in zip(('left','right'),geometry['rails'],strict=True):
            vertices = items[f'Pool {side} interior rail']['vertices']
            for x,y,z in vertices:
                if z <= geometry['waterHeight']:
                    self.assertTrue(x0<x<x1 and y0<y<y1)
            for i in (1,2,3):
                low,high = items[f'Pool inside ladder tread {i}']['bounds']
                x,y,z = next(p for p in rail['points'] if abs(p[2]-high[2]) < 1e-6)
                self.assertLessEqual(low[1],y)
                self.assertLessEqual(y,high[1])
                mount_low,mount_high = items[f'Pool {side} tread {i} mount']['bounds']
                self.assertLessEqual(mount_low[0]-1e-6,x)
                self.assertGreaterEqual(mount_high[0]+1e-6,x)
                self.assertLess(mount_high[2],high[2])
                self.assertGreaterEqual(mount_high[0],low[0])
                self.assertLessEqual(mount_low[0],high[0])
            socket = items[f'Pool {side} deck socket']['bounds']
            self.assertGreater(socket[0][1],y1)
            self.assertLess(socket[1][1],geometry['apron'][3])
