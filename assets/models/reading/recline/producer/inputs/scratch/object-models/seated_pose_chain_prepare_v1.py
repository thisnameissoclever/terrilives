"""Validate the analytic chain and freeze one exact mixed02 comparison."""
import ast
import hashlib
import json
from pathlib import Path
import sys
import numpy as np

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from seated_pose_chain_math_v1 import solve_upper
from sofa_contact_solver_frames import rotation


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run():
    prior_path=HERE/'seated-pose-mixed-02/input-manifest.json'
    inputs=dict(json.loads(prior_path.read_text())['inputs'])
    inputs[str(prior_path)]=digest(prior_path)
    for name in ('seated-pose-mixed-02/raw/proof.json','seated-pose-mixed-02/raw/authored-geometry.npz',
                 'seated-pose-mixed-02/raw/authored-pose.json','seated-pose-chain-contact-01/proof.json',
                 'seated-pose-chain-contact-01/contact-patches.npz','arm-chain-better-way-review.md',
                 'book-grip-sleeve-fold-controls-01/proof.json'):
        inputs[str(HERE/name)]=digest(HERE/name)
    pending=[Path(__file__).resolve(),HERE/'seated_pose_chain_v1.py',HERE/'seated_pose_mixed_native_v1.py']
    visited=set()
    while pending:
        path=pending.pop()
        if path in visited:
            continue
        visited.add(path)
        inputs[str(path)]=digest(path)
        tree=ast.parse(path.read_text(encoding='utf-8-sig'),filename=str(path))
        for node in ast.walk(tree):
            names=[a.name for a in node.names] if isinstance(node,ast.Import) else [node.module] if isinstance(node,ast.ImportFrom) else []
            for name in names:
                if name and (HERE/(name.split('.')[0]+'.py')).is_file():
                    pending.append(HERE/(name.split('.')[0]+'.py'))
    for path,sha in inputs.items():
        if digest(path)!=sha:
            raise ValueError('Frozen dependency changed: '+path)
    source=json.loads((HERE/'book-grip-alt2-replay-01/proof.json').read_text())
    rest={b['name']:np.asarray(b['matrix']) for b in next(iter(source['raw_source_identity']['bones'].values()))}
    previous=json.loads((HERE/'seated-pose-mixed-02/raw/proof.json').read_text())
    frames={n:np.asarray(m) for n,m in previous['full_states'][1]['bone_matrices'].items()}
    controls=[]
    for side in ('L','R'):
        args=[rest['upper_arm.'+side],rest['forearm.'+side],rest['hand.'+side],frames['upper_arm.'+side],frames['forearm.'+side]]
        solved,proof=solve_upper(*args)
        assert proof['elbow_transport_matrix_error']<1e-12
        assert 76.64<proof['shoulder_frame_change_degrees']<76.65
        assert 5.24<proof['naive_backward_transport_mismatch_degrees']<5.26
        transform=np.eye(4)
        transform[:3,:3]=rotation([1,0,0],.37)@rotation([0,0,1],.61)
        transform[:3,3]=[.11,-.07,.23]
        changed,_=solve_upper(*(transform@value for value in args))
        covariance=float(np.abs(changed-transform@solved).max())
        assert covariance<1e-10
        controls.append(dict(side=side,passed=True,coordinate_covariance_error=covariance,**proof))
    args=[rest['upper_arm.L'],rest['forearm.L'],rest['hand.L'],frames['upper_arm.L'],frames['forearm.L']]
    bad=[a.copy() for a in args]
    bad[1][:3,3]=bad[0][:3,3]
    try:
        solve_upper(*bad)
        raise AssertionError('Zero-length source control was accepted')
    except ValueError:
        controls.append(dict(name='zero-length source rejected',passed=True))
    output=HERE/'seated-pose-chain-01'
    output.mkdir(exist_ok=False)
    argv=['C:/Users/myema/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe','--background','--threads','2',
          '--python-exit-code','1','--python',str(HERE/'seated_pose_chain_v1.py'),'--',str(output/'input-manifest.json'),str(output/'raw')]
    manifest=dict(state='prepared',inputs=inputs,controls=controls,
        proposal=dict(kind='Analytic complete-chain comparison',baseline='seated-pose-mixed-02',
            changed_frames=['seat1/upper_arm.L','seat1/upper_arm.R'],
            method='Quaternion axial solve preserving the non-straight source arm chain, exact hand and forearm targets',
            known_failure='Retained full-hand/book nearest distance is about 2.885mm; zero finite side-contact cells within the selected 1.5mm diagnostic band'),
        argv=argv,limits=dict(proposals=1,renders=4,threads=2,seconds=240,minimum_free_gib=6,stop_own_writer_free_gib=4),
        cost=dict(expected_seconds=[100,200],ceiling_seconds=240,paid_generation=0),
        acceptance=False,scope='Isolated complete-chain proof; unchanged rigid grip, exact four mixed02 cameras, fresh shoulder/body/neighbor/furniture/containment/fold/contact evidence')
    (output/'input-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(inputs=len(inputs),producer_sha256=digest(HERE/'seated_pose_chain_v1.py'),
                         manifest_sha256=digest(output/'input-manifest.json'),output=str(output))))


if __name__=='__main__':
    run()
