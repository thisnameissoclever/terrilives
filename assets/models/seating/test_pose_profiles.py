"""Neutral seat profiles preserve anatomy rather than stretching it to fit."""
import importlib.util
import math
from pathlib import Path
import unittest


class SeatProfileTests(unittest.TestCase):
    def module(self):
        spec = importlib.util.find_spec('pose_profiles')
        self.assertIsNotNone(spec,'Neutral seating needs measured pose profiles')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_leg_targets_preserve_lengths_and_distinguish_tall_seats(self):
        module = self.module()
        self.assertEqual(set(module.PROFILES),{'armchair','dining','office','sofa','ottoman','reading'})
        for kind in module.PROFILES:
            joints = module.leg_targets(kind,.37,.36)
            self.assertAlmostEqual(math.dist(joints['hip'],joints['knee']),.37,places=7)
            self.assertAlmostEqual(math.dist(joints['knee'],joints['ankle']),.36,places=7)
            if kind in ('office','sofa'):
                self.assertAlmostEqual(joints['knee'][1],.509)
                self.assertAlmostEqual(joints['ankle'][1],.15)
                self.assertGreater(module.PROFILES[kind]['foot_pitch'],8.)
            else:
                self.assertAlmostEqual(joints['ankle'][1],.13)
                self.assertEqual(module.PROFILES[kind]['foot_pitch'],0.)

    def test_sources_and_basis_match_accepted_furniture(self):
        module = self.module()
        root = Path(__file__).resolve().parents[1]
        for kind,profile in module.PROFILES.items():
            self.assertTrue((root/profile['source']).is_file(),kind)
            self.assertEqual(profile['body_turn'],0 if kind=='reading' else -90)
            self.assertEqual(profile['canvas'],[160,176] if kind=='sofa' else [96,120])
        self.assertEqual(module.PROFILES['office']['content'],'desk_chair')
        self.assertEqual(module.PROFILES['ottoman']['content'],'sofa')

    def test_impossible_anatomical_lengths_are_rejected(self):
        module = self.module()
        for length in (0.,-1.,float('nan'),.01):
            with self.assertRaises(ValueError):
                module.leg_targets('office',length,.36)


if __name__=='__main__': unittest.main()
