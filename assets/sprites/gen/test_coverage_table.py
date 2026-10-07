import unittest

from coverage_table import coverage_table


class CoverageTableTests(unittest.TestCase):
    def test_repeated_payloads_keep_every_original_index(self):
        first = dict(size=[2, 1], box=[0, 0, 2, 1], values='AP8=')
        other = dict(first, box=[1, 0, 2, 1], values='/w==')
        records = [first, other, dict(first), dict(other), first]
        values, indices = coverage_table(records)
        self.assertEqual(indices, [0, 1, 0, 1, 0])
        self.assertEqual([values[index] for index in indices], records)
        self.assertEqual(len(values), 2)

    def test_encoding_and_registration_remain_part_of_identity(self):
        base = dict(size=[1, 1], box=[0, 0, 1, 1], values='AAA=')
        records = [dict(base, bitDepth=16), dict(base, encoding='float16'),
                   dict(base, size=[2, 1], bitDepth=16)]
        values, indices = coverage_table(records)
        self.assertEqual(indices, [0, 1, 2])
        self.assertEqual(values, records)

    def test_empty_table(self):
        self.assertEqual(coverage_table([]), ([], []))
