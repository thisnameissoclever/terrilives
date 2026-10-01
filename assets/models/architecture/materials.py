"""Stable finish identities and bounded resources, independent of geometry."""
from copy import deepcopy
import math

ROLES = {'none': 0, 'wall': 1, 'floor': 2, 'frame': 3, 'glazing': 4, 'trim': 5}
COLORS = {'plaster': (.69,.62,.50), 'trim': (.80,.74,.62),
          'cream': (.79,.74,.62), 'steel': (.20,.235,.24),
          'bronze': (.31,.235,.15), 'glass': (.25,.40,.49),
          'oak': (.43,.25,.12), 'sage': (.34,.43,.34),
          'charcoal': (.105,.13,.14), 'neutral': (1,1,1)}
PATTERNS = {
    'wall.plaster': {'role': 'wall', 'period': [1,1], 'resource': 'plaster'},
    'floor.boards': {'role': 'floor', 'period': [4,4], 'resource': 'boards'},
    'floor.tiles': {'role': 'floor', 'period': [4,4], 'resource': 'tiles'},
    'floor.carpet': {'role': 'floor', 'period': [4,4], 'resource': 'carpet'},
    'floor.neutral': {'role': 'floor', 'period': [4,4], 'resource': 'neutral'},
    'floor.grass': {'role': 'floor', 'period': [4,4], 'resource': 'grass'},
    'floor.street': {'role': 'floor', 'period': [4,4], 'resource': 'street'},
}
PALETTES = {'starter': {'multiply': [1,1,1]}}
FINISHES = {
    'wall.warm-plaster': {'patternKey': 'wall.plaster', 'paletteKey': 'starter'},
    **{f'floor.{key}': {'patternKey': f'floor.{key}', 'paletteKey': 'starter'}
       for key in ('boards','tiles','carpet','neutral','grass','street')},
}
COVERINGS = {0: 'floor.neutral', 1: 'floor.boards', 2: 'floor.tiles', 3: 'floor.carpet'}
AUTHORED_CONTENT_LOOKS = {'floor.neutral':[0,1,0], 'floor.boards':[18,1.15,-.12],
                         'floor.tiles':[-25,.55,.1], 'floor.carpet':[-20,1.6,-.18],
                         'floor.grass':[65,2,-.22], 'floor.street':[0,.15,-.22],
                         'wall.warm-plaster':[0,1,0]}


def catalogue():
    data=deepcopy({'patterns': PATTERNS, 'palettes': PALETTES,
                   'finishes': FINISHES, 'coverings': COVERINGS})
    for key,finish in data['finishes'].items(): finish['authoredContentLook']=AUTHORED_CONTENT_LOOKS[key][:]
    return data


def relative_content_look(current, authored):
    assert authored[1]>0 and current[1]>=0, 'invalid content strength'
    return [current[0]-authored[0],current[1]/authored[1],current[2]-authored[2]]


def validate_catalogue(data):
    for key, pattern in data['patterns'].items():
        assert pattern['role'] in ('wall','floor'), 'unknown pattern role'
        assert len(pattern['period']) == 2 and all(math.isfinite(n) and n > 0 for n in pattern['period']), 'invalid repeat period'
        assert pattern['resource'], 'missing pattern resource'
    for palette in data['palettes'].values():
        assert len(palette['multiply']) == 3 and all(math.isfinite(n) and n >= 0 for n in palette['multiply']), 'invalid palette'
    for finish in data['finishes'].values():
        assert finish['patternKey'] in data['patterns'], 'unknown pattern reference'
        assert finish['paletteKey'] in data['palettes'], 'unknown palette reference'
    for key, finish in data['coverings'].items():
        assert str(key).isdigit() and finish in data['finishes'], 'unknown covering reference'
        assert data['patterns'][data['finishes'][finish]['patternKey']]['role'] == 'floor', 'covering must use floor pattern'
    for key, finish in COVERINGS.items():
        assert data['coverings'].get(key, data['coverings'].get(str(key))) == finish, 'historical covering changed'


def resource_budget(data, active_finishes, geometry_pixels, pattern_pixels=256*256,
                    max_active_patterns=16, max_texture_bytes=128*1024*1024):
    validate_catalogue(data)
    assert all(key in data['finishes'] for key in active_finishes), 'unknown active finish'
    resources = {data['patterns'][data['finishes'][key]['patternKey']]['resource'] for key in active_finishes}
    assert len(resources) <= max_active_patterns, 'active pattern budget exceeded'
    accepted = geometry_pixels * 6  # RGBA color + R16Float depth
    active = geometry_pixels * 7 + len(resources)*pattern_pixels*4  # carrier + role + depth
    assert max(accepted, active) <= max_texture_bytes, 'texture memory budget exceeded'
    return {'accepted_bytes': accepted, 'active_finish_bytes': active,
            'active_pattern_count': len(resources), 'catalogue_finish_count': len(data['finishes'])}


def fixture_catalogue(count=1000):
    data = catalogue()
    data['patterns']['fixture.checks'] = {'role':'floor','period':[2,2],'resource':'fixture-checks'}
    data['patterns']['fixture.stripes'] = {'role':'wall','period':[1,2],'resource':'fixture-stripes'}
    data['palettes']['fixture.cool'] = {'multiply':[.65,.82,1.1]}
    data['palettes']['fixture.warm'] = {'multiply':[1.12,.85,.67]}
    for i in range(count):
        data['finishes'][f'fixture.{i}'] = {'patternKey':'fixture.checks' if i%2 else 'fixture.stripes',
                                         'paletteKey':'fixture.cool' if i%3 else 'fixture.warm'}
    data['coverings'][4] = 'fixture.1'
    validate_catalogue(data)
    return data


def reconstruct(px, py, origin, density, depth):
    """Texel centers to local coordinates; add placement origin before repeating."""
    sx=(px+.5)/density-origin[0]
    sy=(py+.5)/density-origin[1]
    return ((depth+sx/32)/2, (depth-sx/32)/2, (21*depth-sy)/38)


def repeat_coordinates(point, role, world_origin=(0,0,0)):
    x,y,z=(point[i]+world_origin[i] for i in range(3))
    return (x,y) if role == 'floor' else (x+y,z)
