"""Pure reconstruction of the frozen Blender contact chart from saved inputs."""
import copy
import math
import numpy as np
from sofa_contact_solver_adaptive import recover
from sofa_contact_solver_placement import centre_bounds
from sofa_contact_solver_frames import coupled_frames,rotation
from derive_lap_support_adjustment import minimum_gap


class SavedChart:
    def __init__(self,seat,side,data,geometry,rest,bone_names,measurement):
        self.seat,self.side=seat,side;self.data=copy.deepcopy(data)
        suffix='.001' if side=='R' else ''
        self.palm=rest['Relaxed palm'+suffix+'/rest_points'];self.triangles=rest['Relaxed palm'+suffix+'/triangles']
        self.rest_hand=np.asarray(data['matrices']['hand_rest']);self.world=geometry[f'scene/{seat}/rig_matrix_world'];self.inverse=np.linalg.inv(self.world)
        bones=geometry[f'scene/{seat}/bone_matrices'];self.actual={part:bones[bone_names.index(part+'.'+side)] for part in ('upper_arm','forearm','hand')}
        hand0=self.world@self.actual['hand'];self.deform=hand0@np.linalg.inv(self.rest_hand)
        self.centre=(self.palm@self.deform[:3,:3].T+self.deform[:3,3]).mean(0)
        self.normal=np.asarray(measurement['support_normal']);self.normal/=np.linalg.norm(self.normal)
        tangent=np.array([-1.,0.,0.]);tangent-=self.normal*(tangent@self.normal);tangent/=np.linalg.norm(tangent)
        self.basis=np.column_stack((tangent,np.cross(self.normal,tangent),self.normal))
        spans=np.ptp(self.palm@self.deform[:3,:3].T@self.basis,axis=0);self.tilt=math.atan2(spans[2],min(spans[:2]))
        target='Tailored trouser leg'+suffix
        self.support=geometry[f'scene/{seat}/{target}/points'];self.support_triangles=geometry[f'scene/{seat}/{target}/triangles']
        self.low,self.high,_,_=centre_bounds(self.support,self.support_triangles,self.normal,self.palm)
        recovered=recover(data,self.actual['upper_arm'],self.actual['forearm'],self.actual['hand'])
        self.q=np.zeros(7);self.q[:2]=(self.centre[:2]-(self.low+self.high)/2)/((self.high-self.low)/2)
        self.q[5]=recovered['swivel']/math.pi;self.q[6]=recovered['roll']/math.pi

    def bound(self,q):
        q=np.asarray(q).copy();q[:2]=np.clip(q[:2],-1,1);q[3:5]=np.clip(q[3:5],-1,1)
        for i in (2,5,6):q[i]=(q[i]+1)%2-1
        return q

    def construct(self,q):
        q=self.bound(q);xy=(self.low+self.high)/2+q[:2]*(self.high-self.low)/2
        rotation_world=rotation(self.normal,q[2]*math.pi)@rotation(self.basis[:,0],q[3]*self.tilt)@rotation(self.basis[:,1],q[4]*self.tilt)
        deform=self.deform.copy();deform[:3,:3]=rotation_world@deform[:3,:3]
        deform[:3,3]=np.r_[xy,self.centre[2]]-deform[:3,:3]@self.palm.mean(0)
        points=self.palm@deform[:3,:3].T+deform[:3,3]
        gap=minimum_gap(points,self.triangles,self.support,self.support_triangles,self.basis)
        deform[:3,3]+=self.normal*(.0005-gap['minimum'])
        solved=coupled_frames(self.data,self.inverse@deform@self.rest_hand,q[5]*math.pi,q[6]*math.pi)
        solved['parameters']=q;solved['world_frames']={name:self.world@frame for name,frame in solved['targets'].items()}
        return solved
