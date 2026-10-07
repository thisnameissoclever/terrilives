import copy
import hashlib
import tempfile
from PIL import Image
from pathlib import Path
import unittest

from export_geometric_stock import verify_capture


class CaptureBinding(unittest.TestCase):
    def setUp(self):
        self.root = Path.cwd()
        self.index = self.root / 'source-index.json'
        self.proof_path = self.root / 'SE/raw/proof.json'
        self.row = dict(facing='SE', mask=1, palette='green', density=8,
                        canvas=[96, 120], anchor=[48, 116], path='SE/raw/one.png', sha256='one')
        self.proof = dict(facing='SE', density=8, canvas=[96, 120], anchor=[48, 116],
                          inputs_unchanged=True, renders=[dict(stock_mask=1, palette='green',
                          path='one.png', sha256='one', owner_visibility=dict(actor_collection_hidden=True))])

    def test_matching_capture_is_bound_to_actual_render(self):
        verify_capture(self.row, self.index, self.proof_path, self.proof)

    def test_relabelled_capture_cannot_change_its_inventory(self):
        row = dict(self.row, mask=2)
        with self.assertRaises(ValueError):
            verify_capture(row, self.index, self.proof_path, self.proof)

    def test_visibility_registration_and_source_hash_are_required(self):
        for field, value in [('anchor', [49, 116]), ('density', 4), ('sha256', 'other'),
                             ('path', 'SE/raw/different.png'), ('palette', 'blue')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                verify_capture(dict(self.row, **{field: value}), self.index, self.proof_path, self.proof)
        for kind in ('changed_input', 'visible_actor', 'duplicated_capture'):
            proof = copy.deepcopy(self.proof)
            if kind == 'changed_input':
                proof['inputs_unchanged'] = False
            elif kind == 'visible_actor':
                proof['renders'][0]['owner_visibility']['actor_collection_hidden'] = False
            else:
                proof['renders'] *= 2
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                verify_capture(self.row, self.index, self.proof_path, proof)

    def test_expanded_capture_crop_preserves_pixels_and_registered_origin(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = root / 'SE/raw'
            raw.mkdir(parents=True)
            image = Image.new('RGBA', (8, 8), (60, 90, 120, 255))
            image.putpixel((4, 3), (255, 20, 40, 255))
            image.save(raw / 'one.png')
            image.crop((2, 0, 8, 8)).save(root / 'crop.png')
            full_sha = hashlib.sha256((raw / 'one.png').read_bytes()).hexdigest()
            proof = copy.deepcopy(self.proof)
            proof.update(density=1, canvas=[8, 8], anchor=[4, 8])
            proof['renders'][0]['sha256'] = full_sha
            row = dict(self.row, density=1, canvas=[6, 8], anchor=[2, 8], path='crop.png',
                       sourceRender=dict(path='SE/raw/one.png', sha256=full_sha), sourceCrop=[2, 0, 8, 8])
            verify_capture(row, root / 'source-index.json', raw / 'proof.json', proof)
            with self.assertRaises(ValueError):
                verify_capture(dict(row, anchor=[3, 8]), root / 'source-index.json', raw / 'proof.json', proof)
            image.crop((1, 0, 7, 8)).save(root / 'crop.png')
            with self.assertRaises(ValueError):
                verify_capture(row, root / 'source-index.json', raw / 'proof.json', proof)


if __name__ == '__main__':
    unittest.main()
