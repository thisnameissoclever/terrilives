"""Coverage bytes leave the TypeScript and come back unchanged."""
import base64
import gzip
import hashlib
import os
from pathlib import Path
import re
import tempfile
import unittest

import coverage_payload
from coverage_payload import CoveragePayload, compress, existing_file, file_paths, restore

ROOT = Path(__file__).resolve().parents[3]


def record(values, **extra):
    width = len(values) // (2 if extra.get('bitDepth') == 16 or extra.get('encoding') == 'float16' else 1)
    return {'size': [width, 1], 'box': [0, 0, width, 1],
            'values': base64.b64encode(bytes(values)).decode('ascii'), **extra}


class CoveragePayloadTests(unittest.TestCase):
    def test_offsets_align_share_identical_bytes_and_restore_the_original_records(self):
        payload = CoveragePayload()
        first = record([1, 2, 3])
        wide = record([5, 0, 6, 0], bitDepth=16)
        half = record([0, 60, 0, 56], encoding='float16')
        placed = payload.place_all([first, wide, dict(first), half])
        self.assertEqual([item['offset'] for item in placed], [0, 4, 0, 8])
        self.assertEqual(list(placed[1]), ['size', 'box', 'offset', 'bitDepth'])
        self.assertNotIn('values', placed[0])
        data = payload.payload()
        self.assertEqual(data, bytes([1, 2, 3, 0, 5, 0, 6, 0, 0, 60, 0, 56]))
        self.assertEqual([restore(item, data) for item in placed], [first, wide, first, half])
        keyed = payload.place_values({'7': first, '3': half})
        self.assertEqual(list(keyed), ['7', '3'])
        self.assertEqual(keyed['3']['offset'], 8)
        with self.assertRaises(ValueError):
            restore({**placed[0], 'offset': len(data) - 1}, data)

    def test_compression_is_plain_gzip_with_a_fixed_header(self):
        data = bytes(range(256)) * 300
        packed = compress(data)
        self.assertEqual(packed, compress(data))
        self.assertEqual(packed[:10], b'\x1f\x8b\x08\x00\x00\x00\x00\x00\x02\xff')
        self.assertEqual(gzip.decompress(packed), data)

    def test_keeps_only_a_correctly_named_file_holding_the_same_payload(self):
        data = b'coverage' * 100
        packed = compress(data)
        name = coverage_payload.coverage_file_name(hashlib.sha256(packed).hexdigest())
        with tempfile.TemporaryDirectory() as public:
            self.assertIsNone(existing_file(public, data))
            Path(public, 'atlas-' + '0' * 64 + '.png').write_bytes(packed)
            Path(public, 'coverage-' + '1' * 64 + '.bin').write_bytes(packed)
            self.assertIsNone(existing_file(public, data))
            Path(public, name).write_bytes(packed)
            self.assertEqual(existing_file(public, data), packed)
            self.assertIsNone(existing_file(public, data + b'!'))
            self.assertEqual([os.path.basename(path) for path in file_paths(public)],
                             sorted(['coverage-' + '1' * 64 + '.bin', name]))

    def test_shipped_file_matches_its_name_and_the_tables_that_point_into_it(self):
        module = (ROOT / 'web/src/render/coverage-file.ts').read_text()
        name = re.search(r"COVERAGE_FILE_NAME = '([^']+)'", module).group(1)
        length = int(re.search(r'COVERAGE_BYTE_LENGTH = (\d+);', module).group(1))
        packed = (ROOT / 'web/public' / name).read_bytes()
        self.assertEqual(name, coverage_payload.coverage_file_name(hashlib.sha256(packed).hexdigest()))
        self.assertEqual(len(gzip.decompress(packed)), length)
        self.assertEqual([os.path.basename(path) for path in file_paths(ROOT / 'web/public')], [name])
        for path in ('web/src/render/atlas.ts', 'web/src/render/fixture-scene-masks.ts'):
            source = (ROOT / path).read_text()
            self.assertNotRegex(source, r'"values"\s*:')
            offsets = [int(offset) for offset in re.findall(r'"offset"\s*:\s*(\d+)', source)]
            self.assertTrue(offsets)
            self.assertTrue(all(offset % coverage_payload.ALIGNMENT == 0 and offset < length
                                for offset in offsets))


if __name__ == '__main__':
    unittest.main()
