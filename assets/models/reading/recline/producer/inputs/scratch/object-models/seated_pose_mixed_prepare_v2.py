"""Freeze one deliberate mixed-sofa composition and its bounded diagnostic job."""
import ast
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
OUTPUT=HERE/'seated-pose-mixed-02'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run():
    prior=HERE/'seated-pose-diagnostic-01/input-manifest.json'
    inputs=dict(json.loads(prior.read_text())['inputs'])
    inputs[str(prior)]=digest(prior)
    for name in ('seated-pose-mixed-01/raw/proof.json','seated-pose-mixed-01/raw/raw-crossings.npz'):
        inputs[str(HERE/name)]=digest(HERE/name)
    pending=[Path(__file__),HERE/'seated_pose_mixed_v2.py',HERE/'seated_pose_mixed_native_v1.py']
    seen=set()
    while pending:
        path=pending.pop()
        if path in seen:
            continue
        seen.add(path)
        inputs[str(path)]=digest(path)
        tree=ast.parse(path.read_text(encoding='utf-8-sig'),filename=str(path))
        for node in ast.walk(tree):
            names=[a.name for a in node.names] if isinstance(node,ast.Import) else [node.module] if isinstance(node,ast.ImportFrom) else []
            for name in names:
                if name and (HERE/(name.split('.')[0]+'.py')).is_file():
                    pending.append(HERE/(name.split('.')[0]+'.py'))
    changed=[p for p,s in inputs.items() if digest(p)!=s]
    if changed:
        raise ValueError('Frozen input changed: '+repr(changed))
    proposal=dict(actors=[dict(activity='sit',forward_degrees=2,outward_degrees=6,head_relative_degrees=0),
                          dict(activity='read',forward_degrees=8,outward_degrees=0,head_relative_degrees=15),
                          dict(activity='sit',forward_degrees=5,outward_degrees=-6,head_relative_degrees=0)],
                  book=dict(center=[0,-.8,1.17],pitch_degrees=-45,palm_y=-.025,palm_z=.03),
                  construction='Second authored composition; full palm/thumb/forearm side grip; neutral local outer wrists; no optimization or alternate candidate loop',
                  scope='Keep known supported lower bodies initially; reuse exact existing derived waist binding; all moved surfaces require fresh diagnostics')
    argv=['C:/Users/myema/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe','--background','--threads','2',
          '--python-exit-code','1','--python',str(HERE/'seated_pose_mixed_v2.py'),'--',str(OUTPUT/'input-manifest.json'),str(OUTPUT/'raw')]
    record=dict(state='prepared',inputs=inputs,proposal=proposal,argv=argv,
                limits=dict(proposals=1,renders=4,threads=2,seconds=180,minimum_free_gib=6,stop_own_writer_free_gib=4),
                cost=dict(expected_seconds=[45,120],hard_ceiling_seconds=180,paid_generation=0),
                images=['SE','SW','reader-front','reader-side'],
                reductions='Source8x; existing float-linear premultiplied BOX beauty reference at density1 and density2',
                acceptance=False)
    OUTPUT.mkdir(exist_ok=False)
    (OUTPUT/'input-manifest.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps(dict(input_count=len(inputs),output=str(OUTPUT),producer_sha256=digest(HERE/'seated_pose_mixed_v2.py'),
                         manifest_sha256=digest(OUTPUT/'input-manifest.json'),argv=argv)))


if __name__=='__main__':
    run()
