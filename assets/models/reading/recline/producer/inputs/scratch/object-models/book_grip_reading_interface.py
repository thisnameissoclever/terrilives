"""Freeze the reference interface and test causal reporting without a new pose."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0,str(Path(__file__).parent))
import book_grip_reading_service as service
from book_grip_reading_controls_v2 import snapshot,parameters
from book_grip_reading_causal import compare


def run(root,output):
    output.mkdir(parents=True,exist_ok=False)
    summary=json.loads((root/'book-grip-reading-controls-summary-01/proof.json').read_text())
    if not summary['passed']:raise ValueError('Complete cached gate controls must pass first')
    context=service.ReadingPoseInput(root);params=parameters(root);frames=context.construct(params)
    source=context.receipt;actual=source['candidate_state'];error=max(float(np.max(np.abs(frames[n]-np.asarray(actual['bone_matrices'][n])))) for n in frames)
    if error>1e-5:raise ValueError('Reference parameter reconstruction changed')
    reference=dict(schema_version=1,parameters=params,source='Recorded rejected ALT2, not a new pose',
        source_receipt='book-grip-alt2-replay-01/proof.json',causal_targets=['head_collar','both_arms','page_visibility'])
    (output/'reference-parameters.json').write_text(json.dumps(reference,indent=2)+'\n',encoding='utf-8')
    cached=json.loads((root/'book-grip-reading-controls-02/proof.json').read_text())['cases'][1]
    geometry=np.load(root/'book-grip-alt2-replay-01/candidate.npz')
    value=snapshot(context,geometry,actual,error)
    witness=np.load(root/'book-grip-reading-controls-02'/cached['cache']['path']);arrays={}
    causal=compare(value,value,cached,witness,context,arrays)
    zero=(abs(causal[0]['change'])<1e-12 and all(abs(r['minimum_local_outward_change'])<1e-12 and abs(r['maximum_local_outward_change'])<1e-12 for r in causal[1:]))
    if not zero:raise ValueError('Identical actual geometry reported a false causal improvement')
    forged=copy.deepcopy(cached);forged['feasible']=True
    rejects_forged=not service.eligible_for_preference(forged)
    if not rejects_forged:raise ValueError('Preference selection bypassed failed complete constraints')
    files=['book_grip_reading_evaluator_v2.py','book_grip_reading_geometry.py','book_grip_reading_attachments.py',
        'book_grip_reading_service.py','book_grip_reading_backend.py','book_grip_reading_causal.py','book_grip_reading_compare.py',
        'book_grip_reading_interface.py']
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    inputs=dict(summary['inputs'])
    for name in files:
        path=root/name;ast.parse(path.read_text());inputs[str(path.resolve())]=digest(path)
    for path in (root/'book-grip-reading-controls-summary-01/proof.json',output/'reference-parameters.json'):
        inputs[str(path.resolve())]=digest(path)
    np.savez(output/'zero-motion-causal.npz',**arrays)
    report=dict(state='complete',inputs=inputs,controls=dict(reference_reconstruction=error,zero_motion_has_zero_causal_change=zero,
        forged_feasible_flag_rejected=rejects_forged,all_frozen_modules_parse=True),
        cached_gate_summary='book-grip-reading-controls-summary-01/proof.json',
        reference_manifest=dict(path='reference-parameters.json',sha256=digest(output/'reference-parameters.json')),
        frozen_modules={n:digest(root/n) for n in files},causal_control=causal,
        planned_comparison=dict(actual_evaluations=2,seconds=240,threads=2,fit_loop=False,render=False),
        proposal_status='No new numeric proposal authored or fitted. The comparison runner requires an explicit joint proposal manifest accounting for head/collar, both arms and visible pages before a future grant.',
        spine_status='Spine rotation is representable and all changed body contacts are discovered. Acceptance additionally requires a selected-binding, pose-specific waist classifier; without one the fresh-waist row is unresolved and fails.',
        scope='Source/witness-aware evaluator and frozen causal interface only; no Blender, fitting, save, render or pose change')
    assert all(digest(Path(p))==sha for p,sha in inputs.items())
    (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:report[k] for k in ('state','controls','frozen_modules','proposal_status','spine_status')},indent=2))


if __name__=='__main__':run(*(Path(p) for p in sys.argv[1:]))
