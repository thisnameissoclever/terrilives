"""One conjunctive reading-body gate for construction, controls and final replay."""
import hashlib
import itertools
import json
from pathlib import Path
import time
import numpy as np

from classify_sofa_lap_contacts import functions_from
from sofa_contact_solver_wrists import WristEvaluator
from sofa_contact_solver_evaluator import exposed
from sofa_contact_solver_memo import ExactGeometryMemo,geometry_key
from sofa_contact_solver_frames import coupled_frames
from sofa_arm_frame_math import proper_rotation
from book_grip_reading_geometry import Kernel,Mesh,EPS
from book_grip_reading_attachments import CollarNeckClassifier,NECK_PAIRS
from book_grip_replay_math import triangle_box_hits

ARM=('Relaxed shirt sleeve','Turned sleeve cuff','Forearm with elbow and wrist sections','Relaxed palm','Resting thumb')
PROP=('Reading book cover','Reading book pages','Printed book line')
REQUIRED=('identity','frames','all_body_pairs','containment','actual_folds','fourteen_props','bilateral_contact','visible_page_rays','waist','scope')


def gate(rows,coverage):
    failures=[r for r in rows if not r['valid']]
    failures += [dict(kind='missing_complete_coverage',name=k,valid=False) for k in REQUIRED if coverage.get(k) is not True]
    return dict(feasible=not failures,failures=failures,coverage=coverage,
                semantics='Every hard row must pass; preferences, fewer failures and lower total penetration cannot accept a pose')


def about(pivot,rotation):
    matrix=np.eye(4);matrix[:3,:3]=rotation;matrix[:3,3]=pivot-rotation@pivot;return matrix


def rigid(matrix):
    m=np.asarray(matrix,dtype=np.float64)
    return m.shape==(4,4) and np.max(np.abs(m[3]-[0,0,0,1]))<=1e-8 and np.max(np.abs(m[:3,:3].T@m[:3,:3]-np.eye(3)))<=1e-5 and abs(np.linalg.det(m[:3,:3])-1)<=1e-5


class ReadingPoseInput:
    def __init__(self,root,waist_classifier=None):
        self.root=Path(root);directory=self.root/'book-grip-alt2-replay-01'
        self.receipt=json.loads((directory/'proof.json').read_text())
        self.rest=np.load(directory/'rest.npz');self.source_cache=np.load(directory/'source-control.npz')
        self.source_frames={n:np.asarray(v) for n,v in self.receipt['source_state']['bone_matrices'].items()}
        self.source_world=np.asarray(self.receipt['source_state']['rig_matrix_world'])
        self.raw=self.receipt['raw_source_identity'];self.groups={n:r['groups'] for n,r in self.raw['meshes'].items()}
        self.rest_frames={b['name']:np.asarray(b['matrix']) for b in next(iter(self.raw['bones'].values()))}
        canonical=json.loads((self.root/'book-grip-original-replay-01/proof.json').read_text())
        self.canonical={n:np.asarray(v) for n,v in canonical['candidate_state']['bone_matrices'].items()}
        self.source={key[:-len('/points')]:dict(points=self.source_cache[key],triangles=self.source_cache[key[:-len('/points')]+'/triangles']) for key in self.source_cache.files if key.endswith('/points')}
        self.arms=WristEvaluator(self.root);self.primitives=functions_from(self.root/'audit_sofa_binding.py')
        self.neck=CollarNeckClassifier(self.arms.topology,self.rest,self.primitives,self.rest_frames['spine'])
        self.memo=ExactGeometryMemo();self.waist_classifier=waist_classifier
        self.identity=hashlib.sha256(json.dumps(dict(raw=self.raw,opened=self.receipt['opened_original'],classifier='reading-complete-v1'),sort_keys=True).encode()).hexdigest()
        self.scope=dict(kind='static single actor',furniture=False,neighbors=False,seat_acceptance=False,lower_body='Preserve source pelvis and feet',binding=self.receipt['opened_original'])

    def construct(self,parameters):
        """Construct all frames together; this function never declares feasibility."""
        grasp=np.asarray(parameters['grasp_transform']);head=np.asarray(parameters['head_relative_rotation']);spine=np.asarray(parameters.get('spine_rotation',np.eye(3)))
        for name,r in (('head',head),('spine',spine)):
            m=np.eye(4);m[:3,:3]=r
            if not rigid(m):raise ValueError(name+' rotation is not proper and source-scale preserving')
        if not rigid(grasp):raise ValueError('The grasp transform must be one proper rigid transform')
        result={n:m.copy() for n,m in self.source_frames.items()}
        upper=about(result['spine'][:3,3],spine);result['spine']=upper@result['spine']
        inherited=upper@result['head'];spine_deform=result['spine']@np.linalg.inv(self.rest_frames['spine'])
        axes=proper_rotation(spine_deform[:3,:3]);rotation=axes@head@axes.T
        result['head']=about(inherited[:3,3],rotation)@inherited
        result['book']=grasp@self.canonical['book']
        for side in ('L','R'):
            values=parameters['arms'][side]
            data=dict(matrices=dict(spine_pose=result['spine'],spine_rest=self.rest_frames['spine'],upper_rest=self.rest_frames['upper_arm.'+side],
                forearm_rest=self.rest_frames['forearm.'+side],hand_rest=self.rest_frames['hand.'+side]))
            solved=coupled_frames(data,grasp@self.canonical['hand.'+side],values['swivel'],values['upper_arm_roll'])
            for part,matrix in solved['targets'].items():result[part+'.'+side]=matrix
        return result


