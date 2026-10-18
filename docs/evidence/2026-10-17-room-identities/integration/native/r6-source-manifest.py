from pathlib import Path
import hashlib,json,subprocess,sys
paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard']).decode().splitlines()
rows={p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in sorted(set(paths))
      if Path(p).is_file() and ((p.startswith(('crates/','content/')) and Path(p).suffix in ['.rs','.toml','.lock','.pack','.sav'])
      or p in ['Cargo.toml','Cargo.lock','assets/sprites/atlas.toml'] or p.startswith('web/public/audio/voice/'))}
digest=hashlib.sha256(''.join(p+'\0'+h+'\n' for p,h in rows.items()).encode()).hexdigest()
data={'source_sha256':digest,'base_commit':'e9fae39a1c9316ef88e1320c060dde76cc3eab24','files':rows}
Path(sys.argv[1]).write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'source_sha256':digest,'files':len(rows)}))
