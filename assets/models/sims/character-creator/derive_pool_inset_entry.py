"""Bind the five outward-to-inward steps, rail acquisition and retreat to the inset staircase."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import argparse
import json


def derive(source, output):
    motion, fixture, family = [json.loads((source / f).read_bytes()) for f in ('motion.json', 'contacts.json', 'ladder-climb-out.poolroute')]
    if 'dryBay' not in motion or sha256((source/'motion.json').read_bytes()).hexdigest() != family['motion'] or family['model'] != fixture['revisions']['model']:
        raise ValueError('Expected a matched inset staircase and motion.')
    hop, clip = motion['forwardHop'], fixture['clips']['pool_enter']
    moves = [('footR','ground','ground',0,7800), ('footL','ground','outside1',7800,17000),
             ('footR','ground','outside2',17000,26000),('footL','outside1','outside3',26000,34000),
             ('footR','outside2','crest',34000,42000)]
    steps = [dict(limb=l,fromPlace=a,toPlace=b,start=u,release=round(u+.15*(v-u)),high=round(u+.42*(v-u)),
                  across=round(u+.70*(v-u)),approach=round(u+.84*(v-u)),land=v) for l,a,b,u,v in moves]
    acquire = dict(start=22000,end=26000)
    hop['insetEntry'] = dict(steps=steps,grip=acquire)
    hop['footTransitions']=[dict(limb=l,**{'from':a,'to':b},startUnit=u,endUnit=v) for l,a,b,u,v in moves]+[t for t in hop['footTransitions'] if t['startUnit']>=42000]
    prior=clip['samples'];places={}
    for row in prior:
        for l in ('footL','footR'):
            r=row['limbs'][l]
            if r['mode']=='support':places[r['surface']]=r['region']
    def rec(mode,surface=None,region=None,span=None):
        return dict(mode=mode,surface=surface,region=region,interval=None if span is None else [t/100000 for t in span],intervalSpace='clip-phase')
    def limbs(u):
        out={}
        for l in ('footL','footR'):
            place='ground'
            for st in [s for s in steps if s['limb']==l]:
                surface=motion['places'][place]['surface']
                if u<st['start']:break
                if u<=st['release']:
                    out[l]=rec('release',surface,places[surface],[st['start'],st['release']]);break
                if u<st['approach']:
                    out[l]=rec('free');break
                place=st['toPlace'];surface=motion['places'][place]['surface']
                if u<st['land']:
                    out[l]=rec('approach',surface,places[surface],[st['approach'],st['land']]);break
            if l not in out:
                surface=motion['places'][place]['surface'];out[l]=rec('support',surface,places[surface])
        for l,n in [('handL',1),('handR',2)]:
            rail=f'Pool ladder rail {n}';region=dict(kind='rail',parameter=[3,6])
            out[l]=rec('free') if u<acquire['start'] else rec('approach',rail,region,[acquire['start'],acquire['end']]) if u<acquire['end'] else rec('support',rail,region)
        return out
    units=sorted(set(hop['entryUnits'])|{v for s in steps for k,v in s.items() if isinstance(v,int)}|set(acquire.values()))
    early=[u for u in units if u<=42000]
    hop['entryUnits']=units
    clip['samples']=[dict(phase=u/100000,travel=u/100000,rootRegion=deepcopy(prior[0]['rootRegion']),limbs=limbs(u)) for u in early]+[r for r in prior if r['phase']>.42]
    clip['samples'][0]['limbs']=deepcopy(prior[0]['limbs'])
    clip['intervals']=[dict(start=a/100000,end=b/100000,limbs=limbs((a+b)/2)) for a,b in zip(early,early[1:])]+[r for r in clip['intervals'] if r['start']>=.42]
    for row in clip['samples']+clip['intervals']:
        for hand in ('handL','handR'):
            support=row['limbs'][hand]
            if support['region'] and support['region']['kind']=='rail':support['region']['parameter']=[3,6]
    raw=(json.dumps(motion,indent=2)+'\n').encode()
    family['motion']=sha256(raw).hexdigest()
    fixture['revisions'].update(poseProducer=family['motion'],clipLibrary=sha256(json.dumps(fixture['clips'],sort_keys=True,separators=(',',':')).encode()).hexdigest())
    output.mkdir(parents=True,exist_ok=False)
    for f,b in [('motion.json',raw),('contacts.json',json.dumps(fixture,separators=(',',':')).encode()),('ladder-climb-out.poolroute',json.dumps(family,separators=(',',':')).encode())]:
        (output/f).write_bytes(b)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);args=p.parse_args();derive(args.source,args.output)
