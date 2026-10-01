import copy
import json
import unittest
from PIL import Image
from offline_architecture import (SOURCE,load_reviewed_architecture,validate_manifest,
                                  validate_pixels,generated_files,ArchitectureExport)


class ArchitectureImport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config=json.loads((SOURCE/'architecture.json').read_text())
        cls.directory=SOURCE/config['batch']
        cls.data=json.loads((cls.directory/'manifest.json').read_text())
        cls.proof=json.loads((cls.directory/'render-proof.json').read_text())

    def test_window_catalogue_is_complete(self):
        batch=load_reviewed_architecture()
        self.assertEqual(set(batch.window_ids),set(range(1,10)))
        self.assertEqual(batch.widths,{1:1,2:1,3:1,4:2,5:2,6:2,7:3,8:3,9:3})
        self.assertEqual(batch.missing_directions,[])
        self.assertEqual(batch.depth_registration_errors,[])

    def test_manifest_clean_control(self):
        validate_manifest(self.data,self.proof)

    def assert_invalid(self,label,change,target='proof'):
        original=(self.directory/'render-proof.json').read_bytes()
        data=copy.deepcopy(self.data); proof=copy.deepcopy(self.proof)
        change(proof if target=='proof' else data)
        # Turn a fallback KeyError or a different guard into an explicit failure
        # of this malformed-input case, never an unrelated clean-load error.
        try:
            validate_manifest(data,proof)
        except Exception as error:
            self.assertIsInstance(error,AssertionError,f'intended malformed case: {label}')
            self.assertEqual(str(error),label,f'intended malformed case: {label}')
        else:
            self.fail(f'intended malformed case accepted: {label}')
        validate_manifest(self.data,self.proof)
        self.assertEqual((self.directory/'render-proof.json').read_bytes(),original)

    def test_missing_model_rejected(self):
        self.assert_invalid('missing window model',lambda p:p['models'].pop('9'))

    def test_changed_width_rejected(self):
        self.assert_invalid('window width changed',lambda p:p['models']['4'].update(width=1))

    def test_changed_direction_rejected(self):
        self.assert_invalid('window direction changed',lambda p:p['renders'][0].update(direction='y-front'))

    def test_shifted_depth_rejected(self):
        self.assert_invalid('depth registration changed',lambda p:p['sprites'][0]['depthRegistration'].update(x=1),'data')

    def test_detached_sill_rejected(self):
        def detach(p):
            sill=next(p for p in p['models']['1']['parts'] if p['name']=='Stone sill')
            sill['lower'][2]+=.1; sill['upper'][2]+=.1
        self.assert_invalid('detached sill',detach)

    def test_overlapping_split_ownership_rejected(self):
        def overlap(p):
            # Add a second owner without removing any required owner. Its
            # rectangle has valid independent space, so only ownership is bad.
            duplicate=copy.deepcopy(next(s for s in p['sprites'] if s.get('model')==4))
            duplicate['name']+='.duplicate-owner'
            duplicate['x']=0; duplicate['y']=p['height']+2
            duplicate['depthRegistration'].update(x=duplicate['x'],y=duplicate['y'])
            p['height']=duplicate['y']+duplicate['h']
            p['sprites'].append(duplicate)
        self.assert_invalid('overlapping split ownership',overlap,'data')

    def test_pattern_resource_reference_rejected(self):
        self.assert_invalid('unknown pattern resource',lambda p:p['catalogue']['patterns']['floor.boards'].update(resource='missing-resource'),'data')

    def test_unshipped_pattern_resource_rejected(self):
        self.assert_invalid('pattern resource is not shipped',lambda p:p['patternResources']['boards'].update(shipped=False),'data')

    def test_generated_patterns_resolve_every_shipped_catalogue_reference(self):
        for label,change in (
                ('unknown pattern resource',lambda d:d['catalogue']['patterns']['floor.boards'].update(resource='missing-resource')),
                ('unknown pattern resource',lambda d:d['patternResources']['boards'].update(shipped=False))):
            data=copy.deepcopy(self.data); change(data)
            batch=ArchitectureExport(data,self.directory,[],{},[],[])
            with self.assertRaisesRegex(AssertionError,label): generated_files(batch,1700)

    def test_bad_resource_hash_rejected(self):
        bad=copy.deepcopy(self.data); bad['hashes']['depth']='0'*64
        with self.assertRaisesRegex(AssertionError,'texture hash changed'): validate_pixels(bad,self.directory)
        validate_pixels(self.data,self.directory)

    def test_authored_surface_samples_have_correct_roles_and_carriers(self):
        color=Image.open(self.directory/self.data['resources']['color']).convert('RGBA')
        carrier=Image.open(self.directory/self.data['resources']['carrier']).convert('RGBA')
        roles=(self.directory/self.data['resources']['roles']).read_bytes()
        wall=next(s for s in self.data['sprites'] if s['source']=='window.sash.x-front.full')
        floor=next(s for s in self.data['sprites'] if s['source']=='floor-patch.boards' and s['phase']==[1,1])
        # Known physical points are inside these authored surfaces, away from
        # antialiased boundaries. Expected roles do not come from the classifier.
        samples=(('plaster',wall,(0,.06,.3),1),('glass',wall,(.12,.009,1.5),4),
                 ('frame',wall,(-.3325,.078,1.5),3),('sill',wall,(0,.11,.66),5),
                 ('floor',floor,(0,0,0),2))
        for name,entry,(x,y,z),expected_role in samples:
            with self.subTest(surface=name):
                px=entry['x']+int((entry['origin'][0]+32*(x-y))*2)
                py=entry['y']+int((entry['origin'][1]+21*(x+y)-38*z)*2)
                self.assertEqual(roles[py*self.data['width']+px],expected_role)
                base=color.getpixel((px,py)); neutral=carrier.getpixel((px,py))
                self.assertEqual(base[3],255)
                if name in ('plaster','floor'):
                    self.assertEqual(neutral,(255,255,255,255))
                    self.assertNotEqual(base,neutral)
                else:
                    self.assertEqual(neutral,base)

    def test_generated_ids_follow_the_complete_historical_prefix(self):
        batch=load_reviewed_architecture()
        config=json.loads((SOURCE/'architecture.json').read_text())
        files=generated_files(batch,config['historicalCount'])
        ts=next(value.decode() for path,value in files.items() if path.suffix=='.ts')
        self.assertIn(f'"baseSpriteId": {config["historicalCount"]}',ts)
        self.assertIn(f'"id": {config["historicalCount"]+len(self.data["sprites"])-1}',ts)


if __name__=='__main__': unittest.main()
