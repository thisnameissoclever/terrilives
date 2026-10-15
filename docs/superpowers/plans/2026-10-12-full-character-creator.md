# Full Character Creator Implementation Plan

October 14 update: the [runtime contract](../../specs/2026-10-12-character-creator-runtime.md#editing-and-organization) supersedes task 6's original-snapshot Reset behavior. Reset now restores fixed defaults; Undo preserves the previous draft exactly.

> **Implementation workflow:** Use `superpowers:executing-plans` to implement each task directly, with an independent adversarial review after integration. Keep an execution ledger. Complete authorized fixes and verification before requesting a decision that only the owner can make.

**Goal:** Create and edit complete housemates through the selected sidebar layout and large actual appearance preview, with saved physical characteristics, detailed existing personality mechanics and independent randomization of every editable field.

**Architecture:** The creator owns an isolated draft. One validated simulation command commits the resolved draft atomically. A versioned appearance component drives the shared runtime character renderer in both the creator and every supported gameplay interaction; the preview never substitutes concept pictures for geometry.

**Tech stack:** Existing Rust simulation and save code, WebAssembly bridge, TypeScript/HTML/CSS interface, WebGPU renderer and installed Blender authoring tools. Add no dependencies or paid asset services.

**Spec:** [Creator proposal](../../specs/2026-10-11-character-creator-proposal.md), [name pool](../../specs/2026-10-11-character-creator-names.md), [appearance proof plan](2026-10-11-character-appearance-proof.md) and [current proof evidence](../../evidence/2026-10-12-character-appearance/report.md). The source inspected for this plan is based on `622a0c4b` with the isolated proof changes.

## Scope and constraints

1. Preserve the sidebar sections Identity, Appearance, Personality, Traits, Preferences, Household and Review. Use the larger appearance preview and a normal game-size sample. Keep personality commentary beside its controls.
2. Randomize every supported editable field when opening a new draft, including presentation with equal masculine/feminine probability. Load an existing person exactly, without any implicit random draw.
3. Label the global button **Randomize**. Give every field and section randomization and locks. Preserve locked values during every randomization route. Undo restores all affected sections and the random-generator state.
4. Use the entire 100-name pool uniformly, independent of presentation and skin tone: 40 English/European, 40 familiar US/Canada, 20 less familiar pronounceable names. These editorial groups do not assign character ethnicity.
5. Preserve existing limits: names up to 24 characters, four traits, six household members, subject to the authoritative content values at implementation time.
6. Appearance must not imply personality, cleanliness, competence, condition, appetite, attraction or fitness. Presentation does not limit clothing, hair or accessories.
7. Preserve exact custom values when editing. Do not replace them with a nearby archetype, round saved practice into a skill level, or regenerate a preference from traits.
8. Do not consume simulation randomness while opening, editing, previewing, randomizing or cancelling a draft. Commit explicit resolved choices, not a request for the simulation to reroll them.
9. Preserve the accepted model, production sprites and real saves while developing. Use explicit migrations, separate fixtures and new authoring assets. Never hide an unsupported body combination by shrinking it during an interaction, silently narrowing its range or choosing a different body.
10. Publication, deployment and release require their own authorization. This document is the full-creator plan requested as proof follow-through; it does not claim the full creator is implemented.
11. Switching presentation preserves manual physical, hairstyle and color overrides. **Reset to preset** is a separate, undoable appearance transaction. Applying a personality archetype is also explicit; it never initializes unrelated fields behind the player's back.

## Proven approach and production limits

The proof exports the actual control cage, bone weights, rest transforms and animation. It skins the configured cage before subdivision, matching Blender's modifier order. Both views consume the same versioned appearance values. Continuous walking and explicit sit-down/stand-up studies reuse configured limb lengths. The simulation studies consume actual position, facing and tick projections through the shared signed-distance animation rule; manual reading uses the authored game cadence. Skin, hair, shirt, trousers and shoes have independent material regions. The layered bob is attached to the existing head rig.

Retain the candidate ranges: height 85%-115%; torso width 85%-140%; torso depth 80%-150%; hips 90%-130%; limb thickness 90%-125%. The current Build control combines the last four. The proposed independent shoulder, hip and torso controls require additional authored deformation fields and combination tests.

The owner accepted the seated positioning and the demonstrated thigh/seat, shirt/arm and shirt/back-cushion intersections. Preserve those reviewed surfaces as the fitting reference in all four facings. The evidence retains the measured overlap; acceptance does not mean that the meshes are disjoint. New body, garment or fixture combinations still require visual and geometric comparison against the approved reference. Do not reimpose zero intersection on the approved chair fit or silently permit larger, visibly different failures.

The proof's desktop measurement does not establish phone performance or the cost of the full catalog. The current renderer duplicates immutable buffers per instance. Share those buffers before expanding the catalog, then measure again. Do not use the proof's favorable percentile as a release guarantee.

## Review focus

1. A name-only edit of a custom person must preserve their appearance, personality, severity, skill practice, needs, career, position and history.
2. A locked choice must remain exact even when another randomized choice depends on it. Construct valid combinations or report the conflict; do not silently unlock, clamp or reroll.
3. An invalid field must leave the person, draft undo history and simulation random state unchanged.
4. A loaded historical person must retain their existing assigned look and behavior without passing through new-character randomization.
5. The same person must retain their face, body, hair and colors when entering an occupied-furniture scene, reloading, changing quality or recovering the graphics device.

## File responsibilities

| Responsibility | Existing integration | New focused modules |
| --- | --- | --- |
| Canonical appearance and validation | `crates/terri-core/src/components.rs` | `crates/terri-core/src/appearance.rs` |
| Atomic creation/editing | `crates/terri-core/src/command.rs`, `crates/terri-sim/src/edit.rs`, `household.rs`, `systems/lot_edit.rs` | `crates/terri-sim/src/character_draft.rs` |
| Save, replay and hash | `crates/terri-core/src/save.rs`, `crates/terri-sim/src/save.rs`, `crates/terri-sim/src/lib.rs` | `crates/terri-sim/src/save/appearance.rs` |
| Browser boundary | `crates/terri-wasm/src/lib.rs`, `web/src/bridge.ts` | `web/src/character/schema.ts` |
| Draft and randomization | `web/src/ui/housemate-form.ts` | `web/src/character/draft.ts`, `random.ts`, `names.ts`, `fields.ts` |
| Creator sections and focus | `web/src/ui/housemate-form.ts`, `web/src/input.ts`, `web/index.html` | `web/src/ui/character-creator/` with one module per section and shared field controls |
| Runtime appearance | `web/src/render/character/`, `web/src/render/sprites.ts`, `web/src/render/interaction-sprites.ts`, `web/src/frame.ts` | Asset cache, production pose selection and attachment modules within `web/src/render/character/` |
| Art and fitting | `assets/models/sims/sim-01/` as protected reference | `assets/models/sims/character-creator/` for authored cages, landmarks, garments, accessories, fixtures and export receipts |

Keep the proof entry point available as a diagnostic. Do not turn its browser storage record into the production save format. Production appearance is owned by the simulation's saved person; editor-only locks, seed and undo belong to the draft.

## Task 1: Define the canonical draft and field domains

**Files:** Create `crates/terri-core/src/appearance.rs`, `web/src/character/schema.ts` and `web/src/character/fields.ts`. Modify the core module exports. Add Rust validation tests and `web/tests/character-schema.test.ts`.

**Interfaces:** Define `CharacterAppearanceV1`, `CharacterBehaviorDraft` and `CharacterDraftV1`. Define `validate_character_draft(content, draft)` in Rust and `validateDraft(catalog, value)` in TypeScript. Represent material colors as explicit channel bytes; use stable authored IDs for assets and traits. Preserve exact existing floating-point behavior values until edited. Define an edit mask so an omitted field means preserve, not reset. Existing `SimCommand` derives `Eq`; encode behavior-bearing `f32` values with validated `u32` bit-pattern wrappers in new commands. Reject non-finite/out-of-domain representations, then decode on application. Do not remove `Eq` or round an entire loaded draft to make the new command compile.

1. [x] Write failing tests for unknown versions/IDs, non-finite values, hostile numeric boundaries, unknown field keys and exact round trips.
2. [x] Define the field catalog with one domain, unit, dependency rule, randomization rule and mechanical explanation per field. Use the same catalog to construct controls and validate random draws; keep Rust authoritative at commit.
3. [x] Include appearance, name, optional pronouns, individual personality metrics, dispositions, selected traits/severities, environmental preferences, hobbies, skills and household ties. Separate optional off/none from missing input.
4. [x] Set initial behavior domains from the proposal and actual mechanics: shyness 1-100, cleanliness 0-100%, self-preservation 0-100, sleep offset -3 to +3 hours in half-hour steps, seven drain and seven recovery multipliers 50-150%, environmental affinities -1 to +1. Condition severity uses the existing 0-1 state domain. For new individual activity weights, use 0-2 in 0.01 steps, with 0 as refusal and 1 as neutral; these are creator bounds, not a limit on authored content. Preserve an existing valid value outside a control's new-draft domain until explicitly edited. Test the effective interaction weights rather than deriving behavior from display labels.
5. [x] Run the new Rust and web validation tests. Delete one validation branch, confirm rejection tests fail, then restore exact bytes.
6. [x] Define a presentation preset's authored fields and override mask. Test that switching presentation retains custom hair, colors and physical overrides. Define starting skill choices as the complete content-defined level ladder, including the unpracticed state; sample legal levels uniformly and convert an explicit choice to its exact content-defined threshold. Existing practice stays exact until deliberately edited.

**Completion:** A resolved draft has an unambiguous meaning independent of the UI, with no cosmetic field changing behavior.

## Task 2: Prepare reusable assets and resolve occupied-body fitting

**Files:** Add authoring/export modules under `assets/models/sims/character-creator/`. Extend `web/src/render/character/shape.ts`, `motion.ts`, `pose.ts` and the bundle schema through a versioned conversion. Add geometry, attachment and fixture-fit tests.

**Interfaces:** `configureRest(appearance, asset) -> configured cage and rest joints`; `solveInteractionPose(configured, fixture, phase) -> pose or explicit unsupported result`. The result cannot contain an undisclosed rescale.

1. [x] Reproduce the proof's source/operator comparison and protected-file hashes before changing assets.
2. [x] Add named authored low/neutral/high deformations for independent shoulders, hips, torso proportions and build. Carry shirt, cuffs, collar, hem, pockets, buttons, trousers and shoes through matching changes.
3. [x] Preserve the accepted chair fit and review newly authored shapes against it in all four facings. Repair new visible clipping, detached garments or materially different intersections using local articulation with fixed limb lengths and supported feet. Where a corrective is required, preserve body volume and the accepted overall composition. Retain before/after evidence.
4. [x] Add face landmarks and authored face/feature variants: face shape, cheeks, jaw, chin, eyes, brows, nose, mouth and ears. Move facial attachments with the changed head surface. Do not repurpose one unrelated deformation as several controls.
5. [x] Author the expanded hair, outfit and accessory catalog. Keep the current curl and improved bob as the first assets. Add glasses, earrings, facial hair and optional freckles/scars only with actual geometry or surface data and stable saved IDs.
6. [x] Test endpoints, intermediate values and meaningful cross-combinations. Inspect all four facings at creator and game sizes, including clipping, seams, scalp coverage and hair/accessory contact in every supported pose.
7. [x] Keep unsupported combinations explicit in the development catalog until fixed. Do not ship a control that only works in the creator preview or silently sample a narrower range.

**Completion:** Every exposed physical field visibly changes the saved model, and the intended production range has fitting evidence. New interactions retain the same appearance and receive their own contact and all-four-facing review.

Use this coverage table when implementing Task 2. No proposal inventory row may disappear into an unspecified asset catalog.

| Physical controls | Required authoring and verification |
| --- | --- |
| Masculine/feminine; preset reset | Authored rest shapes, override preservation and an undoable reset with explicit field scope |
| Skin tone and optional undertone | Material-region colors and a defined undertone transform across every visible skin surface |
| Height, build, shoulders, hips, torso proportions | Independent continuous fields, matching rest joints/garments and interaction combinations |
| Face shape, cheeks, jaw, chin | Authored head deformations with facial landmarks retained on the surface |
| Eye shape/size, brows/thickness, nose shape/width, mouth/fullness, ears | Actual feature variants/deformations and normal-size readability checks |
| Hair style, hair color, bald toggle | Head-attached meshes, explicit no-hair state, scalp coverage and retained color/style choices through toggling |
| Facial hair style and color | Separate attached assets/material region, including none; no presentation restriction |
| Freckles and scars | Authored surface details with correct attachment and visibility in all supported poses |
| Outfit, garment colors and sleeve variants | Real garment variants with matching fits and animation coverage, not label-only selections |
| Glasses on/off/style and earrings | Actual attached assets, including none, with depth and collision checks |

## Task 3: Share renderer resources and integrate gameplay poses

**Files:** Extend `web/src/render/character/`, `web/src/render/interaction-sprites.ts`, `web/src/render/sprites.ts` and `web/src/frame.ts`. Add `web/tests/character-render-cache.test.ts` and actual browser render checks.

**Interfaces:** `CharacterAssetCache.acquire(assetId, quality)` returns shared immutable buffers with explicit ownership. `CharacterPoseInput` supplies action, simulation phase, movement distance, facing and world position. Per-person state owns only configured geometry, pose/material data and required dynamic targets.

1. [x] Write a failing resource-ownership test covering shared buffers, person removal, device loss and repeated creator opening.
2. [x] Share indices, subdivision coefficients, normal adjacency and authored material tables. Keep mutable cage, surface and skeleton buffers per configured person. Cache by complete appearance/asset version rather than name or presentation alone.
3. [x] Drive walking from actual simulation movement distance and other actions from simulation phase. Pause and reload must preserve progression. Reuse the proof's continuous interpolation and exact transition endpoints.
4. [x] Convert occupied scenes to render the same configured actor with the actual fixture. Cover chairs, beds, toilets, bathing, cooking, exercise, conversation, reading and carried objects before enabling production appearance editing. Author any newly visible body surfaces required by those activities; do not require an unseen body for clothed poses.
5. [x] Preserve per-pixel world depth, actor identity, fixture identity and person position. Use the final scene depth for selection so walls cannot leave an invisible person clickable. Map bounded render tokens to full saved person IDs; do not consume a bit of an unrestricted saved ID merely to encode fixture ownership.
6. [x] Measure six visible people plus the creator preview on the desktop. Record frame distributions, allocations, appearance-edit cost and teardown. Keep phone performance unverified until measured on an authorized device.

**Completion:** Preview and gameplay use one appearance/pose path, with no reversion to a fixed character during interactions.

## Task 4: Add atomic simulation creation and editing

**Files:** Extend `crates/terri-core/src/command.rs`, `crates/terri-sim/src/character_draft.rs`, `edit.rs`, `household.rs`, `systems/lot_edit.rs`, `crates/terri-wasm/src/lib.rs` and `web/src/bridge.ts`. Add simulation and release-WebAssembly boundary tests.

**Interfaces:** Add versioned create/edit commands accepting resolved drafts and stable person IDs. Keep existing exported creation/edit functions working. Append serialized command variants rather than shifting existing discriminants. Return a numbered accepted/refused result using the existing command-result pattern.

1. [x] Write failing tests proving whole-request validation before any mutation, including stale/dead targets, household capacity, invalid assets, repeated traits and conflicting family ties.
2. [x] Apply custom personality effects without passing through an archetype initializer that discards individual values. Preserve sorted disposition keys and the existing meaningful behavior rules.
3. [x] Apply selected condition severities, explicit affinities, hobbies and permitted starting skill practice. Do not let trait-based initialization overwrite individually resolved preferences.
4. [x] Preserve untouched fields exactly on edit. A name-only or appearance-only edit must not change need values, condition progress, skills, relationships, career, current activity, position or history.
5. [x] Preserve the current condition-removal warning and severity-removal behavior. Preserve skills when removing capability traits. Use content-defined skill thresholds when a player explicitly chooses a level.
6. [x] Reject hostile JavaScript values at the WebAssembly boundary, then validate again in the simulation. Rebuild release WebAssembly and run the boundary tests against it.
7. [x] Delete atomic validation and preserve-field handling separately; confirm their tests fail and restore exact bytes.

**Completion:** A create/edit succeeds wholly or leaves the simulation unchanged, and cancellation has no command side effect.

## Task 5: Save, migrate, hash and replay

**Files:** Extend `crates/terri-core/src/save.rs`, `crates/terri-sim/src/save.rs`, `save/appearance.rs` and deterministic state hashing in `crates/terri-sim/src/lib.rs`. Add historical fixtures and round-trip/replay tests.

**Interfaces:** Save stable appearance IDs and explicit parameters, plus custom behavior values. Editor locks/undo remain outside game saves. At this inspected base the schema is version 8; allocate the next version after checking the implementation branch.

1. [x] Write failing historical-load and exact new-save round-trip tests, including queued edits saved before command application.
2. [x] Map legacy appearance assignments to explicit equivalent records without randomness. Preserve the existing shirt/look assignment, identity and behavior.
3. [x] Validate new saved records, asset versions and queued commands transactionally. Reject malformed data without partially replacing the current world.
4. [x] Include behavior-bearing edits in deterministic replay/state validation. Keep appearance out of autonomous choice and its random sequence; define appearance persistence/checksum coverage separately where appropriate.
5. [x] Test save/load during walking, seating transitions and carried-book actions. Prove old and new command forms remain decodable.
6. [x] Mutate migration preservation and one exact-value write; confirm tests fail, restore, then rerun the affected checks.

**Completion:** Loading and replay reproduce the resolved person, without turning a historical save into a new randomized draft.

## Task 6: Build the independent draft and complete randomization

**Files:** Create `web/src/character/draft.ts`, `random.ts`, `names.ts` and corresponding web tests. Reuse the proof's validated generator/state pattern, not its narrow record shape.

**Interfaces:** `CharacterDraft.create(seed, catalog, household)`, `CharacterDraft.edit(snapshot)`, `randomize(scope)`, `lock(field)`, `undo()`, `reset(scope)` and `resolve()`. Keep the original draft snapshot and generator state separate from the live person.

1. [x] Write failing create-versus-edit tests. New drafts draw every editable value; edits make no draws and preserve exact existing values.
2. [x] Import the approved 100-name pool with a uniqueness/count test. Draw uniformly across the complete pool, independent of other traits.
3. [x] Implement field, section and global randomization through the field catalog. Draw all supported discrete values equally, including off/none. Draw numeric values uniformly over their legal steps.
4. [x] Randomize trait count from zero through four, then choose distinct traits while preserving locked choices. Construct valid household ties against the current members. Preserve valid opposing preferences and show their actual combined effect.
5. [x] Make every randomization one undo transaction. Save/restore generator state, locks and the whole changed draft. Rejected input must not overwrite undo history.
6. [x] Reset to the initial randomized draft in create mode and to the exact loaded snapshot in edit mode. Navigating or repainting never rerolls.
7. [x] Prove that all draft operations leave the simulation hash and random state unchanged. Delete lock enforcement and generator restoration separately and observe failures.
8. [x] Implement `applyPersonalityPreset(id)` and `resetAppearanceToPreset()` as separate single-undo transactions. Apply the archetype's drain/recovery, disposition, chronotype and cleanliness fields only; preserve independent shyness, self-preservation, traits, affinities, skills, ties and appearance. Manual personality edits show Custom for that draft; loading may derive an archetype only from an exact match over its defined fields. Global randomization still draws individual values rather than replacing them with a random archetype. Locks protect randomization; deliberate preset/reset actions disclose their field scope and retain undo.

**Completion:** Every editable field can be randomized and locked, with repeatable draws and lossless undo across sections.

## Task 7: Implement the selected creator interface

**Files:** Create focused sections under `web/src/ui/character-creator/`. Adapt `web/src/ui/housemate-form.ts`, `web/index.html`, the existing modal/focus integration and `web/src/input.ts`. Add form and browser tests.

**Interfaces:** Sections read/write the same `CharacterDraft`. The preview consumes only its appearance and selected demonstration pose. Submission calls the versioned bridge command once and closes only after the matching accepted result.

1. [x] Write create/edit navigation tests and a screenshot comparison against the selected sidebar/large-preview layout.
2. [x] Build Identity, Appearance, Personality, Traits, Preferences, Household and Review. Keep the preview large on desktop and expandable on narrow screens. Include a genuine game-size sample and four facings.
3. [x] Build shared slider/numeric, selector, toggle, swatch and multi-selection controls with literal labels, field randomization, locks and keyboard access. Preserve selections with more than color alone.
4. [x] Place effect explanations beside the relevant personality controls. Advanced needs expose seven drain and seven recovery values. Activity inclinations enumerate the actual object/action routes they affect. Environmental likes remain distinct from willingness to choose an activity.
5. [x] Show trait slots, condition severity, hobbies and the Cooking/Fitness/Reading ladder from content. Explain opposing effects without silently removing either selection or inventing exact cancellation.
6. [x] Preserve draft state across sections. Use **Randomize**, section randomization, field randomization, Undo and Reset consistently. Show invalid/dependent combinations at the affected controls.
7. [x] Pause the game while open, restore previous focus on close, and retain the draft after a refused command. Confirm create/edit labels and condition-removal copy through the existing writing rules.
8. [x] Exercise narrow screens, keyboard-only use, focus visibility and control labels in the real browser. Do not claim phone performance from a resized desktop viewport.
9. [x] Add the optional archetype selector and explicit **Apply preset** control. Add presentation **Reset to preset** separately from switching masculine/feminine. Test preset application, Custom status, manual-override preservation and one-step undo without altering unrelated sections.

**Completion:** The selected layout operates on the actual draft and model, including every approved randomization and edit-preservation behavior.

## Task 8: Verify integrated behavior and prepare delivery

**Files:** Add dated evidence under `docs/evidence/`; update the creator specification, affected save/render docs and lessons for material corrections. Update public changelog notes only when player-facing delivery is authorized.

1. [x] Run the complete create → preview → commit → play → save → reload → edit → cancel/apply flows with custom personality and extreme appearances.
2. [x] Verify every exposed physical control causally, with unrelated fields held fixed. Cover full interactions, occlusion, world picking, animation phase, unsupported assets and device recovery.
3. [x] Run focused Python/web/Rust tests, release WebAssembly checks, type checking and web build. Use one local test worker and avoid overlapping heavy work with timing checks. Investigate failures without weakening assertions or deadlines.
4. [x] Run required statement-deletion mutations for atomic commit, edit preservation, independent randomness, locks, appearance application, depth and reload. Retain failure output and exact restoration hashes.
5. [x] Obtain independent adversarial technical and visual review of actual captures. Complete actionable findings directly. Keep art judgment separate from numerical test results.
6. [x] Present the finished implementation and precise remaining platform limits. When commit/push/merge or publication is authorized, apply the repository's changelog and delivery rules and verify the remote result. Do not infer that authorization from a local implementation request.

**Completion:** The complete creator meets the selected interface and mechanics contract, with inspectable real rendering and persistence evidence. A passing local build alone is not publication or release.


Local completion evidence: [verification report](../../evidence/2026-10-12-full-character-creator/report.md). Artwork review and publication remain owner decisions.
