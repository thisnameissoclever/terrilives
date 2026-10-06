# Table picking follow-up

Inspected 2026-10-05 against the local chores implementation. The owner reported
that visible table wood beside Tim opened only Nothing and was too difficult to
target. This follow-up supplements the earlier checks; it does not claim remote
integration or publication.

The isolated menu regression reproduces the reported result. The actual published
idle sprite has alpha zero at the tested point, inside its rectangular bounds.
Body picking previously assigned the nearer Sim to that transparent area. Its
self menu then hid the table's Clean up action. The table's own content bounds
already cover the visible wood; enlarging them would not remove that interception.

The fix samples the displayed body frame's exact alpha, including linear edge
sampling. Transparent body corners pass the click through. Visible body pixels
retain normal depth priority; paired interaction and covered-bed ownership remain
unchanged. Opaque pixels use bits and partial-alpha pixels retain exact values.
The cache is bounded by the registered frames and does not retain the atlas bitmap.

The original failing log, restored regression log and isolated sampler-disabled
fault log are preserved beside this report. Disabling body alpha sampling causes
the three zoom regressions to fail with Nothing. That fault runs in a temporary
test module; the live preview's production source bytes remain unchanged.
`table-picking-mutation.json` records its exit and source hashes.

An actual browser startup loads the production atlas reader. A real right click
at canvas (590, 315.5) picks table entity 7 and displays Clean up beside Tim.
The visible body point (576, 336) still picks Tim, entity 34. The normal structured
return is `table-picking-browser.json`; `table-corner-fixed.png` shows the result.
No page errors were observed. The independent reviewer checked sampling,
ownership, bounded storage and the screenshot; no actionable finding remained.

The final web suite passes 1,974 tests. Type checking, production generation,
changelog tests, documentation identifiers and whitespace checks pass. Native
simulation evidence from the preceding chore implementation remains applicable.

Commands: `npm --prefix web test -- --maxWorkers=1`, `npm --prefix web run
typecheck`, `npm --prefix web run build`, `node --test
scripts/build-changelog.test.mjs`, `python check-doc-ids.py`, and `git diff
--check`. The native simulation is unchanged. The user-facing preview on port
5191 remains open by request; the isolated verification context closed in finally.
Remote main was fetched and is eight commits ahead of this checkout. Those
upstream changes are not part of this local picking proof.
