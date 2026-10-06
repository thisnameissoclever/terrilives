# Object Affinities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every person a feeling about each kind of thing a reasonable person could love or hate, let those things in the room move mood, and let somebody else's television bother a person who hates television.

**Architecture:** Content names the kinds (`[[affinity]]` tables in `objects.toml`, each listing the objects it covers) and a `CompiledAffinityKind` list is appended to the pack. Each person carries a dense `Affinities` component, one value per kind, drawn from the world generator at spawn (or set from a disposition trait), saved as an appended V5 field by kind id and hashed in a sparse tagged block. A new `affinity` module in `terri-sim` derives presence moodlets and use moodlets inside `derive_mood` and runs one system that lowers a bothered person's feeling toward the user. The boundary exports the values and the kind labels; the Overview sheet gains a collapsed `Likes and dislikes` section.

**Tech Stack:** Rust workspace (`terri-core` component, `terri-data` schema and compiler, `terri-sim` mood and relationship systems, `terri-wasm` boundary), TypeScript web shell (Vitest fake-DOM tests), Playwright-driven Chromium for the displayed check.

**Spec:** `docs/specs/2026-10-06-object-affinities.md` ([OA-kinds], [OA-values], [OA-presence], [OA-use], [OA-hud], [OA-evidence]).

## Rulings

1. **Kinds live in `objects.toml` and list their objects**, not a new content file and not a field on each object. Cost if wrong: moving four tables to a new file is a content edit; `CompiledObject`, every object literal in tests and the `compile()` signature stay untouched, which is why.
2. **Values are drawn from the world generator at spawn, right after the Self-preservation draw**, four draws per person in kinds order, taken whether or not a trait overrides them. Existing tests that pin a specific later draw on the shipped lot may move; the implementer re-pins each with the reason in the commit body and lists them in the report. The bare-agent golden scenario spawns agents directly and takes no affinity draw, so its hash is unchanged. Cost if wrong: a later slice that wants values independent of the world sequence derives them from a salted per-person generator the way shyness does.
3. **A save without the field seeds once on load from the saved world generator**, in entity-index order, exactly like the Self-preservation migration; the seed happens in `restore` so the loaded world hashes the same on every load of that save. Cost if wrong: a pinned hash of an old save moves once and is re-pinned with the explanation.
4. **Presence kinds give both signs; use kinds give only the negative**, because the owner asked for haters to be bothered and said nothing about lovers enjoying another's use. Cost if wrong: one more branch in `use_moodlets`.
5. **The yard is no room**: nobody outside the house is pleased or bothered, and nothing outside the house counts. Sleep does not exempt anyone (a loud television near a sleeper is [P-nuisance] work).
6. **Labels** are `Likes the {kind} here`, `Bothered by the {kind} here`, `Bothered by {name} using the {kind}`, and the five words `Loves`, `Likes`, `Indifferent`, `Dislikes`, `Hates`; the kind labels are `plants`, `aquarium`, `television`, `radio` in lower case so they read inside the sentences. All are proposals for the owner under `docs/player-visible-strings.md`.
7. **Editing the values is out of scope** ([S-advanced-controls]); changing traits later leaves stored values alone.

## Global Constraints

- Shipped content in `content/objects.toml`, after the `[[colourway]]` tables:

```toml
# Kinds of thing a person can love or hate - [OA-kinds] in
# docs/specs/2026-10-06-object-affinities.md. `reach` is "presence" (the
# objects in the room move mood) or "use" (somebody else using one bothers a
# person who hates the kind). `trait_tag` names the activity tag whose
# disposition traits set a strong starting value. Order is kept: every
# person's values are listed in it. Saves name a kind by id, not position.

[[affinity]]
id = "plants"
label = "plants"
reach = "presence"
objects = ["potted_plant"]

[[affinity]]
id = "aquarium"
label = "aquarium"
reach = "presence"
objects = ["reference_shelf"]

[[affinity]]
id = "television"
label = "television"
reach = "use"
objects = ["television"]
trait_tag = "television"

[[affinity]]
id = "radio"
label = "radio"
reach = "use"
objects = ["radio"]
```

