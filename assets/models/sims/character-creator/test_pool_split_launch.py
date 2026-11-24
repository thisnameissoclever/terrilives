import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from derive_pool_forward_hop import write_pair as write_reference
from derive_pool_split_launch import write_pair
from derive_pool_supported_crest import canonical, digest


class SplitLaunchTest(unittest.TestCase):
    def test_crest_push_and_independent_exit(self):
        here=Path(__file__).parent
        with TemporaryDirectory() as temp:
            seed=Path(temp)
            (seed/'motion.json').write_bytes((here/'pool_activity_motion_v17.json').read_bytes())
            (seed/'contacts.json').write_bytes((here/'clips/pool/contacts-v6.json').read_bytes())
            reference=seed/'reference';result=seed/'result'
            write_reference(seed,reference)
            write_pair(reference,result)
            before=json.loads((reference/'contacts.json').read_bytes())
            raw=(result/'motion.json').read_bytes()
            motion=json.loads(raw)
            contact_bytes=(result/'contacts.json').read_bytes()
            fixture=json.loads(contact_bytes)
            self.assertEqual(raw,(here/'pool_activity_motion_v18.json').read_bytes())
            self.assertEqual(contact_bytes,(here/'clips/pool/contacts-v7.json').read_bytes())
        self.assertEqual(fixture['revisions']['poseProducer'],digest(raw))
        self.assertEqual(fixture['revisions']['clipLibrary'],digest(canonical(fixture['clips'])))
        hop=motion['forwardHop']
        keys={round(r['phase']*100000):r['limbs'] for r in fixture['clips']['pool_enter']['samples']}
        self.assertEqual([hop['launchFromUnit'],hop['takeoffUnit'],hop['waterContactUnit']],[42000,60000,87000])
        self.assertTrue(all(v['mode']=='support' for v in keys[42000].values()))
        self.assertEqual(keys[44000]['footL']['interval'],[.44,.48])
        self.assertEqual(keys[60000]['footR']['interval'],[.6,.6125])
        self.assertTrue(all(v['mode']=='free' for u,row in keys.items() if u>=61250 for v in row.values()))
        for origin in range(12):
            name=f'pool_exit_{origin}'
            self.assertEqual(fixture['clips'][name],before['clips'][name])
        self.assertTrue(all(k['entryUnit']<=42000 for k in hop['climbKeys'] if 'entryUnit' in k))
        self.assertTrue(all(k['exitReferenceUnit']==k['unit'] for k in hop['climbKeys'] if 'exitReferenceUnit' in k))
        self.assertEqual(motion['nativeTicks']['exit'],40)
