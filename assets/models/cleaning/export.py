"""Publish checked two-pixel-density runtime frames from a complete chore bake."""
import hashlib
import json
import shutil
from pathlib import Path
from PIL import Image

BASE=Path(__file__).resolve().parent


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    raw=BASE/'raw';out=BASE/'export'
    proof=json.loads((raw/'proof.json').read_text())
    assert proof['state']=='complete' and not proof['preview']
    assert proof['expected']==368 and len(proof['renders'])==368
    appearance=proof['appearance']
    assert appearance['reference_density']==16 and appearance['render_density']==4
    assert all(abs(style['reference_thickness']/16-style['render_thickness']/4)<1e-8 for style in appearance['outline_styles'])
    assert appearance['outline_groups']['Hair outline selection']
    grips=proof['grip_contracts']
    for side,radius in [('L',.014),('R',.023)]:
        grip=grips[side]
        assert grip['shaft_radius']==radius and grip['covered_degrees']==360
        assert grip['minimum_skin_radius']>=radius-.001 and grip['maximum_contact_gap']<=.0025
    assert digest(raw/'cleaning.blend')==proof['model_sha256']
    for relative,sha in proof['inputs'].items():assert digest(BASE.parent/relative)==sha,relative
    out.mkdir(exist_ok=True)
    shutil.copyfile(raw/'cleaning.blend',BASE/'cleaning.blend')
    for variant in ['green','blue','red']:
        manifest=json.loads((raw/variant/'manifest.json').read_text())
        (out/variant).mkdir(exist_ok=True)
        for row in manifest['frames']:
            source=raw/variant/row['path'];assert digest(source)==row['sha256']
            clip=manifest['clips'][row['action']]
            image=Image.open(source).convert('RGBA')
            bounds=image.getchannel('A').getbbox();assert bounds is not None
            assert bounds[0]>0 and bounds[1]>0 and bounds[2]<image.width and bounds[3]<image.height,(row['name'],'clipped')
            target=out/variant/row['path']
            image.resize((clip['width']*2,clip['height']*2),Image.Resampling.LANCZOS).save(target)
            row['sha256']=digest(target)
        manifest['pixel_density']=2
        (out/variant/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (out/'bin').mkdir(exist_ok=True)
    bins=[]
    for row in proof['renders']:
        if row['variant']!='bin':continue
        source=raw/'bin'/row['path'];assert digest(source)==row['sha256']
        target=out/'bin'/row['path']
        Image.open(source).convert('RGBA').resize((192,240),Image.Resampling.LANCZOS).save(target)
        bins.append({**row,'sha256':digest(target),'path':'bin/'+row['path']})
    contacts=json.loads((BASE/'contacts/proof.json').read_text())
    assert contacts['state']=='complete' and len(contacts['renders'])==80
    assert contacts['model_sha256']==proof['model_sha256']
    assert contacts['producer_sha256']==digest(BASE/'render_contacts.py')
    support=[];(out/'support').mkdir(exist_ok=True)
    for row in contacts['renders']:
        source=BASE/'contacts'/row['path'];assert digest(source)==row['sha256']
        alpha=Image.open(source).getchannel('A').resize((192,256),Image.Resampling.BOX)
        image=Image.new('RGBA',alpha.size,'white');image.putalpha(alpha)
        target=out/'support'/row['path'];image.save(target)
        support.append({**row,'path':'support/'+row['path'],'sha256':digest(target)})
    manifest={'schema':1,'model_sha256':proof['model_sha256'],'inputs':proof['inputs'],
              'appearance':appearance,
              'grip_contracts':grips,
              'variants':[{'variant':v,'path':v+'/manifest.json','sha256':digest(out/v/'manifest.json')} for v in ['green','blue','red']],
              'bin_anchor':proof['bin_anchor'],'bins':bins,'support':support,
              'contacts_producer_sha256':contacts['producer_sha256']}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    shutil.copyfile(raw/'proof.json',out/'proof.json')


if __name__=='__main__':main()
