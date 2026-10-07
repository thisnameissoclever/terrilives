"""Solve measured palm/thumb support-envelope tangency with the original arms fixed."""
import hashlib
import json
import math
from pathlib import Path
import sys
import time

import numpy as np
from scipy.optimize import brentq

sys.path.insert(0,str(Path(__file__).parent))
import book_grip_book_only as helper
import continuous_support_patch as contact


def triangle_box_hits(triangles,center,axes,half):
    tri=(triangles-center)@axes
    half=half-1e-6
    mask=np.all(tri.min(1)<=half,axis=1)&np.all(tri.max(1)>=-half,axis=1)
    ids=np.flatnonzero(mask);t=tri[ids]
    if not len(ids):return ids
    edges=np.roll(t,-1,axis=1)-t
    directions=[np.cross(edges[:,0],edges[:,1])]
    for axis in np.eye(3):
        directions.extend(np.cross(edges[:,edge],axis) for edge in range(3))
    valid=np.ones(len(ids),dtype=bool)
    for axis in directions:
        projection=np.einsum('nvi,ni->nv',t,axis);radius=np.abs(axis)@half
        valid &= (projection.min(1)<=radius)&(projection.max(1)>=-radius)
    return ids[valid]


def run(source,output):
    start=time.time();output.mkdir(parents=True,exist_ok=False)
    proof=json.loads((source/'proof.json').read_text());case=next(c for c in proof['cases'] if c['kind']=='source' and c['phase']==.75)
    cache=np.load(source/case['cache']['path']);inverse=np.linalg.inv(np.asarray(case['hand_book']['frames']['book']))@np.linalg.inv(cache['rig_matrix_world'])
    points={key[:-len('/world_points')]:cache[key]@inverse[:3,:3].T+inverse[:3,3] for key in cache.files if key.endswith('/world_points')}
    palms=[points['Relaxed palm'+suffix] for suffix in ('','.001')];thumbs=[points['Resting thumb'+suffix] for suffix in ('','.001')]
    names=['Reading book cover'+suffix for suffix in ('','.001')];ups=[];origins=[]
    for name in names:
        o,n=helper.planes(points[name],cache[name+'/triangles']);face=int(np.argmin(n[:,1]));ups.append(-n[face]);origins.append(o[face])
    palmcenter=np.mean([p.mean(0) for p in palms],0);bookcenter=np.mean([points[n].mean(0) for n in names],0)
    def orientation(pitch):
        c,s=math.cos(pitch),math.sin(pitch);rx=np.asarray([[1,0,0],[0,c,-s],[0,s,c]])
        def at(roll):
            r=rx@helper.rotation(roll);t=np.zeros(3);t[[0,2]]=(palmcenter-r@bookcenter)[[0,2]];normals=[r@n for n in ups]
            heights=[(np.max(p@n)+.0005-(r@o+t)@n)/n[1] for p,n,o in zip(palms,normals,origins)]
            return heights[0]-heights[1],r,normals
        roll=brentq(lambda a:at(a)[0],-.78,.78,xtol=1e-13);_,r,normals=at(roll)
        gaps=[float(np.max(t@n)-np.max(p@n)) for p,t,n in zip(palms,thumbs,normals)]
        return max(gaps)+.0005,r,normals,roll,gaps
    pitch=brentq(lambda a:orientation(a)[0],0,math.radians(75),xtol=1e-13)
    _,rotation,normals,roll,thumb_gaps=orientation(pitch)
    top=[p[np.argmax(p@n)] for p,n in zip(palms,normals)];forward=rotation@np.asarray([0.,0.,1.])
    equations=np.vstack([*normals,forward]);rhs=np.asarray([np.max(p@n)+.0005-(rotation@o)@n for p,n,o in zip(palms,normals,origins)]+[(np.mean(top,0)-rotation@bookcenter)@forward])
    translation=np.linalg.solve(equations,rhs)
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    paths=[Path(__file__),Path(helper.__file__),Path(contact.__file__),source/'proof.json',source/case['cache']['path']]
    report=dict(inputs={str(p.resolve()):digest(p) for p in paths},scope='Exact cached support-envelope boundary with fixed source phase-.75 body; original files and actions unchanged',pitch_degrees=math.degrees(pitch),roll_degrees=math.degrees(roll),rotation=rotation.tolist(),translation=translation.tolist(),thumb_support_excess=thumb_gaps,contacts={},collisions=[],source_internal=case['internal'],source_body_contacts=case['self_contacts'])
    arrays={}
    for name,p in points.items():
        if name.startswith(('Reading book','Printed book line')):p=p@rotation.T+translation
        arrays[name+'/points']=p;arrays[name+'/triangles']=cache[name+'/triangles']
    for side,name,palm,normal in zip(('L','R'),names,palms,normals):
        palmname='Relaxed palm'+('' if side=='L' else '.001')
        value=contact.measure(arrays[name+'/points'],cache[name+'/triangles'],palm,cache[palmname+'/triangles'],normal,.0015)
        report['contacts'][side]={}
        for key,item in value.items():
            if isinstance(item,np.ndarray):arrays['contact/'+side+'/'+key]=item
            else:report['contacts'][side][key]=item
    for book in [name for name in points if name.startswith(('Reading book cover','Reading book pages'))]:
        bp=arrays[book+'/points'];center=bp.mean(0);_,axes=np.linalg.eigh(np.cov(bp.T));half=np.max(np.abs((bp-center)@axes),axis=0)
        for body in points:
            if body.startswith(('Reading book','Printed book line')):continue
            triangles=arrays[body+'/points'][cache[body+'/triangles']]
            hit=triangle_box_hits(triangles,center,axes,half)
            if len(hit):
                key='collision/'+body+'/'+book;arrays[key]=hit
                report['collisions'].append(dict(body=body,book=book,triangles=len(hit),witness_array=key))
    eye=next((p.mean(0) for name,p in points.items() if 'eye' in name.lower() and not 'brow' in name.lower()),None)
    if eye is not None:
        normal=rotation@np.asarray([0.,1.,0.]);center=rotation@bookcenter+translation
        report['reading_side_test']=dict(eye_point=eye.tolist(),book_center=center.tolist(),page_normal=normal.tolist(),signed_eye_distance=float((eye-center)@normal),semantics='Negative means eyes lie behind the mean printed-page plane; not a visibility render')
    np.savez(output/'geometry.npz',**arrays)
    assert all(digest(Path(p))==sha for p,sha in report['inputs'].items())
    report.update(state='complete',elapsed_seconds=time.time()-start,cache_sha256=digest(output/'geometry.npz'),acceptance='Unaccepted cached geometry only; no Blender replay or render')
    (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:report[k] for k in ('pitch_degrees','roll_degrees','translation','contacts','collisions','reading_side_test','elapsed_seconds') if k in report},indent=2))


if __name__=='__main__':run(*(Path(p) for p in sys.argv[1:]))
