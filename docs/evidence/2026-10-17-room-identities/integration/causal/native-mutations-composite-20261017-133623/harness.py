from pathlib import Path
import datetime
import difflib
import hashlib
import json
import os
import subprocess
import sys

ROOT = Path.cwd()
ENV = 'TERRILIVES_SDD_ROOM_MUTATION'
assert ENV not in os.environ, 'Refuse to overwrite an existing mutation environment value'
RC = 'crates/terri-sim/src/chores/room_changes.rs'
LIB = 'crates/terri-sim/src/lib.rs'
ROOM = 'rooms::integration_tests::'
TEST = 'chores::room_change_tests::'
CASES = [
    ('outdoor-materials', 'crates/terri-sim/src/rooms/runtime.rs',
     '1..=4 => true,', '1..=4 => !crate::sdd_room_mutation("outdoor-materials"),',
     ROOM+'outdoor_coverings_create_one_outside_floor_duty', 'assertion failed'),
    ('current-reference-mode', 'crates/terri-sim/src/save/v15.rs',
     'room_mode: crate::rooms::RoomReferenceMode::Stable,',
     'room_mode: if crate::sdd_room_mutation("current-reference-mode") { crate::rooms::RoomReferenceMode::Legacy } else { crate::rooms::RoomReferenceMode::Stable },',
     ROOM+'stable_visit_ids_exceeding_tile_count_validate_and_missing_ids_refuse_atomically', 'InvalidValue'),
    ('refused-adoption', LIB, 'let candidate = save::v15::restore(',
     'if crate::sdd_room_mutation("refused-adoption") { self.world.resource_mut::<terri_core::Funds>().0 += 1; }\n        let candidate = save::v15::restore(',
     ROOM+'stable_visit_ids_exceeding_tile_count_validate_and_missing_ids_refuse_atomically', 'assertion `left == right` failed'),
    ('migration-random-stream', 'crates/terri-sim/src/rooms/migration.rs',
     'super::retain_referenced_history(sim.world_mut());',
     'if crate::sdd_room_mutation("migration-random-stream") { sim.world_mut().resource_mut::<terri_core::SimRng>().next_u32(); }\n    super::retain_referenced_history(sim.world_mut());',
     ROOM+'review_stale_legacy_visit_and_duty_seeds_remain_separate_retired_history', 'assertion `left == right` failed'),
    ('cleaned-units-conservation', RC, 'let prior_remaining = task.remaining;',
     'let prior_remaining = task.remaining; if crate::sdd_room_mutation("cleaned-units-conservation") { task.completed_units = 0; }',
     TEST+'review_floor_replanning_keeps_nonzero_cleaned_units_and_unrelated_activity_path', 'assertion `left == right` failed'),
    ('unrelated-path-ownership', RC, 'grime::forget(world, task.person);',
     'if crate::sdd_room_mutation("unrelated-path-ownership") { if let Some(person) = crate::dining::entity(world, task.person) { world.entity_mut(person).remove::<terri_core::Path>(); } }\n        grime::forget(world, task.person);',
     TEST+'review_floor_replanning_keeps_nonzero_cleaned_units_and_unrelated_activity_path', 'called `Option::unwrap()` on a `None` value'),
]
originals = {file:(ROOT/file).read_bytes() for _,file,*_ in CASES}
for name,file,old,new,test,expected in CASES:
    assert originals[file].decode().replace('\r\n','\n').count(old)==1,(name,'anchor count')
print(f'Validated {len(CASES)} independently selected production faults',flush=True)
if '--check-only' in sys.argv:
    raise SystemExit(0)

stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
OUT=ROOT/'.superpowers/sdd/2026-10-17-room-identities'/f'native-mutations-composite-{stamp}'
OUT.mkdir(exist_ok=False)
(OUT/'harness.py').write_bytes(Path(__file__).read_bytes())
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
summary={'baseline_commit':head,'method':'Six isolated fault executions in one instrumented build; each exact test has a passing neutral control. Not six independently rebuilt mutants.','environment':ENV,'controls':[],'faults':[]}
modified={file:data.decode().replace('\r\n','\n') for file,data in originals.items()}
for name,file,old,new,test,expected in CASES:
    modified[file]=modified[file].replace(old,new,1)
