import copy
import struct
import unittest
from geometry import project, CUT_HEIGHT
from windows import MODELS, model_parts, window_cases, Prism
from walls import junction, owner_arm
from floors import phase, pattern_rgb
from materials import (catalogue,fixture_catalogue,validate_catalogue,resource_budget,
                       reconstruct,repeat_coordinates,relative_content_look)
from check_scene import validate_case,validate_window_geometry,part_record


class FullArchitectureGeometry(unittest.TestCase):
    def test_nine_models_and_all_physical_views(self):
        self.assertEqual({i:v[1] for i,v in MODELS.items()}, {1:1,2:1,3:1,4:2,5:2,6:2,7:3,8:3,9:3})
        cases=list(window_cases()); self.assertEqual(len(cases),72)
        for case in cases: validate_case(case)
        self.assertTrue(any(isinstance(p,Prism) for p in model_parts(3)))
        self.assertEqual(sum(p.name=='Casement crossbar' for p in model_parts(6)),2)

    def test_detached_sill_and_bars_are_rejected(self):
        clean=[part_record(p) for p in model_parts(1)]
        bad=copy.deepcopy(clean)
        sill=next(p for p in bad if p['name']=='Stone sill')
        sill['lower'][2]+=.1; sill['upper'][2]+=.1
        with self.assertRaisesRegex(AssertionError,'detached sill'): validate_window_geometry(1,bad)
        validate_window_geometry(1,clean)

    def test_mixed_height_union_has_conforming_cut_plane(self):
        for p in junction((0,1,1,2)):
            if p.material=='plaster':
                self.assertFalse(p.lower[2]<CUT_HEIGHT<p.upper[2])
        self.assertEqual(owner_arm(0,0,(2,2,2,2)),0)
        self.assertEqual(owner_arm(-.2,0,(2,2,2,2)),2)

    def test_world_pattern_edges_are_exact_for_axes_corners_and_wide_spans(self):
        for point,origin,neighbor in (((.5,0,1),(0,0,0),(1,0,0)),
                                      ((0,.5,1),(0,0,0),(0,1,0)),
                                      ((1.5,0,1),(0,0,0),(3,0,0)),
                                      ((0,0,1),(0,0,0),(0,0,0))):
            equivalent=tuple(point[i]+origin[i]-neighbor[i] for i in range(3))
            for role in ('wall','floor'):
                self.assertEqual(repeat_coordinates(point,role,origin),repeat_coordinates(equivalent,role,neighbor))
        self.assertEqual(phase(-1,4),(3,0))
        for name in ('boards','tiles','carpet','neutral','grass','street'):
            for y in range(256): self.assertEqual(pattern_rgb(name,0,y),pattern_rgb(name,256,y))

    def test_cropped_coordinates_share_exact_same_quantized_depth(self):
        # One original texel, represented by two different crops, is the same point.
        for depth in (-1.125,.06003,.375,1.49):
            quantized=struct.unpack('<e',struct.pack('<e',depth))[0]
            self.assertEqual(reconstruct(100,60,(80,128),2,quantized),
                             reconstruct(60,20,(60,108),2,quantized))

    def test_extensible_catalogue_and_bounded_residency(self):
        data=fixture_catalogue()
        budget=resource_budget(data,['fixture.0','fixture.1'],2048*2926)
        self.assertEqual(budget['catalogue_finish_count'],1007)
        self.assertEqual(budget['active_pattern_count'],2)
        self.assertEqual(data['coverings'][4],'fixture.1')
        same=resource_budget(fixture_catalogue(10000),['fixture.0','fixture.1'],2048*2926)
        self.assertEqual(same['active_finish_bytes'],budget['active_finish_bytes'])
        with self.assertRaisesRegex(AssertionError,'active pattern budget'):
            resource_budget(data,list(data['finishes']),2048*2926,max_active_patterns=1)
        data['finishes']['fixture.1']['paletteKey']='missing'
        with self.assertRaisesRegex(AssertionError,'unknown palette'): validate_catalogue(data)
        data=fixture_catalogue(); data['finishes']['fixture.1']['patternKey']='missing'
        with self.assertRaisesRegex(AssertionError,'unknown pattern'): validate_catalogue(data)

    def test_authored_content_defaults_are_identity_and_edits_compose(self):
        for finish in catalogue()['finishes'].values():
            authored=finish['authoredContentLook']
            self.assertEqual(relative_content_look(authored,authored),[0,1,0])
            edited=[authored[0]+15,authored[1]*.7,authored[2]+.05]
            actual=relative_content_look(edited,authored)
            self.assertAlmostEqual(actual[0],15); self.assertAlmostEqual(actual[1],.7); self.assertAlmostEqual(actual[2],.05)


if __name__=='__main__': unittest.main()
