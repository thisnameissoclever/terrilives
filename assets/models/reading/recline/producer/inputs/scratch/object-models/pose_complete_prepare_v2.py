"""Freeze the unchanged saved pose and its finite continuation jobs."""
import ast
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run():
    previous = HERE / 'seated-pose-chain-01'
    original = json.loads((previous / 'input-manifest.json').read_text())
    inputs = dict(original['inputs'])
    receipt = json.loads((previous / 'partial-output-hashes.json').read_text())
    for name, sha in receipt['files'].items():
        path = previous / name
        if digest(path) != sha:
            raise ValueError('Interrupted output changed: ' + name)
        inputs[str(path)] = sha
    for preserved in (HERE/'pose-complete-01/input-manifest.json', HERE/'pose-complete-01/cached/proof.json', HERE/'pose-complete-01/cached/witnesses.npz'):
        inputs[str(preserved)] = digest(preserved)
    inputs[str(previous / 'partial-output-hashes.json')] = digest(previous / 'partial-output-hashes.json')
    pending = [Path(__file__).resolve(), *HERE.glob('pose_complete_*.py')]
    visited = set()
    roots = [HERE, HERE.parents[1] / 'assets/models/living', HERE.parents[1] / 'assets/models/seating', HERE.parents[1] / 'assets/models/bedroom']
    while pending:
        path = pending.pop().resolve()
        if path in visited:
            continue
        visited.add(path)
        content = path.read_text(encoding='utf-8-sig')
        compile(content, str(path), 'exec')
        inputs[str(path)] = digest(path)
        for node in ast.walk(ast.parse(content)):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module] if isinstance(node, ast.ImportFrom) else []
            for name in names:
                if name:
                    for root in roots:
                        candidate = root / (name.split('.')[0] + '.py')
                        if candidate.is_file():
                            pending.append(candidate)
    launcher = HERE / 'pose_complete_launch_v2.ps1'
    inputs[str(launcher)] = digest(launcher)
    for path, sha in inputs.items():
        if digest(path) != sha:
            raise ValueError('Frozen dependency changed: ' + path)
    output = HERE / 'pose-complete-02'
    output.mkdir(exist_ok=False)
    manifest = dict(state='prepared', inputs=inputs, acceptance=False,
        previous_receipt_state=json.loads((previous / 'raw/proof.json').read_text())['state'],
        proposal='Continue unchanged saved scene; no pose, source or binding changes',
        limits=dict(render_seconds=180, cached_seconds=240, launcher_seconds=240, threads=2, minimum_free_gib=6, stop_own_writer_free_gib=4),
        jobs=dict(render_script=str(HERE / 'pose_complete_render_v1.py'), cached_script=str(HERE / 'pose_complete_cached_native_v2.py'), native_script=str(HERE / 'pose_complete_native_v1.py')),
        outputs=dict(render=str(output / 'raw'), cached=str(output / 'cached'), native=str(output / 'native')),
        known_failures=['Approximately 2.885 mm full-hand/book gap', 'Unchanged stiff outer sitting gestures'],
        validation=dict(compiled_files=len(visited), frozen_inputs_unchanged=True, interrupted_outputs_unchanged=True))
    target = output / 'input-manifest.json'
    target.write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(dict(manifest=str(target), sha256=digest(target), input_count=len(inputs), compiled_files=len(visited))))


if __name__ == '__main__':
    run()
