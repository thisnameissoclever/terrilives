"""Reject forged, moved or incomplete fridge reach evidence that keeps its passed flags."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

import fridge_export_contract as contract
import fridge_reach_geometry as geo
from export_fridge_reach import export, registered_anchor, scene_anchor

BASE = Path(__file__).parent
BATCH = BASE/'review/fridge/batch-04/proof.json'
INK = BASE/'review/fridge/ink-04/proof.json'


class FridgeExportContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.proof = json.loads(BATCH.read_text())
        cls.ink = json.loads(INK.read_text())

    def forged(self):
        return copy.deepcopy(self.proof)

    def test_authentic_receipts_pass(self):
        contract.read_batch(BATCH, process_exited=True)
        contract.read_ink(INK, BATCH, self.proof)

    def test_live_writer_and_foreign_directory_are_refused(self):
        with self.assertRaises(ValueError):
            contract.read_batch(BATCH, process_exited=False)
        with tempfile.TemporaryDirectory() as directory:
            copy_path = Path(directory)/'proof.json'
            copy_path.write_text(BATCH.read_text())
            with self.assertRaises(ValueError):
                contract.read_batch(copy_path, process_exited=True)

    def test_action_code_and_schedule_are_exact(self):
        self.assertEqual(contract.FETCH_ACTION, 22)
        contract.validate_action(copy.deepcopy(self.proof['action']))
        for field, value in (('door_degrees', [0, 20, 55, 90, 80, 80, 45, 0]), ('samples', 6),
                             ('reach_samples', [3, 4]), ('playback', 'loop'),
                             ('left_hand', ['rest']*8), ('name', 'fridge_reach_v2')):
            action = dict(self.proof['action'], **{field: value})
            with self.assertRaises(ValueError, msg=field):
                contract.validate_action(action)

    def test_a_recorded_collision_or_thin_gap_is_refused(self):
        rows = self.forged()['samples']
        rows[4]['clearance']['collisions'] = [dict(body='Relaxed palm', solid='Food shelf 0.8', kind='surface')]
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)
        rows = self.forged()['samples']
        rows[1]['clearance']['minimum_door_gap'] = .002
        rows[1]['clearance']['minimum_gap'] = .002
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)
        # A minimum that disagrees with its own parts is inconsistent even when large.
        rows = self.forged()['samples']
        rows[2]['clearance']['minimum_gap'] = .2
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)
        # Dropping a body surface or fixture solid from the inventory is refused.
        rows = self.forged()['samples']
        rows[3]['clearance']['body_inventory'].remove('Relaxed palm')
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)
        rows = self.forged()['samples']
        rows[3]['clearance']['fixture_solids'].remove('Food shelf 0.8')
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)

    def test_the_palm_must_be_inside_the_cabinet_by_its_coordinates(self):
        rows = self.forged()['samples']
        rows[4]['palm']['centroid'][1] = -.60
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)
        rows = self.forged()['samples']
        rows[4]['palm']['centroid'][2] = .90
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)
        rows = self.forged()['samples']
        rows[4]['palm']['inside'] = False
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)
        rows = self.forged()['samples']
        rows[2]['palm'] = copy.deepcopy(rows[4]['palm'])
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)

    def test_planted_feet_bone_lengths_and_closure_are_enforced(self):
        rows = self.forged()['samples']
        rows[4]['joint_targets']['foot.L']['tail'][1] += .01
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)
        rows = self.forged()['samples']
        rows[3]['bone_length_errors']['forearm.L'] = .02
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)
        rows = self.forged()['samples']
        rows[7]['joint_targets']['head']['tail'][0] += .01
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)
        rows = self.forged()['samples']
        rows[1], rows[6] = rows[6], rows[1]
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)

    def test_door_sweeps_must_be_complete_and_clear(self):
        rows = self.forged()['sweeps']
        contract.validate_sweeps(rows)
        with self.assertRaises(ValueError):
            contract.validate_sweeps(rows[:-1])
        rows = self.forged()['sweeps']
        rows[1]['collisions'] = [dict(t=.5, angle=37.5, body='Pocket top seam', solid='Refrigerator door', kind='surface')]
        with self.assertRaises(ValueError):
            contract.validate_sweeps(rows)
        rows = self.forged()['sweeps']
        rows.append(copy.deepcopy(rows[0]))
        with self.assertRaises(ValueError):
            contract.validate_sweeps(rows)
        rows = self.forged()['sweeps']
        rows[1]['end'] = 80
        with self.assertRaises(ValueError):
            contract.validate_sweeps(rows)

    def test_the_body_stays_in_the_front_tile_column_at_its_scheduled_stance(self):
        rows = self.forged()['samples']
        rows[4]['body_extent'][0] = -.62
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)
        rows = self.forged()['samples']
        rows[2]['stance'] = list(geo.STANCES['REACH'])
        with self.assertRaises(ValueError):
            contract.validate_samples(rows)

    def test_the_case_must_not_move_and_the_door_only_turns(self):
        proof = self.forged()
        contract.validate_fixture(proof['fixture_checks'], proof['margins'])
        moved = self.forged()
        row = next(r for r in moved['fixture_checks'] if r['facing'] == 'SW' and r['sample'] == 4)
        row['fixture']['Case side -1'] = '0'*64
        with self.assertRaises(ValueError):
            contract.validate_fixture(moved['fixture_checks'], moved['margins'])
        swung = self.forged()
        row = next(r for r in swung['fixture_checks'] if r['facing'] == 'SE' and r['sample'] == 2)
        row['door_hinge_deviation']['Refrigerator handle'] = .01
        with self.assertRaises(ValueError):
            contract.validate_fixture(swung['fixture_checks'], swung['margins'])
        # Two samples at the same door angle must draw the same door.
        drifted = self.forged()
        row = next(r for r in drifted['fixture_checks'] if r['facing'] == 'NE' and r['sample'] == 5)
        row['fixture']['Refrigerator door'] = '1'*64
        with self.assertRaises(ValueError):
            contract.validate_fixture(drifted['fixture_checks'], drifted['margins'])
        clipped = self.forged()
        clipped['margins'][0]['bounds'][0] = 10.0
        clipped['margins'][0]['minimum_margin'] = 10.0
        with self.assertRaises(ValueError):
            contract.validate_fixture(clipped['fixture_checks'], clipped['margins'])

    def test_padding_cannot_move_the_fixture(self):
        contract.validate_registration(self.forged())
        shifted = self.forged()
        shifted['origin_pixels'][0] += 8
        with self.assertRaises(ValueError):
            contract.validate_registration(shifted)
        rescaled = self.forged()
        rescaled['ortho_scale'] *= 1.01
        with self.assertRaises(ValueError):
            contract.validate_registration(rescaled)
        repadded = self.forged()
        repadded['padding'] = [27, 21, 26, 22]
        with self.assertRaises(ValueError):
            contract.validate_registration(repadded)
        restarted = self.forged()
        restarted['accepted_registration']['origin_pixels'] = [384.0, 761.0]
        with self.assertRaises(ValueError):
            contract.validate_registration(restarted)

    def test_scene_anchor_lands_on_the_padded_empty_anchor(self):
        self.assertEqual(registered_anchor(), [48.0000114440918+geo.PADDING[0], 116.0004369020462+geo.PADDING[1]])
        anchor = scene_anchor(self.proof['origin_pixels'])
        self.assertTrue(all(abs(a-b) <= 1e-4 for a, b in zip(anchor, registered_anchor())))

    def test_palette_geometry_must_match_across_shirts(self):
        rows = self.forged()['geometry_palette_checks']
        contract.validate_geometry_palettes(rows)
        row = next(r for r in rows if r['variant'] == 'red' and r['frame'] == 3)
        row['geometry']['body']['Relaxed palm'] = '2'*64
        with self.assertRaises(ValueError):
            contract.validate_geometry_palettes(rows)

    def test_case_silhouette_outside_door_and_body_must_equal_the_empty_fixture(self):
        empty = Image.new('RGBA', (6, 6), (10, 20, 30, 255))
        empty.putpixel((0, 0), (0, 0, 0, 0))
        clear = Image.new('RGBA', (6, 6))
        door = clear.copy()
        door.putpixel((1, 1), (0, 0, 0, 255))
        same = empty.copy()
        same.putpixel((1, 1), (200, 0, 0, 0))
        result = contract.case_preservation(same, clear, empty, door, clear)
        self.assertEqual((result['max_alpha_difference'], result['compared_pixels'], result['shaded_pixels']), (0, 35, 0))
        # A shadow darkens the case without changing its silhouette.
        shaded = empty.copy()
        shaded.putpixel((4, 4), (2, 20, 30, 255))
        result = contract.case_preservation(shaded, clear, empty, door, clear)
        self.assertEqual((result['max_alpha_difference'], result['shaded_pixels']), (0, 1))
        # A moved case uncovers a pixel and covers another.
        moved = empty.copy()
        moved.putpixel((0, 0), (10, 20, 30, 255))
        moved.putpixel((5, 5), (0, 0, 0, 0))
        self.assertEqual(contract.case_preservation(moved, clear, empty, door, clear)['max_alpha_difference'], 255)

    def test_unfinished_writer_creates_no_export(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/'export'
            with self.assertRaises(ValueError):
                export(BATCH, INK, output, process_exited=False)
            self.assertFalse(output.exists())

    def test_ink_must_bind_the_exact_source(self):
        ink = copy.deepcopy(self.ink)
        ink['source_proof_sha256'] = '0'*64
        with tempfile.TemporaryDirectory(dir=BASE/'review/fridge') as directory:
            path = Path(directory)/'proof.json'
            path.write_text(json.dumps(ink))
            with self.assertRaises(ValueError):
                contract.read_ink(path, BATCH, self.proof)


if __name__ == '__main__':
    unittest.main()


class FridgeSceneDepthTests(unittest.TestCase):
    """The exported per-pixel depth keeps the drawn body in front of the shipped corner's walls."""

    def test_no_body_pixel_lies_behind_a_wall_face_and_no_fixture_pixel_reads_farther_than_empty(self):
        import numpy as np
        export = BASE/'export/fridge-03'
        manifest = json.loads((export/'manifest.json').read_text())
        obj = manifest['objects'][0]
        anchor_x = obj['anchor'][0]
        face = geo.WALL_FACE
        checked = 0
        for row in obj['scenes']:
            if row['variant'] != 'green':
                continue
            depth = np.asarray(Image.open(export/row['depth']['path']), dtype=np.int64)
            body = np.asarray(Image.open(export/row['coverage']['body']['path']))
            furniture = np.asarray(Image.open(export/row['coverage']['furniture']['path']))
            encoded = depth[:, :, 0]*256+depth[:, :, 1]
            nearness = encoded/65535*4-2
            columns = ((np.arange(depth.shape[1])+.5)/2-anchor_x)/32
            # Every covered pixel has a surface depth.
            self.assertFalse(((body > 0) & (depth[:, :, 3] == 0)).any())
            self.assertFalse(((furniture > 0) & (depth[:, :, 3] == 0)).any())
            visible_body = (body > 127) & (body >= furniture)
            x = (nearness+columns[None, :])/2
            y = (nearness-columns[None, :])/2
            if row['facing'] == 'SW':
                # The shipped placement: walls behind the fridge and along the
                # front tile's handle side, their faces 0.43 from the tile edges' centres.
                self.assertTrue((x[visible_body] >= -face-1e-3).all(), row['frame'])
                self.assertTrue((y[visible_body] >= -face-1e-3).all(), row['frame'])
            fixture = (furniture > body) & (depth[:, :, 3] > 0)
            self.assertTrue((nearness[fixture] >= -1e-4).all())
            checked += int(visible_body.sum())
        self.assertGreater(checked, 1000)
