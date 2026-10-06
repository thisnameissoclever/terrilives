"""Validated cleaning clips and bin-lid frames, appended after published art."""
import base64
import hashlib
import json
from pathlib import Path
from PIL import Image
from offline_sims import load_export,trim_clip_envelopes

ROOT=Path(__file__).resolve().parents[3]
ACTIONS={'mop','wipe_counter','wipe_table','empty_bin'}


def load_cleaning(path):
    path=Path(path);data=json.loads(path.read_text());base=path.parent
    assert data['schema']==1
    appearance=data['appearance']
    assert appearance['reference_density']==16 and appearance['render_density']==4
    assert all(abs(row['reference_thickness']/16-row['render_thickness']/4)<1e-8 for row in appearance['outline_styles']), 'cleaning outlines changed logical thickness'
    assert appearance['outline_groups']['Hair outline selection'], 'cleaning lost the approved hair outline selection'
    for side,radius in [('L',.014),('R',.023)]:
        grip=data['grip_contracts'][side]
        assert grip['shaft_radius']==radius and grip['covered_degrees']==360, 'mop hand does not enclose its handle'
        assert grip['minimum_skin_radius']>=radius-.001 and grip['maximum_contact_gap']<=.0025, 'mop grip no longer fits the handle'
    assert hashlib.sha256((base.parent/'cleaning.blend').read_bytes()).hexdigest()==data['model_sha256']
    for name,sha in data['inputs'].items():
        assert hashlib.sha256((ROOT/'assets/models'/name).read_bytes()).hexdigest()==sha,name
    exports=[]
    for item in data['variants']:
        file=base/item['path'];assert hashlib.sha256(file.read_bytes()).hexdigest()==item['sha256']
        exports.append(load_export(file,required_clips=ACTIONS,expected_variant=item['variant']))
    assert [e.variant for e in exports]==['green','blue','red']
    original_anchors={e.variant:{a:c['anchor'] for a,c in e.clips.items()} for e in exports}
    exports=trim_clip_envelopes(exports)
    extra_anchors={}
    bins=[]
    for row in data['bins']:
        image_path=base/row['path'];assert hashlib.sha256(image_path.read_bytes()).hexdigest()==row['sha256']
        image=Image.open(image_path).convert('RGBA');assert image.size==(192,240)
        name=f"cleaningBin{row['facing']}{row['frame']}"
        bins.append((name,image,192,240));extra_anchors[name]=data['bin_anchor']
    assert len(bins)==32 and len({b[0] for b in bins})==32
    assert hashlib.sha256((base.parent/'render_contacts.py').read_bytes()).hexdigest()==data['contacts_producer_sha256']
    masks=[];support={}
    for row in data['support']:
        file=base/row['path'];assert hashlib.sha256(file.read_bytes()).hexdigest()==row['sha256']
        image=Image.open(file).convert('RGBA');assert image.size==(192,256)
        name='cleaningSupport'+row['action'].title().replace('_','')+row['facing']+str(row['frame'])
        masks.append((name,image,192,256));extra_anchors[name]=original_anchors['green'][row['action']]
        for export in exports:
            for body,frame in export.frames.items():
                if (frame['action'],frame['facing'],frame['frame'])==(row['action'],row['facing'],row['frame']):
                    original=original_anchors[export.variant][row['action']]
                    support[body]=(name,[export.clips[row['action']]['anchor'][i]-original[i] for i in (0,1)])
    assert len(masks)==80
    return exports,bins+masks,extra_anchors,support


def support_tables(sprites,support,masks):
    indices={sprite[0]:i for i,sprite in enumerate(sprites)}
    coverage={}
    for name in dict.fromkeys(value[0] for value in support.values()):
        alpha=sprites[indices[name]][1].getchannel('A');box=alpha.getbbox() or (0,0,1,1)
        coverage[name]=len(masks)
        masks.append({'size':list(alpha.size),'box':list(box),'values':base64.b64encode(alpha.crop(box).tobytes()).decode('ascii')})
    return {indices[body]:{'sprite':indices[name],'coverage':coverage[name],'offset':offset} for body,(name,offset) in support.items()}



def records(path):
    exports,bins,_,_=load_cleaning(path)
    return [sprite for export in exports for sprite in export.sprites]+bins
