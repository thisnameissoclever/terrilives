"""Author the forward jump directly from the configured two-level ladder stance."""
import argparse
from copy import deepcopy
import json
from pathlib import Path

from derive_pool_supported_crest import canonical, digest


START = 42000
TRAIL_RELEASE = 44000
TAKEOFF = 60000
WET = 87000
FLIGHT = [42000,43000,44000,45000,46000,47000,48000,49000,50000,51000,
          52000,53000,54000,55000,56000,57000,58000,59000,60000,
          *range(61250,87000,1250),87000,89000,91000,93000,95000,97500,100000]


def write_pair(seed, output):
    raw = (seed/'motion.json').read_bytes()
    motion = json.loads(raw)
    fixture = json.loads((seed/'contacts.json').read_bytes())
    if (fixture['revisions']['poseProducer'] != digest(raw) or
        motion['modelSource'] != 'outdoor/pool_activity_model_v6.py' or
        motion['nativeTicks']['exit'] != 40):
        raise ValueError('The jump requires the paired V6 model and independent 40-tick exit.')
    original = fixture['clips']['pool_enter']
    anchor = next(row for row in original['samples'] if row['phase']==START/100000)
    root = anchor['rootRegion']
    def contacts(u):
        if u < START:
            row = next((r for r in original['samples'] if r['phase']==u/100000),None)
            if row is None:
                row = next(r for r in original['intervals'] if r['start']<=u/100000<r['end'])
            return deepcopy(row['limbs'])
        result = {}
        for limb,release,end in [('footL',TRAIL_RELEASE,48000),('footR',TAKEOFF,61250),
                                  ('handL',44000,49000),('handR',47000,52000)]:
            held = deepcopy(anchor['limbs'][limb])
            held.update(mode='support',interval=None,intervalSpace='clip-phase')
            if u >= end:
                held.update(mode='free',surface=None,region=None)
            elif u >= release:
                held.update(mode='release',interval=[release/100000,end/100000])
            result[limb] = held
        return result
    units=sorted({round(r['phase']*100000) for r in original['samples'] if r['phase']<START/100000}|set(FLIGHT))
    fixture['clips']['pool_enter']={'playback':'progress',
        'samples':[{'phase':u/100000,'travel':u/100000,'rootRegion':root,'limbs':contacts(u)} for u in units],
        'intervals':[{'start':a/100000,'end':b/100000,'limbs':contacts((a+b)/2)} for a,b in zip(units,units[1:])]}
    h=motion['forwardHop']
    h.update(launchFromUnit=START,waterContactUnit=WET,entryUnits=units)
    h['footTransitions']=[r for r in h['footTransitions'] if r['endUnit']<=START]+[
        {'limb':foot,'from':place,'to':'free','startUnit':start,'endUnit':WET}
        for foot,place,start in [('footL','outside3',TRAIL_RELEASE),('footR','crest',TAKEOFF)]]
    for key in h['climbKeys']:
        if 'poseEntryUnit' in key or key.get('entryUnit',0)>START:
            key.pop('poseEntryUnit',None)
            key.pop('entryUnit',None)
            key['exitReferenceUnit']=key['unit']
    raw=(json.dumps(motion,indent=2)+'\n').encode()
    fixture['revisions'].update(poseProducer=digest(raw),clipLibrary=digest(canonical(fixture['clips'])))
    output.mkdir(parents=True,exist_ok=True)
    for name,body in [('motion.json',raw),('contacts.json',canonical(fixture)+b'\n')]:
        with (output/name).open('xb') as target: target.write(body)


if __name__=='__main__':
    cli=argparse.ArgumentParser()
    cli.add_argument('seed',type=Path);cli.add_argument('output',type=Path)
    args=cli.parse_args();write_pair(args.seed,args.output)
