import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { classifyMutation } from './ottoman-mutation-result.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = process.argv[2];
if (!output) throw new Error('Supply a new output JSON path');
const paths = ['src/render/interaction-sprites.ts', 'src/render/atlas.ts', 'src/bridge.ts',
  'src/wasm/terri_wasm_bg.wasm', 'tests/ottoman.test.ts', 'tests/interaction-production.test.ts',
  'tests/ottoman-mutation-result.test.js',
  'proofs/prove-ottoman-runtime.mjs', 'proofs/ottoman-mutation.config.ts',
  'proofs/ottoman-mutation-result.mjs', 'proofs/ottoman-error-reporter.mjs'];
const hashes = () => Object.fromEntries(paths.map(path => [path,
  createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')]));
const before = hashes();
const cases = [
  ['acceptUnrelatedFailure', 'rejects an unrelated fixture assertion', 'reject-unrelated-assertion'],
  ['acceptRuntimeError', 'rejects an intended assertion accompanied', 'reject-unhandled-error'],
  ['cancelBoth', 'two simultaneous Sit actions', 'other-sitter-keeps-target'],
  ['wrongTarget', 'two simultaneous Sit actions', 'ottoman-exact-target-body'],
  ['wrongCadence', 'uses every ottoman sample and shirt at authored cadence', 'ottoman-facing-shirt-timed-sample'],
  ['frozenSample', 'uses every ottoman sample and shirt at authored cadence', 'ottoman-facing-shirt-timed-sample'],
  ['wrongShirt', 'uses every ottoman sample and shirt at authored cadence', 'ottoman-facing-shirt-timed-sample'],
  ['wrongFacing', 'uses every ottoman sample and shirt at authored cadence', 'ottoman-facing-shirt-timed-sample'],
  ['ignoredReducedMotion', 'uses every ottoman sample and shirt at authored cadence', 'ottoman-reduced-motion-sample-zero'],
  ['visibleEmpty', 'two simultaneous Sit actions', 'occupied-empty-hidden'],
];
const records = [];
const run = (name, filter, marker) => {
  const args = ['node_modules/vitest/vitest.mjs', 'run', '--config', 'proofs/ottoman-mutation.config.ts',
    '--reporter=json', '--reporter=./proofs/ottoman-error-reporter.mjs',
    'tests/interaction-production.test.ts', 'tests/ottoman.test.ts', 'tests/ottoman-mutation-result.test.js'];
  if (filter) args.push('-t', filter);
  const result = spawnSync(process.execPath, args, {
    cwd: root, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, OTTOMAN_MUTATION: name }, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.signal) throw new Error(`${name}: ${result.error ?? result.signal}`);
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { throw new Error(`${name}: missing test report: ${result.stderr}\n${result.stdout}`); }
  const runtimeLines = result.stderr.split(/\r?\n/).filter(line => line.startsWith('OTTOMAN_RUN_ERRORS='));
  if (runtimeLines.length !== 1) throw new Error(`${name}: missing or duplicate runtime report`);
  const runtime = JSON.parse(runtimeLines[0].slice('OTTOMAN_RUN_ERRORS='.length));
  const failed = report.testResults.flatMap(file => file.assertionResults)
    .filter(test => test.status === 'failed');
  const record = { name, exit: result.status, total: report.numTotalTests,
    passed: report.numPassedTests, failed: report.numFailedTests, runtime, marker,
    failures: failed.map(test => ({ name: test.fullName, messages: test.failureMessages })) };
  records.push(record);
  if (name === 'baseline') {
    if (result.status !== 0 || report.numPassedTests !== 28 || failed.length ||
        runtime.reason !== 'passed' || !Array.isArray(runtime.unhandledErrors) || runtime.unhandledErrors.length) {
      throw new Error('Unmodified focused suite did not pass all 28 tests');
    }
  } else classifyMutation(report, result.status, runtime, filter, marker);
  if (JSON.stringify(hashes()) !== JSON.stringify(before)) throw new Error('Source or fixture bytes changed');
};
let failure = null;
try {
  run('baseline');
  for (const [name, filter, marker] of cases) run(name, filter, marker);
  run('baseline');
} catch (error) { failure = String(error); }
const unchanged = JSON.stringify(hashes()) === JSON.stringify(before);
writeFileSync(resolve(output), JSON.stringify({ state: failure || !unchanged ? 'failed' : 'complete',
  sourceUnchanged: unchanged, sourceHashes: before, cases: records, failure }, null, 2) + '\n', { flag: 'wx' });
if (failure || !unchanged) throw new Error(failure ?? 'Source bytes changed');
console.log(JSON.stringify({ state: 'complete', mutationsCaught: cases.length, restoredTests: 28, sourceUnchanged: true }));