class CompleteReadingEvaluator:
    def __init__(self,context):self.context=context

    def evaluateReadingPose(self,parameters,backend,arrays,prefix,deadline=None):
        frames=self.context.construct(parameters)
        snapshot=backend.evaluate_frames(frames,deadline)
        result=self.evaluate_snapshot(snapshot,arrays,prefix,deadline)
        result['constructed_frames']={n:m.tolist() for n,m in frames.items()};return result

    def select(self,parameters,backend,arrays,prefix,deadline=None):
        """The construction caller has no separate surrogate acceptance gate."""
        result=self.evaluateReadingPose(parameters,backend,arrays,prefix,deadline)
        return dict(accepted=result['feasible'],evaluation=result,parameters=parameters if result['feasible'] else None)

    def evaluate_snapshot(self,snapshot,arrays,prefix,deadline=None):
        ctx=self.context;kernel=Kernel(ctx.primitives,deadline);surfaces=snapshot['surfaces'];frames=snapshot['frames'];world=np.asarray(snapshot['rig_matrix_world'])
        rows=[];coverage={k:False for k in REQUIRED};keys={n:geometry_key(s) for n,s in surfaces.items()}
        dependencies=(ctx.identity,tuple(sorted((n,tuple(ctx.groups[n])) for n in surfaces)))
        def add(r):rows.append(r)
        def contact(a,b,key):
            def calculate(local,path):
                hit=kernel.contact(surfaces[a],surfaces[b],local,path)
                if hit and hit['kind']=='surface':hit['pairs']=hit['pairs'].tolist()
                return hit
            return ctx.memo.query(('body',a,b),(*dependencies,keys[a],keys[b]),calculate,arrays,key)
        props=[n for n in surfaces if n.startswith(PROP)];body=[n for n in surfaces if n not in props]
        add(dict(kind='prop_inventory',valid=len(props)==14 and sum(n.startswith('Printed book line') for n in props)==10,parts=props))
        rigid_owner={};fixed=set();proof=[]
        for name,surface in surfaces.items():
            kernel.budget();source=ctx.source[name]
            same=np.array_equal(surface.points,source['points']) and np.array_equal(surface.triangles,source['triangles'])
            if same:fixed.add(name)
            groups=ctx.groups[name]
            if len(groups)==1 and groups[0] in frames:
                bone=groups[0];motion=world@np.asarray(frames[bone])@np.linalg.inv(ctx.source_frames[bone])@np.linalg.inv(ctx.source_world)
                expected=source['points']@motion[:3,:3].T+motion[:3,3]
                error=float(np.linalg.norm(surface.points-expected,axis=1).max())
                if rigid(motion) and error<=1e-5:rigid_owner[name]=bone
                proof.append(dict(part=name,bone=bone,error=error,valid=error<=1e-5))
            arrays[prefix+'/geometry/'+name+'/points']=surface.points;arrays[prefix+'/geometry/'+name+'/triangles']=surface.triangles
        add(dict(kind='rigid_face_and_pupil_contract',valid=all(r['valid'] for r in proof if r['bone']=='head'),parts=[r for r in proof if r['bone']=='head']))
        # Immutable rigid subassemblies preserve their internal shape; blended
        # surfaces always receive actual triangle fold checks.
        lower=[n for n in body if any(g=='hips' or g.startswith(('thigh.','shin.','foot.')) for g in ctx.groups[n])]
        add(dict(kind='preserved_pelvis_and_feet',valid=all(n in fixed for n in lower),parts=lower,changed=[n for n in lower if n not in fixed]))
        for name in body:
            if name in rigid_owner or (name in fixed and not name.startswith(ARM) and name!='Natural neck'):continue
            kernel.budget()
            pairs,unresolved=ctx.memo.query(('fold',name),(*dependencies,keys[name]),lambda local,key:kernel.pairs(surfaces[name],surfaces[name],True),arrays,prefix+'/fold/'+name)
            arrays[prefix+'/fold/'+name]=pairs
            add(dict(kind='actual_folds',part=name,valid=not len(pairs) and not unresolved,pairs=len(pairs),unresolved=unresolved,witness=prefix+'/fold/'+name))
        coverage['actual_folds']=True
        for first,second in itertools.combinations(body,2):
            kernel.budget();special=frozenset((first,second)) in NECK_PAIRS
            arm=first.startswith(ARM) or second.startswith(ARM)
            if not special and not arm and ((first in fixed and second in fixed) or (rigid_owner.get(first)==rigid_owner.get(second) and first in rigid_owner)):
                continue
            hit=contact(first,second,prefix+'/body/'+first+'/'+second)
            if not hit:continue
            if hit['kind']!='surface':
                add(dict(kind='body_containment',parts=[first,second],valid=False,evidence=hit));continue
            pairs=np.asarray(hit['pairs'],dtype=np.int32).reshape((-1,2));a,b=surfaces[first].data(),surfaces[second].data()
            if hit['unresolved']:
                add(dict(kind='unresolved_body_intersection',parts=[first,second],valid=False,unresolved=hit['unresolved'],witness=hit['witness']));continue
            if special:
                if 'Sculpted head' in (first,second) and not surfaces['Sculpted head'].closed:
                    result=dict(kind='unresolved_head_volume',parts=[first,second],valid=False,reason='Head attachment containment requires a closed oriented evaluated head')
                else:result=ctx.neck.contact(first,second,a,b,pairs,snapshot,arrays,prefix+'/neck/'+first+'/'+second)
            elif arm:
                order=lambda name:next((i for i,p in enumerate(('Forearm with elbow','Relaxed shirt sleeve','Turned sleeve cuff','Relaxed palm','Resting thumb')) if name.startswith(p)),9)
                if order(second)<order(first):first,second=second,first;a,b=b,a;pairs=pairs[:,::-1]
                result=ctx.arms.contact(0,first,second,a,b,pairs,arrays,prefix+'/material/'+first+'/'+second)
            else:
                arrays[prefix+'/exterior/'+first+'/'+second]=pairs
                result=dict(kind='exterior_or_unclassified_body_contact',parts=[first,second],valid=False,pairs=len(pairs),witness=prefix+'/exterior/'+first+'/'+second)
            add(result)
        coverage['all_body_pairs']=True;coverage['containment']=True
        for prop in props:
            solid=surfaces[prop];center=solid.points.mean(0);_,axes=np.linalg.eigh(np.cov(solid.points.T));half=np.max(np.abs((solid.points-center)@axes),axis=0)
            is_box=len(solid.points)==8 and len(solid.triangles)==12 and solid.closed and np.max(np.abs(np.abs((solid.points-center)@axes)-half))<=EPS
            add(dict(kind='prop_solid',part=prop,valid=bool(is_box)))
            if not is_box:continue
            for name in body:
                kernel.budget();mesh=surfaces[name]
                hits=triangle_box_hits(mesh.tri,center,axes,half)
                if len(hits):
                    key=prefix+'/prop/'+prop+'/'+name;arrays[key]=hits
                    add(dict(kind='prop_body',parts=[prop,name],valid=False,triangles=len(hits),witness=key))
                elif np.all(solid.low>=mesh.low-EPS) and np.all(solid.high<=mesh.high+EPS):
                    hit=contact(prop,name,prefix+'/prop-containment/'+prop+'/'+name)
                    if hit:add(dict(kind='prop_containment',parts=[prop,name],valid=False,evidence=hit))
        coverage['fourteen_props']=True
        for side,suffix in (('L',''),('R','.001')):
            kernel.budget();name='Reading book cover'+suffix;palm='Relaxed palm'+suffix;book=surfaces[name]
            n=np.cross(book.tri[:,1]-book.tri[:,0],book.tri[:,2]-book.tri[:,0]);n/=np.linalg.norm(n,axis=1)[:,None]
            up=-(n[np.argmin(n@(world@np.asarray(frames['book']))[:3,1])])
            obstacles={part:mesh.data() for part,mesh in surfaces.items() if part not in (name,palm)}
            result=exposed(book.data(),surfaces[palm].data(),up,.0015,obstacles,arrays,prefix+'/support/'+side)
            add(dict(side=side,**result))
        coverage['bilateral_contact']=True
        normals=[]
        expected_forward=(world@np.asarray(frames['head'])@np.linalg.inv(ctx.rest_frames['head']))[:3,:3]@np.asarray([0.,-1.,0.])
        for suffix in ('','.001'):
            _,axes=np.linalg.eigh(np.cov(surfaces['Dark pupil'+suffix].points.T));n=axes[:,0];normals.append(n if n@expected_forward>=0 else -n)
        gaze=np.mean(normals,0);gaze/=np.linalg.norm(gaze);page_normal=(world@np.asarray(frames['book']))[:3,1];page_normal/=np.linalg.norm(page_normal)
        for side,suffix in (('L',''),('R','.001')):
            pupil=surfaces['Dark pupil'+suffix];origin=pupil.points.mean(0)
            origin+=gaze*(float(np.max(pupil.points@gaze)-origin@gaze)+EPS)
            hits=[]
            for part,mesh in surfaces.items():
                kernel.budget();hit=kernel.ray(mesh,origin,gaze)
                if hit:hits.append(dict(part=part,**hit))
            hits.sort(key=lambda r:r['distance']);first=hits[0] if hits else None
            valid=first is not None and first['part'].startswith(('Reading book pages','Printed book line')) and page_normal@(-gaze)>0
            add(dict(kind='visible_page_ray',side=side,valid=bool(valid),origin=origin.tolist(),direction=gaze.tolist(),first_hit=first,
                     intersections=hits,printed_front_cosine=float(page_normal@(-gaze)),
                     semantics='Rigid pupil front-envelope proxy, shared binocular direction, first hit across every visible scene surface; no left-page-center requirement or blocker exclusion'))
        coverage['visible_page_rays']=True
        for row in snapshot['identity_rows']:add(row)
        coverage['identity']=True
        add(snapshot['joint_row']);coverage['frames']=True
        torso_changed=np.max(np.abs(np.asarray(frames['spine'])-ctx.source_frames['spine']))>1e-5
        if torso_changed:
            if ctx.waist_classifier is None:
                add(dict(kind='fresh_waist_proof',valid=False,reason='Torso changed; selected binding needs a pose-specific waist/pelvis/accessory proof. No old lean receipt is reused as acceptance.'))
            else:
                for r in ctx.waist_classifier(snapshot,ctx,arrays,prefix+'/waist'):add(r)
        else:add(dict(kind='preserved_waist_pose',valid=True,reason='Source spine/pelvis frames retained; complete actual contact discovery still ran'))
        coverage['waist']=True
        add(dict(kind='declared_scope',valid=True,scope=ctx.scope));coverage['scope']=True
        return dict(rows=rows,rigid_surface_proof=proof,kernel_candidates=kernel.candidate_pairs,**gate(rows,coverage))
