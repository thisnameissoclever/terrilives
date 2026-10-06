"""Exact shirt-only projected occlusion and negative controls for retained sleeve loci."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np

sys.path.insert(0,str(Path(__file__).parent))
from book_grip_reading_view_area import area,subtract
from continuous_support_patch import clip
from book_grip_sleeve_fold_regions import section,inside_section
from book_grip_attachment_fold_contract import classify
from sofa_coupled_contact_evaluator_v2 import closures


def projected(points,triangles,basis):
    p=points@basis;t=p[triangles];uv=t[:,:,:2];signed=np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0])[:,2]
    ids=np.flatnonzero(np.abs(signed)>1e-14);uv=uv[ids].copy();z=t[ids,:,2].copy()
    reverse=signed[ids]<0;uv[reverse]=uv[reverse,::-1];z[reverse]=z[reverse,::-1]
    planes=np.linalg.solve(np.concatenate((uv,np.ones((len(ids),3,1))),axis=2),z[:,:,None])[:,:,0]
    return ids,uv,planes


def visible_triangles(points,triangles,shirt,shirt_t,direction,deadline):
    normal=-direction;right=np.asarray([1.,0.,0.]);right-=normal*(right@normal)
    if np.linalg.norm(right)<1e-8:right=np.asarray([0.,1.,0.]);right-=normal*(right@normal)
    right/=np.linalg.norm(right);basis=np.column_stack((right,np.cross(normal,right),normal))
    ids,uv,planes=projected(points,triangles,basis);si,sv,sp=projected(shirt,shirt_t,basis)
    low,high=sv.min(1),sv.max(1);polygons=[];owners=[];blocked_by=[]
    original=sum(area(p) for p in uv)
    for i,(poly,plane) in enumerate(zip(uv,planes)):
        if time.monotonic()>deadline:raise TimeoutError('Cached visibility-control budget exhausted')
        fragments=[poly];candidates=np.flatnonzero(np.all(high>=poly.min(0),axis=1)&np.all(low<=poly.max(0),axis=1))
        for index in candidates:
            difference=sp[index]-plane;difference[2]-=1e-8
            block=clip(list(sv[index]),difference)
            if area(block)<=1e-14:continue
            remaining=[]
            for fragment in fragments:remaining.extend(subtract(fragment,np.asarray(block)))
            if sum(area(p) for p in remaining)<sum(area(p) for p in fragments)-1e-14:blocked_by.append([int(ids[i]),int(si[index])])
            fragments=remaining
            if not fragments:break
        polygons.extend(fragments);owners.extend([int(ids[i])]*len(fragments))
    return dict(projected_triangle_area=original,visible_projected_area=sum(area(p) for p in polygons),
        vertices=np.concatenate(polygons) if polygons else np.empty((0,2)),offsets=np.cumsum([0]+[len(p) for p in polygons],dtype=np.int32),
        triangle_indices=np.asarray(owners,dtype=np.int32),occluding_pairs=np.asarray(blocked_by,dtype=np.int32).reshape((-1,2)))


def run(root,output):
    output.mkdir(parents=True,exist_ok=False);began=time.monotonic();deadline=began+45
    directory=root/'book-grip-reading-compare-01';scene=json.loads((directory/'proof.json').read_text());case=next(c for c in scene['cases'] if c['label']=='proposal')
    cache=np.load(directory/case['cache']['path']);regions=json.loads((root/'book-grip-sleeve-fold-regions-01/proof.json').read_text())
    raw=json.loads((root/'book-grip-alt2-replay-01/proof.json').read_text())['raw_source_identity'];topology=np.load(root/'sofa-binding-audit-01/source-binding.npz')
    views=json.loads((root/'book-grip-static-views-01/proof.json').read_text())['renders'];shirt=cache['proposal/geometry/Overshirt body/points'];shirt_t=cache['proposal/geometry/Overshirt body/triangles']
    bones={b['name']:np.asarray(b['matrix']) for b in next(iter(raw['bones'].values()))};spine=np.asarray(case['rig_matrix_world'])@np.asarray(case['evaluated_frames']['spine'])@np.linalg.inv(bones['spine']);inverse=np.linalg.inv(spine)
    shirt_local=shirt@inverse[:3,:3].T+inverse[:3,3]
    arrays={};results=[];controls=[]
    for entry in regions['cases']:
        name=entry['part'];p=cache['proposal/geometry/'+name+'/points'];t=cache['proposal/geometry/'+name+'/triangles'];ids=np.asarray([r['triangle'] for r in entry['triangles']],dtype=np.int32)
        caps=closures(name,topology)
        if [cap[0] for cap in caps]!=[96,97]:raise ValueError('Original garment cap identity changed')
        visible=[]
        for view in views:
            camera=np.asarray(view['camera_matrix']);rig=np.asarray(view['rig_matrix_world']);direction=np.linalg.inv(rig[:3,:3])@(-camera[:3,2]);direction/=np.linalg.norm(direction)
            measured=visible_triangles(p,t[ids],shirt,shirt_t,direction,deadline)
            row=dict(view=view['name'])
            for key,value in measured.items():
                if isinstance(value,np.ndarray):arrays[name+'/'+view['name']+'/'+key]=value
                else:row[key]=value
            visible.append(row)
        material=raw['meshes'][name]['materials'];shirt_material=raw['meshes']['Overshirt body']['materials']
        decision=classify(name,material,shirt_material,entry['proved_shoulder_join'],entry['triangles'],visible)
        results.append(dict(part=name,source_caps=caps,visibility=visible,**decision))
        controls.append(dict(name=name+' buried actual patch',passed=decision['valid']))
        moved=[];shift=np.asarray(entry['negative_exterior_patch_control']['translation']);local=p@inverse[:3,:3].T+inverse[:3,3]
        for original in entry['triangles']:
            r=dict(original);center=local[t[r['triangle']]].mean(0)+shift;lines,components,coplanar=section(shirt_local[shirt_t],float(center[2]))
            inside=inside_section(center,lines) if components and all(c['closed'] for c in components) and not coplanar else None
            r['wholly_within_shirt_envelope']=bool(inside);moved.append(r)
        exterior=classify(name,material,shirt_material,True,moved,visible)
        controls.append(dict(name=name+' same source labels outside shirt',passed=not exterior['valid'],decision=exterior))
        no_join=classify(name,material,shirt_material,False,entry['triangles'],visible)
        controls.append(dict(name=name+' missing demonstrated join',passed=not no_join['valid']))
    wrist_path=root/'sofa-contact-solver-wrist-controls-01/proof.json';wrist=json.loads(wrist_path.read_text())
    for control in [c for c in wrist['controls'] if c.get('expected') is False]:
        skin=control['contact']['parts'][0]
        # Even a hidden location cannot turn the actual 498-pair skin fold into
        # the garment-only attachment exception.
        decision=classify(skin,raw['meshes'][skin]['materials'],raw['meshes']['Overshirt body']['materials'],True,regions['cases'][0]['triangles'],results[0]['visibility'])
        controls.append(dict(name=control['name'],actual_skin_fold_pairs=control['fold']['pairs'],distal_winding=control['contact']['wrist']['distal_winding'],
                             passed=not decision['valid'] and control['fold']['pairs']==498 and not control['actual'],decision=decision))
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    paths=[Path(__file__),root/'book_grip_attachment_fold_contract.py',root/'book_grip_sleeve_fold_regions.py',root/'book_grip_reading_view_area.py',directory/'proof.json',directory/case['cache']['path'],root/'book-grip-sleeve-fold-regions-01/proof.json',
        root/'book-grip-alt2-replay-01/proof.json',root/'sofa-binding-audit-01/source-binding.npz',root/'book-grip-static-views-01/proof.json',wrist_path,root/'sofa-contact-solver-wrist-controls-01/witnesses.npz']
    np.savez(output/'visibility.npz',**arrays)
    report=dict(state='complete',inputs={str(p.resolve()):digest(p) for p in paths},cases=results,controls=controls,passed=all(c['passed'] for c in controls),
        elapsed_seconds=time.monotonic()-began,cache_sha256=digest(output/'visibility.npz'),
        semantics='Exact orthographic subtraction of the actual shirt triangles from every involved folded triangle, using the six recorded diagnostic directions. Areas sum per triangle; zero proves no visible patch in these views. The enclosure/material proof is separate and no closed shirt volume is manufactured.',
        scope='Cached classification and negative controls only. Shared evaluator and prior rejection receipts are unchanged; no new pose, binding or render.')
    if not all(digest(Path(p))==sha for p,sha in report['inputs'].items()):raise ValueError('A cached control input changed')
    (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(passed=report['passed'],cases=[dict(part=c['part'],valid=c['valid'],visible=[v['visible_projected_area'] for v in c['visibility']]) for c in results],controls=[dict(name=c['name'],passed=c['passed']) for c in controls],seconds=report['elapsed_seconds']),indent=2))
    if not report['passed']:raise ValueError('A fold-classification control failed')


if __name__=='__main__':run(*(Path(p) for p in sys.argv[1:]))
