"""Actual-triangle discovery shared by cached controls and Blender snapshots."""
import collections
import time
import numpy as np

from sofa_coupled_contact_evaluator import solid_angle,nearest_distance
from continuous_support_patch import intersect,signed_area

EPS=1e-6


class Mesh:
    def __init__(self,points,triangles,native_tree=None):
        self.points=np.asarray(points,dtype=np.float64);self.triangles=np.asarray(triangles,dtype=np.int32)
        self.tri=self.points[self.triangles];self.low=self.points.min(0);self.high=self.points.max(0)
        self.tri_low=self.tri.min(1);self.tri_high=self.tri.max(1);self.native_tree=native_tree
        edges=np.concatenate([self.triangles[:,[0,1]],self.triangles[:,[1,2]],self.triangles[:,[2,0]]])
        signs=np.where(edges[:,0]<edges[:,1],1,-1);keys=np.sort(edges,axis=1)
        _,inverse,counts=np.unique(keys,axis=0,return_inverse=True,return_counts=True)
        winding=np.bincount(inverse,weights=signs)
        self.closed=bool(np.all(counts==2) and np.all(winding==0))
        self.topology=dict(boundary_edges=int((counts==1).sum()),nonmanifold_edges=int((counts>2).sum()),inconsistent_edges=int(((counts==2)&(winding!=0)).sum()))
        parent=np.arange(len(self.points))
        def root(i):
            while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
            return i
        for a,b in edges:parent[root(int(b))]=root(int(a))
        self.components=np.unique([root(int(i)) for i in np.unique(self.triangles)])

    def data(self):return dict(points=self.points,triangles=self.triangles)


class Kernel:
    def __init__(self,primitives,deadline=None):
        self.primitives=primitives;self.deadline=deadline;self.candidate_pairs=0

    def budget(self):
        if self.deadline is not None and time.monotonic()>=self.deadline:raise TimeoutError('Complete reading evaluation deadline exhausted')

    def candidates(self,a,b,self_test=False):
        if a.native_tree is not None and b.native_tree is not None:
            for i,j in a.native_tree.overlap(b.native_tree):
                if not self_test or i<j:yield int(i),int(j)
            return
        for i,t in enumerate(a.tri):
            self.budget()
            ids=np.flatnonzero(np.all(b.tri_high>=a.tri_low[i],axis=1)&np.all(b.tri_low<=a.tri_high[i],axis=1))
            for j in ids:
                if not self_test or i<j:yield i,int(j)

    def pairs(self,a,b,self_test=False):
        if np.any(a.high<b.low) or np.any(b.high<a.low):return np.empty((0,2),np.int32),[]
        pairs=[];unresolved=[]
        for i,j in self.candidates(a,b,self_test):
            self.candidate_pairs+=1
            if self_test and set(a.triangles[i])&set(b.triangles[j]):continue
            value=self.primitives['intersection_segment'](a.tri[i],b.tri[j])
            if value['kind']=='segment':
                if value['length']>1e-8:pairs.append((i,j))
            elif value['kind']=='unresolved_coplanar_or_parallel':
                first,second=a.tri[i],b.tri[j];normal=np.cross(first[1]-first[0],first[2]-first[0]);length=np.linalg.norm(normal)
                if length<=1e-15:unresolved.append(dict(pair=[i,j],kind='degenerate triangle'));continue
                normal/=length
                if np.max(np.abs((second-first[0])@normal))>1e-8:continue
                axes=[k for k in range(3) if k!=int(np.argmax(np.abs(normal)))];x,y=first[:,axes],second[:,axes]
                if signed_area(list(x))<0:x=x[::-1]
                if signed_area(list(y))<0:y=y[::-1]
                overlap=intersect(list(x),y)
                if len(overlap)>=3 and abs(signed_area(overlap))>1e-14:unresolved.append(dict(pair=[i,j],kind='coplanar material overlap'))
            elif value['kind'] not in ('unresolved_numerical_slice','unresolved_nonoverlapping_slices'):
                unresolved.append(dict(pair=[i,j],kind=value['kind']))
        return np.asarray(pairs,dtype=np.int32).reshape((-1,2)),unresolved

    def contact(self,a,b,arrays,prefix):
        pairs,unresolved=self.pairs(a,b)
        if len(pairs) or unresolved:
            arrays[prefix+'/pairs']=pairs
            return dict(kind='surface',pairs=pairs,witness=prefix,unresolved=unresolved)
        for label,source,target in (('first_inside_second',a,b),('second_inside_first',b,a)):
            if not target.closed:continue
            for index in source.components:
                p=source.points[index]
                if np.any(p<target.low) or np.any(p>target.high):continue
                winding=solid_angle(p,target.points,target.triangles)
                if abs(winding)>.5:
                    distance=nearest_distance(p,target.points,target.triangles)
                    if distance>EPS:return dict(kind=label,vertex=int(index),point=p.tolist(),winding=winding,distance=distance)
        return None

    def ray(self,mesh,origin,direction,minimum=EPS):
        tri=mesh.tri;e1=tri[:,1]-tri[:,0];e2=tri[:,2]-tri[:,0]
        h=np.cross(np.broadcast_to(direction,e2.shape),e2);det=np.einsum('ij,ij->i',e1,h)
        inv=np.divide(1.,det,out=np.zeros_like(det),where=np.abs(det)>1e-14)
        s=origin-tri[:,0];u=np.einsum('ij,ij->i',s,h)*inv;q=np.cross(s,e1)
        v=(q@direction)*inv;t=np.einsum('ij,ij->i',e2,q)*inv
        valid=(np.abs(det)>1e-14)&(u>=-1e-9)&(v>=-1e-9)&(u+v<=1+1e-9)&(t>minimum)
        ids=np.flatnonzero(valid)
        if not len(ids):return None
        i=int(ids[np.argmin(t[ids])]);return dict(triangle=i,distance=float(t[i]),point=(origin+t[i]*direction).tolist(),barycentric=[float(1-u[i]-v[i]),float(u[i]),float(v[i])])
