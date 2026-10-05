"""Neutral seating tables keep ordinary interaction profiles independent."""
import base64
import importlib
import itertools
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image


class ImportTests(unittest.TestCase):
    def api(self):
        try:
            return importlib.import_module('offline_seating')
        except ModuleNotFoundError:
            self.fail('Neutral seating importer is not implemented')

    def fixture(self, kind='dining'):
        api = self.api()
        layers = {role: Image.new('RGBA', (8, 8)) for role in ('body', 'furniture', 'ink')}
        layers['body'].putpixel((2, 2), (40, 20, 10, 64))
        layers['furniture'].putpixel((5, 5), (80, 60, 40, 192))
        layers['ink'].putpixel((2, 1), (4, 3, 2, 128))
        layers['ink'].putpixel((5, 4), (3, 2, 1, 96))
        masks = {role: image.getchannel('A') for role, image in layers.items()}
        masks['bodyInk'] = Image.new('L', (8, 8))
        masks['bodyInk'].putpixel((2, 1), 128)
        objects = [dict(kind=kind, content='sofa' if kind == 'ottoman' else 'chair',
                        canvas=[4, 4], anchor=[2, 4], scenes=[])]
        for facing, variant, frame in itertools.product(('SE', 'NW', 'SW', 'NE'), ('green', 'blue', 'red'), range(4)):
            objects[0]['scenes'].append(dict(facing=facing, variant=variant, frame=frame,
                layers=dict(furniture='furniture', body='body', ink='ink'),
                coverage=dict(body='body', furniture='furniture', ink='ink', bodyInk='bodyInk')))
        if kind == 'ottoman':
            objects[0]['quarter_turn_symmetry'] = dict(max_vertex_distance=0, tolerance=.00001)
        return api.NeutralSeatExport(dict(objects=objects, halfCycleTicks=16), layers, masks)

    def test_scene_records_alias_furniture_and_never_bake_full_scenes(self):
        api = self.api()
        export = self.fixture()
        result = api.records(export)
        self.assertEqual(len(result), 51)
        self.assertIs(result[3][1], result[1][1])

    def test_action_eight_profiles_and_distinct_visible_ownership(self):
        api = self.api()
        export = self.fixture()
        records = api.records(export)
        empty = [(name, Image.new('RGBA', (1, 1)), 1, 1) for name in
                 ('offlineDiningChair', 'offlineDiningChairNW', 'offlineDiningChairSW', 'offlineDiningChairNE')]
        tables = api.tables(export, empty + records)
        self.assertEqual(set(tables), {'anchors', 'tops', 'bounds', 'density', 'profiles', 'layers', 'coverage', 'masks'})
        self.assertEqual(tables['profiles'][0]['action'], 8)
        self.assertEqual(len(tables['profiles'][0]['frames']['red']), 4)
        scene = tables['profiles'][0]['frames']['green'][0]
        self.assertEqual(tables['layers'][scene], [5, 4, -1, 6])
        self.assertEqual(tables['coverage'][scene], [0, 2, 3, 1])
        expected = (
            ('body', 0, [2, 2, 3, 3], bytes([64])),
            ('furniture', 2, [5, 5, 6, 6], bytes([192])),
            ('ink', 3, [2, 1, 6, 5], bytes([128] + [0] * 14 + [96])),
            ('bodyInk', 1, [2, 1, 3, 2], bytes([128])),
        )
        for role, mask_index, box, pixels in expected:
            with self.subTest(role=role):
                mask = tables['masks'][mask_index]
                self.assertEqual(mask['size'], [8, 8])
                self.assertEqual(mask['box'], box)
                self.assertEqual(base64.b64decode(mask['values']), pixels)

    def test_missing_exact_empty_facing_is_rejected(self):
        api = self.api()
        export = self.fixture()
        with self.assertRaisesRegex(ValueError, 'empty'):
            api.tables(export, api.records(export))

    def test_ottoman_has_all_body_facings_without_changing_furniture(self):
        api = self.api()
        export = self.fixture('ottoman')
        empty = [('offlineOttoman' + suffix, Image.new('RGBA', (1, 1)), 1, 1)
                 for suffix in ('', 'NW', 'SW', 'NE')]
        tables = api.tables(export, empty + api.records(export))
        self.assertEqual(set(tables['profiles'][0]['facingFrames']), {1, 2, 3, 4})
        self.assertEqual(tables['profiles'][0]['facingFrames'][3], tables['profiles'][0]['frames'])
        self.assertEqual(tables['profiles'][0]['facingFrames'], tables['profiles'][1]['facingFrames'])

    def test_bad_manifest_metadata_fails_before_image_decode(self):
        api = self.api()
        source_path = api.MODELS / 'seating/review/batch-01/proof.json'
        ink_path = api.MODELS / 'seating/review/ink-01/proof.json'
        source = json.loads(source_path.read_text())
        ink = json.loads(ink_path.read_text())
        dependencies = ('seating/seat_export_contract.py', 'seating/export_neutral_seats.py',
                        'seating/render_neutral_ink.py', 'bedroom/double_bed_linear.py', 'bedroom/double_bed_layers.py')
        for mutation, message in (('duplicate', 'Duplicate'), ('palette', 'Incomplete'),
                                  ('camera', 'registration'), ('source_hash', 'hash'), ('path', 'Unsafe')):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'source.json').write_bytes(source_path.read_bytes())
                (root / 'ink.json').write_bytes(ink_path.read_bytes())
                objects = []
                for item in source['objects']:
                    obj = {key: item[key] for key in ('kind', 'content', 'source_sha256', 'model_sha256',
                                                     'canvas', 'anchor', 'camera_matrix', 'ortho_scale')}
                    obj['scenes'] = [dict(facing=f, variant=v, frame=i, path=f'{f}-{v}-{i}')
                                     for f, v, i in itertools.product(('SE', 'NW', 'SW', 'NE'), ('green', 'blue', 'red'), range(4))]
                    if obj['kind'] == 'ottoman':
                        obj['quarter_turn_symmetry'] = next(x for x in ink['objects'] if x['kind'] == 'ottoman')['quarter_turn_symmetry']
                    objects.append(obj)
                data = dict(version=1, encoding=api.ENCODING, pixel_density=2, action=8, halfCycleTicks=16,
                    comparison_reference='independent-beauty-float-linear-box-display-once',
                    source_batch=source_path.relative_to(api.MODELS).as_posix(),
                    ink_batch=ink_path.relative_to(api.MODELS).as_posix(),
                    source_receipt=dict(path='source.json', sha256=api.digest(source_path)),
                    ink_receipt=dict(path='ink.json', sha256=api.digest(ink_path)),
                    dependencies={name: api.digest(api.MODELS / name) for name in dependencies}, objects=objects)
                if mutation == 'duplicate':
                    objects[0]['scenes'].append(objects[0]['scenes'][0])
                elif mutation == 'palette':
                    objects[0]['scenes'].pop()
                elif mutation == 'camera':
                    objects[0]['camera_matrix'] = []
                elif mutation == 'source_hash':
                    data['source_receipt']['sha256'] = '0' * 64
                else:
                    data['source_receipt']['path'] = '../source.json'
                path = root / 'manifest.json'
                path.write_text(json.dumps(data))
                with patch.object(api.Image, 'open', side_effect=AssertionError('Image decoded before validation')):
                    with self.assertRaisesRegex(ValueError, message):
                        api.load_neutral_seats(path)


if __name__ == '__main__':
    unittest.main()
