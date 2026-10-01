# Seated dining and cleanup verification

Observed on 2026-10-01 in the Windows development checkout. The native and visual evidence covers the cleanup and dining branch integrated with main `85e826ba`, including its published sleeping-place and privacy behavior. The final web checks also include main `ef383246` and its Build controls; that integration does not change the dining simulation or art. [verification.json](verification.json) records exact commands, exit codes and inspected source hashes. These are local results; no deployment or live-game acceptance is asserted.

## Behavior

An average Sim with comfortable needs has approximately a 66% chance to clean their own meal mess. A newly noticed annoying pile gives a separate opportunity at 35% of that needs-adjusted self-cleanup chance. A dirty setting that forces standing gives a separate 30% post-meal cleanup chance at average cleanliness and comfortable needs. Critical needs sharply suppress cleanup. Very low cleanliness retains a low self-cleanup chance.

Seats require a real chair facing a clean table setting, a reachable approach and an exclusive reservation. Dirty or occupied settings cause standing nearby. A household without a reachable table uses a prep counter. Claims survive saves and exact privacy detours. Legacy active diners are adopted before re-saving.

The native meal fixture produced one batch for its cook and three hungry liked recipients. All four were observed eating together: two seated and two standing. [seated-runtime.png](seated-runtime.png) and [shared-dining-motion.gif](shared-dining-motion.gif) show the natural dining sequence in the integrated browser build. The screenshot alone does not establish batch provenance; that comes from the fixture and simulation state.

## Visual evidence

[cooking-runtime.png](cooking-runtime.png) and [cooking-runtime-motion.gif](cooking-runtime-motion.gif) show the final browser binary's cooking loop. [cooking-runtime-rows.json](cooking-runtime-rows.json) records twenty consecutive Cooking ticks in the NE facing. The pot stays on the stove and the utensil stays attached to the hand. Inventory food is suppressed during cooking.

[cooking-contact-sheet.png](cooking-contact-sheet.png) and [cooking-contact.gif](cooking-contact.gif) compose the actual cook, stove and pot for all four facings and eight animation phases. The model proof in `assets/models/domestic/export/cooking-contact/proof.json` measures hand contact and bowl clearance against hashed source models. [cooking-clearance.json](cooking-clearance.json) independently checks evaluated triangle surfaces and containment for the body and utensil against stove surfaces and pot metal. [verify-clearance.py](verify-clearance.py) reproduces that check in background Blender.

Fresh-context reviewers found no blocker in the new seated clips or repaired cooking contact. The final natural dining sequence shows stable chair contact and furniture occlusion. Standing diners retain the older animation which raises the whole plate toward the mouth, and their food artwork differs from the new seated meal. This release does not replace every eating animation. An earlier cooking capture includes a passing Sim overlapping the cook; general pedestrian overlap is not resolved here. [runtime-motion.gif](runtime-motion.gif) is that earlier, pre-integration runtime capture. The final cooking capture uses the integrated binary. Runtime stove verification covers NE; the composed physical checks cover all four facings.

## Checks and limits

The initial full native run passed the core, data and simulation suites but failed a historical WebAssembly byte-tail fixture. The fixture now measures the actual serialized suffix. The complete WebAssembly rerun passed. The combined native suites cover 1,423 tests; the final dining-only run passes sixteen tests after deliberate regressions were restored.

[mutations.json](mutations.json) records seven deliberate native regressions caught by assertions: seat arbitration, chair direction, dirty-setting exclusion, state hashing, exact privacy endpoints, legacy adoption and deferred cleanup. [picking-mutation.json](picking-mutation.json) records the carried-food picking regression. Each mutation was restored byte-for-byte. These targeted checks are separate from a full remote mutation sweep, which was not run.

The web suite after the final browser binary build passed 1,807 tests with one worker. An earlier concurrent run passed 1,804 tests and timed out in three existing source-hash tests; no thresholds were changed. After integrating the newer Build controls, the complete combined web suite passed 1,782 tests, typecheck and the production build. The differing totals reflect the upstream Build test changes.

The sprite and model suites passed, the generated atlas matches its source, and [atlas-prefix.json](atlas-prefix.json) records preservation of all 1,833 published sprite records and their pixels, including covered-bed aliases. New dining clips append after the published records. [git-receipts.json](git-receipts.json) verifies producer inputs against actual Git index bytes, not only working files. Receipt-bound producer files preserve their original line endings. Changelog tests and generation passed. The production build retains its existing advisory about large JavaScript chunks.

The simulation specification is [meals and cleanup](../../specs/2026-09-30-meals-and-cleanup.md). Personality, needs, mood and directional affinity interactions are documented in [Sim relationships](../../SIM-RELATIONSHIPS.md). Task-owned browser pages and preview servers were closed after verification.
