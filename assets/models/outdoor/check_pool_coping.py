"""Check the evaluated coping for a closed surface and a single upward-facing top."""
from collections import Counter
from itertools import combinations
import json
from pathlib import Path


def check_coping(solid):
    vertices = [tuple(p) for p in solid['vertices']]
    top = max(p[2] for p in vertices)
    faces = []
    edges = Counter()
    for i, indices in enumerate(solid['triangles']):
        triangle = [vertices[j] for j in indices]
        for a, b in zip(triangle, triangle[1:] + triangle[:1]):
            edges[a, b] += 1
        if all(p[2] == top for p in triangle):
            faces.append((i, triangle))

    # Blender exports binary floats, so a common power-of-two denominator gives exact 2D tests.
    denominator = max(c.as_integer_ratio()[1] for _, face in faces for p in face for c in p[:2])
    def integer(c):
        n, d = c.as_integer_ratio()
        return n * (denominator // d)
    flat = [(i, [(integer(x), integer(y)) for x, y, _ in face]) for i, face in faces]
    def area2(face):
        (ax, ay), (bx, by), (cx, cy) = face
        return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    def overlap(a, b):
        for face in (a, b):
            for p, q in zip(face, face[1:] + face[:1]):
                nx, ny = p[1] - q[1], q[0] - p[0]
                aa = [nx*x + ny*y for x, y in a]
                bb = [nx*x + ny*y for x, y in b]
                if max(aa) <= min(bb) or max(bb) <= min(aa):
                    return False
        return True
    bad = [i for i, face in flat if area2(face) <= 0]
    overlaps = [[i, j] for (i, a), (j, b) in combinations(flat, 2) if overlap(a, b)]
    closed = all(a != b and count == 1 and edges[b, a] == 1 for (a, b), count in edges.items())
    area = sum(area2(face) for _, face in flat) / (2 * denominator**2)
    return {'passed': closed and area > 0 and not bad and not overlaps,
            'closed': closed, 'topAreaM2': area, 'topTriangles': len(faces),
            'nonUpwardTopFaces': bad, 'overlappingTopPairs': overlaps}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('fixture', type=Path)
    args = parser.parse_args()
    fixture = json.loads(args.fixture.read_bytes())
    result = check_coping(next(s for s in fixture['solids'] if s['id'] == 'Pool stone coping'))
    print(json.dumps(result))
    raise SystemExit(0 if result['passed'] else 1)
