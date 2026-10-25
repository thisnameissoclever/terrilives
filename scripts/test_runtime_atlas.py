"""Exact storage and CPU-mask regression tests."""
import tempfile
import unittest
import gzip
from pathlib import Path
from unittest.mock import patch

import numpy as np

import runtime_atlas as atlas


class CodecTests(unittest.TestCase):
    def round_trip(self, pages):
        with tempfile.TemporaryDirectory() as directory:
            with atlas.TileStore(Path(directory) / 'tiles', tile_size=2) as store:
                lookup = [store.add_page(page) for page in pages]
                for page, entries in zip(pages, lookup):
                    atlas.verify_page(page, entries, store.read, store.count, tile_size=2)
                return store.count, lookup

    def test_exact_rgba_and_duplicate_pages(self):
        page = np.arange(64, dtype=np.uint8).reshape(4, 4, 4)
        page[1, 1] = [37, 83, 91, 0]
        count, lookups = self.round_trip([page, page.copy()])
        self.assertEqual(count, 4)
        np.testing.assert_array_equal(*lookups)

    def test_halo_only_and_colored_transparent_blocks_are_retained(self):
        page = np.zeros((4, 4, 4), dtype=np.uint8)
        page[0, 2] = [17, 0, 0, 0]
        count, lookups = self.round_trip([page])
        self.assertEqual(count, 2)
        self.assertTrue(lookups[0][0])
        self.assertTrue(lookups[0][1])
        self.assertEqual(lookups[0][2], 0)

    def test_edge_border_clamps_and_corruption_is_rejected(self):
        page = np.zeros((4, 4, 4), dtype=np.uint8)
        page[0, 0] = [2, 3, 4, 255]
        with tempfile.TemporaryDirectory() as directory:
            with atlas.TileStore(Path(directory) / 'tiles', tile_size=2) as store:
                entries = store.add_page(page)
                block = np.frombuffer(store.read(0), dtype=np.uint8).reshape(4, 4, 4)
                np.testing.assert_array_equal(block[0, 0], page[0, 0])
                for bad in (np.zeros_like(entries), entries + 100, entries[:-1]):
                    with self.assertRaises(ValueError):
                        atlas.verify_page(page, bad, store.read, store.count, tile_size=2)
                damaged = bytearray(store.read(0))
                damaged[0] ^= 1
                with self.assertRaises(ValueError):
                    atlas.verify_page(page, entries, lambda _: bytes(damaged), store.count, tile_size=2)

    def test_invalid_dimensions(self):
        with self.assertRaises(ValueError):
            list(atlas.bordered_blocks(np.zeros((3, 4, 4), dtype=np.uint8), 2))

    def test_valid_but_wrong_mapping_and_changed_center_are_rejected(self):
        page = np.arange(64, dtype=np.uint8).reshape(4, 4, 4)
        with tempfile.TemporaryDirectory() as directory:
            with atlas.TileStore(Path(directory) / 'tiles', tile_size=2) as store:
                entries = store.add_page(page)
                with self.assertRaises(ValueError):
                    atlas.verify_page(page, entries[::-1], store.read, store.count, tile_size=2)
                altered = page.copy()
                altered[1, 1, 3] ^= 1
                with self.assertRaises(ValueError):
                    atlas.verify_page(altered, entries, store.read, store.count, tile_size=2)

    def test_independent_verifier_rejects_poisoned_producer_traversal_and_halos(self):
        page = np.arange(64, dtype=np.uint8).reshape(4, 4, 4)
        correct_blocks = list(atlas.bordered_blocks(page, tile_size=2))
        column_first = [correct_blocks[index] for index in (0, 2, 1, 3)]
        damaged = bytearray(correct_blocks[0])
        damaged[0] ^= 1
        bad_halo = [bytes(damaged), *correct_blocks[1:]]
        for label, poisoned in [('column-first traversal', column_first), ('wrong halo', bad_halo)]:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                with atlas.TileStore(Path(directory) / 'tiles', tile_size=2) as store:
                    # Leave the producer fault installed while verifying. A shared
                    # extraction oracle would incorrectly accept its own mistake.
                    with patch.object(atlas, 'bordered_blocks', side_effect=lambda *_: iter(poisoned)):
                        entries = store.add_page(page)
                        with self.assertRaises(ValueError):
                            atlas.verify_page(page, entries, store.read, store.count, tile_size=2)