modified[LIB]+='\nfn sdd_room_mutation(name: &str) -> bool {\n    std::env::var_os("'+ENV+'").as_deref() == Some(std::ffi::OsStr::new(name))\n}\n'
patch=[]
for file,source in modified.items():
    patch.extend(difflib.unified_diff(originals[file].decode().replace('\r\n','\n').splitlines(True),source.splitlines(True),fromfile='a/'+file,tofile='b/'+file))
    baseline=OUT/'source-baseline'/file
    baseline.parent.mkdir(parents=True,exist_ok=True)
    baseline.write_bytes(originals[file])
(OUT/'instrumentation.diff').write_text(''.join(patch))
summary['original_sha256']={file:hashlib.sha256(data).hexdigest() for file,data in originals.items()}
summary['instrumented_sha256']={file:hashlib.sha256(source.encode()).hexdigest() for file,source in modified.items()}
try:
    for file,source in modified.items(): (ROOT/file).write_bytes(source.encode())
    print('Compiling the instrumented test binary once',flush=True)
    build=subprocess.run(['cargo','test','-p','terri-sim','--lib','--no-run','--message-format=json'],capture_output=True,text=True,encoding='utf-8',errors='replace')
    (OUT/'compile.stdout.jsonl').write_text(build.stdout)
    (OUT/'compile.stderr.log').write_text(build.stderr)
    summary['compile_exit']=build.returncode
    if build.returncode: raise RuntimeError('Instrumented build failed; no mutation result claimed')
    artifacts=[]
    for line in build.stdout.splitlines():
        try: row=json.loads(line)
        except json.JSONDecodeError: continue
        if row.get('reason')=='compiler-artifact' and row.get('target',{}).get('name')=='terri_sim' and row.get('profile',{}).get('test') and row.get('executable'):
            artifacts.append(row['executable'])
    assert len(set(artifacts))==1,artifacts
    executable=artifacts[0]
    summary['executable']=executable
    for fault in [False,True]:
        for name,file,old,new,test,expected in CASES:
            env=os.environ.copy()
            env.pop(ENV,None)
            if fault: env[ENV]=name
            result=subprocess.run([executable,test,'--exact','--nocapture'],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=120)
            env.pop(ENV,None)
            output=result.stdout+result.stderr
            label='fault' if fault else 'neutral'
            (OUT/f'{name}-{label}.log').write_text(output)
            if fault:
                passed=result.returncode!=0 and 'test result: FAILED' in output and '1 failed' in output and expected in output
                location=next((line for line in output.splitlines() if 'panicked at' in line),'')
                summary['faults'].append({'fault':name,'test':test,'exit':result.returncode,'intended_assertion_failed':passed,'assertion':expected,'location':location})
            else:
                passed=result.returncode==0 and 'test result: ok' in output and '1 passed' in output
                summary['controls'].append({'fault':name,'test':test,'exit':result.returncode,'passed':passed})
            print(f'{name} {label}: expected_result={passed}, exit={result.returncode}',flush=True)
            if not passed: raise RuntimeError(f'{name} {label} produced an unexpected result; inspect its immutable log')
    summary['all_selected_faults_detected']=True
finally:
    for file,original in originals.items(): (ROOT/file).write_bytes(original)
    summary['restored_sha256']={file:hashlib.sha256((ROOT/file).read_bytes()).hexdigest() for file in originals}
    summary['all_sources_restored']=all((ROOT/file).read_bytes()==original for file,original in originals.items())
    summary['parent_environment_unchanged']=ENV not in os.environ
    tree=subprocess.run(['git','diff','--exit-code','--',*originals],capture_output=True,text=True)
    index=subprocess.run(['git','diff','--cached','--exit-code','--',*originals],capture_output=True,text=True)
    summary['tracked_source_clean']=tree.returncode==0
    summary['index_source_clean']=index.returncode==0
    summary['harness_sha256']=hashlib.sha256((OUT/'harness.py').read_bytes()).hexdigest()
    (OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    (ROOT/'.superpowers/sdd/2026-10-17-room-identities/native-mutation-latest.txt').write_text(str(OUT)+'\n')
    print(f'Receipts: {OUT}',flush=True)
    print(f'All source bytes restored: {summary["all_sources_restored"]}; tracked/index clean: {summary["tracked_source_clean"]}/{summary["index_source_clean"]}',flush=True)
