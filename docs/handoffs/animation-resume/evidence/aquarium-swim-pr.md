## Summary

Aquarium fish now use eight independently phased swimming samples rather than
two alternating poses. Bodies drift while attached tails flex. All four views
retain the accepted tank, glass, cabinet and earlier sprite pixels.

## Verification

Local workspace Rust tests: 1,485 passed. Fresh browser binary, type checking,
1,971 web tests, production build, strict Clippy and formatting passed.
Staged-only export passed atlas freshness, 189 sprite tests, 37 living-model
tests and document-ID checks. Workflow tests and changelog tests passed.

Saved-model containment, contact and lid sightlines passed for every sample.
Primary and independent source/runtime visual reviews accepted the batch.
Actual graphics passed 42 cases. Normal 1x playback displayed all eight fish
samples; Pause froze progression. The preservation proof retains all 2,483
published decoded sprites and registration/interaction tables.

Remote checks may still be pending. Those are not reported as passed. This
batch does not implement media seating or the missing bathroom body animations.

## Changelog

- [x] Reviewed every significant player-facing change, including follow-up fixes.
- [x] Updated `docs/changelog/2026-10-05-covered-bunks.md` on this branch.
- [x] Reconciled the delivery date and preserved published notes.
- [x] Ran the changelog tests and generated the page.

Internal evidence: `docs/assets/review-evidence/living/aquarium-swimming-2026-10-05.md`.
