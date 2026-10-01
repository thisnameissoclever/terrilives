# Packed count verification

## Scope and revisions

2026-10-01. Implementation `616e4a8d`, followed by conflict-free integration of
shipped main `d6dce671` at `e26bc71c`. The played viewport correction is
`682f4cf8`. Final review compares shipped main with the complete branch, not
only its last commit. No held ambience or toilet implementation is included.

The packer publishes its actual written row count. Production consumes that
borrowed array and count immediately instead of reconstructing the count.
The old exports remain compatible. Eliminated work is the duplicate column
reads, interaction-selection update and entity traversal. No frame-time or
audio-memory improvement is claimed from this structural change.

## Local automated checks

The implementation worker recorded these commands and results before freezing
source and built output. Root did not repeat passing suites without a change.

| Command | Exit | Result |
| --- | --- | --- |
| `npm --prefix web test -- --maxWorkers=1 tests/frame.test.ts tests/interaction-frame.test.ts tests/portals.test.ts tests/placement-preview.test.ts` | 0 | Baseline: 4 files, 89 tests PASS |
| `npm --prefix web test -- --maxWorkers=1 tests/instance-batch-production.test.ts` before edits | 1 | RED: expected draw count 2, received 0; omitted floor preview |
| Same production-boundary command after edits | 0 | GREEN: 1 test PASS |
| `npm --prefix web test -- --maxWorkers=1 tests/instance-batch.test.ts tests/instance-batch-production.test.ts tests/frame.test.ts tests/interaction-frame.test.ts tests/interaction-production.test.ts tests/portals.test.ts tests/placement-preview.test.ts` | 0 | 7 files, 106 tests PASS |
| `npm --prefix web test -- --maxWorkers=1` | 1 | Initial full run: 1719 PASS, 2 stale wiring assertions FAIL |
| `$env:NODE_OPTIONS = '--max-old-space-size=1024'; npm --prefix web test -- --maxWorkers=1` after wiring-test corrections | 0 | 116 files, 1721 tests PASS |
| `npm --prefix web run typecheck` | 0 | PASS: no diagnostics |
| `npm --prefix web run build` | 0 | PASS: production output generated |
| `python check-doc-ids.py` | 0 | PASS: IDs unique and allocation-free |
| `git diff --check` and `git diff --cached --check` | 0 | PASS: no whitespace errors |

The two stale wiring tests expected duplicated production argument lists;
they were updated to the single packing occurrence. The original defect had
a pre-implementation failing assertion. Additional batch-contract tests were
written after implementation; they are not claimed as pre-implementation RED.

Five isolated production mutations each caused behavioral assertion failures:
omitting the final-highlight slot update, omitting count publication, omitting
the grown-array pointer update, allocating a fresh result, and restoring the
production recount. Each was reversed before the next test; exact restored
SHA-256 values at mutation time were
`e4b6017fd4738b4d14358505bd39e46a169a6988b2e3b862d413fe391fba19a7`
for frame.ts and
`b8c9e41a7dff07bf9ac120b0477c53a4d85c0beb76d916489c1af8e49543fd19`
for main.ts. A later comment changed frame.ts; the viewport fix changed main.ts.
No compilation failure is counted as a caught mutation.

After integration with shipped door audio, the focused frame, interaction,
portal and placement checks passed 4 files / 221 tests; typecheck, build,
documentation IDs and whitespace checks passed. After the viewport listener
fix, the following command passed 4 files / 60 tests, exit 0:

`npm --prefix web test -- --maxWorkers=1 tests/floor-tool.test.ts tests/compact-hud.test.ts tests/builder.test.ts tests/instance-batch-production.test.ts`

Typecheck, build, documentation IDs and whitespace checks then passed again.
The full suite was not repeated for that one existing-method callback.

## Played production checks

Root opened task-owned, displayed Chromium pages on isolated production preview
port 5224. Observational GPU wrappers recorded the real dynamic writeBuffer
prefix and opaque draw; they changed no product files and retained only the
latest frame. These are native uploaded/drawn counts, not a second model of
the packing algorithm.

