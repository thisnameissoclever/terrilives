"""Complete registered cleanup clips, including the visible held plate."""
import hashlib
import json
from pathlib import Path
import sys
import unittest

from PIL import Image

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]
sys.path.insert(0, str(ROOT / 'assets/sprites/gen'))
from offline_sims import load_export


class CleanupExportTests(unittest.TestCase):
    def test_all_palettes_and_facings_are_complete_registered_and_unclipped(self):
        proof = json.loads((BASE / 'cleanup/proof.json').read_text())
        self.assertEqual((proof['state'],proof['completed'],proof['expected']),('complete',192,192))
        self.assertEqual(hashlib.sha256((BASE/'cleanup.blend').read_bytes()).hexdigest(),proof['model_sha256'])
        self.assertEqual(hashlib.sha256((BASE.parent/'sims/sim-01/sim-01-rigged.blend').read_bytes()).hexdigest(),proof['source_sha256'])
        reference = None
        for palette in ('green','blue','red'):
            export = load_export(BASE/'export/cleanup'/palette/'manifest.json',
                                 required_clips={'carry_walk','carry_idle','wash'},expected_variant=palette)
            self.assertEqual(len(export.frames),64)
            if reference is None:
                reference = export.clips
            self.assertEqual(export.clips,reference)
            for name,image,width,height in export.sprites:
                bounds = image.getchannel('A').point(lambda alpha: 255 if alpha >= 16 else 0).getbbox()
                self.assertGreater(bounds[0],1,name)
                self.assertGreater(bounds[1],1,name)
                self.assertLess(bounds[2],width-1,name)
                self.assertLess(bounds[3],height-1,name)
            for action,clip in export.clips.items():
                self.assertAlmostEqual(clip['anchor'][0],clip['world_origin'][0],places=5)
                self.assertAlmostEqual(clip['anchor'][1]-clip['world_origin'][1],21,places=5)
        jobs = proof['jobs']
        for action in ('carry_walk','carry_idle','wash'):
            for facing in ('SE','NW','SW','NE'):
                count = 8 if action == 'carry_walk' else 4
                for frame in range(count):
                    matching = [job for job in jobs if (job['action'],job['facing'],job['frame']) == (action,facing,frame)]
                    self.assertEqual(len(matching),3)
                    self.assertEqual(len({job['geometry_sha256'] for job in matching}),1)


if __name__ == '__main__':
    unittest.main()
