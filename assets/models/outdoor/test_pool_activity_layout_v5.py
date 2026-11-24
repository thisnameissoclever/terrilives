"""The wider passage keeps the right grip, tread depth and original square."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import pool_activity_layout_v4 as old
import pool_activity_layout_v5 as layout


class WideLadderTests(unittest.TestCase):
    def test_each_tread_still_meets_both_rails(self):
        self.assertEqual(len(layout.SUPPORTS), 7)
        for name in layout.SUPPORTS:
            self.assertEqual(layout.expected_x(name, old.LADDER_RAIL_X[0]), layout.LEFT_RAIL_X)
            self.assertEqual(layout.expected_x(name, old.LADDER_RAIL_X[1]), layout.RIGHT_RAIL_X)
        self.assertAlmostEqual(layout.RIGHT_RAIL_X - layout.LEFT_RAIL_X, .56)
        self.assertLess(old.TOE_RECESS_X[0], layout.LEFT_RAIL_X - old.LADDER_RAIL_RADIUS)

    def test_only_the_left_post_and_its_stringers_move(self):
        for name in layout.LEFT_HARDWARE:
            self.assertAlmostEqual(layout.expected_x(name, -.76), -.80)
        for name in ['Pool ladder rail 2', 'Pool ladder stringer 2 1', 'Pool wall']:
            self.assertEqual(layout.expected_x(name, -.24), -.24)
        with self.assertRaisesRegex(ValueError, 'Unexpected lateral tread edge'):
            layout.support_edge(-.32)

    def test_hidden_path_and_visible_tube_keep_one_object_frame(self):
        class GeometryPart(dict):
            def __init__(self, name):
                super().__init__()
                self.name = name
                self.location = SimpleNamespace(x=0.)
                self.data = Mock()
                self.data.vertices = []
                self.data.bevel_depth = old.LADDER_RAIL_RADIUS
                self.matrix_local = Mock()

        edit = object()
        path = GeometryPart('actual curve source')
        parts = {name: GeometryPart(name) for name in (*layout.LEFT_HARDWARE, *layout.SUPPORTS)}
        rail = parts['Pool ladder rail 1']
        rail['pool_rail_path'] = path.name
        root = SimpleNamespace(children_recursive=[path, *parts.values()])
        modules = {'pool_activity_model_v4': SimpleNamespace(build=Mock()),
                   'mathutils': SimpleNamespace(Matrix=SimpleNamespace(Translation=Mock(return_value=edit)))}
        with patch.dict('sys.modules', modules):
            from pool_activity_model_v5 import widen_ladder
            widen_ladder(root)
        path.data.transform.assert_called_once_with(edit)
        rail.data.transform.assert_called_once_with(edit)
        self.assertEqual((path.location.x, rail.location.x), (0., 0.))


if __name__ == '__main__':
    unittest.main()
