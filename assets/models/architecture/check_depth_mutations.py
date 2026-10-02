"""Prove common depth and joined/arched wall cores with exact restoration."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

BASE=Path(__file__).resolve().parent
CONFIG=BASE.parent/'architecture-depth.json'
RUNNER="""import json,sys,unittest
suite=unittest.defaultTestLoader.loadTestsFromName(sys.argv[1])
result=unittest.TestResult();suite.run(result)
print(json.dumps({'testsRun':result.testsRun,'failures':[str(t) for t,_ in result.failures],'errors':[str(t) for t,_ in result.errors]}))
sys.exit(0 if result.wasSuccessful() else 1)
"""


def probe(name):
    command=[sys.executable,'-B','-c',RUNNER,'test_geometry.ArchitectureGeometry.'+name]
    result=subprocess.run(command,cwd=BASE,capture_output=True,text=True)
    parsed=json.loads(result.stdout)
    assert parsed['testsRun']==1 and not parsed['errors'], result.stdout+result.stderr
    return {'command':command,'exitCode':result.returncode,'result':parsed}


def run(output):
    assert not output.exists(), 'Never overwrite mutation evidence'
    records=[]
    changes=[('shared depth',CONFIG,'"wallAndDoorDepth": 0.14','"wallAndDoorDepth": 0.12','test_architecture_dimensions'),
        ('junction depth',BASE/'walls.py','half=WALL_THICKNESS/2','half=.06','test_joined_and_arched_plaster_share_both_wall_faces'),
        ('arch infill depth',BASE/'windows.py',"-WALL_THICKNESS/2,WALL_THICKNESS/2,'plaster'","-.06,.06,'plaster'",'test_joined_and_arched_plaster_share_both_wall_faces')]
    for name,path,old,new,target in changes:
        before=path.read_bytes();text=before.decode();assert old in text
        baseline=probe(target);assert baseline['exitCode']==0
        row={'mutation':name,'source':str(path),'beforeSha256':hashlib.sha256(before).hexdigest(),'baseline':baseline}
        records.append(row)
        def save(): output.write_text(json.dumps({'mutations':records},indent=2)+'\n')
        save()
        try:
            path.write_bytes(text.replace(old,new).encode())
            control=probe('test_projection_and_rotation_keep_physical_registration')
            assert control['exitCode']==0
            failure=probe(target);assert failure['exitCode']==1 and failure['result']['failures']
            row.update(mutatedCleanControl=control,targetedFailure=failure)
            save()
        finally:
            path.write_bytes(before);assert path.read_bytes()==before
            row['restoredSha256']=hashlib.sha256(path.read_bytes()).hexdigest();save()
        restored=probe(target);assert restored['exitCode']==0
        row['restoredTarget']=restored;save()
    print('PASS3 depth mechanisms; valid clean controls, intended failures and exact restored targets')


if __name__=='__main__': run(Path(sys.argv[1]).resolve())
