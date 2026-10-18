from pathlib import Path
from dataclasses import replace
import hashlib,json,subprocess,sys,tomllib
root=Path.cwd()
sys.path.insert(0,str(root/'assets/sprites/gen'))
from offline_architecture import load_reviewed_architecture,generated_files,is_current,obsolete_files,PUBLIC
main='513c86be2aa44fb4d5576279d0e1ae69991e870e'
protected=['assets/sprites/atlas.toml','web/src/render/atlas.ts','web/public','assets/models/outdoor','assets/models/static-props-07.json','assets/models/sims/character-repair/outdoor-depth','web/src/render/fixture-depth.ts','assets/sprites/gen/build.py']
assert not subprocess.check_output(['git','diff',main,'--',*protected]),'Incoming art/depth changed'
config=json.loads(Path('assets/models/architecture/architecture.json').read_text())
ext=next(row for row in config['historicalExtensions'] if row['catalog']=='assets/models/static-props-07.json')
catalog=json.loads(Path(ext['catalog']).read_text())
assert hashlib.sha256(json.dumps(catalog,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()==ext['canonicalSha256']
count=len(tomllib.loads(Path('assets/sprites/atlas.toml').read_text())['sprite'])
assert count==30939
batch=load_reviewed_architecture()
files=generated_files(batch,count)
descriptor=root/'web/src/render/architecture-data.ts'
base=generated_files(replace(batch,catalogue_extensions=()),count)
incoming=subprocess.check_output(['git','show',main+':web/src/render/architecture-data.ts'])
assert base[descriptor]==incoming,'Base generated architecture must equal exact incoming descriptor'
changed=[path for path,want in files.items() if not is_current(path,want)]
assert set(changed)<={descriptor},[str(path) for path in changed]
assert not obsolete_files(PUBLIC,set(files)),'Unexpected obsolete architecture outputs'
for path,want in files.items():
    if path!=descriptor:assert want==base[path],path
data=json.loads(files[descriptor].decode().split('export const ARCHITECTURE = ')[1].removesuffix(' as const;\n'))
assert data['baseSpriteId']==30939 and data['catalogue']['coverings']['4']=='floor.outdoor-patio'
before=descriptor.read_bytes()
if descriptor in changed:descriptor.write_bytes(files[descriptor])
for path,want in files.items():assert is_current(path,want),path
proof={'main':main,'historical_sprite_count':count,'base_descriptor_sha256':hashlib.sha256(incoming).hexdigest(),'combined_descriptor_sha256':hashlib.sha256(files[descriptor]).hexdigest(),'before_sha256':hashlib.sha256(before).hexdigest(),'changed_files':[str(p.relative_to(root)) for p in changed],'validated_generated_outputs':len(files),'other_architecture_outputs_identical':True,'incoming_art_paths_unchanged':protected,'resources':{str(path.relative_to(root)):hashlib.sha256(path.read_bytes()).hexdigest() for path in files}}
Path('.local-build/v16-yard-architecture.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({k:v for k,v in proof.items() if k!='resources'}))
