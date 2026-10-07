"""Freeze one local cuff correction derived from actual garment witnesses."""
import hashlib
import json
from pathlib import Path
import numpy as np
from pose_complete_cuff_frames_v1 import construct

HERE=Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run():
    original=HERE/'pose-complete-final-01/input-manifest.json'
    manifest=json.loads(original.read_text());inputs=dict(manifest['inputs'])
    for path in (original,HERE/'pose-complete-final-01/raw/proof.json',HERE/'pose-complete-final-01/raw/authored-geometry.npz',
        HERE/'pose-complete-final-01/cached/proof.json',HERE/'pose-complete-final-01/cached/witnesses.npz',
        HERE/'pose_complete_cuff_prepare_v1.py',HERE/'pose_complete_cuff_author_v1.py',HERE/'pose_complete_cuff_frames_v1.py'):
        if path.suffix=='.py':
            compile(path.read_text(),str(path),'exec')
        inputs[str(path)]=digest(path)
    if any(digest(p)!=sha for p,sha in inputs.items()):
        raise ValueError('Frozen cuff-correction input changed')
    data=json.loads(Path(manifest['prepared_frames']).read_text())
    data['prior']=json.loads((HERE/'pose-complete-final-01/raw/proof.json').read_text())['full_states']
    receipt=json.loads((HERE/'pose-complete-final-01/cached/proof.json').read_text())
    with np.load(HERE/'pose-complete-final-01/raw/authored-geometry.npz') as geometry,np.load(HERE/'pose-complete-final-01/cached/witnesses.npz') as witnesses:
        for seat in (0,2):
            normals=[]
            for row in receipt['contacts']:
                if row['pair_kind']!='own' or row['owners'][0]!=str(seat) or row['evidence']['kind']!='surface' or 'Overshirt body' not in row['parts'] or not any(n.startswith('Turned sleeve cuff') for n in row['parts']):
                    continue
                index=row['parts'].index('Overshirt body')
                ids=witnesses[row['evidence']['witness']+'/pairs'][:,index]
                tri=geometry[f'{seat}/Overshirt body/points'][geometry[f'{seat}/Overshirt body/triangles'][ids]]
                normal=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);normal/=np.linalg.norm(normal,axis=1)[:,None]
                normals.extend(normal)
            average=np.asarray(normals).mean(0);average/=np.linalg.norm(average)
            data['resting'][seat]['clearance_normal']=average.tolist()
    frames,controls=construct(data['prior'],{n:np.asarray(m) for n,m in data['rest'].items()},data['resting'],data['grasp'],12.)
    data['first_candidate_frames']=[{n:m.tolist() for n,m in f.items()} for f in frames]
    data['analytic_controls']=controls
    output=HERE/'pose-complete-cuff-01';output.mkdir(exist_ok=False)
    prepared=output/'prepared-frames.json';prepared.write_text(json.dumps(data,indent=2)+'\n');inputs[str(prepared)]=digest(prepared)
    manifest.update(inputs=inputs,prepared_frames=str(prepared),outputs=dict(render=str(output/'raw'),cached=str(output/'cached'),native=str(output/'native')))
    manifest['jobs']['render_script']=str(HERE/'pose_complete_cuff_author_v1.py')
    manifest['proposal']=dict(kind='Local exact-circle lap elbow displacement along measured shirt witness normals',
        preserved='All supported hand frames, reader, whole body arrangement, hips, feet, scale, rig and weights',
        controls=controls)
    target=output/'input-manifest.json';target.write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(manifest=str(target),sha256=digest(target),inputs=len(inputs),controls=controls)))


if __name__=='__main__':
    run()
