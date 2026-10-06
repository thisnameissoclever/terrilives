"""Conservative hand-centre search bounds, not a physical support predicate."""
import numpy as np


def centre_bounds(points,triangles,normal,palm_source):
    tri=np.asarray(points)[np.asarray(triangles)]
    normals=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0])
    ids=np.flatnonzero(normals@np.asarray(normal)>1e-14)
    if not len(ids):raise ValueError('No upper-facing support surface')
    radius=float(np.linalg.norm(palm_source-palm_source.mean(0),axis=1).max())
    upper=tri[ids].reshape(-1,3)
    return upper[:,:2].min(0)-radius-1e-6,upper[:,:2].max(0)+radius+1e-6,ids,radius
