"""Freeze post-comparison visibility, anatomy and preserved negative-control evidence."""
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0,str(Path(__file__).parent))
from book_grip_reading_view_area import project_mesh,area,subtract,near_clip
from continuous_support_patch import clip


def run(root,output):
    output.mkdir(parents=True,exist_ok=False)
    paths=[Path(__file__),root/'book_grip_reading_view_area.py',root/'continuous_support_patch.py',root/'book-grip-reading-compare-01/proof.json',
        root/'book-grip-reading-compare-01/writer-monitor.json',root/'book-grip-reading-view-area-01/proof.json',root/'book-grip-reading-view-area-01/visibility.npz',
        root/'book-grip-sleeve-fold-regions-01/proof.json',root/'book-grip-sleeve-fold-regions-01/witnesses.npz',root/'book-grip-sleeve-fold-controls-01/proof.json',
        root/'book-grip-sleeve-fold-controls-01/visibility.npz',root/'sofa-contact-solver-wrist-controls-01/proof.json',root/'sofa-hand-support-01/resting-geometry.npz']
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    comparison=json.loads(paths[3].read_text());views=json.loads(paths[5].read_text());regions=json.loads(paths[7].read_text());folds=json.loads(paths[9].read_text());negative=json.loads(paths[11].read_text())
    inputs=dict(comparison['inputs']);inputs.update(negative['inputs']);inputs.update(regions['inputs']);inputs.update(folds['inputs']);inputs.update(views['inputs'])
    for path in paths:inputs[str(path.resolve())]=digest(path)
    target=np.asarray([[-1.,-1.,2.],[1.,-1.,2.],[1.,1.,2.]])
    t=project_mesh(target,np.asarray([[0,1,2]]),np.zeros(3),np.eye(3),2.)[0][0]
    results={}
    for label,scale,expected in (('nearer_occluder',.5,0.),('farther_occluder',1.5,area(t[0]))):
        other=project_mesh(target*scale,np.asarray([[0,1,2]]),np.zeros(3),np.eye(3),2.)[0][0]
        difference=other[1]-t[1];difference[2]-=1e-9;block=clip(list(other[0]),difference)
        visible=area(t[0]) if area(block)==0 else sum(area(p) for p in subtract(t[0],np.asarray(block)))
        results[label]=dict(visible_area=visible,expected=expected,passed=abs(visible-expected)<1e-12)
    clipped=near_clip(np.asarray([[-.1,0.,-.1],[.1,0.,.1],[0.,.1,.1]]))
    results['near_plane_clipping']=dict(passed=len(clipped)==2 and all(p[:,2].min()>=1e-6-1e-12 for p in clipped))
    raw=np.load(paths[12]);skin_pairs=raw['internal/0/Forearm with elbow and wrist sections.001/after']
    results['retained_actual_skin_fold_count']=dict(pairs=len(skin_pairs),passed=len(skin_pairs)==498)
    if not all(r['passed'] for r in results.values()) or not folds['passed']:raise ValueError('A post-comparison control failed')
    if not all(digest(Path(p))==sha for p,sha in inputs.items()):raise ValueError('Post-comparison input identity changed')
    report=dict(state='complete',inputs=inputs,passed=True,additional_controls=results,
        old_gate_verdict=comparison['static_geometry_survivor'],
        material_classification=[dict(part=c['part'],valid=c['valid'],classification=c['classification']) for c in folds['cases']],
        conclusion='The35/24 crossings are real intersections of garment sidewalls wholly buried in the already proved proximal shoulder joins. They are not cap97 polygons or exposed garment folds. The original complete-gate rejection receipt is unchanged; no classifier has been wired into that gate in this turn.',
        rendering_status='No new image rendered. Geometry-only visibility is proved for the six recorded view directions under an opaque-shirt surface model; shading, naturalness and owner acceptance remain open.',
        proposed_cutaway='Cached material, enclosure and exact occlusion evidence is sufficient to classify these loci. A cutaway could illustrate them, but is not required to settle their location and has not been launched.',
        parent_ruling_required='Whether to adopt the narrow attachment-fold contract in the shared gate and request diagnostic images. No pose/binding/source change or further actual evaluation occurred.')
    (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(passed=True,input_count=len(inputs),controls=results,classification=report['material_classification']),indent=2))


if __name__=='__main__':run(*(Path(p) for p in sys.argv[1:]))
