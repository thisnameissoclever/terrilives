"""Media cabinets preserve the shipped physical front and one-tile footprint."""
import math
from pathlib import Path
import sys
import unittest

from media_layout import parts

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'furniture'))
from geometry import FACINGS


class MediaLayoutTests(unittest.TestCase):
    def test_every_part_has_a_grounded_support_chain_and_clearance(self):
        for kind, count, height in [('television', 14, .805), ('radio', 15, .70)]:
            rows = {p['name']: p for p in parts(kind)}
            self.assertEqual(len(rows), count)
            feet = [p for p in rows.values() if p['grounded']]
            self.assertEqual(len(feet), 4)
            self.assertEqual(set(rows['Cabinet']['supports']), {p['name'] for p in feet})

            def reaches_floor(name, seen):
                self.assertNotIn(name, seen, f'Support cycle at {name}')
                part = rows[name]
                return part['grounded'] or all(reaches_floor(other, seen | {name})
                                               for other in part['supports'])

            for part in rows.values():
                low = [part['center'][i]-part['size'][i]/2 for i in range(3)]
                high = [part['center'][i]+part['size'][i]/2 for i in range(3)]
                self.assertGreaterEqual(low[2], 0)
                self.assertLessEqual(high[2], height+1e-8)
                self.assertTrue(part['grounded'] or part['supports'])
                self.assertTrue(reaches_floor(part['name'], set()))
                for axis in (0, 1):
                    self.assertGreaterEqual(low[axis], -.48)
                    self.assertLessEqual(high[axis], .48)
                if part['grounded']:
                    self.assertEqual(low[2], 0)
                for support in part['supports']:
                    other = rows[support]
                    for axis in range(3):
                        other_low = other['center'][axis]-other['size'][axis]/2
                        other_high = other['center'][axis]+other['size'][axis]/2
                        self.assertGreater(min(high[axis], other_high)-max(low[axis], other_low), 0)

    def test_radio_has_a_front_grille_controls_and_attached_antenna(self):
        rows = {p['name']: p for p in parts('radio')}
        self.assertLess(rows['Speaker grille']['center'][1], 0)
        self.assertLess(rows['Volume control']['center'][1], 0)
        self.assertGreater(rows['Antenna']['center'][1], 0)
        self.assertEqual(rows['Antenna']['supports'], ['Cabinet'])
        self.assertEqual(rows['Cabinet']['size'], (.82, .34, .38))
        self.assertEqual(rows['Speaker grille']['size'], (.49, .028, .26))

    def test_tv_screen_is_landscape_and_faces_the_existing_directions(self):
        rows = {p['name']: p for p in parts('television')}
        screen, cabinet = rows['Glass screen'], rows['Cabinet']
        self.assertGreater(screen['size'][0], screen['size'][2]*1.4)
        self.assertLess(screen['center'][1], cabinet['center'][1])
        self.assertEqual(screen['supports'], ['Front bezel'])
        expected = {'SE': (1, 0), 'NW': (-1, 0), 'SW': (0, 1), 'NE': (0, -1)}
        for facing, degrees in FACINGS.items():
            angle = math.radians(degrees)
            self.assertLess(math.dist((math.sin(angle), math.cos(angle)), expected[facing]), 1e-8)
        for part in rows.values():
            for axis in (0, 1):
                self.assertLessEqual(abs(part['center'][axis])+part['size'][axis]/2, .48)
            self.assertGreaterEqual(part['center'][2]-part['size'][2]/2, 0)


if __name__ == '__main__':
    unittest.main()
