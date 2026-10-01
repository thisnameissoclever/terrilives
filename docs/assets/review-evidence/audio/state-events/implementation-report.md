# Task 1 report: main-based audio state events

Implemented only the existing four-family lifecycle repair on
`twcx/audio-state-events`, starting at `ce1eb25ae6b0a16bcf46af6746243c7ad3014aad`
with main base `6df7c045`. No push, PR, merge, Rust build, dependency version
change, asset change, ambience import or held-feature probe change was made.

## Ownership and implementation

Owned production, controller tests, named native proof, audio-foundation/spec
updates and one new lesson. Root owns browsers, preview servers and permanent
receipts under `docs/assets/review-evidence/audio/state-events/`. Root's files
and `web/output/` are excluded from this worker's commit.

The impact scan found `BrowserAudioContext` in its controller declaration and
the single TypeScript context double in `audio-controller.test.ts`. Existing
proofs use JavaScript adapters. The production context now exposes an owned
`onstatechange` slot. Binding happens after graph and players are constructed.
The callback captures that context, ignores running and stale-context events,
then immediately stops all players and resets every scheduler. Construction
failure detaches before disconnect and close. Global conversation disposal uses
the player's existing immediate mode, including release-only records. No player
implementation or fixed-tick sampling contract changed.

## Red before production

Production remained unchanged while `proveAudioStateEvents()` was prepared.
Root independently ran the original native proof before authorizing production
edits. Original controller SHA-256:
`8a19e9755ddad9ac8e98867a693def7e8e656278e12397385f98f679e0cc4096`.

1. Initial `npx vitest run tests/audio-controller.test.ts --maxWorkers=1 -t 'audio state events without simulation ticks'`
   failed to start because node_modules was absent and Vite could not resolve.
   npm fetched ephemeral vitest 5.0.3; no tracked lock or manifest changed. This
   was setup failure, not causal red evidence.
2. `npm ci` in `web/`: exit 0, 48 packages installed from the existing lock.
   npm reported three existing vulnerabilities: two moderate, one high.
   No audit fix or dependency update was run.
3. The first two test iterations exposed a fixture defect: returning the same
   Response body prevented the second recording from loading. Fixtures now
   return a fresh Response per fetch, including gated late decode. The final
   positive source assertions passed before the causal failure below.
4. `npm test -- --maxWorkers=1 tests/audio-controller.test.ts -t 'audio state events without simulation ticks'`:
   exit 1, seven failed, 203 skipped. Actual failures:

   ```text
   disposes the paused object/conversation/door/procedural tail:
   AssertionError: expected false to be true // Object.is equality
   expect(sources.every(source => source.disconnected)).toBe(true)

   restarts only a freshly observed current action:
   AssertionError: expected 1 to be +0 // Object.is equality
   expect(controller.activeObjectLoopCount()).toBe(0)

   drops pending recordings before late decoding:
   AssertionError: expected [ FakeBufferSource{ ... }, ... ] to have a length of +0 but got 2

   detaches an abandoned graph handler:
   AssertionError: expected null not to be null
   expect(queued).not.toBeNull()
   ```

5. Root native baseline command: `node web/output/playwright/verify-audio-state-events.cjs native-original-production.json`:
   exit 1, no page errors. Actual product failure:

   ```text
   object, state-event interruption: first resumed sample: expected 0, rendered 0.08399999886751175
   ```

## Green and mutation sensitivity

After the minimal production patch, the same focused new-test command exited 0:
seven passed, 203 skipped. The returning-running positive-source assertion was
then strengthened without additional production changes.

Every mutation below was compiling, failed with exit 1, and was reversed using
the exact inverse patch. The first three required restorations each matched SHA-256
`595ea22c083affa0528eb306b2eae376a8f77ffcc48b85402fe9bbf2806c3749`.
The final source after all six mutations matched that same hash.

