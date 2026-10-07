"""Two-arm source-feature constraints using measured evaluated geometry."""
import math
import numpy as np

ACTIVE=((0,'L'),(1,'R'))
EPS=1e-6


def belongs(part,side):
    return part.startswith(('Relaxed shirt sleeve','Turned sleeve cuff','Forearm with elbow and wrist sections','Relaxed palm','Resting thumb')) and part.endswith('.001')==(side=='R')


def affected(row,active=ACTIVE):
    if 'seats' in row and 'parts' in row:
        return any((seat,side) in active and belongs(part,side) for seat,part in zip(row['seats'],row['parts']) for side in ('L','R'))
    return any(row.get('seat')==seat and any(belongs(part,side) for part in row.get('parts',[])) for seat,side in active)


def row_key(row):
    seats=row.get('seats',[row.get('seat')])
    return '/'.join([row['kind'],','.join(str(s) for s in seats),*row.get('parts',[])])


def closest_point(point,tri):
    candidates=[]
    a,b,c=tri;edges=np.column_stack((b-a,c-a));uv=np.linalg.lstsq(edges,point-a,rcond=None)[0]
    if uv.min()>=0 and uv.sum()<=1:
        weight=np.array([1-uv.sum(),*uv]);candidates.append((weight@tri,weight))
    for i,j in ((0,1),(1,2),(2,0)):
        axis=tri[j]-tri[i];den=axis@axis
        t=float(np.clip(((point-tri[i])@axis)/den,0,1)) if den>0 else 0.
        weight=np.zeros(3);weight[i]=1-t;weight[j]=t;candidates.append((weight@tri,weight))
    return min(candidates,key=lambda row:np.linalg.norm(row[0]-point))


def closest_triangles(first,second):
    candidates=[]
    for i in range(3):
        point,weight=closest_point(first[i],second);wa=np.eye(3)[i];candidates.append((first[i],point,wa,weight))
        point,weight=closest_point(second[i],first);wb=np.eye(3)[i];candidates.append((point,second[i],weight,wb))
    for ai,aj in ((0,1),(1,2),(2,0)):
        for bi,bj in ((0,1),(1,2),(2,0)):
            a,b=first[ai],second[bi];u,v=first[aj]-a,second[bj]-b;w=a-b
            system=np.array([[u@u,-u@v],[-u@v,v@v]])
            if abs(np.linalg.det(system))<1e-20:continue
            s,t=np.linalg.solve(system,np.array([-u@w,v@w]))
            if 0<=s<=1 and 0<=t<=1:
                wa=np.zeros(3);wa[ai]=1-s;wa[aj]=s
                wb=np.zeros(3);wb[bi]=1-t;wb[bj]=t
                candidates.append((wa@first,wb@second,wa,wb))
    return min(candidates,key=lambda row:np.linalg.norm(row[0]-row[1]))


def surface(arrays,prefix,seat,name):
    return arrays[f'{prefix}/{seat}/{name}/points'],arrays[f'{prefix}/{seat}/{name}/triangles']


def feature(group,kind,seat_a,name_a,ids_a,weights_a,seat_b,name_b,ids_b,weights_b,normal,origin):
    return dict(group=group,kind=kind,a=dict(seat=seat_a,name=name_a,vertices=[int(i) for i in ids_a],weights=np.asarray(weights_a).tolist()),
                b=dict(seat=seat_b,name=name_b,vertices=[int(i) for i in ids_b],weights=np.asarray(weights_b).tolist()),
                normal=np.asarray(normal).tolist(),origin=origin)


def feature_values(features,arrays,prefix):
    values=[]
    for row in features:
        points=[]
        for endpoint in ('a','b'):
            entry=row[endpoint];p=arrays[f'{prefix}/{entry["seat"]}/{entry["name"]}/points']
            points.append(np.asarray(entry['weights'])@p[np.asarray(entry['vertices'])])
        values.append(float(np.asarray(row['normal'])@(points[0]-points[1])))
    return np.asarray(values)


def own_features(result,arrays,prefix,neutral):
    features=[];coverage=[]
    for row in result['rows']:
        if row['kind']!='arm_body' or row['valid'] or not affected(row):continue
        first,second=row['parts'];seat=row['seat'];witness=row['witness']
        pairs=arrays[witness+'/pairs'];source=arrays[witness+'/source_segments'];faces=arrays[witness+'/source_faces']
        if len(pairs)!=len(source):raise ValueError('Unresolved material mapping cannot define local constraints')
        indices=list(row['invalid_segments'])
        if first.startswith('Relaxed shirt sleeve') and second=='Overshirt body':
            floor=next(r['bounds'][0][2] for r in neutral['cases'] if r['name']==first)
            indices=[i for i in indices if np.min(source[i,0,:,2])<floor-EPS]
        if not indices:raise ValueError('No demonstrated exterior material witnesses for '+row_key(row))
        ap,at=surface(arrays,prefix,seat,first);bp,bt=surface(arrays,prefix,seat,second)
        group=row_key(row)
        for index in indices:
            ai,bi=pairs[index];aids,bids=at[ai],bt[bi];a,b=ap[aids],bp[bids]
            normal=np.cross(b[1]-b[0],b[2]-b[0]);normal/=np.linalg.norm(normal)
            # A local oriented surface-side observation, not closed-shirt containment.
            vertex=int(np.argmin((a-b.mean(0))@normal));wa=np.eye(3)[vertex]
            features.append(feature(group,'existing garment',seat,first,aids,wa,seat,second,bids,[1/3]*3,normal,
                dict(witness=witness,pair=[int(ai),int(bi)],source_faces=faces[index].tolist(),source_segment=index)))
        coverage.append(dict(group=group,original_invalid_segments=len(row['invalid_segments']),modeled_exterior_segments=len(indices),
                             attachment_material_excluded=first.startswith('Relaxed shirt sleeve') and second=='Overshirt body'))
    return features,coverage


