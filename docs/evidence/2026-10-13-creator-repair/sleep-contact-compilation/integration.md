# Required sleeping preparation integration

The game now admits a composite character preparation containing independently keyed bike and sleeping support. One serial queue and one worker handle both resource types. Current people, pending commands, load candidates, and the newest creator draft retain the required resources. Existing transactional loading and command admission use the complete preparation.

Sleeping poses require the prepared artifact. Drawing cannot call the sleeping fitter. The world prepares cover topology for its actual live bed fixtures before startup, load, or graphics recovery becomes ready. Occupancy selects the artifact's slot contributions and updates the retained cover cage. The cover keeps its indices, subdivision topology, material table, GPU buffers, and fixture ownership. Removing a fixture releases its resources. Preview views share their retained cover mesh and body pose work.

The new frame probe copies primitive fields into caller-provided storage. A monotonic resource ID changes when an actor's rendering resources are replaced. Full diagnostics remain available separately and now include retained unoccupied covers in allocation totals.

All commands ran from `web` with `NODE_OPTIONS=--max-old-space-size=4096`; Vitest used one worker.

| Command | Result |
| --- | --- |
| `npx vitest run tests/character-bike-contact-service.test.ts tests/character-preparation-service.test.ts tests/character-contact-admission.test.ts tests/creator-contact-preview.test.ts --maxWorkers=1` | PASS: 21 tests, 23.98 s, exit 0 |
| `npx vitest run tests/character-prepared.test.ts tests/character-frame-probe.test.ts tests/character-preparation-service.test.ts --maxWorkers=1` | PASS: 56 tests, 51.05 s, exit 0 |
| `npx vitest run tests/character-session.test.ts tests/persistence-controller.test.ts --maxWorkers=1` | PASS: 22 tests, 0.984 s, exit 0 |
| `npx tsc --noEmit` | PASS: exit 0 |

The retained-cover check compares every deformed cage value with a freshly constructed cover and the original shape-normal calculation. It also rejects render-time sleeping fit calls, keeps GPU buffer identities across first use and changing occupancy, and verifies release after actor destruction, fixture removal, and device loss. Composite service tests cover independent dependency reuse, synchronous ready-owner transfer, A-B-A cancellation, bounded obsolete jobs, failures, explicit retry, and disposal. Existing admission tests retain exact native bytes and queued command outcomes across cancellation and refusal.

An intermediate type check reported `TS2367` and `TS2339` in the new test's comparison between a recording buffer and `GPUBuffer`. The test now casts its recording handle explicitly. Production code required no correction for that failure. An initial focused command also named two nonexistent test files; Vitest ran the two matching files. The session and persistence tests were then run under their actual filenames as recorded above.

The source receipt is `.scratch/sleep-preparation-source-hashes.json` (24 files). Actual game attachment parity, performance, and independent adversarial review remain separate checks owned by the parent task; these unit results do not claim those checks passed.

## Actual worker startup correction

The first actual runtime attempt failed before readiness: [original report](../bike-contact-compilation/sleep-runtime-01/report.json). The worker message originally omitted its stack. Bounded `errorName` and `workerStack` response fields now preserve the origin in `service.lastWorkerError`, while `lastError` and the rejected promise's message remain concise. [The isolated worker reproduction](worker-stack-01/report.json) identifies the exact call: `SupportSurface` expanded the full body point inventory into `Math.max` arguments. Chrome's worker exceeded its argument limit; Node had accepted the same inventory.

`SupportSurface` now reduces the five extrema without a variable-length argument list. Triangle construction and query arithmetic are unchanged. [Focused math checks](worker-extrema-fix.log) passed seven tests, including exact special-value behavior, unchanged dense queries, and a million-point inventory where the previous spread throws.

1. `$env:WORKER_RUN='worker-stack-02'; node .scratch/check-sleep-worker.cjs`: PASS, exit 0. [Report](worker-stack-02/report.json) records successful bike and sleep worker replies, complete startup, three live owners, two prepared resources, and no errors or pending work.
2. `$env:CONTACT_RUN='sleep-runtime-02'; node scripts/character-creator-repair/check-contact-runtime.cjs`: PASS, exit 0. [Report](../bike-contact-compilation/sleep-runtime-02/report.json) records an active-exercise load, a required composite edit with 58 responsive animation callbacks during 971.075 ms preparation, exact unchanged live bytes and tick during preparation, and no additional input preparation or compilation during the cycle.
3. `npx vitest run tests/character-preparation-service.test.ts tests/character-bike-contact-service.test.ts --maxWorkers=1`: PASS, 14 tests, 1.36 s, exit 0. This includes original-worker-stack preservation and unchanged concise readiness errors.
4. `npx tsc --noEmit`: PASS, exit 0 after the browser correction.

Both Chrome runs used fresh task-owned browser contexts, muted audio, and unconditional browser cleanup. The initial failed receipts remain unchanged. The revised production source receipt is `.scratch/sleep-preparation-repaired-source-hashes.json`; the first receipt remains preserved.
