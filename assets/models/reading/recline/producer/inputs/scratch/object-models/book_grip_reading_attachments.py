"""Source-anatomical collar/neck attachment classification with indexed controls."""
import collections
import itertools
import numpy as np

from sofa_coupled_contact_evaluator import solid_angle
from sofa_coupled_contact_evaluator_v2 import component_ids
from sofa_coupled_contact_segments import mapped_segments
from classify_sofa_lap_contacts import source_map

EPS=1e-6
NECK_PAIRS={frozenset(('Collar stand','Natural neck')),frozenset(('Natural neck','Sculpted head')),frozenset(('Collar stand','Sculpted head'))}


def raw_caps(name,topology):
    points=topology[name+'/raw_points'];off=topology[name+'/polygon_offsets'];ids=topology[name+'/polygon_vertices']
    found=[]
    for face in range(len(off)-1):
        polygon=points[ids[off[face]:off[face+1]]]
        if len(polygon)>4 and np.ptp(polygon[:,2])<EPS:found.append((face,float(polygon[:,2].mean())))
    return sorted(found,key=lambda x:x[1])


def cap_vertices(name,face,topology):
    parents=topology[name+'/rest_source_faces'];off=topology[name+'/rest_polygon_offsets'];ids=topology[name+'/rest_polygon_vertices']
    return np.unique(np.concatenate([ids[off[i]:off[i+1]] for i in np.flatnonzero(parents==face)]))


def boundary_edges(surface):
    uses=collections.Counter(tuple(sorted((int(a),int(b)))) for tri in surface['triangles'] for a,b in zip(tri,np.roll(tri,-1)))
    return np.asarray([edge for edge,count in uses.items() if count==1],dtype=np.int32).reshape((-1,2))


def endpoints(segments):
    vertices=[];edges=[];buckets={}
    def index(p):
        key=tuple(np.floor(p/EPS).astype(np.int64))
        for d in itertools.product((-1,0,1),repeat=3):
            for i in buckets.get(tuple(a+b for a,b in zip(key,d)),[]):
                if np.linalg.norm(vertices[i]-p)<=EPS:return i
        i=len(vertices);vertices.append(p);buckets.setdefault(key,[]).append(i);return i
    for a,b in segments:edges.append(tuple(sorted((index(a),index(b)))))
    degree=collections.Counter(i for edge in set(edges) if edge[0]!=edge[1] for i in edge)
    return np.asarray([vertices[i] for i,d in degree.items() if d!=2]).reshape((-1,3)),all(d in (1,2) for d in degree.values())


def rim_connections(world,collar):
    edge_ids=boundary_edges(collar);lines=collar['points'][edge_ids];axis=lines[:,1]-lines[:,0]
    lengths=np.einsum('ij,ij->i',axis,axis);records=[]
    for component in component_ids(world):
        points,regular=endpoints(world[component['indices']])
        distances=[]
        for p in points:
            t=np.divide(np.einsum('ij,ij->i',p-lines[:,0],axis),lengths,out=np.zeros_like(lengths),where=lengths>0)
            distances.append(float(np.linalg.norm(lines[:,0]+np.clip(t,0,1)[:,None]*axis-p,axis=1).min()) if len(lines) else float('inf'))
        valid=component['closed'] or (regular and len(points)==2 and max(distances,default=float('inf'))<=EPS)
        records.append(dict(**component,valid=bool(valid),rim_endpoint_distances=distances,world_endpoints=points.tolist()))
    return records


