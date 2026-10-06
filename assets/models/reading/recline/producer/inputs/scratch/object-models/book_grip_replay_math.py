"""Shared numerical checks for the frozen original-source grip replay."""
import collections
import numpy as np


def triangle_box_hits(triangles, center, axes, half):
    tri = (triangles - center) @ axes
    interior = half - 1e-6
    ids = np.flatnonzero(np.all(tri.min(1) <= interior, axis=1) & np.all(tri.max(1) >= -interior, axis=1))
    t = tri[ids]
    if not len(ids):
        return ids
    edges = np.roll(t, -1, axis=1) - t
    directions = [np.cross(edges[:, 0], edges[:, 1])]
    for axis in np.eye(3):
        directions.extend(np.cross(edges[:, edge], axis) for edge in range(3))
    valid = np.ones(len(ids), dtype=bool)
    for axis in directions:
        projection = np.einsum('nvi,ni->nv', t, axis)
        radius = np.abs(axis) @ interior
        valid &= (projection.min(1) <= radius) & (projection.max(1) >= -radius)
    return ids[valid]


def box(surface):
    p, triangles = np.asarray(surface.points), np.asarray(surface.triangles)
    center = p.mean(0)
    _, axes = np.linalg.eigh(np.cov(p.T))
    local = (p - center) @ axes
    half = np.max(np.abs(local), axis=0)
    residual = float(np.max(np.abs(np.abs(local) - half)))
    closed = all(surface.topology[key] == 0 for key in ('boundary_edges', 'nonmanifold_edges', 'inconsistent_edges'))
    if len(p) != 8 or len(triangles) != 12 or not closed or residual > 1e-6:
        raise ValueError('A rendered book component is not the expected closed rectangular solid')
    return center, axes, half, dict(vertices=len(p), triangles=len(triangles), closed=True, corner_residual=residual,
        center=center.tolist(), axes=axes.tolist(), half_extents=half.tolist())


def margin_controls():
    result = {}
    for name, depth in (('separated', -.001), ('exact_touch', 0.), ('half_micrometre', .5e-6), ('one_and_half_micrometres', 1.5e-6)):
        tri = np.asarray([[[-.2, 0., 1-depth], [.2, 0., 1-depth], [0., .2, 1-depth]]])
        result[name] = bool(len(triangle_box_hits(tri, np.zeros(3), np.eye(3), np.ones(3))))
    assert result == dict(separated=False, exact_touch=False, half_micrometre=False, one_and_half_micrometres=True)
    result['crossing_without_inside_vertex'] = bool(len(triangle_box_hits(np.asarray([[[-2., 0., 0.], [2., 0., 0.], [0., 2., 0.]]]), np.zeros(3), np.eye(3), np.ones(3))))
    assert result['crossing_without_inside_vertex']
    return result


def array_digest(array):
    import hashlib
    a = np.asarray(array)
    return hashlib.sha256(str(a.shape).encode() + str(a.dtype).encode() + a.tobytes()).hexdigest()
