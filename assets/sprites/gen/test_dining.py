"""Keep published dining frames and physical cooking contact tied to their producers."""
import hashlib
import json
from pathlib import Path
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'assets/models/domestic'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

class DiningAssetTests(unittest.TestCase):
    def test_registered_bake_and_runtime_frames_match_receipts(self):
        proof=json.loads((BASE/'dining/proof.json').read_text())
        self.assertEqual((proof['state'],proof['completed'],proof['expected']),('complete',336,336))
        self.assertEqual(digest(BASE/'dining.blend'),proof['model_sha256'])
        self.assertEqual(digest(BASE.parent/'sims/sim-01/sim-01-rigged.blend'),proof['source_sha256'])
        for name,sha in proof['inputs'].items(): self.assertEqual(digest(BASE/name),sha)
        for variant in ('green','blue','red'):
            folder=BASE/'export/dining'/variant
            manifest=json.loads((folder/'manifest.json').read_text())
            self.assertEqual(len(manifest['frames']),112)
            self.assertEqual(manifest['pixel_density'],2)
            self.assertEqual(set(manifest['clips']),{'food_walk','food_idle','seated_eat','cook_v2'})
            for row in manifest['frames']:
                path=folder/row['path'];self.assertEqual(digest(path),row['sha256'])
                clip=manifest['clips'][row['action']]
                with Image.open(path) as im:
                    self.assertEqual(im.size,(clip['width']*2,clip['height']*2))
                    self.assertIsNotNone(im.getchannel('A').getbbox())
    def test_composed_cook_keeps_the_spoon_in_hand_and_inside_the_pot(self):
        folder=BASE/'export/cooking-contact';proof=json.loads((folder/'proof.json').read_text())
        self.assertEqual(proof['state'],'complete')
        self.assertEqual(digest(BASE/'dining.blend'),proof['model_sha256'])
        for name,sha in proof['inputs'].items(): self.assertEqual(digest(BASE.parent/name),sha)
        self.assertEqual({(row['facing'],row['frame']) for row in proof['samples']},{(f,i) for f in ('SE','NW','SW','NE') for i in range(8)})
        for row in proof['samples']:
            self.assertLess(row['grip_error'],.001)
            self.assertLess(row['bowl_radius'],.08)
            self.assertAlmostEqual(row['bowl_height'],.09,places=5)
            self.assertEqual(digest(folder/row['path']),row['sha256'])

if __name__=='__main__': unittest.main()
