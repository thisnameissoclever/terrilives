"""Reject forged, moved or incomplete bathing loop evidence that keeps its passed flags."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from bath_export_contract import (validate_contacts, validate_measurement, validate_closure, validate_geometry,
                                  validate_strokes, validate_appearance, validate_targets, validate_patch,
                                  validate_certificate, validate_reviewed_hit, validate_render_rows, validate_action,
                                  read_loop, nodded_tail, BATHE_ACTION, ACTION)
from bath_loop_v1 import head_nod
from bath_pose_geometry import validate_support_patch

BASE = Path(__file__).parent
LOOP = BASE/'review/bath/loop-02/proof.json'
INK = BASE/'review/bath/ink-02/proof.json'
ACCEPTED = BASE/'review/bath/prototype-12-wall-backed-water/proof.json'


class BathExportContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.loop = json.loads(LOOP.read_text())
        cls.ink = json.loads(INK.read_text())
        cls.accepted = json.loads(ACCEPTED.read_text())
        cls.targets = cls.accepted['measurement']['joint_targets']
        cls.plane = cls.accepted['plane']

    def contacts(self):
        return copy.deepcopy(self.loop['contacts'])

    def test_actual_loop_contacts_pass(self):
        for field in ('manual_contacts', 'contacts', 'reopened_contacts'):
            validate_contacts(copy.deepcopy(self.loop[field]), self.accepted)

    def test_accepted_source_measurement_passes_at_rest(self):
        validate_measurement(copy.deepcopy(self.accepted['measurement']), self.accepted, 0)

    def test_action_code_and_loop_shape_are_exact(self):
        self.assertEqual(BATHE_ACTION, 19)
        validate_action(dict(ACTION))
        validate_action(dict(ACTION, sample_fps=2.5))
        for bad in (dict(ACTION, loop_ticks=15), dict(ACTION, sample_fps=3), dict(ACTION, samples=4.0),
                    dict(ACTION, name='bath_idle_v2')):
            with self.assertRaises(ValueError):
                validate_action(bad)

    def test_support_patch_is_recomputed_from_witnesses_that_belong_to_the_grid(self):
        rows = self.contacts()
        hip = rows[1]['measurement']['support']['hip']
        validate_certificate(copy.deepcopy(hip), 'hip', self.plane)
        # Nine collinear witnesses with passed flags and a generous declared area.
        forged = copy.deepcopy(hip)
        cells = sorted(hip['complete_actual_grid'], key=lambda c:c['gap'])[:9]
        for index, cell in enumerate(cells):
            cell['x'], cell['y'] = .006+.006*index, -.648
        forged['complete_actual_grid'] = cells
        forged['actual_surface_ray_hits'] = 9
        forged['min_gap'], forged['max_gap'] = min(c['gap'] for c in cells), max(c['gap'] for c in cells)
        forged['finite_patch'] = dict(hip['finite_patch'], actual_witnesses=cells, samples=9)
        with self.assertRaises(ValueError):
            validate_certificate(forged, 'hip', self.plane)
        # Witnesses that are not cells of the measured grid are refused even when self-consistent.
        shifted = copy.deepcopy(hip)
        for cell in shifted['finite_patch']['actual_witnesses']:
            cell['body_z'] += 1e-4
            cell['gap'] += 1e-4
        with self.assertRaises(ValueError):
            validate_certificate(shifted, 'hip', self.plane)
        # A declared minimum gap below the witnesses is refused.
        understated = copy.deepcopy(hip)
        understated['finite_patch']['min_gap'] = 0
        with self.assertRaises(ValueError):
            validate_patch(understated['finite_patch'], understated['complete_actual_grid'], .006)
        # Certificate extrema must come from the grid.
        wrong_extrema = copy.deepcopy(hip)
        wrong_extrema['min_gap'] = 0
        with self.assertRaises(ValueError):
            validate_certificate(wrong_extrema, 'hip', self.plane)
        # A grid cell whose gap is not its surface pair is refused.
        broken_pair = copy.deepcopy(hip)
        broken_pair['complete_actual_grid'][0]['gap'] += .001
        with self.assertRaises(ValueError):
            validate_certificate(broken_pair, 'hip', self.plane)

    def test_patch_cannot_leave_the_contact_interval(self):
        hip = copy.deepcopy(self.loop['contacts'][0]['measurement']['support']['hip'])
        for cell in hip['complete_actual_grid']:
            cell['body_z'] += .004
            cell['gap'] += .004
        for cell in hip['finite_patch']['actual_witnesses']:
            cell['body_z'] += .004
            cell['gap'] += .004
        hip['min_gap'] += .004
        hip['max_gap'] += .004
        hip['finite_patch']['min_gap'] += .004
        hip['finite_patch']['max_gap'] += .004
        with self.assertRaises(ValueError):
            validate_certificate(hip, 'hip', self.plane)

    def test_reviewed_containment_hit_needs_even_parity_on_all_six_axes_and_clear_air_above(self):
        hit = copy.deepcopy(self.loop['contacts'][0]['measurement']['reviewed_open_mesh_containment_hits'][0])
        validate_reviewed_hit(hit)
        for mutate in (lambda h:h['review']['crossings'].__setitem__('+x', 1),
                       lambda h:h['review']['crossings'].pop('-y'),
                       lambda h:h['review'].__setitem__('parity_inside', True),
                       lambda h:h['review'].__setitem__('first_surface_above', .004),
                       lambda h:h.__setitem__('kind', 'body_inside_chair'),
                       lambda h:h.__setitem__('fixture', 'Bath opaque water surface'),
                       lambda h:h.__setitem__('point', [0, 0])):
            forged = copy.deepcopy(hit)
            mutate(forged)
            with self.assertRaises(ValueError):
                validate_reviewed_hit(forged)
        clear = copy.deepcopy(hit)
        clear['review']['first_surface_above'] = .02
        validate_reviewed_hit(clear)

    def test_patch_cannot_be_a_sparse_subset_of_the_measured_cells(self):
        hip = copy.deepcopy(self.loop['contacts'][1]['measurement']['support']['hip'])
        witnesses = hip['finite_patch']['actual_witnesses']
        xs, ys = sorted({w['x'] for w in witnesses}), sorted({w['y'] for w in witnesses})
        # A 3 by 3 corner subset with the same bounds and the same recomputed numbers.
        subset = [w for w in witnesses if w['x'] in (xs[0], xs[3], xs[6]) and w['y'] in (ys[0], ys[4], ys[8])]
        self.assertEqual(len(subset), 9)
        hip['finite_patch'] = validate_support_patch(copy.deepcopy(subset))
        with self.assertRaises(ValueError):
            validate_certificate(hip, 'hip', self.plane)
        # Every other column, still Cartesian among themselves.
        hip = copy.deepcopy(self.loop['contacts'][1]['measurement']['support']['hip'])
        stride = [w for w in witnesses if w['x'] in xs[::2]]
        hip['finite_patch'] = validate_support_patch(copy.deepcopy(stride))
        with self.assertRaises(ValueError):
            validate_certificate(hip, 'hip', self.plane)

    def test_grid_cells_must_sit_on_the_lattice_inside_the_basin_without_duplicates(self):
        hip = copy.deepcopy(self.loop['contacts'][0]['measurement']['support']['hip'])
        validate_certificate(hip, 'hip', self.plane)
        padded = copy.deepcopy(hip)
        padded['complete_actual_grid'] += [dict(c, x=5+.006*i, y=9) for i, c in enumerate(hip['complete_actual_grid'][:50])]
        padded['actual_surface_ray_hits'] = len(padded['complete_actual_grid'])
        with self.assertRaises(ValueError):
            validate_certificate(padded, 'hip', self.plane)
        # A patch lifted past the contact limit cannot borrow contact from a stray zero-gap cell elsewhere.
        zero = copy.deepcopy(hip)
        witnesses = {(w['x'], w['y']) for w in zero['finite_patch']['actual_witnesses']}
        for cell in zero['complete_actual_grid']:
            if (cell['x'], cell['y']) in witnesses:
                cell['body_z'] += .0021
                cell['gap'] += .0021
        zero['finite_patch'] = validate_support_patch(copy.deepcopy(
            [c for c in zero['complete_actual_grid'] if (c['x'], c['y']) in witnesses]))
        zero['complete_actual_grid'].append(dict(hip['complete_actual_grid'][0], x=.102, y=-.3, gap=0, body_z=.15, basin_z=.15))
        zero['actual_surface_ray_hits'] += 1
        zero['min_gap'] = 0
        zero['max_gap'] = max(c['gap'] for c in zero['complete_actual_grid'])
        with self.assertRaises(ValueError):
            validate_certificate(zero, 'hip', self.plane)
        duplicated = copy.deepcopy(hip)
        duplicated['complete_actual_grid'] += copy.deepcopy(hip['complete_actual_grid'][:20])
        duplicated['actual_surface_ray_hits'] += 20
        with self.assertRaises(ValueError):
            validate_certificate(duplicated, 'hip', self.plane)
        off_lattice = copy.deepcopy(hip)
        off_lattice['complete_actual_grid'][7]['x'] += .001
        with self.assertRaises(ValueError):
            validate_certificate(off_lattice, 'hip', self.plane)
        lifted = copy.deepcopy(hip)
        for cell in lifted['complete_actual_grid']+lifted['finite_patch']['actual_witnesses']:
            cell['basin_z'] += .02
            cell['body_z'] += .02
        with self.assertRaises(ValueError):
            validate_certificate(lifted, 'hip', self.plane)

    def test_wall_cells_must_be_normal_pairs_on_the_accepted_plane(self):
        back = copy.deepcopy(self.loop['contacts'][0]['measurement']['support']['back'])
        validate_certificate(back, 'back', self.plane)
        with self.assertRaises(ValueError):
            validate_certificate(copy.deepcopy(back), 'hip', self.plane)
        hip = copy.deepcopy(self.loop['contacts'][0]['measurement']['support']['hip'])
        with self.assertRaises(ValueError):
            validate_certificate(hip, 'back', self.plane)
        slid = copy.deepcopy(back)
        for cell in slid['finite_patch']['actual_witnesses']:
            cell['wall_point'][1] += .05
        with self.assertRaises(ValueError):
            validate_certificate(slid, 'back', self.plane)
        for cell in slid['complete_actual_grid']:
            cell['wall_point'][1] += .05
        with self.assertRaises(ValueError):
            validate_certificate(slid, 'back', self.plane)
        wrong_gap = copy.deepcopy(back)
        wrong_gap['complete_actual_grid'][3]['body_point'][2] += .01
        with self.assertRaises(ValueError):
            validate_certificate(wrong_gap, 'back', self.plane)
        # A body point slid along the wall tangent keeps the gap but is no longer the normal ray pair.
        slid_body = copy.deepcopy(back)
        for cell in slid_body['complete_actual_grid']:
            cell['body_point'][0] += .05
        with self.assertRaises(ValueError):
            validate_certificate(slid_body, 'back', self.plane)
        swapped = self.contacts()
        for row in swapped:
            support = row['measurement']['support']
            support['hip'], support['back'] = support['back'], support['hip']
        with self.assertRaises(ValueError):
            validate_contacts(swapped, self.accepted)

    def test_reviewed_hits_must_equal_the_accepted_static_trouser_hits(self):
        rows = self.contacts()
        rows[2]['measurement']['reviewed_open_mesh_containment_hits'].append(dict(
            body='Sculpted head', fixture='Bathtub continuous shell', kind='chair_inside_body', point=[0, -.8, .9],
            review=dict(crossings={'+z':0, '-z':0, '+x':0, '-x':0, '+y':0, '-y':0}, parity_inside=False,
                        first_surface_above=None, verdict='outside by ray parity')))
        with self.assertRaises(ValueError):
            validate_contacts(rows, self.accepted)
        rows = self.contacts()
        rows[1]['measurement']['reviewed_open_mesh_containment_hits'].pop()
        with self.assertRaises(ValueError):
            validate_contacts(rows, self.accepted)
        rows = self.contacts()
        del rows[0]['measurement']['collisions']
        with self.assertRaises(ValueError):
            validate_contacts(rows, self.accepted)
        hit = copy.deepcopy(self.accepted['measurement']['reviewed_open_mesh_containment_hits'][0])
        for mutate in (lambda h:h.__setitem__('body', 'Sculpted head'),
                       lambda h:h.__setitem__('fixture', 'Bathtub tap handle 0.135'),
                       lambda h:h.__setitem__('point', [0, -.8, .9])):
            forged = copy.deepcopy(hit)
            mutate(forged)
            with self.assertRaises(ValueError):
                validate_reviewed_hit(forged)

    def test_head_nod_must_turn_about_the_side_axis_with_its_length_kept(self):
        accepted_head = self.targets['head']
        for frame in range(5):
            expected = nodded_tail(accepted_head, head_nod(frame/4))
            actual = self.loop['contacts'][frame]['measurement']['joint_targets']['head']['tail']
            self.assertLess(max(abs(a-b) for a, b in zip(actual, expected)), 1e-6)
        rows = self.contacts()
        head = rows[2]['measurement']['joint_targets']['head']
        # The same three degrees about a different perpendicular axis.
        joint, tail = head['head'], head['tail']
        direction = [t-j for t, j in zip(tail, joint)]
        turned = [direction[0]*0.99863+direction[2]*0.05234, direction[1], -direction[0]*0.05234+direction[2]*0.99863]
        head['tail'] = [j+d for j, d in zip(joint, turned)]
        with self.assertRaises(ValueError):
            validate_contacts(rows, self.accepted)
        rows = self.contacts()
        head = rows[2]['measurement']['joint_targets']['head']
        # A backward nod of the same magnitude.
        head['tail'] = nodded_tail(accepted_head, -head_nod(.5))
        with self.assertRaises(ValueError):
            validate_contacts(rows, self.accepted)
        rows = self.contacts()
        head = rows[0]['measurement']['joint_targets']['head']
        head['tail'] = [j+2*(t-j) for t, j in zip(head['tail'], head['head'])]
        rows[0]['measurement']['bone_length_errors']['head'] = 0
        with self.assertRaises(ValueError):
            validate_contacts(rows, self.accepted)

    def test_forged_reviewed_hit_cannot_hide_a_collision_in_a_passed_sample(self):
        rows = self.contacts()
        measurement = rows[2]['measurement']
        measurement['reviewed_open_mesh_containment_hits'].append(dict(
            body='Sculpted head', fixture='Bathtub continuous shell', kind='chair_inside_body', point=[0, -.8, .9],
            review=dict(crossings={'+z':1, '-z':1, '+x':0, '-x':0, '+y':0, '-y':0}, parity_inside=False,
                        first_surface_above=None)))
        with self.assertRaises(ValueError):
            validate_contacts(rows, self.accepted)

    def test_static_bones_must_equal_the_accepted_pose_exactly(self):
        rows = self.contacts()
        rows[1]['measurement']['joint_targets']['hand.L']['tail'][2] += 1e-6
        with self.assertRaises(ValueError):
            validate_contacts(rows, self.accepted)
        rows = self.contacts()
        rows[3]['measurement']['joint_targets']['hips']['head'][1] -= .02
        with self.assertRaises(ValueError):
            validate_contacts(rows, self.accepted)

    def test_head_may_only_nod_by_the_declared_phase_angle(self):
        rows = self.contacts()
        # Frame 2 is the three-degree extreme; claiming it at frame 0 is refused.
        rows[0]['measurement']['joint_targets']['head'] = copy.deepcopy(rows[2]['measurement']['joint_targets']['head'])
        with self.assertRaises(ValueError):
            validate_contacts(rows, self.accepted)
        rows = self.contacts()
        rows[1]['measurement']['joint_targets']['head']['head'][2] += 1e-5
        with self.assertRaises(ValueError):
            validate_contacts(rows, self.accepted)
        rows = self.contacts()
        head = rows[2]['measurement']['joint_targets']['head']
        head['tail'][1] -= .05
        with self.assertRaises(ValueError):
            validate_contacts(rows, self.accepted)
        self.assertAlmostEqual(validate_targets(self.loop['contacts'][2]['measurement']['joint_targets'],
                                                self.targets, head_nod(.5)), 3, places=4)
        with self.assertRaises(ValueError):
            validate_targets(self.loop['contacts'][2]['measurement']['joint_targets'], self.targets, 3.5)

    def test_lost_support_collision_and_short_pair_count_reject(self):
        for mutate in (lambda m:m.__setitem__('support_state', 'failed'),
                       lambda m:m.__setitem__('collisions', [dict(body='Shaped shoe', fixture='Bathtub drain')]),
                       lambda m:m.__setitem__('complete_body_fixture_pairs', 647),
                       lambda m:m['support'].pop('back'),
                       lambda m:m['bone_length_errors'].__setitem__('shin.L', 1e-3)):
            rows = self.contacts()
            mutate(rows[0]['measurement'])
            with self.assertRaises(ValueError):
                validate_contacts(rows, self.accepted)

    def test_missing_duplicate_or_mislabelled_sample_rejects(self):
        rows = self.contacts()
        for candidate in (rows[:-1], rows+[rows[0]]):
            with self.assertRaises(ValueError):
                validate_contacts(copy.deepcopy(candidate), self.accepted)
        rows = self.contacts()
        rows[1]['phase'] = .5
        with self.assertRaises(ValueError):
            validate_contacts(rows, self.accepted)

    def test_closure_targets_must_match_accepted_pose(self):
        closure = copy.deepcopy(self.loop['closure'])
        validate_closure(closure, self.targets)
        closure['named_bones']['head']['head'][0] = 1000
        with self.assertRaises(ValueError):
            validate_closure(closure, self.targets)
        closure = copy.deepcopy(self.loop['closure'])
        closure['limb_movement'] = True
        with self.assertRaises(ValueError):
            validate_closure(closure, self.targets)

    def test_appearance_must_omit_exactly_the_declared_garment_details(self):
        appearance, inventory = copy.deepcopy(self.loop['bathing_appearance']), list(self.loop['rendered_body_inventory'])
        validate_appearance(appearance, inventory)
        forged = copy.deepcopy(appearance)
        forged['omitted_render_details'][0] = 'Sculpted head'
        with self.assertRaises(ValueError):
            validate_appearance(forged, inventory)
        forged = copy.deepcopy(appearance)
        forged['material_assignments']['Overshirt body']['shower_material'] = 'Washed sage overshirt'
        with self.assertRaises(ValueError):
            validate_appearance(forged, inventory)
        forged = copy.deepcopy(appearance)
        del forged['material_assignments']['Relaxed shirt sleeve.001']
        with self.assertRaises(ValueError):
            validate_appearance(forged, inventory)
        with self.assertRaises(ValueError):
            validate_appearance(appearance, inventory[:-1]+['Shirt placket'])

    def test_geometry_checks_pin_the_fixture_on_every_frame_of_a_facing(self):
        rows = copy.deepcopy(self.loop['geometry_checks'])
        inventory = self.loop['rendered_body_inventory']
        validate_geometry(rows, inventory)
        moved = copy.deepcopy(rows)
        moved[3]['fixture']['Bathtub continuous shell'] = '0'*64
        with self.assertRaises(ValueError):
            validate_geometry(moved, inventory)
        water = copy.deepcopy(rows)
        water[1]['fixture']['Bath opaque water surface'] = '1'*64
        with self.assertRaises(ValueError):
            validate_geometry(water, inventory)
        clipped = copy.deepcopy(rows)
        clipped[0]['minimum_canvas_margin'] = 7.9
        with self.assertRaises(ValueError):
            validate_geometry(clipped, inventory)
        missing = copy.deepcopy(rows)
        del missing[5]['body']['Sculpted head']
        with self.assertRaises(ValueError):
            validate_geometry(missing, inventory)
        with self.assertRaises(ValueError):
            validate_geometry(rows[:-1], inventory)

    def test_ink_strokes_must_cover_exactly_the_rendered_inventory(self):
        rows = copy.deepcopy(self.ink['stroke_ownership'])
        inventory = self.loop['rendered_body_inventory']
        validate_strokes(rows, inventory)
        forged = copy.deepcopy(rows)
        forged[0]['body_owned_stroke_inventory'][0] = 'Shirt placket'
        with self.assertRaises(ValueError):
            validate_strokes(forged, inventory)
        forged = copy.deepcopy(rows)
        forged[2]['fixture_geometry_hidden'] = True
        with self.assertRaises(ValueError):
            validate_strokes(forged, inventory)
        with self.assertRaises(ValueError):
            validate_strokes(rows[:-1], inventory)

    def test_render_matrix_needs_one_appearance_with_unique_exact_paths(self):
        rows = copy.deepcopy(self.loop['renders'])
        validate_render_rows(rows)
        with self.assertRaises(ValueError):
            validate_render_rows(rows[:-1])
        for mutate in (lambda r:r.__setitem__('variant', 'blue'), lambda r:r.__setitem__('frame', 1.0),
                       lambda r:r.__setitem__('path', '../escape.png'), lambda r:r.__setitem__('sha256', 'abc')):
            forged = copy.deepcopy(rows)
            mutate(forged[0])
            with self.assertRaises(ValueError):
                validate_render_rows(forged)

    def test_source_reader_rejects_live_writer_and_receipts_outside_the_review_directory(self):
        with self.assertRaises(ValueError):
            read_loop(LOOP, process_exited=False)
        with tempfile.TemporaryDirectory() as directory:
            outside = Path(directory)/'proof.json'
            outside.write_text(LOOP.read_text())
            with self.assertRaises(ValueError):
                read_loop(outside, process_exited=True)


if __name__ == '__main__':
    unittest.main()
