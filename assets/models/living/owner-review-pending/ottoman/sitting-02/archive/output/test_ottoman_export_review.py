"""Reject incomplete or ambiguous raw evidence before export."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('review_export', BASE/'export-ottoman-sit-review.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class RenderCoverageTests(unittest.TestCase):
    def setUp(self):
        self.proof = json.loads((BASE/'ottoman-sit-candidate-02/contributions/raw-proof.json').read_text())

    def test_real_complete_batch(self):
        review.validate_rows(self.proof)

    def rejected(self, change):
        proof = copy.deepcopy(self.proof)
        change(proof)
        with self.assertRaises(ValueError):
            review.validate_rows(proof)

    def test_missing_frame(self):
        self.rejected(lambda proof: proof['renders'].pop())

    def test_duplicate_sample(self):
        self.rejected(lambda proof: proof['renders'].append(proof['renders'][0]))

    def test_wrong_named_sample(self):
        self.rejected(lambda proof: proof['renders'][1].update(path=proof['renders'][0]['path']))

    def test_path_escape(self):
        self.rejected(lambda proof: proof['renders'][0].update(path='../elsewhere.png'))

    def test_incomplete_state(self):
        self.rejected(lambda proof: proof.update(state='running'))

    def test_registration_drift(self):
        self.rejected(lambda proof: proof.update(anchor=[48, 115]))

    def test_colour_contact_drift(self):
        self.rejected(lambda proof: proof['contact_samples']['red'].pop())


if __name__ == '__main__':
    unittest.main()
