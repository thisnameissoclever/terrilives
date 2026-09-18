"""Reject damaged model exports before they can enter the game atlas."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image
from offline_props import load_props


class StaticPropTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.batch = self.root/'candidate'
        self.batch.mkdir()
        self.catalog = {'version': 1, 'objects': [{
            'name': 'offlineFridge', 'directory': 'candidate',
            'review_status': 'accepted-independent-review'}]}
        self.proof = {'state': 'complete', 'logical_canvas': [96,120],
                      'source_density': 8, 'origin_pixels': [384,760], 'renders': []}
        for facing, degrees, red in [('SW',0,30),('NE',180,40),('SE',90,10),('NW',270,20)]:
            path = self.batch/f'{facing}.png'
            image = Image.new('RGBA',(768,960))
            image.paste((red,80,110,255),(160,200,610,850))
            image.paste((240,30,70,255),(200,300,240,340))
            image.save(path)
            self.proof['renders'].append({'facing':facing,'degrees':degrees,'path':path.name,
                'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})

    def tearDown(self):
        self.temp.cleanup()

    def load(self, reseal=True, **kwargs):
        (self.batch/'proof.json').write_text(json.dumps(self.proof))
        if reseal:
            self.catalog['objects'][0]['proof_sha256'] = hashlib.sha256(
                json.dumps(self.proof,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        path = self.root/'catalog.json'
        path.write_text(json.dumps(self.catalog))
        return load_props(path, **kwargs)

    def test_maps_four_actual_rotations_without_recentering_or_mirroring(self):
        sprites, anchors, densities, bounds = self.load()
        self.assertEqual([s[0] for s in sprites],
                         ['offlineFridge','offlineFridgeNW','offlineFridgeSW','offlineFridgeNE'])
        self.assertEqual([s[1].getpixel((90,110))[0] for s in sprites], [10,20,30,40])
        self.assertTrue(all(s[1].getpixel((55,80)) == (240,30,70,255) for s in sprites))
        self.assertEqual([s[1].getpixel((136,80))[0] for s in sprites], [10,20,30,40])
        self.assertTrue(all(s[2:] == (192,240) for s in sprites))
        self.assertEqual(anchors, {s[0]:[48,116] for s in sprites})
        self.assertEqual(densities, {s[0]:2 for s in sprites})
        # Lanczos can extend the rectangular source by up to three output
        # pixels. Its transparent margin must remain excluded from picking.
        self.assertTrue(all(18.5 <= box[0] <= 20 and 23.5 <= box[1] <= 25 for box in bounds.values()))

    def test_rejects_missing_or_duplicate_facing(self):
        self.proof['renders'][1] = self.proof['renders'][0]
        with self.assertRaisesRegex(ValueError,'four distinct'):
            self.load()

    def wide_sources(self):
        self.proof['logical_canvas'] = [160,176]
        self.proof['origin_pixels'] = [640,984.0035]
        for row in self.proof['renders']:
            path = self.batch/row['path']
            image = Image.new('RGBA',(1280,1408))
            image.paste((60,80,110,255),(80,200,1200,1200))
            image.paste((240,30,70,255),(200,300,240,340))
            image.save(path)
            row['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()

    def test_wide_canvas_preserves_world_scale_and_off_center_registration(self):
        self.wide_sources()
        sprites, anchors, densities, _ = self.load()
        self.assertTrue(all(s[2:] == (320,352) for s in sprites))
        self.assertEqual(densities, {s[0]:2 for s in sprites})
        for name, sprite, _, _ in sprites:
            self.assertEqual(sprite.size,(320,352))
            self.assertEqual(anchors[name],[80,144.0004375])
            self.assertEqual(sprite.getpixel((30,60)),(60,80,110,255))
            self.assertEqual(sprite.getpixel((55,80)),(240,30,70,255))
            self.assertEqual(sprite.getpixel((265,80)),(60,80,110,255))

    def test_wide_sources_reject_registration_dimension_and_padding_errors(self):
        self.wide_sources()
        for key,value in [('logical_canvas',[160,144]),('logical_canvas',[160.0,176]),
                          ('origin_pixels',[384,760]),('source_density',4)]:
            original = self.proof[key]
            self.proof[key] = value
            with self.subTest(key=key,value=value), self.assertRaisesRegex(ValueError,'registration'):
                self.load()
            self.proof[key] = original
        row = self.proof['renders'][0]
        path = self.batch/row['path']
        for size,rectangle,message in [((768,960),(80,80,200,200),'1280x1408'),
                                       ((1280,1408),(7,80,200,200),'clipped'),
                                       ((1280,1408),(80,80,1273,200),'clipped'),
                                       ((1280,1408),(80,80,200,1401),'clipped')]:
            source = Image.new('RGBA',size)
            source.paste((60,80,110,255),rectangle)
            source.save(path)
            row['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            with self.subTest(size=size,rectangle=rectangle), self.assertRaisesRegex(ValueError,message):
                self.load()

    def test_rejects_mirrored_rotation_labels(self):
        self.proof['renders'][0]['degrees'] = 180
        with self.assertRaisesRegex(ValueError,'rotation'):
            self.load()

    def test_rejects_damaged_pixels(self):
        self.proof['renders'][0]['sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError,'hash'):
            self.load()

    def test_review_is_bound_to_exact_camera_and_render_provenance(self):
        self.load()
        self.proof['ortho_scale'] = 999
        with self.assertRaisesRegex(ValueError,'reviewed proof'):
            self.load(reseal=False)

    def test_rejects_incomplete_or_unreviewed_batch(self):
        self.proof['state'] = 'running'
        with self.assertRaisesRegex(ValueError,'complete'):
            self.load()
        self.proof['state'] = 'complete'
        self.catalog['objects'][0]['review_status'] = 'pending'
        with self.assertRaisesRegex(ValueError,'review'):
            self.load()

    def test_rejects_source_scale_or_anchor_drift(self):
        for key, value in [('source_density',4),('logical_canvas',[96,121]),
                           ('origin_pixels',[384,770]),('origin_pixels',[384,float('nan')])]:
            original = self.proof[key]
            self.proof[key] = value
            with self.subTest(key=key,value=value), self.assertRaisesRegex(ValueError,'registration'):
                self.load()
            self.proof[key] = original

    def test_rejects_path_escape_and_existing_names(self):
        self.catalog['objects'][0]['directory'] = '../candidate'
        with self.assertRaisesRegex(ValueError,'inside'):
            self.load()
        self.catalog['objects'][0]['directory'] = 'candidate'
        with self.assertRaisesRegex(ValueError,'duplicate'):
            self.load(existing_names={'offlineFridgeNW'})
        self.proof['renders'][0]['path'] = '../SE.png'
        with self.assertRaisesRegex(ValueError,'inside'):
            self.load()

    def test_rejects_empty_clipped_or_non_rgba_sources(self):
        for mode, color, message in [('RGBA',(0,0,0,0),'empty'),
                                     ('RGBA',(0,0,0,255),'clipped'),('RGB',(0,0,0),'RGBA')]:
            row = self.proof['renders'][0]
            path = self.batch/row['path']
            Image.new(mode,(768,960),color).save(path)
            row['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            with self.subTest(mode=mode,color=color), self.assertRaisesRegex(ValueError,message):
                self.load()


if __name__ == '__main__':
    unittest.main()
