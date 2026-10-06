"""Record source invariance and freeze one bounded corrected mixed-scene job."""
import ast
import hashlib
import json
from pathlib import Path
import sys
import numpy as np

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from pose_complete_correct_frames_v1 import construct
from classify_sofa_lap_contacts import source_map


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run():
    base=json.loads((HERE/'pose-complete-02/input-manifest.json').read_text())
    inputs=dict(base['inputs'])
    for path in (HERE/'pose-complete-02/input-manifest.json',HERE/'pose-complete-02/cached/proof.json',
        HERE/'pose-complete-02/cached/witnesses.npz',HERE/'pose-complete-02/raw/proof.json',
        HERE/'sofa-resting-clearance-01/proof.json',HERE/'sofa-resting-clearance-01/phase-00.npz',
        HERE/'sofa-hand-support-01/proof.json',HERE/'sofa-binding-audit-01/proof.json',
        HERE/'sofa-binding-audit-01/source-binding.npz',HERE/'sofa-derived-binding-03/normalized-rest.npz'):
        inputs[str(path)]=digest(path)
    pending=[Path(__file__).resolve(),HERE/'pose_complete_correct_author_v1.py',
        HERE/'pose_complete_correct_cached_v1.py',HERE/'pose_complete_native_v1.py']
    visited=set()
    while pending:
        path=pending.pop().resolve()
        if path in visited:
            continue
        visited.add(path);content=path.read_text(encoding='utf-8-sig')
        compile(content,str(path),'exec');inputs[str(path)]=digest(path)
        for node in ast.walk(ast.parse(content)):
            names=[a.name for a in node.names] if isinstance(node,ast.Import) else [node.module] if isinstance(node,ast.ImportFrom) else []
            for name in names:
                if name and (HERE/(name.split('.')[0]+'.py')).is_file():
                    pending.append(HERE/(name.split('.')[0]+'.py'))
    launcher=HERE/'pose_complete_launch_v2.ps1';inputs[str(launcher)]=digest(launcher)
    if any(digest(p)!=sha for p,sha in inputs.items()):
        raise ValueError('Frozen correction input changed')
    prior=json.loads((HERE/'seated-pose-chain-01/raw/proof.json').read_text())['full_states']
    reference=json.loads((HERE/'book-grip-alt2-replay-01/proof.json').read_text())
    rest={b['name']:np.asarray(b['matrix']) for b in next(iter(reference['raw_source_identity']['bones'].values()))}
    resting_proof=json.loads((HERE/'sofa-resting-clearance-01/proof.json').read_text())
    resting=[]
    with np.load(HERE/'sofa-resting-clearance-01/phase-00.npz') as cache:
        for seat in range(3):
            resting.append(dict(world=cache[f'{seat}/rig_matrix_world'].tolist(),frames=resting_proof['selected_frames'][seat]))
    grasp=json.loads((HERE/'pose-complete-02/cached/proof.json').read_text())['finite_grasp_contact']
    frames,controls=construct(prior,rest,resting,grasp,12.)
    if max(v['elbow_transport_matrix_error'] for v in controls)>1e-8:
        raise ValueError('Prepared six-arm analytic residual failed')
    binding=json.loads((HERE/'sofa-binding-audit-01/proof.json').read_text())
    rows=[];witnesses={}
    with np.load(HERE/'sofa-derived-binding-03/normalized-rest.npz') as original, \
        np.load(HERE/'seated-pose-chain-01/raw/authored-geometry.npz') as current, \
        np.load(HERE/'sofa-binding-audit-01/source-binding.npz') as source, \
        np.load(HERE/'pose-complete-02/cached/witnesses.npz') as raw:
        for seat,state in enumerate(prior):
            for name,bone in (('HAIR_01_TRIPO_CURL','head'),('One sewn breast pocket','spine')):
                obj=binding['saved_objects'][name]
                if obj['groups']!=[bone] or not np.all(source[name+'/weights']==1):
                    raise ValueError('Source contact is not rigidly assigned to its original bone')
                transform=np.asarray(state['rig_matrix_world'])@np.asarray(state['bone_matrices'][bone])@np.linalg.inv(rest[bone])
                predicted=original[name+'/rest_points']@transform[:3,:3].T+transform[:3,3]
                residual=float(np.linalg.norm(predicted-current[f'{seat}/{name}/points'],axis=1).max())
                equal=bool(np.array_equal(original[name+'/triangles'],current[f'{seat}/{name}/triangles']))
                if residual>1e-5 or not equal:
                    raise ValueError('Rigid source contact correspondence failed')
                key=f'fold/{seat}/{name}'
                pairs=raw[key]
                witnesses[key+'/current_triangle_pairs']=pairs
                witnesses[key+'/original_source_faces']=source_map(name,original[name+'/triangles'],source)[pairs]
                rows.append(dict(seat=seat,part=name,bone=bone,vertices=len(predicted),maximum_rigid_transform_error=residual,
                    ordered_triangles_equal=equal,all_source_weights_exactly_one=True,raw_pairs=len(pairs),witness=key,
                    classification='Unchanged rigid authored source contact; not a new pose deformation'))
    output=HERE/'pose-complete-corrected-01';output.mkdir(exist_ok=False)
    source_receipt=output/'source-invariance.json'
    source_receipt.write_text(json.dumps(dict(state='complete',rows=rows,acceptance=False,
        source_inputs={p:s for p,s in inputs.items() if any(t in p for t in ('source-binding','normalized-rest','cached/witnesses','raw/proof'))},
        scope='Exact ordered source correspondence and known rigid bone transforms; no skin exemption'),indent=2)+'\n')
    np.savez(output/'source-invariance-witnesses.npz',**witnesses)
    prepared=output/'prepared-frames.json'
    prepared.write_text(json.dumps(dict(prior=prior,rest={n:m.tolist() for n,m in rest.items()},resting=resting,grasp=grasp,
        first_candidate_frames=[{n:m.tolist() for n,m in f.items()} for f in frames],analytic_controls=controls),indent=2)+'\n')
    for path in (source_receipt,output/'source-invariance-witnesses.npz',prepared):
        inputs[str(path)]=digest(path)
    manifest=dict(state='prepared',inputs=inputs,acceptance=False,prepared_frames=str(prepared),
        jobs=dict(render_script=str(HERE/'pose_complete_correct_author_v1.py'),cached_script=str(HERE/'pose_complete_correct_cached_v1.py'),native_script=str(HERE/'pose_complete_native_v1.py')),
        outputs=dict(render=str(output/'raw'),cached=str(output/'cached'),native=str(output/'native')),
        limits=dict(posture_evaluations=4,reader_forward_degrees=[12,30],author_seconds=180,each_external_seconds=240,threads=2,minimum_free_gib=6,stop_own_writer_free_gib=4),
        proposal=dict(reader='Actual nearest-surface hand shifts toward positive0.2mm contact; book/head presentation retained',
            resting='Four saved finite lap/armrest hand frames with analytic six-arm chain construction',
            neighbors='Measured outward torso envelopes and at most four actual-witness depth updates',
            immutable='Original meshes, binding, skeleton, scale, supported lower body and furniture'),
        compilation=dict(files=len(visited),passed=True),source_invariant_rows=len(rows))
    target=output/'input-manifest.json';target.write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(manifest=str(target),sha256=digest(target),inputs=len(inputs),compiled=len(visited),
        rigid_source_maximum_error=max(v['maximum_rigid_transform_error'] for v in rows),
        maximum_prepared_elbow_transport_error=max(v['elbow_transport_matrix_error'] for v in controls))))


if __name__=='__main__':
    run()
