# Retire the separate shower-water experiment

The owner accepted the merged steam shower on October 17, 2026 and explicitly
retired the earlier falling-water requirement. This cleanup preserves useful
rendering checks and reference material without replacing the accepted effect.

## Runtime boundary

The cleanup branch starts from `7c7cfa2274729716b35fda168653c2dfe687d079`.
PR259 merged the washing motion and steam as
`618a69369c84b1a19837e21b89df1427a42c465c`; PR265 restored its pinned authoring input
as `6beeab6c522acb51a0c75e002d199ebc8474ec93`.

No production renderer, character source, fixture, simulation, save, dependency
or player-facing changelog change belongs to this cleanup. The public behavior
is unchanged, so no release-note bullet is needed. The proof page and command
are development-only. The TypeScript configuration includes the proof for type
checking; the game does not import it.

## Recovery snapshot

[retired-water-source.zip](retired-water-source.zip) preserves the old working
files, their tracked patch, a file-hash manifest and the historical graphics
report. Its base is `bb5ba9cde8be565a2800d25a87696f3e33ee9346`.
Archive SHA256:
`5dc54a0f92dbdeb129efd83df38c2cdc844dafa247b37cd5254a791cc1f2e940`.

The archive is inert recovery material. Do not apply its patch to modern main.
Its old runtime plan, water-specific tests and browser command describe the
retired design, not current work instructions. It contains no credentials,
review videos or binary model exports. Extract it outside the active checkout
when inspecting an old implementation.

The historical graphics report belongs to the old source snapshot. It does not
establish current-main correctness or final normal-size motion acceptance.
Reusable coverage and ordering principles are in
[effect verification](../../rendering/effect-verification.md).

## Earlier conversation work

The audit against the baseline main found the requested fish swimming, media
seating, ordinary sitting, toilet, bathing, sofa reclining, handwashing and desk
seating implementations in main. Media selection retains the reachable-seat
rule within a seven-tile, 90-degree forward cone and keeps the device as the
gameplay target. Layout, near-side bunk ladder, covered sleeping and closer zoom
changes are also historical merged work, not tasks to recreate.

Relevant implementation/evidence pointers:

1. Fish and media seating: merges `e56028e57` and `1a138df64`; current
   `crates/terri-sim/src/media.rs` and seating tests retain the cone boundary and
   separate target/seat ownership.
2. Toilet, bath and later interaction integration: `2f319c3bb`, `25b4f2102`,
   `9a3bb24a2` and the actual-game interaction evidence under
   `docs/evidence/2026-10-13-creator-repair/`.
3. Long-sofa reclining: `4d2c3f7b4`, `360b52681`, the current `sofa_recline`
   selection and the final reclining review under
   `docs/evidence/2026-10-13-creator-repair/final-game-review/recline-final/`.
4. Current seating, washing motion, steam and floor markers:
   [merged review](../2026-10-15-seating-selection-shower/report.md).

The portable earlier handoff and seven owned stash snapshots remain in normal
main history at `ba38c907f67075073079c2204da742a5fc07b7ee`, even though its handoff
directory was later removed from the current tree. The bundle blob is
`016fdc47cb0e620b33bf5b25e215915992f1c1f6`. A full clone retains the checkpoint
and its prerequisite commits. Inspect the old handoff as history only:

```text
git show ba38c907f67075073079c2204da742a5fc07b7ee:docs/handoffs/2026-10-06-animation-resume.md
git archive --output=animation-recovery.zip ba38c907f67075073079c2204da742a5fc07b7ee docs/handoffs/animation-resume
```

Do not revive old sprite-only assumptions or obsolete action ordinals from
those snapshots. Other conversations' stashes, branches, worktrees and servers
are outside this cleanup. Local generated exports and ignored scratch evidence
are retained separately from active work.

## Local cleanup evidence

The extracted historical bundle passed `git bundle verify` before the seven
conversation-owned stash entries were removed. The other nine stash identities
and their relative order remained unchanged; [stash-retirement.json](stash-retirement.json)
records both sets. The full old snapshots remain recoverable from the bundle in
main history rather than depending on a local reflog.

The nineteen experimental working files were byte-verified against the recovery
archive before their active copies were restored or moved out of the source tree.
The old generated `output/` directory is retained at
`.local-build/historical-output/`; the unused October 4 `web/pkg/` build is at
`.local-build/historical-wasm-pkg/`. These are local archives, not pending source
changes. `.tmp/` is unchanged. The earlier release heartbeat was already paused,
and the old task-owned preview port had no listener.

## Regression and delivery audit

[steam-contracts.json](steam-contracts.json) records a passing direct graphics
check against the unchanged production steam and scene modules. Steam changes
exposed color samples while leaving every foreground sample, identity byte and
physical-surface byte unchanged. Real scene picks retain their known owners.
A subsequent depth-tested witness remains visible. Empty fields, held phases
and disposed drawing meet their separate assertions.

The command also rejects five deliberately defective copies: hardware-depth
writes, retained fields, missing drawing, identity writes and surface writes.
The receipt binds the harness and copied source hashes and records browser and
cleanup results. It does not claim a new visual acceptance or a runtime change.

[delivery-audit.json](delivery-audit.json) records the inspected historical pull
requests, their remote merged states and the check that their merge commits are
reachable from the recorded remote main. It supports retirement of the old
work queue, not a claim of fresh public-game or phone verification.

## Local delivery checks

1. `npm --prefix web test -- --maxWorkers=1` passed on the initial `7c7cfa227`
   baseline with the cleanup additions: 261 files, 3,423 tests, exit 0.
   [web-tests.log](web-tests.log) retains the summary.
2. Main advanced to `a4ac3228e6a69d19c65a001011d1a2fa27dcdd4f` with the unrelated
   store catalogue. The checkout fast-forwarded without conflict. Its affected
   `tests/buy-tool.test.ts` suite passed all 71 tests with one worker.
3. Type checking and the production site build passed after that integration.
   The build retained the existing large-chunk, ineffective dynamic-import and
   asset-plugin timing warnings; no warning threshold changed.
   The subsequent documentation-only capture cleanup at `1070a97e9` was merged
   normally. Its removed captures remain removed; production inputs to these
   checks did not change. Documentation identifiers passed again after the merge.
4. The current WebAssembly package rebuilt successfully with the locked native
   dependencies. Native source was unchanged; a separate native test rerun was
   not required for this internal-only cleanup.
5. The changelog's twelve tests and its page build passed. Documentation identifiers,
   whitespace, staged receipt hashes and the source-archive manifest passed their
   checks. No new public note is needed because runtime behavior is unchanged.
6. Independent read-only review verified the archive, recovery pointers, retained
   stash inventory and graphics assertions. Its invalid historical commit pointer
   and cleanup-resilience concern were corrected and reviewed again.

Production files under `web/src`, `assets`, `content` and `crates` remain identical
to the integrated main. All browser and server resources created by the graphics
command closed successfully. This is repository maintenance and test coverage;
it does not require a new game deployment or claim one happened.

Retained console logs normalize line endings and trailing whitespace only.
Original local captures remain in `.local-build/`.
