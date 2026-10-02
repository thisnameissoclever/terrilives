# Seated dining and cleanup verification

Observed on 2026-10-01 in the Windows development checkout. The native and visual evidence covers the cleanup and dining branch integrated with main `85e826ba`, including its published sleeping-place and privacy behavior. The final web checks also include main `ef383246` and its Build controls; that integration does not change the dining simulation or art. [verification.json](verification.json) records exact commands, exit codes and inspected source hashes. These are local results; no deployment or live-game acceptance is asserted.

## Behavior

An average Sim with comfortable needs has approximately a 66% chance to clean their own meal mess. A newly noticed annoying pile gives a separate opportunity at 35% of that needs-adjusted self-cleanup chance. A dirty setting that forces standing gives a separate 30% post-meal cleanup chance at average cleanliness and comfortable needs. Critical needs sharply suppress cleanup. Very low cleanliness retains a low self-cleanup chance.

Seats require a real chair facing a clean table setting, a reachable approach and an exclusive reservation. Dirty or occupied settings cause standing nearby. A household without a reachable table uses a prep counter. Claims survive saves and exact privacy detours. Legacy active diners are adopted before re-saving.

The native meal fixture produced one batch for its cook and three hungry liked recipients. All four were observed eating together: two seated and two standing. [seated-runtime.png](seated-runtime.png) and [shared-dining-motion.gif](shared-dining-motion.gif) show the initial dining sequence. Those captures contain rejected chair penetration and do not establish physical chair fit. The screenshot alone does not establish batch provenance; that comes from the fixture and simulation state.

## Visual evidence

[chair-runtime-fixed.png](chair-runtime-fixed.png) and [chair-runtime-motion.gif](chair-runtime-motion.gif) show the corrected chair contact in the actual browser renderer. [chair-runtime-motion.json](chair-runtime-motion.json) records the ordered simulation ticks and separate chair and supporting-table identities. A fresh reviewer inspected every captured phase and the twelve facing/arrangement panels without finding the original seat penetration, rail reversal or hidden far plate.

The dining pose now fits the actual dining chair board. `assets/models/domestic/seated-dining/contact-proof.json` measures all evaluated body parts against every required chair and table solid across four facings, eight phases and three legal arrangements. The measured hip clearance is approximately 0.0005 metres with a finite supported footprint. [chair-contact-regressions.json](chair-contact-regressions.json) rejects the generic armchair pose, a raised seat and a missing seat. The accepted source model is bound by its SHA-256 in those receipts.

[chair-gpu-comparisons.json](chair-gpu-comparisons.json) records 96 actual graphics comparisons against independent occupied-chair references and four detected missing-chair mutations. [chair-table-gpu-comparisons.json](chair-table-gpu-comparisons.json) records a separate 96-case comparison with the real supporting table present. The geometry-defined hand, cuff, plate and spoon regions have maximum colour error 24 against the tighter limit 32. Whole-scene 95th-percentile error stays at or below 9 against limit 12. Changing table depth or removing the complete support mask is detected in the facings where the table would otherwise hide the plate. Near-side facings correctly remain unaffected by that depth mutation.

A separate mutation removes only the drawn hand contribution. `assets/models/domestic/export/seated-hands-proof/manifest.json` identifies palms, thumbs, forearms and cuffs through named geometry with reciprocal holdouts. Food and utensil holdouts exclude their pixels from that selector. Removing opaque hand fill is detected in every facing and arrangement while preserving plate, food and spoon contributions and the table association. Removing hand support depth alone does not necessarily hide a hand which already projects above the table; the hand-contribution mutation tests actual missing hands instead.

Strict whole-scene maximum-error equivalence remains **FAIL** in 46 SW/NW cases, reaching 116 against limit 64. Separately baked sprite contours differ from whole-scene Blender contours at some cross-object contacts. The reviewer inspected the worst hair/table contact, but every differing pixel has not been independently classified. No global threshold was raised and no general edge band was excluded. Physical furniture clearance and the narrower hand/plate colour comparisons pass independently; the whole-scene maximum remains diagnostic evidence of this outline limitation.