class CollarNeckClassifier:
    def __init__(self,topology,rest,primitives,rest_spine):
        self.topology,self.rest,self.primitives=topology,rest,primitives
        self.rest_spine=np.asarray(rest_spine)
        neck_caps=raw_caps('Natural neck',topology)
        if len(neck_caps)!=2:raise ValueError('Neck source closures are not the expected two caps')
        self.neck_caps=neck_caps
        self.base_ids=cap_vertices('Natural neck',neck_caps[0][0],topology)
        self.top_ids=cap_vertices('Natural neck',neck_caps[1][0],topology)
        collar_z=np.unique(np.round(topology['Collar stand/raw_points'][:,2],6))
        if len(collar_z)!=3:raise ValueError('Expected the three authored collar control rings')
        self.collar_levels=collar_z
        head=topology['Sculpted head/raw_points'];levels=np.unique(np.round(head[:,2],6));off=topology['Sculpted head/polygon_offsets'];ids=topology['Sculpted head/polygon_vertices']
        self.head_basal_faces={face for face in range(len(off)-1) if np.max(head[ids[off[face]:off[face+1]],2])<=levels[1]+EPS}

    def contact(self,first,second,a,b,pairs,snapshot,arrays,prefix):
        mapped,unresolved=mapped_segments(a,b,pairs,self.rest[first+'/points'],self.rest[second+'/points'],self.primitives)
        world=np.asarray([r[2] for r in mapped]).reshape((-1,2,3));local=np.asarray([[r[3],r[4]] for r in mapped]).reshape((-1,2,2,3))
        maps=[source_map(n,s['triangles'],self.topology) for n,s in ((first,a),(second,b))]
        faces=np.asarray([[maps[0][r[0]],maps[1][r[1]]] for r in mapped],dtype=np.int32).reshape((-1,2))
        for key,value in dict(pairs=np.asarray(pairs,dtype=np.int32),world_segments=world,source_segments=local,source_faces=faces).items():arrays[prefix+'/'+key]=value
        row=dict(kind='neck_collar_attachment',parts=[first,second],valid=False,unresolved=unresolved,witness=prefix,residuals={})
        if not len(mapped) or unresolved:return row
        parts={first:(a,0),second:(b,1)};key=frozenset((first,second));valid=[]
        if key==frozenset(('Natural neck','Sculpted head')):
            neck,ni=parts['Natural neck'];head,hi=parts['Sculpted head'];components=component_ids(world)
            basal=faces[:,ni]==self.neck_caps[0][0];head_band=np.asarray([int(i) in self.head_basal_faces for i in faces[:,hi]])
            base_w=np.asarray([solid_angle(neck['points'][i],head['points'],head['triangles']) for i in self.base_ids])
            top_w=np.asarray([solid_angle(neck['points'][i],head['points'],head['triangles']) for i in self.top_ids])
            arrays[prefix+'/neck_base_ids']=self.base_ids;arrays[prefix+'/neck_top_ids']=self.top_ids
            arrays[prefix+'/base_winding']=base_w;arrays[prefix+'/top_winding']=top_w
            closed=len(components)==1 and components[0]['closed']
            valid=[closed,not basal.any(),bool(head_band.all()),bool(np.all(np.abs(base_w)<.5)),bool(np.all(np.abs(top_w)>.5))]
            row.update(components=components,source_head_basal_faces=sorted(self.head_basal_faces),source_neck_basal_cap=self.neck_caps[0][0])
            row['residuals']=dict(closed_single_seam=closed,basal_cap_segments=int(basal.sum()),outside_basal_head_band=int((~head_band).sum()),
                                  basal_vertices_inside_head=int((np.abs(base_w)>.5).sum()),upper_vertices_outside_head=int((np.abs(top_w)<.5).sum()))
        elif key==frozenset(('Collar stand','Natural neck')):
            collar,ci=parts['Collar stand'];neck,ni=parts['Natural neck'];components=rim_connections(world,collar)
            spine_deform=np.asarray(snapshot['rig_matrix_world'])@np.asarray(snapshot['frames']['spine'])@np.linalg.inv(self.rest_spine)
            inverse=np.linalg.inv(spine_deform);p=neck['points']@inverse[:3,:3].T+inverse[:3,3]
            lower_clearance=float(self.collar_levels[0]-p[self.base_ids,2].max())
            upper_clearance=float(p[self.top_ids,2].min()-self.collar_levels[-1])
            caps=np.isin(faces[:,ni],[cap[0] for cap in self.neck_caps])
            valid=[bool(components) and all(c['valid'] for c in components),not caps.any(),lower_clearance>=-EPS,upper_clearance>=-EPS]
            row.update(components=components,source_collar_levels=self.collar_levels.tolist())
            row['residuals']=dict(neck_cap_segments=int(caps.sum()),base_below_collar_margin=lower_clearance,top_above_rim_margin=upper_clearance)
        elif key==frozenset(('Collar stand','Sculpted head')):
            collar,ci=parts['Collar stand'];head,hi=parts['Sculpted head'];components=rim_connections(world,collar)
            upper_band=np.min(local[:,ci,:,2],axis=1)>=self.collar_levels[1]-EPS
            head_band=np.asarray([int(i) in self.head_basal_faces for i in faces[:,hi]])
            valid=[bool(components) and all(c['valid'] for c in components),bool(upper_band.all()),bool(head_band.all())]
            row.update(components=components,source_collar_upper_band=[float(self.collar_levels[1]),float(self.collar_levels[2])])
            row['residuals']=dict(below_collar_upper_band=int((~upper_band).sum()),outside_basal_head_band=int((~head_band).sum()))
        row['valid']=bool(valid) and all(valid)
        row['classification']='source-continuous neck/collar join' if row['valid'] else 'invalid or unresolved neck/collar material continuity'
        return row
