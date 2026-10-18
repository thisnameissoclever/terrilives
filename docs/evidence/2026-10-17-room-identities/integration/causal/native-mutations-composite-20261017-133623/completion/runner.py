from pathlib import Path
import hashlib,json,os,subprocess
ROOT=Path.cwd()
OUT=Path(__file__).resolve().parent
ORIGINAL=OUT.parent
prior=json.loads((ORIGINAL/'summary.json').read_text())
ENV=prior['environment']
assert ENV not in os.environ
expected={
    'outdoor-materials':('outdoor boards are cleanable','rooms\\integration_tests.rs:20:'),
    'current-reference-mode':('called `Result::unwrap()` on an `Err` value: InvalidValue','rooms\\integration_tests.rs:193:'),
    'refused-adoption':('assertion `left == right` failed','rooms\\integration_tests.rs:197:'),
    'migration-random-stream':('assertion `left == right` failed','rooms\\integration_tests.rs:450:'),
    'cleaned-units-conservation':('assertion `left == right` failed','chores\\room_change_tests.rs:688:'),
    'unrelated-path-ownership':('called `Option::unwrap()` on a `None` value','chores\\room_change_tests.rs:692:'),
}
exe=Path(prior['executable'])
result={'method':prior['method'],'baseline_commit':prior['baseline_commit'],'original_receipts':str(ORIGINAL),'correction':'Original checker stopped at the correct custom material assertion because it expected generic assertion text. This supplement runs the unchanged compiled binary; it does not edit or re-instrument source.','executable_sha256':hashlib.sha256(exe.read_bytes()).hexdigest(),'controls':[],'faults':[]}
try:
    assert prior['all_sources_restored'] and prior['compile_exit']==0
    for fault in [False,True]:
        for control in prior['controls']:
            name,test=control['fault'],control['test']
            env=os.environ.copy()
            if fault: env[ENV]=name
            try:
                run=subprocess.run([str(exe),test,'--exact','--nocapture'],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=120)
            finally: env.pop(ENV,None)
            output=run.stdout+run.stderr
            label='fault' if fault else 'neutral'
            (OUT/f'{name}-{label}.log').write_text(output)
            if fault:
                assertion,location=expected[name]
                passed=run.returncode!=0 and 'test result: FAILED' in output and '1 failed' in output and assertion in output and location in output
                result['faults'].append({'fault':name,'test':test,'exit':run.returncode,'intended_assertion_failed':passed,'assertion':assertion,'source_location':location})
            else:
                passed=run.returncode==0 and 'test result: ok' in output and '1 passed' in output
                result['controls'].append({'fault':name,'test':test,'exit':run.returncode,'passed':passed})
            print(f'{name} {label}: intended_result={passed}, exit={run.returncode}',flush=True)
            if not passed: raise RuntimeError(f'{name} {label}: unexpected result, source remains restored')
    result['all_six_detected']=True
finally:
    result['restored_sha256']={file:hashlib.sha256((ROOT/file).read_bytes()).hexdigest() for file in prior['original_sha256']}
    result['all_sources_byte_identical']=all((ROOT/file).read_bytes()==(ORIGINAL/'source-baseline'/file).read_bytes() for file in prior['original_sha256'])
    result['hashes_match_original']=result['restored_sha256']==prior['original_sha256']
    result['parent_environment_unchanged']=ENV not in os.environ
    result['tracked_source_clean']=subprocess.run(['git','diff','--exit-code','--',*prior['original_sha256']],capture_output=True).returncode==0
    result['index_source_clean']=subprocess.run(['git','diff','--cached','--exit-code','--',*prior['original_sha256']],capture_output=True).returncode==0
    result['runner_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    (OUT/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
    print(f'Source restored exactly: {result["all_sources_byte_identical"]}; tracked/index clean: {result["tracked_source_clean"]}/{result["index_source_clean"]}',flush=True)