- Tuning keys appended to `content/tuning.toml` (flat keys, after `sick_penalty`), to `TuningFile` in `schema.rs` (with the `TUNING_LINES` fixture rows), to `Tuning` in `pack.rs` (appended last, after `first_weekday`, with the round-trip fixtures) and to the compile mapping and range checks in `compile.rs`:

```toml
# Starting value a disposition trait sets for its kind: this for a trait that
# loves, its negative for one that hates. In (0, 1].
affinity_from_trait = 0.8
# Below this magnitude a value gives no moodlet. In [0, 1).
affinity_presence_threshold = 0.2
# Mood for one object of a presence kind at a value of 1.0. Finite, not negative.
affinity_presence_points = 10.0
# Mood each further object adds at 1.0, up to the cap. Finite, not negative.
affinity_presence_extra_points = 3.0
# How many further objects count.
affinity_presence_extra_cap = 3
# Mood each other person using a use kind costs at a value of -1.0. Finite, not negative.
affinity_use_points = 15.0
# How much a bothered person's feeling toward the user falls per game hour at -1.0. Finite, not negative.
affinity_use_feeling_per_hour = 0.03
```

  Compiled fields: `affinity_from_trait: f32`, `affinity_presence_threshold: f32`, `affinity_presence_points: f32`, `affinity_presence_extra_points: f32`, `affinity_presence_extra_cap: u32`, `affinity_use_points: f32`, `affinity_use_feeling_per_hour: f32`. Errors: one `AffinityTuningOutOfRange { key: &'static str }` for any of them outside its range.
- Pack types in `pack.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AffinityReach { Presence, Use }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledAffinityKind {
    pub id: String,
    pub label: String,
    pub reach: AffinityReach,
    /// Indices into `ContentPack::objects`, ascending, none repeated.
    pub objects: Vec<u32>,
    /// The activity tag whose disposition traits set the starting value.
    pub trait_tag: Option<String>,
}
// ContentPack: appended last, after `skills`.
pub affinities: Vec<CompiledAffinityKind>,
impl ContentPack {
    /// The kind covering the object at `object`, if any. Linear over a list of four.
    pub fn affinity_kind_of(&self, object: u32) -> Option<u32>;
}
```

- Schema in `schema.rs`: `ObjectsFile.affinity: Vec<AffinityKindDef>` with `#[serde(default)]`; `AffinityKindDef { id: String, label: String, reach: String, objects: Vec<String>, #[serde(default)] trait_tag: Option<String> }`. Errors in `error.rs`: `DuplicateAffinityKind(String)`, `EmptyAffinityText { id, field: &'static str }`, `UnknownAffinityReach { id, reach }`, `AffinityObjectUnknown { id, object }`, `AffinityObjectShared { first, second, object }`, `AffinityObjectEmpty { id }` (a kind covering nothing), `UseAffinityWithoutInteractions { id, object }`, `AffinityTraitTagAboutNothing { id, tag }`, each with a Display line in the style of the skill errors.
- `GOLDEN_PACK_BYTES` in `compile.rs` is regenerated once in Task 1 (the pack gained a tail list and `Tuning` seven fields, both appended); the commit body says so and the test's block annotations gain the new tail.
- Core component in `crates/terri-core/src/components.rs`:

```rust
/// One value per affinity kind in pack order, each in -1.0..=1.0 - [OA-values].
#[derive(Component, Debug, Clone, Default, PartialEq)]
pub struct Affinities(Vec<f32>);
impl Affinities {
    pub fn from_values(values: Vec<f32>) -> Self; // clamps each to -1..=1, NaN becomes 0
    pub fn value(&self, kind: u32) -> f32;         // 0.0 past the end
    pub fn values(&self) -> &[f32];
}
```

