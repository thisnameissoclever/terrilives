# Dispose recording releases when audio becomes unavailable

Verification record: full web tests, type checking, build, rendered checks,
production inspection and independent review passed before publication. This work
extends the current-action recovery in PR 181 without changing recordings,
gains, simulation state, normal fades or direct cancellation identity.

## Defect and contract

Ending an object or conversation while the audio clock runs removes its active
owner and leaves a short release fade connected. Suspending before that fade
finishes freezes the retained nodes. The next empty scheduler frame has no
owner left to end, so the remaining tail could sound after native resume.

At an unavailable frame boundary, reclaim every retained object and conversation
record, including active and release-only records. Use retained counts, not
active counts. Object playback already supports immediate global disposal;
conversation playback gains an optional immediate mode while keeping its normal
fade as the default. Immediate mode stops each source and disconnects its nodes
even when another source rejects stop. Repeat cleanup and stale end callbacks
must not affect a later conversation.

This is global unavailable-frame cleanup. Direct object/action and conversation
end events keep their exact identity checks. An available frame must leave
normal releases alone. Pause and Voices at zero retain their existing behavior.
No new listener, timer, dependency or browser-state transition is introduced.

## Reproduction

The existing focused controller, object and voice tests passed 238 cases.
New public-controller regressions then ended each recording while running,
suspended before its release finished and processed an empty frame. Both
failed: one retained recording remained instead of zero.

`web/proofs/audio-release-interruption.js` adds `proveReleaseInterruption()`.
It renders constant buffers through the actual players and controller. The
first offline hold lets the adapter schedule a normal release at exactly
128 ms while reporting a running clock. The second hold at 136 ms exposes the
native suspended state. This controlled scheduling adapter is not a claimed
operating-system interruption reproduction or a subjective listening test.

Before the fix, the first resumed sample was `0.08399999886751175` for the
object and `0.05226665362715721` for conversation, both expected to be zero.
The paired normal-fade controls passed, showing the source was positive and
already fading before interruption rather than silently absent throughout.

## Final evidence

Commands exited 0 on 2026-10-01:

| Command | Result |
| --- | --- |
| `npx vitest run tests/audio-controller.test.ts tests/voice-clips.test.ts tests/object-loops.test.ts --maxWorkers=1` in `web/` | 245 passed |
| `npm test -- --maxWorkers=1` in `web/` | 1,611 tests in 112 files passed |
| `npm run typecheck` in `web/` | Passed |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | Release WASM built; Rust source unchanged |
| `npm run build` in `web/` | Built `index-BprMGcDH.js` |
| `node --check web/proofs/audio-release-interruption.js` | Passed |
| `python check-doc-ids.py` and `git diff --check` | Passed |

All 18 new rendered sample checks passed. Both interrupted tails were exactly
zero from the first resumed sample to the render endpoint. Normal controls
retained the positive plateau, intermediate fade and normal silent endpoint.
All ten existing `proveVoiceFades()` cases also passed.

Seven compiling negative mutations failed assertions and were restored:

1. Replace object retained count with active count: one controller failure,
   expected zero retained records, received one.
2. Replace conversation retained count with active count: the same failure.
3. Remove either immediate object or conversation cleanup: one failure each,
   expected zero retained records, received one.
4. Omit the draining conversation pass: five failures with one retained pair.
5. Restore the ended-record early return: the same five failures.
6. Make immediate disposal the default: the ordinary fade regression failed,
   expected more than three gain events, received three.

Final restored SHA-256 values matched before and after mutation:

1. Controller: `117a828aa2dd352397e21c5f697a0befec65c5d470cac6862faef18164085682`.
2. Voice player: `23bbca0a0e2fdc5eb884de8788fd994ffe6675532ea60ebbacd47698ca2ccd6c`.

Independent review found no blocking findings. The actual production game was
opened in a fresh browser, advanced to Day 1, 00:13, then paused. Options showed
Effects 70% and Voices 100%. The household and controls were visually inspected;
[game screenshot](../assets/review-evidence/audio/release-cleanup/game.png).
No save was created or loaded. Only existing favicon 404s appeared in the console.
Both task-owned pages closed in `finally`, their browser sessions closed, and
both preview servers stopped.

The full retained-memory/120 Hz sweep and subjective listening acceptance are
separate evidence. PR 178's existing memory release hold is not waived here.
Native simulation tests were not rerun for this shell-only change. This proof
does not cover an interruption entirely between sampled frames.
