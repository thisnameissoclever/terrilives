"""Install the free-water steering pose between the two sides of the submerged stringer."""
from argparse import ArgumentParser
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import json


def derive(source,output):
    motion=json.loads((source/'motion.json').read_bytes())
    fixture=json.loads((source/'contacts.json').read_bytes())
    family=json.loads((source/'ladder-climb-out.poolroute').read_bytes())
    old=sha256((source/'motion.json').read_bytes()).hexdigest()
    if family['motion']!=old or fixture['revisions']['poseProducer']!=old or family['model']!=fixture['revisions']['model']:
        raise ValueError('Water-turn inputs are not paired.')
    hop=motion['forwardHop'];keys=hop['climbKeys'];left=next(i for i,k in enumerate(keys) if k['unit']==17200)
    if keys[left+1]['unit']!=19000:raise ValueError('The free turn is already split or has another clock.')
    key={'unit':18100,'authoredUnit':16750}
    keys.insert(left+1,key);hop['climbOutUnits']=[k['unit'] for k in keys]
    for o in range(12):
        clip=fixture['clips'][f'pool_exit_{o}']
        l=next(i for i,r in enumerate(clip['intervals']) if r['start']==.172 and r['end']==.19)
        interval=clip['intervals'][l]
        if any(limb['mode']!='free' for limb in interval['limbs'].values()):raise ValueError('The intermediate pose must be free of ladder contacts.')
        clip['intervals'][l:l+1]=[{**deepcopy(interval),'end':.181},{**deepcopy(interval),'start':.181}]
        k=next(i for i,r in enumerate(clip['samples']) if r['phase']==.172)
        r=deepcopy(clip['samples'][k]);r.update(phase=.181,travel=(1-.181)/.9,limbs=deepcopy(interval['limbs']))
        clip['samples'].insert(k+1,r)
    body=(json.dumps(motion,indent=2)+'\n').encode();family['motion']=sha256(body).hexdigest()
    fixture['revisions'].update(poseProducer=family['motion'],clipLibrary=sha256(json.dumps(fixture['clips'],sort_keys=True,separators=(',',':')).encode()).hexdigest())
    output.mkdir(exist_ok=False,parents=True)
    for name,raw in [('motion.json',body),('contacts.json',json.dumps(fixture,separators=(',',':')).encode()),
                     ('ladder-climb-out.poolroute',json.dumps(family,separators=(',',':')).encode())]:
        (output/name).write_bytes(raw)


if __name__=='__main__':
    p=ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);a=p.parse_args();derive(a.source,a.output)
