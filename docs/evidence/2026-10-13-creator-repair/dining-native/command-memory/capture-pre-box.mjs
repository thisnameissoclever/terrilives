import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const binary = fs.readFileSync(path.join(root, 'web/src/wasm/terri_wasm_bg.wasm'));
const wasmSha256 = createHash('sha256').update(binary).digest('hex');
if (wasmSha256 !== 'cacce77105d1e75c7225e75b89c994e3a6824a275d1e15daf71678ef65d76e15') {
  throw Error('Historical fixtures require the captured pre-box WASM binary');
}
const { initSync, SimHandle } = await import(pathToFileURL(path.join(root, 'web/src/wasm/terri_wasm.js')).href);
initSync({ module: binary });
const handle = SimHandle.from_lot();
const directory = path.join(root, 'crates/terri-wasm/tests/fixtures/command-memory');
fs.mkdirSync(directory, { recursive: true });
try {
  const commands = [
    [0, 0],
    [30, 1, 7, 0, 1, 1, 3, 65, 110, 110, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0],
  ];
  for (const bytes of commands) {
    if (!handle.enqueue_command(Uint8Array.from(bytes))) throw Error('Pre-box command was refused');
  }
  const queued = handle.save_bytes();
  fs.writeFileSync(path.join(directory, 'queued-edit-pre-box-v9.sav'), queued);
  handle.flush_commands();
  const completed = handle.save_bytes();
  fs.writeFileSync(path.join(directory, 'completed-edit-pre-box-v9.sav'), completed);
  console.log(JSON.stringify({
    wasmSha256,
    commands,
    queued: { bytes: queued.length, sha256: createHash('sha256').update(queued).digest('hex') },
    completed: { bytes: completed.length, sha256: createHash('sha256').update(completed).digest('hex') },
  }, null, 2));
} finally {
  handle.free();
}
