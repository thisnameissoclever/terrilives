"""Physical authoring checks run before rendering and again by the importer."""
from windows import MODELS, DIRECTIONS, Prism, model_parts
from geometry import CUT_HEIGHT


def bounds(parts):
    return [[min(p.lower[i] for p in parts) for i in range(3)],
            [max(p.upper[i] for p in parts) for i in range(3)]]


def part_record(p):
    result={'name':p.name,'lower':list(p.lower),'upper':list(p.upper),'material':p.material}
    if isinstance(p,Prism):
        result.update(polygon=[list(v) for v in p.polygon],y0=p.y0,y1=p.y1,turns=p.turns)
    return result


def validate_window_geometry(model_id, records):
    """Canonical unrotated full model; contacts use dimensions rather than labels alone."""
    width=MODELS[model_id][1]
    assert all(all(p['lower'][i]<p['upper'][i] for i in range(3)) for p in records), 'degenerate window solid'
    assert min(p['lower'][2] for p in records)==0, 'window wall floats above floor'
    assert max(p['upper'][2] for p in records)==2, 'window height changed'
    assert min(p['lower'][0] for p in records)==-width/2 and max(p['upper'][0] for p in records)==width/2, 'window width changed'
    z0,z1=(1.45,1.80) if model_id==9 else (.65,1.82)
    sills=[p for p in records if p['name']=='Stone sill']
    assert len(sills)==1, 'missing sill'
    sill=sills[0]
    assert abs(sill['lower'][2]-(z0-.055))<1e-8 and abs(sill['upper'][2]-(z0+.01))<1e-8, 'detached sill'
    assert sill['lower'][1]<-.06 and sill['upper'][1]>.06, 'sill does not bridge both wall faces'
    plaster=[p for p in records if p['material']=='plaster']
    assert any(abs(p['upper'][2]-z0)<1e-8 and p['lower'][0]<=0<=p['upper'][0] for p in plaster), 'unsupported sill'
    assert any(abs(p['lower'][2]-z1)<1e-8 and p['lower'][0]<=0<=p['upper'][0] for p in plaster), 'unsupported lintel'
    for p in records:
        if p['material']=='glass':
            assert p['lower'][2]>=z0+.054 and p['upper'][2]<=z1-.054, 'glazing outside frame joints'
            assert p['lower'][0]>=-width/2+.19 and p['upper'][0]<=width/2-.19, 'glazing outside side joints'
        if p['name'] in ('Vertical bar','Meeting rail','Overlapping center rail',
                         'Upper light rail','Horizontal bar','Casement crossbar'):
            assert (p['lower'][2]>=z0+.04 and p['upper'][2]<=z1-.04
                    and p['lower'][0]>=-width/2+.18 and p['upper'][0]<=width/2-.18
                    and p['lower'][1]>=-.048 and p['upper'][1]<=.048), 'bar outside authored frame joints'


def validate_case(case):
    parts=case['parts']
    assert parts, 'empty geometry'
    assert min(p.lower[2] for p in parts)>=-.012, 'geometry below floor'
    if case['heightMode']=='cut':
        assert max(p.upper[2] for p in parts)<=CUT_HEIGHT, 'cutaway retained upper frame'
    if case['kind']=='window':
        assert case['direction'] in DIRECTIONS, 'unknown window direction'
        assert case['width']==MODELS[case['model']][1], 'window width changed'
        validate_window_geometry(case['model'],[part_record(p) for p in model_parts(case['model'])])
    return {'bounds':bounds(parts),'parts':[part_record(p) for p in parts]}
