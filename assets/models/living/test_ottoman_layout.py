"""The ottoman is a low, one-tile cushion supported by four separate feet."""
import unittest

from ottoman_layout import parts, welt_path


class OttomanLayoutTests(unittest.TestCase):
    def test_four_grounded_feet_support_the_frame(self):
        rows = parts()
        feet = [part for part in rows if part['grounded']]
        self.assertEqual({part['center'][:2] for part in feet},
                         {(x, y) for x in (-.275, .275) for y in (-.275, .275)})
        for foot in feet:
            self.assertAlmostEqual(foot['center'][2]-foot['size'][2]/2, 0)
        frame = next(part for part in rows if part['name'] == 'Upholstered frame')
        self.assertEqual(set(frame['supports']), {part['name'] for part in feet})
        self.assertEqual(frame['size'], (.68, .68, .14))

    def test_cushion_is_low_and_welt_is_one_closed_outline(self):
        cushion = next(part for part in parts() if part['name'] == 'Cushion')
        self.assertEqual(cushion['size'], (.74, .74, .17))
        self.assertAlmostEqual(cushion['center'][2]+cushion['size'][2]/2, .385)
        path = welt_path()
        self.assertEqual(len(path), len(set(path)))
        self.assertEqual(len(path), 132)
        for point in path:
            self.assertLessEqual(max(abs(point[0]), abs(point[1])), .36900001)
            self.assertEqual(point[2], .29)
        for first, second in zip(path, path[1:]+path[:1]):
            self.assertLess(sum((a-b)**2 for a, b in zip(first, second))**.5, .04)


if __name__ == '__main__':
    unittest.main()
