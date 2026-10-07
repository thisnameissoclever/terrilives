"""Measure perspective page visibility from immutable evaluated meshes, without rendering."""
import hashlib
import json
import math
from pathlib import Path
import sys
import time

import numpy as np

sys.path.insert(0,str(Path(__file__).parent))
from continuous_support_patch import clip,intersect,signed_area

AREA_EPS=1e-14


def area(poly):return abs(signed_area(list(poly))) if len(poly)>=3 else 0.


def subtract(subject,blocker):
    pieces=[];inside=list(subject)
    for a,b in zip(blocker,np.roll(blocker,-1,axis=0)):
        edge=b-a;half=np.asarray([-edge[1],edge[0],edge[1]*a[0]-edge[0]*a[1]])
        outside=clip(inside,-half)
        if area(outside)>AREA_EPS:pieces.append(np.asarray(outside))
        inside=clip(inside,half)
        if area(inside)<=AREA_EPS:break
    return pieces


def controls():
    square=np.asarray([[0.,0.],[1.,0.],[1.,1.],[0.,1.]])
    half=np.asarray([[.5,-1.],[2.,-1.],[2.,2.],[.5,2.]])
    covered=sum(area(p) for p in subtract(square,half))
    assert abs(covered-.5)<1e-12
    assert not subtract(square,square)
    assert abs(sum(area(p) for p in subtract(square,half+[2.,0.]))-1)<1e-12
    return dict(half_cover_remaining=covered,complete_cover_remaining=0.,disjoint_remaining=1.)


def near_clip(triangle):
    result=[]
    for a,b in zip(triangle,np.roll(triangle,-1,axis=0)):
        da,db=a[2]-1e-6,b[2]-1e-6
        if da>=0:result.append(a)
        if (da<0)!=(db<0):result.append(a+(b-a)*da/(da-db))
    return [np.asarray([result[0],result[i],result[i+1]]) for i in range(1,len(result)-1)]


def project_mesh(points,triangles,origin,basis,distance,bounds=None,far=None):
    camera=(points-origin)@basis;source=camera[triangles];pieces=[];ids=[]
    for index,t in enumerate(source):
        if t[:,2].max()<=1e-6 or (far is not None and t[:,2].min()>far):continue
        for piece in ([t] if t[:,2].min()>=1e-6 else near_clip(t)):
            uv=distance*piece[:,:2]/piece[:,2,None]
            if bounds is not None and (np.any(uv.max(0)<bounds[0]) or np.any(uv.min(0)>bounds[1])):continue
            if area(uv)<=AREA_EPS:continue
            if signed_area(list(uv))<0:uv=uv[::-1];piece=piece[::-1]
            plane=np.linalg.solve(np.column_stack((uv,np.ones(3))),1/piece[:,2])
            pieces.append((uv,plane,float(piece[:,2].min())));ids.append(index)
    return pieces,ids


