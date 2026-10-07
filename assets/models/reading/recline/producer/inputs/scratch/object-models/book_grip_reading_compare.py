"""One reference/proposal causal comparison, at most two actual evaluations and 240 seconds."""
import json
import os
from pathlib import Path
import sys
import time

import bpy
import numpy as np

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import book_grip_reading_service as reading
from book_grip_reading_backend import BlenderReadingBackend
from book_grip_reading_causal import compare
import book_grip_original_replay as source


def run(reference_file,proposal_file,output):
    if not bpy.app.background or not output.is_absolute():raise ValueError('Background Blender and a new absolute output directory are required')
    output.mkdir(parents=True,exist_ok=False);began=time.monotonic();deadline=began+240
    context=reading.ReadingPoseInput(HERE);evaluator=reading.ReadingEvaluator(context)
    controls_path=HERE/'book-grip-reading-controls-summary-01/proof.json';controls=json.loads(controls_path.read_text())
    if not controls['passed']:raise ValueError('Complete source/collar/arm cached controls have not passed')
    reference=json.loads(reference_file.read_text());proposal=json.loads(proposal_file.read_text())
    if not {'head_collar','both_arms','page_visibility'}<=set(proposal.get('causal_targets',[])):raise ValueError('Proposal must explicitly account for all active head/arm/page constraints')
    rp,pp=reference['parameters'],proposal['parameters'];reference_frames=context.construct(rp);proposal_frames=context.construct(pp)
    if np.max(np.abs(np.asarray(rp['head_relative_rotation'])-np.asarray(pp['head_relative_rotation'])))<=1e-8:raise ValueError('Known head/collar failure is invariant without relative head change')
    rg=np.linalg.inv(reference_frames['spine'])@reference_frames['book'];pg=np.linalg.inv(proposal_frames['spine'])@proposal_frames['book']
    if np.max(np.abs(rg-pg))<=1e-8 and rp['arms']['R']==pp['arms']['R']:raise ValueError('Known right-arm failure is unchanged in torso-relative pose')
    old=context.receipt['candidate_state']['bone_matrices'];parameter_error=max(float(np.max(np.abs(reference_frames[n]-np.asarray(old[n])))) for n in reference_frames)
    if parameter_error>1e-5:raise ValueError('Reference parameters do not reconstruct the rejected ALT2 control')
    inputs=dict(controls['inputs'])
    for path in (Path(__file__),reference_file,proposal_file,controls_path):inputs[str(path.resolve())]=source.digest(path)
    for module in tuple(sys.modules.values()):
        path=getattr(module,'__file__',None)
        if path and Path(path).suffix=='.py' and Path(path).is_file() and source.ROOT in Path(path).resolve().parents:
            path=Path(path).resolve();sha=source.digest(path)
            if str(path) in inputs and inputs[str(path)]!=sha:raise ValueError('Immutable evaluator dependency changed: '+str(path))
            inputs[str(path)]=sha
    report=dict(state='running',pid=os.getpid(),background=True,blender_version=bpy.app.version_string,inputs=inputs,
        limits=dict(actual_evaluations=2,seconds=240,threads=2,fit_loop=False,render=False),cases=[],reference_parameter_error=parameter_error,
        proposal_rationale=proposal.get('rationale'),causal_targets=proposal['causal_targets'])
    def save():
        report['elapsed_seconds']=time.monotonic()-began;(output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    save()
    try:
        if not all(source.digest(Path(p))==sha for p,sha in inputs.items()):raise ValueError('Comparison input changed before opening')
        backend=BlenderReadingBackend(context,2);snapshots={};evidence={}
        for label,params in (('reference',rp),('proposal',pp)):
            arrays={};started=time.monotonic()
            selected=evaluator.select(params,backend,arrays,label,deadline);result=selected['evaluation']
            snapshots[label]=backend.last_snapshot;evidence[label]=arrays
            filename=label+'.npz';np.savez(output/filename,**arrays)
            report['cases'].append(dict(label=label,seconds=time.monotonic()-started,parameters=params,
                cache=dict(path=filename,sha256=source.digest(output/filename)),**result));save()
            if label=='reference':
                cached=np.load(HERE/'book-grip-alt2-replay-01/candidate.npz')
                errors={n:float(np.linalg.norm(s.points-cached[n+'/points'],axis=1).max()) for n,s in snapshots[label]['surfaces'].items()}
                report['reference_geometry_correspondence']=errors
                if max(errors.values())>1e-5:raise ValueError('Actual reference does not reproduce the immutable failed geometry')
                if result['feasible']:raise ValueError('Complete evaluator accepted the known bad reference')
        causal_arrays={};report['causal_comparison']=compare(snapshots['reference'],snapshots['proposal'],report['cases'][0],evidence['reference'],context,causal_arrays)
        np.savez(output/'causal.npz',**causal_arrays);report['causal_sha256']=source.digest(output/'causal.npz')
        report['actual_evaluations']=backend.calls;report['observed_states']=backend.states
        if time.monotonic()>deadline:raise TimeoutError('Two-evaluation diagnostic ceiling exhausted')
        report.update(state='complete',static_geometry_survivor=report['cases'][1]['feasible'],
            acceptance='A lower failure count or improving witness is not acceptance. Only a complete static survivor can earn a separately granted save/reopen and diagnostic render.')
    except BaseException as error:report.update(state='budget_exhausted' if isinstance(error,TimeoutError) else 'failed',error=repr(error));raise
    finally:
        report['inputs_unchanged']=all(source.digest(Path(p))==sha for p,sha in inputs.items())
        if not report['inputs_unchanged']:report.update(state='failed',static_geometry_survivor=False,error='Comparison inputs changed')
        save()


if __name__=='__main__':run(*(Path(p) for p in sys.argv[sys.argv.index('--')+1:]))
