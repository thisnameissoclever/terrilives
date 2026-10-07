"""Freeze the one complete evaluated candidate from both cache-screened lap placements."""
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run():
    original=HERE/'pose-complete-cuff-01/input-manifest.json';manifest=json.loads(original.read_text())
    inputs=dict(manifest['inputs'])
    fit_path=HERE/'pose-complete-supported-transfer-01/proof.json';fit=json.loads(fit_path.read_text())
    if fit['state']!='cached_pass' or not fit['inputs_unchanged'] or set(fit['selected'])!={'0','2'} or any(not r['valid'] for r in fit['selected'].values()):
        raise ValueError('Both supported lap placements must pass the cached screen')
    for path in (original,fit_path,HERE/'pose-complete-supported-transfer-01/witnesses.npz',
        HERE/'pose_complete_supported_author_prepare_v1.py',HERE/'pose_complete_supported_author_v1.py',HERE/'pose_complete_supported_author_frames_v1.py',
        HERE/'pose-complete-cuff-01/raw/proof.json'):
        if path.suffix=='.py':
            compile(path.read_text(),str(path),'exec')
        inputs[str(path)]=digest(path)
    if any(digest(p)!=sha for p,sha in inputs.items()):
        raise ValueError('Supported evaluated candidate source changed')
    data=json.loads(Path(manifest['prepared_frames']).read_text())
    data['prior']=json.loads((HERE/'pose-complete-cuff-01/raw/proof.json').read_text())['full_states']
    for seat in(0,2):
        data['resting'][seat]['selected']=fit['selected'][str(seat)]
    output=HERE/'pose-complete-supported-author-01';output.mkdir(exist_ok=False)
    prepared=output/'prepared-frames.json';prepared.write_text(json.dumps(data,indent=2)+'\n');inputs[str(prepared)]=digest(prepared)
    manifest.update(inputs=inputs,prepared_frames=str(prepared),outputs=dict(render=str(output/'raw'),cached=str(output/'cached'),native=str(output/'native')))
    manifest['jobs']['render_script']=str(HERE/'pose_complete_supported_author_v1.py')
    manifest['proposal']=dict(kind='One complete evaluated scene from both finite-support/zero-cuff-contact cache survivors',
        preserved='Reader grip and all reader frames, torso/hips/feet, armrest hands, source geometry/weights/skeleton/scale')
    target=output/'input-manifest.json';target.write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(manifest=str(target),sha256=digest(target),inputs=len(inputs))))


if __name__=='__main__':
    run()
