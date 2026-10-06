"""Apply only the two cache-screened lap arm placements; preserve every other frame."""
import numpy as np


def construct(prior,rest,resting,grasp,reader_pitch):
    values=[];records=[]
    for seat,state in enumerate(prior):
        frames={n:np.asarray(m).copy() for n,m in state['bone_matrices'].items()}
        if seat in(0,2):
            selected=resting[seat]['selected']
            for name,matrix in selected['frames'].items():
                frames[name]=np.asarray(matrix)
            records.append(dict(seat=seat,parameters=selected['parameters'],cached_support_area=selected['support_area'],
                cached_support_cells=selected['support_cells'],cached_clearance=True,
                construction='Cache-screened actual normal-refitted supported hand and complete analytic arm frames'))
        values.append(frames)
    return values,records
