from pathlib import Path
import subprocess,os,json
root=Path.cwd();out=root/'docs/evidence/2026-10-12-full-character-creator/final-checks';results=[]
commands=[('fixture-depth-final','node assets/models/sims/character-creator/verify_fixture_depth.cjs',{}),('wiping-final','node assets/models/sims/character-creator/capture_wiping_contact.cjs',{'EVIDENCE_DIR':'docs/evidence/2026-10-12-full-character-creator/wiping-contact-final'}),('recovery-final','node assets/models/sims/character-creator/verify_lifecycle.cjs',{}),('depth-regressions','npm --prefix web test -- --maxWorkers=1 tests/fixture-depth.test.ts tests/grime.test.ts tests/frame.test.ts tests/sprite-density.test.ts tests/instances.test.ts tests/dining-table-support.test.ts tests/fridge-reach-production.test.ts tests/character-world-contract.test.ts tests/character-device-lifetime.test.ts tests/floor-finish-resources.test.ts tests/floor-scene-presentation.test.ts',{}),('typecheck-final','npm --prefix web run typecheck',{}),('build-final','npm --prefix web run build',{})]
for name,command,extra in commands:
 env=dict(os.environ,NODE_OPTIONS='--max-old-space-size=4096',CARGO_BUILD_JOBS='1',**extra)
 with (out/(name+'.log')).open('w',encoding='utf-8') as log:run=subprocess.run(command,cwd=root,shell=True,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=600)
 row={'name':name,'command':command,'exitCode':run.returncode,'verdict':'PASS' if run.returncode==0 else 'FAIL'};results.append(row);print(json.dumps(row),flush=True);(out/'depth-followthrough.json').write_text(json.dumps(results,indent=2))
 if run.returncode:raise SystemExit(run.returncode)
