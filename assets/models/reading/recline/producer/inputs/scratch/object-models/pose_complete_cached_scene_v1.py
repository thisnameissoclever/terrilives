"""Complete exact cached geometry diagnostics without reopening Blender."""
import hashlib
import itertools
import json
import os
from pathlib import Path
import sys
import time
import numpy as np

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
sys.path.insert(0,str(HERE.parents[1]/'assets/models/living'))
from armchair_support import contact_footprint
from book_grip_reading_geometry import Mesh,Kernel,EPS
from sofa_coupled_contact_evaluator import solid_angle,nearest_distance
from classify_sofa_lap_contacts import functions_from
from seated_pose_chain_geometry_v1 import finite_grasp


class CompleteKernel(Kernel):
    def contact(self,a,b,arrays,prefix):
        pairs,unresolved=self.pairs(a,b)
        if len(pairs) or unresolved:
            arrays[prefix+'/pairs']=pairs
            return dict(kind='surface',pairs=pairs,witness=prefix,unresolved=unresolved)
        contained=[]
        for label,source,target in (('first_inside_second',a,b),('second_inside_first',b,a)):
            if not target.closed:
                continue
            for index in source.components:
                self.budget()
                point=source.points[index]
                if np.any(point<target.low) or np.any(point>target.high):
                    continue
                winding=solid_angle(point,target.points,target.triangles)
                if abs(winding)>.5:
                    distance=nearest_distance(point,target.points,target.triangles)
                    if distance>EPS:
                        contained.append(dict(direction=label,vertex=int(index),point=point.tolist(),winding=winding,distance=distance))
        if contained:
            return dict(kind='contained_components',components=contained)
        return None


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(manifest_path,output):
    if output.exists() or not output.is_absolute():
        raise ValueError('A new absolute output directory is required')
    manifest=json.loads(manifest_path.read_text())
    inputs=dict(manifest['inputs'])
    inputs[str(manifest_path)]=digest(manifest_path)
    if any(digest(p)!=sha for p,sha in inputs.items()):
        raise ValueError('Cached-scene input changed')
    output.mkdir(exist_ok=False)
    began=time.monotonic()
    report=dict(state='running',pid=os.getpid(),inputs=inputs,folds=[],contacts=[],support=[],acceptance=False,
        coverage=dict(self_surfaces=0,own_pairs=0,furniture_pairs=0,neighbor_pairs=0,aabb_separated=0),
        scope='Exact cached geometry from memory-interrupted analytic pose producer; no pose changes or images')
    arrays={}
    def save():
        report['elapsed_seconds']=time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n')
    save()
    try:
        kernel=CompleteKernel(functions_from(HERE/'audit_sofa_binding.py'),time.monotonic()+240)
        groups={str(i):{} for i in range(3)}
        groups['furniture']={}
        with np.load(HERE/'seated-pose-chain-01/raw/authored-geometry.npz') as cache:
            for key in cache.files:
                if not key.endswith('/points'):
                    continue
                owner,name=key[:-len('/points')].split('/',1)
                points=cache[key]
                if not np.isfinite(points).all():
                    raise ValueError('Nonfinite saved geometry')
                groups[owner][name]=Mesh(points,cache[key[:-len('/points')]+'/triangles'])
        report['inventories']={owner:sorted(meshes) for owner,meshes in groups.items()}
        fold_flags={}
        for owner,meshes in groups.items():
            for name,mesh in meshes.items():
                kernel.budget()
                pairs,unresolved=kernel.pairs(mesh,mesh,self_test=True)
                prefix='fold/'+owner+'/'+name
                arrays[prefix]=pairs
                fold_flags[(owner,name)]=bool(len(pairs) or unresolved)
                report['folds'].append(dict(owner=owner,part=name,pairs=len(pairs),unresolved=unresolved,witness=prefix))
                report['coverage']['self_surfaces']+=1
            save()
        def contact(kind,owner_a,name_a,owner_b,name_b):
            kernel.budget()
            report['coverage'][kind+'_pairs']+=1
            a,b=groups[owner_a][name_a],groups[owner_b][name_b]
            if np.any(a.high<b.low) or np.any(b.high<a.low):
                report['coverage']['aabb_separated']+=1
                return
            prefix=kind+'/'+owner_a+'/'+name_a+'|'+owner_b+'/'+name_b
            value=kernel.contact(a,b,arrays,prefix)
            topology_gaps=[dict(owner=o,part=n,closed=m.closed,self_intersections=fold_flags[(o,n)])
                for o,n,m in ((owner_a,name_a,a),(owner_b,name_b,b))
                if not m.closed or fold_flags[(o,n)]]
            if value:
                result={k:(int(len(v)) if k=='pairs' else v) for k,v in value.items()}
                report['contacts'].append(dict(pair_kind=kind,owners=[owner_a,owner_b],parts=[name_a,name_b],
                    evidence=result,containment_prerequisite_gaps=topology_gaps,
                    classification='Raw source joins and unintended contact retained without exemptions'))
            elif topology_gaps:
                report['contacts'].append(dict(pair_kind=kind,owners=[owner_a,owner_b],parts=[name_a,name_b],
                    evidence=dict(kind='unresolved_containment_prerequisites'),containment_prerequisite_gaps=topology_gaps))
        for owner in ('0','1','2'):
            for a,b in itertools.combinations(groups[owner],2):
                contact('own',owner,a,owner,b)
            for a in groups[owner]:
                for b in groups['furniture']:
                    contact('furniture',owner,a,'furniture',b)
            save()
        for left,right in itertools.combinations(('0','1','2'),2):
            for a in groups[left]:
                for b in groups[right]:
                    contact('neighbor',left,a,right,b)
            save()
        expected=dict(self_surfaces=sum(len(v) for v in groups.values()),
            own_pairs=sum(len(groups[o])*(len(groups[o])-1)//2 for o in ('0','1','2')),
            furniture_pairs=sum(len(groups[o])*len(groups['furniture']) for o in ('0','1','2')),
            neighbor_pairs=sum(len(groups[a])*len(groups[b]) for a,b in itertools.combinations(('0','1','2'),2)))
        if any(report['coverage'][k]!=v for k,v in expected.items()):
            raise ValueError('Incomplete scene pair coverage')
        report['expected_coverage']=expected
        for owner in ('0','1','2'):
            hip=groups[owner]['Trouser hip bridge']
            cushion=groups['furniture']['Seat cushion '+owner]
            gaps=[];near=[];rays=[]
            for point in hip.points:
                kernel.budget()
                hit=kernel.ray(cushion,np.asarray([point[0],point[1],2.]),np.asarray([0.,0.,-1.]))
                if hit:
                    gap=float(point[2]-hit['point'][2]);gaps.append(gap)
                    rays.append([*point,*hit['point'],gap,hit['triangle']])
                    if 0<=gap<=.01:
                        near.append(point.tolist())
            row=dict(owner=owner,min_gap=min(gaps) if gaps else None,ray_hits=len(gaps),contact_count=len(near))
            try:
                if not gaps or not 0<=min(gaps)<=.003:
                    raise ValueError('Hip lost non-penetrating support')
                row.update(valid=True,**contact_footprint(near))
            except ValueError as error:
                row.update(valid=False,error=str(error))
            row['sole_heights']={name:float(mesh.points[:,2].min()) for name,mesh in groups[owner].items() if name.startswith('Fitted rounded shoe sole')}
            arrays['support/'+owner]=np.asarray(rays)
            report['support'].append(row)
        prior=json.loads((HERE/'seated-pose-chain-01/raw/proof.json').read_text())
        state=prior['full_states'][1]
        source=json.loads((HERE/'book-grip-alt2-replay-01/proof.json').read_text())
        rest=np.asarray(next(b['matrix'] for b in next(iter(source['raw_source_identity']['bones'].values())) if b['name']=='book'))
        rotation=(np.asarray(state['rig_matrix_world'])@np.asarray(state['bone_matrices']['book'])@np.linalg.inv(rest))[:3,:3]
        report['finite_grasp_contact']=finite_grasp(groups['1'],rotation,arrays)
        negative=json.loads((HERE/'book-grip-sleeve-fold-controls-01/proof.json').read_text())
        controls=[v for v in negative['controls'] if v.get('actual_skin_fold_pairs')==498]
        if len(controls)!=2 or any(v['decision']['valid'] or not v['passed'] for v in controls):
            raise ValueError('Retained reversed-wrist negative lost rejection')
        report['retained_negative_control']=dict(controls=controls,scope='Same retained 498 pairs, not a newly posed negative')
        report.update(state='complete',kernel_candidate_pairs=kernel.candidate_pairs,
            limitations=['Furniture-to-furniture contacts retain the unchanged furniture source contract',
                'Raw anatomical joins are not classified as accepted contacts',
                'Open or self-intersecting containment targets remain unresolved',
                'No whole-scene or grip acceptance follows'])
    except BaseException as error:
        report.update(state='failed',error=repr(error))
        raise
    finally:
        np.savez(output/'witnesses.npz',**arrays)
        report['inputs_unchanged']=all(digest(p)==sha for p,sha in inputs.items())
        if not report['inputs_unchanged']:
            report.update(state='failed',error='Cached-scene input changed')
        save()


if __name__=='__main__':
    run(*(Path(v).resolve() for v in sys.argv[1:]))
