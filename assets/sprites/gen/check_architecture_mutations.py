"""Remove import guards, require the regression test to fail, restore exact bytes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[3]
IMPORTER=ROOT/'assets/sprites/gen/offline_architecture.py'
SCENE=ROOT/'assets/models/architecture/check_scene.py'
COMMAND=[sys.executable,'-B','-m','unittest','discover','-s','assets/sprites/gen',
         '-p','test_offline_architecture.py']


def run(destination):
    evidence=[]
    changes=[('missing model',IMPORTER,'missing window model'),
             ('width',IMPORTER,'window width changed'),
             ('direction',IMPORTER,'window direction changed'),
             ('depth registration',IMPORTER,'depth registration changed'),
             ('sill contact',SCENE,'detached sill'),
             ('split ownership',IMPORTER,'overlapping split ownership')]
    for name,path,message in changes:
        before=path.read_bytes(); text=before.decode()
        lines=text.splitlines(keepends=True)
        changed=''.join(line for line in lines if not ('assert ' in line and message in line))
        assert changed!=text, 'mutation did not remove a guard'
        try:
            path.write_bytes(changed.encode())
            result=subprocess.run(COMMAND,cwd=ROOT,capture_output=True,text=True)
            assert result.returncode!=0, f'guard deletion survived: {name}'
            output=result.stdout+result.stderr
            assert 'test_named_mutations_fail_and_unchanged_source_passes' in output, 'failure did not reach the intended test'
            evidence.append({'mutation':name,'removedGuard':message,'command':COMMAND,
                             'exitCode':result.returncode,'output':output})
        finally:
            path.write_bytes(before)
            assert path.read_bytes()==before, 'mutation restoration changed source'
        evidence[-1]['restoredSha256']=hashlib.sha256(before).hexdigest()
    clean=subprocess.run(COMMAND,cwd=ROOT,capture_output=True,text=True)
    assert clean.returncode==0, clean.stdout+clean.stderr
    destination.write_text(json.dumps({'mutations':evidence,'restored':{'command':COMMAND,
        'exitCode':clean.returncode,'output':clean.stdout+clean.stderr}},indent=2)+'\n')
    print(f'{len(evidence)} guard deletions detected; exact source restored; clean importer suite passed')


if __name__=='__main__': run(Path(sys.argv[1]))
