"""Test one rigid-book support construction with unchanged saved hand and arm poses."""
import hashlib
import json
import math
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0,str(Path(__file__).parent))
import continuous_support_patch as continuous


def rotation(angle):
    c,s=math.cos(angle),math.sin(angle)
    return np.asarray([[c,-s,0],[s,c,0],[0,0,1.]])


def planes(points,triangles):
    faces=points[triangles]
    n=np.cross(faces[:,1]-faces[:,0],faces[:,2]-faces[:,0])
    n/=np.linalg.norm(n,axis=1)[:,None]
    return faces[:,0],n


def run(verified,output):
    output.mkdir(parents=True,exist_ok=False)
    prior=json.loads((verified/'proof.json').read_text())
    cases=[c for c in prior['cases'] if c['kind']=='source']
    paths=[Path(__file__),Path(continuous.__file__),verified/'proof.json']+[verified/c['cache']['path'] for c in cases]
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    report=dict(state='running',inputs={str(p.resolve()):digest(p) for p in paths},cases=[],
        scope='Cached control only: original arms/hands retained; book roll and height solve both palm support planes at palm-centered lateral/depth placement. This is one rigid-book family, not an exhaustive feasibility claim.')
    for number,case in enumerate(cases):
        cache=np.load(verified/case['cache']['path'])
        inv=np.linalg.inv(np.asarray(case['hand_book']['frames']['book']))@np.linalg.inv(cache['rig_matrix_world'])
        geometry={}
        for key in cache.files:
            if key.endswith('/world_points'):
                name=key[:-len('/world_points')]
                if name.startswith(('Relaxed palm','Resting thumb','Forearm with elbow','Reading book cover','Reading book pages')):
                    geometry[name]=cache[key]@inv[:3,:3].T+inv[:3,3]
        palm_center=np.mean([geometry['Relaxed palm'].mean(0),geometry['Relaxed palm.001'].mean(0)],axis=0)
        book_center=np.mean([geometry['Reading book cover'].mean(0),geometry['Reading book cover.001'].mean(0)],axis=0)
        def at(angle):
            rot=rotation(angle)
            t=np.zeros(3);t[[0,2]]=(palm_center-rot@book_center)[[0,2]]
            heights=[];normals=[]
            for suffix in ('','.001'):
                book_name='Reading book cover'+suffix
                origins,n=planes(geometry[book_name],cache[book_name+'/triangles'])
                face=int(np.argmin(n[:,1]));up=-(rot@n[face]);normals.append(up)
                plane_point=rot@origins[face]+t
                heights.append((np.max(geometry['Relaxed palm'+suffix]@up)+.0005-plane_point@up)/up[1])
            return heights[0]-heights[1],rot,t,heights,normals
        low,high=-math.pi/4,math.pi/4
        lo,hi=at(low)[0],at(high)[0]
        if lo*hi>0: raise ValueError('Measured support-height equation has no bracket in this construction')
        for _ in range(55):
            mid=(low+high)/2; value=at(mid)[0]
            if value*lo>0: low=mid;lo=value
            else: high=mid
        angle=(low+high)/2;residual,rot,t,heights,normals=at(angle);t[1]=sum(heights)/2
        transformed={name:(points@rot.T+t if name.startswith('Reading book') else points) for name,points in geometry.items()}
        row=dict(phase=case['phase'],book_roll_degrees=math.degrees(angle),translation_in_source_book_frame=t.tolist(),support_height_residual=residual,contacts={},penetration=[])
        arrays={}
        for name,points in transformed.items():
            arrays[name+'/points']=points;arrays[name+'/triangles']=cache[name+'/triangles']
        for side,suffix,up in zip(('L','R'),('','.001'),normals):
            book='Reading book cover'+suffix;palm='Relaxed palm'+suffix
            result=continuous.measure(transformed[book],cache[book+'/triangles'],transformed[palm],cache[palm+'/triangles'],up,.0015)
            row['contacts'][side]={}
            for key,value in result.items():
                if isinstance(value,np.ndarray):arrays['contact/'+side+'/'+key]=value
                else:row['contacts'][side][key]=value
        for book,bp in transformed.items():
            if not book.startswith('Reading book'):continue
            origins,n=planes(bp,cache[book+'/triangles'])
            if not all(np.max((bp-origin)@normal)<=1e-6 for origin,normal in zip(origins,n)):
                raise ValueError('Expected convex book solid')
            for hand,hp in transformed.items():
                if hand.startswith('Reading book'):continue
                signed=np.einsum('nkd,kd->nk',hp[:,None]-origins[None],n)
                inside=np.all(signed < -1e-6,axis=1)
                arrays[hand+'/'+book+'/inside_vertices']=np.flatnonzero(inside)
                if inside.any():row['penetration'].append(dict(hand=hand,book=book,inside_vertices=int(inside.sum()),maximum_depth=float(np.min(-signed[inside],axis=1).max())))
        filename=f'case-{number:02d}.npz';np.savez(output/filename,**arrays)
        row.update(cache=dict(path=filename,sha256=digest(output/filename)),verdict='Rejected if penetration or missing finite support; zero vertex penetration alone would require triangle-crossing verification')
        report['cases'].append(row)
    report['state']='complete'
    assert all(digest(Path(p))==sha for p,sha in report['inputs'].items())
    (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report['cases'],indent=2))


if __name__=='__main__':
    run(*(Path(p) for p in sys.argv[1:]))
