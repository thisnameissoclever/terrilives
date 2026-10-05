"""Aquarium construction and fish motion stay inside one unchanged tile."""
import unittest

from aquarium_layout import fish_poses, parts


class AquariumLayoutTests(unittest.TestCase):
    def test_tank_cabinet_and_fish_fit_the_existing_tile(self):
        shell = parts()
        self.assertEqual(len({p['name'] for p in shell}), len(shell))
        by_name = {p['name']: p for p in shell}
        for p in shell:
            for axis in (0, 1):
                self.assertLessEqual(abs(p['center'][axis])+p['size'][axis]/2, .46)
            self.assertGreaterEqual(p['center'][2]-p['size'][2]/2, 0)
        base = by_name['Cabinet plinth']
        self.assertEqual(base['center'][2]-base['size'][2]/2, 0)
        self.assertEqual(by_name['Tank lid']['size'][2], .045)
        self.assertEqual(by_name['Substrate']['size'][2], .045)
        first, second = fish_poses(0), fish_poses(1)
        self.assertEqual(len(first), 3)
        self.assertEqual([f['name'] for f in first], [f['name'] for f in second])
        for a, b in zip(first, second):
            self.assertNotEqual(a['center'], b['center'])
            self.assertLessEqual(abs(a['center'][0]-b['center'][0]), .03)
        for f in first+second:
            x, y, z = f['center']
            self.assertLess(abs(x)+.12, .38)
            self.assertLess(abs(y)+.045, .32)
            self.assertGreater(z-.045, .79)
            self.assertLess(z+.045, 1.365)


if __name__ == '__main__':
    unittest.main()
