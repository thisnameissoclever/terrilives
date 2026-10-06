"""Closed convex enclosure certificates for opaque, non-solid shower coverage."""
import math


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def subtract(a, b):
    return tuple(x-y for x, y in zip(a, b))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def finite_points(points):
    return bool(points) and all(len(p) == 3 and all(math.isfinite(v) for v in p) for p in points)


def certify_convex(vertices, triangles, points, required_margin):
    if not finite_points(vertices) or not finite_points(points) or not triangles or not (
            math.isfinite(required_margin) and required_margin > 0):
        raise ValueError('Convex enclosure evidence must be complete, finite and positive')
    center = tuple(sum(p[i] for p in vertices)/len(vertices) for i in range(3))
    edges, planes = {}, []
    for index, triangle in enumerate(triangles):
        if len(triangle) != 3 or len(set(triangle)) != 3 or any(
                not isinstance(i, int) or not 0 <= i < len(vertices) for i in triangle):
            raise ValueError('Invalid convex enclosure triangle')
        a, b, c = [vertices[i] for i in triangle]
        raw = cross(subtract(b, a), subtract(c, a))
        length = math.sqrt(dot(raw, raw))
        if length < 1e-12:
            raise ValueError('Convex enclosure has a degenerate triangle')
        normal = tuple(v/length for v in raw)
        offset = dot(normal, a)
        if offset-dot(normal, center) <= 1e-8:
            raise ValueError('Convex enclosure planes are not outward')
        if any(dot(normal, v)-offset > 1e-7 for v in vertices):
            raise ValueError('Enclosure is not convex or contains an open gap deformation')
        planes.append(dict(triangle=index, normal=list(normal), offset=offset))
        for first, second in zip(triangle, triangle[1:]+triangle[:1]):
            edges.setdefault(tuple(sorted((first, second))), []).append((first, second, index))
    if any(len(uses) != 2 or uses[0][:2] != tuple(reversed(uses[1][:2])) for uses in edges.values()):
        raise ValueError('Convex enclosure is not closed with consistent edge winding')
    neighbors = {i:set() for i in range(len(triangles))}
    for uses in edges.values():
        first, second = uses[0][2], uses[1][2]
        neighbors[first].add(second)
        neighbors[second].add(first)
    visited, frontier = {0}, {0}
    while frontier:
        following = set().union(*(neighbors[i] for i in frontier))-visited
        visited |= following
        frontier = following
    if len(visited) != len(triangles):
        raise ValueError('Convex enclosure is not one closed connected surface')
    margins = [min(plane['offset']-dot(plane['normal'], point) for plane in planes) for point in points]
    minimum = min(margins)
    if minimum <= 0 or minimum < required_margin:
        raise ValueError(f'Positive convex clothing containment failed: minimum={minimum}, required={required_margin}')
    return dict(closed=True, convex=True, outward_planes=True, connected=True,
                vertices=len(vertices), triangles=len(triangles), certified_points=len(points),
                min_containment_margin=minimum, required_margin=required_margin,
                minimum_margin_point_id=margins.index(minimum), plane_inventory=planes,
                whole_triangle_guarantee='All clothing vertices lie strictly inside every outward plane; convexity encloses every complete triangle.')


def enclosing_prism(points, floor_planes, floor_z):
    if not finite_points(points) or not floor_planes or not math.isfinite(floor_z):
        raise ValueError('Measured clothing and floor planes must be finite and complete')
    floor_clearance = min(plane['offset']-dot(plane['normal'], point)
                          for point in points for plane in floor_planes)
    minimum_z, maximum_z = min(p[2] for p in points), max(p[2] for p in points)
    floor_gap = minimum_z-floor_z
    margin = min(.004, floor_clearance*.25, floor_gap*.25)
    if margin <= 1e-5:
        raise ValueError('No positive convex clothing envelope fits above the actual floor and inside its XY domain')
    def turn(o, a, b):
        return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    ordered = sorted({tuple(p[:2]) for p in points})
    hull = []
    for sequence in (ordered, list(reversed(ordered))):
        half = []
        for point in sequence:
            while len(half) >= 2 and turn(half[-2], half[-1], point) <= 1e-12:
                half.pop()
            half.append(point)
        hull += half[:-1]
    if len(hull) < 3:
        raise ValueError('Measured clothing footprint has no finite area')
    edges = []
    for first, second in zip(hull, hull[1:]+hull[:1]):
        dx, dy = second[0]-first[0], second[1]-first[1]
        length = math.hypot(dx, dy)
        normal = (dy/length, -dx/length)
        edges.append((normal, dot(normal, first)+margin))
    footprint = []
    for previous, current in zip(edges[-1:]+edges[:-1], edges):
        (a, b), first = previous
        (c, d), second = current
        determinant = a*d-b*c
        if abs(determinant) < 1e-12:
            raise ValueError('Offset clothing hull has parallel adjacent planes')
        footprint.append(((first*d-b*second)/determinant, (a*second-first*c)/determinant))
    bottom, top = minimum_z-margin, maximum_z+margin
    vertices = [(x, y, z) for z in (bottom, top) for x, y in footprint]
    actual_clearance = min(plane['offset']-dot(plane['normal'], p)
                           for p in vertices for plane in floor_planes)
    if actual_clearance <= 0 or bottom <= floor_z:
        raise ValueError('Buffered convex core cannot fit the actual evaluated tray floor domain')
    n = len(footprint)
    triangles = [(0, i+1, i) for i in range(1, n-1)]
    triangles += [(n, n+i, n+i+1) for i in range(1, n-1)]
    for i in range(n):
        j = (i+1)%n
        triangles += [(i, j, n+j), (i, n+j, n+i)]
    proposal = dict(measured_clothing_min_z=minimum_z, measured_clothing_max_z=maximum_z,
                    measured_floor_z=floor_z, measured_clothing_xy_clearance=floor_clearance,
                    measured_sole_floor_gap=floor_gap, construction_margin=margin,
                    required_margin=margin*.98, bottom_z=bottom, top_z=top,
                    actual_floor_xy_clearance=actual_clearance,
                    construction='Convex XY clothing hull, outward edge-plane offset, measured buffered Z caps')
    certify_convex(vertices, triangles, points, proposal['required_margin'])
    return vertices, triangles, proposal
