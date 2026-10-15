from pathlib import Path
import subprocess,os,json,hashlib
root=Path.cwd();out=root/'docs/evidence/2026-10-12-full-character-creator/final-checks';out.mkdir(parents=True,exist_ok=True)
commands=[('web','npm --prefix web test -- --maxWorkers=1 character- tests/input.test.ts tests/frame.test.ts tests/floor-finish-resources.test.ts tests/save-worker.test.ts tests/save-store.test.ts tests/persistence-controller.test.ts tests/legacy-save.test.ts'),('typecheck','npm --prefix web run typecheck'),('python','python -m unittest discover -s assets/models/sims/appearance-proof -p "test_*.py"'),('rust-character','cargo test --locked -j 1 -p terri-sim character_draft -- --test-threads=1'),('rust-save','cargo test --locked -j 1 -p terri-sim save::v9 -- --test-threads=1'),('build','npm --prefix web run build')]
results=[];env=dict(os.environ,NODE_OPTIONS='--max-old-space-size=4096',CARGO_BUILD_JOBS='1')
for name,command in commands:
 with (out/(name+'.log')).open('w',encoding='utf-8') as log:
  run=subprocess.run(command,cwd=root,shell=True,stdout=log,stderr=subprocess.STDOUT,env=env,timeout=900)
 row={'name':name,'command':command,'exitCode':run.returncode,'verdict':'PASS' if run.returncode==0 else 'FAIL'};results.append(row);print(json.dumps(row),flush=True);(out/'checks.json').write_text(json.dumps(results,indent=2))
 if run.returncode:raise SystemExit(run.returncode)
protected=json.loads((root/'assets/models/sims/appearance-proof/baseline-hashes.json').read_text());changed=[name for name,digest in protected.items() if hashlib.sha256((root/name).read_bytes()).hexdigest()!=digest]
(out/'protected-sources.json').write_text(json.dumps({'checked':len(protected),'changed':changed},indent=2));print('Protected sources changed:',changed,flush=True)
if changed:raise SystemExit(1)
