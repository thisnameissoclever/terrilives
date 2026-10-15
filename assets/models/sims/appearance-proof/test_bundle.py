"""A runtime bundle must contain actual editable geometry and bone influences."""
import json
from pathlib import Path
import struct
import unittest

BASE = Path(__file__).resolve().parent
EXPORT = BASE / 'export-v2'


class BundleTests(unittest.TestCase):
    def test_material_ramp_interpolation_matches_source(self):
        manifest = json.loads((EXPORT/'manifest.json').read_text())
        source = json.loads((EXPORT/'material-ramp-source.json').read_text())
        for material in manifest['materials']:
            self.assertIn(material['interpolation'], ('CONSTANT', 'LINEAR', 'EASE'))
            if source.get(material['name']):
                self.assertEqual(material['interpolation'], source[material['name']][0]['interpolation'])

    def test_both_geometry_exports_have_normalized_weights_and_bounded_indices(self):
        manifest = json.loads((EXPORT / 'manifest.json').read_text())
        self.assertEqual(manifest['version'], 2)
        self.assertEqual(len(manifest['bones']), 17)
        self.assertIn('walk', manifest['actions'])
        self.assertIn('read', manifest['actions'])
        counts = []
        for key in ('original', 'runtime'):
            part = manifest[key]
            vertices = (EXPORT / part['vertices']).read_bytes()
            indices = (EXPORT / part['indices']).read_bytes()
            self.assertEqual(len(vertices), part['vertexCount'] * 64)
            self.assertEqual(len(indices), part['indexCount'] * 4)
            self.assertGreater(part['vertexCount'], 1000)
            counts.append(part['indexCount'])
            for v in struct.iter_unpack('<16f', vertices):
                self.assertAlmostEqual(sum(v[10:14]), 1, places=5)
                self.assertTrue(all(0 <= j < 17 and int(j) == j for j in v[6:10]))
                self.assertTrue(all(w >= 0 for w in v[10:14]))
            self.assertLess(max(i[0] for i in struct.iter_unpack('<I', indices)), part['vertexCount'])
        self.assertLess(counts[1], counts[0] * .65)

    def test_operator_matches_actual_source_poses_before_fitting(self):
        proof = json.loads((EXPORT/'subdivision-parity.json').read_text())
        self.assertEqual(proof['state'], 'complete')
        self.assertEqual(len(proof['operators']), 20)
        self.assertEqual(len(proof['rows']), 60)
        self.assertLess(max(row['maxError'] for row in proof['rows']), 2e-5)
        old = json.loads((BASE/'export/subdivision-parity-before.json').read_text())
        self.assertGreater(max(row['maxError'] for row in old['rows']), .03)

    def test_character_colors_do_not_classify_chair_as_hair(self):
        manifest=json.loads((EXPORT/'manifest.json').read_text())
        part=manifest['runtime']
        vertices=list(struct.iter_unpack('<16f',(EXPORT/part['vertices']).read_bytes()))
        indices=[x[0] for x in struct.iter_unpack('<I',(EXPORT/part['indices']).read_bytes())]
        seen=set()
        for mesh in part['parts']:
            if mesh['region']!=10: continue
            for i in indices[mesh['start']:mesh['start']+mesh['count']]: seen.add(int(vertices[i][14]))
        self.assertTrue(seen)
        for material in seen: self.assertEqual(manifest['materials'][material]['group'],5,manifest['materials'][material]['name'])


if __name__ == '__main__':
    unittest.main()
