"""Exercise creator faults only in a copied source tree, never the live server."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess

root = Path(__file__).resolve().parents[2]
lab = root / '.scratch/creator-repair-validation'
out = root / 'docs/evidence/2026-10-13-creator-repair/draft-mutations'
out.mkdir(exist_ok=True)
for name in ['src', 'tests']:
    target = lab/'web'/name
    if target.is_symlink() or target.is_junction():
        raise RuntimeError('Mutation source must be an independent directory')
    shutil.copytree(root/'web'/name, target, dirs_exist_ok=True)

cases = [
    ('field-lock', 'src/character/draft.ts', 'field===gender || this.locked.has(field.id) ||', 'field===gender ||', 'tests/creator-repair.test.ts'),
    ('undo-random-state', 'src/character/draft.ts', 'this.rng = new DraftRandom(checkpoint.state);', '', 'tests/character-draft.test.ts'),
    ('unchanged-save-groups', 'src/character/schema.ts', 'if(JSON.stringify(original[group])!==JSON.stringify(changed[group]))', '', 'tests/character-draft.test.ts'),
    ('seeded-draw-progression', 'src/character/random.ts', 'let value = this.current = (this.current + 0x6d2b79f5) >>> 0;', 'let value = (this.current + 0x6d2b79f5) >>> 0;', 'tests/character-random.test.ts'),
]
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
live = {relative: digest(root/'web'/relative) for _,relative,_,_,_ in cases}
environment = {**os.environ, 'NODE_OPTIONS': '--max-old-space-size=4096'}
def run(name, tests):
    command = ['npx.cmd', 'vitest', 'run', '--maxWorkers=1', *tests]
    result = subprocess.run(command, cwd=lab/'web', env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
    output = result.stdout.decode('utf-8', errors='replace')
    (out/(name+'.log')).write_bytes(output.encode('utf-8'))
    return {'command':command, 'exitCode':result.returncode}, output

receipt = {'liveBefore':live, 'mutants':[]}
tests = sorted({case[-1] for case in cases})
receipt['baseline'], output = run('baseline', tests)
if receipt['baseline']['exitCode'] != 0:
    raise RuntimeError('Baseline failed; no mutation result is valid')
for name, relative, before, after, test in cases:
    target = lab/'web'/relative
    original = target.read_bytes()
    try:
        source = original.decode('utf-8')
        if source.count(before) != 1:
            raise RuntimeError(f'{name}: mutation target is not unique')
        target.write_bytes(source.replace(before,after).encode('utf-8'))
        result, output = run(name,[test])
        killed = result['exitCode'] != 0 and 'AssertionError' in output
        receipt['mutants'].append({'name':name,**result,'killed':killed})
        if not killed:
            raise RuntimeError(f'{name}: intended behavioral assertion did not reject fault')
    finally:
        target.write_bytes(original)
        assert digest(target)==hashlib.sha256(original).hexdigest()
        assert all(digest(root/'web'/p)==sha for p,sha in live.items())
        (out/'receipt.json').write_bytes(json.dumps(receipt,indent=2).encode('utf-8'))
receipt['restored'], output = run('restored',tests)
assert receipt['restored']['exitCode']==0
receipt['liveAfter']={relative:digest(root/'web'/relative) for relative in live}
assert receipt['liveAfter']==live
receipt['status']='PASS'
(out/'receipt.json').write_bytes(json.dumps(receipt,indent=2).encode('utf-8'))
print(json.dumps({'status':receipt['status'],'killed':len(receipt['mutants']),'liveUnchanged':True}))
