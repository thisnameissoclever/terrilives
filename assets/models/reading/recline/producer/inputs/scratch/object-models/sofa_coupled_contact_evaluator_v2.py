"""Anatomical contact regions and continuous articulated clothing exits.

No whole garment pair is exempt. A skin/clothing exit must be a connected
intersection component anchored to the source distal closure, remain below
the proximal attachment, and exclude the wrist. Exterior garment crossings
remain failures. Pose naturalness still requires diagnostic review.
"""
import itertools

import numpy as np

from sofa_coupled_contact_evaluator import EPS, scene_verdict


def component_ids(segments):
    points, buckets, edges = [], {}, []

    def vertex(point):
        key = tuple(np.floor(point/EPS).astype(np.int64))
        for delta in itertools.product((-1, 0, 1), repeat=3):
            for index in buckets.get(tuple(a+b for a, b in zip(key, delta)), []):
                if np.linalg.norm(points[index]-point) <= EPS:
                    return index
        index = len(points)
        points.append(point)
        buckets.setdefault(key, []).append(index)
        return index

    for segment in segments:
        edges.append((vertex(segment[0]), vertex(segment[1])))
    parent = list(range(len(points)))

    def root(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for a, b in edges:
        parent[root(b)] = root(a)
    components = {}
    for index, (a, b) in enumerate(edges):
        components.setdefault(root(a), []).append(index)
    result = []
    for indices in components.values():
        degree = {}
        unique = set()
        for index in indices:
            a, b = edges[index]
            edge = tuple(sorted((a,b)))
            if a==b or edge in unique:
                continue
            unique.add(edge)
            degree[a] = degree.get(a, 0)+1
            degree[b] = degree.get(b, 0)+1
        result.append(dict(indices=indices, closed=bool(degree) and all(value==2 for value in degree.values()),
                           boundary_vertices=sum(value!=2 for value in degree.values())))
    return result


def closures(name, topology):
    """Read actual planar source closure polygons, rather than naming mesh pairs."""
    points = topology[name+'/raw_points']
    offsets, vertices = topology[name+'/polygon_offsets'], topology[name+'/polygon_vertices']
    caps = []
    for face in range(len(offsets)-1):
        polygon = points[vertices[offsets[face]:offsets[face+1]]]
        if len(polygon)>4 and np.ptp(polygon[:, 2])<EPS:
            caps.append((face, float(polygon[:, 2].mean())))
    if len(caps)!=2:
        raise ValueError('Expected the verified sleeve or cuff pair of source closures: '+name)
    caps.sort(key=lambda value: value[1])
    return caps


def classify_case(first, second, world_segments, source_segments, source_faces, prior, topology, audit):
    base = lambda name: name.removesuffix('.001')
    a, b = base(first), base(second)
    result = [dict(row) for row in prior]
    if b=='One sewn breast pocket' or (a=='Turned sleeve cuff' and b=='Overshirt body'):
        return result, []
    if a=='Relaxed shirt sleeve' and b=='Overshirt body':
        groups = audit['saved_objects'][first]['groups']
        weights = topology[first+'/weights']
        spine = groups.index('spine')
        raw = topology[first+'/raw_points']
        # The actual saved source identifies its proximal torso attachment.
        # A boundary face may interpolate zero weight at its lower edge, so use
        # the authored transition start, verified by build_rig.py and the rows.
        if not np.any(weights[:, spine]>0):
            raise ValueError('Missing source shoulder blend')
        attachment_start = 1.26
        for index, (arm, shirt) in enumerate(source_segments):
            if np.min(arm[:, 2])>=attachment_start-EPS and np.min(shirt[:, 2])>=attachment_start-EPS:
                result[index] = dict(valid=True, classification='proximal shoulder attachment',
                                     reason='Both material witnesses stay in the source-defined spine/upper-arm attachment region')
            elif not result[index]['valid']:
                result[index] = dict(valid=False, classification='unresolved shoulder exterior',
                                     reason='Outside demonstrated proximal attachment; no whole sleeve/shirt exemption')
        return result, []
    if a=='Forearm with elbow and wrist sections' and b in ('Relaxed shirt sleeve', 'Turned sleeve cuff'):
        cap_rows = closures(second, topology)
        distal, proximal = cap_rows[0][0], cap_rows[1][0]
        components = []
        for component in component_ids(world_segments):
            indices = component['indices']
            skin = source_segments[indices, 0]
            garment = source_segments[indices, 1]
            faces = source_faces[indices, 1]
            anchored = bool(np.any(faces==distal))
            reaches_shoulder = bool(np.max(garment[:, :, 2])>=1.26-EPS) if b=='Relaxed shirt sleeve' else False
            reaches_wrist = bool(np.min(skin[:, :, 2])<=.835+EPS)
            # A cuff's upper closure is inside the sleeve; it alone cannot
            # establish a distal exit, but may join the same articulated loop.
            valid = anchored and component['closed'] and not reaches_shoulder and not reaches_wrist
            components.append(dict(indices=indices, distal_cap=distal, proximal_cap=proximal,
                                   anchored=anchored, reaches_shoulder=reaches_shoulder, reaches_wrist=reaches_wrist,
                                   closed=component['closed'], boundary_vertices=component['boundary_vertices'],
                                   valid=valid, source_bounds=[skin.reshape(-1,3).min(0).tolist(),skin.reshape(-1,3).max(0).tolist()]))
            if valid:
                for index in indices:
                    result[index] = dict(valid=True, classification='continuous articulated distal exit',
                                         reason='Intersection component joins the source distal garment closure and stays away from the shoulder and wrist')
        return result, components
    return result, []
