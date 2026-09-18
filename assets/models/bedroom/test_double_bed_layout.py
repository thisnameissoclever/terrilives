"""Double-bed width and physical support, independent of raster appearance."""
import unittest

from double_bed_layout import parts


class DoubleBedLayoutTests(unittest.TestCase):
    def test_supported_parts_overlap_and_feet_touch_the_floor(self):
        rows = parts()
        by_name = {row['name']: row for row in rows}
        feet = [row for row in rows if row['name'].startswith('Foot ') and row['name'] != 'Foot rail']
        self.assertEqual(len(feet), 4)
        for foot in feet:
            self.assertAlmostEqual(foot['center'][2]-foot['size'][2]/2, 0)
        for row in rows:
            if row['support']:
                other = by_name[row['support']]
                for axis in range(3):
                    self.assertLess(abs(row['center'][axis]-other['center'][axis]),
                                    (row['size'][axis]+other['size'][axis])/2,
                                    f'{row["name"]} detached on axis {axis}')

    def test_two_pillows_fit_a_double_width_mattress_inside_the_four_tiles(self):
        rows = parts()
        mattress = next(row for row in rows if row['name'] == 'Mattress')
        self.assertGreaterEqual(mattress['size'][0], 1.5)
        self.assertGreaterEqual(mattress['size'][1], 1.84)
        self.assertGreaterEqual(mattress['size'][1]/mattress['size'][0], 1.20)
        pillows = [row for row in rows if row['name'].startswith('Pillow ')]
        self.assertEqual(len(pillows), 2)
        self.assertLess(pillows[0]['center'][0]+pillows[0]['size'][0]/2,
                        pillows[1]['center'][0]-pillows[1]['size'][0]/2)
        for row in rows:
            for axis in (0, 1):
                self.assertLessEqual(abs(row['center'][axis])+row['size'][axis]/2, .98)


if __name__ == '__main__':
    unittest.main()
