# Audio context event cleanup plan

Use subagent-driven-development for one integrated task, followed by root native
verification, task review and whole-branch review. Routine execution is already
authorized; do not ask the owner to repeat approval.

Spec: `docs/specs/2026-10-01-audio-state-events.md`.
Base: main `6df7c045145d59073bfd2fcafd946978b7126a64`.

## Global constraints

No new sound, asset, control, dependency, Rust or simulation change. Do not import
ambience, its memory harness, closed-context replacement or PR 178. Preserve
normal running fades, silent controls, saved settings and identity-specific stops.
No timer, per-frame or fixed-tick requirement for unavailable-state cleanup.
No source starts on a running-state event. Root owns browser proof and delivery.

### Task 1: Main-based event ownership and causal proof

One worker owns production, tests, proof and relevant docs. Not alone in the
repository: preserve others' changes. No children, push, PR or merge. Do not
stage root-owned output or ignored scratch reports.

1. Impact-scan `BrowserAudioContext`, graph creation, global stop and all test
   doubles. Read the existing interruption specs and testing protocol.
2. Modify `web/tests/audio-controller.test.ts` first. Reproduce existing object,
   conversation, door and procedural tails across a paused interruption without
   manually calling a fixed-tick seam or supplying a new gesture. Run red.
3. Modify only the necessary context port, graph ownership and global cleanup
   in `web/src/audio/audio-controller.ts`. Add an owned `onstatechange` slot,
   identity guard, unavailable cleanup/reset and failure-path detachment.
   Global voice stop must immediately dispose release-only records. Do not copy
   the ambience branch's graph replacement or new room state.
4. Pin fresh-current-action recovery, no restart on the running event itself,
   aborted graph cleanup and stale queued callback safety. Preserve all direct
   cancellation and normal-fade regressions.
5. Add `web/proofs/audio-state-events.js`, export `proveAudioStateEvents()`.
   Render existing object and voice sources through real OfflineAudioContext
   state events with positive and ordinary-fade controls. No injected paused
   availability tick. Test/prove the original implementation fails first.
6. Delete event cleanup, scheduler reset and captured-context guard independently;
   run the covering tests red, preserve errors and restore exact source hashes.
7. Run relevant controller/player/frame suites, full web suite once with one
   worker, typecheck, build, proof syntax/module smoke, doc IDs and diff check.
   Root supplies main-matching WASM; no Rust rebuild. Notify before dist build.
8. Update the spec, audio-foundation behavior and a narrowly identified lesson.
   Preserve old verification history. Report every command/result, original
   failure, mutation restoration and unresolved evidence. Commit locally only.

Root will independently run the named native export and inspect production
gameplay/Options. No full retained-memory or 120 Hz rerun is claimed for this
existing-audio lifecycle-only repair; the separate held-feature gates stand.
