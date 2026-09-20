"""Physical envelope and supports for a centered two-level bunk."""
import unittest

from bunk_layout import parts


class BunkLayoutTests(unittest.TestCase):
    def test_ladder_and_access_opening_are_on_near_side_without_reversing_head(self):
        by_name = {row['name']: row for row in parts()}
        for row in by_name.values():
            if row['name'].startswith('Ladder '):
                self.assertLess(row['center'][0], -.43,
                                'SE view must expose the ladder on the near long side')
        self.assertLess(by_name['Upper access guard']['center'][0], 0)
        self.assertLess(by_name['Upper access upright']['center'][0], 0)
        self.assertGreater(by_name['Upper rear guard']['center'][0], 0)
        for level in ('Lower', 'Upper'):
            self.assertAlmostEqual(by_name[f'{level} pillow']['center'][1], .68,
                                   msg='Pillows must stay at the original head end')

    def test_bunk_has_grounded_posts_and_two_supported_mattresses(self):
        rows = parts()
        posts = [row for row in rows if row['name'].startswith('Post ')]
        self.assertEqual(len(posts), 4)
        for post in posts:
            self.assertAlmostEqual(post['center'][2]-post['size'][2]/2, 0)
        mattresses = [row for row in rows if row['name'].endswith(' mattress')]
        self.assertEqual(len(mattresses), 2)
        by_name = {row['name']:row for row in rows}
        for row in rows:
            self.assertLessEqual(abs(row['center'][0])+row['size'][0]/2, .49)
            self.assertLessEqual(abs(row['center'][1])+row['size'][1]/2, .98)
            if row['support']:
                support = by_name[row['support']]
                for axis in range(3):
                    self.assertLess(abs(row['center'][axis]-support['center'][axis]),
                                    (row['size'][axis]+support['size'][axis])/2,
                                    f'{row["name"]} detached on axis {axis}')
        lower = by_name['Lower mattress']
        self.assertAlmostEqual(lower['center'][2]+lower['size'][2]/2, .46739448)
        self.assertGreaterEqual(lower['size'][0], .76)
        self.assertGreaterEqual(lower['size'][1], 1.80)


if __name__ == '__main__':
    unittest.main()
