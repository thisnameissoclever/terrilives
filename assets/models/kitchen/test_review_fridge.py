"""A review sheet must never hide a missing, clipped or changed facing."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image
from review_fridge import load_views


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.rows = []
        for facing in ('SE','SW','NW','NE'):
            path = self.folder/f'{facing}.png'
            image = Image.new('RGBA',(768,960))
            image.paste((100,120,140,255),(120,140,640,850))
            image.save(path)
            self.rows.append({'facing':facing,'path':path.name,
                              'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        self.write()

    def tearDown(self):
        self.temp.cleanup()

    def write(self):
        (self.folder/'proof.json').write_text(json.dumps({'state':'complete','renders':self.rows}))

    def test_accepts_the_complete_four_view_batch(self):
        self.assertEqual(set(load_views(self.folder)),{'SE','SW','NW','NE'})

    def test_rejects_missing_or_duplicate_facings(self):
        self.rows.pop()
        self.write()
        with self.assertRaisesRegex(ValueError,'four'):
            load_views(self.folder)
        self.rows.append(self.rows[0])
        self.write()
        with self.assertRaisesRegex(ValueError,'four'):
            load_views(self.folder)

    def test_rejects_changed_bytes(self):
        self.rows[0]['sha256'] = '0'*64
        self.write()
        with self.assertRaisesRegex(ValueError,'hash'):
            load_views(self.folder)

    def test_rejects_a_clipped_view_even_with_correct_hash(self):
        path = self.folder/self.rows[0]['path']
        Image.new('RGBA',(768,960),(255,0,0,255)).save(path)
        self.rows[0]['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.write()
        with self.assertRaisesRegex(ValueError,'clipped'):
            load_views(self.folder)
