"""Read-only cell-area diagnostic; existing rectangular acceptance stays unchanged."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT/'assets/models/bathroom/actions'))
from toilet_pose_geometry import on_ring

source = ROOT/'assets/models/bathroom/actions/review/toilet/support-search-01/proof.json'
proof = json.loads(source.read_text())
results = []
step = .003
for case in proof['cases']:
    original = {(round(p['x']/step), round((p['y']+.1)/step)):p for p in case['grid']}
    minimum = min(p['gap'] for p in case['grid'])
    for nearest in (0, .001, .002, .003):
        delta = nearest-minimum
        near = {key for key, p in original.items() if 0 <= p['gap']+delta <= .01}
        cells = set()
        for ix, iy in sorted(near):
            if ix*step < .08:
                continue
            corners = [(x, y) for x in (ix, ix+1) for y in (iy, iy+1)]
            if not all((x, y) in near and (-x, y) in near for x, y in corners):
                continue
            low_x, high_x = ix*step, (ix+1)*step
            low_y, high_y = -.1+iy*step, -.1+(iy+1)*step
            closest_y = max(low_y, min(-.1, high_y))
            if (all(on_ring(x, y) for x in (low_x, high_x) for y in (low_y, high_y))
                    and on_ring(low_x, closest_y)):
                cells.add((ix, iy))
        components = []
        remaining = set(cells)
        while remaining:
            first = min(remaining)
            component, frontier = {first}, {first}
            while frontier:
                adjacent = {(x+dx, y+dy) for x, y in frontier for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))}
                following = (adjacent & cells)-component
                component |= following
                frontier = following
            remaining -= component
            components.append(dict(cells=len(component), area=len(component)*step*step,
                width=(max(x for x, _ in component)-min(x for x, _ in component)+1)*step,
                depth=(max(y for _, y in component)-min(y for _, y in component)+1)*step,
                cell_indices=sorted(component)))
        results.append(dict(hip_y=case['hip_y'], pelvic_pitch_degrees=case['pelvic_pitch_degrees'],
            proposed_height_delta=delta, nearest_gap=nearest,
            components=sorted(components, key=lambda row:-row['area']),
            matches_existing_area_and_span_minima=any(c['area'] >= .0007 and c['width'] >= .015
                                                   and c['depth'] >= .035 for c in components)))
target = ROOT/'output/curved-toilet-support-diagnostic.json'
target.write_text(json.dumps(dict(mode='diagnostic-only-no-acceptance-contract-change', results=results), indent=2)+'\n')
print(json.dumps([dict(hip_y=r['hip_y'], pitch=r['pelvic_pitch_degrees'], nearest=r['nearest_gap'],
    largest_area=r['components'][0]['area'] if r['components'] else 0,
    eligible=r['matches_existing_area_and_span_minima']) for r in results if r['matches_existing_area_and_span_minima']], indent=2))
