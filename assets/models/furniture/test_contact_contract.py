"""Reject incomplete or intersecting physical contact reports."""
from copy import deepcopy
import unittest

from contact_contract import validate_contact_report


class ContactContractTests(unittest.TestCase):
    def report(self):
        return {'samples':16,'collisions':[], 'obstacle_count':6,'shoe_count':4,'contacts':[
            {'sample':frame,'side':side,'gap':0.0,'support_gap':0.0}
            for frame in range(16) for side in ('L','R')]}

    def test_complete_contact_report_passes(self):
        validate_contact_report(self.report())

    def test_contact_errors_and_missing_samples_fail(self):
        for gap in (-.02835, .01):
            report = self.report()
            report['contacts'][0]['gap'] = gap
            with self.assertRaisesRegex(ValueError,'sole'):
                validate_contact_report(report)
        report = self.report()
        report['contacts'].pop()
        with self.assertRaisesRegex(ValueError,'coverage'):
            validate_contact_report(report)

    def test_mesh_collision_cannot_be_hidden_by_perfect_contact_points(self):
        report = self.report()
        report['collisions'] = [{'sample':0,'shoe':'left','obstacle':'wheel','intersections':1}]
        with self.assertRaisesRegex(ValueError,'intersection'):
            validate_contact_report(report)

    def test_height_alone_cannot_prove_horizontal_support(self):
        report = self.report()
        report['contacts'][0]['support_gap'] = None
        with self.assertRaisesRegex(ValueError,'support'):
            validate_contact_report(report)

    def test_empty_obstacle_inventory_cannot_pass(self):
        report = self.report()
        report['obstacle_count'] = 0
        with self.assertRaisesRegex(ValueError,'inventory'):
            validate_contact_report(report)


if __name__ == '__main__':
    unittest.main()
