"""Source-defined wrist material exits, including reversed-hand negative controls."""
import numpy as np
from sofa_coupled_contact_evaluator import SourceSurface, solid_angle
from sofa_coupled_contact_evaluator_v2 import component_ids
from sofa_contact_solver_evaluator import Evaluator
from sofa_coupled_contact_segments import mapped_segments
from classify_sofa_lap_contacts import source_map


def is_wrist(first, second):
    return first.startswith('Forearm with elbow and wrist sections') and second.startswith(('Relaxed palm','Resting thumb'))


def classify_wrist(first, second, world, local, faces, forearm, hand, topology, audit, rest):
    """A closed exit must stay on source faces incident to the matching hand band.

    The distal hand pole must remain outside the forearm. Mesh self-folds remain
    a separate mandatory scene gate; an attachment verdict never excuses them.
    """
    hand_groups=audit['saved_objects'][second]['groups']
    arm_groups=audit['saved_objects'][first]['groups']
    common=[g for g in hand_groups if g.startswith('hand.') and g in arm_groups]
    if len(common)!=1:raise ValueError('Ambiguous source hand ownership')
    group=common[0]
    hand_weights=topology[second+'/weights'][:,hand_groups.index(group)]
    if not np.all(np.abs(hand_weights-1.)<1e-8):raise ValueError('Source hand is not the verified rigid hand part')
    weights=topology[first+'/weights'][:,arm_groups.index(group)]
    offsets,vertices=topology[first+'/polygon_offsets'],topology[first+'/polygon_vertices']
    wrist_faces={index for index in range(len(offsets)-1)
                 if np.any(weights[vertices[offsets[index]:offsets[index+1]]]>1e-6)}
    components=component_ids(world)
    single_closed=len(components)==1 and components[0]['closed']
    face_membership=np.asarray([int(face) in wrist_faces for face in faces[:,0]])
    distal=int(np.argmin(rest[second+'/rest_points'][:,2]))
    solid=SourceSurface(forearm['points'],forearm['triangles'])
    if not solid.closed_oriented:raise ValueError('Wrist containment requires the verified closed forearm')
    winding=solid_angle(hand['points'][distal],forearm['points'],forearm['triangles'])
    distal_outside=abs(winding)<.5
    valid=single_closed and bool(np.all(face_membership)) and distal_outside
    return dict(valid=valid,classification='continuous source wrist exit' if valid else 'invalid or unresolved wrist exit',
                single_closed_boundary=single_closed,source_hand_group=group,
                source_wrist_faces=sorted(wrist_faces),outside_wrist_band=np.flatnonzero(~face_membership).tolist(),
                distal_source_vertex=distal,distal_world_point=hand['points'][distal].tolist(),
                distal_winding=winding,distal_outside=distal_outside,components=components,
                rule='Closed material boundary in matching source hand-weight incident forearm faces; distal hand pole outside; self-fold gate remains independent')


class WristEvaluator(Evaluator):
    def contact(self, seat, first, second, a, b, pairs, arrays, prefix):
        if not is_wrist(first,second):return super().contact(seat,first,second,a,b,pairs,arrays,prefix)
        mapped,unresolved=mapped_segments(a,b,pairs,self.rest[first+'/rest_points'],self.rest[second+'/rest_points'],self.primitives)
        world=np.asarray([r[2] for r in mapped]);local=np.asarray([[r[3],r[4]] for r in mapped])
        maps=[source_map(name,surface['triangles'],self.topology) for name,surface in ((first,a),(second,b))]
        faces=np.asarray([[maps[0][r[0]],maps[1][r[1]]] for r in mapped])
        verdict=classify_wrist(first,second,world,local,faces,a,b,self.topology,self.audit,self.rest)
        for key,value in dict(pairs=np.asarray(pairs,dtype=np.int32),world_segments=world,source_segments=local,source_faces=faces).items():arrays[prefix+'/'+key]=value
        valid=verdict['valid'] and not unresolved
        return dict(kind='arm_body',seat=seat,parts=[first,second],valid=valid,residual=0. if valid else float(len(mapped)+len(unresolved)),
                    unresolved=unresolved,witness=prefix,wrist=verdict)
