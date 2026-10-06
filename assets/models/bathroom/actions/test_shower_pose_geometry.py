"""Rounded tray containment and length-preserving limb planning."""
import math
import unittest

from shower_convex import certify_convex, enclosing_prism

from shower_pose_geometry import (OMITTED_GARMENT_DETAILS, SHOWER_RENDERED_BODY, STEAM_SHAPES,
                                 on_floor, two_link, validate_footprint,
                                 validate_shower_inventory, spray_angle)


class ShowerGeometryTests(unittest.TestCase):
    def test_convex_core_encloses_complete_triangles_with_positive_margin(self):
        points = [(-.12, -.20, .074148), (.23, -.16, .074148),
                  (.2, .1, .14), (-.18, .04, .95), (.19, -.25, .96)]
        floor_planes = [dict(normal=n, offset=.375) for n in
                        ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0))]
        vertices, triangles, proposal = enclosing_prism(points, floor_planes, .055)
        self.assertLess(proposal['bottom_z'], min(p[2] for p in points))
        self.assertGreater(proposal['bottom_z'], .055)
        result = certify_convex(vertices, triangles, points, proposal['required_margin'])
        self.assertTrue(result['closed'])
        self.assertTrue(result['outward_planes'])
        self.assertGreater(result['min_containment_margin'], 0)
        with self.assertRaisesRegex(ValueError, 'closed'):
            certify_convex(vertices, triangles[1:], points, proposal['required_margin'])
        gap = [list(v) for v in vertices]
        gap[0][0] += .5
        with self.assertRaises(ValueError):
            certify_convex(gap, triangles, points, proposal['required_margin'])
        shrunken = [tuple(v*.6 for v in point) for point in vertices]
        with self.assertRaisesRegex(ValueError, 'containment'):
            certify_convex(shrunken, triangles, points, proposal['required_margin'])

    def test_convex_core_rejects_impossible_floor_envelope(self):
        planes = [dict(normal=n, offset=.375) for n in
                  ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0))]
        for points in ([(.4, 0, .1), (0, 0, .9), (0, .1, .3)],
                       [(0, 0, .05), (.1, .1, .9), (-.1, .1, .3)]):
            with self.assertRaises(ValueError):
                enclosing_prism(points, planes, .055)

    def test_front_left_lobe_covers_retained_se_gap_witnesses(self):
        center, radii = STEAM_SHAPES[1]
        local_witnesses = ((-.164348, -.183804, .486859),
                           (-.147155, -.182315, .444372),
                           (-.165724, -.191163, .526769),
                           (-.128866, -.212219, .524182))
        for point in local_witnesses:
            self.assertLess(sum(((v-c)/r)**2 for v, c, r in zip(point, center, radii)), 1)
        self.assertEqual(center[:2], (-.105, -.06))
        self.assertEqual(radii[:2], (.235, .24))

    def test_lobe_lower_edge_intersects_retained_sole_view_rays(self):
        center, radii = STEAM_SHAPES[1]
        direction = (-.5335428715, -.5335429311, .6562499404)
        for point in ((-.1265101582, -.14928253, .0830687061),
                      (-.1207068563, -.1507144421, .0830687284),
                      (-.1261279881, -.1464585215, .0794212297),
                      (-.1204412207, -.1478016675, .0794196278),
                      (-.1147162989, -.1487112641, .0794212297)):
            relative = [(p-c)/r for p, c, r in zip(point, center, radii)]
            axis = [d/r for d, r in zip(direction, radii)]
            a = sum(v*v for v in axis)
            b = 2*sum(p*d for p, d in zip(relative, axis))
            c = sum(v*v for v in relative)-1
            discriminant = b*b-4*a*c
            self.assertGreater(discriminant, 0)
            self.assertGreater((-b+math.sqrt(discriminant))/(2*a), 0)

    def test_explicit_shower_inventory_preserves_both_upper_arms(self):
        original = SHOWER_RENDERED_BODY | OMITTED_GARMENT_DETAILS
        self.assertEqual(len(original), 54)
        self.assertEqual(len(SHOWER_RENDERED_BODY), 41)
        self.assertEqual(len(OMITTED_GARMENT_DETAILS), 13)
        validate_shower_inventory(original, SHOWER_RENDERED_BODY)
        for name in ('Relaxed shirt sleeve', 'Relaxed shirt sleeve.001', 'Sculpted head'):
            with self.assertRaises(ValueError):
                validate_shower_inventory(original, SHOWER_RENDERED_BODY-{name})
        with self.assertRaises(ValueError):
            validate_shower_inventory(original, original)
        with self.assertRaises(ValueError):
            validate_shower_inventory(original-{'Shirt placket'}, SHOWER_RENDERED_BODY)

    def test_spray_direction_must_be_finite_and_forward_down(self):
        self.assertAlmostEqual(spray_angle((0, -.003, -.006)), 0, places=7)
        self.assertLess(spray_angle((.3, -.4, -1)), 20)
        for invalid in ((0, 0, 0), (0, 0, float('nan'))):
            with self.assertRaises(ValueError):
                spray_angle(invalid)

    def test_floor_interior_and_rounded_corner(self):
        self.assertTrue(on_floor(0, 0))
        self.assertTrue(on_floor(.374, 0))
        self.assertTrue(on_floor(.365, .365))
        self.assertFalse(on_floor(.374, .374))
        self.assertFalse(on_floor(.376, 0))
        self.assertFalse(on_floor(float('nan'), 0))

    def test_complete_sole_footprint(self):
        footprint = [(-.08, -.2, .07415), (.08, -.2, .07415),
                     (.08, .1, .10), (-.08, .1, .10)]
        self.assertEqual(validate_footprint(footprint)['vertex_count'], 4)
        for bad in ([], footprint+[(.38, 0, .1)], footprint+[(0, float('inf'), .1)]):
            with self.assertRaises(ValueError):
                validate_footprint(bad)

    def test_reachable_chain_preserves_both_lengths(self):
        start, end = (0, -.06, .86), (0, .025, .185)
        knee = two_link(start, end, .37, .36, (0, -.5, .5))
        self.assertAlmostEqual(math.dist(start, knee), .37, places=12)
        self.assertAlmostEqual(math.dist(knee, end), .36, places=12)
        self.assertLess(knee[1], start[1])

    def test_rejects_unreachable_and_degenerate_chains(self):
        for end, upper, pole in (((0, 0, 2), .37, (0, 1, 0)),
                                 ((0, 0, 0), .37, (0, 1, 0)),
                                 ((0, 0, .5), -.37, (0, 1, 0)),
                                 ((0, 0, .5), .37, (0, 0, 1)),
                                 ((0, 0, float('nan')), .37, (0, 1, 0))):
            with self.assertRaises(ValueError):
                two_link((0, 0, 0), end, upper, .36, pole)


if __name__ == '__main__':
    unittest.main()
