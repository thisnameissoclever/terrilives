"""Classify retained sleeve self-crossings against actual shirt sections and material joins."""
import collections
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np

sys.path.insert(0,str(Path(__file__).parent))
from classify_sofa_lap_contacts import source_map,functions_from
from sofa_coupled_contact_evaluator_v2 import component_ids
from sofa_coupled_contact_evaluator import nearest_distance
from book_grip_reading_geometry import Mesh,Kernel

EPS=1e-6


def boundary(triangles):
    edges=collections.Counter(tuple(sorted((int(a),int(b)))) for tri in triangles for a,b in zip(tri,np.roll(tri,-1)))
    return np.asarray([e for e,n in edges.items() if n==1],dtype=np.int32)


def material_components(triangles,blocked):
    edges=collections.defaultdict(list)
    for i,tri in enumerate(triangles):
        if i in blocked:continue
        for a,b in zip(tri,np.roll(tri,-1)):edges[tuple(sorted((int(a),int(b))))].append(i)
    neighbors=collections.defaultdict(set)
    for ids in edges.values():
        for a in ids:neighbors[a].update(b for b in ids if b!=a)
    remaining=set(range(len(triangles)))-blocked;result=[];mapping={}
    while remaining:
        todo=[remaining.pop()];found=set(todo)
        while todo:
            for n in neighbors[todo.pop()]:
                if n not in found:found.add(n);remaining.discard(n);todo.append(n)
        index=len(result)
        for face in found:mapping[face]=index
        result.append(np.asarray(sorted(found),dtype=np.int32))
    return result,mapping


def section(triangles,z):
    selected=triangles[(triangles[:,:,2].min(1)<=z)&(triangles[:,:,2].max(1)>=z)]
    segments=[];coplanar=0
    for tri in selected:
        d=tri[:,2]-z
        if np.max(np.abs(d))<1e-10:coplanar+=1;continue
        values=[]
        for i in range(3):
            j=(i+1)%3
            if abs(d[i])<1e-10:values.append(tri[i])
            if d[i]*d[j]<0:values.append(tri[i]+(tri[j]-tri[i])*d[i]/(d[i]-d[j]))
        unique=[]
        for p in values:
            if not any(np.linalg.norm(p-q)<1e-9 for q in unique):unique.append(p)
        if len(unique)==2 and np.linalg.norm(unique[1]-unique[0])>1e-10:segments.append(unique)
    segments=np.asarray(segments).reshape((-1,2,3));components=component_ids(segments) if len(segments) else []
    return segments,components,coplanar


def inside_section(point,segments):
    a,b=segments[:,0,:2],segments[:,1,:2]
    cross=(a[:,1]>point[1])!=(b[:,1]>point[1])
    x=a[:,0]+np.divide((point[1]-a[:,1])*(b[:,0]-a[:,0]),b[:,1]-a[:,1],out=np.zeros(len(a)),where=np.abs(b[:,1]-a[:,1])>1e-15)
    return bool(np.count_nonzero(cross&(x>point[0]))%2)