def neighbor_features(arrays,prefix,failed_caches,source_maps):
    features=[];group='neighbors/0,1/Relaxed shirt sleeve/Relaxed shirt sleeve.001'
    first,second='Relaxed shirt sleeve','Relaxed shirt sleeve.001'
    ap,at=surface(arrays,prefix,0,first);bp,bt=surface(arrays,prefix,1,second)
    for label,old in failed_caches:
        pairs=old['candidate/neighbor/0/1/'+first+'/'+second]
        old_a=old['candidate/0/'+first+'/triangles'];old_b=old['candidate/1/'+second+'/triangles']
        for ai,bi in pairs:
            # Evaluated material vertex identities are stable even when a quad's
            # triangulation diagonal changes. All retained pairs remain recorded.
            aids,bids=old_a[ai],old_b[bi]
            p,q,wa,wb=closest_triangles(ap[aids],bp[bids]);normal=p-q;length=np.linalg.norm(normal)
            if length<=EPS:raise ValueError('Common neighbor feature has unresolved zero separation')
            features.append(feature(group,'neighbor guard',0,first,aids,wa,1,second,bids,wb,normal/length,
                dict(retained_case=label,pair=[int(ai),int(bi)],source_faces=[int(source_maps[label][0][ai]),int(source_maps[label][1][bi])],reference_distance=float(length))))
    return features


def summaries(features,values):
    groups={}
    for row,value in zip(features,values):groups.setdefault(row['group'],[]).append(float(value))
    return {name:dict(features=len(v),minimum_separation=min(v),maximum_local_violation=max(0.,-min(v)),
                      rms_local_violation=float(np.sqrt(np.mean(np.minimum(v,0.)**2)))) for name,v in groups.items()}


def halfspaces(features,reference,jacobian,target,fraction):
    limits=[]
    for row,value in zip(features,reference):
        if row['kind']=='existing garment':
            limits.append(-value if value>=0 else -fraction*value if row['group']==target else 0.)
        else:limits.append(-value)
    return jacobian.copy(),np.asarray(limits)


def feasible_step(matrix,bounds,lower,upper,iterations=1500):
    norms=np.linalg.norm(matrix,axis=1);fixed=norms<1e-12
    if np.any(fixed & (bounds>1e-8)):
        return dict(found=False,reason='Fixed local feature conflicts with requested improvement',conflicting=np.flatnonzero(fixed & (bounds>1e-8)).tolist(),step=np.zeros(matrix.shape[1]))
    keep=np.flatnonzero(~fixed);a=matrix[keep]/norms[keep,None];b=bounds[keep]/norms[keep]
    step=np.zeros(matrix.shape[1]);step=np.clip(step,lower,upper)
    for iteration in range(iterations):
        residual=b-a@step
        if not len(residual) or residual.max()<=1e-8:
            return dict(found=True,step=step,iterations=iteration,minimum_margin=float((matrix@step-bounds).min()))
        i=int(np.argmax(residual));step=np.clip(step+residual[i]*a[i],lower,upper)
    violation=b-a@step;worst=np.argsort(violation)[-8:]
    return dict(found=False,reason='Bounded local feasibility iteration did not converge; not an infeasibility proof',
                step=step,iterations=iterations,conflicting=keep[worst].tolist(),violations=violation[worst].tolist())


def joint_step(features,reference,jacobian,target,lower,upper):
    rank=int(np.linalg.matrix_rank(jacobian));accepted=None;lo,hi=0.,1.
    for _ in range(10):
        fraction=(lo+hi)/2;a,b=halfspaces(features,reference,jacobian,target,fraction)
        result=feasible_step(a,b,lower,upper)
        if result['found']:lo=fraction;accepted=result
        else:hi=fraction;last=result
    if accepted is None or lo<.01:
        return dict(found=False,rank=rank,fraction=lo,reason='No useful admissible local step found within the declared bounds',
                    conflicting=last.get('conflicting',[]),solver_reason=last.get('reason'))
    return dict(found=True,rank=rank,fraction=lo,step=accepted['step'],iterations=accepted['iterations'],
                predicted=reference+jacobian@accepted['step'])


def nonworsening(features,reference,actual,tolerance=EPS):
    failures=[]
    for i,(row,before,after) in enumerate(zip(features,reference,actual)):
        minimum=min(before,0.) if row['kind']=='existing garment' else 0.
        if after<minimum-tolerance:failures.append(dict(feature=i,group=row['group'],before=float(before),after=float(after),minimum=float(minimum)))
    return dict(valid=not failures,failures=failures)
