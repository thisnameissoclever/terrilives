"""Check exact one-place render inventory and reject extra frame aliases."""
import importlib
import unittest


class CoveredBunkBatchTests(unittest.TestCase):
    def module(self):
        try:
            return importlib.import_module('covered_bunk_batch')
        except ModuleNotFoundError:
            self.fail('Missing the finite covered-bunk batch contract')

    def test_all_facings_and_active_palette_scenes_are_unique(self):
        values = self.module().groups()
        self.assertEqual(len(values), 16)
        self.assertEqual(len(set(values)), 16)
        self.assertEqual(set(values), {
            (mask, facing, color, 'green', 0)
            for facing in ('SE', 'NW', 'SW', 'NE')
            for mask, colors in ((0, ('green',)), (1, ('green', 'blue', 'red')))
            for color in colors})

    def test_every_pass_has_one_exact_scene_owner(self):
        module = self.module()
        self.assertEqual(module.owners(0), ('beauty', 'furniture', 'lines'))
        self.assertEqual(module.owners(1), ('beauty', 'furniture', 'lines', 'sim0'))
        self.assertEqual(len(module.expected_keys()), 60)
        self.assertNotIn((1, 'SE', 'green', 'green', 1, 'beauty'), module.expected_keys())
        for invalid in (True, -1, 2, '1'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                module.owners(invalid)


if __name__ == '__main__':
    unittest.main()
