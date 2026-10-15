"""Check runtime-position witnesses against immutable fixture surfaces in Blender."""
from array import array
import json
import hashlib
from pathlib import Path
import sys
import traceback

from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[3]
WITNESS = ROOT / '.superpowers/sdd/2026-10-12-character-appearance-proof/contact'
REPORT = ROOT / 'docs/evidence/2026-10-12-character-appearance/contacts.json'
sys.path.insert(0, str(BASE.parents[1] / 'living'))
from armchair_support import contact_footprint


def floats(path):
    values = array('f'); values.frombytes(path.read_bytes()); return values


def build_part(part, positions, indices):
    selected = indices[part['start']:part['start']+part['count']]
    unique = sorted(set(selected)); mapping = {v: i for i, v in enumerate(unique)}
    points = [Vector(positions[i*3:i*3+3]) for i in unique]
    triangles = [tuple(mapping[j] for j in selected[i:i+3]) for i in range(0, len(selected), 3)]
    bounds = [[min(p[i] for p in points) for i in range(3)], [max(p[i] for p in points) for i in range(3)]]
    return points, BVHTree.FromPolygons(points, triangles, all_triangles=True), bounds


def run():
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(dict(state='running')))
    inputs = json.loads((WITNESS/'inputs.json').read_text())
    for path, expected in inputs.items():
        if hashlib.sha256((ROOT/path).read_bytes()).hexdigest() != expected:
            raise ValueError('Contact witness is stale: '+path)
    manifest = json.loads((BASE/'export-v2/manifest.json').read_text())
    indices = array('I'); indices.frombytes((BASE/'export-v2'/manifest['runtime']['indices']).read_bytes())
    values = manifest['fixtureBasis']
    fixture_inverse = Matrix([[values[column*4+row] for column in range(4)] for row in range(4)]).inverted()
    cases = json.loads((WITNESS/'cases.json').read_text())
    first = floats(WITNESS/cases[0]['file'])
    fixtures = {p['name']: build_part(p, first, indices) for p in manifest['runtime']['parts'] if p['region'] == 10}
    results = []
    for case in cases:
        positions = floats(WITNESS/case['file'])
        overlaps, support, soles, hands = [], None, {}, {}
        back = None
        surfaces = {}
        for part in manifest['runtime']['parts']:
            region = part['region']
            if region == 10 or (region == 8 and case['appearance']['hairstyle']=='bob') or (region == 9 and case['appearance']['hairstyle']=='curl'):
                continue
            points, tree, bounds = build_part(part, positions, indices)
            surfaces[part['name']] = (points, tree, bounds)
            for name, (fixture_points, fixture, box) in fixtures.items():
                if any(bounds[1][i] < box[0][i] or box[1][i] < bounds[0][i] for i in range(3)):
                    continue
                crossings = tree.overlap(fixture)
                if crossings:
                    depths = []
                    for point in points:
                        closest, normal, _, distance = fixture.find_nearest(point)
                        if closest is not None and (point-closest).dot(normal) < -1e-5:
                            depths.append(distance)
                    overlaps.append(dict(body=part['name'], fixture=name, trianglePairs=len(crossings),
                                         penetratingVertices=len(depths), maxVertexPenetration=max(depths, default=0)))
                else:
                    for point in points:
                        closest, normal, _, distance = fixture.find_nearest(point)
                        if closest is not None and distance > 1e-5 and (point-closest).dot(normal) < -1e-5:
                            overlaps.append(dict(body=part['name'], fixture=name, containment=list(point)))
                            break
            if part['name']=='Trouser hip bridge':
                seat = fixtures['Seat cushion'][1]
                gaps, near = [], []
                for point in points:
                    hit, _, _, _ = seat.ray_cast(Vector((point.x, point.y, 4)), Vector((0, 0, -1)))
                    if hit is not None:
                        gap = point.z-hit.z; gaps.append(gap)
                        if 0 <= gap <= .01: near.append(point)
                support = dict(minGap=min(gaps) if gaps else None, rayHits=len(gaps))
                try:
                    support['footprint'] = contact_footprint([fixture_inverse@p for p in near])
                    support['basis'] = 'chair-local; unchanged source thresholds'
                    support['finiteSupport'] = True
                except ValueError as error:
                    support['finiteSupport'] = False; support['supportError'] = str(error)
            if part['name'].startswith('Fitted rounded shoe sole'):
                soles[part['name']] = bounds[0][2]
        if 'Overshirt body' in surfaces:
            back_tree = fixtures['Back cushion'][1]
            candidates = [back_tree.find_nearest(p) for p in surfaces['Overshirt body'][0]]
            gaps = [r[3] for r in candidates if r[0] is not None]
            back = dict(minSurfaceDistance=min(gaps) if gaps else None,
                        contactWithinExistingNearGap=bool(gaps and min(gaps) <= .01))
        books = [surface[1] for name, surface in surfaces.items() if name.startswith('Reading book')]
        for name, (points, _, _) in surfaces.items():
            if not name.startswith('Relaxed palm'):
                continue
            distances = [min((hit[3] for tree in books if (hit := tree.find_nearest(point))[0] is not None), default=1000.) for point in points]
            hands[name] = dict(minSurfaceDistance=min(distances), nearVertices=sum(d <= .01 for d in distances),
                               contactWithinExistingNearGap=min(distances) <= .01)
        passed = (not overlaps and support is not None and support['minGap'] is not None and support['finiteSupport']
                  and 0 <= support['minGap'] <= .003 and len(soles)==2
                  and all(.018 <= z <= .020 for z in soles.values()))
        results.append(dict(**case, basicSupportPassed=passed, overlaps=overlaps, hipSupport=support, soleHeights=soles,
                            backSupport=back, hands=hands))
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    hand_contact = lambda row: len(row['hands']) == 2 and all(h['contactWithinExistingNearGap'] for h in row['hands'].values())
    REPORT.write_text(json.dumps(dict(state='complete', inputHashes=inputs, cases=len(results),
        basicSupportPassed=sum(r['basicSupportPassed'] for r in results),
        collisionFreeCases=sum(not r['overlaps'] for r in results),
        handBookProximityCases=sum(hand_contact(r) for r in results),
        gatePassed=all(r['basicSupportPassed'] and hand_contact(r) for r in results),
        gateScope='Seated fixture clearance, finite hip support, source sole registration and hand/book proximity. Back distance is diagnostic for the owner-accepted forward-leaning pose.',
        supplementalEvidence=['Continuous motion, world picking and cleanup: motion-browser.json',
                              'Joint continuity, limb lengths and book grips: character-motion.test.ts',
                              'Actual sampled transition frames and joined reading animations'],
        penetrationScope='Maximum sampled vertex penetration is not an upper bound over triangle interiors.',
        checks='Full runtime triangle crossing/containment against fixture; finite hip footprint and minimum gap 0..0.003; sole clearance 0.018..0.020; back/hand distance witnesses. No tolerance increase.', results=results), indent=2))


if __name__=='__main__':
    try:
        run()
    except Exception:
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        REPORT.write_text(json.dumps(dict(state='failed', error=traceback.format_exc()), indent=2)); raise
