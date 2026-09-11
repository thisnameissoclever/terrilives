"""Regression gates for complete animation review batches."""
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from PIL import Image
from review_animation import load_checked, FACINGS, SAMPLES


class AnimationReviewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.path = self.directory/'sample.png'
        image = Image.new('RGBA',(768,960))
        image.paste((40,80,120,255),(100,100,600,850))
        image.save(self.path)
        digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.proof = {'state':'complete','renders':[
            {'kind':kind,'facing':facing,'frame':index,'path':'sample.png','sha256':digest}
            for kind,count in SAMPLES.items() for facing in FACINGS for index in range(count)]}

    def load(self):
        (self.directory/'proof.json').write_text(json.dumps(self.proof))
        return load_checked(self.directory)

    def test_complete_registered_set_is_accepted(self):
        self.assertEqual(len(self.load()),48)

    def test_missing_and_duplicate_samples_are_rejected(self):
        last = self.proof['renders'].pop()
        with self.assertRaisesRegex(ValueError,'coverage'):
            self.load()
        self.proof['renders'].append(self.proof['renders'][0])
        with self.assertRaisesRegex(ValueError,'Duplicate'):
            self.load()
        self.proof['renders'][-1] = last

    def test_incomplete_state_and_changed_image_are_rejected(self):
        self.proof['state'] = 'running'
        with self.assertRaisesRegex(ValueError,'incomplete'):
            self.load()
        self.proof['state'] = 'complete'
        self.path.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'hash'):
            self.load()

    def test_clipped_image_is_rejected_even_with_current_hash(self):
        Image.new('RGBA',(768,960),(40,80,120,255)).save(self.path)
        for row in self.proof['renders']:
            row['sha256'] = hashlib.sha256(self.path.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError,'clipped'):
            self.load()


if __name__ == '__main__':
    unittest.main()
