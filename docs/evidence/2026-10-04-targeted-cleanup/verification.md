# Targeted dish cleanup verification

Inspected against base revision `8bb83ffb35846e9b4e59bc319937d140dce14bb0`
on Windows, 2026-10-04. Changes are local; this record does not claim publication
or owner visual acceptance.

## Behavior and review

Fixed pile orders capture dish identities. Surface orders retain their target
through collection, washing and repeated trips. Tests cover accumulated piles,
legacy settings, other cleaners, stale requests, cancellation, save/load at every
work transition, queue order, causal hashing and invalid input. Pointer and
keyboard menus share their scope rules; touch long-press is covered through the
production gesture controller. Picking is tested across facings, zoom levels,
transparent pixels and overlapping Sims.
The pointer regression also transfers the position buffer during dish export,
proving that the copied dish projection must precede reads of simulation views.

Independent review found keyboard menu bypass, transparent dish corners
intercepting furniture clicks, and invalid paused orders producing unloadable
saves. Regression tests cover each correction. The reviewer declined to judge
real-time animation, touch hardware and full visual acceptance from code alone.
No additional art or dependency changes were made.

## Executed checks

The [check receipts](checks.json) contain exact commands, exit codes and verdicts.
Each receipt links by check name to its matching `.log` file here. All final
checks passed. Native workspace tests and the full web suite were executed;
release-mode boundary tests separately verified the compiled browser boundary.

The first full web run exposed two historical-save fixtures whose byte offsets
omitted the new optional tail. Those fixtures now check the additional field and
the same complete-boundary versus interior-truncation distinction. The initial
failure is retained in `web-tests-initial.log`.

## Fault checks

The [native fault receipts](mutations.json) record removal of surface filtering,
fixed identity filtering, target persistence, repeated collection and the scoped
hash contribution. Every corresponding test failed with the fault present.
The [dish alpha receipt](dish-alpha-mutation.json) records the transparent-pixel
regression failing when alpha filtering was removed. Every source restoration
was byte-identical, and the restored tests passed. Individual failure logs are
retained beside the receipts.

## Browser evidence and limits

The real game page used a validated household save from
`crates/terri-wasm/examples/targeted_cleanup_review.rs`. Actual pointer menu
activation initiated the chores; deterministic simulation ticks advanced them.
The [original callback](original-browser-callback.txt) and
[evidence record](browser-evidence.json) preserve assertion ordering and artifact
hashes.

The callback guarded pickup of two dish units, save/load hash equality during
washing, completion with the other table pile and both counters intact, the
dirty-table Clean up menu without Sit down to eat, and completion with only
counter dishes remaining. Every guard and the final screenshot preceded the
failed report export. This is evidence from execution ordering, not a successful
structured tool result. The discarded intermediate result values were not
reconstructed.

The export failed with
`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` while importing a filesystem module
inside the tool's JavaScript virtual machine. A fresh review confirmed that the
completed run could be preserved through controller-side file tools. Screenshots
sample visible states; clock and activity labels can lag manually advanced
simulation state. They do not prove exact identities or hashes. No real-time
animation recording or touch-hardware operation is claimed.

1. [Initial capture](before.png): presentation timing may retain an earlier state.
2. [Pile menu](pile-menu.png): Do dishes targets one visible pile.
3. [Transport](carrying.png): collected dishes are carried toward the sink.
4. [Washing](washing.png): the Sim washes at the kitchen sink.
5. [One pile remaining](one-pile-cleaned.png): the other table pile remains.
6. [Surface menu](surface-menu.png): Clean up replaces the dirty table's eating action.
7. [Cleared table](table-cleaned.png): the counters retain their dishes.

The task-owned page closed in the callback's `finally` block. The preview server
on port 5188 stopped after its process command line was checked against this
worktree.

## Touch and keyboard browser check

A later browser check returned structured results successfully. The
[touch and keyboard receipt](touch-keyboard-evidence.json) records the returned
orders, carried counts and exact remaining dish projections. A 390 by 844
Chromium viewport used touch emulation with a held touch and menu tap. A 1280 by
900 viewport used canvas focus, arrow-key targeting and Enter menu activation.
The dirty table excluded its eating action, and individual pile commands
collected only their selected identities. Both browser contexts closed in
`finally`.

1. [Touch pile menu](mobile-touch-menu.png).
2. [Touch pickup](mobile-touch-pickup.png).
3. [Keyboard surface menu](keyboard-surface-menu.png).
4. [Keyboard pile menu](keyboard-pile-menu.png).

This check establishes browser touch emulation and keyboard operation. It does
not establish physical phone behavior or real-time animation acceptance. The
earlier export failure remains part of the evidence record.
