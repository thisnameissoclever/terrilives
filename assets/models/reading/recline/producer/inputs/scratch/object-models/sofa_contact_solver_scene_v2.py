"""Blender adapter for the unified complete supported-arm evaluator."""
import itertools
import time
import hashlib
import json
from pathlib import Path
import numpy as np
import bpy
from mathutils import Matrix
import probe_sofa_resting_clearance as retained
from sofa_contact_solver_evaluator import gate, REQUIRED, ARM_PARTS, exposed
from sofa_contact_solver_wrists import WristEvaluator
from sofa_contact_solver_memo import ExactGeometryMemo, geometry_key


def surface_data(surface):
    return dict(points=np.asarray(surface.points),triangles=np.asarray(surface.triangles,dtype=np.int32))


class SceneEvaluatorV2:
    def __init__(self, root, rigs, bodies, furniture, hand_receipt, baseline):
        self.classifier=WristEvaluator(root)
        self.memo=ExactGeometryMemo()
        root=Path(root)
        source_context=dict(json.loads((root/'sofa-resting-clearance-01/proof.json').read_text())['inputs'])
        for name in ('sofa_contact_solver_wrists.py','sofa_contact_solver_evaluator.py',
                     'sofa_contact_solver_memo.py','sofa_contact_solver_scene_v2.py',
                     'sofa_coupled_contact_evaluator.py','sofa_coupled_contact_evaluator_v2.py',
                     'sofa-binding-audit-01/source-binding.npz','sofa-binding-audit-01/proof.json',
                     'sofa-derived-binding-03/normalized-rest.npz',
                     'sofa-coupled-contact-neutral-shoulders-01/proof.json'):
            path=root/name
            source_context[str(path.resolve())]=hashlib.sha256(path.read_bytes()).hexdigest()
        self.source_context=hashlib.sha256(json.dumps(source_context,sort_keys=True).encode()).hexdigest()
        self.rigs,self.bodies,self.furniture=rigs,bodies,furniture
        self.hands=hand_receipt
        self.baseline=baseline
        self.solids={obj.name:retained.witness.Surface(obj,bpy.context.evaluated_depsgraph_get())
                     for obj in furniture.all_objects if obj.type=='MESH'}

    def evaluate(self, arrays, prefix, frame_error, deadline=None):
        def budget():
            if deadline is not None and time.monotonic()>=deadline:
                raise TimeoutError('Declared geometry window exhausted')
        budget()
        owners=retained.torso.surfaces(self.bodies)
        ownership=[dict(body=body.name,rig=rig.name,objects=sorted(
            (obj.name,obj.get('probe_source_name',obj.name),bool(obj.hide_render),
             tuple((mod.name,mod.type,mod.object.name if mod.type=='ARMATURE' and mod.object else '') for mod in obj.modifiers))
            for obj in body.all_objects if obj.type=='MESH')) for body,rig in zip(self.bodies,self.rigs)]
        ownership.append(dict(furniture=self.furniture.name,parts=sorted(self.solids)))
        context=(self.source_context,hashlib.sha256(json.dumps(ownership,sort_keys=True).encode()).hexdigest())
        keys={id(surface):geometry_key(surface) for owner in owners for surface in owner.values()}
        keys.update({id(surface):geometry_key(surface) for surface in self.solids.values()})
        start_hits,start_misses=self.memo.hits,self.memo.misses
        def collision(semantic,path,a,b):
            return self.memo.query(('collision',semantic),(*context,keys[id(a)],keys[id(b)]),
                lambda local,key:retained.verified_hit(local,key,a,b),arrays,path)
        rows=[]
        coverage={name:False for name in REQUIRED}
        for seat,(owner,rig) in enumerate(zip(owners,self.rigs)):
            for name,surface in owner.items():
                budget()
                retained.shared.cache_surface(arrays,f'{prefix}/{seat}/{name}',surface)
                fixed=not name.startswith(ARM_PARTS)
                if fixed:
                    old=self.baseline[seat][name]
                    residual=float(np.max(np.abs(np.asarray(surface.points)-old['points'])))
                    rows.append(dict(kind='fixed_body',seat=seat,part=name,valid=residual<=1e-7,residual=residual,
                                     reason='Exact invariant body geometry preserves verified hips, feet and waist controls'))
                for part,solid in self.solids.items():
                    hit=collision(('furniture',seat,name,part),f'{prefix}/furniture/{seat}/{name}/{part}',surface,solid)
                    if hit: rows.append(dict(kind='furniture',seat=seat,parts=[name,part],valid=False,residual=hit.get('triangle_pairs',1),evidence=hit))
                if not name.startswith(ARM_PARTS):continue
                pairs=self.memo.query(('fold',seat,name),(*context,keys[id(surface)]),
                    lambda local,key:[(a,b) for a,b in surface.tree.overlap(surface.tree)
                        if a<b and not set(surface.triangles[a])&set(surface.triangles[b])],
                    arrays,f'{prefix}/fold/{seat}/{name}')
                arrays[f'{prefix}/fold/{seat}/{name}']=np.asarray(pairs,dtype=np.int32).reshape((-1,2))
                rows.append(dict(kind='folds',seat=seat,part=name,valid=not pairs,residual=len(pairs)))
            names=list(owner)
            for first,second in itertools.combinations(names,2):
                budget()
                if not first.startswith(ARM_PARTS) and not second.startswith(ARM_PARTS):continue
                # Preserve the source-material classifier's anatomical order.
                def order(name):
                    return next((i for i,p in enumerate(('Forearm with elbow and wrist sections','Relaxed shirt sleeve','Turned sleeve cuff','Relaxed palm','Resting thumb')) if name.startswith(p)),9)
                if order(second)<order(first):first,second=second,first
                a,b=owner[first],owner[second]
                hit=collision(('own',seat,first,second),f'{prefix}/own/{seat}/{first}/{second}',a,b)
                if not hit:continue
                if hit['kind']!='surface':
                    rows.append(dict(kind='arm_body',seat=seat,parts=[first,second],valid=False,residual=1.,evidence=hit))
                    continue
                pairs=arrays[hit['witness_array']]
                rows.append(self.memo.query(('classification',seat,first,second),(*context,keys[id(a)],keys[id(b)]),
                    lambda local,key:self.classifier.contact(seat,first,second,surface_data(a),surface_data(b),pairs,local,key),
                    arrays,f'{prefix}/mapped/{seat}/{first}/{second}'))
            for side in ('L','R'):
                budget()
                measurement=next(r['measurement'] for r in self.hands['hands'] if r['seat']==seat and r['side']==side)
                suffix='.001' if side=='R' else ''
                hand='Relaxed palm'+suffix; target=measurement['support']
                support=self.solids[target] if target in self.solids else owner[target]
                # Every other scene surface can interrupt direct hand support.
                obstacles={f'{other}/{name}':surface_data(value) for other,body in enumerate(owners) for name,value in body.items()
                           if not(other==seat and name in (hand,target,'Resting thumb'+suffix))}
                obstacles.update({'furniture/'+name:surface_data(value) for name,value in self.solids.items() if name!=target})
                support_row=exposed(surface_data(owner[hand]),surface_data(support),measurement['support_normal'],measurement['near_gap'],obstacles,arrays,f'{prefix}/contact/{seat}/{side}')
                rows.append(dict(seat=seat,side=side,target=target,**support_row))
            length=max(abs((b.tail-b.head).length-rig.data.bones[b.name].length) for b in rig.pose.bones)
            scale=max(abs(value-1) for b in rig.pose.bones for value in b.scale)
            joins=max((rig.pose.bones[a+'.'+side].tail-rig.pose.bones[b+'.'+side].head).length
                      for side in ('L','R') for a,b in (('upper_arm','forearm'),('forearm','hand')))
            rest_error=max(float(np.max(np.abs(np.asarray(bone.matrix_local)-np.asarray(
                self.classifier.audit['rest_bones'][bone.name]['matrix'])))) for bone in rig.data.bones)
            rest_length_error=max(abs(bone.length-self.classifier.audit['rest_bones'][bone.name]['length']) for bone in rig.data.bones)
            reach=[]
            for side in ('L','R'):
                upper,lower=(self.classifier.audit['rest_bones'][part+'.'+side]['length'] for part in ('upper_arm','forearm'))
                distance=(rig.pose.bones['hand.'+side].head-rig.pose.bones['upper_arm.'+side].head).length
                reach.append(max(0.,abs(upper-lower)-distance,distance-upper-lower))
            reach_error=max(reach)
            rows.append(dict(kind='joints',seat=seat,valid=max(length,scale,joins,frame_error,reach_error)<=1e-5
                             and max(rest_error,rest_length_error)<=1e-5,
                             residual=max(length,scale,joins,frame_error,rest_error,rest_length_error,reach_error),
                             length=length,scale=scale,joins=joins,frame_error=frame_error,
                             source_rest_frame_error=rest_error,source_rest_length_error=rest_length_error,
                             source_reach_violation=reach_error))
            for name,value in owner.items():
                if name.startswith('Fitted rounded shoe sole'):
                    minimum=float(np.min(np.asarray(value.points)[:,2]))
                    prior_minimum=float(self.baseline[seat][name]['points'][:,2].min())
                    rows.append(dict(kind='support',seat=seat,part=name,valid=abs(minimum-prior_minimum)<=1e-7,
                                     residual=abs(minimum-prior_minimum),sole_height=minimum,
                                     reason='Verified initial sole geometry preserved exactly'))
            hip=retained.torso.depth.regions.support(owner['Trouser hip bridge'].points,bpy.data.objects[f'Seat cushion {seat}'],bpy.context.evaluated_depsgraph_get())
            rows.append(dict(kind='support',seat=seat,part='hips',residual=0. if hip['valid'] else 1.,**hip))
            arrays[f'{prefix}/{seat}/bone_matrices']=np.asarray([list(b.matrix) for b in rig.pose.bones])
            arrays[f'{prefix}/{seat}/rig_matrix_world']=np.asarray(rig.matrix_world)
        for left,right in itertools.combinations(range(3),2):
            budget()
            for name,a in owners[left].items():
                for part,b in owners[right].items():
                    hit=collision(('neighbor',left,right,name,part),f'{prefix}/neighbor/{left}/{right}/{name}/{part}',a,b)
                    if hit: rows.append(dict(kind='neighbors',seats=[left,right],parts=[name,part],valid=False,residual=hit.get('triangle_pairs',1),evidence=hit))
        for name in REQUIRED:coverage[name]=True
        return dict(rows=rows,exact_reuse=dict(hits=self.memo.hits-start_hits,misses=self.memo.misses-start_misses,
                    entries=len(self.memo.entries),source_context=context[0],ownership_context=context[1],
                    key='Immutable source and classifier identity, current owner assignments, exact evaluated float64 points and ordered int32 triangles'),
                    **gate(rows,coverage))