| Scenario | Observation | Verdict |
| --- | --- | --- |
| Desktop floor selection | Dynamic rows 45 to 46; opaque draw 394 to 395. Last row sprite 12, cyan selection ring visible at tile (12,3). Escape restored 45 / 394. | PASS |
| Dining-table move | Original row 7 parked at (-1000000,-1000000), sprite 0; three preview rows appended, dynamic count 48. The table appeared at the destination, not twice. | PASS |
| Desktop Cancel | Original table row and dynamic count 45 restored; save bytes exact before, during and after preview. | PASS |
| 390x844, reduced motion | Visible cyan floor ring; dynamic 45 to 46, opaque 394 to 395. Neutral lighting and usable bottom build dock; no horizontal page overflow. | PASS |
| Mobile move/Cancel | Preview visible and controls reachable. Fresh save baseline: 3199 bytes, unchanged during preview and after Cancel. | PASS |
| Final desktop to phone to desktop resize | At 1280px keyboard help visible/touch hidden; at 390px keyboard hidden/touch visible; at 1280px restored. Screenshots inspected individually. | PASS |

The first mobile save comparison used a desktop baseline taken before a floor
edit and differed. It is invalid cancellation evidence, not a product failure.
A fresh mobile baseline taken immediately before the move passed. Floor
selection requires a click or tap; hover alone does not select. Selecting
another furniture item can switch selection, so the move check used the
observed Dining table selector and keyboard movement.

Desktop/mobile GPU and move screenshots are from the integrated build
`index-CeVbE4eF.js`, SHA-256
`f3f279e6c102aed6542a60d5025da8bf394965ae8115ea0cd09dd3bb26a72886`.
That pass identified the missing floor-help resize notification. The final
viewport transition used rebuilt `index-DpDiWA-m.js`, SHA-256
`77c827e628c4a858fb0227fc75d3743a696984758be2861c953fdbc0d7add295`.
Final main.ts SHA-256 is
`f0873bfdb5bcab51bb37f7bb9b8cf2ef0cb3a438be26754924115da419b2c83f`.
Reviewed, main-matching Windows WASM SHA-256 is
`da49265e97644cb5f3dcc2aef11ef0406a0682f468145d0df472640d929bf9dd`.
No Rust or dependency source changed.

Screenshots: `../assets/review-evidence/render/packed-count/`. The older mobile
floor image records the pre-fix keyboard help; `help-mobile.png` records the
corrected touch instructions. Root actually inspected the screenshots, including
the final phone and restored desktop views. The console's only error was the
unrelated favicon 404; no GPU error was observed. Pages closed in finally blocks
and all task-owned preview servers stopped. Other conversations' pages and
servers were left alone.

Separately, the already-deployed door fix from PR 188 was checked on live Pages.
`audio/doors/close-thunk.wav` returned HTTP 200, 61484 bytes, exact reviewed SHA-256
`3df7b05fe5101da61d0f06e523b52f0f038bee32c22fca2569107bf58f087cc3`.
The game rendered and advanced; the screenshot was inspected. This establishes
deployment of the corrected asset, not subjective physical-speaker acceptance.

## Decisions and remaining boundaries

1. Add a reused batch API while retaining legacy exports. Cost: old verification
   helpers still need maintenance; no new per-frame allocation is introduced.
2. Include the authored floor highlight in the count. Cost: the previously
   missing intended marker becomes visible; the broken omission is not preserved.
3. Accept the disclosed test-order deviation. Cost: less proof of development
   sequence, although current invariants have independent assertions and mutation
   evidence. Rewriting history would not establish a past failing test.
4. Include floor controls in the existing compact-layout listener. Cost: one
   additional existing-method callback; no label, CSS or saved-state change.

Independent task review approved implementation compliance and quality. Final
whole-branch review and external delivery are recorded after this evidence is
committed. No remote check is called passed before its result exists. This slice
does not clear the memory holds on PR 184 or PR 178, establish 120Hz playback,
approve standing sleep poses, or substitute for a full visual/world acceptance.
