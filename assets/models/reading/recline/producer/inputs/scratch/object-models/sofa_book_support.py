"""Describe finite book/hand support patches and actual solid intersections."""
import numpy as np
from mathutils import Vector

from sofa_resting_hand_solver import patch

NEAR_GAP = .0015
NUMERICAL_EPS = .000001


def normals(surface):
    points = np.asarray(surface.points)
    triangles = np.asarray(surface.triangles)
    p = points[triangles]
    n = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
    vertex = np.zeros_like(points)
    for corner in range(3):
        np.add.at(vertex, triangles[:, corner], n)
    vertex /= np.maximum(np.linalg.norm(vertex, axis=1), 1e-15)[:, None]
    n /= np.maximum(np.linalg.norm(n, axis=1), 1e-15)[:, None]
    return n, vertex


def measure(owner, arrays):
    hands = [name for name in owner if name.startswith(('Relaxed palm', 'Resting thumb'))]
    books = [name for name in owner if name.startswith(('Reading book cover', 'Reading book pages'))]
    result = dict(near_gap=NEAR_GAP, numerical_plane_epsilon=NUMERICAL_EPS, books={}, pairs=[],
                  semantics='Record underside support and opposing grip/steadying patches; no mandatory thumb-distance rule')
    hand_normals = {name: normals(owner[name])[1] for name in hands}
    for book_name in books:
        book = owner[book_name]
        points = np.asarray(book.points)
        triangles = np.asarray(book.triangles)
        face_normals, _ = normals(book)
        origins = points[triangles[:, 0]]
        convex = bool(all(np.max((points - origin) @ normal) <= NUMERICAL_EPS for origin, normal in zip(origins, face_normals)))
        closed = all(book.topology[key] == 0 for key in ('boundary_edges', 'nonmanifold_edges', 'inconsistent_edges'))
        result['books'][book_name] = dict(closed=closed, convex_outward_planes=convex, topology=book.topology)
        for hand_name in hands:
            hand = owner[hand_name]
            hp = np.asarray(hand.points)
            distances_to_planes = (hp[:, None, :] - origins[None, :, :]) * face_normals[None, :, :]
            signed = distances_to_planes.sum(axis=2)
            inside = np.all(signed < -NUMERICAL_EPS, axis=1) if closed and convex else np.zeros(len(hp), dtype=bool)
            prefix = hand_name + '/' + book_name
            arrays[prefix + '/inside_vertices'] = np.flatnonzero(inside)
            crossings = hand.tree.overlap(book.tree)
            arrays[prefix + '/crossing_triangles'] = np.asarray(crossings, dtype=np.int32).reshape((-1, 2))
            groups = {}
            distances = []
            for index, point in enumerate(hand.points):
                nearest, normal, face, distance = book.tree.find_nearest(point)
                signed_gap = (point - nearest).dot(normal)
                alignment = float(hand_normals[hand_name][index] @ np.asarray(normal))
                distances.append([index, face, distance, signed_gap, alignment])
                if distance <= NEAR_GAP and signed_gap >= -NUMERICAL_EPS and alignment <= -.5:
                    key = tuple(np.round(np.asarray(normal), 5))
                    groups.setdefault(key, []).append(index)
            arrays[prefix + '/nearest_measurements'] = np.asarray(distances)
            planes = []
            for number, (normal, ids) in enumerate(groups.items()):
                footprint = patch(hp[ids], normal)
                arrays[prefix + f'/patch{number}_vertices'] = np.asarray(ids, dtype=np.int32)
                planes.append(dict(normal=list(normal), vertices=len(ids), footprint=footprint,
                    role='underside support' if normal[2] < -.5 else ('upper-face grip or steadying' if normal[2] > .5 else 'edge contact'),
                    finite_neighborhood=bool(footprint['area'] > 1e-10 and min(footprint['spans']) > 1e-6)))
            result['pairs'].append(dict(hand=hand_name, book=book_name, cache_prefix=prefix,
                actual_crossing_pairs=len(crossings), strictly_inside_book_vertices=int(inside.sum()),
                deepest_vertex_inside=float(np.max(np.min(-signed[inside], axis=1))) if np.any(inside) else 0.,
                planes=planes, status='Physical support/grip classification includes these patches and the separate penetration witnesses'))
    return result
