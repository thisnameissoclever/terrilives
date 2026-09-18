"""Pin complete lower-bunk ownership, cropping and four-facing registration."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image
from offline_bunk import load_bunk, load_reviewed_bunk, verify_bunk_generation, validate_comparison, RENDER_INPUTS
from offline_furniture import furniture_tables


class BunkImportTests(unittest.TestCase):
    def test_comparison_gate_requires_every_palette_frame_and_enforces_limits(self):
        rows = [{'facing':f, 'variant':v, 'frame':i, 'max_error':21, 'p95_error':9,
                 'active_pixels':100, 'pixels_above_8':10}
                for f in ('SE','NW','SW','NE') for v in ('green','blue','red') for i in range(4)]
        report = {'production_export':True, 'checked_groups':48, 'comparisons':rows}
        validate_comparison(report)
        for change in ({'production_export':False}, {'checked_groups':47}, {'comparisons':rows[:-1]},
                       {'comparisons':rows[:-1]+[rows[0]]}):
            with self.assertRaises(ValueError):
                validate_comparison({**report, **change})
        for field, value in (('max_error',65), ('p95_error',13), ('active_pixels',0),
                             ('pixels_above_8',101), ('max_error',float('nan'))):
            bad = copy.deepcopy(report)
            bad['comparisons'][0][field] = value
            with self.assertRaises(ValueError):
                validate_comparison(bad)

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        image = Image.new('RGBA', (200,272))
        image.putpixel((20,30), (30,40,50,100))
        image.save(self.root/'sample.png')
        ref = {'path':'sample.png', 'sha256':hashlib.sha256((self.root/'sample.png').read_bytes()).hexdigest()}
        self.data = {'version':1, 'pixel_density':2, 'width':100, 'height':136,
                     'anchor':[50,124.00044], 'source_canvas':[160,176],
                     'crop_texels':[60,40,260,312], 'empty':[], 'frames':[]}
        for facing in ('SE','NW','SW','NE'):
            self.data['empty'].append({'facing':facing, **ref})
            for variant in ('green','blue','red'):
                for frame in range(4):
                    self.data['frames'].append({'facing':facing, 'variant':variant, 'frame':frame,
                                               **{role:dict(ref) for role in ('body','furniture','outline')}})

    def load(self, names=()):
        path = self.root/'manifest.json'
        path.write_text(json.dumps(self.data))
        return load_bunk(path, existing_names=names)

    def test_complete_profiles_preserve_sleep_timing_and_separate_body_identity(self):
        result = self.load()
        self.assertEqual(len(result.sprites), 54)
        self.assertEqual(len(result.pairs), 48)
        self.assertEqual(len(result.profiles), 4)
        anchors, tops, bounds, density, pairs, catalog = furniture_tables(result, result.sprites)
        self.assertEqual(len(pairs), 48)
        self.assertTrue(all(value == [50,124.00044] for value in anchors.values()))
        self.assertTrue(all(value == 2 for value in density.values()))
        self.assertTrue(all(profile['action'] == 9 and profile['halfCycleTicks'] == 32 for profile in catalog.values()))
        for profile in catalog.values():
            self.assertEqual({len(frames) for frames in profile['frames'].values()}, {4})
        self.assertTrue(all(box == [10,15,10.5,15.5] for box in bounds.values()))

    def test_missing_duplicate_invalid_samples_rejected(self):
        original = copy.deepcopy(self.data)
        for field in ('empty','frames'):
            self.data = copy.deepcopy(original)
            self.data[field].pop()
            with self.assertRaisesRegex(ValueError, 'coverage'):
                self.load()
            self.data = copy.deepcopy(original)
            self.data[field].append(self.data[field][0])
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                self.load()
        self.data = copy.deepcopy(original)
        self.data['frames'][0]['frame'] = True
        with self.assertRaisesRegex(ValueError, 'integer'):
            self.load()

    def test_registration_and_crop_are_pinned(self):
        for key, value in (('width',96),('height',120),('pixel_density',1),
                           ('anchor',[50,123]),('crop_texels',[61,40,261,312]),
                           ('source_canvas',[96,120]),('version',True)):
            original = self.data[key]
            self.data[key] = value
            with self.assertRaises(ValueError):
                self.load()
            self.data[key] = original

    def test_each_shared_reference_is_checked_and_names_do_not_collide(self):
        self.data['frames'][-1]['outline']['sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'hash'):
            self.load()
        self.setUp()
        self.data['frames'][-1]['outline']['path'] = '../sample.png'
        with self.assertRaisesRegex(ValueError, 'path'):
            self.load()
        self.setUp()
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.load({'offlineBunk'})

    def test_nonpremultiplied_or_transparent_body_rejected(self):
        for rgba, message in (((240,0,0,5),'premultiplied'), ((0,0,0,0),'visible')):
            image = Image.new('RGBA', (200,272), rgba)
            image.save(self.root/'bad.png')
            self.data['frames'][0]['body'] = {'path':'bad.png', 'sha256':hashlib.sha256((self.root/'bad.png').read_bytes()).hexdigest()}
            with self.assertRaisesRegex(ValueError, message):
                self.load()

    def reviewed_fixture(self):
        bedroom = self.root/'models/bedroom'
        model_root = bedroom.parent
        bedroom.mkdir(parents=True, exist_ok=True)
        (bedroom/'sample.png').write_bytes((self.root/'sample.png').read_bytes())
        def sha(path):
            return hashlib.sha256(path.read_bytes()).hexdigest()
        def write(path, value):
            path.write_text(json.dumps(value))
            return sha(path)
        input_names = RENDER_INPUTS | {'bedroom/candidate/bunk-authoring.blend'}
        for name in input_names | {'bedroom/export_bunk.py','furniture/layer_partition.py','furniture/export_contributions.py'}:
            path = model_root/name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f'Synthetic dependency fixture: {name}')
        raw_image = bedroom/'raw.png'
        Image.new('RGBA', (1280,1408), (30,40,50,100)).save(raw_image)
        renders = [dict(facing=f,frame=i,variant=v,owner=o,path='raw.png',sha256=sha(raw_image))
                   for f in ('SE','NW','SW','NE') for i in range(4)
                   for v in ('green','blue','red') for o in ('beauty','sim','furniture','lines')]
        renders.extend(dict(facing=f,frame=0,variant='green',owner='empty',path='raw.png',sha256=sha(raw_image))
                       for f in ('SE','NW','SW','NE'))
        for index, row in enumerate(renders):
            row['path'] = f'raw-{index}.png'
            (bedroom/row['path']).write_bytes(raw_image.read_bytes())
        accepted = Path(__file__).resolve().parents[2]/'models/bedroom/owner-review-pending/bunk/candidate-02/contributions-02/raw-proof.json'
        raw = {'state':'complete', 'blender_version':'test', 'blender_build_hash':'test',
               'contact_samples':json.loads(accepted.read_text())['contact_samples'],
               'signature':{'mode':'complete', 'source_density':8, 'logical_canvas':[160,176],
                            'translation':[0,-.50151527,0],
                            'inputs':{name:sha(model_root/name) for name in input_names}}, 'renders':renders}
        raw_hash = write(bedroom/'raw-proof.json',raw)
        manifest = {**self.data, 'raw_proof_sha256':raw_hash}
        manifest_hash = write(bedroom/'manifest.json',manifest)
        report = {'production_export':True,'checked_groups':48,'raw_proof_sha256':raw_hash,
                  'manifest_sha256':manifest_hash,
                  'encoder_sha256':sha(bedroom/'export_bunk.py'),
                  'partition_sha256':sha(model_root/'furniture/layer_partition.py'),
                  'comparison_sha256':sha(model_root/'furniture/export_contributions.py'),
                  'comparisons':[dict(facing=f,variant=v,frame=i,max_error=21,p95_error=9,active_pixels=100,pixels_above_8=10)
                                 for f in ('SE','NW','SW','NE') for v in ('green','blue','red') for i in range(4)]}
        report_hash = write(bedroom/'comparison.json',report)
        catalog = {'review_status':'accepted-independent-review',
                   'manifest':{'path':'manifest.json','sha256':manifest_hash},
                   'raw_proof':{'path':'raw-proof.json','sha256':raw_hash},
                   'comparison':{'path':'comparison.json','sha256':report_hash}}
        write(bedroom/'reviewed.json',catalog)
        return bedroom, catalog, report, write

    def test_complete_review_gate_and_each_binding_reject_changed_evidence(self):
        bedroom, _, _, _ = self.reviewed_fixture()
        self.assertEqual(len(load_reviewed_bunk(bedroom/'reviewed.json').pairs),48)
        for field in ('manifest','raw_proof','comparison'):
            bedroom, catalog, _, write = self.reviewed_fixture()
            catalog[field]['sha256'] = '0'*64
            write(bedroom/'reviewed.json',catalog)
            with self.assertRaisesRegex(ValueError,'hash changed'):
                load_reviewed_bunk(bedroom/'reviewed.json')
        for field in ('raw_proof_sha256','manifest_sha256'):
            bedroom, catalog, report, write = self.reviewed_fixture()
            report[field] = '0'*64
            catalog['comparison']['sha256'] = write(bedroom/'comparison.json',report)
            write(bedroom/'reviewed.json',catalog)
            with self.assertRaisesRegex(ValueError,'binding|bind this manifest'):
                load_reviewed_bunk(bedroom/'reviewed.json')
        for relative, message in (('bunk_contact.py','dependency changed'),
                                  ('export_bunk.py','implementation changed')):
            bedroom, _, _, _ = self.reviewed_fixture()
            (bedroom/relative).write_text('Deliberately changed fixture')
            with self.assertRaisesRegex(ValueError,message):
                load_reviewed_bunk(bedroom/'reviewed.json')

    def test_import_and_full_generation_have_distinct_required_inputs(self):
        bedroom, _, _, _ = self.reviewed_fixture()
        self.assertEqual(len(verify_bunk_generation(bedroom/'reviewed.json').pairs),48)
        (bedroom/'raw-0.png').unlink()
        self.assertEqual(len(load_reviewed_bunk(bedroom/'reviewed.json').pairs),48)
        with self.assertRaises(FileNotFoundError):
            verify_bunk_generation(bedroom/'reviewed.json')
        (bedroom/'raw-0.png').write_text('Changed raw bytes')
        with self.assertRaisesRegex(ValueError,'raw image changed'):
            verify_bunk_generation(bedroom/'reviewed.json')
        (bedroom/'sample.png').write_text('Changed exported bytes')
        for verifier in (load_reviewed_bunk,verify_bunk_generation):
            with self.assertRaisesRegex(ValueError,'image hash mismatch'):
                verifier(bedroom/'reviewed.json')

    def resign_raw(self, bedroom, catalog, raw, write):
        raw_hash = write(bedroom/'raw-proof.json', raw)
        manifest = json.loads((bedroom/'manifest.json').read_text())
        manifest['raw_proof_sha256'] = raw_hash
        manifest_hash = write(bedroom/'manifest.json', manifest)
        report = json.loads((bedroom/'comparison.json').read_text())
        report.update(raw_proof_sha256=raw_hash, manifest_sha256=manifest_hash)
        catalog['raw_proof']['sha256'] = raw_hash
        catalog['manifest']['sha256'] = manifest_hash
        catalog['comparison']['sha256'] = write(bedroom/'comparison.json', report)
        write(bedroom/'reviewed.json', catalog)

    def test_resigned_incomplete_contact_and_duplicate_paths_still_fail(self):
        bedroom, catalog, _, write = self.reviewed_fixture()
        original = json.loads((bedroom/'raw-proof.json').read_text())
        mutations = []
        for field, value in (('contact_samples', []),):
            raw = copy.deepcopy(original)
            raw[field] = value
            mutations.append(raw)
        raw = copy.deepcopy(original)
        raw['renders'][1]['path'] = raw['renders'][0]['path']
        mutations.append(raw)
        for field, value in (('frame', True), ('frame', 2), ('frame', 5), ('structural_inventory', []),
                             ('obstacles', []), ('excluded_visible_geometry', ['head']),
                             ('body_obstacle_overlap_candidates', [['head','post']]),
                             ('bounds', [[0,-1,0],[1,1,1]]), ('bounds', [[1,0,0],[0,0,0]]),
                             ('bounds', [[0,0,0],[float('nan'),0,0]]), ('support_samples', {})):
            raw = copy.deepcopy(original)
            raw['contact_samples'][0][field] = value
            mutations.append(raw)
        for field, value in (('contact_count', 2), ('query_count', 0),
                             ('ray_hits', True), ('min_gap', float('nan')),
                             ('min_gap', .02), ('contact_bounds', [[0,0,0],[0,0,0]])):
            raw = copy.deepcopy(original)
            raw['contact_samples'][0]['support_samples']['head_to_pillow'][field] = value
            mutations.append(raw)
        for index, raw in enumerate(mutations):
            self.resign_raw(bedroom, catalog, raw, write)
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, 'contact|raw path'):
                load_reviewed_bunk(bedroom/'reviewed.json')

    def test_full_generation_rejects_resigned_wrong_size_mode_and_format(self):
        bedroom, catalog, _, write = self.reviewed_fixture()
        raw = json.loads((bedroom/'raw-proof.json').read_text())
        for size, mode, format_ in (((200,272),'RGBA','PNG'), ((1280,1408),'RGB','PNG'),
                                    ((1280,1408),'RGBA','TIFF')):
            path = bedroom/raw['renders'][0]['path']
            Image.new(mode, size).save(path, format=format_)
            raw['renders'][0]['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            self.resign_raw(bedroom, catalog, raw, write)
            self.assertEqual(len(load_reviewed_bunk(bedroom/'reviewed.json').pairs),48)
            with self.subTest(size=size,mode=mode,format=format_), self.assertRaisesRegex(ValueError,'raw RGBA PNG'):
                verify_bunk_generation(bedroom/'reviewed.json')


if __name__ == '__main__':
    unittest.main()
