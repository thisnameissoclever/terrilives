"""Exact evaluated-geometry reuse with unchanged complete residual delivery."""
import copy
import hashlib
import numpy as np


def geometry_key(surface):
    points=np.asarray(surface.points,dtype=np.float64)
    triangles=np.asarray(surface.triangles,dtype=np.int32)
    digest=hashlib.sha256()
    for value in (points,triangles):
        digest.update(str(value.shape).encode('ascii'));digest.update(value.tobytes())
    return digest.hexdigest()


def relocate(value, prefix):
    if isinstance(value,str) and (value=='memo' or value.startswith('memo/')):return prefix+value[4:]
    if isinstance(value,dict):return {key:relocate(item,prefix) for key,item in value.items()}
    if isinstance(value,list):return [relocate(item,prefix) for item in value]
    if isinstance(value,tuple):return tuple(relocate(item,prefix) for item in value)
    return value


class ExactGeometryMemo:
    """Keep one latest entry per semantic query, never a rounded or pose-only key."""
    def __init__(self):
        self.entries={};self.hits=0;self.misses=0

    def query(self, semantic, dependencies, calculate, arrays, prefix):
        cached=self.entries.get(semantic)
        if cached is None or cached['dependencies']!=dependencies:
            local={};value=calculate(local,'memo')
            cached=dict(dependencies=dependencies,value=copy.deepcopy(value),arrays={k:v.copy() for k,v in local.items()})
            self.entries[semantic]=cached;self.misses+=1
        else:self.hits+=1
        for key,value in cached['arrays'].items():arrays[relocate(key,prefix)]=value
        return relocate(copy.deepcopy(cached['value']),prefix)
