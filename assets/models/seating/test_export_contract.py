"""Regression guards for neutral seating source and contribution ownership."""
import hashlib
import importlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image


class ContractTests(unittest.TestCase):
    def api(self):
        try:
            return importlib.import_module('seat_export_contract')
        except ModuleNotFoundError:
            self.fail('Neutral seating contract is not implemented')

    def test_duplicate_samples_are_rejected(self):
        rows = [dict(facing='SE', variant='green', frame=0, owner='sim', path='one.png')] * 2
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.api().index_rows(rows, {('SE', 'green', 0, 'sim')})

    def test_incomplete_palette_inventory_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            self.api().index_rows([], {('SE', 'red', 3, 'sim')})

    def test_traversal_and_windows_paths_are_rejected(self):
        api = self.api()
        for name in ('../elsewhere.png', 'C:/escape.png', '/escape.png', 'a\\b.png', 'a/../b.png'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                api.inside(Path.cwd(), name)

    def test_changed_hash_is_rejected(self):
        api = self.api()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sample.png'
            Image.new('RGBA', (8, 8)).save(path)
            with self.assertRaisesRegex(ValueError, 'hash'):
                api.read_png(Path(directory), dict(path=path.name, sha256='0'*64), (8, 8))

    def test_wrong_mode_and_clipped_border_are_rejected(self):
        api = self.api()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sample.png'
            for image in (Image.new('RGB', (8, 8)), Image.new('RGBA', (8, 8), 'red')):
                image.save(path)
                ref = dict(path=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest())
                with self.assertRaises(ValueError):
                    api.read_png(Path(directory), ref, (8, 8))

    def test_camera_and_source_identity_mismatch_are_rejected(self):
        api = self.api()
        source = dict(source_sha256='a'*64, model_sha256='b'*64, canvas=[96, 120],
                      anchor=[48, 116], camera_matrix=[[1, 0], [0, 1]], ortho_scale=2.65)
        for field in source:
            changed = dict(source, **{field: None})
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'registration|identity'):
                api.check_identity(source, changed)

    def test_missing_body_line_ownership_is_rejected(self):
        api = self.api()
        shared = Image.new('RGBA', (8, 8))
        shared.putpixel((4, 4), (1, 1, 1, 255))
        with self.assertRaisesRegex(ValueError, 'body.*ink'):
            api.check_body_ink(shared, Image.new('RGBA', (8, 8)))

    def test_body_line_outside_shared_ink_is_rejected(self):
        api = self.api()
        shared = Image.new('RGBA', (8, 8))
        body = Image.new('RGBA', (8, 8))
        body.putpixel((4, 4), (1, 1, 1, 255))
        with self.assertRaisesRegex(ValueError, 'body.*ink'):
            api.check_body_ink(shared, body)

    def test_palette_alpha_mismatch_is_rejected(self):
        api = self.api()
        first = Image.new('RGBA', (8, 8))
        second = first.copy()
        second.putpixel((4, 4), (1, 1, 1, 255))
        with self.assertRaisesRegex(ValueError, 'palette'):
            api.check_palettes([{'sim': first, 'furniture': first, 'lines': first},
                                {'sim': second, 'furniture': first, 'lines': first}])

    def test_shared_ink_attenuates_before_filtering(self):
        api = self.api()
        fill = Image.new('RGBA', (2, 1))
        fill.putdata([(255, 255, 255, 255), (0, 0, 0, 0)])
        ink = Image.new('RGBA', (2, 1))
        ink.putdata([(0, 0, 0, 255), (0, 0, 0, 0)])
        result = api.encode_scene(dict(sim=fill, furniture=Image.new('RGBA', (2, 1)),
                                      lines=ink), (1, 1))
        self.assertEqual(result['sim'].getpixel((0, 0)), (0, 0, 0, 0))
        self.assertEqual(result['lines'].getpixel((0, 0)), (0, 0, 0, 128))

    def test_substituted_body_and_bone_names_are_rejected(self):
        api = self.api()
        source = Path(__file__).parent / 'review/batch-01/proof.json'
        for field in ('body_parts', 'bone_length_errors'):
            record = json.loads(source.read_text())['objects'][0]
            for contact in record['contacts']:
                if field == 'body_parts':
                    contact[field][0] = 'Invented body part'
                else:
                    contact[field]['invented bone'] = contact[field].pop('hips')
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'named'):
                api.check_contacts(record)

    def test_camera_registration_cannot_be_rewritten_in_both_receipts(self):
        api = self.api()
        record = json.loads((Path(__file__).parent / 'review/batch-01/proof.json').read_text())['objects'][0]
        record['camera_matrix'][0][3] += 1
        check = getattr(api, 'check_registration', None)
        self.assertIsNotNone(check, 'Accepted camera registration guard is missing')
        with self.assertRaisesRegex(ValueError, 'registration'):
            check(record)

    def test_exported_layers_and_masks_must_match_original_owner(self):
        api = self.api()
        check = getattr(api, 'check_exported_images', None)
        self.assertIsNotNone(check, 'Source-bound image verification is missing')
        blank = Image.new('RGBA', (8, 8))
        body = blank.copy()
        body.putpixel((4, 4), (100, 100, 100, 255))
        raw = dict(sim=body, furniture=blank, lines=blank, beauty=body)
        layers = dict(body=api.encode(body, (8, 8)), furniture=blank, ink=blank)
        masks = dict(body=body.getchannel('A'), furniture=blank.getchannel('A'),
                     ink=blank.getchannel('A'), bodyInk=blank.getchannel('A'))
        check(raw, blank, layers, masks)
        for field in ('layer', 'mask'):
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'source owner'):
                check(raw, blank, dict(layers, body=blank) if field == 'layer' else layers,
                      dict(masks, body=blank.getchannel('A')) if field == 'mask' else masks)

    def test_dark_beauty_reference_is_not_quantized_through_layer_storage(self):
        api = self.api()
        reference = getattr(api, 'reference_beauty', None)
        self.assertIsNotNone(reference, 'Independent float beauty reference is missing')
        image = Image.new('RGBA', (2, 1))
        image.putdata([(17, 17, 17, 255), (0, 0, 0, 255)])
        self.assertEqual(reference(image, (1, 1)).getpixel((0, 0)), (9, 9, 9, 255))
        self.assertEqual(api.reconstruct([api.encode(image, (1, 1))]).getpixel((0, 0)), (13, 13, 13, 255))
        image.putdata([(17, 17, 17, 255), (255, 255, 255, 0)])
        self.assertEqual(reference(image, (1, 1)).getpixel((0, 0)), (17, 17, 17, 128))

    def test_source_dependency_inventory_rejects_omissions_and_additions(self):
        api = self.api()
        path = Path(__file__).parent / 'review/batch-01/proof.json'
        for name in ('seating/render_neutral_seats.py', 'sims/sim-01/shirt_colors.py', 'unexpected'):
            proof = json.loads(path.read_text())
            if name == 'unexpected':
                proof['inputs']['seating/seat_export_contract.py'] = api.digest(api.BASE / 'seat_export_contract.py')
            else:
                del proof['inputs'][name]
            with self.subTest(name=name), patch.object(api.json, 'loads', return_value=proof):
                with self.assertRaisesRegex(ValueError, 'dependency inventory'):
                    api.read_batch(path, process_exited=True)

    def test_contact_bounds_and_area_require_finite_ordered_geometry(self):
        api = self.api()
        path = Path(__file__).parent / 'review/batch-01/proof.json'
        mutations = (
            ('nan width', lambda hip: hip['contact_bounds'][0].__setitem__(0, float('nan'))),
            ('infinite height', lambda hip: hip['contact_bounds'][1].__setitem__(2, float('inf'))),
            ('reversed height', lambda hip: hip['contact_bounds'][1].__setitem__(2, hip['contact_bounds'][0][2] - 1)),
            ('infinite area', lambda hip: hip.__setitem__('xy_hull_area', float('inf'))),
            ('nan area', lambda hip: hip.__setitem__('xy_hull_area', float('nan'))),
            ('boolean area', lambda hip: hip.__setitem__('xy_hull_area', True)),
            ('missing coordinate', lambda hip: hip['contact_bounds'][0].pop()),
        )
        for name, mutate in mutations:
            record = json.loads(path.read_text())['objects'][0]
            mutate(record['contacts'][0]['hip_support'])
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'contact geometry'):
                api.check_contacts(record)

    def test_contact_counts_require_nonnegative_integers(self):
        api = self.api()
        path = Path(__file__).parent / 'review/batch-01/proof.json'
        for field in ('contact_count', 'ray_hits'):
            for value in (-1, True, 1000.5, float('nan'), float('inf')):
                record = json.loads(path.read_text())['objects'][0]
                record['contacts'][0]['hip_support'][field] = value
                with self.subTest(field=field, value=value), self.assertRaisesRegex(ValueError, 'contact counts'):
                    api.check_contacts(record)


if __name__ == '__main__':
    unittest.main()
