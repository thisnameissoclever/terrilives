"""Reject incomplete or non-finite toilet animation contact evidence."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image

from bathroom_export_contract import validate_action, validate_contacts, validate_render_rows, validate_registration, validate_closure, read_loop, validate_ink_binding, encode_raw_scene, validate_geometry, validate_strokes, validate_palettes


class BathroomExportContractTests(unittest.TestCase):
    def rows(self):
        original = json.loads((Path(__file__).parent/'review/toilet/prototype-08-curved-support/proof.json').read_text())
        return [dict(variant=v, frame=f, phase=f/4,
            physical_metrics=copy.deepcopy(original['physical_metrics']),
            curved_support=copy.deepcopy(original['curved_support']))
            for v in ('green', 'blue', 'red') for f in range(5)]

    def test_actual_complete_contact_matrix_passes(self):
        validate_contacts(self.rows())

    def test_source_matrices_and_material_changes_cannot_be_omitted(self):
        loop = json.loads((Path(__file__).parent/'review/toilet/loop-01/proof.json').read_text())
        ink = json.loads((Path(__file__).parent/'review/toilet/ink-01/proof.json').read_text())
        validate_geometry(loop['geometry_palette_checks'])
        validate_strokes(ink['stroke_ownership'])
        validate_palettes(loop['palettes'])
        for checker in (validate_geometry, validate_strokes):
            with self.assertRaises(ValueError):
                checker([])
        loop['palettes']['blue']['material_changes'] = []
        with self.assertRaises(ValueError):
            validate_palettes(loop['palettes'])

    def test_palette_cannot_scale_both_colours_away_from_frozen_setter(self):
        loop = json.loads((Path(__file__).parent/'review/toilet/loop-01/proof.json').read_text())
        for variant in ('blue', 'red'):
            for change in loop['palettes'][variant]['material_changes']:
                for stop in change['after']:
                    stop['color'][:3] = [channel*.8 for channel in stop['color'][:3]]
        with self.assertRaises(ValueError):
            validate_palettes(loop['palettes'])

    def test_closure_targets_must_match_accepted_pose(self):
        loop = json.loads((Path(__file__).parent/'review/toilet/loop-01/proof.json').read_text())
        accepted = json.loads((Path(__file__).parent/'review/toilet/prototype-08-curved-support/proof.json').read_text())
        targets = accepted['physical_metrics']['joint_targets']
        validate_closure(loop['closure'], targets)
        loop['closure']['named_bones']['head']['head'][0] = 1000
        with self.assertRaises(ValueError):
            validate_closure(loop['closure'], targets)

    def test_missing_closure_or_duplicate_sample_rejects(self):
        rows = self.rows()
        for candidate in (rows[:-1], rows+[rows[0]]):
            with self.assertRaises(ValueError):
                validate_contacts(candidate)

    def test_nonfinite_gap_and_actual_collision_reject(self):
        rows = self.rows()
        rows[0]['physical_metrics']['ring_min_gap'] = float('nan')
        with self.assertRaises(ValueError):
            validate_contacts(rows)
        rows = self.rows()
        rows[0]['physical_metrics']['collisions'] = [{'body':'Tailored trouser leg','fixture':'Toilet open seat ring'}]
        with self.assertRaises(ValueError):
            validate_contacts(rows)

    def test_curved_region_cannot_use_bounding_area(self):
        rows = self.rows()
        rows[0]['curved_support']['eligible_regions'][0]['area'] = .0001
        with self.assertRaises(ValueError):
            validate_contacts(rows)

    def test_incomplete_named_body_or_bone_inventory_rejects(self):
        rows = self.rows()
        rows[0]['physical_metrics']['body_inventory'].pop()
        with self.assertRaises(ValueError):
            validate_contacts(rows)

    def test_shortened_hand_evidence_and_boolean_phase_reject(self):
        rows = self.rows()
        rows[0]['physical_metrics']['hand_clothing_proximity'].pop()
        with self.assertRaises(ValueError):
            validate_contacts(rows)
        rows = self.rows()
        rows[0]['phase'] = False
        with self.assertRaises(ValueError):
            validate_contacts(rows)

    def test_partition_cannot_claim_area_outside_its_cell(self):
        rows = self.rows()
        polygon = rows[0]['curved_support']['continuous_cells'][0]['mirrored_pair'][0]['partitions'][0]['polygon_xy']
        for point in polygon:
            point[0] += 1
        with self.assertRaises(ValueError):
            validate_contacts(rows)

    def test_overlapping_half_cell_partitions_cannot_hide_missing_coverage(self):
        rows = self.rows()
        cell = rows[0]['curved_support']['continuous_cells'][0]
        ix, iy = cell['cell']
        x, y = ix*.003, -.1+iy*.003
        polygon = [[x,y],[x+.0015,y],[x+.0015,y+.003],[x,y+.003]]
        cert = cell['mirrored_pair'][0]
        partition = dict(body_triangle=0, seat_triangle=0, polygon_xy=polygon,
                         gaps=[cert['min_gap'],cert['max_gap'],cert['min_gap'],cert['max_gap']])
        cert['partitions'] = [copy.deepcopy(partition),copy.deepcopy(partition)]
        with self.assertRaises(ValueError):
            validate_contacts(rows)

    def test_negative_ray_count_and_negative_hand_distance_reject(self):
        rows = self.rows()
        rows[0]['physical_metrics']['ring_ray_hits'] = -5
        with self.assertRaises(ValueError):
            validate_contacts(rows)
        rows = self.rows()
        hand = rows[0]['physical_metrics']['hand_clothing_proximity'][0]
        hand['min_surface_distance'], hand['max_surface_distance'] = -1, -2
        with self.assertRaises(ValueError):
            validate_contacts(rows)

    def test_partition_cannot_wind_twice_around_half_a_cell(self):
        rows = self.rows()
        cell = rows[0]['curved_support']['continuous_cells'][0]
        ix, iy = cell['cell']
        x, y = ix*.003, -.1+iy*.003
        polygon = [[x,y],[x+.0015,y],[x+.0015,y+.003],[x,y+.003]] * 2
        cert = cell['mirrored_pair'][0]
        cert['partitions'] = [dict(body_triangle=0, seat_triangle=0, polygon_xy=polygon,
            gaps=[cert['min_gap'],cert['max_gap']]*4)]
        with self.assertRaises(ValueError):
            validate_contacts(rows)

    def half_cell_partition(self, rows, polygon):
        cell = rows[0]['curved_support']['continuous_cells'][0]
        ix, iy = cell['cell']
        x, y = ix*.003, -.1+iy*.003
        rectangle = [[x,y],[x+.0015,y],[x+.0015,y+.003],[x,y+.003]]
        cert = cell['mirrored_pair'][0]
        shape = polygon(x, y, rectangle)
        cert['partitions'] = [dict(body_triangle=0, seat_triangle=0, polygon_xy=shape,
            gaps=[cert['min_gap'],cert['max_gap']]*(len(shape)//2))]
        return rows

    def test_near_double_winding_with_distinct_vertices_cannot_claim_full_cell_support(self):
        rows = self.half_cell_partition(self.rows(),
            lambda x, y, rectangle: rectangle+[[px+1e-10, py] for px, py in rectangle])
        with self.assertRaises(ValueError):
            validate_contacts(rows)

    def test_denormal_shift_clockwise_and_sliver_partitions_reject(self):
        denormal = lambda x, y, rectangle: rectangle+[[px+5e-324, py] for px, py in rectangle]
        clockwise = lambda x, y, rectangle: [[x,y],[x,y+.003],[x+.003,y+.003],[x+.003,y]]
        sliver = lambda x, y, rectangle: [[x,y],[x+.0015,y],[x+.003,y]]
        for polygon in (denormal, clockwise, sliver):
            with self.assertRaises(ValueError):
                validate_contacts(self.half_cell_partition(self.rows(), polygon))

    def thin_strip_rows(self):
        # One hundred strips whose areas sum to the whole cell within 1e-12 square metres,
        # each overlapping its neighbour by just under the 1e-12 pairwise tolerance. The
        # union therefore leaves a hole of about 9.8e-11 square metres on the right that
        # only the exact cover bound can see.
        rows = self.rows()
        cell = rows[0]['curved_support']['continuous_cells'][0]
        ix, iy = cell['cell']
        x, y, d = ix*.003, -.1+iy*.003, .003
        count, width, overlap = 100, .003/100, .99e-12/.003
        cert = cell['mirrored_pair'][0]
        cert['partitions'] = [dict(body_triangle=0, seat_triangle=0,
            polygon_xy=[[x+i*(width-overlap), y], [x+i*(width-overlap)+width, y],
                        [x+i*(width-overlap)+width, y+d], [x+i*(width-overlap), y+d]],
            gaps=[cert['min_gap'], cert['max_gap']]*2) for i in range(count)]
        return rows

    def test_many_thin_overlapping_strips_cannot_hide_a_hole(self):
        with self.assertRaises(ValueError):
            validate_contacts(self.thin_strip_rows())

    def test_only_the_exact_cover_bound_sees_the_thin_strip_hole(self):
        # The pairwise overlap and area-sum checks accept this forgery; disabling the
        # exact bound must make it pass, which pins the mechanism the previous test relies on.
        import bathroom_export_contract as contract
        from unittest import mock
        with mock.patch.object(contract, 'uncertified_cell_area', lambda bounds, polygons: 0):
            validate_contacts(self.thin_strip_rows())

    def test_two_full_cells_and_overlapping_three_quarter_halves_reject(self):
        full = lambda x, y, rectangle: [[x,y],[x+.003,y],[x+.003,y+.003],[x,y+.003]]
        for shapes in ((full, full), (lambda x, y, r: [[x,y],[x+.00225,y],[x+.00225,y+.003],[x,y+.003]],
                                      lambda x, y, r: [[x+.00075,y],[x+.003,y],[x+.003,y+.003],[x+.00075,y+.003]])):
            rows = self.rows()
            cell = rows[0]['curved_support']['continuous_cells'][0]
            ix, iy = cell['cell']
            x, y = ix*.003, -.1+iy*.003
            cert = cell['mirrored_pair'][0]
            cert['partitions'] = [dict(body_triangle=0, seat_triangle=0, polygon_xy=shape(x, y, None),
                gaps=[cert['min_gap'], cert['max_gap']]*2) for shape in shapes]
            with self.assertRaises(ValueError):
                validate_contacts(rows)

    def test_spike_and_reversal_partitions_cannot_claim_full_cell_support(self):
        spike = lambda x, y, rectangle: rectangle[:2]+[[x+.0015, y+.003], [x+.003, y+.0015], [x+.0015+1e-10, y+.003]]+rectangle[3:]
        reversal = lambda x, y, rectangle: [rectangle[0], rectangle[1], [x+.003, y], rectangle[1], rectangle[2], rectangle[3]]
        for polygon in (spike, reversal):
            with self.assertRaises(ValueError):
                validate_contacts(self.half_cell_partition(self.rows(), polygon))

    def test_action_codes_and_loop_duration_are_exact(self):
        action = dict(name='toilet_idle_v1', samples=4, closure_frame=4, half_cycle_ticks=8, loop_ticks=16)
        validate_action(action)
        with self.assertRaises(ValueError):
            validate_action(dict(action, loop_ticks=32))

    def test_source_sample_rate_is_pinned_when_recorded(self):
        action = dict(name='toilet_idle_v1', samples=4, closure_frame=4,
                      half_cycle_ticks=8, loop_ticks=16, sample_fps=2.5)
        validate_action(action)
        with self.assertRaises(ValueError):
            validate_action(dict(action, sample_fps=10))

    def test_registration_matches_the_accepted_source_exactly(self):
        accepted = json.loads((Path(__file__).parent/'review/toilet/prototype-08-curved-support/proof.json').read_text())
        registration = {key:copy.deepcopy(accepted[key]) for key in
                        ('original_render_dimensions', 'origin_pixels', 'camera_matrix', 'ortho_scale')}
        registration.update(logical_canvas=[96, 120], source_density=8)
        validate_registration(registration, accepted)
        registration['origin_pixels'][0] += .001
        with self.assertRaises(ValueError):
            validate_registration(registration, accepted)

    def test_closure_requires_exact_saved_and_manual_endpoint_evidence(self):
        accepted = json.loads((Path(__file__).parent/'review/toilet/prototype-08-curved-support/proof.json').read_text())
        closure = dict(manual_exact_phase0=True, manual_exact_endpoint=True, saved_exact_phase0=True,
            saved_exact_endpoint=True, all54_evaluated=True, foot_movement=False,
            complete_body_inventory=accepted['physical_metrics']['body_inventory'],
            named_bones=accepted['physical_metrics']['joint_targets'])
        validate_closure(closure)
        with self.assertRaises(ValueError):
            validate_closure(dict(closure, saved_exact_endpoint=False))

    def test_source_reader_rejects_live_writer_and_unfinished_receipt(self):
        with self.assertRaises(ValueError):
            read_loop(Path('does-not-exist.json'), process_exited=False)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'proof.json'
            path.write_text(json.dumps(dict(schema=1, state='running')))
            with self.assertRaises(ValueError):
                read_loop(path, process_exited=True)

    def test_body_ink_binds_the_exact_completed_source_and_model(self):
        loop = dict(inputs={'one.py':'a'*64}, editable_model={'sha256':'b'*64},
            original_render_dimensions=[768, 960], origin_pixels=[384, 760],
            camera_matrix=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]], ortho_scale=3)
        ink = dict(schema=1, state='complete', immutable_inputs_preserved=True,
            source_proof_sha256='c'*64, source_model_sha256='b'*64, inputs=loop['inputs'],
            original_render_dimensions=loop['original_render_dimensions'], origin_pixels=loop['origin_pixels'],
            camera_matrix=loop['camera_matrix'], ortho_scale=loop['ortho_scale'])
        validate_ink_binding(ink, loop, 'c'*64)
        with self.assertRaises(ValueError):
            validate_ink_binding(dict(ink, source_proof_sha256='d'*64), loop, 'c'*64)

    def test_encoded_scene_keeps_visible_body_and_fixture_ownership(self):
        raw = {owner:Image.new('RGBA', (4, 4)) for owner in ('beauty', 'sim', 'furniture', 'lines')}
        raw['sim'].putpixel((1, 1), (60, 40, 20, 255))
        raw['furniture'].putpixel((2, 2), (90, 80, 70, 255))
        raw['lines'].putpixel((1, 0), (32, 32, 32, 255))
        ink = raw['lines'].copy()
        raw['beauty'] = Image.alpha_composite(Image.alpha_composite(raw['furniture'], raw['sim']), raw['lines'])
        layers, coverage, comparison, reconstruction = encode_raw_scene(raw, ink, (4, 4))
        self.assertEqual(set(layers), {'body', 'furniture', 'ink'})
        self.assertEqual(set(coverage), {'body', 'furniture', 'ink', 'bodyInk'})
        self.assertEqual(coverage['body'].getpixel((1, 1)), 255)
        self.assertEqual(coverage['furniture'].getpixel((1, 1)), 0)
        self.assertLessEqual(comparison['scene']['max_error'], 6)
        self.assertEqual(reconstruction.size, (4, 4))

    def render_rows(self):
        return [dict(facing=f, variant=v, frame=i, owner=o,
            path=f'{f}-{v}-{i}-{o}.png', sha256='a'*64)
            for f in ('SE', 'NW', 'SW', 'NE') for v in ('green', 'blue', 'red')
            for i in range(4) for o in ('beauty', 'sim', 'furniture', 'lines')]

    def test_complete_raw_render_matrix_has_unique_paths(self):
        self.assertEqual(len(validate_render_rows(self.render_rows())), 192)
        rows = self.render_rows()
        rows[1]['path'] = rows[0]['path']
        with self.assertRaises(ValueError):
            validate_render_rows(rows)

    def test_missing_palette_unsafe_path_and_boolean_sample_reject(self):
        rows = self.render_rows()
        for changed in (rows[:-1], [dict(rows[0], path='../escape.png')]+rows[1:],
                        [dict(rows[0], frame=False)]+rows[1:]):
            with self.assertRaises(ValueError):
                validate_render_rows(changed)


if __name__ == '__main__':
    unittest.main()
