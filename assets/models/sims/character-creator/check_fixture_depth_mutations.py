from pathlib import Path
import hashlib,json,subprocess,os
root=Path.cwd();out=root/'docs/evidence/2026-10-12-full-character-creator/fixture-depth-check';results=[]
cases=[('missing-depth','web/src/frame.ts','    if(fixtureDepth!==undefined&&fixtureDepth!==null)writeRegisteredSurfaceDepth(scratch,i,fixtureDepth,gridSize);',''),('wrong-owner','web/src/render/sprites.wgsl','let sourcePixel = vec2i(round(surface.uv.xy * atlasSize)) + local;','let sourcePixel = vec2i(round(surface.uv.xy * atlasSize)) + local + vec2i(1, 0);')]
for name,relative,before,after in cases:
 p=root/relative;original=p.read_bytes();digest=hashlib.sha256(original).hexdigest()
 try:
  text=original.decode();assert text.count(before)==1;p.write_bytes(text.replace(before,after).encode())
  command='node assets/models/sims/character-creator/verify_fixture_depth.cjs';env=dict(os.environ,EVIDENCE_DIR=str(out/name))
  run=subprocess.run(command,cwd=root,shell=True,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=120);output=run.stdout.decode(errors='replace');(out/(name+'.log')).write_text(output)
  result={'name':name,'command':command,'exitCode':run.returncode,'rejected':run.returncode!=0 and 'Registered surface depth mismatch' in output,'sourceSha256':digest}
 finally:
  p.write_bytes(original);assert hashlib.sha256(p.read_bytes()).hexdigest()==digest
 result['exactRestoration']=True;results.append(result);print(json.dumps(result),flush=True)
 if not result['rejected']:raise SystemExit('Mutation escaped')
(out/'mutations.json').write_text(json.dumps(results,indent=2))
