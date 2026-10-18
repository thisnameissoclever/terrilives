"""Layout checks for the pool, pool lounger and patio umbrella (no Blender)."""
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lounger_layout as lounger
import pool_layout as pool
import umbrella_layout as umbrella


class PoolLayout(unittest.TestCase):
    def test_footprint_and_rim(self):
        self.assertEqual(pool.FOOTPRINT, (2, 2))
        self.assertAlmostEqual(2*pool.COPING_HALF, 1.92)
        self.assertGreater(pool.COPING_HALF, pool.WALL_HALF)
        self.assertGreater(pool.WALL_HALF, pool.WALL_INNER_HALF)

    def test_everything_stays_on_the_two_by_two_tiles(self):
        half_x, half_y, top = pool.outer_bounds()
        self.assertLessEqual(half_x, pool.FOOTPRINT[0]/2)
        self.assertLessEqual(half_y, pool.FOOTPRINT[1]/2)
        self.assertLess(top, .6)

    def test_rim_height(self):
        self.assertGreaterEqual(pool.COPING_TOP, .30)
        self.assertLessEqual(pool.COPING_TOP, .35)

    def test_water_sits_a_little_below_the_coping(self):
        self.assertLess(pool.WATER_Z, pool.COPING_BOTTOM)
        self.assertLessEqual(pool.COPING_TOP-pool.WATER_Z, .10)
        # The water edge tucks under the coping, never past the wall.
        self.assertGreater(pool.WATER_HALF, pool.COPING_INNER_HALF)
        self.assertLess(pool.WATER_HALF, pool.WALL_HALF)

    def test_water_grid_is_flat_and_has_ripples(self):
        vertices, faces, ripples = pool.water_grid()
        self.assertEqual({z for *_, z in vertices}, {pool.WATER_Z})
        self.assertEqual(len(faces), len(ripples))
        self.assertTrue(0 < sum(ripples) < len(ripples)//20)

    def test_ladder_hooks_over_the_coping(self):
        top = max(z for _, z in pool.LADDER_PATH)
        self.assertGreater(top-pool.LADDER_RAIL_RADIUS, pool.COPING_TOP)
        inside_y, inside_z = pool.LADDER_PATH[0]
        outside_y = pool.LADDER_PATH[-1][0]
        self.assertLess(inside_y, pool.COPING_INNER_HALF)
        self.assertLess(inside_z, pool.WATER_Z)
        self.assertGreater(outside_y-pool.LADDER_RAIL_RADIUS, pool.COPING_HALF)


class LoungerLayout(unittest.TestCase):
    def test_footprint_matches_the_bathtub_orientation(self):
        self.assertEqual(lounger.FOOTPRINT, (1, 2))
        self.assertGreater(lounger.LENGTH, lounger.WIDTH)

    def test_outer_bounds_within_tiles(self):
        half_x, half_y, top = lounger.outer_bounds()
        self.assertAlmostEqual(2*half_x, .62)
        self.assertAlmostEqual(2*half_y, 1.80)
        self.assertLessEqual(half_x, lounger.FOOTPRINT[0]/2)
        self.assertLessEqual(half_y, lounger.FOOTPRINT[1]/2)
        self.assertLessEqual(lounger.back_far_y(), lounger.HALF_L)

    def test_cushion_height_suits_the_chair_pose(self):
        self.assertAlmostEqual(lounger.CUSHION_TOP, .42)
        self.assertAlmostEqual(lounger.BOARD_TOP+lounger.CUSHION_T, .42)
        self.assertGreater(lounger.CUSHION_T, .05)

    def test_backrest_angle_and_height(self):
        self.assertEqual(lounger.BACK_ANGLE, 40)
        self.assertAlmostEqual(lounger.back_top(), .80, delta=.02)
        self.assertGreater(lounger.HINGE_Y, 0)

    def test_prop_meets_the_back_board(self):
        y, z = lounger.back_point(lounger.PROP_ALONG, 0)
        self.assertLess(y, lounger.PROP_FOOT_Y)
        self.assertGreater(z, lounger.RAIL_TOP)
        rail_inner = lounger.HALF_W-lounger.RAIL_W
        for x in lounger.PROP_X:
            self.assertTrue(rail_inner <= abs(x) <= lounger.HALF_W)

    def test_legs_sit_under_the_frame(self):
        for x, y in lounger.leg_centers():
            self.assertLessEqual(abs(x)+lounger.LEG/2, lounger.HALF_W)
            self.assertLessEqual(abs(y)+lounger.LEG/2, lounger.HALF_L)


class UmbrellaLayout(unittest.TestCase):
    def test_footprint_and_base(self):
        self.assertEqual(umbrella.FOOTPRINT, (1, 1))
        self.assertAlmostEqual(2*umbrella.BASE_RADIUS, .40)
        self.assertLessEqual(umbrella.BASE_RADIUS, umbrella.FOOTPRINT[0]/2)

    def test_canopy_width_and_height(self):
        width, low, high = umbrella.canopy_extent()
        self.assertGreaterEqual(width, 1.5)
        self.assertLessEqual(width, 1.6)
        self.assertAlmostEqual(low, 1.90, delta=.005)
        self.assertLess(high, umbrella.FINIAL_TOP)
        self.assertAlmostEqual(umbrella.FINIAL_TOP, 2.25)

    def test_canopy_is_octagonal_and_closed(self):
        vertices, faces, panels = umbrella.canopy_geometry()
        self.assertEqual(umbrella.SIDES, 8)
        self.assertEqual(set(panels), set(range(8)))
        tips = [umbrella.canopy_point(1, k*umbrella.COLUMNS_PER_PANEL)
                for k in range(8)]
        for x, y, _ in tips:
            self.assertAlmostEqual(math.hypot(x, y), umbrella.CANOPY_RADIUS)

    def test_finial_covers_the_apex_hole(self):
        self.assertGreater(umbrella.FINIAL_RADIUS, umbrella.APEX_RING)
        self.assertLess(umbrella.FINIAL_BASE, umbrella.APEX_Z)


if __name__ == '__main__':
    unittest.main()