def run(source,output):
    output.mkdir(parents=True,exist_ok=False);began=time.monotonic();deadline=began+45
    proof=json.loads((source/'proof.json').read_text());case=next(c for c in proof['cases'] if c['label']=='proposal')
    cache_path=source/case['cache']['path'];cache=np.load(cache_path);prefix='proposal/geometry/'
    meshes={key[len(prefix):-len('/points')]:dict(points=cache[key],triangles=cache[key[:-len('/points')]+'/triangles']) for key in cache.files if key.startswith(prefix) and key.endswith('/points')}
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    inputs={str(p.resolve()):digest(p) for p in (Path(__file__),source/'proof.json',cache_path,Path(__file__).with_name('continuous_support_patch.py'))}
    report=dict(state='running',inputs=inputs,controls=controls(),eyes=[],
        convention='Perspective projection from each unchanged pupil front-envelope proxy along the measured gaze. Areas are square metres on a plane at that eye-to-book-center gaze depth. Incidence is degrees from the mean printed-page normal; 90 degrees is edge-on.',
        semantics='Panel-visible area includes printed ink as part of the reading panel; exposed-paper area additionally subtracts the ten ink cubes. All body and other book surfaces participate. This is geometric visibility, not perceived legibility or a render.',limits=dict(seconds=45,fragments=10000))
    arrays={};book=np.asarray(case['evaluated_frames']['book']);up=book[:3,1];up/=np.linalg.norm(up)
    page_center=np.mean([meshes['Reading book pages'+s]['points'].mean(0) for s in ('','.001')],0)
    try:
        for ray in (r for r in case['rows'] if r['kind']=='visible_page_ray'):
            origin=np.asarray(ray['origin']);gaze=np.asarray(ray['direction']);right=np.asarray([1.,0.,0.]);right-=gaze*(right@gaze);right/=np.linalg.norm(right)
            basis=np.column_stack((right,np.cross(gaze,right),gaze));distance=float((page_center-origin)@gaze)
            if distance<=0:raise ValueError('Page center is behind the eye proxy')
            targets=[];actual_area=0.;ortho_area=0.;far=0.
            for name in ('Reading book pages','Reading book pages.001'):
                m=meshes[name];tri=m['points'][m['triangles']];normal=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);norm=np.linalg.norm(normal,axis=1);unit=normal/norm[:,None]
                ids=np.flatnonzero(unit@up>.9)
                for index in ids:
                    actual_area+=norm[index]/2;ortho_area+=norm[index]/2*max(0.,float(unit[index]@(-gaze)))
                    if unit[index]@(origin-tri[index,0])<=0:continue
                    pieces,_=project_mesh(m['points'],m['triangles'][[index]],origin,basis,distance)
                    for uv,plane,z in pieces:targets.append(dict(part=name,triangle=int(index),uv=uv,plane=plane))
                    far=max(far,float(((tri[index]-origin)@gaze).max()))
            all_uv=np.concatenate([v['uv'] for v in targets]);bounds=[all_uv.min(0),all_uv.max(0)];occluders=[]
            for name,m in meshes.items():
                if time.monotonic()>deadline:raise TimeoutError('Cached view-area budget exhausted')
                pieces,ids=project_mesh(m['points'],m['triangles'],origin,basis,distance,bounds,far)
                for (uv,plane,z),index in zip(pieces,ids):occluders.append(dict(part=name,triangle=index,uv=uv,plane=plane,z=z))
            occluders.sort(key=lambda v:v['z'])
            eye=dict(side=ray['side'],projection_depth=distance,physical_top_page_area=actual_area,
                orthographic_gaze_projected_area=ortho_area,incidence_degrees=math.degrees(math.acos(float(np.clip(up@(-gaze),-1,1)))),
                unoccluded_perspective_area=sum(area(v['uv']) for v in targets),occluder_projected_triangles=len(occluders))
            for ink in (False,True):
                label='exposed_paper' if ink else 'readable_panel';polygons=[];target_ids=[];blockers=[]
                for ti,target in enumerate(targets):
                    fragments=[target['uv']]
                    for blocker in occluders:
                        if time.monotonic()>deadline:raise TimeoutError('Cached visibility subtraction budget exhausted')
                        if not ink and blocker['part'].startswith('Printed book line'):continue
                        if blocker['part']==target['part'] and blocker['triangle']==target['triangle']:continue
                        nearer=blocker['plane']-target['plane'];nearer[2]-=1e-9
                        block=clip(list(blocker['uv']),nearer)
                        if area(block)<=AREA_EPS:continue
                        block=np.asarray(block);before=sum(area(p) for p in fragments);remaining=[]
                        for fragment in fragments:
                            if np.any(fragment.max(0)<block.min(0)) or np.any(fragment.min(0)>block.max(0)):remaining.append(fragment)
                            else:remaining.extend(subtract(fragment,block))
                        fragments=remaining
                        if len(fragments)>10000:raise RuntimeError('Declared visibility-fragment budget exhausted')
                        removed=before-sum(area(p) for p in fragments)
                        if removed>AREA_EPS:blockers.append(dict(target=ti,part=blocker['part'],triangle=blocker['triangle'],removed_area=removed))
                        if not fragments:break
                    polygons.extend(fragments);target_ids.extend([ti]*len(fragments))
                value=sum(area(p) for p in polygons);key=ray['side']+'/'+label
                arrays[key+'/vertices']=np.concatenate(polygons) if polygons else np.empty((0,2));arrays[key+'/offsets']=np.cumsum([0]+[len(p) for p in polygons],dtype=np.int32);arrays[key+'/target_indices']=np.asarray(target_ids,dtype=np.int32)
                eye[label]=dict(visible_area=value,fraction_of_projected_page=value/eye['unoccluded_perspective_area'],fragments=len(polygons),effective_blockers=blockers)
            report['eyes'].append(eye)
        np.savez(output/'visibility.npz',**arrays);report['cache_sha256']=digest(output/'visibility.npz');report['state']='complete'
    except BaseException as error:report.update(state='failed',error=repr(error));raise
    finally:
        report['elapsed_seconds']=time.monotonic()-began;report['inputs_unchanged']=all(digest(Path(p))==sha for p,sha in inputs.items())
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps([dict(side=e['side'],depth=e['projection_depth'],incidence=e['incidence_degrees'],physical_cm2=e['physical_top_page_area']*1e4,
        orthographic_cm2=e['orthographic_gaze_projected_area']*1e4,projected_cm2=e['unoccluded_perspective_area']*1e4,panel_visible_cm2=e['readable_panel']['visible_area']*1e4,paper_visible_cm2=e['exposed_paper']['visible_area']*1e4) for e in report['eyes']],indent=2))


if __name__=='__main__':run(*(Path(p) for p in sys.argv[1:]))
