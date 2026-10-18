from pathlib import Path
import datetime,hashlib,json,subprocess,sys
phase=sys.argv[1]
main='513c86be2aa44fb4d5576279d0e1ae69991e870e'
root=Path('.local-build')
sha=lambda data:hashlib.sha256(data).hexdigest()
source=root/'v16-yard-fingerprint.rs';exe=root/'v16-yard-fingerprint.exe'
if phase=='compile':
    assert json.loads((root/'v16-yard-focused-run.json').read_text())['exit_code']==1
    assert json.loads((root/'v16-yard-focus.json').read_text())['complete']
    protected=['crates/terri-data/src','crates/terri-data/build.rs','crates/terri-data/Cargo.toml','assets/sprites/atlas.toml','web/public/audio/voice']
    protected += [str(path).replace('\\','/') for path in Path('content').glob('*.toml') if path.name!='lot.toml']
    assert not subprocess.check_output(['git','diff',main,'--',*protected])
    lot=subprocess.check_output(['git','show',main+':content/lot.toml'])
    (root/'v16-yard-lot-513.toml').write_bytes(lot)
    libs={}
    for line in (root/'v16-yard-build.log').read_text().splitlines():
        if not line.startswith('{'):continue
        row=json.loads(line)
        name=row.get('target',{}).get('name')
        if row.get('reason')=='compiler-artifact' and name in ['terri_data','postcard','toml']:
            for path in row['filenames']:
                if path.endswith('.rlib'):libs[name]=path
    assert set(libs)=={'terri_data','postcard','toml'}
    command=['rustc','--edition=2021',str(source),'-o',str(exe),'-L','dependency=target/debug/deps']
    for name,path in libs.items():command+=['--extern',name+'='+path]
    info={'source_sha256':sha(source.read_bytes()),'canonical_source_receipt':'v16-yard-source.json','main513_lot_sha256':sha(lot),'unchanged_main_inputs':protected,'libraries':{name:{'path':path,'sha256':sha(Path(path).read_bytes())} for name,path in libs.items()},'rustc':subprocess.check_output(['rustc','--version'],text=True).strip()}
else:
    compiled=json.loads((root/'v16-yard-fingerprint-compile.json').read_text())
    assert compiled['exit_code']==0 and sha(exe.read_bytes())==compiled['executable_sha256']
    assert sha(source.read_bytes())==compiled['source_sha256']
    command=[str(exe)]
    info={'compile_receipt':'v16-yard-fingerprint-compile.json'}
log=root/f'v16-yard-fingerprint-{phase}.log'
with log.open('xb') as output:result=subprocess.run(command,stdout=output,stderr=subprocess.STDOUT)
info.update({'command':command,'exit_code':result.returncode,'log':str(log),'finished_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()})
if result.returncode==0 and phase=='compile':info['executable_sha256']=sha(exe.read_bytes())
if result.returncode==0 and phase=='run':
    info['measured']=json.loads(log.read_text())
    paths=[Path('.local-build/p15-target/wasm32-unknown-unknown/release/build/terri-data-3721efb1e6b3d722/out/content_pack.postcard'),root/'v16-yard-production-513.postcard',root/'v16-yard-production-combined.postcard']
    info['packs']=[{'path':str(path),'bytes':path.stat().st_size,'sha256':sha(path.read_bytes())} for path in paths]
    left_right=[]
    for path in [root/'v16-yard-focus-published-v15.log',root/'v16-yard-focus-room-boundary.log']:
        lines=path.read_text().splitlines();left=[line[8:] for line in lines if line.startswith('  left: ')];right=[line[8:] for line in lines if line.startswith(' right: ')]
        assert len(left)==len(right)
        for i,(actual,expected) in enumerate(zip(left,right)):
            assert actual.count('content_fingerprint:')==1
            assert actual.replace('content_fingerprint: 5841475410324663844','content_fingerprint: 17481476517581295759')==expected
            left_right.append({'log':str(path),'case':i,'actual_sha256':sha(actual.encode()),'original_sha256':sha(expected.encode()),'only_measured_fingerprint_difference':True})
    assert len(left_right)==4
    info['whole_dto_log_comparisons']=left_right
(root/f'v16-yard-fingerprint-{phase}.json').write_text(json.dumps(info,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'phase':phase,'exit_code':result.returncode,'measured':info.get('measured')}),flush=True)
sys.exit(result.returncode)
