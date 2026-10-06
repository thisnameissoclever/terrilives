"""Keep bathroom ownership tables separate from released seating tables."""
import unittest

from build import write_ts


class BathroomTablesTests(unittest.TestCase):
    def test_generator_emits_independent_bathroom_tables(self):
        result = write_ts([], {}, 2048, 2048, 'a'*64,
            bathroom_profiles={1:{18:{'action':18}}}, bathroom_layers={9:[4, 5, -1, 6]},
            bathroom_coverage={9:[0, 1, 2, 3]}, bathroom_masks=[])
        for name in ('BATHROOM_SPRITES', 'BATHROOM_LAYERS', 'BATHROOM_COVERAGE', 'BATHROOM_MASKS'):
            self.assertIn('export const '+name, result)
        self.assertIn('export const SEATING_SPRITES', result)


if __name__ == '__main__':
    unittest.main()
