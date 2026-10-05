"""Exercise continuous cloth coverage and clearance of the narrow bunk frame."""
import importlib
import math
import unittest


class BunkSleepClothTests(unittest.TestCase):
    def geometry(self, height):
        try:
            module = importlib.import_module('bunk_sleep_cloth')
        except ModuleNotFoundError:
            self.fail('The bunk has no continuous occupied-cloth generator')
        return module.geometry(height)

    def test_empty_surface_keeps_the_mattress_below_the_cloth(self):
        vertices, faces, materials = self.geometry(lambda x, y: None)
        self.assertGreater(len(faces), 1000)
        self.assertEqual(len(faces), len(materials))
        top = vertices[:81 * 71]
        self.assertTrue(all(abs(point[2] - .478) < 1e-9 for point in top))
        self.assertGreater(min(point[2] for point in top), .46739448)

    def test_the_cover_and_foot_skirt_clear_posts_and_end_rail(self):
        vertices, _, _ = self.geometry(lambda x, y: .70)
        self.assertLess(max(abs(point[0]) for point in vertices), .38)
        self.assertGreater(min(point[1] for point in vertices), -.965)
        self.assertLess(min(point[1] for point in vertices), -.912725568)
        self.assertGreater(min(point[2] for point in vertices), .40)
        self.assertAlmostEqual(min(point[2] for point in vertices), .43)
        self.assertGreaterEqual(max(point[1] for point in vertices), .225)
        self.assertTrue(all(abs(point[2] - .745) < 1e-9 for point in vertices[:81 * 71]))

    def test_one_connected_surface_has_no_neck_skirt_or_duplicate_faces(self):
        vertices, faces, materials = self.geometry(lambda x, y: None)
        self.assertEqual(len(faces), len(set(tuple(face) for face in faces)))
        used = {index for face in faces for index in face}
        self.assertEqual(used, set(range(len(vertices))))
        neighbours = {index: set() for index in used}
        for face in faces:
            for a, b in zip(face, face[1:] + face[:1]):
                neighbours[a].add(b)
                neighbours[b].add(a)
        reached, pending = set(), [0]
        while pending:
            index = pending.pop()
            if index not in reached:
                reached.add(index)
                pending.extend(neighbours[index] - reached)
        self.assertEqual(reached, used)
        neckline = [point for point in vertices if abs(point[1] - .225) < 1e-9 and abs(point[0]) < .35]
        self.assertTrue(neckline)
        self.assertTrue(all(point[2] == .478 for point in neckline))
        self.assertEqual(set(materials), {0, 1})

    def test_drape_spreads_a_body_peak_without_losing_coverage(self):
        vertices, _, _ = self.geometry(lambda x, y: .70 if abs(x) < .01 and abs(y + .34) < .02 else None)
        peak = [point for point in vertices[:81 * 71] if abs(point[0]) < .01 and abs(point[1] + .34) < .02]
        self.assertTrue(peak)
        self.assertTrue(all(point[2] >= .745 - 1e-9 for point in peak))
        nearby = [point for point in vertices[:81 * 71] if .09 < point[0] < .11 and abs(point[1] + .34) < .02]
        self.assertTrue(nearby)
        self.assertTrue(all(.60 < point[2] < .745 for point in nearby))

    def test_nonfinite_body_height_is_rejected(self):
        for value in (math.nan, math.inf, -math.inf):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.geometry(lambda x, y: value)

    def test_inset_side_hems_do_not_descend_into_the_mattress(self):
        vertices, _, _ = self.geometry(lambda x, y: .70)
        sides = [point for point in vertices if abs(point[0]) > .36 and -.87 < point[1] < .20]
        self.assertTrue(sides)
        # The top is .46739448; reserve the entire .008 thickness above it.
        self.assertGreaterEqual(min(point[2] for point in sides) - .008, .46739448)

    def test_foot_hem_reserves_inward_thickness_outside_the_mattress(self):
        vertices, _, _ = self.geometry(lambda x, y: None)
        foot = [point for point in vertices if point[2] < .431 and abs(point[0]) < .35]
        self.assertTrue(foot)
        self.assertLessEqual(max(point[1] for point in foot) + .008, -.93)


if __name__ == '__main__':
    unittest.main()
