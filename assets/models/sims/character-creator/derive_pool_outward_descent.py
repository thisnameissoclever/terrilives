"""Author a forward descent from the pool crest and a stepping turn on dry ground."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from derive_pool_supported_crest import canonical,digest
from derive_pool_staggered_exit import BASE

NAMES=('pool_activity_motion_v20.json','contacts-v9.json','ladder-climb-out-v3.poolroute')
MOVES=[
    ('footR','inside3','crest',[45000,46250,47750,49500,50750,52500]),
    ('footL','crest','outside3',[52500,54000,55400,57000,58750,60000]),
    ('footR','crest','outside2',[60000,61250,62500,63800,65000,66250]),
    ('footL','outside3','outside1',[66250,67500,69250,71000,72500]),
    ('footR','outside2','ground',[72500,73500,74900,76300,77500]),
    ('footL','outside1','ground',[77500,78500,79900,81300,82500]),
    ('footR','ground','ground',[82500,84600,87000,89150,91250]),
    ('footL','ground','ground',[91250,93350,95700,97900,100000]),
]


def derive(source):
    files=(source/'pool_activity_motion_v18.json', source/'clips/pool/contacts-v7.json',
           source/'clips/pool/ladder-climb-out-v1.poolroute')
    raw=[p.read_bytes() for p in files]
    if tuple(map(digest,raw))!=BASE:
        raise ValueError('The outward descent requires its accepted V18 seed.')
    motion,fixture,template=map(json.loads,raw)
    clock=motion['clockUnits']; hop=motion['forwardHop']; start=MOVES[0][3][0]
    places=motion['places']; old=fixture['clips']['pool_exit_0']
    origin=next(s for s in old['samples'] if s['phase']==start/clock)
    examples={s['surface']:s for row in old['samples']+old['intervals'] for s in row['limbs'].values() if s['surface']}
    def state(surface=None,mode='free',interval=None):
        result=deepcopy(examples[surface]) if surface else {'surface':None,'region':None}
        result.update(mode=mode,interval=[u/clock for u in interval] if interval else None,intervalSpace='clip-phase')
        return result
    def support(limb,u):
        if limb.startswith('hand'):
            finish=72500 if limb=='handL' else 77500
            surface=origin['limbs'][limb]['surface']
            return state(surface,'support') if u<finish else state(surface,'release',[finish,finish+1000]) if u<finish+1000 else state()
        old_place='crest' if limb=='footL' else 'inside3'
        for leg,departure,arrival,keys in MOVES:
            if leg!=limb: continue
            a,release,approach,b=keys[0],keys[1],keys[-2],keys[-1]
            if u<a:break
            if old_place!=departure:raise ValueError('Disconnected outward foot placement.')
            if u<release:return state(places[departure]['surface'],'release',[a,release])
            if u<approach:return state()
            if u<=b:return state(places[arrival]['surface'],'approach',[approach,b])
            old_place=arrival
        return state(places[old_place]['surface'],'support')
    units=sorted({u for move in MOVES for u in move[3]})
    for i in range(12):
        clip=fixture['clips']['pool_exit_'+str(i)]
        samples=[s for s in clip['samples'] if s['phase']<=start/clock]
        intervals=[s for s in clip['intervals'] if s['end']<=start/clock]
        for u in units[1:]:
            samples.append({'phase':u/clock,'travel':(clock-u)/(clock-hop['bridgeEndUnit']),
                            'rootRegion':deepcopy(origin['rootRegion']),'limbs':{l:support(l,u) for l in origin['limbs']}})
        for a,b in zip(units,units[1:]):
            intervals.append({'start':a/clock,'end':b/clock,'limbs':{l:support(l,(a+b)/2) for l in origin['limbs']}})
        # Dry standing shares the actual entry-0 policy and contacts.
        samples[-1]['limbs']=deepcopy(fixture['clips']['pool_enter']['samples'][0]['limbs'])
        clip.update(samples=samples,intervals=intervals)
    keys=[k for k in hop['climbKeys'] if k['unit']<=start]+[{'unit':u,'authoredUnit':u} for u in units[1:]]
    hop.update(climbKeys=keys,climbOutUnits=[k['unit'] for k in keys],
               outwardDescent={'kind':'walk-out','startUnit':45000,'rightCrestUnit':52500,'leftOutside3Unit':60000,
                               'rightOutside2Unit':66250,'rightDryUnit':77500,'leftDryUnit':82500,'rightTurnUnit':91250})
    motion_bytes=(json.dumps(motion,indent=2)+'\n').encode()
    sha=digest(motion_bytes)
    fixture['revisions'].update(poseProducer=sha,clipLibrary=digest(canonical(fixture['clips'])))
    template.update(motion=sha,exitReferences=[])
    return motion_bytes,canonical(fixture)+b'\n',json.dumps(template,separators=(',',':')).encode()


def write_pair(source,output):
    data=derive(source);output.parent.mkdir(parents=True,exist_ok=True)
    if output.exists():raise FileExistsError(output)
    with TemporaryDirectory(dir=output.parent,prefix=output.name+'.') as temp:
        staged=Path(temp)/'bundle';staged.mkdir()
        for name,body in zip(NAMES,data):(staged/name).write_bytes(body)
        staged.rename(output)
    return {name:{'sha256':digest(body),'bytes':len(body)} for name,body in zip(NAMES,data)}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args();print(json.dumps(write_pair(args.source,args.output),indent=2))
