from pathlib import Path
import hashlib,json,subprocess,sys
proof=json.loads(Path('.superpowers/sdd/2026-10-17-room-identities/task-5-accepted-fault-proof.json').read_text())
assert proof['accepted'] and proof['source_bytes_restored'] and proof['index_unchanged']
for path,digest in proof['restored'].items():
    raw=Path(path).read_bytes()
    assert hashlib.sha256(raw).hexdigest()==digest,path
    assert b'TERRI_R5_FAULT' not in raw,path
paths=set(subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard']).decode().splitlines())
rows={path:hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in sorted(paths)
      if Path(path).is_file() and ((path.startswith(('crates/','content/')) and Path(path).suffix in ['.rs','.toml','.lock','.pack','.sav'])
      or path in ['Cargo.toml','Cargo.lock','assets/sprites/atlas.toml'] or path.startswith('web/public/audio/voice/'))}
digest=hashlib.sha256(''.join(path+'\0'+sha+'\n' for path,sha in rows.items()).encode()).hexdigest()
data={'source_sha256':digest,'files':rows,'accepted_fault_source_restored':proof['restored'],'fault_instrumentation_absent':True,'incoming_main':'513c86be2aa44fb4d5576279d0e1ae69991e870e'}
Path(sys.argv[1] if len(sys.argv)>1 else '.local-build/v16-yard-source.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'source_sha256':digest,'files':len(rows),'fault_instrumentation_absent':True}))
