"""Record the local checks for this isolated candidate without publishing it."""
from pathlib import Path
import json,os,subprocess
ROOT=Path(__file__).resolve().parents[4]
OUT=ROOT/'docs/evidence/2026-10-12-character-appearance'
commands=[('web-tests','npm --prefix web test -- --maxWorkers=1'),('web-build','npm --prefix web run build')]
env=dict(os.environ,NODE_OPTIONS='--max-old-space-size=4096')
results=[]
for name,command in commands:
 with (OUT/(name+'.log')).open('w',encoding='utf-8') as log:
  result=subprocess.run(command,cwd=ROOT,shell=True,stdout=log,stderr=subprocess.STDOUT,env=env,timeout=900)
 row=dict(name=name,command=command,exitCode=result.returncode,verdict='PASS' if result.returncode==0 else 'FAIL')
 results.append(row);print(json.dumps(row),flush=True)
 (OUT/'local-checks.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
if any(row['exitCode'] for row in results):raise SystemExit(1)
