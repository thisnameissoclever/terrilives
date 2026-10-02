"""Periodic authored surface maps; a shared four-by-four render supplies all phases."""
import math
from geometry import box

PATTERN_NAMES=('boards','tiles','carpet','neutral','grass','street')
PATTERN_SIZE=256
PERIOD=4


def grain(x,y,seed=0):
    # Integer hash with a finite authored repeat; no runtime or simulation random draws.
    value=((x%256)*73856093)^((y%256)*19349663)^(seed*83492791)
    return ((value^(value>>13))*1274126177 & 255)/255


def pattern_rgb(name,x,y):
    x%=256; y%=256
    if name=='plaster':
        color=(.69,.62,.50); factor=.97+.03*grain(x,y,8)
    elif name=='boards':
        row=y//16
        end=(x+(32 if row%2 else 0))%64
        color=((.43,.25,.12),(.49,.30,.15),(.38,.215,.105))[(row+x//64)%3]
        factor=(.70 if y%16==0 or end==0 else .97+.03*grain(x//2,y,1))
    elif name in ('tiles','neutral'):
        color=(.69,.70,.66) if name=='tiles' else (.73,.71,.65)
        factor=.70 if x%32==0 or y%32==0 else 1
    elif name=='carpet':
        color=(.26,.37,.37); factor=.88+.12*grain(x,y,3)
    elif name=='grass':
        color=(.30,.40,.18); factor=.86+.14*grain(x,y,4)
    elif name=='street':
        color=(.26,.27,.27); factor=.92+.08*grain(x,y,5)
    elif name=='fixture-checks':
        color=(.8,.8,.8) if (x//32+y//32)%2 else (.35,.35,.35); factor=1
    elif name=='fixture-stripes':
        color=(.8,.8,.8) if x%32<16 else (.4,.4,.4); factor=1
    else: raise ValueError('Unknown authored pattern')
    return tuple(c*factor for c in color)


def phase(x,y):
    assert type(x) is int and type(y) is int
    return (x%PERIOD,y%PERIOD)


def floor_cases():
    for name in PATTERN_NAMES:
        yield {'geometryKey':f'floor-patch.{name}','kind':'floor-patch','width':4,
               'direction':'world','heightMode':'floor','patternKey':f'floor.{name}',
               'parts':[box('Floor patch',-.5,3.5,-.5,3.5,-.012,0,'floor-'+name)]}
