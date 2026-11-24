"""Bind the stepped turn on the interior landing to all twelve directed exits."""
import argparse
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

MOVES = (
    ('footR','inside3','crest',(45000,46500,48000,49500,51000)),
    ('footL','crest','crest',(51000,52500,54000,55500,57000)),
    ('footR','crest','crest',(57000,58750,60500,62250,64000)),
    ('footL','crest','outside3',(64000,66500,69250,72000,74769,77000)),
)
HAND_TIMES={'handR':(45000,46500,49500,52500),'handL':(51000,52500,55500,58750)}
sha=lambda value:sha256(value).hexdigest()


def derive(source,output):
    motion_bytes=(source/'motion.json').read_bytes()
    motion=json.loads(motion_bytes)
    fixture=json.loads((source/'contacts.json').read_bytes())
    family=json.loads((source/'ladder-climb-out.poolroute').read_bytes())
    if fixture['revisions']['poseProducer']!=sha(motion_bytes) or family['model']!=fixture['revisions']['model']:
        raise ValueError('The landing motion and fixture must share their source model.')
    hop=motion['forwardHop']
    start,end=MOVES[0][3][0],MOVES[-1][3][-1]
    clock=motion['clockUnits']
    original=fixture['clips']['pool_exit_0']
    initial=next(r for r in original['samples'] if r['phase']==start/clock)
    arrival=next(r for r in original['samples'] if r['phase']==end/clock)
    states={r['surface']:r for row in original['samples'] for r in row['limbs'].values() if r['surface']}
    def record(surface=None,mode='free',times=None):
        s=deepcopy(states[surface]) if surface else {'surface':None,'region':None}
        s.update(mode=mode,interval=[u/clock for u in times] if times else None,intervalSpace='clip-phase')
        return s
    def support(limb,u):
        if limb in HAND_TIMES:
            a,b,c,d=HAND_TIMES[limb]
            one,two=initial['limbs'][limb]['surface'],arrival['limbs'][limb]['surface']
            if u<a:return record(one,'support')
            if u<b:return record(one,'release',(a,b))
            if u<c:return record()
            if u<=d:return record(two,'approach',(c,d))
            return record(two,'support')
        place='crest' if limb=='footL' else 'inside3'
        for side,old,new,keys in MOVES:
            if side!=limb:continue
            if u<keys[0]:break
            if place!=old:raise ValueError('Disconnected platform foot.')
            if u<keys[1]:return record(motion['places'][old]['surface'],'release',keys[:2])
            if u<keys[-2]:return record()
            if u<=keys[-1]:return record(motion['places'][new]['surface'],'approach',keys[-2:])
            place=new
        return record(motion['places'][place]['surface'],'support')
    units=sorted({u for m in MOVES for u in m[3]}|{u for times in HAND_TIMES.values() for u in times})
    for i in range(12):
        clip=fixture['clips'][f'pool_exit_{i}']
        samples=[s for s in clip['samples'] if s['phase']<start/clock]
        for u in units:
            samples.append({'phase':u/clock,'travel':(clock-u)/(clock-hop['bridgeEndUnit']),
                            'rootRegion':deepcopy(initial['rootRegion']),'limbs':{l:support(l,u) for l in initial['limbs']}})
        intervals=[s for s in clip['intervals'] if s['end']<=start/clock]
        for a,b in zip(units,units[1:]):
            intervals.append({'start':a/clock,'end':b/clock,'limbs':{l:support(l,(a+b)/2) for l in initial['limbs']}})
        clip.update(samples=samples+[s for s in clip['samples'] if s['phase']>end/clock],
                    intervals=intervals+[s for s in clip['intervals'] if s['start']>=end/clock])
    keys=hop['climbKeys']
    hop['climbKeys']=[k for k in keys if k['unit']<=start]+[{'unit':u,'authoredUnit':u} for u in units if start<u<end]+[k for k in keys if k['unit']>=end]
    hop['climbOutUnits']=[k['unit'] for k in hop['climbKeys']]
    hop.pop('outerGripTransfer',None)
    hop['platformTurn']={'kind':'stepping-turn','startUnit':start,'quarterUnit':51000,'leftTurnUnit':57000,'rightTurnUnit':64000,'exteriorUnit':end}
    family['exitReferences']=[]
    motion['derivation']['descent']='Each foot turns while lifted on the internal landing. The swimmer descends the exterior flight facing the pool.'
    motion_bytes=(json.dumps(motion,indent=2)+'\n').encode()
    family['motion']=sha(motion_bytes)
    fixture['revisions'].update(poseProducer=family['motion'],clipLibrary=sha(json.dumps(fixture['clips'],separators=(',',':'),sort_keys=True).encode()))
    output.mkdir(parents=True,exist_ok=False)
    for name,content in [('motion.json',motion_bytes),('contacts.json',json.dumps(fixture,separators=(',',':')).encode()),
                         ('ladder-climb-out.poolroute',json.dumps(family,separators=(',',':')).encode())]:
        (output/name).write_bytes(content)


if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('source',type=Path)
    p.add_argument('output',type=Path)
    a=p.parse_args()
    derive(a.source,a.output)
