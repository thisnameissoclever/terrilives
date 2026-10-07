"""Complete containment screening and finite side-contact evidence for one chain proof."""
import hashlib
import numpy as np
from continuous_support_patch import measure
from sofa_coupled_contact_evaluator import solid_angle
from sofa_contact_solver_block import closest_triangles


class Containment:
    def __init__(self):
        self.components={}
        self.statistics=dict(overlapping_pairs_without_surface_crossings=0,closed_target_checks=0,component_tests=0)

    def representatives(self,surface):
        triangles=np.asarray(surface.triangles,dtype=np.int32)
        key=hashlib.sha256(triangles.tobytes()).hexdigest()
        if key not in self.components:
            parent=np.arange(len(surface.points))
            def root(index):
                while parent[index]!=index:
                    parent[index]=parent[parent[index]]
                    index=parent[index]
                return index
            for a,b,c in triangles:
                ra,rb,rc=root(a),root(b),root(c)
                parent[rb]=ra
                parent[rc]=ra
            self.components[key]=np.unique([root(i) for i in np.unique(triangles)])
        return self.components[key]

    def check(self,a,b,key,budget):
        self.statistics['overlapping_pairs_without_surface_crossings']+=1
        rows=[]
        for label,source,target in (('first_inside_second',a,b),('second_inside_first',b,a)):
            topology=target.topology
            closed=all(topology[name]==0 for name in ('boundary_edges','nonmanifold_edges','inconsistent_edges'))
            if not closed:
                rows.append(dict(kind='unresolved_containment_topology',parts=key.split('|'),direction=label,target_topology=topology))
                continue
            self.statistics['closed_target_checks']+=1
            points=np.asarray(target.points)
            triangles=np.asarray(target.triangles,dtype=np.int32)
            low,high=np.asarray(target.bounds)
            for index in self.representatives(source):
                budget()
                point=np.asarray(source.points[index])
                if np.any(point<low) or np.any(point>high):
                    continue
                self.statistics['component_tests']+=1
                winding=solid_angle(point,points,triangles)
                if abs(winding)>.5:
                    distance=target.tree.find_nearest(source.points[index])[3]
                    if distance is None:
                        rows.append(dict(kind='unresolved_containment_distance',parts=key.split('|'),direction=label,vertex=int(index)))
                    elif distance>1e-6:
                        rows.append(dict(kind='contained_surface_component',parts=key.split('|'),direction=label,
                            vertex=int(index),point=point.tolist(),winding=winding,distance=distance))
        return rows


def merged(owner,names):
    points=[]
    triangles=[]
    offset=0
    for name in names:
        surface=owner[name]
        points.append(np.asarray(surface.points))
        triangles.append(np.asarray(surface.triangles,dtype=np.int32)+offset)
        offset+=len(surface.points)
    return np.concatenate(points),np.concatenate(triangles)


def minimum_contact(owner,skin_names,book_names):
    """Global triangle distance for surfaces proved separated by the book side plane."""
    best=float('inf')
    skin_data={}
    book_data={}
    for names,destination in ((skin_names,skin_data),(book_names,book_data)):
        for name in names:
            surface=owner[name]
            points=np.asarray(surface.points)
            triangles=np.asarray(surface.triangles,dtype=np.int32)
            vertices=points[triangles]
            destination[name]=dict(points=points,triangles=triangles,vertices=vertices,
                low=vertices.min(1),high=vertices.max(1))
    for a in skin_data.values():
        for b in book_data.values():
            best=min(best,float(np.linalg.norm(a['points'][:,None,:]-b['points'][None,:,:],axis=2).min()))
    candidates=[]
    for name,a in skin_data.items():
        for other,b in book_data.items():
            gaps=np.maximum(0,np.maximum(a['low'][:,None,:]-b['high'][None,:,:],b['low'][None,:,:]-a['high'][:,None,:]))
            bounds=np.linalg.norm(gaps,axis=2)
            for ai,bi in np.argwhere(bounds<=best+1e-12):
                candidates.append((float(bounds[ai,bi]),name,other,int(ai),int(bi)))
    candidates.sort()
    witness=None
    checked=0
    for bound,name,other,ai,bi in candidates:
        if bound>best+1e-12:
            break
        first=skin_data[name]['vertices'][ai]
        second=book_data[other]['vertices'][bi]
        a,b,wa,wb=closest_triangles(first,second)
        distance=float(np.linalg.norm(a-b))
        checked+=1
        if distance<=best+1e-12:
            best=distance
            normal=np.cross(second[1]-second[0],second[2]-second[0])
            normal/=np.linalg.norm(normal)
            witness=dict(distance=distance,skin_part=name,book_part=other,
                skin_triangle=ai,book_triangle=bi,skin_point=a.tolist(),book_point=b.tolist(),
                skin_barycentric=wa.tolist(),book_barycentric=wb.tolist(),book_triangle_normal=normal.tolist())
    if witness is None:
        raise ValueError('No full-surface nearest witness resolved')
    witness.update(candidate_triangle_pairs=len(candidates),evaluated_triangle_pairs=checked,
        method='Global AABB lower-bound pruning; complete vertex-face and edge-edge minima for side-plane-separated surfaces')
    return witness


def finite_grasp(owner,book_rotation,arrays):
    book_names=[name for name in owner if name.startswith(('Reading book cover','Reading book pages','Printed book line'))]
    book_points,book_triangles=merged(owner,book_names)
    rows=[]
    for side,sign,suffix in (('L',-1,''),('R',1,'.001')):
        skin_names=[name+suffix for name in ('Relaxed palm','Resting thumb','Forearm with elbow and wrist sections')]
        points,triangles=merged(owner,skin_names)
        normal=book_rotation@np.asarray([sign,0.,0.])
        result=measure(points,triangles,book_points,book_triangles,normal,.0015)
        prefix='finite-grasp/'+side
        for key in ('basis','vertices','offsets','pairs','excluded'):
            arrays[prefix+'/'+key]=result[key]
        nearest=minimum_contact(owner,skin_names,book_names)
        rows.append(dict(side=side,skin_parts=skin_names,book_parts=book_names,
            normal=normal.tolist(),maximum_gap=.0015,nearest_actual_surfaces=nearest,
            projected_area=result['projected_area'],spans=result['spans'],certified_cells=result['certified_cells'],
            occluded_or_ambiguous_cells=result['occluded_or_ambiguous_cells'],witness=prefix,
            valid=result['projected_area']>0 and result['certified_cells']>0,
            interpretation='Finite opposing side-contact area only; not a force, friction or visual-grip acceptance proof'))
    return rows
