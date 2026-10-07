"""Reference-scene proximity guards; all coordinates are evaluated material points."""
import numpy as np
from sofa_contact_solver_block import ACTIVE,belongs,feature,closest_point
from sofa_coupled_contact_evaluator import anatomical_pair


def nearby_features(owners,solids,result,classifier,radius=.04):
    known={}
    for row in result['rows']:
        if row['kind']=='arm_body':known[row['seat'],frozenset(row['parts'])]=row
    records=[(seat,name,surface) for seat,owner in enumerate(owners) for name,surface in owner.items()]
    records += [('furniture',name,surface) for name,surface in solids.items()]
    seen=set();features=[];coverage=[]
    for seat,side in ACTIVE:
        for name,first in owners[seat].items():
            if not belongs(name,side):continue
            for other,part,second in records:
                if other==seat and part==name:continue
                identity=tuple(sorted(((str(seat),name),(str(other),part))))
                if identity in seen:continue
                seen.add(identity)
                if other==seat:
                    if (seat,frozenset((name,part))) in known:continue
                    if name in classifier.groups and part in classifier.groups and anatomical_pair(name,part,classifier.groups):continue
                if {str(seat),str(other)}=={'0','1'} and {name,part}=={'Relaxed shirt sleeve','Relaxed shirt sleeve.001'}:continue
                low_a,high_a=np.asarray(first.bounds);low_b,high_b=np.asarray(second.bounds)
                separation=np.maximum(np.maximum(low_a-high_b,low_b-high_a),0.)
                if np.linalg.norm(separation)>radius:continue
                best=None
                for reverse,a,b in ((False,first,second),(True,second,first)):
                    for index,point in enumerate(a.points):
                        nearest,normal,triangle,distance=b.tree.find_nearest(point)
                        if nearest is None or distance>radius:continue
                        if best is None or distance<best[0]:best=(distance,reverse,index,triangle)
                if best is None:continue
                distance,reverse,index,triangle=best
                a,b=(second,first) if reverse else (first,second)
                point=np.asarray(a.points[index]);ids=np.asarray(b.triangles[triangle]);target=np.asarray(b.points)[ids]
                nearest,weights=closest_point(point,target)
                if reverse:
                    aids,wa,pa=ids,weights,nearest;bids,wb,pb=[index],[1.],point
                else:
                    aids,wa,pa=[index],[1.],point;bids,wb,pb=ids,weights,nearest
                normal=pa-pb;length=np.linalg.norm(normal)
                if length<=1e-6:
                    coverage.append(dict(parts=[name,part],owners=[seat,other],unresolved_reference_proximity=float(length)))
                    continue
                group=f'nearby/{seat}/{name}/{other}/{part}'
                features.append(feature(group,'nearby guard',seat,name,aids,wa,other,part,bids,wb,normal/length,
                                        dict(reference_distance=float(length),search_radius=radius)))
                coverage.append(dict(group=group,reference_distance=float(length)))
    return features,coverage
