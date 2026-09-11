"""Prove that incomplete or stale review batches cannot reach the review sheet."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw

from review_images import load_checked


class ReviewBatchTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        image = Image.new('RGBA',(768,960))
        ImageDraw.Draw(image).rectangle((40,50,700,900),fill=(80,100,120,255))
        frames = []
        for kind in ('bike','chair'):
            for facing in ('SE','NW','SW','NE'):
                for occupied in (False,True):
                    path = self.folder / f'{kind}-{facing}-{occupied}.png'
                    image.save(path)
                    frames.append({'object':kind,'facing':facing,'occupied':occupied,
                                   'path':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        self.proof = {'state':'complete','renders':frames}
        self.write_proof()

    def write_proof(self):
        (self.folder/'proof.json').write_text(json.dumps(self.proof))

    def test_complete_nonempty_batch_returns_all_sixteen_views(self):
        self.assertEqual(len(load_checked(self.folder)),16)

    def test_missing_facing_is_rejected_not_drawn_as_blank(self):
        self.proof['renders'].pop()
        self.write_proof()
        with self.assertRaisesRegex(ValueError,'missing or unexpected view'):
            load_checked(self.folder)

    def test_changed_png_is_rejected_before_review(self):
        path = self.folder/self.proof['renders'][0]['path']
        path.write_bytes(path.read_bytes()+b'changed')
        with self.assertRaisesRegex(ValueError,'render hash mismatch'):
            load_checked(self.folder)

    def test_repeated_view_does_not_replace_missing_view(self):
        self.proof['renders'][-1] = self.proof['renders'][0]
        self.write_proof()
        with self.assertRaisesRegex(ValueError,'duplicate render'):
            load_checked(self.folder)

    def test_transparent_render_is_not_visual_evidence(self):
        row = self.proof['renders'][0]
        path = self.folder/row['path']
        Image.new('RGBA',(768,960)).save(path)
        row['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.write_proof()
        with self.assertRaisesRegex(ValueError,'empty or clipped render'):
            load_checked(self.folder)


if __name__ == '__main__':
    unittest.main()