[chair-table-gpu-facings.png](chair-table-gpu-facings.png) shows every facing with end and both side settings. The larger reference canvas preserves the accepted camera's projected world-unit basis and validates alpha borders before completing its receipt. [chair-atlas-prefix.json](chair-atlas-prefix.json) proves all 2,173 preceding sprite records, decoded pixels and existing registration/interaction metadata are preserved. [chair-verification.json](chair-verification.json) records the correction's final checks and source hashes; the older verification file below records the preceding branch state.

[cooking-runtime.png](cooking-runtime.png) and [cooking-runtime-motion.gif](cooking-runtime-motion.gif) show the final browser binary's cooking loop. [cooking-runtime-rows.json](cooking-runtime-rows.json) records twenty consecutive Cooking ticks in the NE facing. The pot stays on the stove and the utensil stays attached to the hand. Inventory food is suppressed during cooking.

[cooking-contact-sheet.png](cooking-contact-sheet.png) and [cooking-contact.gif](cooking-contact.gif) compose the actual cook, stove and pot for all four facings and eight animation phases. The model proof in `assets/models/domestic/export/cooking-contact/proof.json` measures hand contact and bowl clearance against hashed source models. [cooking-clearance.json](cooking-clearance.json) independently checks evaluated triangle surfaces and containment for the body and utensil against stove surfaces and pot metal. [verify-clearance.py](verify-clearance.py) reproduces that check in background Blender.

The initial seated review missed chair penetration and incorrect rail occlusion. Its acceptance claim is withdrawn. The cooking contact evidence remains separate. Standing diners retain the older animation which raises the whole plate toward the mouth, and their food artwork differs from the seated meal. This release does not replace every eating animation. An earlier cooking capture includes a passing Sim overlapping the cook; general pedestrian overlap is not resolved here. [runtime-motion.gif](runtime-motion.gif) is that earlier, pre-integration runtime capture. The final cooking capture uses the integrated binary. Runtime stove verification covers NE; the composed physical checks cover all four facings.

## Checks and limits

The final combined-main validation is recorded in
[merge-verification.md](merge-verification.md), including preserved published
pixels, combined door and dining graphics checks, and interrupted recipe
completion after save/load.

The initial full native run passed the core, data and simulation suites but failed a historical WebAssembly byte-tail fixture. The fixture now measures the actual serialized suffix. The complete WebAssembly rerun passed. The combined native suites cover 1,423 tests; the final dining-only run passes sixteen tests after deliberate regressions were restored.

[mutations.json](mutations.json) records seven deliberate native regressions caught by assertions: seat arbitration, chair direction, dirty-setting exclusion, state hashing, exact privacy endpoints, legacy adoption and deferred cleanup. [picking-mutation.json](picking-mutation.json) records the carried-food picking regression. Each mutation was restored byte-for-byte. These targeted checks are separate from a full remote mutation sweep, which was not run.

The web suite after the final browser binary build passed 1,807 tests with one worker. An earlier concurrent run passed 1,804 tests and timed out in three existing source-hash tests; no thresholds were changed. After integrating the newer Build controls, the complete combined web suite passed 1,782 tests, typecheck and the production build. The differing totals reflect the upstream Build test changes.

The sprite and model suites passed, the generated atlas matches its source, and [atlas-prefix.json](atlas-prefix.json) records preservation of all 1,833 published sprite records and their pixels, including covered-bed aliases. New dining clips append after the published records. [git-receipts.json](git-receipts.json) verifies producer inputs against actual Git index bytes, not only working files. Receipt-bound producer files preserve their original line endings. Changelog tests and generation passed. The production build retains its existing advisory about large JavaScript chunks.

The simulation specification is [meals and cleanup](../../specs/2026-09-30-meals-and-cleanup.md). Personality, needs, mood and directional affinity interactions are documented in [Sim relationships](../../SIM-RELATIONSHIPS.md). Task-owned browser pages and preview servers were closed after verification.
