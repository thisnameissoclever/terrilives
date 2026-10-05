"""A closed fish loop keeps attachments, containment and distinct motion."""
import importlib.util
import math
import unittest


class AquariumSwimTests(unittest.TestCase):
    def module(self):
        spec = importlib.util.find_spec('aquarium_swim')
        self.assertIsNotNone(spec, 'The aquarium still has only two fish poses')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_loop_has_eight_distinct_samples_and_no_return_jump(self):
        module = self.module()
        samples = [module.motion(i) for i in range(8)]
        self.assertEqual(len({str(sample) for sample in samples}), 8)
        self.assertEqual(module.motion(8), samples[0])
        for fish in range(3):
            deltas = [row[fish]['translation'] for row in samples]
            self.assertGreater(max(p[0] for p in deltas)-min(p[0] for p in deltas), .035)
            self.assertGreater(max(p[2] for p in deltas)-min(p[2] for p in deltas), .012)
            steps = [math.dist(deltas[i], deltas[(i+1)%8]) for i in range(8)]
            self.assertLess(max(steps), .025)
            self.assertGreater(max(row[fish]['tail_shift'] for row in samples)
                               -min(row[fish]['tail_shift'] for row in samples), .018)
        self.assertNotEqual([row[0]['translation'] for row in samples],
                            [row[1]['translation'] for row in samples])

    def test_full_fish_envelope_stays_in_water_and_below_lid_sightlines(self):
        module = self.module()
        from aquarium_layout import fish_poses
        for frame in range(8):
            for source, movement in zip(fish_poses(0), module.motion(frame)):
                x, y, z = [a+b for a,b in zip(source['center'], movement['translation'])]
                self.assertLess(abs(x)+.12, .398)
                self.assertLess(abs(y)+.045+abs(movement['tail_shift']), .32)
                self.assertGreater(z-.045, .79)
                self.assertLess(z+.045, 1.10)

    def test_phase_rejects_invalid_values(self):
        module = self.module()
        for value in (True, -1, 1.5, None):
            with self.assertRaises(ValueError):
                module.motion(value)


if __name__ == '__main__':
    unittest.main()
