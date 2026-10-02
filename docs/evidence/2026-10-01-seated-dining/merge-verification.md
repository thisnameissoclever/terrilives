# Dining merge verification, 2026-10-01

The owner approved the corrected chair rendering and authorized local validation
and fresh adversarial review before merging PR #200. Remote CI and GitHub review
are skipped under that authorization. This record supplements the earlier
chair evidence; it does not relabel earlier screenshots as a live deployment.

## Combined graphics

The branch integrates main `6fc5cc4d` in `e989faf7`, then main `75e766c7`.
Doors keep drawing mode `-2`; dining uses distinct modes `-3` and `-4`.
Exact duplicate image rectangles share storage. New generic domestic animation
frames remove empty borders with matching anchors and content height across all
palettes. Published canvases and occupied dining contributions remain unchanged.
A deterministic free-rectangle packer complements shelf packing.

[Published-prefix comparison](merge-main-prefix.json) verifies the existing
sprite identities, dimensions, decoded pixels and registration against main.
Additional stove surface registrations implement the supported cooking pot.
[Graphics results](merge-gpu-comparisons.json) contain 100 chair records,
132 table records and 864 door records, including deliberate regressions.
All graphics validation checks and the narrower chair/table contact checks pass.
The earlier strict whole-scene colour maximum remains a separate failed gate;
no error limit or outline exclusion changed during integration.

The graphics check used the combined shader and generated atlas. Removing one
extra final blank line afterward changes no shader tokens. The later toilet
integration changes no renderer, sprite compiler or image input. Its graphics
proofs therefore remain applicable. Task-owned proof tabs and server were closed.

## Completion and resumption

Fresh review reproduced silent toilet completion during an interrupted meal.
`ChainState` stores the suspended recipe and is valid beside an ordinary toilet
action. Completion eligibility now retains that state while excluding active
`StepWork`, chain-step targets and mismatched identities.

The native regression interrupts both cooking and cleanup, restores a save
during toilet use, compares continuation hashes and events, requires one flush,
and requires the original work to resume and finish. The browser regression
requires a successful load, one emitted event and subsequent cooking progress.
[Interruption mutation](merge-interruption-mutation.json) records the old guard
failing the new regression and byte-exact source restoration.
[Renderer and picking mutations](merge-mutations.json) record independent failures
and restoration for the drawing-mode collision and missing carried-food selection.

## Validation scope

[Local commands and source hashes](merge-verification.json) distinguish the full
workspace run after graphics integration from the relevant native reruns after
the later audio integration. Unchanged model-export suites and a full mutation
sweep were not repeated. The final complete web suite includes the rebuilt
browser binary. An initial audio integration run started before that binary
finished rebuilding and failed its four new export tests; the sequential rerun
passed. The production build retains the existing large-chunk advisory.

The fresh reviewers' valid findings were fixed, including successful-load and
actual-resumption assertions. No live deployment or subjective audio acceptance
is asserted by these local checks.
