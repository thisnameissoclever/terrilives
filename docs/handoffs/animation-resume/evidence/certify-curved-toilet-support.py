"""Replay actual captured hip/seat facets against proposed mirrored cell unions."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT/'assets/models/bathroom/actions'))
from contact_surface import certify_cell, connected_regions

source = ROOT/'assets/models/bathroom/actions/review/toilet/contact-facets-01/proof.json'
capture = json.loads(source.read_text())
if capture['state'] != 'complete' or not capture['immutable_inputs_preserved']:
    raise ValueError('Contact capture is incomplete')


def facets(surface, positive):
    result = []
    for indices in surface['triangles']:
        a, b, c = [surface['vertices'][i] for i in indices]
        normal_z = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
        if (normal_z > 0 if positive else normal_z < 0):
            result.append((a, b, c))
    return result


results = []
step = .003
for case in capture['cases']:
    body, seat = facets(case['hip'], False), facets(case['seat'], True)
    requested = set(tuple(cell) for region in case['proposed_regions'] for cell in region['cell_indices'])
    cells, failures, certificates = {}, Counter(), []
    for ix, iy in sorted(requested):
        pair = []
        for x in (ix, -ix-1):
            bounds = (x*step, -.1+iy*step, (x+1)*step, -.1+(iy+1)*step)
            try:
                proof = certify_cell(bounds, body, seat)
                pair.append(proof)
            except ValueError as failure:
                failures[str(failure)] += 1
                break
        if len(pair) == 2:
            cells[ix, iy] = min(p['area'] for p in pair)
            certificates.append(dict(cell=[ix, iy], mirrored_pair=pair))
    regions = connected_regions(cells, step)
    eligible = [r for r in regions if r['area'] >= .0007 and r['width'] >= .015 and r['depth'] >= .035]
    result = dict(hip_y=case['hip_y'], pelvic_pitch_degrees=case['pelvic_pitch_degrees'],
        proposed_height_delta=case['proposed_height_delta'], requested_cells=len(requested), certified_cells=len(cells),
        failed_cell_reasons=dict(failures), regions=regions, eligible_regions=eligible,
        continuous_cell_certificates=certificates, complete_pose_accepted=False)
    results.append(result)
    print(json.dumps({key:result[key] for key in ('hip_y', 'pelvic_pitch_degrees', 'requested_cells',
                    'certified_cells', 'failed_cell_reasons')} | {'eligible_areas':[r['area'] for r in eligible]}))
target = ROOT/'output/continuous-toilet-contact-diagnostic.json'
target.write_text(json.dumps(dict(mode='actual-surface-certificate-diagnostic-not-full-pose-acceptance',
    source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(), results=results), indent=2, allow_nan=False)+'\n')
