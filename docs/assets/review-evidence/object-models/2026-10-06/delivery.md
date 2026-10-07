# Object models, books and seating: delivery evidence

This record covers the object-models implementation based on published commit
`89040f8205fbc76e7ea0f3d0fb550acc3ed7ae1b`. It records verification and release
limits separately from the proposed public changelog. The approved scope is in
[the implementation plan](../../../../superpowers/plans/2026-10-05-object-models-books-seating.md).

## Current integrated checkpoint

The sections below preserve earlier verification epochs. The current checkpoint
is `9a3bb24a22fcc197ed24abcb4ab59783d78fe458`, which integrates published main
`2f319c3bb14b4c798505e1b6c75fa3186f6f4822`. Current native evidence is in
[the upstream integration report](upstream-2f319c3b-native/verification.md).
Current renderer evidence and the actual resolved catalogue are in
[the merged-main receipt](merged-main-2f319/receipt.json) and
[the updated comparison table](merged-main-2f319/catalogue-balance-and-copy-review.md).
The proposed words still require owner approval.

At this checkpoint, the rebuilt WebAssembly SHA-256 is
`05a3e87727c70e197d7e033b7b3e5fd422af0a02d84bcac97086348936d946e0`.
The broad web run passed 2,180 tests and exposed two stale expectations;
the six affected files subsequently passed all 24 tests. Type checking and
the production build exited zero. These combined receipts are not a claim
that the complete broad suite was rerun after the repairs.

The corrected [return-stage proof](merged-main-2f319/book-return-boundary-proof.json)
observed 61 Return ticks and four Shelve ticks. Title memory stayed unchanged
through those stages and copy 0 returned to its original shelf slot exactly
once. Earlier cancellation probes compared an autonomous reading interval
with a later return interval and therefore could not isolate return behavior.
Their failure receipts remain preserved; the current receipt records the
corrected stage-boundary result. Shelf-contact artwork remains a separate
acceptance gate.

The [fresh final logic review](merged-main-2f319/final-logic-review.md) found
no concrete release blockers in its native/content/save/web scope. It inspected
source and existing receipts without rerunning suites or judging pending art.
Its prompt described the old return-summary wording; that summary was corrected
during the review, and the review output remains unchanged. The review does not
establish owner approval or acceptance of the unfinished assets.

The [release audit](release-audit.md) maps approved requirements to the dated
receipts and open gates. The independent [lowest-left fetch source proof](fetch-spine-mechanics/verification.md)
now establishes finite spine contact, planted feet and a clear rigid-book
corridor on the unchanged rig. Its original sleeve still self-intersects, so
overall source acceptance remains false and no raster is promoted.

## Native verification

The broad native run passed the core and data suites. Its simulation suite
reported 1,224 passing tests and two failures. The two failures were corrected
and their focused regressions passed. The broad WebAssembly boundary run
reported 258 passing tests and one historical V1 restoration failure; the
restoration correction subsequently passed its focused test. These combined
results are not described as a new all-green broad run.

The final historical V1 check, table-retirement checks, source-era checks,
all-target Clippy check and formatting check each exited zero. See
[the terminal exits](native-finish-delivery-exits.json). The native source freeze
contains 320 files and has manifest SHA-256
`3ccfe087ba7183f90021b96ebfe184b453cf90a7bdc72ac2818191eb06468a26`.
The complete local command logs remain in `.tmp/object-models/`.

The final diff review restored the published 1.05 dining-table sitting
preference, which an obsolete-action cleanup had incorrectly removed. The
personality file now matches main. Its focused data checks passed 8, 1 and 1
tests with zero exits. See [the final review](native-final-diff-review.md) and
[its exits](native-final-personality-exits.json). The earlier source freeze
remains preserved separately.

The current save header is 7. Historical readers preserve their published
positional layouts. Old households retain unrelated progress and receive the
starter-book grant once. Current book copies, progress and physical seat claims
are validated. The [integration ruling](upstream-integration-adjudication.md)
explicitly preserves a historical source-admissible television continuation;
this release does not claim strict uniqueness validation for every ordinary
device in manually constructed saves.

## Graphics verification

The shelf graphics probe passed 480 actual graphics cases across directions,
scales, shifts and lighting. Its maximum channel difference was three byte
levels and its 95th percentile was at most two. The reader joint-alpha probe
passed 144 original-float reference cases with maximum difference four and
95th percentile one. Fractional-edge picking passed, and restoring the
incorrect contribution-derived discard produced the expected failures.

The [fresh-context alpha review](reader-alpha-better-way-review.md) explains
why original scene coverage must control blending and picking. Its review was
read-only. Its findings were implemented and checked separately; it does not
approve unfinished furniture poses.

## Final web verification

The full web suite passed all 169 files and 2,163 tests before the final
personality restoration. After that restoration, 77 targeted tests and the
production build passed. Type checking also passed. The final WebAssembly hash is
`62be0469ec5e25a29e13446ebb976645a03f9963b6c7f349de1ea5b02de4ecb8`.
See [the renderer receipt](renderer-receipt.json). These checks do not replace
the missing gameplay visual acceptance.

The resumed recovery work passes desktop click and keyboard recovery, and
390px touch pan, tap and recovery. Both preserve the exact copy, title, home
and Funds. Disclosure-opening and gesture-suppression mutations fail the same
causal unit and browser checks; source restoration is byte-identical. See
[the recovery evidence](resume-browser/README.md). Earlier failures remain
preserved and qualified separately.

Reclining passes actual native ownership, save/load and cancellation checks in
four directions, plus 144 graphics comparisons with correct picking. The
native contract is activity 15, visual action 0 and a whole-sofa claim; the
earlier visual-action-9 assumption was corrected. See
[the runtime receipt](recline-runtime/receipt.json). The four source phase
records are static aliases, not a newly animated sequence.

## Release blockers

The complete shared-sofa action combinations and lower-shelf reaching poses
are not accepted assets. The current shared-sofa catalogue is incomplete and
falls back to generic poses during gameplay. Passing simulation tests,
single-seat graphics checks and the center-seat preview do not resolve that
runtime gap. The branch must not merge or deploy with that gap.

The catalogue and public changelog describe the intended implementation.
They remain unpublished while this branch is a draft. Keep the complete
model and book tables, browser screenshots and final graphics receipts with
this dated evidence before release. The older rejected object-copy record
remains explicitly rejected.

The project string inventory also requires the owner to review replacement
product names and descriptions beside a running build before publication.
Implementation authorization does not establish that review. Present the
complete corrected tables and build screenshots together; do not label
unreviewed copy approved.

## Changelog verification

`node --test scripts/build-changelog.test.mjs` passed all 12 tests with exit 0
on 2026-10-06. `node scripts/build-changelog.mjs` exited 0. The same-day entry
preserves the published calendar, preferences, chores and sound notes from
main. A local build does not establish public deployment.

Source whitespace checks passed with immutable fixture records and literal
verification output excluded. A whole-index whitespace check flags original
CRLF capture records and terminal output; those bytes were preserved rather
than normalized and falsely presented as unchanged evidence. Added source text
passed the dash-character check, and lesson identifiers are unique.
