# Existing audio state-event verification

Scope: main-based interruption cleanup for existing sounds. This does not ship
indoor ambience or clear the separate release holds on PRs 178 and 184.

## Native original failure and repaired result

1. Before production edits, root ran `node web/output/playwright/verify-audio-state-events.cjs native-original-production.json`. Exit 1: the first resumed object sample was `0.08399999886751175`, expected zero. No page errors occurred. The receipt is [native-original-production.json](native-original-production.json).
2. After implementation and exact restoration of six negative mutations, root ran `node web/output/playwright/verify-audio-state-events.cjs native-final.json`. Exit 0: all 18 assertions passed. Object and conversation sources had positive output before interruption; their first resumed samples and entire resumed tails were zero. Ordinary fades retained their positive control samples. The receipt is [native-final.json](native-final.json).
3. The proof uses actual `OfflineAudioContext` state events forwarded through the production controller's context port. It does not inject a simulation tick during the interruption. It is controlled native-clock evidence, not proof of every operating-system or physical-device interruption.

The original missing-server attempt and two hot-reload navigation failures were
tooling failures, not product red/green evidence. The existing lockfile's
dependencies were installed, and root restarted its development server after mutation
edits ended. No dependency version changed. Every browser closed in a finally
block.

Production controller SHA-256 at the passing native run:
`595EA22C083AFFA0528EB306B2EAE376A8F77FFCC48B85402FE9BBF2806C3749`.

## Built-game inspection

Root ran `node web/output/playwright/verify-audio-state-game.cjs` against the
production preview on port 5223. Exit 0, no page errors. The actual browser
AudioContext had the owned handler. After pausing at tick 12, suspension and
recovery left the simulation at tick 12 and all active/retained source counts
at zero, without another gesture or simulation observation. Earlier gameplay
had emitted 18 footsteps and one door-open cue. This game-level check confirms
wiring; the positive interrupted-release proof above establishes tail disposal.

Effects remained 70%, Voices 100%, and there was no ambience control. Root opened
and inspected [game.png](game.png) and [options.png](options.png): the lot, Sims,
furnishings, household bar and sound controls rendered. The nighttime scene
remains dim; this patch does not change lighting or art. The machine-readable
receipt is [game-verification.json](game-verification.json).

Built bundle: `index-D6zT8jXc.js`. Both task-owned servers (5223 and 5224) were
stopped after verification; all task browser pages closed in finally blocks.
No subjective listening acceptance is claimed.

## Automated checks and review

The [implementation report](implementation-report.md) records test-first
failures, six assertion-failing mutations and exact source restoration. The full
web suite passed 1,713 tests in 114 files; focused suites passed 298 tests.
Typecheck, production build, proof syntax, documentation IDs and whitespace
checks passed. Task and whole-branch reviews found no production blockers.

Both reviews identified a proof cleanup defect: failure at the first hold could
leave the second scheduled suspension blocking render completion. Root chose
to fix it before publication. The cleanup now drains both scheduled holds,
awaits native rendering, and preserves the original assertion for the caller.

Root ran `node web/output/playwright/verify-audio-state-events.cjs native-cleanup-original.json proveAudioStateEventsFailureCleanup`
before that fix: exit 1, the proof did not settle within the fixed five-second
watchdog. After the fix, the same runner with `native-cleanup-fixed.json` exited
0 and verified both the exact original assertion and the closed native render.
The default proof rerun with `native-after-cleanup-fix.json` also exited 0 with
all 18 checks passing. All three receipts are preserved beside this document.
No timeout increase or error suppression was used.

This final change touches only proof code. Production source and the previously
inspected build are unchanged, so the passing game checks and full suite were
not repeated. Scoped fix re-review found the cleanup defect addressed and no
new breakage. All review findings are closed.

## Decisions and scope

1. Deliver the existing-audio repair separately from held ambience. Main-based tests and native proof cover the existing four families; absent ambience interactions remain part of that feature's own acceptance.
2. Use owned context state events rather than simulation polling. This covers paused worlds without adding per-frame work. Controlled native proof still cannot establish every physical-device event sequence.
3. Fix proof failure cleanup before publication. This added one small proof-only validation and review round, while production source remained unchanged.
