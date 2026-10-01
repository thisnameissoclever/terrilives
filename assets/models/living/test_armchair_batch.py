"""Complete sitting coverage and the chair-to-body orientation contract."""
import unittest

from armchair_batch import body_degrees, expected_keys, validate_rows, validate_environment


class ArmchairBatchTests(unittest.TestCase):
    def rows(self):
        return [dict(facing=f, frame=i, variant=v, owner=o,
                     path=f'armchair-{v}-{f}-{i}-{o}.png')
                for f, i, v, o in sorted(expected_keys())]

    def test_complete_batch_contains_48_occupied_groups_and_four_empty_views(self):
        keys = expected_keys()
        self.assertEqual(len(keys), 196)
        self.assertEqual({key[0] for key in keys}, {'SE', 'NW', 'SW', 'NE'})
        self.assertEqual(sum(key[3] == 'empty' for key in keys), 4)
        self.assertEqual(sum(key[3] == 'beauty' for key in keys), 48)
        self.assertEqual({key[2] for key in keys}, {'green', 'blue', 'red'})
        self.assertEqual({key[1] for key in keys}, {0, 1, 2, 3})

    def test_preserved_sw_seat_and_body_face_the_same_way(self):
        self.assertEqual({facing: body_degrees(facing) for facing in ('SE', 'NW', 'SW', 'NE')},
                         {'SE': 0, 'NW': 180, 'SW': -90, 'NE': 90})

    def test_complete_exact_coverage_accepts_and_missing_or_duplicate_samples_fail(self):
        rows = self.rows()
        self.assertEqual(validate_rows(rows, complete=True), expected_keys())
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            validate_rows(rows[:-1], complete=True)
        with self.assertRaisesRegex(ValueError, 'Duplicate.*sample'):
            validate_rows(rows + [rows[0]], complete=True)
        for field, value in (('frame', True), ('frame', 4), ('variant', 'yellow'),
                             ('owner', 'back'), ('facing', 'S')):
            with self.subTest(field=field, value=value), self.assertRaisesRegex(ValueError, 'Invalid'):
                validate_rows([{**rows[0], field: value}])

    def test_paths_are_unique_and_match_the_sample_identity(self):
        rows = self.rows()
        with self.assertRaisesRegex(ValueError, 'Duplicate.*path'):
            validate_rows([rows[0], {**rows[1], 'path': rows[0]['path']}])
        for path in ('..', '.', '../a.png', 'a/b.png', 'a\\b.png', 'D:a.png',
                     'wrong.png', '', None):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'filename'):
                validate_rows([{**rows[0], 'path': path}])

    def test_resume_requires_the_same_blender_build(self):
        proof = {'blender_version': '4.5.14 LTS', 'blender_build_hash': 'abc'}
        validate_environment(proof, '4.5.14 LTS', 'abc')
        for version, build in (('4.5.13 LTS', 'abc'), ('4.5.14 LTS', 'def')):
            with self.assertRaisesRegex(ValueError, 'Blender build'):
                validate_environment(proof, version, build)


if __name__ == '__main__':
    unittest.main()
