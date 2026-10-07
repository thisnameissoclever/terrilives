"""Coupled placement with conservative bounds and recovered measured frames."""
import copy
import math
import numpy as np
from sofa_contact_solver_fit import ArmDomain as PriorDomain
from sofa_contact_solver_scene_v2 import surface_data
from sofa_contact_solver_adaptive import recover
from sofa_contact_solver_placement import centre_bounds


class ArmDomain(PriorDomain):
    def __init__(self,seat,side,rig,data,owner,classifier,measurement):
        self.seat,self.side,self.rig=seat,side,rig
        self.data=copy.deepcopy(data);suffix='.001' if side=='R' else ''
        self.palm=classifier.rest['Relaxed palm'+suffix+'/rest_points']
        self.palm_triangles=classifier.rest['Relaxed palm'+suffix+'/triangles']
        self.rest_hand=np.asarray(data['matrices']['hand_rest'])
        self.world=np.asarray(rig.matrix_world);self.inverse=np.linalg.inv(self.world)
        self.hand0=self.world@np.asarray(rig.pose.bones['hand.'+side].matrix)
        self.deform0=self.hand0@np.linalg.inv(self.rest_hand)
        self.centre=(self.palm@self.deform0[:3,:3].T+self.deform0[:3,3]).mean(0)
        self.normal=np.asarray(measurement['support_normal']);self.normal/=np.linalg.norm(self.normal)
        tangent=np.array([-1.,0.,0.]);tangent-=self.normal*(tangent@self.normal);tangent/=np.linalg.norm(tangent)
        self.basis=np.column_stack((tangent,np.cross(self.normal,tangent),self.normal))
        span=np.ptp(self.palm@self.deform0[:3,:3].T@self.basis,axis=0)
        self.tilt=math.atan2(span[2],min(span[:2]))
        self.support=surface_data(owner['Tailored trouser leg'+suffix])
        self.low,self.high,ids,self.palm_radius=centre_bounds(self.support['points'],self.support['triangles'],self.normal,self.palm)
        self.exposed=ids.tolist()
        self.q=np.zeros(7);self.q[:2]=(self.centre[:2]-(self.low+self.high)/2)/((self.high-self.low)/2)
        recovery=recover(data,*[np.asarray(rig.pose.bones[name+'.'+side].matrix) for name in ('upper_arm','forearm','hand')])
        self.q[5]=recovery['swivel']/math.pi;self.q[6]=recovery['roll']/math.pi
        self.initial_q=self.q.copy()
        if np.max(np.abs(self.q[:2]))>1:raise ValueError('Known supported hand lies outside conservative centre bounds')
        replay=self.construct(self.q)
        self.reference_errors={name:float(np.max(np.abs(matrix-np.asarray(rig.pose.bones[name].matrix)))) for name,matrix in replay['frames'].items()}
        self.needs_reference=max(self.reference_errors.values())>1e-5

    def bounded(self,q):
        q=np.asarray(q).copy();q[:2]=np.clip(q[:2],-1,1);q[3:5]=np.clip(q[3:5],-1,1)
        for i in (2,5,6):q[i]=(q[i]+1)%2-1
        return q