- Save: `SaveSnapshotV5.affinities: Option<SavedAffinities>` appended after `skills`; `SavedAffinities { rows: Vec<(u32, String, f32)> }` sorted by entity index then kind id, one row per value that is not exactly 0.0, written `Some` even when empty. `crates/terri-sim/src/save/affinities.rs` with `capture`, `restore` (None seeds everyone; present rows checked whole: strictly ascending, living person, known kind id else `InvalidContentReference`, finite and inside -1..=1 else `InvalidValue`), and `seed_everyone`. World hash block `affinities-v1` written only when some value is not 0.0: `write_u64(rows.len())`, then per row `write_u64(index)`, `write_u64(kind index)`, `write_u32(value.to_bits())` (exact bits, like the personality block). `decode_current_v5`: `APPENDED_LISTS = 15`, `usize::from(snapshot.affinities.is_some())` first in the `invented` array, the tail comment updated; the local-bed decoder is untouched.
- Simulation module `crates/terri-sim/src/affinity.rs` (new): `draw(rng: &mut SimRng, pack: &ContentPack, worn: Option<&Traits>) -> Affinities`, `presence_moodlets(world, pack, subject) -> Vec<Moodlet>`, `use_moodlets(world, pack, subject) -> Vec<Moodlet>`, `bother(world: &mut World)` (the relationship system) and `band(value: f32) -> &'static str`. Rooms come from `RoomRegions::from_world` at the person's rounded tile; "actually using" is `Eating.object == SmartObject.0 && Eating.interaction == Target.interaction` with no `Path`, the test `relationship_dynamics::tick` uses.
- `RelationshipCause` gains `Nuisance` after `HouseholdMess`.
- Schedule: `affinity::bother` runs directly after `relationship_dynamics::tick` inside the same `.chain()`.
- Tests never `while` on simulation state. Guard deletions per lesson [L15], recorded in `docs/specs/2026-10-06-object-affinities-verification.md`.
- Functional text plain; strings inventory and glossary updated; no em dash or en dash anywhere new; one paragraph per line in Markdown; imperative commit messages; no attribution; commit with `git -c user.name="Tim Woodruff" -c user.email="myemailaddressisveryclever@gmail.com" commit ...`; stage only files you change.
- Before each commit: `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`; for the boundary and web task also `cargo test -p terri-wasm --release`, `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`, then from `web/`: `npm run typecheck`, `npx vitest run`, `npm run build`; plus `node --test scripts/build-changelog.test.mjs`, `node scripts/build-changelog.mjs` and `py -3 check-doc-ids.py` on the final task.
- Other worktrees hold unmerged Codex work (communal seating, chores, social company needs). Do not read or copy from them.

## Review Focus

1. **A person standing in the doorway tile or in the yard** reads no presence moodlet, and a person in the living room reads the living-room plant only, not the study's. Pinned in Task 3 (`presence_counts_only_the_room_the_person_stands_in`).
2. **A person who hates television and is themselves watching it** (ordered by the player) is not bothered by their own use, and is bothered by a second watcher on the other slot. Pinned in Task 3 (`a_hater_is_not_bothered_by_their_own_use`).
3. **A watcher who dies or leaves the room mid-use** stops bothering on the next tick; the feeling already lost stays. Pinned in Task 3 (`the_bother_stops_when_the_watcher_leaves`).
4. **A save written by this build with every value at 0.0** (a test world) decodes, hashes as before the slice, and a save truncated inside the new field is refused. Pinned in Task 2 and Task 4 (`decode_pads_the_affinities_list`, `a_world_with_no_affinity_values_hashes_as_before`).
5. **A trait tag on a kind that no shipped trait wears** (the radio has none) leaves the draw in place; a person wearing `Television devotee` holds exactly `affinity_from_trait` after the four draws are still taken, so the next generator value is the same with or without the trait. Pinned in Task 2 (`a_trait_overrides_the_value_but_not_the_draw_count`).

---

### Task 1: Affinity kinds in content and the compiler, with tuning

