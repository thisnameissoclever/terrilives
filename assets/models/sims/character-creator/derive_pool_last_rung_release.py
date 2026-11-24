"""Let go of the last handrail while both feet are still installed on the outer ladder."""
from argparse import ArgumentParser
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

def derive(source,output):
    motion=json.loads((source/'motion.json').read_bytes())
    fixture=json.loads((source/'contacts.json').read_bytes())
    family=json.loads((source/'ladder-climb-out.poolroute').read_bytes())
    original=sha256((source/'motion.json').read_bytes()).hexdigest()
    if family['motion']!=original or fixture['revisions']['poseProducer']!=original or family['model']!=fixture['revisions']['model']:
        raise ValueError('The last-rung release requires a matched source.')
    hop=motion['forwardHop'];release,clear=84393,85400
    if not all(k in hop['climbOutUnits'] for k in (release,clear)):
        raise ValueError('Missing double-support release window.')
    hop['platformTurn']['lastRungHandRelease']=[release,clear]
    a,b=release/motion['clockUnits'],clear/motion['clockUnits']
    for i in range(12):
        clip=fixture['clips'][f'pool_exit_{i}']
        one=next(s for s in clip['samples'] if s['phase']==a)['limbs']
        if not all(one[l]['mode']=='support' for l in ['footL','footR']):
            raise ValueError('The final grip can release only with both feet planted.')
        held=deepcopy(one['handR'])
        if held['surface']!='Pool ladder rail 2':raise ValueError('Unexpected exterior rail.')
        held.update(mode='release',interval=[a,b],intervalSpace='clip-phase')
        for rows,keys in [(clip['samples'],True),(clip['intervals'],False)]:
            for row in rows:
                phase=row['phase'] if keys else (row['start']+row['end'])/2
                if phase<a or phase==1:continue
                row['limbs']['handR']=deepcopy(held) if phase<b else dict(mode='free',surface=None,region=None,interval=None,intervalSpace='clip-phase')
        # One cut resolves the calf rounding the outer landing. The second
        # follows the arm around the dry bay's front corner after release.
        for u in [69800,88400]:
            phase=u/motion['clockUnits']
            j=next(j for j,q in enumerate(clip['intervals']) if q['start']<phase<q['end'])
            q=clip['intervals'][j];left=next(j for j,r in enumerate(clip['samples']) if r['phase']==q['start'])
            sample=deepcopy(clip['samples'][left]);sample.update(phase=phase,travel=(1-phase)/.9,limbs=deepcopy(q['limbs']))
            clip['samples'].insert(left+1,sample)
            clip['intervals'][j:j+1]=[{**deepcopy(q),'end':phase},{**deepcopy(q),'start':phase}]
    for u in [69800,88400]:
        j=next(j for j,k in enumerate(hop['climbKeys']) if k['unit']>u)
        hop['climbKeys'].insert(j,{'unit':u,'authoredUnit':u})
    hop['climbOutUnits']=[k['unit'] for k in hop['climbKeys']]
    body=(json.dumps(motion,indent=2)+'\n').encode()
    family['motion']=sha256(body).hexdigest()
    fixture['revisions'].update(poseProducer=family['motion'],clipLibrary=sha256(json.dumps(fixture['clips'],sort_keys=True,separators=(',',':')).encode()).hexdigest())
    output.mkdir(exist_ok=False,parents=True)
    for name,data in [('motion.json',body),('contacts.json',json.dumps(fixture,separators=(',',':')).encode()),('ladder-climb-out.poolroute',json.dumps(family,separators=(',',':')).encode())]:
        (output/name).write_bytes(data)

if __name__=='__main__':
    p=ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);a=p.parse_args();derive(a.source,a.output)
