"""Check published parity through the same guard used by the pool source exporter."""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/models/sims/character-creator'
sys.path.insert(0, str(SOURCE))
from pool_activity_source_guard_v2 import require_pool_published_sample


class PoolPublishedParityTests(unittest.TestCase):
    candidate = None
    published = None
    observed = {}

    def test_complete_review_input_preserves_every_zero_weight_sample(self):
        zero, positive = 0, 0
        records = self.candidate['rawSource']
        self.assertEqual(len(records), 545)
        self.assertEqual(len({(row['clip'], row['index']) for row in records}), 545)
        for row in records:
            name, index = row['clip'], row['index']
            actual = self.candidate['library']['clips'][name]['samples'][index]
            previous = self.published['clips'][name]['samples'][index]
            unchanged = require_pool_published_sample(actual, previous, row['authoring'], name, index)
            zero += unchanged
            positive += not unchanged
        self.assertEqual((zero, positive), (454, 91))
        self.observed.update(zeroWeightSamples=zero, positiveWeightSamples=positive)

    def zero_weight_sample(self):
        # This key is outside the eleven historical shared-control assertions.
        name, index = 'pool_enter', 1
        row = next(row for row in self.candidate['rawSource'] if row['clip'] == name and row['index'] == index)
        self.assertFalse(row['authoring'])
        return name, index, self.candidate['library']['clips'][name]['samples'][index], self.published['clips'][name]['samples'][index]

    def test_changed_complete_zero_weight_sample_rejects(self):
        name, index, actual, previous = self.zero_weight_sample()
        cases = []
        basis = copy.deepcopy(actual)
        basis['basis'][0][0] = math.nextafter(basis['basis'][0][0], math.inf)
        cases.append(('next-basis', basis))
        world = copy.deepcopy(actual)
        world['bones'][0][12] = math.nextafter(world['bones'][0][12], math.inf)
        cases.append(('next-world', world))
        contacts = copy.deepcopy(actual)
        contacts['contacts']['poolTravel'] = math.nextafter(contacts['contacts']['poolTravel'], math.inf)
        cases.append(('next-contact', contacts))
        visibility = copy.deepcopy(actual)
        visibility['bookVisible'] = not visibility['bookVisible']
        cases.append(('visibility', visibility))
        extra = copy.deepcopy(actual)
        extra['unexpected'] = 'changed sample'
        cases.append(('extra-field', extra))
        for label, changed in cases:
            with self.subTest(label=label), self.assertRaisesRegex(ValueError, 'zero-weight.*published'):
                require_pool_published_sample(changed, previous, {}, name, index)
        self.observed['rejectedZeroWeightChanges'] = [label for label, _ in cases]

    def test_zero_or_invalid_evidence_cannot_exempt_changed_output(self):
        name, index, actual, previous = self.zero_weight_sample()
        changed = copy.deepcopy(actual)
        changed['basis'][0][0] = math.nextafter(changed['basis'][0][0], math.inf)
        with self.assertRaisesRegex(ValueError, 'zero-weight.*published'):
            require_pool_published_sample(changed, previous, {'weights': {'pelvis': 0.0}}, name, index)
        for value in [math.nan, math.inf, -0.1, 1.1, True, '1']:
            with self.subTest(weight=value), self.assertRaisesRegex(ValueError, 'authoring weights'):
                require_pool_published_sample(changed, previous, {'weights': {'pelvis': value}}, name, index)
        for evidence in [{'phase': .025}, {'weights': []}, {'weights': {}}]:
            with self.subTest(evidence=evidence), self.assertRaisesRegex(ValueError, 'authoring weights'):
                require_pool_published_sample(changed, previous, evidence, name, index)

    def test_actual_positive_authoring_keeps_its_changed_output(self):
        row = next(row for row in self.candidate['rawSource'] if row['authoring'])
        name, index = row['clip'], row['index']
        actual = self.candidate['library']['clips'][name]['samples'][index]
        previous = self.published['clips'][name]['samples'][index]
        self.assertNotEqual(actual, previous)
        self.assertFalse(require_pool_published_sample(actual, previous, row['authoring'], name, index))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate', required=True, type=Path)
    parser.add_argument('--published', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Choose a new source-adoption receipt path')
    candidate_bytes, published_bytes = args.candidate.read_bytes(), args.published.read_bytes()
    candidate, published = json.loads(candidate_bytes), json.loads(published_bytes)
    published_hash = hashlib.sha256(published_bytes).hexdigest()
    if candidate['publishedLibrarySha256'] != published_hash:
        raise ValueError('Source review candidate does not name the actual published input')
    PoolPublishedParityTests.candidate, PoolPublishedParityTests.published = candidate, published
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PoolPublishedParityTests))
    receipt = {'scope': 'Pure shared exporter/adoption guard against the retained complete candidate and causal corruptions. No Blender export, physical trajectory or publication.',
               'candidateSha256': hashlib.sha256(candidate_bytes).hexdigest(), 'publishedLibrarySha256': published_hash,
               'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
               'success': result.wasSuccessful(), 'observations': PoolPublishedParityTests.observed}
    args.output.write_text(json.dumps(receipt, indent=2) + '\n')
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
