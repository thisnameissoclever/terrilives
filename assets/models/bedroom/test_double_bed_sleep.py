"""Causal checks for sleeping-layer math, ownership and terminal publication."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from double_bed_batch import expected_keys, groups
from double_bed_layers import reconstruct
from double_bed_receipt import SnapshotWriter, read_terminal
from export_double_bed_sleep import check_witnesses, check_exported_coverage
from double_bed_linear import encode as encode_linear, reconstruct as reconstruct_linear


class ReceiptTests(unittest.TestCase):
    def test_exit_is_required(self):
        with tempfile.TemporaryDirectory() as value:
            with self.assertRaisesRegex(ValueError, 'process exit'):
                read_terminal(Path(value), process_exited=False)

    @unittest.skipUnless(os.name == 'nt', 'Publisher uses Windows non-replacing rename')
    def test_complete_receipt_and_tamper(self):
        with tempfile.TemporaryDirectory() as value:
            directory = Path(value)
            writer = SnapshotWriter(directory)
            writer.publish('sample', {'state': 'running'})
            writer.finish({'state': 'complete'})
            self.assertEqual(read_terminal(directory, process_exited=True)['state'], 'complete')
            with patch('double_bed_receipt.hashlib.sha256') as digest:
                digest.return_value.hexdigest.return_value = 'different'
                with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                    read_terminal(directory, process_exited=True)

    @unittest.skipUnless(os.name == 'nt', 'Publisher uses Windows non-replacing rename')
    def test_sync_failure_cannot_publish_complete(self):
        with tempfile.TemporaryDirectory() as value:
            directory = Path(value)
            writer = SnapshotWriter(directory)
            with patch('double_bed_receipt.os.fsync', side_effect=OSError('failed synchronization')):
                with self.assertRaises(OSError):
                    writer.finish({'state': 'complete'})
            self.assertFalse((directory/'status.json').exists())
            self.assertTrue((directory/'status.pending').exists())

    @unittest.skipUnless(os.name == 'nt', 'Publisher uses Windows non-replacing rename')
    def test_second_writer_cannot_replace_terminal(self):
        with tempfile.TemporaryDirectory() as value:
            directory = Path(value)
            SnapshotWriter(directory).finish({'state': 'complete'})
            before = (directory/'status.json').read_bytes()
            with self.assertRaises(FileExistsError):
                SnapshotWriter(directory).finish({'state': 'failed'})
            self.assertEqual((directory/'status.json').read_bytes(), before)


class LayerTests(unittest.TestCase):
    def test_three_disjoint_owners_reconstruct(self):
        owners = [Image.new('RGBA', (1, 1), pixel) for pixel in
                  ((60, 0, 0, 85), (0, 60, 0, 85), (0, 0, 60, 85))]
        result = reconstruct(owners, Image.new('RGBA', (1, 1)))
        self.assertEqual(result.getpixel((0, 0)), (60, 60, 60, 255))

    def test_overlapping_complete_owners_fail(self):
        owners = [Image.new('RGBA', (1, 1), (255, 0, 0, 255))]*2
        with self.assertRaisesRegex(ValueError, 'coverage exceeds'):
            reconstruct(owners, Image.new('RGBA', (1, 1)))

    def test_unregistered_dimensions_fail(self):
        with self.assertRaisesRegex(ValueError, 'registered'):
            reconstruct([Image.new('RGBA', (1, 1))], Image.new('RGBA', (2, 1)))

    def test_inventory_is_complete_and_unique(self):
        self.assertEqual(len(groups(False)), 64)
        self.assertEqual(len(expected_keys(False)), 288)
        self.assertEqual(len(expected_keys(True)), 36)

    def test_owner_swap_fails_independently_of_commutative_rgb(self):
        shown = Image.new('RGBA', (1, 1), (30, 40, 50, 255))
        hidden = Image.new('RGBA', (1, 1))
        witnesses = {'sim0': [{'pixel': [0, 0]}]}
        check_witnesses({'sim0': shown}, witnesses)
        with self.assertRaisesRegex(ValueError, 'surface witness'):
            check_witnesses({'sim0': hidden}, witnesses)

    def test_missing_owner_witnesses_fail_closed(self):
        image = Image.new('RGBA', (1, 1), (20, 30, 40, 255))
        with self.assertRaisesRegex(ValueError, 'owner evidence'):
            check_witnesses({'sim0': image}, {})

    def test_exported_picking_mask_swap_fails(self):
        import hashlib
        with tempfile.TemporaryDirectory() as value:
            directory = Path(value)
            raw = Image.new('RGBA', (320, 352))
            raw.putpixel((0, 0), (40, 50, 60, 255))
            raw_path = directory/'sim0.png'
            raw.save(raw_path)
            mask_path = directory/'mask.png'
            Image.new('L', (320, 352), 255).save(mask_path)
            coverage = {'path': mask_path.name,
                        'sha256': hashlib.sha256(mask_path.read_bytes()).hexdigest()}
            manifest = {'crop': [0, 0, 320, 352], 'scenes': [
                {'occupancy': 1, 'facing': 'SW', 'palettes': ['green', 'green'], 'sample': 0,
                 'bodies': [{'place': 0, 'coverage': coverage}]}]}
            records = {(1, 'SW', 'green', 'green', 0, 'sim0'): raw_path}
            with self.assertRaisesRegex(ValueError, 'picking coverage'):
                check_exported_coverage(directory, directory, manifest, records)
            raw.getchannel('A').save(mask_path)
            coverage['sha256'] = hashlib.sha256(mask_path.read_bytes()).hexdigest()
            check_exported_coverage(directory, directory, manifest, records)

    def test_ink_over_does_not_commute_with_filtering(self):
        # This prevents adopting a texel-center identity as a filtered-image proof.
        fill_midpoint, ink_midpoint = .5, .5
        reconstructed_midpoint = fill_midpoint*(1-ink_midpoint)
        filtered_reference = .5
        self.assertEqual(reconstructed_midpoint, .25)
        self.assertNotEqual(reconstructed_midpoint, filtered_reference)

    def test_visible_linear_layers_encode_ink_before_filtering(self):
        fill = Image.new('RGBA', (1, 1), (255, 255, 255, 255))
        ink = Image.new('RGBA', (1, 1), (0, 0, 0, 128))
        parts = [encode_linear(fill, (1, 1), ink), encode_linear(ink, (1, 1))]
        self.assertEqual(parts[0].getpixel((0, 0)), (127, 127, 127, 127))
        self.assertEqual(reconstruct_linear(parts).getpixel((0, 0)), (187, 187, 187, 255))

    def test_additive_filtering_commutes_at_fractional_uv(self):
        fill = Image.new('RGBA', (2, 1), (255, 255, 255, 255))
        ink = Image.new('RGBA', (2, 1))
        ink.putpixel((0, 0), (0, 0, 0, 255))
        parts = [encode_linear(fill, (1, 1), ink), encode_linear(ink, (1, 1))]
        summed_rgb = sum(part.getpixel((0, 0))[0] for part in parts)
        self.assertEqual(summed_rgb, 128)
        self.assertLessEqual(abs(sum(part.getpixel((0, 0))[3] for part in parts)-255), 1)

    def test_missing_ink_is_a_causal_error(self):
        fill = Image.new('RGBA', (1, 1), (255, 255, 255, 255))
        ink = Image.new('RGBA', (1, 1), (0, 0, 0, 255))
        owner = encode_linear(fill, (1, 1), ink)
        self.assertEqual(reconstruct_linear([owner]).getpixel((0, 0))[3], 0)
        self.assertEqual(reconstruct_linear([owner, encode_linear(ink, (1, 1))]).getpixel((0, 0))[3], 255)


if __name__ == '__main__':
    unittest.main()
