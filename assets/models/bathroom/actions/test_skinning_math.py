"""Independent weighted bone-transform arithmetic for the clothing diagnostic."""
import unittest

from skinning_math import weighted_point


IDENTITY = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]


class SkinningMathTests(unittest.TestCase):
    def test_identity_preserves_rest_coordinates(self):
        self.assertEqual(weighted_point((1, 2, 3), [(1, IDENTITY)]), (1, 2, 3))

    def test_two_bones_blend_translations_without_rescaling(self):
        translated = [row[:] for row in IDENTITY]
        translated[0][3] = 4
        self.assertEqual(weighted_point((1, 2, 3), [(.25, translated), (.75, IDENTITY)]), (2, 2, 3))

    def test_rotation_uses_homogeneous_point_not_direction(self):
        rotated = [[0, -1, 0, 3], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
        self.assertEqual(weighted_point((1, 2, 3), [(1, rotated)]), (1, 1, 3))

    def test_rejects_undeclared_partial_weight_normalization(self):
        with self.assertRaises(ValueError):
            weighted_point((1, 2, 3), [(.5, IDENTITY)])

    def test_rejects_nonfinite_or_negative_evidence(self):
        for point, weight in [((float('nan'), 0, 0), 1), ((0, 0, 0), -1), ((0, 0, 0), float('inf'))]:
            with self.assertRaises(ValueError):
                weighted_point(point, [(weight, IDENTITY)])

    def test_rejects_projective_matrix(self):
        matrix = [row[:] for row in IDENTITY]
        matrix[3][0] = 1
        with self.assertRaises(ValueError):
            weighted_point((1, 2, 3), [(1, matrix)])


if __name__ == '__main__':
    unittest.main()
