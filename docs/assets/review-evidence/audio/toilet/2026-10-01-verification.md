# Toilet audio verification against current main

Observed 2026-10-01 on Windows with Chrome. The integrated source revision was
`9a82ea268221741b025c630e904d19ee64ad23af`, based on main
`1d6b68878d02d200825fd9e57c97e6c722d90543`. Harness changes are identified by
the source hashes in the raw assessment. The production files were
`index-B0ws5oeU.js` and `terri_wasm_bg-CVnPYumy.wasm`.

The owner accepted the selected flush recording, requested inclusion, cancelled
indoor background noise and requested quieter footsteps. The latter changes
shipped separately in pull request 203. The toilet feature remains unreleased.
In-game mix acceptance is distinct from acceptance of the source recording.

## Corrected assessment

Earlier assessments could end at different game ticks. The corrected harness
uses a page-local frame observer to pause through the existing speed control.
It requires exactly 540 measured ticks, equal final world hashes and equal
initial world hashes. Overshoot invalidates a run. No state is reloaded at the
final endpoint, no compiler allocations are subtracted and the 65,536-byte raw
memory allowance is unchanged.

Current main has six physical doors. Structural door bounds now derive from the
baseline portal count instead of an obsolete constant of four. Layout and
capacity must remain unchanged; a seventh track fails the six-door fixture.
The simultaneous playback cap remains four. Tests first rejected the valid
six-door fixture, then passed after the corrected layout bound.

`node .tmp/toilet-release-memory.cjs`: FAIL, exit 1. The predefined three pairs
recorded audio-enabled minus audio-disabled retained JavaScript growth of
30,000 / 139,712 / 348,468 bytes. Median growth was 139,712 bytes, exceeding
65,536 by 74,176 bytes. Structural and coverage checks passed. All runs began
at tick 62, hash `17477612144639247524`, and ended at tick 602, hash
`15279895459566478599`. Enabled runs played four measured flushes each;
disabled runs played none. WebAssembly capacity did not grow. Browser and
preview server closed. Raw report: [memory-current-main.json](memory-current-main.json).

This is a whole-audio comparison. It does not establish that the flush causes
the excess or that a leak exists. It also does not pass the required check.

## Finite causal comparison

A single predefined four-condition diagnostic compared the same main code with
quieter footsteps against the flush feature with the same quieter footsteps.
No condition was retried. The diagnostic omitted intermediate heap samples and
used identical saved fixtures, exact endpoints and matching world hashes.
It is not a replacement acceptance test.

| Condition | Raw retained JavaScript growth |
| --- | ---: |
| Main, audio disabled | 72,388 bytes |
| Flush feature, audio enabled | -82,188 bytes |
| Main, audio enabled | 111,428 bytes |
| Flush feature, audio disabled | -131,480 bytes |

Main's enabled-minus-disabled difference was 39,040 bytes. The flush build's
difference was 49,292 bytes. The difference between those two results was
10,252 bytes. All four conditions had matching initial and final world states,
unchanged document/listener counts and no page errors. Browser and both servers
closed. These single samples do not prove repeatability or resolve the failed
assessment. Raw report: [current-causal.json](current-causal.json).

Diagnostic script SHA-256:
`d1944b828cc5b3d26a406bf1f4485e4a738e908bb89ff125e6a2d2c725510307`.
The task-owned script remains `.tmp/toilet-current-causal.cjs`.

## Playback and cancellation

`node .tmp/toilet-current-playback.cjs`: playback assertions PASS. Cancellation
left event and playback counts at zero. Genuine completions at ticks 53 and 236
each played one flush from toilet 29. The first ended after its recording;
effective pause stopped the second. The completion buffer was empty. No page
errors occurred. Getter-assisted drainage is not evidence of passive callback
cleanup; the separate [natural-ending proof](natural-ending.json) establishes
that callback ownership for its inspected cases.

Nine native browser audio renders passed for single and four-source playback,
Load, mute, Effects zero, background, pause, suspended and interrupted states.
Peak amplitudes were 0.0604901239 and 0.2419604957. Stop cases were silent after
0.2 seconds; every case was silent after the recording ended. These render
checks model interruption labels; they do not establish an operating-system
interruption or subjective listening acceptance.

The [current screenshot](current-game.png) was inspected at 1440 by 1000 pixels.
The selected actor's label reads Using the toilet. The actor still stands beside
the toilet in the generic use pose; seated animation remains separate visual
work. Raw playback report: [current-playback.json](current-playback.json).

The browser and HTTP servers closed. The development proof server left its file
watcher alive after HTTP closure, so the root editor verified and stopped only
the task-owned runner process. The script now closes the complete development
server. No audible test page or task-owned listening port remains open. The
runner's final process exit was 1 from this cleanup, not a playback assertion
failure.

## Local checks and adversarial review

1. Fresh release WebAssembly build: PASS, exit 0.
2. `cargo test --workspace --jobs 1 -- --test-threads=1`: PASS, exit 0 against
   the integrated current-main source.
3. `cargo clippy --workspace --all-targets --jobs 1 -- -D warnings`: PASS, exit 0.
4. `cargo fmt --all -- --check`: PASS, exit 0.
5. `npm --prefix web run typecheck`: PASS, exit 0.
6. `npm --prefix web test -- --maxWorkers=1`: PASS, exit 0 against the integrated
   runtime. The later harness-only portal-bound regression passed its focused suite.
7. `npm --prefix web run build`: PASS, exit 0; the existing large-chunk warning remains.
8. Focused endpoint guard mutation: removing the final-world comparison failed
   its regression. The source was restored byte-exactly.
9. Focused world-replacement mutation: retaining completion events in the restored
   world failed the native pending-event test. The source was restored byte-exactly.

The new native load fixture initially omitted SelfPreservation. Loading correctly
migrated that legacy fixture and consumed random state. Adding the current-save
field before ticking fixed the fixture; hash and save equality assertions remain.

A fresh-context better-way reviewer examined the three prior failures before
the corrected assessment. Two read-only reviewers inspected the integrated
implementation against its contract and lifecycle standards. A pending-event
load-test gap and misleading natural-drain label were corrected. The final
source review found no material integration issues. Reviews did not waive
memory, display-rate or in-game listening requirements.

## Unavailable evidence and release boundary

The display reports 60 Hz, not the required 120 Hz. Prior measured sampler work
passed its timing limits, but the 120 Hz calibration remains UNVERIFIED. The
owner has not accepted this latest in-game mix. No release exception has been
granted. Do not report draft pull request 178 as merged or deployed.
