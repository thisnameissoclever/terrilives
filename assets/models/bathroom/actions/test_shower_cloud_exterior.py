"""One continuous graphic exterior replaces individually shaded cloud lobes."""
import unittest

from shower_cloud_exterior import (EXTERIOR_NAME, exterior_geometry, material_spec,
                                   validate_exterior_inventory, closed_surface_certificate)


class ShowerCloudExteriorTests(unittest.TestCase):
    def test_one_closed_asymmetric_surface_above_floor(self):
        vertices, triangles, metadata = exterior_geometry()
        certificate = closed_surface_certificate(vertices, triangles)
        self.assertTrue(certificate['closed'])
        self.assertTrue(certificate['connected'])
        self.assertGreater(certificate['signed_volume'], 0)
        self.assertGreater(min(p[2] for p in vertices), .055)
        self.assertTrue(all(abs(p[0]) < .375 and abs(p[1]) < .375 for p in vertices))
        self.assertGreater(metadata['top_boundary_height_range'], .04)
        self.assertGreater(metadata['asymmetric_boundary_displacement'], .02)
        with self.assertRaisesRegex(ValueError, 'closed'):
            closed_surface_certificate(vertices, triangles[1:])

    def test_exterior_inventory_is_exactly_one_object(self):
        validate_exterior_inventory({EXTERIOR_NAME})
        for names in (set(), {EXTERIOR_NAME, 'Shower opaque steam lobe 01'}, {'Other cloud'}):
            with self.assertRaises(ValueError):
                validate_exterior_inventory(names)

    def test_cloud_shader_is_opaque_emission_without_normal_shading(self):
        spec = material_spec()
        self.assertEqual(spec['shader'], 'constant-emission')
        self.assertEqual(spec['rgba'][3], 1)
        self.assertFalse(spec['normal_based_shading'])
        self.assertEqual(spec['node_types'], ['ShaderNodeEmission', 'ShaderNodeOutputMaterial'])
        self.assertFalse(spec['transparency'])


if __name__ == '__main__':
    unittest.main()
