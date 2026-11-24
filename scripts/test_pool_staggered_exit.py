"""Check the paired ladder transfer and its independent numeric commands."""
import json
from pathlib import Path
import sys
import unittest

SOURCE = Path(__file__).resolve().parents[1]/'assets/models/sims/character-creator'
sys.path.insert(0, str(SOURCE))
from derive_pool_staggered_exit import BASE, NAMES, derive
from derive_pool_supported_crest import canonical, digest


class StaggeredExitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_motion = json.loads((SOURCE/'pool_activity_motion_v18.json').read_bytes())
        cls.original_fixture = json.loads((SOURCE/'clips/pool/contacts-v7.json').read_bytes())
        cls.original_route = json.loads((SOURCE/'clips/pool/ladder-climb-out-v1.poolroute').read_bytes())
        cls.raw = derive(SOURCE)
        cls.motion, cls.fixture, cls.route = (json.loads(data) for data in cls.raw)

    def test_reproduction_and_pairing(self):
        self.assertEqual(self.raw, derive(SOURCE))
        self.assertEqual(self.fixture['revisions']['poseProducer'], digest(self.raw[0]))
        self.assertEqual(self.route['motion'], digest(self.raw[0]))
        self.assertEqual(self.fixture['revisions']['clipLibrary'], digest(canonical(self.fixture['clips'])))
        self.assertEqual(self.original_route['motion'], BASE[0])
        self.assertEqual(NAMES[1], 'contacts-v8.json')

    def test_retains_clock_model_and_every_other_action(self):
        before, after = self.original_motion['forwardHop'], self.motion['forwardHop']
        self.assertEqual(before, {k:v for k,v in after.items() if k != 'outerGripTransfer'})
        restored={**self.motion, 'forwardHop':before}
        self.assertEqual((json.dumps(restored,indent=2)+'\n').encode(),(SOURCE/'pool_activity_motion_v18.json').read_bytes())
        self.assertEqual(self.motion['nativeTicks'], {'enter':20, 'paddle':60, 'exit':40, 'tickHz':10})
        self.assertEqual(self.motion['modelSource'], self.original_motion['modelSource'])
        for key in self.original_fixture:
            if key not in ('clips','revisions'):
                self.assertEqual(self.fixture[key], self.original_fixture[key])
        for action, clip in self.original_fixture['clips'].items():
            if not action.startswith('pool_exit_'):
                self.assertEqual(clip, self.fixture['clips'][action])

    def test_all_twelve_exits_keep_every_other_contact_and_the_real_left_regrip(self):
        for origin in range(12):
            action = f'pool_exit_{origin}'
            old, new = self.original_fixture['clips'][action], self.fixture['clips'][action]
            for kind in ('samples','intervals'):
                self.assertEqual(len(old[kind]),len(new[kind]))
                for a,b in zip(old[kind],new[kind]):
                    phase = b['phase'] if kind == 'samples' else (b['start']+b['end'])/2
                    if not .575 <= phase < .7403:
                        self.assertEqual(a,b)
                        continue
                    self.assertEqual({k:v for k,v in a.items() if k!='limbs'},{k:v for k,v in b.items() if k!='limbs'})
                    for limb in ('handR','footL','footR'):
                        self.assertEqual(a['limbs'][limb], b['limbs'][limb])
                    self.assertEqual(b['limbs']['handL']['mode'], 'free')
                    self.assertIsNone(b['limbs']['handL']['surface'])
            acquire = next(v for v in new['samples'] if v['phase']==.74769)
            self.assertEqual(acquire['limbs']['handL']['surface'], self.fixture['rails'][0]['id'])
            self.assertEqual(acquire['limbs']['handL']['interval'], [.7403,.74769])
            self.assertEqual(acquire['limbs']['handR']['mode'], 'support')

    def test_retracted_hand_uses_the_original_free_wrist_command(self):
        original={k['unit']:k for k in self.original_route['exitReferences']}
        tucked=original[69681]['limbs']['handL']
        self.assertNotIn('contact',tucked)
        for key in self.route['exitReferences']:
            previous=original[key['unit']]
            self.assertEqual({n:v for n,v in key.items() if n!='limbs'},{n:v for n,v in previous.items() if n!='limbs'})
            for limb in ('footR','footL','handR'):
                self.assertEqual(key['limbs'][limb],previous['limbs'][limb])
            self.assertEqual(key['limbs']['handL'],tucked if .575<=key['unit']/100000<=.69681 else previous['limbs']['handL'])


if __name__ == '__main__':
    unittest.main()
