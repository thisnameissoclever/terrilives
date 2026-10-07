"""Source-region attachment checks shared by cached controls and future pose evaluation.

This module classifies actual intersection segments. It does not infer a complete
scene pass from an incomplete set of contacts or from frame mathematics.
"""
import math

import numpy as np

EPS = 1e-6


def solid_angle(point, points, triangles):
    vectors = points[triangles] - point
    lengths = np.linalg.norm(vectors, axis=2)
    a, b, c = vectors[:, 0], vectors[:, 1], vectors[:, 2]
    numerator = np.einsum('ij,ij->i', a, np.cross(b, c))
    denominator = (np.prod(lengths, axis=1) + (a*b).sum(1)*lengths[:, 2]
                   + (b*c).sum(1)*lengths[:, 0] + (c*a).sum(1)*lengths[:, 1])
    return float(np.sum(2*np.arctan2(numerator, denominator))/(4*math.pi))


def nearest_distance(point, points, triangles):
    tri = points[triangles]
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    ab, ac = b-a, c-a
    normal = np.cross(ab, ac)
    norm2 = (normal*normal).sum(1)
    valid = norm2 > 1e-28
    n = normal[valid]
    signed = ((point-a[valid])*n).sum(1)/norm2[valid]
    projection = point-signed[:, None]*n
    first, second = ab[valid], ac[valid]
    offset = projection-a[valid]
    d00, d01, d11 = (first*first).sum(1), (first*second).sum(1), (second*second).sum(1)
    d20, d21 = (offset*first).sum(1), (offset*second).sum(1)
    denominator = d00*d11-d01*d01
    u = (d11*d20-d01*d21)/denominator
    v = (d00*d21-d01*d20)/denominator
    inside = (u >= -1e-10) & (v >= -1e-10) & (u+v <= 1+1e-10)
    distances = [np.linalg.norm(projection[inside]-point, axis=1)]
    for start, end in ((a, b), (b, c), (c, a)):
        axis = end-start
        length = (axis*axis).sum(1)
        t = np.divide(((point-start)*axis).sum(1), length, out=np.zeros_like(length), where=length>0)
        closest = start+np.clip(t, 0, 1)[:, None]*axis
        distances.append(np.linalg.norm(closest-point, axis=1))
    return float(min(x.min() for x in distances if len(x)))


def cuts(segment, points, triangles):
    """Every non-tangential segment/triangle crossing parameter."""
    origin, end = segment
    direction = end-origin
    tri = points[triangles]
    edge1, edge2 = tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0]
    h = np.cross(np.broadcast_to(direction, edge2.shape), edge2)
    det = (edge1*h).sum(1)
    valid = np.abs(det)>1e-14
    inverse = np.divide(1., det, out=np.zeros_like(det), where=valid)
    s = origin-tri[:, 0]
    u = inverse*(s*h).sum(1)
    q = np.cross(s, edge1)
    v = inverse*(q*direction).sum(1)
    t = inverse*(edge2*q).sum(1)
    valid &= (u>=-1e-9)&(v>=-1e-9)&(u+v<=1+1e-9)&(t>0)&(t<1)
    return sorted(set([0., 1., *t[valid].tolist()]))


class SourceSurface:
    def __init__(self, points, triangles):
        self.points, self.triangles = np.asarray(points), np.asarray(triangles)
        self.low, self.high = self.points.min(0), self.points.max(0)
        edges = {}
        for triangle in self.triangles:
            for a, b in zip(triangle, np.roll(triangle, -1)):
                edges.setdefault(tuple(sorted((int(a), int(b)))), []).append(1 if a<b else -1)
        self.closed_oriented = all(len(value)==2 and sum(value)==0 for value in edges.values())

    def contains_segment(self, segment):
        segment = np.asarray(segment)
        if np.any(segment<self.low-EPS) or np.any(segment>self.high+EPS):
            return False, 'outside source attachment bounds'
        if not self.closed_oriented:
            return False, 'unresolved open source region'
        divisions = cuts(segment, self.points, self.triangles)
        samples = [0., 1., *[(a+b)/2 for a, b in zip(divisions, divisions[1:])]]
        for t in samples:
            point = segment[0]+t*(segment[1]-segment[0])
            winding = abs(solid_angle(point, self.points, self.triangles))
            if winding < .5 and nearest_distance(point, self.points, self.triangles)>EPS:
                return False, 'outside original source overlap'
        return True, 'inside original source attachment overlap'


def anatomical_pair(first, second, groups):
    """Permit only demonstrated adjacent garment/limb joins, then check location."""
    base = lambda name: name.removesuffix('.001')
    a, b = base(first), base(second)
    allowed = {
        frozenset(('Relaxed shirt sleeve', 'Overshirt body')): 'spine',
        frozenset(('Relaxed shirt sleeve', 'Turned sleeve cuff')): 'upper_arm',
        frozenset(('Forearm with elbow and wrist sections', 'Relaxed shirt sleeve')): 'upper_arm',
        frozenset(('Forearm with elbow and wrist sections', 'Turned sleeve cuff')): 'upper_arm',
        frozenset(('Forearm with elbow and wrist sections', 'Relaxed palm')): 'hand',
        frozenset(('Forearm with elbow and wrist sections', 'Resting thumb')): 'hand',
        frozenset(('Relaxed palm', 'Resting thumb')): 'hand',
    }
    expected = allowed.get(frozenset((a, b)))
    common = set(groups[first]) & set(groups[second])
    return expected is not None and any(g==expected or g.startswith(expected+'.') for g in common)


def classify_segments(first, second, source_segments, source, groups):
    if not anatomical_pair(first, second, groups):
        return [dict(valid=False, classification='exterior crossing', reason='No demonstrated source anatomical attachment') for _ in source_segments]
    result = []
    for a, b in source_segments:
        first_ok, first_reason = source[second].contains_segment(a)
        second_ok, second_reason = source[first].contains_segment(b)
        overlap = first_ok and second_ok
        result.append(dict(valid=overlap, classification='source overlap control' if overlap else 'unresolved articulated attachment',
                           reasons=[first_reason, second_reason]))
    return result


def scene_verdict(contacts, unresolved, support, joints, folds, furniture, neighbors, complete):
    """One hard gate for controls, candidate selection and final geometry checks."""
    failures = []
    for name, items in [('contact', contacts), ('unresolved', unresolved), ('support', support),
                        ('joint', joints), ('fold', folds), ('furniture', furniture), ('neighbor', neighbors)]:
        failures.extend(dict(kind=name, witness=item) for item in items if not item.get('valid', False))
    if not complete:
        failures.append(dict(kind='incomplete', witness='Complete discovery and support evidence required'))
    return dict(valid=not failures, failures=failures)