| Deleted mechanism | Command suffix after `npm test -- --maxWorkers=1 tests/audio-controller.test.ts` | Actual failure |
| --- | --- | --- |
| Callback `stopEveryPlayer()` | `-t 'disposes the paused'` | Four failures: `expected false to be true`; sources remained connected |
| Callback `resetSchedulers()` | `-t 'restarts only a freshly observed current action'` | `expected +0 to be 1`; current object did not restart |
| Captured-context identity clause | `-t 'detaches an abandoned graph handler'` | `expected +0 to be 1`; stale callback stopped the current procedural source |
| Global conversation immediate argument | `-t 'disposes the paused conversation'` | `expected false to be true`; release-only source stayed connected |
| Failure-path handler detachment | `-t 'detaches an abandoned graph handler'` | `expected [Function] to be null`; abandoned handler remained bound |
| Callback running-state guard | `-t 'restarts only a freshly observed current action'` | `expected +0 to be 1`; a running event stopped the recovered current object |

After all six restorations, root independently imported and executed the named
native proof: exit 0, 18 assertions passed. Both interrupted first resumed
samples and entire tails were exactly zero. Ordinary-fade controls retained
their positive plateaus and intermediate release levels. Two earlier reruns
lost their page to Vite hot-reload navigation and supplied no product result.
The final run followed restart of the task-owned Vite server.

## Final checks

| Exact command | Exit | Relevant output and verdict |
| --- | --- | --- |
| `npm test -- --maxWorkers=1 tests/audio-controller.test.ts tests/object-loops.test.ts tests/voice-clips.test.ts tests/frame-audio.test.ts tests/procedural-cues.test.ts tests/recorded-doors.test.ts` in `web/` | 0 | PASS: 298 tests in four matching files. Procedural and door regressions are in the controller suite; the two extra filter names matched no standalone files |
| `npm test -- --maxWorkers=1` in `web/` | 0 | PASS: 1,713 tests, 114 files, 20.31 s. One full run after restoration |
| `npm run typecheck` in `web/` | 0 | PASS: `tsc --noEmit`, no errors |
| `npm run build` in `web/` | 0 | PASS: 86 modules, `index-D6zT8jXc.js`, `terri_wasm_bg-DeTPiNCV.wasm`, built in 126 ms |
| `node --check web/proofs/audio-state-events.js` | 0 | PASS: syntax valid |
| Browser import and `proveAudioStateEvents()` through Vite | 0 | PASS: named module resolves and 18 native rendered assertions pass; root-owned receipt |
| `python check-doc-ids.py` | 0 | PASS: `Documentation ids are unique and allocation-free.` |
| `git diff --check` | 0 | PASS: no whitespace errors |

Build was announced to root before writing dist. The supplied main-matching
release WASM was reused without rebuilding Rust. No test or server from another
conversation was stopped. Full-suite start followed root's confirmation that
the other conversation's heavy checks had ended.

## Evidence limits and handoff

Root native receipts are under `docs/assets/review-evidence/audio/state-events/`.
Root's independent built-game/Options inspection passed with exit 0 and no page
errors. The actual handler was installed; paused tick 12 stayed tick 12 across
suspend/resume with no new gesture or simulation tick. All active/retained source
families were zero afterward. Root visually inspected game.png and options.png:
lot, Sims and controls intact; Effects 70%, Voices 100%, no ambience control.
Task-owned browsers and both preview servers were closed.
No claim of operating-system interruption reproduction, listening acceptance,
120 Hz acceptance, retained-memory acceptance or held-feature approval is made.
No closed-context replacement was added. Existing direct-cancellation and
normal-fade suites remain green. Dependency vulnerabilities were reported but
not remediated because version changes are outside this authority.

Commit only explicitly owned files. Do not stage root's receipt directory,
`web/output/`, dist, WASM or the ignored `.superpowers` report.

## Local delivery

Committed the six owned files as
`56266f7bf1b7f0b52e42c58be702b440b142ff7e`,
`Fix audio cleanup on browser context state changes`.
After commit, only root's evidence directory and `web/output/` remained
untracked. No push, PR or merge was attempted. Prose scans of this report and
the state-events spec returned zero hard or soft violations; final doc IDs and
diff checks passed.
