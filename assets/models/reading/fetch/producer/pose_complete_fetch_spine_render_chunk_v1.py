"""Keep one retained Blender writer over at most eight frozen source views."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
import traceback

manifest_path,output=[Path(value).resolve() for value in sys.argv[sys.argv.index('--')+1:]]
manifest=json.loads(manifest_path.read_text())
output.mkdir()
report=dict(state='running',pid=os.getpid(),inputs=manifest['inputs'],views=[])
def save():
    (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n')
save()
started=time.monotonic()
try:
    if not 1<=len(manifest['views'])<=8:
        raise ValueError('A source writer must own one finite chunk of at most eight views')
    spec=importlib.util.spec_from_file_location('fetch_source_producer',manifest['producer_script'])
    producer=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(producer)
    for row in manifest['views']:
        if time.monotonic()-started>200:
            raise TimeoutError('Finite source chunk exceeded its own 200-second work budget')
        path=Path(row['manifest'])
        producer.run(path,Path(row['output']))
        proof_path=Path(row['output'])/'proof.json'
        proof=json.loads(proof_path.read_text())
        if proof['state']!='complete' or not proof['inputs_unchanged'] or proof['pid']!=os.getpid():
            raise ValueError('Source view lacks exact same-writer completion')
        report['views'].append(dict(key=row['key'],proof=str(proof_path),sha256=hashlib.sha256(proof_path.read_bytes()).hexdigest()))
        save()
    report['state']='complete'
except BaseException as error:
    report.update(state='failed',error=repr(error),traceback=traceback.format_exc())
    raise
finally:
    report.update(inputs_unchanged=all(hashlib.sha256(Path(path).read_bytes()).hexdigest()==expected for path,expected in manifest['inputs'].items()),elapsed_seconds=time.monotonic()-started)
    save()
