"""Export this conversation's stash commits without applying or dropping them."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OWNED = ['fa65db11465a2a1ef2e98bf9a43ef85f79fc4dc3',
         '603386124df8434496c40e4eeae3188ea74bb667',
         'f8e9208e999967b681b6984f471791b250a5dc3b',
         'd6cf83cc8ff474505fa85bec8990af2d3b059174',
         '60c8b6bab1e500da9196339bae555013b3c00338',
         '5e44db2fadb354ff11e9ce8f5db68c9554c0a23d',
         'dcf9d46e0c0bb93113415e7d9fe1a205ec9bda29']


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode().strip()


def capture():
    rows, refs = [], []
    for sha in OWNED:
        ref = 'refs/handoffs/animation-resume/'+sha
        current = subprocess.run(['git', 'show-ref', '--verify', '--hash', ref], cwd=ROOT,
                                 capture_output=True, text=True)
        if current.returncode == 0 and current.stdout.strip() != sha:
            raise SystemExit('Existing handoff ref differs: '+ref)
        if current.returncode != 0:
            subprocess.run(['git', 'update-ref', ref, sha, '0'*40], cwd=ROOT, check=True)
        refs.append(ref)
        parents = git('show', '-s', '--format=%P', sha).split()
        tracked = git('diff', '--name-only', parents[0], sha).splitlines()
        untracked = git('ls-tree', '-r', '--name-only', parents[2]).splitlines() if len(parents) > 2 else []
        if any(Path(name).name.startswith('.env') or name.startswith('.tmp/') for name in tracked+untracked):
            raise SystemExit('Private path in owned stash; inspect before packaging: '+sha)
        rows.append(dict(commit=sha, ref=ref, subject=git('show', '-s', '--format=%s', sha),
                         base=parents[0], parents=parents, tracked_paths=tracked, untracked_paths=untracked))
    subprocess.run(['git', 'bundle', 'create', str(HERE/'owned-stashes.bundle'), *refs,
                    '^1a138df6438d5e984f6190956b46aaf9a69f4dc9'], cwd=ROOT, check=True)
    (HERE/'owned-stashes.json').write_text(json.dumps(dict(version=1, stashes=rows,
        excluded='Other tasks and unattributed mood/waiting autostashes were not modified or packaged.'),
        indent=2)+'\n', newline='\n')
    print('Packaged '+str(len(rows))+' owned stashes')


if __name__ == '__main__':
    capture()
