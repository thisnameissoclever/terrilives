import copy
import hashlib
import json
from pathlib import Path
import unittest
from PIL import Image
from offline_architecture import (SOURCE,load_reviewed_architecture,validate_manifest,
                                  validate_pixels,generated_files)


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

    def test_named_mutations_fail_and_unchanged_source_passes(self):
        original=(self.directory/'render-proof.json').read_bytes()
        def mutate(label,change,target='proof'):
            data=copy.deepcopy(self.data); proof=copy.deepcopy(self.proof)
            change(proof if target=='proof' else data)
            with self.assertRaisesRegex(AssertionError,label): validate_manifest(data,proof)
            validate_manifest(self.data,self.proof)
            self.assertEqual((self.directory/'render-proof.json').read_bytes(),original)
        mutate('missing window model',lambda p:p['models'].pop('9'))
        mutate('window width changed',lambda p:p['models']['4'].update(width=1))
        mutate('window direction changed',lambda p:p['renders'][0].update(direction='y-front'))
        mutate('depth registration changed',lambda p:p['sprites'][0]['depthRegistration'].update(x=1),'data')
        def detach(p):
            sill=next(p for p in p['models']['1']['parts'] if p['name']=='Stone sill')
            sill['lower'][2]+=.1; sill['upper'][2]+=.1
        mutate('detached sill',detach)
        def overlap(p):
            pieces=[s for s in p['sprites'] if s.get('model')==4 and s['direction']=='x-front' and s['heightMode']=='full']
            pieces[1]['ownedSpan']=pieces[0]['ownedSpan']
        mutate('overlapping split ownership',overlap,'data')

    def test_bad_resource_hash_and_role_palette_independence(self):
        bad=copy.deepcopy(self.data); bad['hashes']['depth']='0'*64
        with self.assertRaisesRegex(AssertionError,'texture hash changed'): validate_pixels(bad,self.directory)
        validate_pixels(self.data,self.directory)
        color=Image.open(self.directory/self.data['resources']['color']).convert('RGBA')
        carrier=Image.open(self.directory/self.data['resources']['carrier']).convert('RGBA')
        roles=(self.directory/self.data['resources']['roles']).read_bytes()
        # Palette edits have no route to geometry, bounds, ownership or depth.
        before=(self.directory/self.data['resources']['depth']).read_bytes()
        for palette in ((.65,.82,1.1),(1.12,.85,.67)):
            for entry in self.data['sprites'][::17]:
                x,y,w,h=(entry[k] for k in ('x','y','w','h'))
                for py in range(y,y+h,5):
                    for px in range(x,x+w,5):
                        role=roles[py*self.data['width']+px]
                        base=color.getpixel((px,py)); neutral=carrier.getpixel((px,py))
                        result=tuple(round(neutral[i]*palette[i]) for i in range(3))+(base[3],) if role in (1,2) else base
                        if role not in (1,2): self.assertEqual(result,base)
                        self.assertEqual(result[3],base[3])
            self.assertEqual((self.directory/self.data['resources']['depth']).read_bytes(),before)

    def test_generated_ids_follow_the_complete_historical_prefix(self):
        batch=load_reviewed_architecture()
        config=json.loads((SOURCE/'architecture.json').read_text())
        files=generated_files(batch,config['historicalCount'])
        ts=next(value.decode() for path,value in files.items() if path.suffix=='.ts')
        self.assertIn(f'"baseSpriteId": {config["historicalCount"]}',ts)
        self.assertIn(f'"id": {config["historicalCount"]+len(self.data["sprites"])-1}',ts)


if __name__=='__main__': unittest.main()
