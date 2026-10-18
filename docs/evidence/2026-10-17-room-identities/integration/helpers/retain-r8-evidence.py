from pathlib import Path
import datetime, gzip, hashlib, json

root=Path(__file__).resolve().parents[1]
out=root/'docs/evidence/2026-10-17-room-identities/integration'
ledger={}
def retain(source,target):
    src=root/source; dst=out/target;dst.parent.mkdir(parents=True,exist_ok=True)
    raw=src.read_bytes()
    if src.suffix in ('.png','.sav','.gz'):
        kept=raw; transform='identity'
    else:
        text=raw.decode('utf-8-sig').replace('\r\n','\n')
        if src.suffix=='.log':text='\n'.join(line.rstrip(' \t') for line in text.split('\n'))
        kept=(text.rstrip('\n')+'\n').encode() if raw else b''
        transform='UTF-8, LF, one final newline for nonempty text; log lines also trim trailing horizontal whitespace' if src.suffix=='.log' else 'UTF-8, LF, one final newline for nonempty text'
    dst.write_bytes(kept)
    ledger[target]={'source':source,'raw_sha256':hashlib.sha256(raw).hexdigest(),'retained_sha256':hashlib.sha256(kept).hexdigest(),'bytes':len(kept),'transform':transform}

review_names=['task-7-code-review.md','task-7-fix-1-report.md','task-7-fix-1-rereview.md','task-7-visual-review.md','r8-draft-chore-projection-audit.md','r8-query-proof-better-way.md','r8-postload-pointer-audit.md','r8-exit-colors-visual-review.md']
for name in review_names:retain('.superpowers/sdd/2026-10-17-room-identities/'+name,'reviews/'+name)
for name in ['decisions-for-retention.md','rulings-for-closeout.json']:retain('.superpowers/sdd/2026-10-17-room-identities/'+name,name)
task=root/'.superpowers/sdd/2026-10-17-room-identities'
for folder in ['task-2-mutation-evidence','native-mutations-composite-20261017-133623']:
    base=task/folder
    for src in base.rglob('*'):
        if not src.is_file() or 'source-baseline' in src.parts:continue
        if src.suffix not in ('.log','.json','.jsonl','.py','.diff'):continue
        retain(src.relative_to(root).as_posix(),'causal/'+folder+'/'+src.relative_to(base).as_posix())
for src in task.glob('task-5-accepted-*'):
    if src.suffix in ('.log','.json','.jsonl','.py','.diff'):retain(src.relative_to(root).as_posix(),'causal/'+src.name)
for name in ['task-2-report.md','task-2-review.md','task-2-mutations.py','task-5-report.md','task-5-native-integration-report.md','task-5-current-continuation-audit.md']:
    retain((task/name).relative_to(root).as_posix(),'causal/'+name)
for name in ['r8-native-final-01-before.json','r8-native-final-01-after.json','r8-native-final-01-format.log','r8-native-final-01-workspace.log','r8-native-final-01-clippy.log','r8-native-final-01-receipt.json','r8-native-gates.py','r6-source-manifest.py']:retain('.local-build/'+name,'native/'+name)
retain('.local-build/r8-parent-gate-audit.json','web/r8-parent-gate-audit.json')
retain('.local-build/r8-parent-gate-audit-02.json','web/r8-parent-gate-audit-02.json')
for name in ['r8-exit-intent-red.log','r8-exit-intent-green.log','r8-final-gates.py','r8-final-gates-02.py','web-progress-reporter.mjs']:retain('.local-build/'+name,'web/'+name)
for run in ['01','02']:
    label='r8-web-final-'+run
    receipt=root/'.local-build'/f'{label}-receipt.json'
    r=json.loads(receipt.read_text())
    if not r.get('complete'):continue
    retain('.local-build/'+receipt.name,'web/'+receipt.name)
    for check in r['checks']:retain('.local-build/'+label+'-'+check['name']+'.log','web/'+label+'-'+check['name']+'.log')
    before=json.loads((root/'.local-build'/f'{label}-before.json').read_text());after=json.loads((root/'.local-build'/f'{label}-after.json').read_text())
    assert before['files']==after['files']
    summary={'before':{k:v for k,v in before.items() if k!='files'},'after':{k:v for k,v in after.items() if k!='files'},'count':len(before['files']),'exact_rows_equal':True,'raw_manifest_sha256':{tag:hashlib.sha256((root/'.local-build'/f'{label}-{tag}.json').read_bytes()).hexdigest() for tag in ['before','after']}}
    (out/'web'/f'{label}-manifest-comparison.json').write_text(json.dumps(summary,indent=2)+'\n')
    if run=='02':
        data=(root/'.local-build'/f'{label}-before.json').read_bytes();packed=gzip.compress(data,mtime=0)
        (out/'web'/'final-inputs.json.gz').write_bytes(packed)
        ledger['web/final-inputs.json.gz']={'source':'.local-build/'+label+'-before.json','raw_sha256':hashlib.sha256(data).hexdigest(),'retained_sha256':hashlib.sha256(packed).hexdigest(),'bytes':len(packed),'transform':'gzip mtime0; UTF-8 JSON only, no media'}
        old=json.loads((root/'.local-build'/'r8-web-final-01-before.json').read_text())['files']
        delta={p:{'before':old.get(p),'after':before['files'].get(p)} for p in sorted(set(old)|set(before['files'])) if old.get(p)!=before['files'].get(p)}
        (out/'web'/'post-first-pass-input-delta.json').write_text(json.dumps(delta,indent=2)+'\n')

