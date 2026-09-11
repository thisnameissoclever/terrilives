import hashlib
import json
import unittest
from pathlib import Path
from PIL import Image

BASE=Path(__file__).resolve().parent


class ExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest=json.loads((BASE/'export/manifest.json').read_text())

    def test_complete_directional_clips(self):
        names=set()
        for action,clip in self.manifest['clips'].items():
            frames=[f for f in self.manifest['frames'] if f['action']==action]
            self.assertEqual(len(frames),clip['frame_count']*4)
            self.assertEqual({(f['facing'],f['frame']) for f in frames},
                             {(facing,index) for facing in ('SE','SW','NW','NE') for index in range(clip['frame_count'])})
            for frame in frames:
                self.assertNotIn(frame['name'],names)
                names.add(frame['name'])

    def test_bytes_dimensions_padding_and_registration(self):
        for frame in self.manifest['frames']:
            clip=self.manifest['clips'][frame['action']]
            path=BASE/'export'/frame['path']
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),frame['sha256'])
            with Image.open(path) as img:
                self.assertEqual(img.mode,'RGBA')
                self.assertEqual(img.size,(clip['width'],clip['height']))
                x0,y0,x1,y1=img.getchannel('A').getbbox()
                self.assertGreater(min(x0,y0),0)
                self.assertLess(x1,img.width)
                self.assertLess(y1,img.height)
            self.assertAlmostEqual(clip['anchor'][0],clip['world_origin'][0],places=5)
            self.assertAlmostEqual(clip['anchor'][1],clip['world_origin'][1]+21,places=5)

    def test_nonidle_actions_change_rendered_body(self):
        for action,clip in self.manifest['clips'].items():
            if action=='idle':
                continue
            for facing in ('SE','SW','NW','NE'):
                frames=[f for f in self.manifest['frames'] if f['action']==action and f['facing']==facing]
                pixels={Image.open(BASE/'export'/frame['path']).tobytes() for frame in frames}
                self.assertGreaterEqual(len(pixels),2,(action,facing))

    def test_walk_changes_limb_silhouette(self):
        for facing in ('SE','SW','NW','NE'):
            frames=[f for f in self.manifest['frames'] if f['action']=='walk' and f['facing']==facing]
            alpha={Image.open(BASE/'export'/frame['path']).getchannel('A').crop((0,42,52,104)).tobytes() for frame in frames}
            self.assertEqual(len(alpha),8,facing)

    def test_eating_has_registered_hand_anchors(self):
        for frame in self.manifest['frames']:
            if frame['action']!='eat':
                continue
            point=frame['hand_anchor']
            clip=self.manifest['clips']['eat']
            self.assertEqual(len(point),2)
            self.assertTrue(0<=point[0]<clip['width'])
            self.assertTrue(0<=point[1]<clip['height'])
            self.assertIsInstance(frame['hand_in_front'],bool)
        eating=[frame for frame in self.manifest['frames'] if frame['action']=='eat']
        self.assertTrue(any(frame['hand_in_front'] for frame in eating))
        self.assertTrue(any(not frame['hand_in_front'] for frame in eating))


if __name__=='__main__':
    unittest.main()