def run(root,output):
    output.mkdir(parents=True,exist_ok=False);began=time.monotonic();deadline=began+45
    directory=root/'book-grip-reading-compare-01';proof=json.loads((directory/'proof.json').read_text());case=next(c for c in proof['cases'] if c['label']=='proposal')
    cache=np.load(directory/case['cache']['path']);topology=np.load(root/'sofa-binding-audit-01/source-binding.npz')
    source=json.loads((root/'book-grip-alt2-replay-01/proof.json').read_text());bones={b['name']:np.asarray(b['matrix']) for b in next(iter(source['raw_source_identity']['bones'].values()))}
    spine=np.asarray(case['rig_matrix_world'])@np.asarray(case['evaluated_frames']['spine'])@np.linalg.inv(bones['spine']);inverse=np.linalg.inv(spine)
    prefix='proposal/geometry/';shirt=cache[prefix+'Overshirt body/points'];shirt_t=cache[prefix+'Overshirt body/triangles'];local_shirt=shirt@inverse[:3,:3].T+inverse[:3,3]
    opening=boundary(shirt_t);opening_min=float(local_shirt[np.unique(opening),2].min())
    view_file=root/'book-grip-static-views-01/proof.json';views=json.loads(view_file.read_text())['renders']
    directions=[]
    for view in views:
        camera=np.asarray(view['camera_matrix']);rig=np.asarray(view['rig_matrix_world']);direction=np.linalg.inv(rig[:3,:3])@(-camera[:3,2]);direction/=np.linalg.norm(direction)
        directions.append((view['name'],direction))
    primitives=functions_from(root/'audit_sofa_binding.py');kernel=Kernel(primitives,deadline);shirt_mesh=Mesh(shirt,shirt_t)
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    paths=[Path(__file__),directory/'proof.json',directory/case['cache']['path'],root/'sofa-binding-audit-01/source-binding.npz',root/'book-grip-alt2-replay-01/proof.json',view_file,
        root/'classify_sofa_lap_contacts.py',root/'audit_sofa_binding.py',root/'sofa_coupled_contact_evaluator_v2.py',root/'book_grip_reading_geometry.py']
    report=dict(state='running',inputs={str(p.resolve()):digest(p) for p in paths},cases=[],
        scope='Cached source/material and shirt-only ray classification; no pose, mesh/binding change or render',
        shirt_opening=dict(boundary_edges=len(opening),minimum_source_aligned_height=opening_min),
        method='A triangle is wholly within the actual shirt envelope only if it is below every real opening, does not intersect the shirt surface, and lies inside an actual closed planar shirt section. No neck cap is invented.')
    arrays={};sections={}
    try:
        for name in ('Relaxed shirt sleeve','Relaxed shirt sleeve.001'):
            points=cache[prefix+name+'/points'];triangles=cache[prefix+name+'/triangles'];pairs=cache['proposal/fold/'+name]
            parents=source_map(name,triangles,topology);involved=np.unique(pairs)
            join=next(r for r in case['rows'] if r['kind']=='arm_body' and r.get('parts')==[name,'Overshirt body'])
            join_pairs=cache[join['witness']+'/pairs'];blocked=set(int(v) for v in join_pairs[:,0]);components,mapping=material_components(triangles,blocked)
            local=points@inverse[:3,:3].T+inverse[:3,3];rows=[]
            for index in involved:
                if time.monotonic()>deadline:raise TimeoutError('Cached fold classification budget exhausted')
                face=triangles[index];center=local[face].mean(0);z=float(center[2])
                if z not in sections:sections[z]=section(local_shirt[shirt_t],z)
                lines,loops,coplanar=sections[z];closed=bool(loops) and all(c['closed'] for c in loops) and coplanar==0
                inside=inside_section(center,lines) if closed else None
                comp=mapping.get(int(index));raw_faces=set(parents[components[comp]].tolist()) if comp is not None else set()
                distance=nearest_distance(points[face].mean(0),shirt,shirt_t)
                wholly=bool(inside and local[face,2].max()<opening_min-EPS and int(index) not in blocked and distance>EPS)
                rows.append(dict(triangle=int(index),source_polygon=int(parents[index]),component=comp,component_has_proximal_cap=97 in raw_faces,
                    component_has_distal_cap=96 in raw_faces,shirt_section_closed=closed,shirt_section_inside=inside,
                    shirt_surface_distance=distance,below_opening=bool(local[face,2].max()<opening_min-EPS),
                    intersects_shirt_boundary=int(index) in blocked,wholly_within_shirt_envelope=wholly))
                key=name+'/triangle'+str(index);arrays[key+'/shirt_section']=lines
            world_segments=[]
            for ai,bi in pairs:
                hit=primitives['intersection_segment'](points[triangles[ai]],points[triangles[bi]])
                if hit['kind']!='segment':raise ValueError('Retained sleeve self-pair no longer has a recoverable segment')
                world_segments.append(hit['endpoints'])
            arrays[name+'/self_segments']=np.asarray(world_segments);arrays[name+'/source_polygon_pairs']=parents[pairs]
            samples=np.unique(np.concatenate((points[np.unique(triangles[pairs])],np.asarray(world_segments).reshape((-1,3)))),axis=0)
            sight=[];far=float(np.linalg.norm(shirt_mesh.high-shirt_mesh.low)+1.)
            for view,direction in directions:
                blocked_samples=[];open_samples=[]
                for i,point in enumerate(samples):
                    hit=kernel.ray(shirt_mesh,point-direction*far,direction)
                    if hit is not None and hit['distance']<far-EPS:blocked_samples.append(i)
                    else:open_samples.append(i)
                arrays[name+'/visibility/'+view+'/unoccluded_by_shirt']=np.asarray(open_samples,dtype=np.int32)
                sight.append(dict(view=view,samples=len(samples),occluded_by_actual_shirt=len(blocked_samples),not_occluded_by_shirt=len(open_samples)))
            arrays[name+'/visibility_samples']=samples
            hidden_join=join['valid'] and all(r['wholly_within_shirt_envelope'] and r['component_has_proximal_cap'] and not r['component_has_distal_cap'] for r in rows)
            # Exterior patch control retains the same material labels but places
            # its geometry wholly beyond a measured shirt bound. It cannot earn
            # an attachment exception from the source polygon names alone.
            patch=local[np.unique(triangles[pairs])].copy();shift=np.zeros(3)
            if name.endswith('.001'):shift[0]=local_shirt[:,0].max()+EPS-patch[:,0].min()
            else:shift[0]=local_shirt[:,0].min()-EPS-patch[:,0].max()
            outside_patch=patch+shift
            exterior=bool(np.all(outside_patch[:,0]>local_shirt[:,0].max()) or np.all(outside_patch[:,0]<local_shirt[:,0].min()))
            arrays[name+'/exterior_patch_control']=outside_patch
            report['cases'].append(dict(part=name,self_pairs=len(pairs),source_pair_counts={str(k):v for k,v in collections.Counter(tuple(sorted(map(int,r))) for r in parents[pairs]).items()},
                source_cap_polygons=dict(distal=96,proximal=97),proved_shoulder_join=join['valid'],triangles=rows,visibility=sight,
                classification='Wholly buried proximal attachment sidewall fold' if hidden_join else 'Exterior or unresolved sleeve sidewall fold',
                hidden_attachment_region_proved=hidden_join,
                negative_exterior_patch_control=dict(passed=exterior,translation=shift.tolist(),meaning='Synthetic local witness patch only, not a new rig pose; same source labels do not excuse exterior geometry')))
        np.savez(output/'witnesses.npz',**arrays);report['cache_sha256']=digest(output/'witnesses.npz');report['state']='complete'
    except BaseException as error:report.update(state='failed',error=repr(error));raise
    finally:
        report['elapsed_seconds']=time.monotonic()-began;report['inputs_unchanged']=all(digest(Path(p))==sha for p,sha in report['inputs'].items())
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps([dict(part=c['part'],pairs=c['self_pairs'],source_pairs=c['source_pair_counts'],classification=c['classification'],
        triangle_count=len(c['triangles']),inside=sum(r['wholly_within_shirt_envelope'] for r in c['triangles']),proximal_only=sum(r['component_has_proximal_cap'] and not r['component_has_distal_cap'] for r in c['triangles']),
        sections_closed=all(r['shirt_section_closed'] for r in c['triangles']),visibility=c['visibility']) for c in report['cases']],indent=2))


if __name__=='__main__':run(*(Path(p) for p in sys.argv[1:]))
