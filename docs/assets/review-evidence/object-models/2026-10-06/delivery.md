# Object models, books and seating: delivery evidence

This record covers the object-models implementation based on published commit
`89040f8205fbc76e7ea0f3d0fb550acc3ed7ae1b`. It records verification and release
limits separately from the proposed public changelog. The approved scope is in
[the implementation plan](../../../../superpowers/plans/2026-10-05-object-models-books-seating.md).

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

The dropped-book gesture can open Build and Books, but its recovery-button
focus check has not passed. Keep that interface proof gap open. Native copy
recovery has passing bridge coverage; it does not prove the visible gesture.

## Release blockers

The complete shared-sofa action combinations and lower-shelf reaching poses
are not accepted assets. The current shared-sofa catalogue is incomplete and
can reach its missing-scene guard during gameplay. Passing simulation tests,
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
