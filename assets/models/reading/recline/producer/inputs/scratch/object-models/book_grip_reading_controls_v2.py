"""Run the shared complete reading gate on existing source and rejected ALT2 caches."""
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np

sys.path.insert(0,str(Path(__file__).parent))
import book_grip_reading_evaluator_v2 as reading
from book_grip_reading_geometry import Mesh


def parameters(root):
    p=json.loads((root/'book-grip-alt2-preparation-01/proof.json').read_text())
    return dict(grasp_transform=p['grasp_transform'],head_relative_rotation=np.asarray(p['head_transform'])[:3,:3].tolist(),spine_rotation=np.eye(3).tolist(),
                arms={v['side']:dict(swivel=v['swivel'],upper_arm_roll=v['upper_arm_roll']) for v in p['arm_constructions']})


def snapshot(context,cache,state,frame_error=0.):
    frames={n:np.asarray(m) for n,m in state['bone_matrices'].items()}
    length_error=max(abs(np.linalg.norm(frames[b['name']][:3,1])*np.linalg.norm(np.asarray(b['tail'])-b['head'])-np.linalg.norm(np.asarray(b['tail'])-b['head'])) for b in next(iter(context.raw['bones'].values())))
    scale=max(abs(v-1) for value in state['channels'].values() for v in value['scale'])
    joins=max(np.linalg.norm((frames[a+'.'+side]@np.asarray([0.,np.linalg.norm(context.rest_frames[b+'.'+side][:3,3]-context.rest_frames[a+'.'+side][:3,3]),0.,1.]))[:3]-frames[b+'.'+side][:3,3]) for side in ('L','R') for a,b in (('upper_arm','forearm'),('forearm','hand')))
    return dict(surfaces={key[:-len('/points')]:Mesh(cache[key],cache[key[:-len('/points')]+'/triangles']) for key in cache.files if key.endswith('/points')},
        frames=frames,rig_matrix_world=np.asarray(state['rig_matrix_world']),
        identity_rows=[dict(kind='immutable_cached_identity',valid=True,reason='All source, code, cache and receipt hashes are checked before and after these cached controls')],
        joint_row=dict(kind='joints_and_frames',valid=max(length_error,scale,joins,frame_error)<=1e-5,length_error=float(length_error),scale_error=float(scale),join_error=float(joins),frame_error=frame_error))


class ExactSnapshotBackend:
    def __init__(self,snapshot):self.snapshot=snapshot;self.calls=0
    def evaluate_frames(self,frames,deadline):
        error=max(float(np.max(np.abs(np.asarray(frames[n])-self.snapshot['frames'][n]))) for n in frames)
        if error>1e-5:raise ValueError('A cached backend cannot evaluate new pose geometry')
        self.calls+=1;return self.snapshot


def run(root,output):
    output.mkdir(parents=True,exist_ok=False);began=time.monotonic();deadline=began+120
    prior=json.loads((root/'book-grip-alt2-replay-01/proof.json').read_text());inputs=dict(prior['inputs'])
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    paths=[Path(__file__),Path(reading.__file__),root/'book_grip_reading_geometry.py',root/'book_grip_reading_attachments.py',root/'book-grip-reading-region-controls-01/proof.json',
        root/'book-grip-alt2-replay-01/proof.json',root/'book-grip-alt2-replay-01/source-control.npz',root/'book-grip-alt2-replay-01/candidate.npz',root/'book-grip-alt2-replay-01/rest.npz',root/'book-grip-alt2-preparation-01/proof.json']
    for p in paths:inputs[str(p.resolve())]=digest(p)
    report=dict(state='running',inputs=inputs,cases=[],scope='Complete shared evaluator on immutable prior snapshots only; no Blender, new pose or fitting',limits=dict(seconds=120))
    def save():
        report['elapsed_seconds']=time.monotonic()-began;(output/'proof.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    save()
    try:
        if not all(digest(Path(p))==sha for p,sha in inputs.items()):raise ValueError('A cached control input changed')
        context=reading.ReadingPoseInput(root);evaluator=reading.CompleteReadingEvaluator(context)
        p=parameters(root);constructed=context.construct(p)
        error=max(float(np.max(np.abs(constructed[n]-np.asarray(prior['candidate_state']['bone_matrices'][n])))) for n in constructed)
        report['reference_parameter_reconstruction_error']=error
        if error>1e-5:raise ValueError('Reference parameters do not reproduce the recorded complete frames')
        for label,filename,state in (('source','source-control.npz','source_state'),('rejected_ALT2','candidate.npz','candidate_state')):
            cache=np.load(root/'book-grip-alt2-replay-01'/filename)
            value=snapshot(context,cache,prior[state],error if label=='rejected_ALT2' else 0.)
            arrays={};start=time.monotonic()
            if label=='rejected_ALT2':
                backend=ExactSnapshotBackend(value);selected=evaluator.select(p,backend,arrays,label,deadline);result=selected['evaluation']
                report['construction_rejected_known_bad_pose']=not selected['accepted'];report['construction_backend_calls']=backend.calls
            else:result=evaluator.evaluate_snapshot(value,arrays,label,deadline)
            path=output/(label+'.npz');np.savez(path,**arrays)
            report['cases'].append(dict(label=label,seconds=time.monotonic()-start,cache=dict(path=path.name,sha256=digest(path)),**result));save()
        bad=report['cases'][1];rows=bad['rows']
        required=[('right_forearm',lambda r:r.get('parts')==['Forearm with elbow and wrist sections.001','Overshirt body'] and not r['valid']),
                  ('right_cuff',lambda r:r.get('parts')==['Turned sleeve cuff.001','Overshirt body'] and not r['valid']),
                  ('head_collar_containment',lambda r:set(r.get('parts',[]))=={'Folded fabric collar leaf','Sculpted head'} and not r['valid'] and r['kind']=='body_containment')]
        controls={name:any(check(r) for r in rows) for name,check in required}
        controls['bilateral_finite_support']=len([r for r in rows if r['kind']=='support' and r['valid']])==2
        controls['valid_wrist_joins']=len([r for r in rows if r['kind']=='arm_body' and 'wrist' in r and r['valid']])==4
        controls['legitimate_source_collar_joins']=all(r['valid'] for r in report['cases'][0]['rows'] if r['kind']=='neck_collar_attachment') and len([r for r in report['cases'][0]['rows'] if r['kind']=='neck_collar_attachment'])==3
        controls['construction_uses_complete_gate']=report['construction_rejected_known_bad_pose']
        # The same gate cannot accept identical rows in a replay caller.
        repeated=reading.gate(rows,bad['coverage']);controls['replay_gate_identical']=repeated['feasible']==bad['feasible'] and repeated['failures']==bad['failures']
        report['controls']=controls;report['passed']=all(controls.values())
        report['state']='complete'
        if not report['passed']:raise ValueError('A complete reading cached control failed')
    except BaseException as error:report.update(state='failed',error=repr(error));raise
    finally:
        report['inputs_unchanged']=all(digest(Path(p))==sha for p,sha in inputs.items());save()
    print(json.dumps(dict(state=report['state'],controls=report['controls'],seconds=report['elapsed_seconds'],cases=[dict(label=r['label'],feasible=r['feasible'],failures=len(r['failures']),seconds=r['seconds']) for r in report['cases']]),indent=2))


if __name__=='__main__':run(*(Path(p) for p in sys.argv[1:]))
