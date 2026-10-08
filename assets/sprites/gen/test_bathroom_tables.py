"""Keep bathroom ownership tables separate from released seating tables."""
import unittest

from build import fixture_masks_ts, write_ts


class BathroomTablesTests(unittest.TestCase):
    def test_generator_emits_independent_bathroom_tables(self):
        result = write_ts([], {}, 2048, 2048, 'a'*64,
            bathroom_profiles={1:{18:{'action':18}}}, bathroom_layers={9:[4, 5, -1, 6]},
            bathroom_coverage={9:[0, 1, 2, 3]}, bathroom_masks=[])
        for name in ('BATHROOM_SPRITES', 'BATHROOM_LAYERS', 'BATHROOM_COVERAGE'):
            self.assertIn('export const '+name, result)
        # The masks live in their own module, re-exported unchanged.
        self.assertIn("export { BATHROOM_MASKS } from './fixture-scene-masks.js';", result)
        self.assertIn('export const BATHROOM_MASKS', fixture_masks_ts([]))
        self.assertIn('export const SEATING_SPRITES', result)


if __name__ == '__main__':
    unittest.main()
