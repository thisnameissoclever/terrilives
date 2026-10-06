# Overdoing It Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repeating an activity cost happiness and make too much food cause a temporary "Feeling sick" condition, using the existing per-person habituation value as the only state.

**Architecture:** `Habituation` entries may now rise above 1 up to a tuned `habituation_max`; appeal, the details meter and need delivery clamp at 1, so only mood sees the excess. `mood::derive_mood` appends two derived moodlets from habituation entries above `overdoing_threshold`, and a food-gated `Feeling sick` at `sick_threshold`. Linear decay already in `decay_habituation` provides the fade. No new save field, component or hash input; the load validator's habituation range widens.

**Tech Stack:** Rust workspace (`terri-data` tuning schema and compile checks, `terri-core` `Habituation`, `terri-sim` mood, habituation, interact, chain, details, save validation), wasm boundary unchanged apart from tests, web Mood panel unchanged apart from strings and tests.

**Spec:** `docs/specs/2026-10-06-overdoing-it.md` ([OD-model], [OD-moodlets], [OD-content], [OD-evidence]).

## Rulings

1. **No new state.** Overdoing and sickness are derived from the saved habituation value; the decay is the timer. Cost if wrong: a later design wanting a separate sickness timer adds its own state then.
2. **The appeal floor stays.** `benefit_scale` keeps its 45% floor and clamps its input at 1; the owner's "floor goes away" applies to mood. Cost if wrong: autonomy can keep choosing an activity it is overdoing, which the spec records as a limit.
3. **Food means a positive Hunger delta** in the interaction's or chain's advertised needs. Cost if wrong: a drink or similar that only refills another need never causes sickness.
4. **New moodlets go last** in the derived list, after `Dirty dishes`. Cost if wrong: none for play; it keeps existing exact-order tests stable.
5. **Labels are plain**: `Overdoing {activity}` and `Feeling sick`.

## Global Constraints

