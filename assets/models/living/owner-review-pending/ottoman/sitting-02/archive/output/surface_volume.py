"""Closed-surface containment using signed solid angles, independent of Blender."""
import math


def subtract(a, b):
    return tuple(x-y for x, y in zip(a, b))


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def length(v):
    return math.sqrt(dot(v, v))


def on_triangle(point, triangle, epsilon=1e-8):
    a, b, c = triangle
    ab, ac, ap = subtract(b, a), subtract(c, a), subtract(point, a)
    normal = cross(ab, ac)
    if abs(dot(ap, normal)) > epsilon*length(normal):
        return False
    d00, d01, d11 = dot(ab, ab), dot(ab, ac), dot(ac, ac)
    d20, d21 = dot(ap, ab), dot(ap, ac)
    denominator = d00*d11-d01*d01
    u, v = (d11*d20-d01*d21)/denominator, (d00*d21-d01*d20)/denominator
    return u >= -epsilon and v >= -epsilon and u+v <= 1+epsilon


def interpolate(a, b, amount):
    return tuple(x+(y-x)*amount for x, y in zip(a, b))


def coplanar_segment(a, b, triangle, normal, epsilon):
    low, high = 0.0, 1.0
    for start, end in zip(triangle, triangle[1:]+triangle[:1]):
        edge = subtract(end, start)
        first = dot(cross(edge, subtract(a, start)), normal)
        last = dot(cross(edge, subtract(b, start)), normal)
        if first < -epsilon and last < -epsilon:
            return []
        if first < -epsilon:
            low = max(low, first/(first-last))
        elif last < -epsilon:
            high = min(high, first/(first-last))
        if low > high+epsilon:
            return []
    return [interpolate(a, b, low), interpolate(a, b, high)]


def triangle_contacts(first, second, epsilon=1e-7):
    points = []
    for edges, target in ((first, second), (second, first)):
        normal = cross(subtract(target[1], target[0]), subtract(target[2], target[0]))
        normal = tuple(value/length(normal) for value in normal)
        for a, b in zip(edges, edges[1:]+edges[:1]):
            start = dot(subtract(a, target[0]), normal)
            end = dot(subtract(b, target[0]), normal)
            if abs(start) <= epsilon and abs(end) <= epsilon:
                points.extend(coplanar_segment(a, b, target, normal, epsilon))
            elif abs(start-end) > epsilon:
                amount = start/(start-end)
                if -epsilon <= amount <= 1+epsilon:
                    point = interpolate(a, b, amount)
                    if on_triangle(point, target, epsilon):
                        points.append(point)
    return points


def unexpected_triangle_contact(points, first, second, epsilon=1e-7):
    """Allow only the common vertex or edge of adjacent mesh triangles."""
    common = sorted(set(first) & set(second))
    if len(common) == 3:
        return True
    contacts = triangle_contacts([points[i] for i in first], [points[i] for i in second], epsilon)
    for point in contacts:
        if not common:
            return True
        if len(common) == 1:
            if length(subtract(point, points[common[0]])) > epsilon:
                return True
        else:
            a, b = (points[i] for i in common)
            edge = subtract(b, a)
            amount = dot(subtract(point, a), edge)/dot(edge, edge)
            closest = interpolate(a, b, max(0, min(1, amount)))
            if length(subtract(point, closest)) > epsilon:
                return True
    return False


def boundary_edges(triangles):
    edges = {}
    for triangle in triangles:
        for a, b in zip(triangle, triangle[1:]+triangle[:1]):
            edges.setdefault(tuple(sorted((a, b))), []).append((a, b))
    if any(len(uses) > 2 for uses in edges.values()):
        raise ValueError('Nonmanifold boundary')
    return [uses[0] for uses in edges.values() if len(uses) == 1]


