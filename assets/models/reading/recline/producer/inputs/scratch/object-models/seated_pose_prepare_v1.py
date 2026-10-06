"""Freeze the exact six-view diagnostic inputs without opening Blender."""
import ast
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUTPUT = HERE/'seated-pose-diagnostic-01'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run():
    inputs = {}
    receipts = ['book-grip-post-comparison-summary-01/proof.json',
                'book-grip-reading-compare-01/proof.json',
                'sofa-contact-solver-patch-replay-01/proof.json']
    for name in receipts:
        path = HERE/name
        receipt = json.loads(path.read_text())
        for filename, sha in receipt['inputs'].items():
            if filename in inputs and inputs[filename] != sha:
                raise ValueError('Conflicting retained input: '+filename)
            inputs[filename] = sha
        inputs[str(path)] = digest(path)
    sofa = HERE/receipts[-1]
    if digest(sofa) != '9636761657d8d701ee8f4225617fccfe62e517d2ae72824a0f3648adc3fd4fd1':
        raise ValueError('Unexpected sofa reference receipt')
    runner = HERE/'book_grip_reading_compare_v4.py'
    if digest(runner) != 'ece191709269844cbb5c488925d1a42170ffd7c799afb3cf5351eca876c7c2eb':
        raise ValueError('Unexpected retained book runner')
    for name in ['book-grip-reading-compare-01/proposal.npz',
                 'sofa-contact-solver-patch-replay-01/scene-00.npz',
                 'book-grip-static-views-01/proof.json',
                 'book-grip-alt2-replay-01/proof.json',
                 'sofa-derived-binding-03/proof.json',
                 'sofa-derived-binding-03/derived-waist-binding.blend',
                 'sofa-hand-support-01/proof.json',
                 'seated_pose_diagnostic_v1.py', 'seated_pose_native_v1.py', 'seated_pose_prepare_v1.py']:
        path = HERE/name
        inputs[str(path)] = digest(path)
    for name in ['sims/sim-01/registered-canvas-proof.json', 'seating/seat_export_contract.py',
                 'bedroom/double_bed_linear.py']:
        path = ROOT/'assets/models'/name
        inputs[str(path)] = digest(path)
    # Imported scratch helpers are recursively bound without importing bpy on the host.
    pending = [HERE/'seated_pose_diagnostic_v1.py', HERE/'seated_pose_native_v1.py']
    visited = set()
    while pending:
        path = pending.pop()
        if path in visited:
            continue
        visited.add(path)
        tree = ast.parse(path.read_text(encoding='utf-8-sig'), filename=str(path))
        inputs[str(path)] = digest(path)
        for node in ast.walk(tree):
            names = [alias.name for alias in node.names] if isinstance(node, ast.Import) else [node.module] if isinstance(node, ast.ImportFrom) else []
            for name in names:
                if name:
                    dependency = HERE/(name.split('.')[0]+'.py')
                    if dependency.is_file():
                        pending.append(dependency)
    mismatches = [name for name,sha in inputs.items() if digest(Path(name))!=sha]
    if mismatches:
        raise ValueError('Immutable input mismatch: '+repr(mismatches))
    book = json.loads((HERE/receipts[1]).read_text())
    sofa_receipt = json.loads(sofa.read_text())
    assert book['cases'][1]['label']=='proposal' and not book['cases'][1]['feasible']
    assert sofa_receipt['evaluations'][0]['label']=='common reference' and not sofa_receipt['evaluations'][0]['valid']
    assert book['cases'][1]['evaluated_frames']==book['observed_states'][1]['bone_matrices']
    OUTPUT.mkdir(exist_ok=False)
    launcher = 'C:/Users/myema/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe'
    argv = [launcher, '--background', '--threads', '2', '--python-exit-code', '1', '--python',
            str(HERE/'seated_pose_diagnostic_v1.py'), '--', str(OUTPUT/'input-manifest.json'), str(OUTPUT/'raw')]
    manifest = dict(state='prepared', inputs=inputs, input_count=len(inputs),
        scope='Six unchanged rejected-pose beauty diagnostics: book SE/SW/front/side and sofa common reference SE/SW; no fitting, gate changes or production acceptance',
        views=['book-SE','book-SW','book-close-front','book-close-side','sofa-SE','sofa-SW'],
        argv=argv, command=' '.join('"'+v+'"' if ' ' in v else v for v in argv),
        output=str(OUTPUT/'raw'),
        limits=dict(render_count=6, threads=2, seconds=300, minimum_free_gib=6, own_writer_stop_free_gib=4),
        estimated_seconds=dict(render_only=[12,45], with_startup_replay_and_hashing=[30,120]),
        estimate_basis='Historical book six-view images took 1.85-2.23 seconds each; sofa replay/render cost is unmeasured',
        image_contract=dict(book='Source16x; LANCZOS and alpha<=4 clearing',
                            sofa='Source8x; float-linear premultiplied BOX beauty reduction at logical1x and density2; no owner-layer compositor proof'),
        preparation_checks=dict(retained_receipts_match=True, all_inputs_hash_match=True,
                                python_ast_parse=True, saved_book_full_frames_match=True))
    (OUTPUT/'input-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(output=str(OUTPUT),inputs=len(inputs),manifest_sha256=digest(OUTPUT/'input-manifest.json'),
                          producer_sha256=digest(HERE/'seated_pose_diagnostic_v1.py'),command=manifest['command'])))


if __name__=='__main__':
    run()
