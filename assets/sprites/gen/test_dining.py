"""Keep published dining frames and physical cooking contact tied to their producers."""
import hashlib
import json
from pathlib import Path, PurePosixPath, PureWindowsPath
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'assets/models/domestic'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cooking_input_path(models, recorded_name):
    """Decode either separator style in the immutable cooking-contact receipt."""
    relative = PurePosixPath(recorded_name.replace('\\', '/'))
    if (PureWindowsPath(recorded_name).anchor or relative.is_absolute()
            or '..' in relative.parts or not relative.parts):
        raise ValueError(f'Cooking input must be model-relative: {recorded_name}')
    return models.joinpath(*relative.parts)


class DiningAssetTests(unittest.TestCase):
    def test_cooking_receipt_inputs_resolve_with_posix_semantics(self):
        proof = json.loads((BASE / 'export/cooking-contact/proof.json').read_text())
        expected = {
            PurePosixPath('assets/models/domestic/verify_cooking_contact.py'),
            PurePosixPath('assets/models/domestic/cooking-contact.json'),
            PurePosixPath('assets/models/kitchen/stove_model.py'),
            PurePosixPath('assets/models/domestic/render_pot.py'),
        }
        models = PurePosixPath('assets/models')
        self.assertEqual(len(proof['inputs']), 4)
        self.assertEqual({cooking_input_path(models, name) for name in proof['inputs']}, expected)

    def test_cooking_input_separator_styles_resolve_on_both_hosts(self):
        for models in (PurePosixPath('/repo/assets/models'),
                       PureWindowsPath('C:/repo/assets/models')):
            for name in ('domestic/verify_cooking_contact.py',
                         'domestic\\verify_cooking_contact.py'):
                with self.subTest(models=models, name=name):
                    self.assertEqual(cooking_input_path(models, name),
                                     models / 'domestic' / 'verify_cooking_contact.py')

    def test_cooking_inputs_remain_relative_to_the_models_directory(self):
        for name in ('', '/domestic/input.py', 'C:/domestic/input.py',
                     'C:input.py', '\\domestic\\input.py',
                     '../input.py', 'domestic\\..\\input.py'):
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    cooking_input_path(PurePosixPath('assets/models'), name)

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
        for name,sha in proof['inputs'].items(): self.assertEqual(digest(cooking_input_path(BASE.parent, name)),sha)
        self.assertEqual({(row['facing'],row['frame']) for row in proof['samples']},{(f,i) for f in ('SE','NW','SW','NE') for i in range(8)})
        for row in proof['samples']:
            self.assertLess(row['grip_error'],.001)
            self.assertLess(row['bowl_radius'],.08)
            self.assertAlmostEqual(row['bowl_height'],.09,places=5)
            self.assertEqual(digest(folder/row['path']),row['sha256'])

if __name__=='__main__': unittest.main()