- No new save field; `SaveSnapshotV5` is untouched. `validate_habituation` accepts `0.0..=habituation_max` (read from tuning at load) instead of `0.0..=1.0`; every historical fixture still loads.
- `Habituation::bump` takes the cap as a parameter (`bump(object, row, amount, cap)`); every caller passes `tuning.habituation_max`; no caller passes a literal.
- `benefit_scale(habituation.min(1.0), floor)` everywhere appeal is computed (the clamp lives inside `benefit_scale`); `details.rs` repetition reports `value.min(1.0)`; `web/src/bridge.ts` keeps rejecting repetition outside 0..1 (unchanged).
- World hash: unchanged code; the value already feeds the per-entity rows. The bare-agent golden vector and the aquarium pin must not move (no shipped save has habituation above 1).
- Mood order: existing moodlets, then overdoing entries in habituation order, then at most one `Feeling sick`.
- Every production loop is bounded (iterating a person's habituation entries only). Tests never `while` on simulation state. Guard deletions per lesson [L15], recorded in `docs/specs/2026-10-06-overdoing-it-verification.md`.
- Functional text plain; strings and glossary updated; no em dash or en dash anywhere new; imperative commit messages; no attribution; commit with `git -c user.name="Tim Woodruff" -c user.email="myemailaddressisveryclever@gmail.com" commit ...`; stage only files you change.
- Before each commit: `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`; for the final task also `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`, then from `web/`: `npm run typecheck`, `npx vitest run`, `npm run build`, plus the changelog tests and build and `py -3 check-doc-ids.py`.
- Three other worktrees hold unmerged work that edits `mood.rs`, `interact.rs` and `chain.rs`; do not read or copy from them.

## Review Focus

1. **A person at the habituation cap keeps eating by player order**: the need still fills, the cap holds, and no moodlet exceeds its tuned penalty. Pinned in Task 1 (`the_cap_holds_and_delivery_ignores_repetition`).
2. **A loaded save whose habituation sits at exactly 1.0 from the old build** shows no overdoing moodlet (threshold is strict `>`). Pinned in Task 2 (`exactly_at_the_threshold_is_not_overdoing`).
3. **Two food entries above the sick threshold** produce one `Feeling sick`, not two. Pinned in Task 2 (`feeling_sick_appears_once_per_person`).
4. **Decay removes the moodlets without any order and without a tick that completes anything.** Pinned in Task 2 (`repeated_snacks_make_a_person_sick_and_decay_heals_them`).
5. **A snapshot carrying a habituation value above the tuned maximum** refuses to load and leaves the live world untouched. Pinned in Task 1 (`habituation_above_the_tuned_maximum_refuses_the_load`).

---

### Task 1: Raise the habituation cap and keep appeal, meter and delivery at one

**Files:**
- Modify: `content/tuning.toml` (five keys with comments)
- Modify: `crates/terri-data/src/schema.rs` (`TuningFile` fields; `TUNING_LINES` fixture), `crates/terri-data/src/pack.rs` (`Tuning` fields), `crates/terri-data/src/compile.rs` (`compile_tuning` checks and copies; `ContentError` variants `InvalidOverdoingTuning { key: &'static str }`), `crates/terri-data/src/error.rs`
- Modify: `crates/terri-core/src/components.rs` (`Habituation::bump(object, interaction, amount, cap)`)
- Modify: `crates/terri-sim/src/systems/interact.rs` (220-247), `crates/terri-sim/src/systems/chain.rs` (470-504), `crates/terri-sim/src/save.rs` (restore via `bump` at 675-685; `validate_habituation` 1561-1589), `crates/terri-sim/src/systems/advertise.rs` (`benefit_scale` clamps), `crates/terri-sim/src/details.rs` (`repetition.min(1.0)`)
- Modify tests: `crates/terri-sim/src/systems/habituation.rs`, `advertise.rs`, `save.rs`, `details.rs`, `crates/terri-data/src/lib.rs` and `compile.rs` tuning tests

**Interfaces:**
- Produces:
  ```rust
  // Tuning
  pub habituation_max: f32, pub overdoing_threshold: f32, pub overdoing_penalty: f32, pub sick_threshold: f32, pub sick_penalty: f32,
  // Habituation
  pub fn bump(&mut self, object: ObjectDefId, interaction: u32, amount: f32, cap: f32); // value = (value + amount).min(cap); insert clamps to 0..=cap
  // advertise
  pub fn benefit_scale(habituation: f32, floor: f32) -> f32 { 1.0 - habituation.clamp(0.0, 1.0) * (1.0 - floor) }
  ```

- [ ] **Step 1: Failing tests.** Add to `crates/terri-sim/src/systems/habituation.rs` tests:

```rust
#[test]
fn the_cap_holds_and_delivery_ignores_repetition() {
    // Shipped lot; one person; order Grab a snack (the fridge's snack row) nine
    // times in sequence with bounded for-loops and clock assertions, waiting
    // for each completion (copy the completion wait from
    // finishing_an_interaction_raises_habituation_and_starting_one_does_not).
    // Assert after each completion that the snack row's habituation equals
    // min(previous + habituation_per_use - decay_during_wait, habituation_max)
    // within 1e-4, that it never exceeds habituation_max, and that the
    // hunger refill of the ninth snack equals the refill of the first
    // (compare Needs before and after each snack; both start from a
    // hunger forced to the same level with Needs::set).
}
#[test]
fn benefit_scale_clamps_repetition_above_one() {
    assert_eq!(benefit_scale(1.5, 0.45), benefit_scale(1.0, 0.45));
    assert_eq!(benefit_scale(3.0, 0.45), 0.45);
    assert_eq!(benefit_scale(-1.0, 0.45), 1.0);
}
```

In `crates/terri-sim/src/save.rs` tests, beside `habituation_and_disposition_entries_require_valid_unique_content_rows`:

```rust
#[test]
fn habituation_above_the_tuned_maximum_refuses_the_load() {
    // Build a V5 snapshot from the shipped lot; set one person's saved
    // habituation value to habituation_max exactly (loads) and to
    // habituation_max + 0.001 (refuses with InvalidValue); assert the live sim's
    // hash and save bytes are unchanged after the refusal; assert a value of
    // 2.0 round-trips exactly and loads through the public wasm boundary too
    // (add the wasm half beside the existing habituation boundary test in
    // crates/terri-wasm/src/lib.rs or save_v3_tests.rs).
}
```

In `crates/terri-sim/src/details.rs` tests: a person with habituation 2.0 on a row reports `repetition == 1.0`.

In `crates/terri-data/src/compile.rs` tests: each of the five keys rejects a non-finite value; `habituation_max` of 1.0 rejects; `overdoing_threshold` of 0.5 rejects and of `habituation_max` rejects; `sick_threshold` at or below `overdoing_threshold` rejects and above `habituation_max` rejects; negative penalties reject; the shipped values compile and are copied (extend `every_mood_knob_is_copied_to_its_own_compiled_field` or add a sibling).

- [ ] **Step 2: Run and watch them fail** (`cargo test -p terri-sim habituation benefit_scale`, `cargo test -p terri-data`).
- [ ] **Step 3: Implement** the tuning keys (comments naming [OD-content]), the `bump` signature with `cap` (update every caller including the save restore, which passes `tuning.habituation_max`), the clamp in `benefit_scale`, the details clamp, and the validator range. `TUNING_LINES` gains five distinct fixture values.
- [ ] **Step 4: Run** `cargo test --workspace`; fix tests that assumed a cap of 1 (`habituation_caps_at_one_and_keeps_its_keys_sorted` becomes `habituation_caps_at_the_tuned_maximum_and_keeps_its_keys_sorted` with a cap argument).
- [ ] **Step 5: Guard deletions** (cap in `bump`; clamp in `benefit_scale`; details clamp; validator upper bound) recorded in `docs/specs/2026-10-06-overdoing-it-verification.md` (create it with the usual header; one paragraph per line).
- [ ] **Step 6: Commit** `git commit -m "Let habituation rise above one while appeal, the meter and delivery stay capped"`.

---

### Task 2: The overdoing and feeling-sick moodlets

**Files:**
- Modify: `crates/terri-sim/src/mood.rs` (`derive_mood` after the `Dirty dishes` block; new helpers)
- Modify: `crates/terri-sim/src/details.rs` (expose the activity-label resolution for a habituation row as `pub(crate) fn activity_label(pack, object, row) -> (&str, &str)` or reuse what `details_of` already does, so the moodlet label and the details row agree)
- Modify tests: `crates/terri-sim/src/mood.rs` (`no_trait_label_repeats_a_need_moodlet` count; order tests), new tests below

**Interfaces:**
- Produces in `mood.rs`:
  ```rust
  fn overdoing_moodlets(pack: &ContentPack, habituation: Option<&Habituation>) -> Vec<Moodlet>; // overdoing entries in habituation order, then at most one Feeling sick
  pub(crate) fn is_food(pack: &ContentPack, object: ObjectDefId, row: u32) -> bool;       // the row's advertised needs include a positive Hunger delta (interaction or chain)
  ```

- [ ] **Step 1: Failing tests** in `mood.rs` tests (use the shipped lot and `world_mut().get_mut::<Habituation>` to set values directly where a played scenario is not needed):

```rust
#[test]
fn exactly_at_the_threshold_is_not_overdoing() { /* set a non-food row to exactly overdoing_threshold: no Overdoing moodlet; one f32 step above: one moodlet with a score just below zero */ }
#[test]
fn overdoing_score_grows_linearly_to_the_penalty_at_the_cap() { /* midpoint gives -penalty/2 within 1e-4; cap gives -penalty; label is "Overdoing {activity label}" and equals the details row label for the same row */ }
#[test]
fn feeling_sick_appears_once_per_person_and_only_for_food() { /* two food rows at sick_threshold: exactly one "Feeling sick" with -sick_penalty; a non-food row at the cap: Overdoing only */ }
#[test]
fn new_moodlets_come_after_every_existing_one_in_habituation_order() { /* seed a condition, a nearby friend, dirty dishes if cheap, and two overdoing rows; assert the label order ends with the two Overdoing labels then Feeling sick */ }
#[test]
fn repeated_snacks_make_a_person_sick_and_decay_heals_them() {
    // Played: order Grab a snack repeatedly (bounded for-loops, clock assertions)
    // and read mood after each completion: no Overdoing before the fourth,
    // Overdoing after it with a growing penalty, Feeling sick by the ninth;
    // record satisfaction before and after a fixed stretch while both stand
    // (it falls); then stop ordering and tick a fixed count that decay needs
    // (compute from the tuning values, assert the clock); both moodlets gone,
    // hunger still fully refilled at every snack.
}
```

Update `no_trait_label_repeats_a_need_moodlet` for the new fixed label `Feeling sick` (overdoing labels are dynamic).

- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement** `overdoing_moodlets` and `is_food`, append in `derive_mood` after `Dirty dishes`; resolve activity labels through the same code `details.rs` uses (factor a shared helper rather than duplicating the chain-row resolution; see lesson [L65]).
- [ ] **Step 4: Run** `cargo test --workspace`.
- [ ] **Step 5: Guard deletions** (threshold strictness, food gate, once-per-person, the ordering append position) recorded.
- [ ] **Step 6: Commit** `git commit -m "Add overdoing and feeling-sick moodlets derived from repetition"`.

---

### Task 3: Boundary check, strings, docs, changelog and displayed pass

**Files:**
- Modify: `crates/terri-wasm/src/lib.rs` or `save_v3_tests.rs` (public-boundary load of a habituation value of 2.0 and refusal above the maximum, in release)
- Modify: `web/tests/mood-panel.test.ts` (a fake row for `Feeling sick` and `Overdoing Grab a snack` renders), `web/tests/bridge.test.ts` only if a pinned label list breaks
- Modify: `docs/player-visible-strings.md` (Mood row gains `Overdoing {activity}`; `Feeling sick`; also add the missing `Grieving {name}` and `Waiting for an item` the map found uninventoried), `docs/glossary.md` (habituation row 102 reword: appeal never below 45%, but mood now suffers above saturation; new rows for overdoing and feeling sick), `docs/GAME-SYSTEMS.md` ([S-acclimation] status: part one shipped, part two open; [P-health] first cause note), `docs/FEATURES.md` (table row and Next engineering slices), `docs/changelog/2026-10-06-skills.md` (extend with an `## New` bullet about overdoing and feeling sick, or a new same-day section), the spec Status line, `docs/specs/2026-10-06-overdoing-it-verification.md` (Displayed browser and Delivery)
- Create: `docs/assets/review-evidence/overdoing/desktop-mood.png`, `phone-mood.png`

- [ ] **Step 1: Boundary test** in release: a V5 save with a habituation of 2.0 loads through `load_bytes` and resaves identically; 3.5 refuses and leaves `save_bytes` unchanged.
- [ ] **Step 2: Web tests**, wasm rebuild, typecheck, vitest, build.
- [ ] **Step 3: Displayed pass**: serve the built site on 4173 (check the port first; mute through `terrilives.audio-preferences.v1`), select a person, order Grab a snack repeatedly from the fridge menu (nine times; the queue takes orders in sequence), watch the Mood panel in Sim details until `Overdoing Grab a snack` and `Feeling sick` show, screenshot at desktop and the mobile preset; close everything in a finally step. If the in-app pane cannot run frames, use the Playwright MCP's Chromium and say so.
- [ ] **Step 4: Docs, strings, glossary, changelog** (player bullets: "Doing the same thing over and over now wears on a housemate's mood, and the more they keep at it the worse it gets. Keep snacking past the point of hunger and they feel sick for a few hours." split into two bullets if clearer), `node --test scripts/build-changelog.test.mjs`, `node scripts/build-changelog.mjs`, `py -3 check-doc-ids.py`, the dash check.
- [ ] **Step 5: Commit** `git commit -m "Record overdoing it as shipped and note it for players"`.

---

## Self-review

**Spec coverage.** [OD-model]: Task 1. [OD-moodlets]: Task 2. [OD-content]: Task 1. [OD-evidence] 1, 4, 5: Task 1; 2, 3, 5: Task 2; 4 (boundary) and 6: Task 3.

**Placeholder scan.** Task 1 Step 1 and Task 2 Step 1 describe tests in comments with the exact assertions to make; the implementer writes them from those comments.

**Type consistency.** `bump(object, interaction, amount, cap)` is used by `interact.rs`, `chain.rs` and the save restore; `benefit_scale` keeps its signature and clamps inside; tuning field names match between schema, pack and compile.

**Review Focus.** Each line names its pinned test in Task 1 or Task 2.
