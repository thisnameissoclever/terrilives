"""Blender adapter for the unified complete supported-arm evaluator."""
import itertools
import time
import numpy as np
import bpy
from mathutils import Matrix
import probe_sofa_resting_clearance as retained
from sofa_contact_solver_evaluator import Evaluator, gate, REQUIRED, ARM_PARTS, exposed


def surface_data(surface):
    return dict(points=np.asarray(surface.points),triangles=np.asarray(surface.triangles,dtype=np.int32))


class SceneEvaluator:
    def __init__(self, root, rigs, bodies, furniture, hand_receipt, baseline):
        self.classifier=Evaluator(root)
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
                    hit=retained.verified_hit(arrays,f'{prefix}/furniture/{seat}/{name}/{part}',surface,solid)
                    if hit: rows.append(dict(kind='furniture',seat=seat,parts=[name,part],valid=False,residual=hit.get('triangle_pairs',1),evidence=hit))
                if not name.startswith(ARM_PARTS):continue
                pairs=[(a,b) for a,b in surface.tree.overlap(surface.tree)
                       if a<b and not set(surface.triangles[a])&set(surface.triangles[b])]
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
                hit=retained.verified_hit(arrays,f'{prefix}/own/{seat}/{first}/{second}',a,b)
                if not hit:continue
                if hit['kind']!='surface':
                    rows.append(dict(kind='arm_body',seat=seat,parts=[first,second],valid=False,residual=1.,evidence=hit))
                    continue
                pairs=arrays[hit['witness_array']]
                rows.append(self.classifier.contact(seat,first,second,surface_data(a),surface_data(b),pairs,arrays,
                                                    f'{prefix}/mapped/{seat}/{first}/{second}'))
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
            rows.append(dict(kind='joints',seat=seat,valid=max(length,scale,joins,frame_error)<=1e-5,
                             residual=max(length,scale,joins,frame_error),length=length,scale=scale,joins=joins,frame_error=frame_error))
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
                    hit=retained.verified_hit(arrays,f'{prefix}/neighbor/{left}/{right}/{name}/{part}',a,b)
                    if hit: rows.append(dict(kind='neighbors',seats=[left,right],parts=[name,part],valid=False,residual=hit.get('triangle_pairs',1),evidence=hit))
        for name in REQUIRED:coverage[name]=True
        return dict(rows=rows,**gate(rows,coverage))