logs=['r8-before-table','r8-table-draft','r8-table-draft-committed-proof','r8-table-draft-manual-save','r8-table-draft-manual-save-readback','r8-table-baseline-after-cancel','r8-table-replayed-draft','r8-table-confirmed','r8-outdoor-floor-active','r8-outdoor-floor-middle','r8-outdoor-floor-complete','r8-outdoor-table-active','r8-active-table-save-load','r8-outdoor-table-complete','r8-indoor-floor-active','r8-indoor-floor-middle','r8-indoor-floor-complete','r8-historical-seed','r8-historical-loaded','r8-historical-conversation-active','r8-historical-conversation-complete','r8-historical-need-eating','r8-historical-need-complete','r8-historical-timeline','r8-retained-exit-case','r8-first-wall-diagnosis','r8-wall-keyboard-diagnosis','r8-retained-exit-keyboard','r8-retained-exit-finish','r8-mouse-only-control','r8-patio-selection','r8-patio-confirmed','r8-patio-complete','r8-patio-resource-ready-retry','r8-land-north-cancel','r8-land-west-confirmed','r8-patio-four-confirmed','r8-patio-cancel-save-load','r8-exit-gray-current','r8-fixed-source-reload','r8-matched-baseline-setup','r8-matched-baseline-loaded','r8-exit-color-mapping','r8-exit-color-restoration','r8-changelog-visual','r8-game-final-cleanup-state','r8-query-purity','r8-query-purity-v2','r8-query-purity-v3','r8-query-purity-alt1']
results={}
for name in logs:
    retain('.local-build/'+name+'.log','played/'+name+'.log')
    text=(root/'.local-build'/f'{name}.log').read_text(encoding='utf-8-sig')
    if '### Result\n' in text:
        try:results[name]=json.loads(text.split('### Result\n',1)[1].split('\n### Ran Playwright',1)[0])
        except json.JSONDecodeError:pass
(out/'played'/'results.json').write_text(json.dumps(results,indent=2)+'\n')
images=['r8-outdoor-floor-active','r8-outdoor-floor-complete','r8-outdoor-table-active','r8-outdoor-table-complete','r8-indoor-floor-middle','r8-indoor-floor-complete','r8-historical-conversation-active','r8-historical-need-eating','r8-historical-need-complete','r8-retained-name-exit-prompt','r8-retained-name-refreshed-review','r8-mouse-only-selection','r8-patio-west-confirmed','r8-patio-west-after-load','r8-exit-proof-a','r8-exit-proof-b','r8-changelog-desktop-dark','r8-changelog-phone-light']
captures=[]
first=json.loads((root/'.local-build'/'r8-web-final-01-before.json').read_text())
second=json.loads((root/'.local-build'/'r8-web-final-02-before.json').read_text())
for name in images:
    retain('.local-build/'+name+'.png','played/'+name+'.png')
    image=root/'.local-build'/f'{name}.png';manifest=second if name.startswith('r8-exit-proof-') or name.startswith('r8-changelog-') else first
    captures.append({'file':name+'.png','source_input_fingerprint':manifest['source_sha256'],'recorded_file_mtime_utc':datetime.datetime.fromtimestamp(image.stat().st_mtime,datetime.timezone.utc).isoformat(),'sha256':hashlib.sha256(image.read_bytes()).hexdigest(),'inputs':{p:manifest['files'][p] for p in ['web/index.html','web/src/main.ts','web/src/ui/build-controls.css','web/src/wasm/terri_wasm_bg.wasm']}})
(out/'played'/'capture-inputs.json').write_text(json.dumps(captures,indent=2)+'\n')
helpers=['r8-retained-exit-case.js','r8-retained-exit-keyboard.js','r8-retained-exit-finish.js','r8-mouse-only-control.js','r8-exit-color-capture.js','r8-exit-color-restoration.js']
for name in helpers:retain('.local-build/'+name,'helpers/'+name)
for name in ['r8-play-helper.js','r8-play-observe.js','r8-committed-proof.js','r8-query-purity.js','r8-query-purity-v2.js','r8-query-purity-v3.js','r8-query-purity-alt1.js','r7-wall-helper.js']:retain('web/.scratch/'+name,'helpers/'+name)
for name in ['room-play-dirt-current16.sav','r6-room-play-current16.sav','room-play-dirt-current16-receipt.json','room-play-dirt-input.json','r6-play-seed-result.json']:retain('.local-build/'+name,'play-setup/'+name)
retain('web/.scratch/r8-matched-baseline.sav','play-setup/matched-baseline838.sav')
retain('.local-build/retain-r8-evidence.py','helpers/retain-r8-evidence.py')
(out/'retained-files.json').write_text(json.dumps(ledger,indent=2)+'\n')
print(json.dumps({'retained':len(ledger),'parsed_play_receipts':len(results),'captures':len(captures)}))
