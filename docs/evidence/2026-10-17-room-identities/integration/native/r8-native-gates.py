from pathlib import Path
import datetime, hashlib, json, os, subprocess, sys, time
root = Path(__file__).resolve().parents[1]
os.chdir(root)
label = sys.argv[1]
assert label.replace('-', '').isalnum()
out = root / '.local-build'
receipt_path = out / f'{label}-receipt.json'
assert not receipt_path.exists(), 'Use a fresh label'
manifest_script = out / 'r6-source-manifest.py'
def manifest(suffix):
    path = out / f'{label}-{suffix}.json'
    subprocess.run([sys.executable, str(manifest_script), str(path)], check=True)
    return json.loads(path.read_text())
before = manifest('before')
assert before['source_sha256'] == '67adab4fb28ea4bbc3f42543069939636f414f883cca00fbb2925926a20881bd'
env = os.environ.copy()
env['CARGO_BUILD_JOBS'] = '1'
for key in ['TERRI_R5_FAULT', 'TERRI_WRITE_RUNTIME_FIXTURE', 'TERRI_PROVE_RUNTIME_FIXTURE']:
    env.pop(key, None)
receipt = {'head_start': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
           'scope': 'Native inputs only; independently owned browser/docs may change. No overlapping heavy commands.',
           'source_before': before['source_sha256'], 'checks': [], 'complete': False}
def save():
    receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
checks = [('format', ['cargo', 'fmt', '--all', '--', '--check']),
          ('workspace', ['cargo', 'test', '--workspace', '--no-fail-fast', '--locked', '--jobs', '1', '--', '--test-threads=1']),
          ('clippy', ['cargo', 'clippy', '--workspace', '--all-targets', '--locked', '--jobs', '1', '--', '-D', 'warnings'])]
for name, command in checks:
    path = out / f'{label}-{name}.log'
    row = {'name': name, 'command': command, 'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'state': 'running'}
    receipt['checks'].append(row)
    start = time.monotonic()
    with path.open('xb') as stream:
        process = subprocess.Popen(command, env=env, stdout=stream, stderr=subprocess.STDOUT)
        row['pid'] = process.pid
        save()
        print(json.dumps(row), flush=True)
        code = process.wait()
    row.update(state='complete', exit_code=code, seconds=round(time.monotonic()-start, 3), log_sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    save()
    print(json.dumps(row), flush=True)
    if code:
        break
after = manifest('after')
receipt.update(source_after=after['source_sha256'], source_unchanged=before == after, complete=True)
receipt['passed'] = len(receipt['checks']) == len(checks) and all(row['exit_code'] == 0 for row in receipt['checks']) and receipt['source_unchanged']
save()
print(json.dumps({'complete': True, 'passed': receipt['passed'], 'receipt': str(receipt_path)}), flush=True)
sys.exit(0 if receipt['passed'] else 1)
