import hashlib,json,os,re,subprocess,time
from pathlib import Path
root=Path('.superpowers/sdd/2026-10-17-room-identities')
paths=[Path('crates/terri-sim/src/systems/lot_edit.rs'),Path('crates/terri-sim/src/build_transaction.rs')]
original={str(p):p.read_bytes() for p in paths}
sha=lambda data:hashlib.sha256(data).hexdigest()
proof={'method':'two isolated fault executions in one instrumented build','head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'original':{p:sha(data) for p,data in original.items()},'cases':[]}
index_before=subprocess.check_output(['git','diff','--cached','--binary'])
assert not subprocess.check_output(['git','diff','--',*map(str,paths)]), 'source must start clean'
assert not index_before, 'index must start clean'
for p,data in original.items():
 (root/(Path(p).name+'.fault-original')).write_bytes(data)

def replace_once(path,old,new):
 data=Path(path).read_bytes()
 newline=b'\r\n' if b'\r\n' in data else b'\n'
 before=old.encode().replace(b'\n',newline)
 after=new.encode().replace(b'\n',newline)
 assert data.count(before)==1,(path,'ambiguous instrumentation site')
 Path(path).write_bytes(data.replace(before,after))

def run_case(name,test,flag):
 env=os.environ.copy();env.pop('TERRI_R5_FAULT',None)
 if flag:env['TERRI_R5_FAULT']=flag
 command=[executable,test,'--exact','--test-threads=1']
 with (root/f'task-5-accepted-fault-{name}.log').open('w',encoding='utf-8') as log:
  result=subprocess.run(command,env=env,stdout=log,stderr=subprocess.STDOUT)
 text=(root/f'task-5-accepted-fault-{name}.log').read_text(encoding='utf-8')
 row={'name':name,'flag':flag,'command':command,'exit':result.returncode}
 proof['cases'].append(row)
 print(json.dumps(row),flush=True)
 if flag is None:assert result.returncode==0,'neutral control failed'
 else:
  assert result.returncode!=0,'fault escaped'
  assert f'test {test} ... FAILED' in text,'wrong test failure'
  if flag=='deferral':assert 'temporary ineligibility must not prune suspended work' in text,'wrong deferral assertion'
  else:assert 'left: Ok(())' in text and 'right: Err(StaleToken)' in text,'wrong token assertion'

try:
 replace_once(paths[0],
  '    if world.contains_resource::<crate::build_transaction::BuildTransaction>() {',
  '    if world.contains_resource::<crate::build_transaction::BuildTransaction>()\n        && std::env::var("TERRI_R5_FAULT").ok().as_deref() != Some("deferral")\n    {')
 replace_once(paths[1],
  '                p.review.token == token\n                    && token.session == b.session\n                    && token.revision == b.revision',
  '                std::env::var("TERRI_R5_FAULT").ok().as_deref() == Some("stale")\n                    || (p.review.token == token\n                        && token.session == b.session\n                        && token.revision == b.revision)')
 proof['instrumented']={str(p):sha(p.read_bytes()) for p in paths}
 (root/'task-5-accepted-fault-instrumentation.diff').write_bytes(subprocess.check_output(['git','diff','--',*map(str,paths)]))
 command=['cargo','test','-p','terri-sim','--lib','--no-run','--locked','--jobs','1','--message-format=json']
 build_env=os.environ.copy();build_env['CARGO_BUILD_JOBS']='1';build_env.pop('TERRI_R5_FAULT',None)
 with (root/'task-5-accepted-fault-build.log').open('w',encoding='utf-8') as log:
  result=subprocess.run(command,env=build_env,stdout=subprocess.PIPE,stderr=log,text=True)
 (root/'task-5-accepted-fault-artifacts.jsonl').write_text(result.stdout,encoding='utf-8')
 proof['build']={'command':command,'exit':result.returncode}
 assert result.returncode==0,'instrumented build failed'
 artifacts=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
 executable=next(row['executable'] for row in reversed(artifacts) if row.get('reason')=='compiler-artifact' and row.get('target',{}).get('name')=='terri_sim' and row.get('executable'))
 proof['instrumented_executable_sha256']=sha(Path(executable).read_bytes())
 deferral='build_transaction::cases::temporary_paving_removal_preserves_suspended_work'
 stale='build_transaction::cases::tokens_never_resurrect_after_load_cancel_exit_or_repeated_submit'
 run_case('deferral-control',deferral,None)
 run_case('stale-control',stale,None)
 run_case('deferral',deferral,'deferral')
 run_case('stale',stale,'stale')
 proof['accepted']=True
finally:
 for p,data in original.items():Path(p).write_bytes(data)
 proof['restored']={str(p):sha(p.read_bytes()) for p in paths}
 proof['source_bytes_restored']=proof['restored']==proof['original']
 proof['source_diff_empty']=not subprocess.check_output(['git','diff','--',*map(str,paths)])
 proof['index_unchanged']=subprocess.check_output(['git','diff','--cached','--binary'])==index_before
 proof['git_status']=subprocess.check_output(['git','status','--short'],text=True)
 (root/'task-5-accepted-fault-proof.json').write_text(json.dumps(proof,indent=2),encoding='utf-8')
 assert proof['source_bytes_restored'] and proof['source_diff_empty'] and proof['index_unchanged'],'restoration failure'
 print(json.dumps({key:proof[key] for key in ['source_bytes_restored','source_diff_empty','index_unchanged','git_status']}),flush=True)