class CoverageTests(unittest.TestCase):
    def test_body_bits_and_partial_alpha_round_trip(self):
        alpha = np.array([255, 0, 1, 254, 255, 32, 0, 255, 255], dtype=np.uint8)
        opaque, indices, partial = atlas.body_mask(alpha)
        self.assertEqual(opaque, bytes([145, 1]))
        self.assertEqual(indices, np.array([2, 3, 5], dtype='<u4').tobytes())
        self.assertEqual(partial, bytes([1, 254, 32]))

    def test_decoded_body_mask_matches_source_and_rejects_invalid_partial_indices(self):
        alpha = np.array([[255, 0, 1, 254, 255, 32, 0, 255, 255]], dtype=np.uint8)
        sprite = {'name': 'body', 'x': 0, 'y': 0, 'w': 9, 'h': 1}
        page = np.zeros((1, 9, 4), dtype=np.uint8)
        page[:, :, 3] = alpha
        builder = atlas.CoverageBuilder(([sprite], [0], [], []))
        builder.add_page(0, page)
        payload, records = builder.finish()
        row = records['bodies'][0]
        np.testing.assert_array_equal(atlas.decode_body_mask(payload, row, 9), alpha.reshape(-1))
        corrupted = bytearray(payload)
        offset = row['partialPixels'][0]
        corrupted[offset:offset + 4] = (9).to_bytes(4, 'little')
        with self.assertRaises(ValueError):
            atlas.decode_body_mask(corrupted, row, 9)

    def test_indicator_threshold_and_density(self):
        alpha = np.array([[255, 0], [0, 32], [31, 0]], dtype=np.uint8)
        self.assertEqual(atlas.indicator_bottom(alpha, 2), 1)
        with self.assertRaises(ValueError):
            atlas.indicator_bottom(np.zeros((2, 2), dtype=np.uint8), 1)

    def test_json_initializer_does_not_execute_typescript(self):
        source = 'export const TEST: readonly number[] = [1, 2];\nthrow new Error();'
        self.assertEqual(atlas.json_initializer(source, 'TEST'), [1, 2])
        with self.assertRaises(ValueError):
            atlas.json_initializer('export const TEST = [1] + evil();', 'TEST')

    def test_payload_keeps_exact_dish_alpha_and_aligned_body_indices(self):
        sprites = [{'name': 'body', 'x': 0, 'y': 0, 'w': 2, 'h': 2},
                   {'name': 'dish', 'x': 0, 'y': 0, 'w': 2, 'h': 2},
                   {'name': 'activityTest', 'x': 0, 'y': 0, 'w': 2, 'h': 2, 'pixel_density': 2}]
        page = np.zeros((2, 2, 4), dtype=np.uint8)
        page[:, :, 3] = [[255, 1], [31, 32]]
        builder = atlas.CoverageBuilder((sprites, [0], [1], [2]))
        builder.add_page(0, page)
        payload, records = builder.finish()
        self.assertEqual(payload[:4], b'ACV1')
        body = records['bodies'][0]
        offset, count = body['partialPixels']
        self.assertEqual(offset % 4, 0)
        np.testing.assert_array_equal(np.frombuffer(payload, dtype='<u4', count=count, offset=offset), [1, 2, 3])
        offset, length = records['dishes'][0]['alpha']
        self.assertEqual(payload[offset:offset + length], bytes([255, 1, 31, 32]))
        self.assertEqual(records['indicators'], [{'sprite': 2, 'bottomPixels': 1}])

    def test_missing_source_page_cannot_silently_drop_coverage(self):
        builder = atlas.CoverageBuilder(([{'page': 1}], [0], [], []))
        with self.assertRaises(ValueError):
            builder.finish()

    def test_typescript_and_toml_sprite_identities_must_match(self):
        source = "export const SPRITES: readonly AtlasSprite[] = [\n  atlasSprite({ name: 'body', x: 0, y: 1, w: 2, h: 3, pixel_density: 2, page: 4 }),\n];"
        rows = [{'name': 'body', 'x': 0, 'y': 1, 'w': 2, 'h': 3, 'pixel_density': 2, 'page': 4}]
        atlas.validate_sprite_catalog(source, rows)
        with self.assertRaises(ValueError):
            atlas.validate_sprite_catalog(source.replace("'body'", "'other'"), rows)
        with self.assertRaises(ValueError):
            atlas.validate_sprite_catalog(source.replace('page: 4', 'page: 5'), rows)


class PayloadTests(unittest.TestCase):
    def test_binary_hash_header_length_and_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'web/public/atlas-storage'
            output.mkdir(parents=True)
            data = b'ATL1' + bytes(16)
            record = atlas.write_binary(output, 'lookup', data)
            encoded = (root / 'web/public' / record['file']).read_bytes()
            self.assertIn(atlas.sha256(encoded), record['file'])
            self.assertEqual(record['sha256'], atlas.sha256(data))
            self.assertEqual(atlas.read_binary(root, record, b'ATL1'), data)
            for altered in ({**record, 'length': 1}, {**record, 'sha256': 'f' * 64}):
                with self.assertRaises(ValueError):
                    atlas.read_binary(root, altered, b'ATL1')
            with self.assertRaises(ValueError):
                atlas.read_binary(root, record, b'ACV1')
            path = root / 'web/public' / record['file']
            path.write_bytes(gzip.compress(data[:-1]))
            with self.assertRaises(ValueError):
                atlas.read_binary(root, record, b'ATL1')

    def test_equivalent_gzip_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            data = b'ATL1' + bytes(1000)
            record = atlas.write_binary(output, 'lookup', data)
            path = output / Path(record['file']).name
            other = gzip.compress(data, compresslevel=1, mtime=17)
            path.unlink()
            other_path = output / f'lookup-{atlas.sha256(other)}.bin.gz'
            other_path.write_bytes(other)
            updated = atlas.write_binary(output, 'lookup', data)
            self.assertEqual(updated, {**record, 'file': f'atlas-storage/{other_path.name}'})
            self.assertEqual(other_path.read_bytes(), other)


if __name__ == '__main__':
    unittest.main()
