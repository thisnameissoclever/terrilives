import unittest
import json
from pathlib import Path
from PIL import Image
from pack_review import floor_owns_sample
from geometry import (WALL_HEIGHT,WALL_THICKNESS,CUT_HEIGHT,window_span,wall,window_wall,
                      doorway,corner,clip,rotate,project,visible_box_hit)


class ArchitectureGeometry(unittest.TestCase):
    def test_joined_and_arched_plaster_share_both_wall_faces(self):
        from walls import junction
        from windows import model_parts
        from architecture_dimensions import WALL_AND_DOOR_DEPTH
        self.assertEqual(WALL_THICKNESS, WALL_AND_DOOR_DEPTH)
        half = WALL_THICKNESS / 2
        for heights in ((2,0,2,0),(0,2,0,2),(2,1,2,1),(2,2,2,2)):
            parts = junction(heights)
            for across in (-half + .0001, half - .0001):
                for arm, height in enumerate(heights):
                    if not height: continue
                    x,y=((.25,across),(across,.25),(-.25,across),(across,-.25))[arm]
                    hit = visible_box_hit((x,y,3),(0,0,-1),parts)
                    self.assertIsNotNone(hit, (heights,arm,across))
                    self.assertEqual(hit[2], 'Plaster', (heights,arm,across))
                    self.assertAlmostEqual(hit[1][2], CUT_HEIGHT if height == 1 else WALL_HEIGHT)
        infill=[p for p in model_parts(3) if p.name=='Arch infill']
        self.assertTrue(infill)
        self.assertTrue(all(p.y0 == -half and p.y1 == half for p in infill))

    def test_architecture_dimensions(self):
        self.assertEqual(WALL_HEIGHT,2.0)
        self.assertEqual(WALL_THICKNESS,.14)
        for width in (1,2,3):
            self.assertEqual(window_span(width),float(width))
        for invalid in (0,4,True,1.5):
            with self.assertRaises(ValueError): window_span(invalid)

    def test_projection_and_rotation_keep_physical_registration(self):
        self.assertEqual(project((1,0,0)),(32,21))
        self.assertEqual(project((0,1,0)),(-32,21))
        self.assertEqual(project((0,0,2)),(0,-76))
        parts=window_wall(2,'sliding')
        rotated=parts
        for _ in range(4): rotated=rotate(rotated)
        self.assertEqual(parts,rotated)

    def test_cutaway_is_solid_below_plane_without_floating_frames(self):
        for width,model in ((1,'sash'),(2,'sliding'),(3,'picture')):
            parts=clip(window_wall(width,model),CUT_HEIGHT)
            self.assertTrue(parts)
            self.assertTrue(all(p.upper[2] <= CUT_HEIGHT for p in parts))
            self.assertFalse(any(p.name in ('Meeting rail','Overlapping center rail') for p in parts))
            self.assertAlmostEqual(max(p.upper[2] for p in parts),CUT_HEIGHT)

    def test_known_front_back_cap_and_sill_depth_surfaces(self):
        parts=wall(1)
        for origin,direction,expected in (((.2,1,1),(0,-1,0),(.2,.07,1)),
            ((.2,-1,1),(0,1,0),(.2,-.07,1)),((.2,0,3),(0,0,-1),(.2,0,2))):
            hit=visible_box_hit(origin,direction,parts)
            self.assertIsNotNone(hit)
            for actual,wanted in zip(hit[1],expected): self.assertAlmostEqual(actual,wanted)
        hit=visible_box_hit((0,.10,1),(0,0,-1),window_wall(1,'sash'))
        self.assertEqual(hit[2],'Stone sill')
        self.assertAlmostEqual(hit[1][2],.66)

    def test_open_door_and_closed_corner(self):
        self.assertIsNone(visible_box_hit((0,1,1),(0,-1,0),doorway()))
        self.assertIsNotNone(visible_box_hit((.46,1,1),(0,-1,0),doorway()))
        for x,y in ((0,0),(.25,0),(0,.25)):
            self.assertIsNotNone(visible_box_hit((x,y,3),(0,0,-1),corner()))

    def test_floor_coverage_tiles_exactly_without_alpha_seams(self):
        for py in range(-100,100):
            for px in range(-100,100):
                sx=(px+.5)/2; sy=(py+.5)/2
                gx=(sx/32+sy/21)/2; gy=(sy/21-sx/32)/2
                owners=sum(floor_owns_sample(px,py,((x-y)*32,(x+y)*21))
                           for y in range(-2,3) for x in range(-2,3))
                self.assertEqual(owners,int(-2.5<=gx<2.5 and -2.5<=gy<2.5))
        root=Path(__file__).resolve().parents[3]
        directory=root/'docs/assets/review-evidence/architecture/room-01/trial/candidate-08'
        manifest=json.loads((directory/'manifest.json').read_text())
        atlas=Image.open(directory/'color.png').convert('RGBA')
        for entry in manifest['sprites']:
            if not entry['name'].startswith('floor-'): continue
            image=atlas.crop((entry['x'],entry['y'],entry['x']+entry['w'],entry['y']+entry['h']))
            for py in range(image.height):
                for px in range(image.width):
                    if floor_owns_sample(px,py,entry['origin']):
                        self.assertEqual(image.getpixel((px,py))[3],255)
                    # The material apron can be opaque outside the footprint;
                    # the real GPU proof checks authoritative world coverage.


if __name__ == '__main__': unittest.main()
