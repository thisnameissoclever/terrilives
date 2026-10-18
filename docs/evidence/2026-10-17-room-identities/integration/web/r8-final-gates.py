from pathlib import Path
import datetime, hashlib, json, os, subprocess, time

root = Path(__file__).resolve().parents[1]
os.chdir(root)
out = root / '.local-build'
label = 'r8-web-final-01'
receipt_path = out / f'{label}-receipt.json'
assert not receipt_path.exists(), 'Use a new label for a new run'

def manifest(tag):
    tracked = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], text=True).splitlines()
    prefixes = ('web/src/', 'web/tests/', 'web/public/', 'web/changelog/', 'assets/', 'content/', 'crates/', 'tools/', 'scripts/', 'docs/changelog/')
    paths = {p for p in tracked if p.startswith(prefixes) or p in ('Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'package.json', 'package-lock.json', 'check-doc-ids.py') or (p.startswith('web/') and '/' not in p[4:])}
    paths.update(p.as_posix() for p in Path('web/src').rglob('*') if p.is_file())
    rows = {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in sorted(paths) if Path(p).is_file()}
    result = {'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'files': rows,
              'source_sha256': hashlib.sha256(''.join(p+'\0'+h+'\n' for p,h in rows.items()).encode()).hexdigest()}
    (out / f'{label}-{tag}.json').write_text(json.dumps(result, indent=2)+'\n')
    return result

before = manifest('before')
env = os.environ.copy()
env['NODE_OPTIONS'] = '--max-old-space-size=4096'
receipt = {'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(), 'source_before': before['source_sha256'], 'input_count': len(before['files']), 'checks': [], 'complete': False}
checks = [('typecheck', ['npm.cmd','--prefix','web','run','typecheck']),
          ('suite', ['npm.cmd','--prefix','web','test','--','--maxWorkers=1','--reporter=default','--reporter=../.local-build/web-progress-reporter.mjs']),
          ('build', ['npm.cmd','--prefix','web','run','build']),
          ('doc-ids', ['python','check-doc-ids.py']),
          ('changelog-test', ['node','--test','scripts/build-changelog.test.mjs']),
          ('changelog-build', ['node','scripts/build-changelog.mjs'])]
for name, command in checks:
    row = {'name':name,'command':command,'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'state':'running'}
    receipt['checks'].append(row)
    receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(row),flush=True)
    started = time.monotonic()
    log = out / f'{label}-{name}.log'
    with log.open('xb') as stream:
        code = subprocess.call(command,env=env,stdout=stream,stderr=subprocess.STDOUT)
    row.update(state='complete',exit_code=code,seconds=round(time.monotonic()-started,3),log_sha256=hashlib.sha256(log.read_bytes()).hexdigest())
    receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(row),flush=True)
    if code: break
after = manifest('after')
receipt.update(complete=True,source_after=after['source_sha256'],source_unchanged=before['files']==after['files'])
receipt['passed'] = len(receipt['checks']) == len(checks) and all(c['exit_code']==0 for c in receipt['checks']) and receipt['source_unchanged']
receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'passed':receipt['passed'],'receipt':str(receipt_path)}),flush=True)
raise SystemExit(0 if receipt['passed'] else 1)
