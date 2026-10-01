# Packed instance count implementation plan

Use superpowers:subagent-driven-development for this single integrated task.
The owner delegated routine execution under the full game goal. Root owns
browser verification, independent review and external delivery.

**Goal:** Eliminate the production recount and draw every written floor-preview row.

**Spec:** `docs/specs/2026-10-01-packed-instance-count.md`.

## Global constraints

No Rust, WASM source, dependency, renderer layout, saved-state, art or sound
change. Preserve both existing exported APIs. No new per-frame allocations,
secondary count traversal, global last-count getter or trailing-buffer clearing.
The new result is borrowed until the next build. Root's validated WASM hash is
`da49265e97644cb5f3dcc2aef11ef0406a0682f468145d0df472640d929bf9dd`.
Keep all sound controls and existing audio behavior unchanged. Do not import
PR 184 or PR 178 or imply that this slice clears their holds. Use apply_patch,
one test worker, no commit branding or co-author trailers.

## Task 1: Publish and consume the packed count

**Ownership:** One worker owns production, tests and behavior documentation.
You are not alone in the repository. Do not revert others' edits or spawn child
agents. Work only in the assigned worktree. Root owns the ledger and browser
evidence; no concurrent source editing occurs.

**Files:** `web/src/frame.ts`, `web/src/main.ts`, focused frame/interaction/portal
and production-wiring tests, `docs/ARCHITECTURE.md`, `docs/lessons-learned.md`,
and this spec's implementation evidence. Add a focused test file if clearer.
Keep historical original plans and GPU measurements historical. A small native
proof module may be added if needed to test the actual production draw boundary;
it must exercise real code, not a test-only replacement frame loop.

1. Verify clean main base `6d2499d4` and the copied WASM hash. Dependencies were
   installed from the existing lockfile with scripts disabled; no versions changed.
   Scan every call/import/documentation reference before editing. Read the spec,
   live-prefix, stride and preview lessons and testing protocol.
2. Establish focused baseline. Add a failing behavioral test before each relevant
   implementation step. A missing-export compile failure is not regression evidence.
3. Introduce the reused batch and keep the explicit legacy wrapper. Return the
   actual final slot, including the final highlight writer. Keep array and count
   synchronized after growth, shrink and empty frames.
4. Switch the real main frame loop to the batch. Preserve its single existing
   argument list, including floor highlight, actual tick and reduced motion.
   Remove the legacy recount import and invocation from production.
5. Assert independent exact counts and packed rows for each meaningful writer
   path, stable result identity, stale-count/pointer prevention and one actual
   interaction update. Preserve the old API's semantics and tests. Add coverage
   that fails when main consumes the old count again, especially floor preview.
6. Delete final-slot/count/pointer updates and stable identity in turn; reintroduce
   the production recount once. Run each covering test and record assertion
   failures. Restore exact bytes and verify SHA-256 after each mutation. Do not
   count compilation failures as caught behavioral mutations.
7. Update the architecture's borrowed live-prefix contract and record the floor
   highlight root cause/prevention/verification. Mark the old overlap-only
   preview lesson superseded by L-furniture-preview-replacement; preserve current
   refused/nonoverlapping preview behavior rather than reviving old documentation.
8. Run the full web suite once with one worker, typecheck, production build,
   documentation IDs and diff checks. Record exact commands, outcomes and hashes.
   Do not rebuild Rust or perform browser acceptance. Root handles the browser.
9. Self-review and commit the coherent implementation locally. Do not push or
   create a PR. Write a detailed report under `.superpowers/sdd/2026-10-01-packed-instance-count/`.
   Return commit, check counts, evidence gaps and report path. Freeze source/dist.

## Root completion

Package the task diff for independent spec/quality review. Resolve findings
through the worker. Inspect the production game, floor preview and furniture
move/cancel on desktop/mobile/reduced motion; preserve screenshots and any
remaining visual findings. Obtain fresh whole-branch review, then commit, push,
create/attach/merge the PR under existing authority, synchronize clean main and
report Pages deployment separately. No duplicate passing CI wait is required.
