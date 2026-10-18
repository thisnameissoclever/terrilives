from pathlib import Path
import datetime,hashlib,json,os,re,subprocess,sys
assert json.loads(Path('.local-build/v16-yard-build.json').read_text())['exit_code']==0
source=json.loads(Path('.local-build/v16-yard-source.json').read_text())
for path,digest in source['files'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==digest,path
artifacts={}
for line in Path('.local-build/v16-yard-build.log').read_text().splitlines():
    if not line.startswith('{'):continue
    row=json.loads(line)
    if row.get('reason')=='compiler-artifact' and row.get('executable'):
        artifacts[row['target']['name']]={'path':row['executable'],'sha256':hashlib.sha256(Path(row['executable']).read_bytes()).hexdigest()}
required=['terri_data','terri_sim','terri_wasm','inherited_runtime','content_hierarchy']
assert all(name in artifacts for name in required)
cases=[]
def native(name,target,selection=None,exact=False):
    command=[artifacts[target]['path']]+([selection] if selection else [])+['--test-threads=1']+(['--exact'] if exact else [])
    cases.append((name,command,'.','rust'))
native('data','terri_data')
native('inherited','inherited_runtime')
native('hierarchy','content_hierarchy')
native('lifecycle','terri_sim','build_transaction::cases::every_public_snapshot_writer_reads_the_committed_baseline',True)
native('lounger','terri_sim','render_buffer::tests::every_shipped_interaction_projects_its_exact_activity_and_supported_body_pose',True)
native('golden','terri_sim','determinism_tests::world_hash_matches_its_golden_vector',True)
native('published-v15','terri_wasm','published_v15_tests::')
native('room-boundary','terri_wasm','room_save_tests::')
tests=['test_patio_extension_preserves_accepted_catalogue_and_baked_pixels','test_catalogue_extensions_refuse_overwrites_gaps_and_invalid_resources','test_generated_ids_follow_the_complete_historical_prefix','test_depth_and_roles_ship_compressed_under_their_unpacked_hash']
cases.append(('architecture',[sys.executable,'-B','-m','unittest','-v',*['test_offline_architecture.ArchitectureImport.'+name for name in tests]],'assets/sprites/gen','python'))
web=['architecture.test.ts','architecture-sprite-boundary.test.ts','architecture-resources.test.ts','architecture-depth.test.ts','floor-default-catalogue.test.ts','floor-materials.test.ts','fixture-depth.test.ts','preview-fixture.test.ts']
cases.append(('web-depth',['node','--max-old-space-size=4096','node_modules/vitest/vitest.mjs','run',*['tests/'+name for name in web],'--maxWorkers=1'],'web','vitest'))
env=os.environ.copy()
for key in ['TERRI_R5_FAULT','TERRI_PROVE_RUNTIME_FIXTURE','TERRI_WRITE_RUNTIME_FIXTURE']:env.pop(key,None)
env['NO_COLOR']='1'
rows=[]
for name,command,cwd,kind in cases:
    log=Path('.local-build/v16-yard-focus-'+name+'.log')
    with log.open('xb') as output:result=subprocess.run(command,cwd=cwd,env=env,stdout=output,stderr=subprocess.STDOUT)
    output=log.read_text(encoding='utf-8',errors='replace')
    row={'name':name,'command':command,'cwd':cwd,'exit_code':result.returncode,'kind':kind,'log':str(log)}
    if kind=='rust':
        match=re.search(r'test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed;',output)
        assert match and sum(map(int,match.groups()))>0,(name,output)
        row.update({'passed':int(match[1]),'failed':int(match[2])})
    rows.append(row)
    Path('.local-build/v16-yard-focus.json').write_text(json.dumps({'source_sha256':source['source_sha256'],'artifacts':{name:artifacts[name] for name in required},'tests':rows,'complete':len(rows)==len(cases),'all_passed':len(rows)==len(cases) and all(row['exit_code']==0 for row in rows),'finished_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({k:v for k,v in row.items() if k!='command'}),flush=True)
for path,digest in source['files'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==digest,path
sys.exit(1 if any(row['exit_code'] for row in rows) else 0)
