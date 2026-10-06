"""One frozen anatomical field, neutral fidelity and evaluated-region labels."""
import unittest

from bath_articulation_v1 import (FIELD, attachment_weights, blend_point, seam_distance_gate,
                                 surface_orientation_gate, waist_weights)
from bath_rest_labels import verify_neutral_fidelity, rear_triangle_labels


class BathArticulationTests(unittest.TestCase):
    def test_weights_are_normalized_and_frozen_at_anatomical_band(self):
        self.assertEqual(FIELD['hip_full_below_z'], .98)
        self.assertEqual(FIELD['spine_full_above_z'], 1.12)
        self.assertEqual(waist_weights(.90), {'hips':1., 'spine':0.})
        self.assertEqual(waist_weights(1.20), {'hips':0., 'spine':1.})
        for z in (.97, .98, 1.03, 1.08, 1.12, 1.13):
            weights = waist_weights(z)
            self.assertAlmostEqual(sum(weights.values()), 1, places=12)
            self.assertTrue(all(0 <= w <= 1 for w in weights.values()))
        with self.assertRaises(ValueError):
            waist_weights(float('nan'))

    def test_every_attachment_uses_same_field_without_collision_feedback(self):
        for z in (.90, .965, 1.05, 1.2):
            self.assertEqual(attachment_weights((0, -.14, z)), waist_weights(z))
            self.assertEqual(attachment_weights((.15, -.10, z)), waist_weights(z))
        identity = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]
        self.assertEqual(blend_point((.1, -.14, 1.05), waist_weights(1.05), identity, identity), (.1, -.14, 1.05))

    def test_neutral_fidelity_requires_verified_evaluated_topology(self):
        mesh = dict(vertices_world=[[0,.1,1.2],[.03,.1,1.2],[0,.1,1.25]], polygons=[[0,1,2]])
        self.assertEqual(verify_neutral_fidelity(mesh, mesh)['max_error'], 0)
        wrong = dict(mesh, polygons=[[0,2,1]])
        with self.assertRaises(ValueError):
            verify_neutral_fidelity(mesh, wrong)
        moved = dict(mesh, vertices_world=[[0,.1,1.2],[.03,.1,1.2],[0,.1,1.255]])
        with self.assertRaises(ValueError):
            verify_neutral_fidelity(mesh, moved)

    def test_rear_labels_use_neutral_subdivided_vertex_identity_not_pose_height(self):
        neutral = dict(vertices_world=[[0,.1,1.2],[.03,.1,1.2],[0,.1,1.25]], polygons=[[0,1,2]])
        posed = dict(vertices_world=[[0,0,.1],[.03,0,.1],[0,.05,.1]], polygons=[[0,1,2]])
        labels = rear_triangle_labels(neutral, posed, (1.12,1.31))
        self.assertEqual(labels, [(0,1,2)])
        with self.assertRaises(ValueError):
            rear_triangle_labels(neutral, dict(posed, polygons=[[0,2,1]]), (1.12,1.31))

    def test_detached_seams_and_internal_orientation_folds_are_detected(self):
        seam_distance_gate([.005,.006], [.006,.007])
        with self.assertRaises(ValueError):
            seam_distance_gate([.005,.006], [.025,.026])
        before = [[0,0,0],[1,0,0],[0,1,0]]
        surface_orientation_gate(before, before, [(0,1,2)])
        with self.assertRaises(ValueError):
            surface_orientation_gate(before, [[0,0,0],[-1,0,0],[0,1,0]], [(0,1,2)])


if __name__ == '__main__':
    unittest.main()
