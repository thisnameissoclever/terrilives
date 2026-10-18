from pathlib import Path
import datetime,hashlib,json,os,re,subprocess,sys
assert json.loads(Path('.local-build/v16-yard-build-02.json').read_text())['exit_code']==0
source=json.loads(Path('.local-build/v16-yard-source-02.json').read_text())
for path,digest in source['files'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==digest,path
artifact=None
for line in Path('.local-build/v16-yard-build-02.log').read_text().splitlines():
    if not line.startswith('{'):continue
    row=json.loads(line)
    if row.get('reason')=='compiler-artifact' and row.get('target',{}).get('name')=='terri_wasm' and row.get('executable'):
        artifact={'path':row['executable'],'sha256':hashlib.sha256(Path(row['executable']).read_bytes()).hexdigest()}
assert artifact
command=[artifact['path'],'--test-threads=1']
env=os.environ.copy();env.pop('TERRI_R5_FAULT',None)
log=Path('.local-build/v16-yard-wasm.log')
with log.open('xb') as output:result=subprocess.run(command,env=env,stdout=output,stderr=subprocess.STDOUT)
text=log.read_text()
match=re.search(r'test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;',text)
assert match and sum(map(int,match.groups()))==299
record={'command':command,'exit_code':result.returncode,'artifact':artifact,'source_sha256':source['source_sha256'],'source_manifest':'v16-yard-source-02.json','passed':int(match[1]),'failed':int(match[2]),'ignored':int(match[3]),'log':str(log),'finished_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
Path('.local-build/v16-yard-wasm.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8',newline='\n')
for path,digest in source['files'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==digest,path
print(json.dumps(record),flush=True)
sys.exit(result.returncode)
