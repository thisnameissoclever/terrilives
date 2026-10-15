"""Export exact mesh sections through the reported deepest sampled vertices."""
from array import array
import hashlib
import json
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[3]
sys.path.insert(0, str(BASE))
from check_contacts import build_part, floats

OUT = ROOT / 'docs/evidence/2026-10-12-character-appearance/intersections'
WITNESS = ROOT / '.superpowers/sdd/2026-10-12-character-appearance-proof/contact'


def section(part, positions, indices, axis, value):
    segments = []
    for start in range(part['start'], part['start'] + part['count'], 3):
        tri = [positions[i*3:i*3+3] for i in indices[start:start+3]]
        hits = []
        for a, b in zip(tri, tri[1:]+tri[:1]):
            da, db = a[axis]-value, b[axis]-value
            da = 0 if abs(da) < 1e-8 else da
            db = 0 if abs(db) < 1e-8 else db
            if da == 0:
                hits.append(list(a))
            if da * db < 0:
                t = da / (da-db)
                hits.append([a[k]+t*(b[k]-a[k]) for k in range(3)])
        unique = {tuple(round(c, 7) for c in p): p for p in hits}
        if len(unique) == 2:
            segments.append(list(unique.values()))
    return segments


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    inputs = json.loads((WITNESS/'inputs.json').read_text())
    for path, expected in inputs.items():
        assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest() == expected, path
    manifest = json.loads((BASE/'export-v2/manifest.json').read_text())
    indices = array('I')
    indices.frombytes((BASE/'export-v2'/manifest['runtime']['indices']).read_bytes())
    parts = {p['name']: p for p in manifest['runtime']['parts']}
    cases = {c['file']: c for c in json.loads((WITNESS/'cases.json').read_text())}
    rows = []
    for label, filename, body, fixture, axis in [
        ('seat', 'masculine-0-100-0.bin', 'Tailored trouser leg', 'Seat cushion', 0),
        ('arm', 'masculine-0-100-0.bin', 'Shirt lower hem', 'Arm right', 2),
        ('back', 'masculine-50-100-0.bin', 'Overshirt body', 'Back cushion', 0),
    ]:
        positions = floats(WITNESS/filename)
        points, body_tree, _ = build_part(parts[body], positions, indices)
        _, fixture_tree, _ = build_part(parts[fixture], positions, indices)
        inside = []
        for point in points:
            closest, normal, _, distance = fixture_tree.find_nearest(point)
            if (point-closest).dot(normal) < -1e-5:
                inside.append((distance, list(point), list(closest)))
        distance, point, closest = max(inside)
        value = point[axis]
        rows.append(dict(label=label, case=cases[filename], body=body, fixture=fixture,
            axis=axis, plane=value, depth=distance, point=point, closest=closest,
            trianglePairs=len(body_tree.overlap(fixture_tree)),
            bodySegments=section(parts[body],positions,indices,axis,value),
            fixtureSegments=section(parts[fixture],positions,indices,axis,value),
            witnessSha256=hashlib.sha256((WITNESS/filename).read_bytes()).hexdigest()))
    (OUT/'sections.json').write_text(json.dumps(dict(inputHashes=inputs, sections=rows),indent=2))
    print('Exported three measured mesh sections without modifying any source geometry.')


if __name__ == '__main__':
    run()
