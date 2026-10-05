# Current sleeping ownership across the render bridge

The local render buffer, WASM exports and TypeScript bridge carry two new
aligned columns: `sleeping_beds` and `sleeping_places`. They identify the exact
bed and physical place used by a running sleep-tagged action. Both carry
`u32::MAX` when absent. Zero is a real place, and an entity index is not a row.

This pair is independent of body art. The double bed has no authored sleep
socket yet, so its existing visual-action, facing, position and socket-target
columns retain their old behavior. No renderer consumer, asset, command or save
field changes. Publication still requires occupied-body and composite proof.

## Checks and review

Native coverage includes both places, a one-slot alternate nap using the shared
bed capacity, an identical second bed, an entity hole, a zero-tick action waiting
for completion, resumable chain progress, and clearing one person's action while
preserving their partner. Seventeen invalid-state cases exercise inactive
actions, missing or invalid ownership, work, travel, chain work, conversations
and stale targets. A replacement bed that reuses a deleted bed's index must not
inherit its sleeper. Sleep tags with independent exercise/watch visuals retain
both their semantic ownership and the original presentation.

The native pointer test reads both columns after vector growth and clearing.
The release bridge test drives real assignment and use commands in the shipped
household. It distinguishes idle assignees and walkers from sleepers, restores
both places immediately on Load, grows the household buffer, forces WASM memory
replacement, verifies detached old views and fresh getters, cancels one sleeper,
and restores the saved pair again.

Independent adversarial review found the missing stale-generation regression.
After that addition and the fault checks below, final review found no remaining
actionable issue. This review covers semantic projection only.

## Deliberate faults

Each fault ran one named regression with `cargo test -p terri-sim <test>
-- --test-threads=1`, failed with exit 101, and was restored in `finally`.
`projection-mutations.json` records test names and restored SHA-256 values.

```text
Ordinal forced to zero:
assertion `left == right` failed
  left: (0, 0)
 right: (0, 1)

Walking guard removed:
assertion `left == right` failed: walking
  left: (0, 0)
 right: (4294967295, 4294967295)

Capacity guard removed:
assertion `left == right` failed: out-of-range place
  left: (0, 2)
 right: (4294967295, 4294967295)

Column clear removed:
assertion `left == right` failed
  left: 8
 right: 4

Target re-resolved by raw index:
assertion `left == right` failed: reused bed index
  left: (0, 0)
 right: (4294967295, 4294967295)
```

All source bytes were restored: `beds.rs` SHA-256
`4700049E42A81F072BE74B3248FD145F8590B95B50463B644B1945AB4DC6137C`,
`lib.rs` SHA-256
`B7AFCAC36CA18A1BF9C84BBE6BBCBE025AC5E069BBBD8F6BC61B37859076A17C`.
The restored two-test projection suite passed with exit 0.

| Command | Result |
| --- | --- |
| `cargo test -p terri-sim -p terri-wasm` | PASS, exit 0: 756 simulation and 153 WASM tests. |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS, exit 0. |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS, exit 0. |
| `npm test -- --maxWorkers=1` in `web/` | PASS, exit 0: 1,723 tests in 118 files, including the real release bridge. |
| `npm run typecheck` and `npm run build` in `web/` | PASS, exit 0 for both. |
| `node scripts/bed-autonomy-proof.mjs` | PASS, exit 0; all three four-day observations match the earlier report. |
| `node scripts/bed-autonomy-proof.mjs --old-layout` | Expected FAIL, exit 1 at assigned-place use, observed ticks `0,419,753`. |
| `cargo fmt --all --check`, `python check-doc-ids.py`, `git diff --check` | PASS, exit 0 for each. |

The new release-WASM SHA-256 is
`f32278a031e4b91d063856d6a9b6124c0f902e1c83a3fade460ba254631a9708`.
The build emits `terri_wasm_bg-XnGQZlK2.wasm` (2,272.23 kB),
`index-CfQZi-gu.js` (406.21 kB) and unchanged `index-C7TqlCL6.css`.
The prior autonomous-sleep report remains a record of its original binary;
the rerun results are in `projection-autonomy-report.json` and
`projection-old-layout-report.json`.

Logs and the fault runner are under `.tmp/bed-assignment/projection-*`.

## Main integration after the retention fix

The held bed branch integrated main `c0949f05` at `7d4c617d` on 2026-10-01. Main contains the separately reviewed component-removal history maintenance from PR #186 and the audio state-event cleanup from PR #185. The bed implementation remains unpublished pending accepted occupied artwork and renderer integration.

`cargo test --workspace --locked -j 1 --quiet` passed with exit 0: 109 core tests, 270 data tests, one data integration test, 759 simulation tests, and 153 WASM-boundary tests. The three new lifecycle tests also passed individually through the real full-tick and paused-drain boundaries. Documentation IDs and `git diff --check` passed.

This is native integration evidence. The earlier bed release-WASM artifact and browser reports above retain their original provenance; they have not been relabeled as a fresh build of this merge. The reviewed main-only memory comparison is in `../ecs-lifecycle/README.md` and does not establish occupied-bed artwork acceptance.
