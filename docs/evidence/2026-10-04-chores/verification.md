# Household chores verification

Evidence applies to the local change set based on
`8bb83ffb35846e9b4e59bc319937d140dce14bb0`. The implementation has not been
committed, pushed or deployed. `checks.json` records exact commands, exit codes,
elapsed times and log paths for the final verification run. Logs retain relevant
test results; earlier failures are retained separately.

The final native workspace run passes 1,522 tests. The web suite passes 1,969
tests with one worker. All twelve commands in `checks.json` pass after a
whitespace-only HTML correction; `diff-before-whitespace-fix.log` retains that
initial formatting failure. Production generation retains the existing large
bundle warning. No check is reported as remote CI or deployment acceptance.

## Native and browser checks

The workspace tests cover targeted dish claims and scope, physical chores,
mixed queues, historical saves, each-tick continuation, actual furniture/wall
edits, cancellation, death and midnight settlement. The release boundary tests
reject invalid JavaScript numbers and every interior cut of the new saved
tails before adoption. Formatting, warning-free Rust lint, type checking,
WebAssembly generation, the one-worker web suite, production generation,
changelog checks and documentation identifiers are recorded in `checks.json`.

The native fixed hash and the independently rebuilt WebAssembly scenario both
measure 10573318194146010528. The encoding now includes scoped queue state,
household grime, profiles, duty decisions and its random stream; board work can
also affect the scenario. Both fixtures state that reason rather than silently
accepting a changed value.

## Fault and review evidence

`mutations.json` records ten deliberate faults. Cancellation/death cleanup,
room-plan reconciliation, moved contacts, bin conservation, separate saved-kind
and saved-contact guards, midnight deferral, causal hashing and persistence each
cause their regression to fail when removed. Each operation restores exact
original bytes in a finally block and compares them. The mutation logs and
runner are retained here. These are targeted local fault checks, not a remote
mutation sweep. Later commute ownership tests separately recorded RED before
the fix; `commute-red.log` preserves that failure.

The independent reviewer identified the lifecycle defects, reviewed their fixes,
and inspected the final PNG pixels. The reviewer confirmed visible floor,
surface and bin cleanup, work at the relevant targets, readable desktop/phone
panels and distinct counter coordinates. The reviewer did not independently run
the automated suite. `lifecycle-red.log` preserves the original reproduction.

## Played controls and limits

`browser-proof.cjs` returns the exact values in `browser-evidence.json`. It
loads a valid native fixture, activates the real profile and Do now controls,
checks saved continuation during floor work, advances ordinary simulation ticks
to completion, and captures the matching presentation after an explicit frame.
Exposed brown floor tiles become gray; the dirty counter and bin also visibly
clear. Work captures wait until the Sim stops walking at its chore target.
`weekly-board-top.png` shows the week, assignment checkbox and distinct counter
coordinates. Recent outcomes retain actual performer identities.

`controls-proof.cjs` returns `controls-evidence.json`: keyboard Enter activates
the floor menu and board controls; phone-size Chromium touch emulation taps
the board, applies a profile and orders bin work. The desktop and 390 by 844
phone dialog have no horizontal overflow. Earlier dish-pile touch long-press
and keyboard cycling are preserved in
`../2026-10-04-targeted-cleanup/touch-keyboard-evidence.json`.

These checks use bounded manual simulation ticks and browser touch emulation.
They do not establish physical-phone acceptance, real-time animation quality
or owner approval of new cleaning-tool art. Floor, wipe and bin work currently
use the standing pose. No audio acceptance is claimed.

All task-owned browser contexts close in finally blocks. The verified preview
process for this worktree, PID 40792 on port 5188, was stopped; a subsequent
listener check found no task preview. Other pages and servers were untouched.