**Files:**
- Modify: `content/objects.toml` (the four `[[affinity]]` tables above), `content/tuning.toml` (the seven keys above)
- Modify: `crates/terri-data/src/schema.rs` (`AffinityKindDef`, `ObjectsFile.affinity`, the seven `TuningFile` fields, `TUNING_LINES` rows), `crates/terri-data/src/pack.rs` (`AffinityReach`, `CompiledAffinityKind`, `ContentPack.affinities`, `affinity_kind_of`, the seven `Tuning` fields, round-trip fixtures), `crates/terri-data/src/compile.rs` (`compile_affinities`, the call site after objects and chains are compiled, the tuning mapping and checks, `GOLDEN_PACK_BYTES`), `crates/terri-data/src/error.rs` (the nine errors and their Display lines)
- Test: in the same files' `#[cfg(test)]` modules, and the shipped-pack tests in `crates/terri-data/src/lib.rs`

**Interfaces:**
- Produces: everything under Global Constraints for `terri-data`. `compile_affinities(defs: &[AffinityKindDef], objects: &[CompiledObject], known_tags: &BTreeSet<String>) -> Result<Vec<CompiledAffinityKind>, ContentError>`.

- [ ] **Step 1: Failing compile tests** in `compile.rs`, beside the skills tests, using the existing fixture helpers:

```rust
#[test]
fn compiles_affinity_kinds_in_file_order_with_object_indices() {
    // Build an objects file with potted_plant, television (one interaction tagged television), radio, and two kinds.
    // Expect pack.affinities[0] = { id "plants", reach Presence, objects [index of potted_plant], trait_tag None }
    // and pack.affinities[1] = { id "television", reach Use, objects [index of television], trait_tag Some("television") };
    // pack.affinity_kind_of(television index) == Some(1), affinity_kind_of(sofa index) == None.
}

#[test]
fn rejects_bad_affinity_kinds() {
    // One case per error: duplicate id; blank label; reach "smell"; objects ["unicorn"]; the same object in two kinds;
    // objects []; reach "use" on potted_plant (no interactions); trait_tag "flying" (no activity carries it).
    // Assert the exact ContentError variant and fields for each.
}

#[test]
fn rejects_affinity_tuning_out_of_range() {
    // affinity_from_trait 0 and 1.5; affinity_presence_threshold 1.0 and -0.1; a NaN affinity_use_points;
    // each -> AffinityTuningOutOfRange { key }.
}

#[test]
fn the_shipped_pack_has_four_affinity_kinds() {
    let pack = crate::pack();
    let ids: Vec<&str> = pack.affinities.iter().map(|k| k.id.as_str()).collect();
    assert_eq!(ids, ["plants", "aquarium", "television", "radio"]);
    assert_eq!(pack.affinities[2].trait_tag.as_deref(), Some("television"));
    // potted_plant -> Some(0), television -> Some(2), sofa -> None.
}
```

