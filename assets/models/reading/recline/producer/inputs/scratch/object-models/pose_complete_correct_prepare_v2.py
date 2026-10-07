"""Freeze the final author and current-geometry source classification scripts."""
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run():
    original=HERE/'pose-complete-corrected-01/input-manifest.json'
    manifest=json.loads(original.read_text())
    inputs=dict(manifest['inputs']);inputs[str(original)]=digest(original)
    for name in ('pose_complete_correct_prepare_v2.py','pose_complete_correct_author_v2.py','pose_complete_correct_cached_v2.py'):
        path=HERE/name
        compile(path.read_text(encoding='utf-8-sig'),str(path),'exec')
        inputs[str(path)]=digest(path)
    if any(digest(p)!=sha for p,sha in inputs.items()):
        raise ValueError('Final corrected-scene dependency changed')
    output=HERE/'pose-complete-corrected-02';output.mkdir(exist_ok=False)
    manifest.update(inputs=inputs,outputs=dict(render=str(output/'raw'),cached=str(output/'cached'),native=str(output/'native')),
        compilation=dict(base_files=32,final_files=3,passed=True))
    manifest['jobs']['render_script']=str(HERE/'pose_complete_correct_author_v2.py')
    manifest['jobs']['cached_script']=str(HERE/'pose_complete_correct_cached_v2.py')
    target=output/'input-manifest.json';target.write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(manifest=str(target),sha256=digest(target),inputs=len(inputs),all_inputs_unchanged=True)))


if __name__=='__main__':
    run()
