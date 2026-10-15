"""Reject intentional creator defects and restore every source byte after each check."""
from pathlib import Path
import hashlib,json,subprocess,sys
ROOT=Path(__file__).resolve().parents[4]
OUT=ROOT/'docs/evidence/2026-10-12-full-character-creator/mutations'
OUT.mkdir(parents=True,exist_ok=True)
WEB='npm --prefix web test -- --maxWorkers=1 '
CASES=[
('atomic','crates/terri-sim/src/character_draft/application.rs','    validate_ties(world, draft, None)?;','', 'cargo test --locked -j 1 -p terri-sim invalid_request_changes_neither_person_nor_world -- --test-threads=1','FAILED'),
('edit_preservation','web/src/character/schema.ts','if(JSON.stringify(original[group])!==JSON.stringify(changed[group]))','',WEB+'tests/character-draft.test.ts','FAIL'),
('private_random_state','web/src/character/random.ts','let value = this.current = (this.current + 0x6d2b79f5) >>> 0;','let value = (this.current + 0x6d2b79f5) >>> 0;',WEB+'tests/character-random.test.ts','FAIL'),
('random_restore','web/src/character/draft.ts','this.rng = new DraftRandom(checkpoint.state);','',WEB+'tests/character-draft.test.ts','FAIL'),
('locks','web/src/character/draft.ts','this.locked.has(field.id) || ','',WEB+'tests/character-draft.test.ts','FAIL'),
('appearance','web/src/render/character/renderer.ts','this.deformed = shapeVertices(this.geometry.cage, this.shape, this.top);\n    this.subdivision.update(this.deformed);','this.deformed = shapeVertices(this.geometry.cage, this.shape, this.top);','node assets/models/sims/character-creator/verify_gpu.cjs','GPU appearance differs'),
('depth','web/src/render/character/compositor.ts','this.placement.set([...rect, ...viewport, depth, step]);','this.placement.set([...rect, ...viewport, depth, 0]);','node assets/models/sims/appearance-proof/verify-browser.cjs --quick --output=docs/evidence/2026-10-12-full-character-creator/mutations/depth','Depth partition failed'),
('reload','crates/terri-sim/src/save/v9.rs','        candidate\n            .world_mut()\n            .entity_mut(entity)\n            .insert((row.appearance, CharacterPronouns(row.pronouns)));','', 'cargo test --locked -j 1 -p terri-sim appearance_and_interleaved_queued_edits_survive_exact_round_trip -- --test-threads=1','FAILED'),
]
results=[]
for name,relative,before,after,command,expected in CASES:
 if len(sys.argv)>1 and name not in sys.argv[1:]:continue
 target=ROOT/relative;original=target.read_bytes();digest=hashlib.sha256(original).hexdigest()
 try:
  source=original.decode();newline='\r\n' if b'\r\n' in original else '\n';before=before.replace('\n',newline);after=after.replace('\n',newline)
  assert source.count(before)==1,(name,'ambiguous mutation',source.count(before))
  target.write_bytes(source.replace(before,after).encode())
  run=subprocess.run(command,cwd=ROOT,shell=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=240)
  output=run.stdout.decode(errors='replace');(OUT/(name+'.log')).write_text(output,encoding='utf-8')
  result={'name':name,'command':command,'exitCode':run.returncode,'rejected':run.returncode!=0 and expected in output,'sourceSha256':digest}
 finally:
  target.write_bytes(original);assert hashlib.sha256(target.read_bytes()).hexdigest()==digest
 result['exactRestoration']=True;results.append(result);print(json.dumps(result),flush=True)
 (OUT/'results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
 if not result['rejected']:raise SystemExit('Mutation escaped its intended check: '+name)
