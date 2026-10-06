"""Steam stroke exclusion preserves body, fixture and water line ownership."""
import unittest

from shower_render import expected_strokes, source_receipt_equal, validate_stroke_selection


class ShowerRenderTests(unittest.TestCase):
    def test_saved_receipt_equality_normalizes_json_container_types_only(self):
        actual = dict(overlap_edges=[('A', 'B')], margin=.004)
        saved = dict(overlap_edges=[['A', 'B']], margin=.004)
        self.assertTrue(source_receipt_equal(actual, saved))
        changed = dict(overlap_edges=[('A', 'B')], margin=.004+1e-12)
        self.assertFalse(source_receipt_equal(changed, saved))
        self.assertFalse(source_receipt_equal(dict(overlap_edges=[('B', 'A')], margin=.004), saved))
        with self.assertRaises(ValueError):
            source_receipt_equal(dict(margin=float('nan')), saved)

    def test_all_render_owners_exclude_only_steam(self):
        body = {'Head', 'Upper arm'}
        furniture = {'Panel', 'Nozzle', 'Water jet', 'Opaque core', 'Cloud lobe'}
        steam = {'Opaque core', 'Cloud lobe'}
        for owner in ('beauty', 'lines'):
            expected = expected_strokes(owner, body, furniture, steam)
            self.assertEqual(expected, body | {'Panel', 'Nozzle', 'Water jet'})
            validate_stroke_selection(expected, expected, steam)
        for owner in ('sim', 'sim_lines'):
            self.assertEqual(expected_strokes(owner, body, furniture, steam), body)
        for owner in ('furniture', 'furniture_lines'):
            self.assertEqual(expected_strokes(owner, body, furniture, steam),
                             {'Panel', 'Nozzle', 'Water jet'})

    def test_restored_steam_outlines_and_wrong_owner_are_rejected(self):
        wanted = {'Head', 'Water jet'}
        with self.assertRaisesRegex(ValueError, 'Steam outline selection restored'):
            validate_stroke_selection(wanted | {'Cloud lobe'}, wanted, {'Cloud lobe'})
        with self.assertRaisesRegex(ValueError, 'stroke ownership'):
            validate_stroke_selection({'Head'}, wanted, {'Cloud lobe'})
        with self.assertRaises(ValueError):
            expected_strokes('unknown', {'Head'}, {'Cloud lobe'}, {'Cloud lobe'})


if __name__ == '__main__':
    unittest.main()
