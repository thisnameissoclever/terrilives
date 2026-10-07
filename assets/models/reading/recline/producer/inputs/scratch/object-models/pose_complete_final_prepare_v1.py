"""Freeze the permitted full-frame torso and contact-compatible arm correction."""
import hashlib
import json
from pathlib import Path
import numpy as np
from pose_complete_final_frames_v1 import construct

HERE=Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run():
    old_manifest=HERE/'pose-complete-corrected-02/input-manifest.json'
    manifest=json.loads(old_manifest.read_text());inputs=dict(manifest['inputs'])
    paths=[old_manifest,HERE/'pose-complete-corrected-02/raw/proof.json',HERE/'pose-complete-corrected-02/cached/proof.json',
        HERE/'pose_complete_final_prepare_v1.py',HERE/'pose_complete_final_author_v1.py',HERE/'pose_complete_final_frames_v1.py']
    for path in paths:
        if path.suffix=='.py':
            compile(path.read_text(),str(path),'exec')
        inputs[str(path)]=digest(path)
    if any(digest(p)!=sha for p,sha in inputs.items()):
        raise ValueError('Final correction source changed')
    data=json.loads(Path(manifest['prepared_frames']).read_text())
    data['prior']=json.loads((HERE/'pose-complete-corrected-02/raw/proof.json').read_text())['full_states']
    prior=json.loads((HERE/'sofa-resting-clearance-01/proof.json').read_text())
    with np.load(HERE/'sofa-resting-clearance-01/phase-00.npz') as source:
        for seat in (0,2):
            data['resting'][seat]=dict(world=source[f'{seat}/rig_matrix_world'].tolist(),
                frames={name:source[f'{seat}/bone_matrices'][i].tolist() for i,name in enumerate(prior['bone_names'])})
    frames,controls=construct(data['prior'],{n:np.asarray(m) for n,m in data['rest'].items()},data['resting'],data['grasp'],12.)
    data['first_candidate_frames']=[{n:m.tolist() for n,m in f.items()} for f in frames]
    data['analytic_controls']=controls
    output=HERE/'pose-complete-final-01';output.mkdir(exist_ok=False)
    prepared=output/'prepared-frames.json';prepared.write_text(json.dumps(data,indent=2)+'\n');inputs[str(prepared)]=digest(prepared)
    manifest.update(inputs=inputs,prepared_frames=str(prepared),outputs=dict(render=str(output/'raw'),cached=str(output/'cached'),native=str(output/'native')))
    manifest['jobs']['render_script']=str(HERE/'pose_complete_final_author_v1.py')
    manifest['limits']['posture_evaluations']=1
    manifest['proposal']=dict(kind='Full saved outward torso and contact-compatible forearms',
        preserved='Proved reader grip, all hand contacts, hips, feet, scale, original rig and binding',
        outward_world_displacement=[row['outward_world_displacement'] for row in controls],
        maximum_analytic_elbow_transport_error=max(v['elbow_transport_matrix_error'] for v in controls))
    target=output/'input-manifest.json';target.write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(manifest=str(target),sha256=digest(target),inputs=len(inputs),proposal=manifest['proposal'])))


if __name__=='__main__':
    run()
