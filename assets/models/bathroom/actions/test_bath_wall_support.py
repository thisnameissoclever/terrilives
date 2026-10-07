"""Wall geometry, not an angle sweep, determines the coherent torso frame."""
import math
import unittest

from bath_wall_support import derive_head_end_plane, solve_translation


class BathWallSupportTests(unittest.TestCase):
    def test_actual_head_end_facets_determine_wall_pitch(self):
        vertices = [[-.09,-.70,.15],[.09,-.70,.15],[-.185,-.83,.57],[.185,-.83,.57]]
        result = derive_head_end_plane(vertices,[(0,1,3),(0,3,2)])
        self.assertAlmostEqual(result['pitch_degrees'],math.degrees(math.atan2(.13,.42)),places=6)
        self.assertGreater(result['normal'][1],.9)
        self.assertGreater(result['normal'][2],.2)
        self.assertEqual(len(result['actual_triangle_ids']),2)
        with self.assertRaises(ValueError):
            derive_head_end_plane(vertices,[(0,3,1),(0,2,3)])

    def test_one_translation_satisfies_hip_floor_and_back_wall_constraints(self):
        vertices = [[-.09,-.70,.15],[.09,-.70,.15],[-.185,-.83,.57],[.185,-.83,.57]]
        plane = derive_head_end_plane(vertices,[(0,1,3),(0,3,2)])
        hips = [[0,.10,.77],[.1,.08,.8],[-.1,.08,.8]]
        back = [[-.05,.14,1.15],[.05,.14,1.15],[0,.14,1.25]]
        candidate = solve_translation(hips,back,plane)
        self.assertAlmostEqual(candidate['predicted_hip_min_z'],.151,places=10)
        self.assertAlmostEqual(candidate['predicted_back_min_plane_gap'],.001,places=10)
        self.assertEqual(candidate['hip_angle'],candidate['back_angle'])
        self.assertGreater(candidate['face_direction'][2],0)


if __name__ == '__main__':
    unittest.main()
