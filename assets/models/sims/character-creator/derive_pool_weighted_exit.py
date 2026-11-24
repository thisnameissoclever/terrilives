"""Put lower-rung contact before the weight transfer and before the opposite heel releases."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import argparse

STEPS = [
    ('footL','crest','outside3',64000,65000,66100,69500,71000),
    ('footR','crest','outside2',71000,72300,73500,76000,77500),
    ('footL','outside3','outside1',77500,78900,80100,82600,84000),
    ('footR','outside2','nearGround',84000,85400,86600,89100,90500),
    ('footL','outside1','ground',90500,91500,92600,94900,96000),
    ('footR','nearGround','ground',96000,96800,97700,99000,100000),
]

def derive(source,output):
    m=json.loads((source/'motion.json').read_bytes())
    f=json.loads((source/'contacts.json').read_bytes())
    family=json.loads((source/'ladder-climb-out.poolroute').read_bytes())
    hop=m['forwardHop']
    if hop.get('platformTurn',{}).get('kind')!='stepping-turn' or family['motion']!=f['revisions']['poseProducer']:
        raise ValueError('The lower transfer requires the paired inward-turn release.')
    clock=m['clockUnits'];start=STEPS[0][3];all_keys=hop['climbOutUnits']
    units=sorted(set(u for u in all_keys if u>=start)|{u for row in STEPS for u in row[3:]}|{85400,91900})
    def foot(limb,u,examples):
        place='crest'
        for leg,previous,next_place,arrival,lift,free,approach,land in STEPS:
            if leg!=limb or u<lift:continue
            if u<free:return state(previous,'release',(lift,free),examples)
            if u<approach:return state(None,'free',None,examples)
            if u<=land:return state(next_place,'approach',(approach,land),examples)
            place=next_place
        return state(place,'support',None,examples)
    def state(place,mode,interval,examples):
        surface=m['places']['ground' if place=='nearGround' else place]['surface'] if place else None
        r=deepcopy(examples[surface]);r.update(mode=mode,intervalSpace='clip-phase',interval=[x/clock for x in interval] if interval else None)
        return r
    for i in range(12):
        clip=f['clips']['pool_exit_'+str(i)];old=clip['samples'];ranges=clip['intervals']
        examples={s['surface']:s for row in old+ranges for s in row['limbs'].values()}
        def limbs_at(u):
            phase=u/clock
            row=next((s for s in old if s['phase']==phase),None)
            if row is None:row=next(s for s in ranges if s['start']<=phase<s['end'])
            r=deepcopy(row['limbs'])
            for l in ['footL','footR']:r[l]=foot(l,u,examples)
            for l,release in [('handL',84000),('handR',90500)]:
                if u<release:continue
                name='Pool ladder rail '+('1' if l=='handL' else '2')
                if u<release+1400:
                    r[l]=deepcopy(examples[name]);r[l].update(mode='release',interval=[release/clock,(release+1400)/clock],intervalSpace='clip-phase')
                else:r[l]=state(None,'free',None,examples)
            return r
        origin=next(r for r in old if r['phase']==start/clock)
        clip['samples']=[r for r in old if r['phase']<start/clock]+[{'phase':u/clock,'travel':(clock-u)/(clock-hop['bridgeEndUnit']),
            'rootRegion':deepcopy(origin['rootRegion']),'limbs':limbs_at(u)} for u in units]
        clip['intervals']=[r for r in ranges if r['end']<=start/clock]+[{'start':a/clock,'end':b/clock,'limbs':limbs_at((a+b)/2)} for a,b in zip(units,units[1:])]
        clip['samples'][-1]['limbs']=deepcopy(f['clips']['pool_enter']['samples'][0]['limbs'])
        for row in clip['samples']+clip['intervals']:
            for limb,rail in [('handL','Pool ladder rail 1'),('handR','Pool ladder rail 2')]:
                support=row['limbs'][limb]
                if support['surface']==rail:support['region']={'kind':'rail','parameter':[3,6]}
    hop['platformTurn']['loadedSteps']=[dict(limb=l,fromPlace=a,toPlace=b,start=u,lift=v,free=x,approach=y,land=z) for l,a,b,u,v,x,y,z in STEPS]
    hop['climbKeys']=[k for k in hop['climbKeys'] if k['unit']<=start]+[{'unit':u,'authoredUnit':u} for u in units if u>start]
    hop['climbOutUnits']=[k['unit'] for k in hop['climbKeys']]
    body=(json.dumps(m,indent=2)+'\n').encode();family['motion']=sha256(body).hexdigest()
    f['revisions'].update(poseProducer=family['motion'],clipLibrary=sha256(json.dumps(f['clips'],sort_keys=True,separators=(',',':')).encode()).hexdigest())
    output.mkdir(exist_ok=False,parents=True)
    for name,data in [('motion.json',body),('contacts.json',json.dumps(f,separators=(',',':')).encode()),('ladder-climb-out.poolroute',json.dumps(family,separators=(',',':')).encode())]:
        (output/name).write_bytes(data)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);a=p.parse_args();derive(a.source,a.output)
