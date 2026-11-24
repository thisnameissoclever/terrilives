"""Author a right-hand-first transfer from the installed two-rail climb."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from derive_pool_supported_crest import canonical, digest


BASE = ('b2c53f25558f65ea3e71061785bcd51577c2604163722b9cace19e650743646a',
        '949bfb68e48b5e3c3941b5f3ffbd47251ecd3e1a24a17b4e7469352f770a6b5f',
        'faaecebc393a23659379777da45a17f157310a07116e00e262a25fcab6b64bd9')
NAMES = ('pool_activity_motion_v19.json', 'contacts-v8.json', 'ladder-climb-out-v2.poolroute')


def derive(source):
    inputs = (source/'pool_activity_motion_v18.json', source/'clips/pool/contacts-v7.json',
              source/'clips/pool/ladder-climb-out-v1.poolroute')
    raw = [p.read_bytes() for p in inputs]
    if tuple(digest(b) for b in raw) != BASE:
        raise ValueError('The exit inputs differ from the accepted split-level source.')
    motion, fixture, route = (json.loads(b) for b in raw)
    if fixture['revisions']['poseProducer'] != route['motion'] or route['motion'] != BASE[0]:
        raise ValueError('The independent climb references and fixture must share their source motion.')
    clock = motion['clockUnits']
    hop = motion['forwardHop']
    clip = fixture['clips']['pool_exit_0']
    outer = fixture['rails'][0]['id']
    phases = sorted({tuple(s['limbs']['handL']['interval']) for s in clip['samples']
                     if s['limbs']['handL']['mode'] == 'approach' and s['limbs']['handL']['surface'] == outer})
    (start, early), (approach, acquire) = phases
    inside = next(s for s in clip['samples'] if s['phase'] == start)
    if inside['limbs']['handR']['interval'] != [start, early]:
        raise ValueError('Expected the original simultaneous exterior approach.')
    release = next(s['limbs']['handL']['interval'] for s in clip['samples']
                   if s['phase'] > early and s['limbs']['handL']['mode'] == 'release' and
                   s['limbs']['handL']['surface'] == outer)
    tucked = next(s for s in clip['samples'] if s['phase'] > release[1] and s['limbs']['handL']['mode'] == 'free')
    unit = lambda t: round(t*clock)
    transfer = {'kind':'right-first', 'rightContactUnit':unit(early),
                'leftApproachUnit':unit(approach), 'leftContactUnit':unit(acquire)}
    hop['outerGripTransfer'] = transfer
    for i in range(12):
        exit_clip = fixture['clips']['pool_exit_'+str(i)]
        for rows, is_key in ((exit_clip['samples'], True), (exit_clip['intervals'], False)):
            for s in rows:
                phase = s['phase'] if is_key else (s['start']+s['end'])/2
                if start <= phase < approach:
                    s['limbs']['handL'] = deepcopy(tucked['limbs']['handL'])
    references = {s['unit']:s for s in route['exitReferences']}
    free_hand = references[unit(tucked['phase'])]['limbs']['handL']
    if 'contact' in free_hand:
        raise ValueError('The selected tuck must be an independently authored free wrist.')
    for knot in route['exitReferences']:
        if unit(start) <= knot['unit'] <= unit(tucked['phase']):
            # This source command is relative to the configured shoulder and upper-arm length.
            knot['limbs']['handL'] = deepcopy(free_hand)
    motion_bytes = (json.dumps(motion, indent=2)+'\n').encode()
    route['motion'] = digest(motion_bytes)
    fixture['revisions'].update(poseProducer=route['motion'], clipLibrary=digest(canonical(fixture['clips'])))
    template_bytes = json.dumps(route, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    return motion_bytes, canonical(fixture)+b'\n', template_bytes


def write_pair(source, output):
    data = derive(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise FileExistsError(output)
    with TemporaryDirectory(dir=output.parent, prefix=output.name+'.') as temporary:
        bundle=Path(temporary)/'bundle'
        bundle.mkdir()
        for name, body in zip(NAMES, data):
            (bundle/name).write_bytes(body)
        bundle.rename(output)
    return {name:{'bytes':len(body), 'sha256':digest(body)} for name, body in zip(NAMES, data)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    print(json.dumps(write_pair(args.source, args.output), indent=2))
