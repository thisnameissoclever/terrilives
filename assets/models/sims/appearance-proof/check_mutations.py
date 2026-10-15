"""Deliberately break four proof contracts and require their checks to reject them."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[4]
OUT=ROOT/'docs/evidence/2026-10-12-character-appearance'
WEB='npm --prefix web test -- --maxWorkers=1 tests/character-appearance.test.ts'
BROWSER='node assets/models/sims/appearance-proof/verify-browser.cjs --quick'
CASES=[
 ('parameter','web/src/render/character/renderer.ts','    this.subdivision.update(this.deformed);','    // Mutation: omit configured cage upload.',BROWSER,'GPU must apply height'),
 ('locks','web/src/render/character/appearance.ts','      if (this.locks.has(field)) continue;','      // Mutation: ignore locks.',WEB,'FAIL'),
 ('depth','web/src/render/character/compositor.ts','...viewport, depth, step]','...viewport, depth, 0]',BROWSER,'Depth partition failed'),
 ('reload','web/src/render/character/appearance.ts','this.value = saved ? parseAppearance(JSON.stringify(saved)) : neutralAppearance();','this.value = neutralAppearance();',WEB,'FAIL'),
 ('continuous_walk','web/src/render/character/motion.ts','t=frame-Math.floor(frame);','t=0;','npm --prefix web test -- --maxWorkers=1 character-motion.test.ts','FAIL'),
 ('world_picking','web/src/render/character/world-picking.ts','if(depth<=visible+0.00000012)','if(depth<=1.0+visible)','node assets/models/sims/appearance-proof/verify_motion.cjs --quick','World picking did not cover'),
 ('cleanup','web/src/render/character/renderer.ts','    this.subdivision.destroy();','    // Mutation: leave subdivision resources alive.','node assets/models/sims/appearance-proof/verify_motion.cjs --quick','Owned GPU resources remain'),
 ('standing_endpoint','web/src/render/character/motion.ts','    standingWorld[13]-=.355;','    // Mutation: omit forward placement.','npm --prefix web test -- --maxWorkers=1 character-motion.test.ts','FAIL'),
 ('book_grip','web/src/render/character/pose.ts','      matrices[hand] = multiply(bookMovement, sample.grip[hand]);','      matrices[hand] = [...sample.grip[hand]];','npm --prefix web test -- --maxWorkers=1 character-motion.test.ts -t "keeps both wrist grips"','FAIL'),
 ('invalid_storage','web/src/render/character/draft-storage.ts','  if (text === null) return','  if (!text) return','npm --prefix web test -- --maxWorkers=1 character-draft-storage.test.ts','FAIL'),
]
results=json.loads((OUT/'mutations.json').read_text()) if len(sys.argv)>1 else []
for name,relative,before,after,command,expected in CASES:
 if len(sys.argv)>1 and name!=sys.argv[1]:continue
 results=[r for r in results if r['name']!=name]
 p=ROOT/relative; original=p.read_bytes(); digest=hashlib.sha256(original).hexdigest()
 try:
  source=original.decode('utf-8');assert source.count(before)==1,(name,'ambiguous mutation')
  p.write_bytes(source.replace(before,after).encode('utf-8'))
  run=subprocess.run(command,cwd=ROOT,shell=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=150)
  output=run.stdout.decode('utf-8',errors='replace');(OUT/(name+'-mutation.log')).write_text(output,encoding='utf-8')
  result=dict(name=name,command=command,exitCode=run.returncode,rejected=run.returncode!=0 and expected in output,sourceSha256=digest)
 finally:
  p.write_bytes(original)
  assert hashlib.sha256(p.read_bytes()).hexdigest()==digest
 result['exactRestoration']=True;results.append(result);print(json.dumps(result),flush=True)
(OUT/'mutations.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
if not all(r['rejected'] for r in results):raise SystemExit('A mutation escaped its expected check')
