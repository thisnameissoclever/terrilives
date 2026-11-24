"""Pair the V6 ladder with a forward hop and an independently timed climb out."""
import argparse
from copy import deepcopy
from pathlib import Path
import json

from derive_pool_supported_crest import canonical, digest


CLOCK = 100000
TAKEOFF = 60000
BRIDGE_END = 10000
FLIGHT = [50668, 52000, 53000, 54000, 55000, 57000, 59000, TAKEOFF,
          61250, 62500, 63750, 65000, 67500, 70000, 72500, 75000, 77500,
          80000, 82500, 85000, 87500, 90000, 92500, 95000, 97500, CLOCK]
CLIMB = [0, BRIDGE_END, 11500, 13000, 16000, 17500, 19000, 20500, 22000, 24000, 25000,
         27000, 28500, 30000, 32000, 34000, 36000, 38000, 39000, 40000, 41000, 42000,
         44000, 46000, 50000, 52000, 54000, 54500, 55000, 55500, 55750, 56000, 57000, 58000, 59000, 59250,
         60000, 61000, 62000, 64000]
# Measured maximum pelvis, wrist or ankle travel paces the shared supported crossing.
CROSSING_EXIT = {46656:65000,46467:66895,46278:67618,45900:68503,45225:69094,
                 44550:69681,44513:70012,44476:70531,44439:71832,44420:72466,
                 44402:72928,44381:73116,44240:73371,44212:73421,44044:73725,
                 43875:74030,43200:74769,42800:76193,42400:76596,42101:76896,
                 42001:76996,42000:77000}


def interpolate_key(value, pairs):
    for (a,x),(b,y) in zip(pairs,pairs[1:]):
        if value == a:
            return x
        if a < value <= b:
            return y if value == b else x+(y-x)*(value-a)/(b-a)
    raise ValueError(f'Unit outside authored clock: {value}')


