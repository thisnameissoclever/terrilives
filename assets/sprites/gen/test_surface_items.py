"""Dishes need physical support and enough room before their GPU review."""
import json
import math
from pathlib import Path
import tomllib
import unittest

from surface_items import layouts, load_dishes, project_model, dining_table_places
from objects import table_surface

ROOT = Path(__file__).resolve().parents[3]


class SurfaceItemsTests(unittest.TestCase):
    def test_export_has_all_facings_and_uses_a_thin_normal_sized_plate(self):
        sprites, anchor = load_dishes(ROOT)
        self.assertEqual(len(sprites), 20)
        self.assertGreater(anchor[1], 24)  # The shader's half-tile offset is included.
        proof = json.loads((ROOT / 'assets/models/domestic/export/proof.json').read_text())
        self.assertLessEqual(proof['dirtyDishes']['diameter'], .32)
        for name, image, _, _ in sprites:
            bounds = image.getchannel('A').getbbox()
            self.assertLessEqual((bounds[2]-bounds[0])/2, 18, name)
        plate = sprites[0][1].getchannel('A').point(lambda alpha: 255 if alpha >= 128 else 0).getbbox()
        self.assertLessEqual((plate[3]-plate[1])/2, 11)

    def test_every_table_place_is_supported_with_margin_and_no_plate_overlap(self):
        for facing in ('se', 'nw', 'sw', 'ne'):
            x0,y0,x1,y1,height = table_surface(facing)
            rows = tomllib.loads((ROOT / 'assets/sprites/atlas.toml').read_text())['sprite']
            entries = layouts(ROOT, [(r['name'],None,0,0) for r in rows])
            name = 'table' + ('' if facing == 'se' else facing.upper())
            points = entries[next(i for i,r in enumerate(rows) if r['name']==name)]['points']
            world = []
            for sx,sy in points:
                projected_y = sy+height*38+1
                x,y = (sx/32+projected_y/21)/2,(projected_y/21-sx/32)/2
                self.assertGreaterEqual(x-.15,x0+.05)
                self.assertLessEqual(x+.15,x1-.05)
                self.assertGreaterEqual(y-.15,y0+.05)
                self.assertLessEqual(y+.15,y1-.05)
                world.append((x,y))
            for i,a in enumerate(world):
                for b in world[i+1:]:
                    self.assertGreater(math.dist(a,b),.40)

    def test_counter_height_comes_from_the_export_camera_not_legacy_z_units(self):
        proof = json.loads((ROOT / 'assets/models/kitchen/owner-review-pending/counter/candidate-01/proof.json').read_text())
        point = project_model((0,0,proof['model_checks']['worktop_height']),proof)
        self.assertAlmostEqual(point[0],0,places=4)
        self.assertAlmostEqual(point[1],-29.367,places=2)
        self.assertGreater(abs(point[1]+.86*38),3)

    def test_current_table_places_follow_model_geometry_and_registered_camera(self):
        places = dining_table_places(ROOT)
        proof = json.loads((ROOT / 'assets/models/dining/owner-review-pending/dining-table/candidate-01/proof.json').read_text())
        rows = tomllib.loads((ROOT / 'assets/sprites/atlas.toml').read_text())['sprite']
        entries = layouts(ROOT, [(r['name'],None,0,0) for r in rows])
        for x,y,z in places:
            self.assertLessEqual(abs(x)+.15, .44-.05)
            self.assertLessEqual(abs(y)+.15, .93-.05)
            self.assertEqual(z, proof['model_checks']['top_height'])
        for i,a in enumerate(places):
            for b in places[i+1:]:
                self.assertGreater(math.dist(a,b), .40)
        for facing,degrees in {'SE':90,'NW':270,'SW':0,'NE':180}.items():
            angle=math.radians(degrees)
            name='offlineDiningTable'+('' if facing=='SE' else facing)
            index=next(i for i,r in enumerate(rows) if r['name']==name)
            expected=[project_model((x*math.cos(angle)-y*math.sin(angle),
                                     x*math.sin(angle)+y*math.cos(angle),z),proof)
                      for x,y,z in places]
            self.assertEqual(entries[index]['points'],expected)


if __name__ == '__main__':
    unittest.main()
