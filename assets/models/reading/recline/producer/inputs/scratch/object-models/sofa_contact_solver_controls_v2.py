"""Bounded phase-zero contact/arm solve. Invocation requires a parent geometry window."""
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
import numpy as np
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0,str(Path(__file__).parent))
from sofa_contact_solver_frames import coupled_frames, rotation
from sofa_contact_solver_scene_v2 import SceneEvaluatorV2 as SceneEvaluator, surface_data, retained
from derive_lap_support_adjustment import minimum_gap

LAP=((0,'L'),(1,'L'),(1,'R'),(2,'R'))
MAX_EVALUATIONS=96
MAX_SECONDS=1800


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(root, output, mode):
    if mode!='controls':raise ValueError('This version is controls-only; no fitting is authorized')
    if not bpy.app.background:raise ValueError('Background Blender required')
    output.mkdir(parents=True,exist_ok=False)
    began=time.monotonic()
    source=json.loads((root/'sofa-resting-clearance-01/proof.json').read_text())
    control=json.loads((root/'sofa-contact-solver-controls-02/proof.json').read_text())
    wrist_control=json.loads((root/'sofa-contact-solver-wrist-controls-01/proof.json').read_text())
    if not control['passed']:raise ValueError('Cached classifier controls must pass before fitting')
    if not wrist_control['passed']:raise ValueError('Cached wrist controls must pass')
    for receipt in (source,control,wrist_control):
        for path,sha in receipt['inputs'].items():
            if digest(path)!=sha:raise ValueError('Retained receipt dependency changed: '+path)
    inputs=dict(source['inputs']);inputs.update(control['inputs']);inputs.update(wrist_control['inputs'])
    for path in [*root.glob('sofa_contact_solver*.py'),root/'sofa-derived-binding-03/derived-waist-binding.blend',
                 root/'sofa-resting-clearance-01/proof.json',root/'sofa-resting-clearance-01/phase-00.npz',
                 root/'sofa-coherent-arms-02/proof.json',root/'sofa-hand-support-01/proof.json']:
        inputs[str(path.resolve())]=digest(path)
    for path,sha in inputs.items():
        if digest(path)!=sha:raise ValueError('Immutable input changed: '+path)
    proof=dict(state='running',pid=os.getpid(),mode=mode,inputs=inputs,evaluations=[],
               limits=dict(retained_replays=2,candidate_evaluations=0,seconds=180),
               runtime_phase_contract='Four shared phases per sofa; final production/export replay remains required',
               final_acceptance=False,remaining=['Canonical repaired book grip and mixed actions','Opposing and whole-sofa views','Owner visual approval','All four phases after phase-zero review'])
    def save():
        proof['elapsed_seconds']=time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
    save()
    try:
        binding=json.loads((root/'sofa-derived-binding-03/proof.json').read_text())
        hands=json.loads((root/'sofa-hand-support-01/proof.json').read_text())
        old=json.loads((root/'sofa-coherent-arms-02/proof.json').read_text())
        rigs,bodies,furniture,origins=retained.shared.load_scene(root/'sofa-derived-binding-03',binding)
        retained.shared.pose(rigs,origins,'sit',0.)
        frame_error=0.
        for rig,frames in zip(rigs,source['selected_frames']):
            frame_error=max(frame_error,retained.apply_frames(rig,{n:np.asarray(m) for n,m in frames.items()}))
        initial=retained.torso.surfaces(bodies)
        baseline=[{n:surface_data(s) for n,s in body.items()} for body in initial]
        evaluator=SceneEvaluator(root,rigs,bodies,furniture,hands,baseline)
        arrays={}
        cold_start=time.monotonic()
        regression=evaluator.evaluate(arrays,'retained',frame_error,began+180)
        proof['cold_evaluator_seconds']=time.monotonic()-cold_start
        proof['retained_scene_control']=regression
        np.savez(output/'retained-scene.npz',**arrays)
        expected=[(1,['Turned sleeve cuff','One sewn breast pocket']),(1,['Relaxed shirt sleeve','One sewn breast pocket']),
                  (0,['Turned sleeve cuff','Overshirt body']),(2,['Turned sleeve cuff.001','Overshirt body'])]
        for seat,parts in expected:
            if not any(r.get('seat')==seat and r.get('parts')==parts and not r['valid'] for r in regression['rows']):
                raise ValueError('Full discovery missed retained failure: '+str((seat,parts)))
        for seat,parts in [(0,['Relaxed shirt sleeve.001','Overshirt body']),(2,['Relaxed shirt sleeve','Overshirt body'])]:
            if not any(r.get('seat')==seat and r.get('parts')==parts and r['valid'] for r in regression['rows']):
                raise ValueError('Full discovery lost source shoulder control')
        wrists=[row for row in regression['rows'] if row['kind']=='arm_body' and 'wrist' in row]
        if len(wrists)!=12 or not all(row['valid'] for row in wrists):
            raise ValueError('Complete replay lost a retained source wrist attachment control')
        proof['retained_scene_control_passed']=True;save()
        repeat_arrays={}
        warm_start=time.monotonic()
        repeat=evaluator.evaluate(repeat_arrays,'retained_repeat',frame_error,began+180)
        proof['warm_evaluator_seconds']=time.monotonic()-warm_start
        proof['warm_scene_control']=repeat
        same_rows=json.dumps(regression['rows'],sort_keys=True)==json.dumps(repeat['rows'],sort_keys=True).replace('retained_repeat','retained')
        same_arrays=set(arrays)=={key.replace('retained_repeat','retained') for key in repeat_arrays} and all(
            np.array_equal(value,repeat_arrays[key.replace('retained','retained_repeat',1)]) for key,value in arrays.items())
        proof['exact_reuse_preserved_rows_and_arrays']=same_rows and same_arrays
        if not proof['exact_reuse_preserved_rows_and_arrays']:raise ValueError('Exact geometry reuse changed residuals or witnesses')
        save()
        if mode=='controls':
            proof['state']='complete';return
    except BaseException as error:
        proof['state']='budget_exhausted' if isinstance(error,TimeoutError) else 'failed'
        proof['error']=repr(error)
        if proof['evaluations']:proof['selected']=min(proof['evaluations'],key=lambda r:r['merit'])
        raise
    finally:
        proof['inputs_unchanged']=all(digest(path)==sha for path,sha in inputs.items())
        save()
        print(json.dumps(dict(state=proof['state'],pid=os.getpid(),inputs_unchanged=proof['inputs_unchanged'],evaluations=len(proof['evaluations']),elapsed_seconds=proof['elapsed_seconds'])),flush=True)

if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:]
    run(Path(args[0]).resolve(),Path(args[1]).resolve(),args[2])
