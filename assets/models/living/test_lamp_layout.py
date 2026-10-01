"""A floor lamp needs a grounded stand and a genuinely hollow, supported shade."""
import unittest

from lamp_layout import parts


class LampLayoutTests(unittest.TestCase):
    def test_closed_profiles_have_one_grounded_base_and_fit_one_tile(self):
        rows = {part['name']: part for part in parts()}
        self.assertEqual(len(rows), 13)
        self.assertEqual([p['name'] for p in rows.values() if p['grounded']], ['Base'])
        self.assertEqual(rows['Base']['profile'][0][1], 0)
        self.assertEqual(rows['Shade']['supports'], ['Shade support X', 'Shade support Y'])
        for part in rows.values():
            self.assertTrue(part['grounded'] or part['supports'])
            for name in part['supports']:
                self.assertIn(name, rows)
            if part['shape'] == 'lathe':
                self.assertGreaterEqual(len(part['profile']), 4)
                self.assertTrue(all(0 <= r <= .28 and 0 <= z <= 1.38
                                    for r, z in part['profile']))
        self.assertEqual(rows['Stem']['supports'], ['Base'])
        self.assertEqual(rows['Socket']['supports'], ['Stem'])
        self.assertEqual(rows['Bulb']['supports'], ['Socket'])

    def test_shade_is_a_thin_open_frustum_not_a_solid_cone(self):
        shade = next(p for p in parts() if p['name'] == 'Shade')
        self.assertEqual(shade['profile'], [(.28, .95), (.15, 1.34),
                                             (.141, 1.34), (.271, .95)])
        self.assertTrue(all(radius > .14 for radius, _ in shade['profile']))
        rows = {p['name']: p for p in parts()}
        self.assertEqual(rows['Shade support X']['a'], (-.15, 0, 1.33))
        self.assertEqual(rows['Shade support X']['b'], (.15, 0, 1.33))
        self.assertEqual(rows['Shade support Y']['a'], (0, -.15, 1.33))
        self.assertEqual(rows['Shade support Y']['b'], (0, .15, 1.33))
        self.assertGreater(min(z for _, z in rows['Bulb']['profile']), .95)

    def test_bulb_is_above_the_stand_with_external_shade_support(self):
        rows = {p['name']: p for p in parts()}
        self.assertLess(max(z for _, z in rows['Stem']['profile']),
                        min(z for _, z in rows['Bulb']['profile']))
        self.assertEqual(rows['Shade support X']['supports'], ['Harp upright L', 'Harp upright R'])
        for side in ('L', 'R'):
            self.assertGreater(abs(rows[f'Harp upright {side}']['a'][0])-.006, .05)
        self.assertEqual(rows['Finial']['supports'], ['Shade support X'])


if __name__ == '__main__':
    unittest.main()