def cap_planar_loop(points, triangles, expected_boundary):
    """Close only an approved simple convex loop in a temporary analysis copy."""
    boundary = boundary_edges(triangles)
    if {tuple(sorted(edge)) for edge in boundary} != set(expected_boundary) or len(boundary) < 3:
        raise ValueError('Unexpected garment boundary')
    following = dict(boundary)
    if len(following) != len(boundary) or len(set(following.values())) != len(boundary):
        raise ValueError('Branching garment boundary')
    loop = [min(following)]
    for _ in range(len(boundary)-1):
        loop.append(following[loop[-1]])
    if len(set(loop)) != len(boundary) or following[loop[-1]] != loop[0]:
        raise ValueError('Garment boundary is not one closed loop')
    center = tuple(math.fsum(points[i][axis] for i in loop)/len(loop) for axis in range(3))
    vectors = [subtract(points[i], center) for i in loop]
    area_vectors = [cross(a, b) for a, b in zip(vectors, vectors[1:]+vectors[:1])]
    area = tuple(math.fsum(v[axis] for v in area_vectors) for axis in range(3))
    if length(area) < 1e-10:
        raise ValueError('Garment boundary has no finite area')
    normal = tuple(v/length(area) for v in area)
    if any(abs(dot(v, normal)) > 1e-6 for v in vectors):
        raise ValueError('Garment boundary is not planar')
    for index in range(len(loop)):
        a, b, c = [points[loop[(index+delta) % len(loop)]] for delta in range(3)]
        if dot(cross(subtract(b, a), subtract(c, b)), normal) <= 1e-12:
            raise ValueError('Garment boundary is not simple and convex')
        if any(dot(cross(subtract(b, a), subtract(points[other], a)), normal) < -1e-10
               for other in loop):
            raise ValueError('Garment boundary crosses its convex interior')
    # Reverse the inherited edge direction so the temporary cap closes it.
    capped_points = list(points)+[center]
    capped_faces = list(triangles)+[(b, a, len(points)) for a, b in boundary]
    return capped_points, capped_faces


class ClosedSurface:
    """An oriented triangulated shell; callers must check triangle crossings."""

    def __init__(self, points, triangles):
        self.points = tuple(tuple(p) for p in points)
        self.triangles = tuple(tuple(t) for t in triangles)
        if len(self.points) < 4 or any(len(p) != 3 or not all(math.isfinite(v) for v in p) for p in self.points):
            raise ValueError('A volume needs finite three-dimensional points')
        edges = {}
        neighbors = [set() for _ in self.triangles]
        for face, triangle in enumerate(self.triangles):
            if len(triangle) != 3 or len(set(triangle)) != 3 or any(
                    type(i) is not int or not 0 <= i < len(self.points) for i in triangle):
                raise ValueError('Invalid triangle indices')
            a, b, c = [self.points[i] for i in triangle]
            if length(cross(subtract(b, a), subtract(c, a))) <= 1e-12:
                raise ValueError('Degenerate triangle')
            for a, b in zip(triangle, triangle[1:]+triangle[:1]):
                edges.setdefault(tuple(sorted((a, b))), []).append((a, b, face))
        if not edges or any(len(uses) != 2 for uses in edges.values()):
            raise ValueError('Containment requires a closed surface')
        for uses in edges.values():
            (a, b, face), (c, d, other) = uses
            if (a, b) != (d, c):
                raise ValueError('Containment requires consistently oriented triangles')
            neighbors[face].add(other)
            neighbors[other].add(face)
        remaining = set(range(len(self.triangles)))
        self.components = []
        while remaining:
            pending = [min(remaining)]
            faces = set()
            while pending:
                face = pending.pop()
                if face in faces:
                    continue
                faces.add(face)
                pending.extend(neighbors[face] - faces)
            remaining -= faces
            volume = math.fsum(dot(self.points[a], cross(self.points[b], self.points[c]))
                               for face in faces for a, b, c in [self.triangles[face]])/6
            if abs(volume) <= 1e-12:
                raise ValueError('Closed component has no volume')
            self.components.append(tuple(sorted(faces)))
        self.low = tuple(min(p[i] for p in self.points) for i in range(3))
        self.high = tuple(max(p[i] for p in self.points) for i in range(3))

    def enclosed_components(self, other):
        """Use after excluding surface crossings between these two volumes."""
        return [index for index, component in enumerate(self.components)
                if other.contains(self.points[self.triangles[component[0]][0]])]

    def validate_self_intersections(self, candidate_pairs):
        for first, second in candidate_pairs:
            if first < second and unexpected_triangle_contact(
                    self.points, self.triangles[first], self.triangles[second]):
                raise ValueError(f'Self-intersecting surface triangles: {first}, {second}')

    def contains(self, point):
        if len(point) != 3 or not all(math.isfinite(v) for v in point):
            raise ValueError('Containment needs a finite point')
        if any(point[i] < self.low[i] or point[i] > self.high[i] for i in range(3)):
            return False
        angles = []
        for triangle in self.triangles:
            if on_triangle(point, [self.points[index] for index in triangle]):
                raise ValueError('Point lies on the volume boundary')
            a, b, c = [subtract(self.points[index], point) for index in triangle]
            la, lb, lc = length(a), length(b), length(c)
            numerator = dot(a, cross(b, c))
            denominator = la*lb*lc + dot(a, b)*lc + dot(b, c)*la + dot(c, a)*lb
            angles.append(2*math.atan2(numerator, denominator))
        winding = math.fsum(angles)/(4*math.pi)
        if abs(winding) < 1e-6:
            return False
        if abs(abs(winding)-1) < 1e-6:
            return True
        raise ValueError(f'Ambiguous surface winding: {winding}')
