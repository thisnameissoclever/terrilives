import json
from pathlib import Path
import unittest


CHARACTERS = Path(__file__).resolve().parents[1] / 'assets/models/sims/character-creator'


class PoolInsetEntryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.motion = json.loads((CHARACTERS / 'pool_activity_motion_v22.json').read_bytes())
        cls.clips = json.loads((CHARACTERS / 'clips/pool/contacts-v11.json').read_bytes())['clips']

    def test_shared_standing_node_owns_the_same_support_in_every_clip(self):
        standing = self.clips['pool_enter']['samples'][0]['limbs']
        self.assertEqual(['support', 'support'], [standing[limb]['mode'] for limb in ('footL', 'footR')])
        for origin in range(12):
            with self.subTest(origin=origin):
                self.assertEqual(standing, self.clips[f'pool_exit_{origin}']['samples'][-1]['limbs'])

    def test_dry_step_lands_before_the_first_grasp(self):
        hop = self.motion['forwardHop']
        approach = hop['insetEntry']
        step = approach['steps'][0]
        self.assertEqual(('footR', 'ground', 'ground'), (step['limb'], step['fromPlace'], step['toPlace']))
        self.assertLess(step['land'], approach['grip']['start'])
        samples = {round(s['phase'] * self.motion['clockUnits']): s['limbs']
                   for s in self.clips['pool_enter']['samples']}
        self.assertEqual('support', samples[step['land']]['footR']['mode'])
        for hand in ('handL', 'handR'):
            self.assertEqual('free', samples[step['land']][hand]['mode'])
            held = samples[approach['grip']['end']][hand]
            self.assertEqual('support', held['mode'])
            self.assertEqual({'kind': 'rail', 'parameter': [3, 6]}, held['region'])


if __name__ == '__main__':
    unittest.main()
