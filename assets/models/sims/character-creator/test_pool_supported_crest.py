"""Check the alternate left-hand transfer and reversed support obligations on the widened pool clock."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from derive_pool_supported_crest import derive


class SupportedCrestPolicyTests(unittest.TestCase):
    def test_inside_release_and_reverse_have_the_same_physical_support(self):
        assets=Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'source';source.mkdir()
            motion=json.loads((assets/'pool_activity_motion_v16.json').read_bytes())
            motion['modelSource']='outdoor/pool_activity_model_v6.py'
            raw=json.dumps(motion).encode();(source/'motion.json').write_bytes(raw)
            fixture=json.loads((assets/'clips/pool/contacts-v5.json').read_bytes())
            fixture['revisions']['poseProducer']=hashlib.sha256(raw).hexdigest()
            (source/'contacts.json').write_text(json.dumps(fixture))
            derive(source,root/'candidate',release_inside=True)
            result=json.loads((root/'candidate/contacts.json').read_bytes())
            enter=result['clips']['pool_enter']['samples']
            for phase,mode in ((.50668,'release'),(.50787,'free'),(.51143,'approach'),(.51381,'support')):
                entry=next(s for s in enter if s['phase']==phase)
                self.assertEqual(entry['limbs']['handL']['mode'],mode)
                for limb in ('footR','handR'):
                    self.assertEqual(entry['limbs'][limb]['mode'],'support')
                for origin in range(12):
                    reverse=next(s for s in result['clips'][f'pool_exit_{origin}']['samples'] if s['travel']==phase)
                    self.assertEqual(reverse['limbs']['handL']['mode'],{'release':'approach','approach':'release'}.get(mode,mode))
                    self.assertEqual(reverse['limbs']['handL']['surface'],entry['limbs']['handL']['surface'])


if __name__=='__main__':
    unittest.main()