def write_pair(source, output):
    motion_bytes = (source / 'motion.json').read_bytes()
    motion = json.loads(motion_bytes)
    fixture = json.loads((source / 'contacts.json').read_bytes())
    if fixture['revisions']['poseProducer'] != digest(motion_bytes):
        raise ValueError('Input motion and contact fixture differ.')
    if motion['modelSource'] != 'outdoor/pool_activity_model_v6.py':
        raise ValueError('The hop is authored on the relieved V6 landing.')
    if motion['crestRoute']['path'] != 'supported-turn':
        raise ValueError('The launch follows the supported turn with the left foot in flight.')
    old = fixture['clips']['pool_enter']
    regions = {support['surface']:support['region'] for row in old['samples']
               for support in row['limbs'].values() if support['surface']}
    root = old['samples'][0]['rootRegion']
    def state(surface=None, mode='free', interval=None):
        return {'mode':mode, 'surface':surface, 'interval':interval,
                'intervalSpace':'clip-phase', 'region':deepcopy(regions.get(surface))}
    def surfaces(unit):
        phase = unit/CLOCK
        at = next((key for key in old['samples'] if key['phase'] == phase), None)
        if at is None:
            at = next(row for row in old['intervals'] if row['start'] <= phase < row['end'])
        return deepcopy(at['limbs'])
    def enter(unit):
        if unit < 50668:
            return surfaces(unit)
        result = {limb:state() for limb in ('footL','footR','handL','handR')}
        for limb, name, begin, end in [('footR','Pool ladder crest landing',60000,61250),
                                       ('handR','Pool ladder rail 2',53000,59000),
                                       ('handL','Pool ladder rail 1',50668,55000)]:
            if unit < begin:
                result[limb] = state(name, 'support')
            elif unit < end:
                result[limb] = state(name, 'release', [begin/CLOCK,end/CLOCK])
        return result
    def activity(units, policy, travel):
        return {'playback':'progress', 'samples':[
            {'phase':u/CLOCK,'travel':travel(u),'limbs':policy(u),'rootRegion':root} for u in units],
            'intervals':[{'start':a/CLOCK,'end':b/CLOCK,'limbs':policy((a+b)/2)}
                         for a,b in zip(units,units[1:])]}
    original = [round(row['phase']*CLOCK) for row in old['samples']]
    entry = sorted({u for u in original if u < 50668} | set(FLIGHT))
    # The last exterior steps retrace the measured ground-to-crest climb.
    timing = [(0,0),(10000,10000),(25000,28000),(46000,45000),(50000,48500),
              (54000,50500),(56000,54750),(58000,57500),(60000,59800),(62000,62500),(64000,65000)]
    keys = [{'unit':round(interpolate_key(u,timing)),'authoredUnit':u} for u in CLIMB]
    for key in keys:
        if key['authoredUnit'] in (61000,62000):
            key['poseEntryUnit']={61000:48401,62000:47410}[key['authoredUnit']]
    keys[-1]['entryUnit']=46656
    for old_unit in sorted((u for u in original if u<46656),reverse=True):
        at=64000+(46656-old_unit)*36000/46656
        play=CROSSING_EXIT[old_unit] if old_unit>=42000 else max(keys[-1]['unit']+1,round(77000+(42000-old_unit)*23000/42000))
        keys.append({'unit':play,'authoredUnit':round(at),'entryUnit':old_unit})
    if keys[-1]['unit']!=CLOCK:
        raise ValueError('The exterior descent does not fit its action clock.')
    climb=[row['unit'] for row in keys]
    outside=[(r['unit'],r['entryUnit']) for r in keys if 'entryUnit' in r]
    from_entry={entry:play for play,entry in outside}
    internal=[(r['unit'],r['authoredUnit']) for r in keys if r['unit']<=65000]
    to_play={u:play for play,u in internal}
    schedule = {
        'handR':[(22000,25000, 'Pool ladder rail 1', 54000,56000),
                 (58000,64000, 'Pool ladder rail 2',64000,64000)],
        'handL':[(22000,25000, 'Pool ladder rail 2', 54000,56000),
                 (58000,64000, 'Pool ladder rail 1',64000,64000)],
        'footR':[(34000,38000,'Pool inside ladder tread 3',50000,52000),
                 (55000,58000,'Pool ladder crest landing',64000,64000)],
        'footL':[(24000,28500,'Pool inside ladder tread 2',38000,40000),
                 (42000,46000,'Pool ladder crest landing',58000,59000)]}
    def exit_state(phase_unit):
        if phase_unit >= 65000:
            reverse = interpolate_key(phase_unit,outside)
            result = surfaces(reverse)
            for support in result.values():
                if support['mode'] in ('approach','release'):
                    support['mode'] = {'approach':'release','release':'approach'}[support['mode']]
                    support['interval'] = [from_entry[round(p*CLOCK)]/CLOCK for p in reversed(support['interval'])]
            return result
        unit=interpolate_key(phase_unit,internal)
        result = {limb:state() for limb in schedule}
        for limb, rows in schedule.items():
            for a,b,s,c,d in rows:
                if a <= unit < b: result[limb] = state(s,'approach',[to_play[a]/CLOCK,to_play[b]/CLOCK])
                if b <= unit < c: result[limb] = state(s,'support')
                if c <= unit < d: result[limb] = state(s,'release',[to_play[c]/CLOCK,to_play[d]/CLOCK])
        return result
    fixture['clips']['pool_enter'] = activity(entry, enter, lambda u:u/CLOCK)
    for i in range(12):
        fixture['clips'][f'pool_exit_{i}'] = activity(climb,exit_state,lambda u:1 if u<=BRIDGE_END else (CLOCK-u)/(CLOCK-BRIDGE_END))
    foot_motion = [{field:row[field] for field in ('limb','from','to','startUnit','endUnit')}
                   for row in motion['footTransitions'] if row['endUnit']<=42000]
    for limb,place,start in [('footL','outside3',42000),('footR','crest',TAKEOFF)]:
        foot_motion.append({'limb':limb,'from':place,'to':'free','startUnit':start,'endUnit':75000})
    motion['nativeTicks']['exit']=40
    motion['forwardHop'] = dict(kind='separate-climb-out',takeoffUnit=TAKEOFF,bridgeEndUnit=BRIDGE_END,exitTicks=40,
                                standingUnit=CLOCK,entryUnits=entry,climbOutUnits=climb,
                                climbKeys=keys,footTransitions=foot_motion)
    raw = (json.dumps(motion,indent=2)+'\n').encode()
    fixture['revisions'].update(poseProducer=digest(raw),clipLibrary=digest(canonical(fixture['clips'])))
    output.mkdir(parents=True,exist_ok=True)
    for name,data in [('motion.json',raw),('contacts.json',canonical(fixture)+b'\n')]:
        with (output/name).open('xb') as target:
            target.write(data)


if __name__ == '__main__':
    cli = argparse.ArgumentParser()
    cli.add_argument('source',type=Path)
    cli.add_argument('output',type=Path)
    args = cli.parse_args()
    write_pair(args.source,args.output)
