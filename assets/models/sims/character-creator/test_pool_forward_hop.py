import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from derive_pool_forward_hop import write_pair, canonical, digest


class PoolForwardHop(unittest.TestCase):
    def test_entry_takeoff_and_distinct_exit_contacts(self):
        here = Path(__file__).parent
        with TemporaryDirectory() as temp:
            root = Path(temp)
            motion = (here/'pool_activity_motion_v17.json').read_bytes()
            fixture = (here/'clips/pool/contacts-v6.json').read_bytes()
            (root/'motion.json').write_bytes(motion)
            (root/'contacts.json').write_bytes(fixture)
            write_pair(root,root/'hop')
            result = json.loads((root/'hop/contacts.json').read_bytes())
            definition = (root/'hop/motion.json').read_bytes()
        self.assertEqual(result['revisions']['poseProducer'],digest(definition))
        self.assertEqual(result['revisions']['clipLibrary'],digest(canonical(result['clips'])))
        hop = json.loads(definition)['forwardHop']
        self.assertEqual(hop['takeoffUnit'],60000)
        self.assertEqual(json.loads(definition)['nativeTicks']['exit'],40)
        self.assertEqual(hop['footTransitions'][-1],{'limb':'footR','from':'crest',
                         'to':'free','startUnit':60000,'endUnit':75000})
        self.assertEqual(hop['bridgeEndUnit'],10000)
        entry = result['clips']['pool_enter']
        nodes = {round(r['phase']*100000):r['limbs'] for r in entry['samples']}
        self.assertEqual(nodes[60000]['footR']['mode'],'release')
        self.assertEqual(nodes[60000]['footR']['surface'],'Pool ladder crest landing')
        for unit,limbs in nodes.items():
            if unit >= 61250:
                self.assertTrue(all(s['mode']=='free' for s in limbs.values()))
        climb = result['clips']['pool_exit_0']
        self.assertEqual(hop['climbOutUnits'],[round(r['phase']*100000) for r in climb['samples']])
        for origin in range(1,12):
            self.assertEqual(climb,result['clips'][f'pool_exit_{origin}'])
        support = {round(r['phase']*100000):r['limbs'] for r in climb['samples']}
        timing={row['authoredUnit']:row['unit'] for row in hop['climbKeys'] if row['unit']<=65000}
        self.assertEqual(timing[25000],28000)
        self.assertEqual(support[timing[28500]]['footL']['surface'],'Pool inside ladder tread 2')
        self.assertEqual(support[timing[28500]]['footL']['mode'],'support')
        self.assertEqual(support[timing[25000]]['handR']['surface'],'Pool ladder rail 1')
        self.assertEqual(support[timing[58000]]['footR']['surface'],'Pool ladder crest landing')
        self.assertEqual(support[timing[64000]]['footR']['surface'],'Pool ladder crest landing')
        self.assertEqual(support[77000]['footL']['surface'],'Pool outside ladder tread 3')
        self.assertEqual({k['poseEntryUnit'] for k in hop['climbKeys'] if 'poseEntryUnit' in k},{48401,47410})
        source_units=[r['entryUnit'] for r in hop['climbKeys'] if 'entryUnit' in r]
        self.assertEqual(source_units,sorted(set(source_units),reverse=True))
        self.assertTrue({31999,32000,32001}.issubset(source_units))
        self.assertEqual(support[100000],nodes[0])


if __name__ == '__main__':
    unittest.main()
