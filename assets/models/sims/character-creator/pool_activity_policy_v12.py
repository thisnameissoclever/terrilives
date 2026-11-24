"""Actual source-owned pool contact events on an integer authoring clock."""
from copy import deepcopy


def entry_units(source):
    units={row['unit'] for row in source['anchors']}
    units.update(source['plantedBodyPath']['boundaryUnits'])
    for row in source['footTransitions']:
        span=row['endUnit']-row['startUnit']
        for percent in source['transferPercentages']:
            product=span*percent
            if product%100:
                raise ValueError('Pool source event leaves its integer authoring clock')
            units.add(row['startUnit']+product//100)
    scale=source['clockUnits']
    for phase in [*source['hand']['approach'],*(p for interval in source['hand']['release'].values() for p in interval)]:
        unit=round(phase*scale)
        if unit/scale!=phase:
            raise ValueError('Pool source hand event leaves its integer authoring clock')
        units.add(unit)
    return sorted(units)


def mode(kind, surface=None, interval=None, region=None):
    return {'mode':kind,'surface':surface,'interval':interval,'intervalSpace':'clip-phase','region':region}


def entry_support(source, phase, support):
    hands={}
    start,end=source['hand']['approach']
    for index,limb in enumerate(['handL','handR']):
        release=source['hand']['release'][limb]
        if phase<start or phase>release[1]:
            hands[limb]=mode('free')
        elif phase<end:
            hands[limb]=support(f'Pool ladder rail {index+1}','approach',[start,end])
        elif phase<release[0]:
            hands[limb]=support(f'Pool ladder rail {index+1}')
        elif phase<release[1]:
            hands[limb]=support(f'Pool ladder rail {index+1}','release',release)
        else:
            hands[limb]=mode('free')
    feet={}
    for limb in ['footL','footR']:
        place='ground';value=None
        for row in [r for r in source['footTransitions'] if r['limb']==limb]:
            start=row['startUnit']/source['clockUnits'];end=row['endUnit']/source['clockUnits']
            release=(row['startUnit']+(row['endUnit']-row['startUnit'])*20//100)/source['clockUnits']
            approach=(row['startUnit']+(row['endUnit']-row['startUnit'])*85//100)/source['clockUnits']
            if phase<start:
                break
            if phase>=end:
                place=row['to'];continue
            if phase<release:
                value=support(source['places'][row['from']]['surface'],'release',[start,release])
            elif phase>=approach and row['to']!='free':
                value=support(source['places'][row['to']]['surface'],'approach',[approach,end])
            else:
                value=mode('free')
            break
        feet[limb]=value if value is not None else mode('free') if place=='free' else support(source['places'][place]['surface'])
    return {**hands,**feet}


def build_clips(source, support):
    scale=source['clockUnits'];units=entry_units(source);phases=[u/scale for u in units]
    root={'anchor':'hips','reference':'authored','minimum':[0,0,0],'maximum':[0,0,0]}
    samples=[{'phase':p,'travel':p,'limbs':entry_support(source,p,support),'rootRegion':deepcopy(root)} for p in phases]
    intervals=[{'start':a,'end':b,'limbs':entry_support(source,(a+b)/2,support)} for a,b in zip(phases,phases[1:])]
    free={limb:mode('free') for limb in ['handL','handR','footL','footR']}
    paddle=[i/12 for i in range(13)]
    clips={'pool_enter':{'playback':'progress','samples':samples,'intervals':intervals},
           'pool_paddle':{'playback':'loop','samples':[{'phase':p,'travel':1.,'limbs':deepcopy(free),'rootRegion':deepcopy(root)} for p in paddle[:-1]],
                          'intervals':[{'start':a,'end':b,'limbs':deepcopy(free)} for a,b in zip(paddle,paddle[1:])]}}
    def exit_phase(value):
        if value==1:return .1
        if value==0:return 1.
        return 1-.9*value
    def reverse(limbs):
        result=deepcopy(limbs)
        for row in result.values():
            if row['mode'] in ['approach','release']:
                row['mode']='release' if row['mode']=='approach' else 'approach'
            if row['interval']:
                row['interval']=[exit_phase(row['interval'][1]),exit_phase(row['interval'][0])]
        return result
    cuts=sorted({0.,.1,1.,*(exit_phase(p) for p in phases)})
    for origin in range(12):
        entries=[{'phase':0.,'travel':1.,'limbs':deepcopy(free),'rootRegion':deepcopy(root)}]
        entries.extend({'phase':exit_phase(row['phase']),'travel':row['phase'],'limbs':reverse(row['limbs']),'rootRegion':deepcopy(root)} for row in reversed(samples))
        entries.sort(key=lambda r:r['phase'])
        windows=[]
        for a,b in zip(cuts,cuts[1:]):
            mid=(a+b)/2
            limbs=deepcopy(free) if mid<.1 else reverse(entry_support(source,(1-mid)/.9,support))
            windows.append({'start':a,'end':b,'limbs':limbs})
        clips[f'pool_exit_{origin}']={'playback':'progress','samples':entries,'intervals':windows}
    return clips
