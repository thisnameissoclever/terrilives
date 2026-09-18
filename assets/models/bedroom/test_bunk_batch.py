"""Reject incomplete, duplicated or changed resumable render checkpoints."""
import unittest

from bunk_batch import expected_keys, validate_rows, validate_environment


class BunkBatchTests(unittest.TestCase):
    def test_resume_cannot_mix_blender_builds(self):
        proof = {'blender_version':'4.5.14 LTS', 'blender_build_hash':'abc'}
        validate_environment(proof, '4.5.14 LTS', 'abc')
        for version, build in (('4.5.13 LTS','abc'), ('4.5.14 LTS','def')):
            with self.assertRaisesRegex(ValueError, 'Blender build'):
                validate_environment(proof, version, build)

    def test_complete_batch_has_four_empty_and_48_four_pass_groups(self):
        keys = expected_keys()
        self.assertEqual(len(keys), 196)
        self.assertEqual(sum(key[-1] == 'empty' for key in keys), 4)
        self.assertEqual(len(expected_keys(pilot=True)), 13)

    def test_rows_must_be_unique_and_part_of_requested_batch(self):
        row = dict(facing='SE', frame=0, variant='green', owner='beauty')
        self.assertEqual(len(validate_rows([row], pilot=True)), 1)
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            validate_rows([row, row], pilot=True)
        with self.assertRaisesRegex(ValueError, 'Unexpected'):
            validate_rows([{**row, 'frame':4}])
        with self.assertRaisesRegex(ValueError, 'Unexpected'):
            validate_rows([{**row, 'facing':'NW'}], pilot=True)

    def test_complete_requires_exact_coverage(self):
        rows = [dict(facing=f, frame=i, variant=v, owner=o)
                for f, i, v, o in expected_keys()]
        validate_rows(rows, complete=True)
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            validate_rows(rows[:-1], complete=True)


if __name__ == '__main__':
    unittest.main()
