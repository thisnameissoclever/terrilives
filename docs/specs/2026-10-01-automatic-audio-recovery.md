# Automatic audio recovery from current actions

Status: merged in PR 181 at `b7c57d7f8799c261dc2427baefc6bd3b20160bff`.
Main CI `36844167451` and Pages deployment `36844708525` passed.
Local tests, native rendered checks, production
inspection and independent review passed before merge. No listening acceptance
or operating-system interruption reproduction is claimed.

## Defect

An object or conversation starting during external audio suspension was marked
as started by its scheduler, although the controller refused playback. The same
action observed after automatic return to running then stayed silent. The
earlier cancellation repair in PR 180 handled endings, not these lost starts.

## Contract

1. World observations require a running, foreground context, master sound on,
   and Effects above zero. Voices alone at zero does not stop transport.
2. Gate forwarding for footsteps, activities, objects and portals together.
   Begin/end frames remain unconditional. Unavailable frames use existing
   absence handling, not a reset in the middle of an open frame.
3. The first unavailable fixed tick releases existing object/conversation
   ownership, including pending clips. A stopped clock uses immediate disposal.
   A direct semantic stop still targets only its exact identity.
   Before opening that tick's first scheduler frame, stop unfinished procedural
   and door cues when those players still have active sources. Their frozen
   tails must not return alongside fresh sounds. Empty players need no repeated
   cleanup. This check never resets an open frame or retains a transition flag.
4. The first returning audible tick starts only currently observed objects,
   conversations and personal/sleep cadence. Continuing recordings restart from
   their beginning; frozen playback positions are not preserved.
5. Footsteps and doors anchor their current positions/state silently. Motion
   and opening/closing transitions that occurred while unavailable never replay.
6. Actions entirely contained in the silent interval stay silent. Late decoding
   cannot revive a departed owner. Semantic events never create or resume an
   audio context; there is no new listener or simulation contract.
7. Pause still stops fixed ticks and object loops, while already-playing short
   cues and conversations may finish. Mute, visibility, Load and explicit
   gesture-recovery boundaries retain their existing cleanup paths.

This handles unavailable states observed by fixed ticks. It does not claim to
detect every hardware interruption between ticks, prevent browser suspension,
or recover a context that the browser refuses to resume.

## Verification record

Baseline: 154 controller tests passed. Two new regressions failed before the
implementation: the active object and conversation counts were zero rather
than one after automatic recovery. With the observation gates, the focused
controller suite passes 176 tests. Four further regression variants reproduced
unfinished procedural/door sources, and another exposed a stale cleanup latch
when a cue was emitted between unavailable frames. The final helper has no
latch: it checks the players' active counts before stopping them.

The browser proof is `proveAutomaticObjectRecovery()` in
`web/proofs/audio-interruption.js`. Invoke it from a trusted click in the
isolated `/proofs/index.html` page served by Vite. It uses a real AudioContext,
an analyser and a zero-gain speaker output. After initial activation, native
suspend/resume occurs without another controller gesture. The current action
renders `0.14000000059604645`; an action that departed stays exactly silent.
All seven existing offline cancellation sample checks also pass. The final
recovery proof also requires an unfinished sleep cue to be disposed during the
unavailable frame, so a frozen transient cannot contaminate the resumed output.

The first version of this recovery proof used OfflineAudioContext. It exposed
the baseline missed start, but its fast render could outrun source insertion
after resume even with the fix. The realtime version removes that fixture race
and verifies native output without playing the constant test signal aloud.

## Final local checks

All commands exited 0 on 2026-10-01:

| Command | Result |
| --- | --- |
| `npx vitest run tests/audio-controller.test.ts --maxWorkers=1` in `web/` | 176 passed |
| `npm test -- --maxWorkers=1` in `web/` | 1,604 tests in 112 files passed |
| `npm run typecheck` in `web/` | Passed |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | Release build passed; Rust source unchanged |
| `npm run build` in `web/` | Built `index-Ib0rHboH.js` |
| `node --check web/proofs/audio-interruption.js` | Passed |
| `python check-doc-ids.py` and `git diff --check` | Passed |

Fourteen targeted negative mutations failed assertions and were restored:

1. Removing the object or activity observation gate lost the recovered start:
   expected one active source, received zero.
2. Removing either footstep or portal gate retained a silent track: expected
   zero, received one.
3. Removing each of the unlocked, mute and Effects predicate clauses admitted
   a track while unavailable: expected zero, received one.
4. Removing each of the four begin-frame hooks left the oscillator connected.
5. Removing procedural or door disposal left its source connected.
6. Removing the helper's audible-state guard stopped valid sounds in all four
   standalone frame variants.

Removing the object gate also failed the native browser proof with
`Current action did not recover through an ordinary observation`. The final
restored source passed the rendered proof, including frozen sleep-cue disposal.
Controller SHA-256:
`633bce73a71f998d1ca47dded6846a69ee22068afaa818e8b90ca0e18107268d`.

The built game rendered 37 entities. The household, Pause and Options were
visually inspected at Day 1, 00:13; Effects remained 70% and Voices 100%.
[Observed game](../assets/review-evidence/audio/automatic-recovery/game.png).
Console errors were limited to the existing favicon 404. No save was created
or loaded. All task-owned browser sessions and preview servers were closed.

Independent review approved the stated scope. Native simulation tests and the
full 120 Hz/retained-memory sweep were not rerun for this shell-only repair.
The separate PR 178 retained-memory release hold remains in force.

## Release-only follow-up

A recording already fading out before suspension can retain its release-only
record after its scheduler owner is gone. Review identified a possible resumed
tail of up to 20 ms for an object or 12 ms for a conversation. This is a
pre-existing, code-derived finding, not an acoustically reproduced result.
It is separate from the current-action recovery and unfinished one-shot cleanup
verified here. Test suspension midway through an existing release, then dispose
retained release-only records at the unavailable boundary without weakening
exact-identity direct cancellation. The separate
[interrupted release cleanup](2026-10-01-interrupted-release-cleanup.md)
records the reproduction and repair of that case.
