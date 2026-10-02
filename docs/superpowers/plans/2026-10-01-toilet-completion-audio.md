# Toilet completion audio implementation plan

Spec: `docs/specs/2026-10-01-toilet-completion-audio.md`.

## Global constraints

Preserve gameplay, reservations, saves, RNG and content fingerprint. No dependency changes or purchases. Ordinary controls remain silent. Each fixed tick consumes or discards every completion event. Never infer completion from an action disappearing. No delayed event replay. No edits to unrelated work. Use test-first public seams and targeted fault injection. Keep browser pages and servers task-owned and close them in finally blocks.

## Task 1: Completion contract from simulation to playback

Ownership: one implementer owns Rust/content, bridge/main, TypeScript audio and tests, and focused proof modules if needed. Root owns assets, preparation scripts, documentation, final production proof and delivery. The implementer is not alone and must not revert other edits. No child agents or Git commits from the implementer.

Interfaces: implement the spec's packed action/source pairs using `completion_sound_count`, `completion_sounds_ptr`, `clear_completion_sounds` in WASM and `completionSoundCount`, `completionSounds()`, `clearCompletionSounds()` in the TypeScript bridge. Audio event is `{ type: 'object.completed', sourceId: number, action: number }`. Add a drain helper called in the fixed-tick path even when other audio sampling is disabled. Runtime asset is `audio/toilet/flush.wav`. Start with gain 0.08 and maximum decoded length 30 seconds; root will select and measure the source before final review.

1. Read the spec and relevant docs. Impact-scan touched signatures and interfaces.
2. Write a failing compilation/completion test; run and observe failure. Add minimal metadata and buffer implementation. Extend one behavior at a time to all identity, tick lifecycle and persistence cases.
3. Write a failing drain/controller test. Wire bridge, fixed tick and playback. Cover late decode, muted/unavailable drops, retries, source bounds and all stop boundaries. Ensure diagnostics expose successful toilet-flush count and active voice count for real-game proof.
4. Run focused Rust/web tests, typecheck and targeted fault injection, restoring exact source bytes. Coordinate heavy commands with root. Report exact red/green commands/results and limitations in the task report.
5. Root packages the diff for independent spec/quality review. Implementer resolves material findings with failing regression tests before green verification.

Expected: all focused checks pass; each intended guard mutation fails its test. No implementation is called shipped until assets, complete checks, actual production proof and merge finish.

## Task 2: Recording, integrated verification and delivery

Ownership: root. Compare both retained originals, preserve selected provenance and convert reproducibly without new dependencies. Add asset checks and actual offline-audio proof. Update audio docs and lessons if this exposes a material mistake. Run combined Rust/web/lint/build checks once against the final changed code. Inspect production game, completion, cancellation and pause behavior. Obtain a fresh whole-branch review, fix material findings, commit/push/merge, verify remote refs and leave main clean. Report Pages deployment separately from source delivery.

Expected: no clipping or replay, active voices bounded and stopped at lifecycle boundaries, screenshot inspected, production proof errors empty, checks passed or explicitly unverified, source merge confirmed.
