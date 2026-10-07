"""Clip evaluated triangle pairs to a continuous support-gap band."""
import numpy as np


def signed_area(poly):
    if len(poly) < 3:
        return 0.
    return float(sum(a[0] * b[1] - a[1] * b[0] for a, b in zip(poly, [*poly[1:], poly[0]])) / 2)


def clip(poly, coefficients):
    if not poly:
        return []
    result = []
    for a, b in zip(poly, [*poly[1:], poly[0]]):
        da = coefficients[0] * a[0] + coefficients[1] * a[1] + coefficients[2]
        db = coefficients[0] * b[0] + coefficients[1] * b[1] + coefficients[2]
        if da >= 0:
            result.append(a)
        if (da < 0) != (db < 0):
            result.append(a + (b - a) * da / (da - db))
    return result


def intersect(poly, triangle):
    for a, b in zip(triangle, np.roll(triangle, -1, axis=0)):
        edge = b - a
        poly = clip(poly, np.asarray([-edge[1], edge[0], edge[1] * a[0] - edge[0] * a[1]]))
        if not poly:
            break
    return poly


def projected(points, triangles, basis, facing):
    data = np.asarray(points) @ basis
    tri = data[np.asarray(triangles)]
    cross = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])[:, 2]
    ids = np.flatnonzero(cross * facing > 1e-14)
    tri = tri[ids].copy()
    if facing < 0:
        tri[:, [1, 2]] = tri[:, [2, 1]]
    matrices = np.concatenate((tri[:, :, :2], np.ones((len(tri), 3, 1))), axis=2)
    planes = np.linalg.solve(matrices, tri[:, :, 2, None])[:, :, 0]
    return dict(ids=ids, triangles=tri, planes=planes, low=tri[:, :, :2].min(1), high=tri[:, :, :2].max(1))


def hidden(poly, candidate_plane, own, candidate_index, upper):
    low, high = np.min(poly, axis=0), np.max(poly, axis=0)
    ids = np.flatnonzero(np.all(own['high'] >= low, axis=1) & np.all(own['low'] <= high, axis=1))
    for index in ids:
        if index == candidate_index:
            continue
        overlap = intersect(list(poly), own['triangles'][index, :, :2])
        if len(overlap) < 3 or abs(signed_area(overlap)) <= 1e-14:
            continue
        difference = own['planes'][index] - candidate_plane
        values = np.asarray(overlap) @ difference[:2] + difference[2]
        if (values.max() > 1e-8 if upper else values.min() < -1e-8):
            return True
    return False


def measure(hand_points, hand_triangles, support_points, support_triangles, normal, maximum_gap):
    normal = np.asarray(normal, dtype=np.float64)
    normal /= np.linalg.norm(normal)
    tangent = np.asarray([-1., 0., 0.])
    tangent -= normal * (normal @ tangent)
    if np.linalg.norm(tangent) < 1e-8:
        tangent = np.asarray([0., 1., 0.])
        tangent -= normal * (normal @ tangent)
    tangent /= np.linalg.norm(tangent)
    basis = np.column_stack((tangent, np.cross(normal, tangent), normal))
    hand = projected(hand_points, hand_triangles, basis, -1)
    support = projected(support_points, support_triangles, basis, 1)
    polygons, pairs, excluded = [], [], []
    for hi, triangle in enumerate(hand['triangles']):
        low, high = hand['low'][hi], hand['high'][hi]
        candidates = np.flatnonzero(np.all(support['high'] >= low, axis=1) & np.all(support['low'] <= high, axis=1))
        for si in candidates:
            poly = intersect(list(triangle[:, :2]), support['triangles'][si, :, :2])
            if len(poly) < 3 or abs(signed_area(poly)) <= 1e-14:
                continue
            gap = hand['planes'][hi] - support['planes'][si]
            poly = clip(poly, gap)
            poly = clip(poly, np.asarray([-gap[0], -gap[1], maximum_gap - gap[2]]))
            if len(poly) < 3 or abs(signed_area(poly)) <= 1e-14:
                continue
            pair = [int(hand['ids'][hi]), int(support['ids'][si])]
            if hidden(poly, hand['planes'][hi], hand, hi, False) or hidden(poly, support['planes'][si], support, si, True):
                excluded.append(pair)
                continue
            polygons.append(np.asarray(poly))
            pairs.append(pair)
    area = sum(abs(signed_area(list(poly))) for poly in polygons)
    vertices = np.concatenate(polygons) if polygons else np.empty((0, 2))
    return dict(projected_area=area, spans=np.ptp(vertices, axis=0).tolist() if len(vertices) else [0., 0.],
                certified_cells=len(polygons), occluded_or_ambiguous_cells=len(excluded),
                basis=basis, vertices=vertices, offsets=np.cumsum([0] + [len(poly) for poly in polygons], dtype=np.int32),
                pairs=np.asarray(pairs, dtype=np.int32).reshape((-1, 2)), excluded=np.asarray(excluded, dtype=np.int32).reshape((-1, 2)),
                contract='Continuous lower-hand/upper-support projected triangle overlap with gap in [0, maximum_gap]; ambiguous layered cells excluded conservatively')
