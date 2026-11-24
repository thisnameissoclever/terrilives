"""Produce one entry, paddle and twelve reverse contact policies for the supported crest crossing."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import pool_activity_policy_v13 as base


CROSSING = [42000,42001,42101,42400,42800,43200,43875,44044,44212,44381,44402,44420,
            44439,44476,44513,44550,45225,45900,46278,46467,46656,47410,48401,48920,
            49676,50430,50549,50668,50787,50906,51024,51143,51262,51381,51940,53200,
            55360,60220,62380,64000]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(data):
    return json.dumps(data,sort_keys=True,separators=(',',':')).encode()


def derive(source_directory, output_directory, release_inside=False, plant_early=False):
    seed = (source_directory/'motion.json').read_bytes()
    motion = json.loads(seed)
    fixture = json.loads((source_directory/'contacts.json').read_bytes())
    if fixture['revisions']['poseProducer'] != digest(seed):
        raise ValueError('The source motion and evaluated fixture are not paired.')
    if motion.get('modelSource') != 'outdoor/pool_activity_model_v6.py':
        raise ValueError('Supported crossing requires the relieved physical landing.')
    motion['crestRoute'] = {'path':'supported-turn','handTransferUnits':[43200,43875,45225,45900],
                            'footSwingUnits':[42000,53200],'rightStepUnits':[53200,64000],'sampleUnits':CROSSING}
    if release_inside:
        motion['crestRoute']['insideHandTransferUnits']=[50668,50787,51143,51381]
    if plant_early:
        motion['crestRoute'].update(path='supported-early-plant',footSwingUnits=[42000,50800],
                                   rightStepUnits=[51000,64000],sampleUnits=sorted({*CROSSING,50800,51000}))
    motion['derivation']['crestRoute'] = 'Release the leading sole at 42000, transfer the left hand, and descend on the right crest sole before planting inside.'
    for row in motion['footTransitions']:
        if row['limb']=='footL' and row['from']=='outside3' and row['to']=='inside3':
            row.update(start=.42,end=.508 if plant_early else .532,startUnit=42000,endUnit=50800 if plant_early else 53200)
        if plant_early and row['limb']=='footR' and row['from']=='crest' and row['to']=='inside2':
            row.update(start=.51,startUnit=51000)
    motion['derivation']['clock'] = 'Existing 100000-unit spatial clock and native entry/exit durations; pacing requires played verification.'
    regions = {r['surface']:r['region'] for row in fixture['clips']['pool_enter']['samples']
               for r in row['limbs'].values() if r['surface']}
    def support(surface,kind='support',interval=None):
        return {'mode':kind,'surface':surface,'interval':interval,'intervalSpace':'clip-phase','region':deepcopy(regions[surface])}
    def entry(p):
        limbs=base.entry_support(motion,p,support)
        if .42<=p<.532:
            limbs['footL']=(support(motion['places']['outside3']['surface'],'release',[.42,.432]) if p<.432
                            else support(motion['places']['inside3']['surface'],'approach',[.5194,.532]) if p>=.5194
                            else base.mode('free'))
            limbs['handL']=(support('Pool ladder rail 1','release',[.432,.43875]) if .432<=p<.43875
                            else base.mode('free') if .43875<=p<.45225
                            else support('Pool ladder rail 1','approach',[.45225,.459]) if .45225<=p<.459
                            else support('Pool ladder rail 1'))
        if release_inside and .50668<=p<.51381:
            limbs['handL']=(support('Pool ladder rail 1','release',[.50668,.50787]) if p<.50787
                            else base.mode('free') if p<.51143
                            else support('Pool ladder rail 1','approach',[.51143,.51381]))
        if plant_early and .5043<=p<.64:
            limbs['footL']=(support(motion['places']['inside3']['surface'],'approach',[.5043,.508]) if p<.508
                            else support(motion['places']['inside3']['surface']))
            limbs['footR']=(support(motion['places']['crest']['surface']) if p<.51
                            else support(motion['places']['crest']['surface'],'release',[.51,.51381]) if p<.51381
                            else base.mode('free') if p<.6022
                            else support(motion['places']['inside2']['surface'],'approach',[.6022,.64]))
        return limbs
    before=fixture['clips']['pool_enter']
    units=set(motion['crestRoute']['sampleUnits'])|set(base.entry_units(motion))|{round(r['phase']*100000) for r in before['samples'] if r['phase']<.42 or r['phase']>=.532}
    phases=sorted(u/100000 for u in units)
    region=before['samples'][0]['rootRegion']
    forward={'playback':'progress','samples':[{'phase':p,'travel':p,'limbs':entry(p),'rootRegion':region} for p in phases],
             'intervals':[{'start':a,'end':b,'limbs':entry((a+b)/2)} for a,b in zip(phases,phases[1:])]}
    def back(p):
        return .1 if p==1 else 1-.9*p
    def reverse(limbs):
        result=deepcopy(limbs)
        for row in result.values():
            if row['mode'] in ('approach','release'):
                row['mode']={'approach':'release','release':'approach'}[row['mode']]
                row['interval']=[back(p) for p in reversed(row['interval'])]
        return result
    free={limb:base.mode('free') for limb in ('footL','footR','handL','handR')}
    fixture['clips']['pool_enter']=forward
    for i in range(12):
        fixture['clips'][f'pool_exit_{i}']={'playback':'progress','samples':[{'phase':0.,'travel':1.,'rootRegion':region,'limbs':free},
            *({'phase':back(r['phase']),'travel':r['travel'],'rootRegion':region,'limbs':reverse(r['limbs'])} for r in reversed(forward['samples']))],
            'intervals':[{'start':0.,'end':.1,'limbs':free},*({'start':back(r['end']),'end':back(r['start']),'limbs':reverse(r['limbs'])} for r in reversed(forward['intervals']))]}
    raw=(json.dumps(motion,indent=2)+'\n').encode()
    fixture['revisions'].update(poseProducer=digest(raw),clipLibrary=digest(canonical(fixture['clips'])))
    output_directory.mkdir(parents=True,exist_ok=True)
    for name,content in [('motion.json',raw),('contacts.json',canonical(fixture)+b'\n')]:
        with (output_directory/name).open('xb') as out:
            out.write(content)
    return {name:digest((output_directory/name).read_bytes()) for name in ['motion.json','contacts.json']}


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('--release-inside',action='store_true')
    parser.add_argument('--plant-inside-early',action='store_true')
    args=parser.parse_args()
    print(json.dumps(derive(args.source,args.output,args.release_inside,args.plant_inside_early)))
