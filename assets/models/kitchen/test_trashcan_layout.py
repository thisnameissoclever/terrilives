"""A closed pedal bin fits one tile and stays below the adjacent counter."""
import unittest

from trashcan_layout import parts


class TrashcanLayoutTests(unittest.TestCase):
    def test_closed_bin_has_a_supported_lid_and_front_pedal(self):
        rows = {part['name']: part for part in parts()}
        self.assertEqual(set(rows), {'Base', 'Body', 'Lid', 'Rear hinge', 'Pedal'})
        self.assertEqual(rows['Base']['bottom'], 0)
        self.assertEqual(rows['Lid']['top'], .64)
        self.assertEqual(rows['Body']['radius'], .21)
        self.assertEqual(rows['Lid']['supports'], ['Body'])
        self.assertEqual(rows['Rear hinge']['supports'], ['Body', 'Lid'])
        self.assertEqual(rows['Pedal']['supports'], ['Base'])
        self.assertLess(rows['Pedal']['center'][1], 0)
        self.assertGreater(rows['Rear hinge']['center'][1], 0)
        for part in rows.values():
            if part['kind'] == 'cylinder':
                self.assertLessEqual(part['radius'], .225)
                self.assertLess(part['bottom'], part['top'])
                self.assertLessEqual(part['top'], .64)
            else:
                for center, size in zip(part['center'][:2], part['size'][:2]):
                    self.assertLess(abs(center)+size/2, .4)
                self.assertGreaterEqual(part['center'][2]-part['size'][2]/2, 0)


if __name__ == '__main__':
    unittest.main()