- [ ] **Step 2: Run them**: `cargo test -p terri-data affinity` fails to compile.
- [ ] **Step 3: Implement** the schema, pack types, errors and `compile_affinities` (checks in the order the errors are listed under Global Constraints; `objects` resolved by id to ascending indices; the `use` check reads `objects[i].interactions.is_empty()`; the trait tag resolved against `activity_tags(...)` like a skill's). Append the seven tuning keys everywhere a tuning key lives (schema, pack, compile mapping, range checks, fixtures). Call `compile_affinities` after chains, before the pack literal, and put `affinities` last in the pack literal.
- [ ] **Step 4: Regenerate `GOLDEN_PACK_BYTES`** by running the pinned test, copying the new vector, and extending the block annotations; verify every earlier byte is unchanged by reading the failure diff before replacing.
- [ ] **Step 5: Run** `cargo test -p terri-data` and `cargo test --workspace` (fixtures in `terri-sim` that build `Tuning` literally gain the seven fields; `test_content::tuning()` already copies the shipped tuning).
- [ ] **Step 6: Commit** `Name the kinds of thing a person can love or hate`, with a body explaining the golden-vector regeneration.

### Task 2: The Affinities component, the spawn draw, the save field and the hash

**Files:**
- Modify: `crates/terri-core/src/components.rs` (`Affinities`), `crates/terri-core/src/save.rs` (`SaveSnapshotV5.affinities`, `SavedAffinities`), `crates/terri-core/src/lib.rs` (re-export)
- Create: `crates/terri-sim/src/affinity.rs` (`draw` only in this task; the rest in Task 3), `crates/terri-sim/src/save/affinities.rs`, `crates/terri-sim/src/save/affinities_tests.rs`
- Modify: `crates/terri-sim/src/household.rs` (draw after the instinct, insert the component on spawn), `crates/terri-sim/src/lib.rs` (`mod affinity`, `save_snapshot_v5`, `load_snapshot_v5`/`restore_v5` wiring beside skills, the hash block after `skills-v1`), `crates/terri-sim/src/save/mod.rs` (module), `crates/terri-wasm/src/lib.rs` (`decode_current_v5`)
- Test: the files above; the decode tests in `crates/terri-wasm/src/save_v3_tests.rs` or beside the existing padding tests

**Interfaces:**
- Consumes: `pack.affinities`, `pack.tuning.affinity_from_trait`, `CompiledTrait { tag, score_multiplier, .. }`, `pack.tuning.affinity_loves_from` and `affinity_hates_to`.
- Produces: `terri_core::Affinities`, `terri_core::save::SavedAffinities`, `affinity::draw`, `save::affinities::{capture, restore}`.

- [ ] **Step 1: Failing tests.** In `affinity.rs`:

```rust
#[test]
fn draw_takes_one_value_per_kind_in_order_and_clamps_to_the_unit_range() {
    // pack with the four shipped kinds; rng from seed 7; expect values.len() == 4, each in -1..=1,
    // and equal to a hand-computed sequence: value = rng.next_f32() * 2.0 - 1.0 per kind.
}
#[test]
fn a_trait_overrides_the_value_but_not_the_draw_count() {
    // Two rngs from the same seed. draw with Traits wearing television_devotee (multiplier 1.5) gives
    // values[2] == 0.8 exactly; draw with no traits gives the drawn value; afterwards both rngs yield the same next_u32.
    // television_averse (0.35) gives -0.8. A disposition between the bands leaves the draw.
}
```

  In `household.rs` tests: `spawn_member_draws_affinities_right_after_the_instinct` (an rng from a known seed: the instinct is `range(101)`, then four `next_f32` draws; compare the component to a draw from a second rng advanced past one `range(101)`).
  In `save/affinities_tests.rs`: round trip of rows; `None` seeds in entity-index order from the world rng and a second load of the same bytes seeds identically; an empty `Some` seeds nothing and leaves zeros; refusals for disorder, a dead index, an unknown id, 1.5, NaN; a zero row refused.
  In `lib.rs` hash tests: `a_world_with_no_affinity_values_hashes_as_before` (two worlds, one with `Affinities::from_values(vec![0.0; 4])` and one with none, equal hashes) and `the_hash_sees_an_affinity_value_and_its_owner`.
  In `terri-wasm`: `decode_pads_the_affinities_list` (a current payload with the field stripped decodes with `affinities == None`; a payload cut inside the field is refused; the existing padding tests still pass with 15).

- [ ] **Step 2: Run them**, expect compile failures.
- [ ] **Step 3: Implement** the component, `draw`, the spawn insertion (after `SelfPreservation`; the shipped household and a new housemate both go through `spawn_member`), the save module on the skills pattern, the writer and loader wiring, the hash block, and the decoder constant. Run the determinism tests and the shipped-lot tests; re-pin any test whose expected value moved only because four more draws happen per spawned person, and explain each in the commit body and the report.
- [ ] **Step 4: Run** `cargo fmt --all`, clippy, `cargo test --workspace`, `cargo test -p terri-wasm --release`.
- [ ] **Step 5: Commit** `Give every person a value for each affinity kind and save it`.

### Task 3: Presence and use moodlets and the bother system

**Files:**
- Modify: `crates/terri-sim/src/affinity.rs` (`presence_moodlets`, `use_moodlets`, `bother`, `band`, plus a private `room_of(world, entity, &RoomRegions) -> Option<u32>` and `using_kind(world, pack, entity) -> Option<u32>`), `crates/terri-sim/src/mood.rs` (call both after `overdoing_moodlets`), `crates/terri-sim/src/relationship_effects.rs` (`Nuisance`), `crates/terri-sim/src/lib.rs` (schedule)
- Test: `crates/terri-sim/src/affinity_tests.rs` (`#[path]` module) using `test_content::sim_with` and the shipped pack through `Sim::new_from_shipped_lot_with_seed` where a real room layout is needed

**Interfaces:**
- Consumes: Task 2's component; `RoomRegions`, `Eating`, `Target`, `SmartObject`, `Path`, `Relationships::bump`, `RelationshipDiagnostics`.
- Produces: the moodlets and the feeling change described in [OA-presence] and [OA-use].

- [ ] **Step 1: Failing tests** (bounded `for` loops with a clock assertion, never `while`):

```rust
#[test]
fn presence_scores_one_plant_and_caps_the_extras() {
    // Shipped lot; put Tim at (14, 1) in the living room with Affinities plants = 1.0: moodlet "Likes the plants here" +10.
    // Set plants = -1.0: "Bothered by the plants here" -10. Set 0.1: no affinity moodlet. Place three more plants in the
    // same room (spawn SmartObject + Position): +19 at 1.0; a fifth plant still +19.
}
#[test]
fn presence_counts_only_the_room_the_person_stands_in() { /* Review focus 1 */ }
#[test]
fn affinity_moodlets_come_after_feeling_sick() { /* order in derive_mood */ }
#[test]
fn a_hater_is_bothered_by_another_watcher_and_their_feeling_falls() {
    // Bill (television = -1.0) in the living room; Casey ordered to watch_tv and ticked until Eating matches (bounded for, assert it did);
    // Bill's moodlets include "Bothered by Casey using the television" -15; over 60 ticks Bill's feeling toward Casey falls by 0.03
    // within 1e-5; a Nuisance effect is recorded each tick with responsible Casey, affected Bill, requested -0.0005.
}
#[test]
fn a_hater_is_not_bothered_by_their_own_use() { /* Review focus 2 */ }
#[test]
fn the_bother_stops_when_the_watcher_leaves() { /* Review focus 3: despawn or move Casey; next tick no moodlet; feeling unchanged after */ }
#[test]
fn a_lover_gets_nothing_from_another_watcher_and_a_walker_bothers_nobody() { /* value +1.0, and Casey with a Path still en route */ }
#[test]
fn band_words() {
    assert_eq!(band(1.0), "Loves"); assert_eq!(band(0.6), "Loves"); assert_eq!(band(0.59), "Likes"); assert_eq!(band(0.2), "Likes");
    assert_eq!(band(0.19), "Indifferent"); assert_eq!(band(-0.19), "Indifferent"); assert_eq!(band(-0.2), "Dislikes");
    assert_eq!(band(-0.6), "Hates"); assert_eq!(band(-1.0), "Hates");
}
```

- [ ] **Step 2: Run them**, expect failures.
- [ ] **Step 3: Implement.** `presence_moodlets`: for the subject's room (None gives nothing), count `SmartObject` entities per presence kind whose rounded tile is in that room; score `value * (points + extra * min(count - 1, cap) as f32)`; magnitude below the threshold gives nothing. `use_moodlets`: for each use kind with `value <= -threshold`, every other living person in the same room with `using_kind == Some(kind)`, one moodlet each in entity-index order, score `value * affinity_use_points`. `bother`: the same pairs, `bump(user, -|value| * per_hour / 60.0)` on the bothered person's `Relationships` (insert a default one if missing, as `domestic` does), recording a `RelationshipEffect` with cause `Nuisance`, `event: 0`, `emergency: false`, `directed: false`. People in `AtWork` or `Commuting` have no position in the house, so they fall out naturally; do not special-case sleep.
- [ ] **Step 4: Run** fmt, clippy, `cargo test --workspace`. Run the trace example once, `cargo run -p terri-sim --example trace`, and note its final funds line in the report.
- [ ] **Step 5: Commit** `Let things in the room and another person's television move mood`.

### Task 4: Boundary, HUD, documentation, changelog and the displayed check

**Files:**
- Modify: `crates/terri-sim/src/lib.rs` (`Sim::affinities_of(index) -> Option<Vec<f32>>`, `Sim::affinity_labels() -> Vec<&str>`), `crates/terri-wasm/src/lib.rs` (`affinities_of(entity_index) -> Vec<f32>` empty for a non-person, `affinity_labels() -> Vec<String>`), new `crates/terri-wasm/src/affinity_boundary_tests.rs`
- Modify: `web/src/bridge.ts` (`affinitiesOf(entity): number[] | null`, `affinityLabels(): string[]`), `web/index.html` (`<details id="affinities-block"><summary>Likes and dislikes</summary><p id="affinities-empty">Select a person to see their likes and dislikes.</p><ul id="affinity-list" hidden></ul></details>` after `#skills-block`), new `web/src/ui/affinities-panel.ts` on the `skills-panel.ts` pattern (`affinitiesPanelState`, `AffinitiesPanel`, `createAffinitiesPanelSurface`; rows `{label, word}`; `band` reimplemented with the same thresholds and a test that the two agree on the nine values above), `web/src/main.ts` (wiring beside the skills block), `web/src/ui/compact-hud.css` only if a row class needs it
- Test: `web/tests/affinities-panel.test.ts`, `web/tests/bridge.test.ts` (one case through the release wasm), `web/tests/strings` inventory test if one reads the inventory
- Docs: `docs/player-visible-strings.md` (Mood row gains the three moodlet forms; a new row for the section), `docs/glossary.md` (`affinity kind`, `affinity value`, the bands), `docs/GAME-SYSTEMS.md` ([S-deep-traits] "What exists" gains the values; [S-acclimation] part two note points at [OA-values]; the build-order item 2 marks the first slice shipped), `docs/FEATURES.md` ([B-object-affinities] status Partial with what shipped and what remains; the roadmap table's Traits and Mood rows; a dated paragraph under Next engineering slices), `docs/changelog/2026-10-06-skills.md` (player bullets under Added: likes and dislikes per person, things in the room, television bother), `docs/specs/2026-10-06-object-affinities.md` (Status line to implemented on branch), `docs/specs/2026-10-06-object-affinities-verification.md` (guard deletions for: the threshold gate, the extra cap, the self-use exclusion, the room check, the trait override, the hash block, the decoder count; the boundary and web test tables; the displayed check with screenshots under `docs/assets/review-evidence/object-affinities/`)

**Interfaces:**
- Consumes: Tasks 1 to 3.

- [ ] **Step 1: Failing boundary tests** (`affinities_of` for Tim, Bill and Casey matches `Sim::affinities_of` and has four entries; Bill's television value is 0.8; a non-person, `u32::MAX` and a dead person's retired index read `[]` in release; `affinity_labels` is `["plants", "aquarium", "television", "radio"]`; the reads leave the save bytes and the world hash unchanged).
- [ ] **Step 2: Failing web tests** (`affinitiesPanelState` unselected, unavailable on a length mismatch or null, ready with four rows and the right words; the surface renders rows and `data-state`; the bridge returns null for an object index).
- [ ] **Step 3: Implement** the projections, the bridge, the panel and the markup; wire the toggle like the skills block.
- [ ] **Step 4: Run** the whole gate list under Global Constraints, including the release boundary tests, `wasm-pack build`, the web gates, the changelog tests and build, and `py -3 check-doc-ids.py`.
- [ ] **Step 5: Displayed check.** Build the web bundle, serve it on port 4173 only (`npm run preview` from `web/`, nothing else), drive a Playwright Chromium with the game muted (set the audio preference off before play), select Tim, open `Likes and dislikes`, take desktop (1280 by 800) and phone (375 by 812) screenshots showing the section and one affinity moodlet in the mood panel (order Tim into the living room if needed), record the console, close the page in a `finally`, stop the server, and confirm `Get-NetTCPConnection -LocalPort 4173 -State Listen` returns nothing.
- [ ] **Step 6: Write the docs and the verification record**, then run the doc gates again.
- [ ] **Step 7: Commit** `Show each person's likes and dislikes and record the affinity evidence`.
