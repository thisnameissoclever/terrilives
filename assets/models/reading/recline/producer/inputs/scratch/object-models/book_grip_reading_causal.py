"""Measure named reference material witnesses on both actual evaluated snapshots."""
import numpy as np
from sofa_coupled_contact_evaluator import solid_angle,nearest_distance


def compare(reference,proposal,reference_result,reference_arrays,context,arrays):
    rows=[]
    # This material vertex was outside the original head and 68.361 mm inside
    # ALT2. Follow its actual evaluated position; never rigidly rotate a blend.
    part='Folded fabric collar leaf';index=4;target='Sculpted head'
    values={}
    for label,snapshot in (('reference',reference),('proposal',proposal)):
        point=snapshot['surfaces'][part].points[index];solid=snapshot['surfaces'][target]
        if not solid.closed:raise ValueError('Named collar witness needs a closed oriented head')
        winding=solid_angle(point,solid.points,solid.triangles);distance=nearest_distance(point,solid.points,solid.triangles)
        values[label]=dict(point=point.tolist(),winding=winding,signed_clearance=-distance if abs(winding)>.5 else distance)
    rows.append(dict(kind='closed_head_clearance',material_part=part,vertex=index,target=target,values=values,
                     change=values['proposal']['signed_clearance']-values['reference']['signed_clearance'],
                     meaning='Positive change moves this actual material witness toward head separation; the full gate must still pass'))
    for first,second in (('Forearm with elbow and wrist sections.001','Overshirt body'),('Turned sleeve cuff.001','Overshirt body')):
        result=next(r for r in reference_result['rows'] if r['kind']=='arm_body' and r.get('parts')==[first,second])
        prefix=result['witness'];pairs=reference_arrays[prefix+'/pairs'];world=reference_arrays[prefix+'/world_segments']
        invalid=result.get('invalid_segments',[]);records=[]
        a=reference['surfaces'][first];b=reference['surfaces'][second];pa=proposal['surfaces'][first];pb=proposal['surfaces'][second]
        for i in invalid:
            ai,bi=pairs[i];av,bv=a.triangles[ai],b.triangles[bi];point=world[i].mean(0)
            wa=context.primitives['barycentric'](point,a.points[av]);wb=context.primitives['barycentric'](point,b.points[bv])
            first_new=wa@pa.points[av];second_new=wb@pb.points[bv]
            triangle=pb.points[bv];normal=np.cross(triangle[1]-triangle[0],triangle[2]-triangle[0]);normal/=np.linalg.norm(normal)
            records.append([i,*point,*first_new,*second_new,*normal,float((first_new-second_new)@normal)])
        key='causal/'+first+'/'+second;value=np.asarray(records).reshape((-1,14));arrays[key]=value
        rows.append(dict(kind='transported_source_material_separation',parts=[first,second],anchors=len(records),witness=key,
            minimum_local_outward_change=float(value[:,-1].min()) if len(value) else None,
            maximum_local_outward_change=float(value[:,-1].max()) if len(value) else None,
            meaning='Reference barycentric material anchors evaluated on proposal vertex positions, projected on the current local shirt normal. This is not a global inside test for an open shirt; independent complete contact classification remains decisive.'))
    return rows
