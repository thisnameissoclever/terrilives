# M1a Content Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move smart-object and need definitions out of Rust literals into validated TOML content, so the remaining M1 features can be authored as data rather than code.

**Architecture:** `Hunger(f32)` becomes `Needs([f32; 7])` indexed by a `NeedId` enum. `SmartObject` stops naming needs and becomes `SmartObject(ObjectDefId)`, an index into a content pack. A new `terri-data` crate holds the schema and a `build.rs` that compiles `content/*.toml` into a `postcard` pack embedded with `include_bytes!`, failing the build on invalid content.

**Tech Stack:** Rust 1.94.1 (pinned in `rust-toolchain.toml`), `bevy_ecs` 0.18.1, `serde`, `toml`, `postcard`.

**Design doc:** `docs/specs/2026-07-27-m1a-content-pipeline-design.md`. Read it; this plan implements it and does not restate its reasoning.

## Global Constraints

- **No em-dashes anywhere.** Not in code, comments, strings, TOML, docs, or commit messages. Spaced hyphens ( - ) or semicolons only. Hard project rule.
- **`terri-core`, `terri-sim`, and `terri-data` must contain zero `wasm-bindgen` and zero `web-sys` dependencies**, on both the host and `wasm32-unknown-unknown` targets. Only `terri-wasm` may reference JavaScript. Verify with explicit `--target` flags; a bare `cargo tree` misleads. See [L4].
- **Read `docs/testing-protocol.md` before writing any test.** It governs this project. In particular: mutation-test every load-bearing invariant and report the actual failure output; prefer causal assertions over equality assertions; and any test that can pass on empty input needs an assertion that the input was not empty.
- **Declare `pub mod foo;` in the same step that creates `foo.rs`.** Rust never compiles a `.rs` file no `mod` references, so the usual ordering produces a false red reporting `0 tests`. See [L2]. Read test *counts*, not exit status.
- **Never restore a mutation with `git checkout <path>`.** This workflow runs on an uncommitted tree, so that command silently discards real work. Snapshot to the scratchpad and restore from there, then touch the file so cargo rebuilds. See [L8], [L9].
- Rust edition 2021. Single-threaded executor, fixed 10 Hz timestep, one tick equals one sim-minute.
- CI gates on `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --check`, the web suite, and a mutation sweep against `docs/mutants-baseline.txt`.
- Commit messages: imperative summary, why-body when non-obvious. **No AI or Claude attribution, no co-authored-by trailers.**
- Baseline at branch start: **57 Rust tests, 57 web tests.**

## File Structure

```
content/
  needs.toml                  decay rates, one entry per NeedId variant
  objects.toml                objects and their advertised interactions
crates/
  terri-core/src/
    needs.rs                  NeedId, Needs, NEED_COUNT      (new)
    components.rs             SmartObject becomes ObjectDefId (modified)
  terri-data/                                                 (new crate)
    Cargo.toml
    build.rs                  compiles content/ to OUT_DIR pack
    src/lib.rs                pack embedding and accessors
    src/schema.rs             serde types matching the TOML
    src/compile.rs            schema to pack, plus validation
    src/error.rs              ContentError
  terri-sim/src/              systems read adverts from the pack (modified)
  terri-wasm/src/lib.rs       spawn by content string id (modified)
```

`compile.rs` is shared by `build.rs` and the unit tests, which is what lets the validation rules be tested directly rather than only through build failures.

---

### Task 1: `NeedId` and `Needs` in terri-core

Pure addition. `Hunger` stays until Task 2, so nothing breaks.

**Files:**
- Create: `crates/terri-core/src/needs.rs`
- Modify: `crates/terri-core/src/lib.rs`

**Interfaces:**
- Consumes: `NEED_MIN`, `NEED_MAX` from `components.rs`
- Produces: `NEED_COUNT: usize = 7`; `enum NeedId { Hunger, Energy, Hygiene, Bladder, Social, Fun, Comfort }` with `NeedId::ALL: [NeedId; NEED_COUNT]`, `index(self) -> usize`, `as_str(self) -> &'static str`, `from_name(&str) -> Option<NeedId>`; `struct Needs([f32; NEED_COUNT])` (a `Component`) with `all_at(f32)`, `get(NeedId) -> f32`, `set(NeedId, f32)`, `drain(NeedId, f32)`, `fill(NeedId, f32)`, `deficit(NeedId) -> f32`, `as_slice(&self) -> &[f32; NEED_COUNT]`; **also `ObjectDefId(pub u32)`**

**`ObjectDefId` lives here, in `terri-core`, not in `terri-data`.** `terri-core` is the lowest layer and must not depend on the content crate, but `SmartObject` needs to hold one. `terri-data` re-exports it. Add to `needs.rs` or a sibling module as you prefer:

```rust
/// Index of an object in the content pack, assigned in declaration
/// order. Stable within a pack, NOT stable across content edits, which
/// is why nothing persists one; save files store the string id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ObjectDefId(pub u32);
```

It needs `serde::{Serialize, Deserialize}` derives for the pack. `terri-core` therefore gains a `serde` dependency with `default-features = false, features = ["derive"]`. Confirm that does not pull anything web-shaped on `wasm32-unknown-unknown` before committing.

- [ ] **Step 1: Create `needs.rs` with its module declaration and failing tests**

Add `pub mod needs;` to `crates/terri-core/src/lib.rs` in this same step.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_lists_every_variant_in_index_order() {
        // ALL is hand-written, so it can silently drift from the enum.
        // Anything that iterates needs would then skip one forever.
        assert_eq!(NeedId::ALL.len(), NEED_COUNT);
        for (i, id) in NeedId::ALL.iter().enumerate() {
            assert_eq!(id.index(), i, "ALL is out of order at {i}");
        }
    }

    #[test]
    fn names_round_trip_for_every_variant() {
        for id in NeedId::ALL {
            assert_eq!(NeedId::from_name(id.as_str()), Some(id));
        }
        assert_eq!(NeedId::from_name("nonexistent"), None);
    }

    #[test]
    fn needs_clamp_to_range() {
        let mut n = Needs::all_at(100.0);
        n.drain(NeedId::Hunger, 150.0);
        assert_eq!(n.get(NeedId::Hunger), 0.0);
        n.fill(NeedId::Hunger, 500.0);
        assert_eq!(n.get(NeedId::Hunger), 100.0);
    }

    #[test]
    fn each_need_is_independent() {
        // A shared-index bug would move all seven together and every
        // other test here would still pass.
        let mut n = Needs::all_at(100.0);
        n.drain(NeedId::Energy, 40.0);
        assert_eq!(n.get(NeedId::Energy), 60.0);
        for id in NeedId::ALL {
            if id != NeedId::Energy {
                assert_eq!(n.get(id), 100.0, "{} moved with Energy", id.as_str());
            }
        }
    }

    #[test]
    fn deficit_is_inverse_of_level() {
        assert_eq!(Needs::all_at(100.0).deficit(NeedId::Fun), 0.0);
        assert_eq!(Needs::all_at(0.0).deficit(NeedId::Fun), 1.0);
        assert_eq!(Needs::all_at(50.0).deficit(NeedId::Fun), 0.5);
    }
}
```

- [ ] **Step 2: Run the tests and verify they fail for the right reason**

Run: `cargo test -p terri-core needs`
Expected: compile error `E0433: failed to resolve: use of undeclared type NeedId`. **Not** `0 passed; 0 failed` - that would mean the module is not wired in.

- [ ] **Step 3: Implement**

Above the `tests` module in `crates/terri-core/src/needs.rs`:

```rust
use crate::components::{NEED_MAX, NEED_MIN};
use bevy_ecs::prelude::Component;

/// Number of distinct needs. Fixed at compile time on purpose: it sets
/// the world-hash shape, and a variable count would make a determinism
/// regression and a content edit produce the same failure.
pub const NEED_COUNT: usize = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum NeedId {
    Hunger = 0,
    Energy,
    Hygiene,
    Bladder,
    Social,
    Fun,
    Comfort,
}

impl NeedId {
    /// Every variant, in index order. Hand-written because Rust has no
    /// built-in enum iteration; `all_lists_every_variant_in_index_order`
    /// is what stops it drifting from the enum.
    pub const ALL: [NeedId; NEED_COUNT] = [
        NeedId::Hunger,
        NeedId::Energy,
        NeedId::Hygiene,
        NeedId::Bladder,
        NeedId::Social,
        NeedId::Fun,
        NeedId::Comfort,
    ];

    pub fn index(self) -> usize {
        self as usize
    }

    /// The name content files use. Changing one of these is a content
    /// breaking change, not a rename.
    pub fn as_str(self) -> &'static str {
        match self {
            NeedId::Hunger => "hunger",
            NeedId::Energy => "energy",
            NeedId::Hygiene => "hygiene",
            NeedId::Bladder => "bladder",
            NeedId::Social => "social",
            NeedId::Fun => "fun",
            NeedId::Comfort => "comfort",
        }
    }

    pub fn from_name(name: &str) -> Option<NeedId> {
        NeedId::ALL.into_iter().find(|id| id.as_str() == name)
    }
}

/// All seven need levels for one sim, each 0.0 (desperate) to 100.0
/// (satisfied).
#[derive(Component, Debug, Clone, Copy, PartialEq)]
pub struct Needs([f32; NEED_COUNT]);

impl Needs {
    pub fn all_at(level: f32) -> Self {
        Needs([level.clamp(NEED_MIN, NEED_MAX); NEED_COUNT])
    }

    pub fn get(&self, id: NeedId) -> f32 {
        self.0[id.index()]
    }

    pub fn set(&mut self, id: NeedId, level: f32) {
        self.0[id.index()] = level.clamp(NEED_MIN, NEED_MAX);
    }

    pub fn drain(&mut self, id: NeedId, amount: f32) {
        let next = self.get(id) - amount;
        self.set(id, next);
    }

    pub fn fill(&mut self, id: NeedId, amount: f32) {
        let next = self.get(id) + amount;
        self.set(id, next);
    }

    /// 0.0 when satisfied, 1.0 when desperate. Advertisement scoring
    /// weights this nonlinearly.
    pub fn deficit(&self, id: NeedId) -> f32 {
        (NEED_MAX - self.get(id)) / NEED_MAX
    }

    pub fn as_slice(&self) -> &[f32; NEED_COUNT] {
        &self.0
    }
}
```

Add to the `pub use` in `crates/terri-core/src/lib.rs`:

```rust
pub use needs::{NeedId, Needs, NEED_COUNT};
```

- [ ] **Step 4: Verify they pass**

Run: `cargo test -p terri-core`
Expected: 23 passed (18 existing plus 5 new).

- [ ] **Step 5: Mutation-verify the two load-bearing tests**

Per `docs/testing-protocol.md` rule 1. Apply each, confirm the named test fails, restore from a scratchpad snapshot, confirm `git hash-object` matches, touch the file.

1. Remove `NeedId::Comfort` from the `ALL` array. Expect `all_lists_every_variant_in_index_order` to fail.
2. Change `Needs::set` to write `self.0[0]` instead of `self.0[id.index()]`. Expect `each_need_is_independent` to fail.

Report both actual failure outputs.

- [ ] **Step 6: Commit**

```bash
git add crates/terri-core && git commit -m "Add NeedId and Needs alongside Hunger

Seven needs held in one fixed array indexed by an enum, rather than
seven components. Adding a need becomes one enum variant plus content,
while the array length keeps the world-hash shape fixed.

Hunger stays for now so nothing breaks; the next task migrates every
consumer and removes it."
```

---

### Task 2: Migrate everything from `Hunger` to `Needs`

**The largest task in the plan, and the one the design doc names as the main risk.** The compiler drives it: every `Hunger` use becomes an error. The danger is not breakage, it is that a careless edit quietly re-breaks a test that took several review rounds to stop being vacuous.

**Files:**
- Modify: `crates/terri-core/src/components.rs` (delete `Hunger`), `crates/terri-core/src/lib.rs`
- Modify: `crates/terri-sim/src/lib.rs`, `src/render_buffer.rs`, `src/systems/needs.rs`, `src/systems/action.rs`, `src/systems/advertise.rs`, `src/systems/interact.rs`
- Modify: `crates/terri-wasm/src/lib.rs`

**Interfaces:**
- Consumes: everything Task 1 produces
- Produces: no `Hunger` type anywhere; `Sim::new` registers `Needs`; `world_hash` covers all seven levels

- [ ] **Step 1: Read every current use before changing any**

Run: `cargo test --workspace 2>&1 | grep -c "^test result: ok"` and record it, then:

Run: `grep -rn "Hunger" crates/ --include=*.rs | wc -l`

Read each site. **Do not begin editing until you have read them all.** Several tests encode subtle invariants - induced archetype churn, bit-exact score construction, a golden contention winner - and the migration must preserve the mechanism, not just the compile.

- [ ] **Step 2: Migrate one file at a time, running the suite after each**

Order: `components.rs` and `lib.rs` (delete `Hunger`, register `Needs`), then `systems/needs.rs`, `systems/advertise.rs`, `systems/action.rs`, `systems/interact.rs`, `render_buffer.rs`, `terri-wasm/src/lib.rs`.

Mechanical substitutions:
- `Hunger(v)` becomes `Needs::all_at(100.0)` then `set(NeedId::Hunger, v)`, or a helper `Needs::with(NeedId::Hunger, v)` if you prefer - **if you add such a helper, it needs its own test.**
- `hunger.0` becomes `needs.get(NeedId::Hunger)`
- `hunger.drain(x)` becomes `needs.drain(NeedId::Hunger, x)`
- `Query<&mut Hunger>` becomes `Query<&mut Needs>`
- `world.register_component::<Hunger>()` becomes `::<Needs>()`

**In `Sim::world_hash`, hash all seven levels, not just hunger.** The `-1.0` "no Needs component" sentinel stays, but now applies to the whole component.

**Preserve exactly:** the induced archetype churn in `contention_resolves_by_entity_order_not_iteration_order`; the bit-equality precondition in `a_score_exactly_at_the_action_threshold_selects_nothing` (recompute the constants if the arithmetic shifts, and keep the precondition assertion); the golden winners in both tie-break tests.

- [ ] **Step 3: Verify the suite is whole**

Run: `cargo test --workspace`
Expected: 62 passed (57 baseline plus Task 1's 5). **If the count is lower, a test was dropped rather than migrated.** Find it.

- [ ] **Step 4: Update the golden world-hash vectors**

The native golden vector and the web cross-boundary vector both change, because the hash now covers seven levels. Run the tests, read the new value, and update **both** sites. Rebuild the WASM package first, or you will compare against a stale artifact ([L8]):

```bash
wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm
```

**Observe the wasm32 value rather than assuming it equals the native one** ([L13]). If they differ, that is a real cross-platform determinism finding - report it, do not paper over it.

- [ ] **Step 5: Verify the whole gate**

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all -- --check`
Then from `web/`: `npm run typecheck && npm test`
Expected: 62 Rust, 57 web, all clean.

- [ ] **Step 6: Confirm no test was silently weakened**

Run the mutation sweep and compare against the committed baseline:

```bash
cargo mutants --package terri-core --package terri-sim --test-workspace true --timeout 60
sort mutants.out/missed.txt > /tmp/actual.txt
sort docs/mutants-baseline.txt > /tmp/base.txt
comm -23 /tmp/actual.txt /tmp/base.txt
```

Expected: no output from `comm`. **Any line here is a test this migration weakened.** Line numbers will have shifted, so some baseline entries may appear stale; report both directions and do not edit the baseline in this task.

- [ ] **Step 7: Commit**

```bash
git add crates web && git commit -m "Replace Hunger with the seven-need Needs component

Mechanical across every system, driven by the compiler. The world hash
now covers all seven levels, so both golden vectors change - deliberately,
with the wasm32 value observed rather than assumed equal to native.

Ran the mutation sweep afterwards to confirm the migration did not
weaken any test, since several of these took multiple review rounds to
stop being permanently green and a careless edit would not show up in a
passing suite."
```

---

### Task 3: `terri-data` crate with the TOML schema

**Files:**
- Create: `crates/terri-data/Cargo.toml`, `src/lib.rs`, `src/schema.rs`, `src/error.rs`
- Modify: root `Cargo.toml` (workspace members and dependencies)

**Interfaces:**
- Consumes: `NeedId`, `NEED_COUNT` from `terri-core`
- Produces: `NeedsFile { need: Vec<NeedDef> }`, `NeedDef { id: String, decay_per_tick: f32 }`, `ObjectsFile { object: Vec<ObjectDef> }`, `ObjectDef { id: String, name: String, interaction: Vec<InteractionDef> }`, `InteractionDef { id: String, advertises: BTreeMap<String, f32>, duration_ticks: u32, slots: u8 }`, `enum ContentError`

- [ ] **Step 1: Add workspace dependencies**

In the root `Cargo.toml` `[workspace.dependencies]`:

```toml
serde = { version = "1", features = ["derive"] }
toml = "0.9"
postcard = { version = "1", features = ["alloc"] }
```

Add `"crates/terri-data"` to `members`. Verify the exact current versions with `cargo add --dry-run` rather than trusting these; report what you used.

- [ ] **Step 2: Create the crate with its manifest**

`crates/terri-data/Cargo.toml`:

```toml
[package]
name = "terri-data"
edition.workspace = true
version.workspace = true

[dependencies]
terri-core = { path = "../terri-core" }
serde = { workspace = true }
postcard = { workspace = true }

[build-dependencies]
terri-core = { path = "../terri-core" }
serde = { workspace = true }
toml = { workspace = true }
postcard = { workspace = true }
```

`terri-core` appears in both because `build.rs` needs `NeedId` to validate content, and build dependencies are compiled separately. There is no cycle: `terri-core` has no `build.rs`.

- [ ] **Step 3: Write the schema with failing round-trip tests**

Create `src/schema.rs` and declare `pub mod schema;` in `src/lib.rs` in the same step.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_needs_file() {
        let parsed: NeedsFile = toml::from_str(
            r#"
            [[need]]
            id = "hunger"
            decay_per_tick = 0.104
            "#,
        )
        .expect("valid needs toml");
        assert_eq!(parsed.need.len(), 1);
        assert_eq!(parsed.need[0].id, "hunger");
        assert_eq!(parsed.need[0].decay_per_tick, 0.104);
    }

    #[test]
    fn parses_an_object_with_a_sparse_advert() {
        let parsed: ObjectsFile = toml::from_str(
            r#"
            [[object]]
            id = "fridge"
            name = "Chill-o-Matic 3000"

              [[object.interaction]]
              id = "grab_snack"
              advertises = { hunger = 35.0 }
              duration_ticks = 15
              slots = 1
            "#,
        )
        .expect("valid objects toml");
        let obj = &parsed.object[0];
        assert_eq!(obj.id, "fridge");
        let act = &obj.interaction[0];
        assert_eq!(act.advertises.get("hunger"), Some(&35.0));
        assert_eq!(act.advertises.len(), 1, "advert must stay sparse");
        assert_eq!(act.duration_ticks, 15);
    }

    #[test]
    fn an_object_may_declare_no_interactions() {
        let parsed: ObjectsFile = toml::from_str(
            r#"
            [[object]]
            id = "rug"
            name = "Rug"
            "#,
        )
        .expect("objects with no interaction should parse");
        assert!(parsed.object[0].interaction.is_empty());
    }
}
```

Note `toml` is a dev-dependency need here as well as a build-dependency. Add it under `[dev-dependencies]`.

- [ ] **Step 4: Run and verify the failure**

Run: `cargo test -p terri-data`
Expected: compile error naming `NeedsFile`. Not `0 tests`.

- [ ] **Step 5: Implement the schema**

Above the `tests` module in `src/schema.rs`:

```rust
use serde::Deserialize;
use std::collections::BTreeMap;

/// Mirrors content/needs.toml. Every NeedId variant must appear exactly
/// once; that is checked in compile.rs, not here, because serde cannot
/// express it.
#[derive(Debug, Deserialize)]
pub struct NeedsFile {
    pub need: Vec<NeedDef>,
}

#[derive(Debug, Deserialize)]
pub struct NeedDef {
    pub id: String,
    pub decay_per_tick: f32,
}

/// Mirrors content/objects.toml.
#[derive(Debug, Deserialize)]
pub struct ObjectsFile {
    pub object: Vec<ObjectDef>,
}

#[derive(Debug, Deserialize)]
pub struct ObjectDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub interaction: Vec<InteractionDef>,
}

#[derive(Debug, Deserialize)]
pub struct InteractionDef {
    pub id: String,
    /// Need name to delta. BTreeMap rather than HashMap so iteration
    /// order is deterministic, which the compiled pack depends on.
    pub advertises: BTreeMap<String, f32>,
    pub duration_ticks: u32,
    pub slots: u8,
}
```

- [ ] **Step 6: Add the error type**

Create `src/error.rs`, declared in the same step.

```rust
use std::fmt;

/// Every way content can be invalid. Messages are read by whoever broke
/// the build, so they name the offending id and the file.
#[derive(Debug, PartialEq)]
pub enum ContentError {
    UnknownNeed { object: String, interaction: String, need: String },
    MissingNeedDecay { need: String },
    UnknownNeedDecay { need: String },
    DuplicateNeedDecay { need: String },
    DuplicateObjectId { id: String },
    DuplicateInteractionId { object: String, id: String },
    ZeroDuration { object: String, interaction: String },
    ZeroSlots { object: String, interaction: String },
    NonFiniteValue { context: String },
    NegativeValue { context: String },
}

impl fmt::Display for ContentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ContentError::UnknownNeed { object, interaction, need } => write!(
                f,
                "object '{object}' interaction '{interaction}' advertises unknown need '{need}'"
            ),
            ContentError::MissingNeedDecay { need } => {
                write!(f, "needs.toml is missing a decay rate for '{need}'")
            }
            ContentError::UnknownNeedDecay { need } => {
                write!(f, "needs.toml declares unknown need '{need}'")
            }
            ContentError::DuplicateNeedDecay { need } => {
                write!(f, "needs.toml declares '{need}' more than once")
            }
            ContentError::DuplicateObjectId { id } => {
                write!(f, "duplicate object id '{id}'")
            }
            ContentError::DuplicateInteractionId { object, id } => {
                write!(f, "object '{object}' declares interaction '{id}' more than once")
            }
            ContentError::ZeroDuration { object, interaction } => write!(
                f,
                "object '{object}' interaction '{interaction}' has duration_ticks of 0; must be at least 1"
            ),
            ContentError::ZeroSlots { object, interaction } => write!(
                f,
                "object '{object}' interaction '{interaction}' has slots of 0; must be at least 1"
            ),
            ContentError::NonFiniteValue { context } => {
                write!(f, "{context} is not a finite number")
            }
            ContentError::NegativeValue { context } => {
                write!(f, "{context} is negative")
            }
        }
    }
}

impl std::error::Error for ContentError {}
```

- [ ] **Step 7: Verify and commit**

Run: `cargo test -p terri-data && cargo clippy -p terri-data --all-targets -- -D warnings && cargo fmt --all -- --check`
Expected: 3 passed, clean.

```bash
git add Cargo.toml Cargo.lock crates/terri-data && git commit -m "Add terri-data with the content schema and error type

Serde types mirroring the two TOML files, plus every way content can be
invalid. Adverts use BTreeMap rather than HashMap so iteration order is
deterministic, which the compiled pack depends on.

terri-core is both a dependency and a build-dependency because build.rs
needs NeedId to validate content. No cycle: terri-core has no build.rs."
```

---

### Task 4: Validation and compilation to a pack

**Files:**
- Create: `crates/terri-data/src/compile.rs`, `crates/terri-data/src/pack.rs`
- Modify: `crates/terri-data/src/lib.rs`

**Interfaces:**
- Consumes: Task 3's schema and `ContentError`
- Produces: `ContentPack { decay_per_tick: [f32; NEED_COUNT], objects: Vec<CompiledObject> }`; `CompiledObject { id: String, name: String, interactions: Vec<CompiledInteraction> }`; `CompiledInteraction { id: String, advertises: Vec<(u8, f32)>, duration_ticks: u32, slots: u8 }`; `ObjectDefId(pub u32)`; `compile(needs: NeedsFile, objects: ObjectsFile) -> Result<ContentPack, ContentError>`; `ContentPack::object(ObjectDefId) -> &CompiledObject`; `ContentPack::find(&str) -> Option<ObjectDefId>`

- [ ] **Step 1: Write the pack types**

Create `src/pack.rs`, declared in the same step.

```rust
use serde::{Deserialize, Serialize};
use terri_core::NEED_COUNT;

// Defined in terri-core, re-exported here so content consumers have one
// import path. It lives there because SmartObject holds one and
// terri-core must not depend on the content crate.
pub use terri_core::ObjectDefId;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledInteraction {
    pub id: String,
    /// (NeedId index, delta), sorted by index. Sparse: only advertised
    /// needs appear.
    pub advertises: Vec<(u8, f32)>,
    pub duration_ticks: u32,
    pub slots: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledObject {
    pub id: String,
    pub name: String,
    pub interactions: Vec<CompiledInteraction>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContentPack {
    pub decay_per_tick: [f32; NEED_COUNT],
    pub objects: Vec<CompiledObject>,
}

impl ContentPack {
    pub fn object(&self, id: ObjectDefId) -> &CompiledObject {
        &self.objects[id.0 as usize]
    }

    pub fn find(&self, id: &str) -> Option<ObjectDefId> {
        self.objects
            .iter()
            .position(|o| o.id == id)
            .map(|i| ObjectDefId(i as u32))
    }
}
```

- [ ] **Step 2: Write failing validation tests, one per rule**

Create `src/compile.rs`, declared in the same step. **Every rule needs a failing case, not only a passing one** - a validator with no negative tests is exactly the shape `docs/testing-protocol.md` rule 1 exists to prevent.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use terri_core::NeedId;

    fn full_needs() -> NeedsFile {
        NeedsFile {
            need: NeedId::ALL
                .iter()
                .map(|id| NeedDef { id: id.as_str().to_string(), decay_per_tick: 0.1 })
                .collect(),
        }
    }

    fn one_object(interaction: InteractionDef) -> ObjectsFile {
        ObjectsFile {
            object: vec![ObjectDef {
                id: "fridge".into(),
                name: "Fridge".into(),
                interaction: vec![interaction],
            }],
        }
    }

    fn snack() -> InteractionDef {
        InteractionDef {
            id: "grab_snack".into(),
            advertises: [("hunger".to_string(), 35.0)].into_iter().collect(),
            duration_ticks: 15,
            slots: 1,
        }
    }

    #[test]
    fn compiles_valid_content() {
        let pack = compile(full_needs(), one_object(snack())).expect("valid");
        assert_eq!(pack.objects.len(), 1);
        assert_eq!(pack.decay_per_tick.len(), NEED_COUNT);
        let act = &pack.objects[0].interactions[0];
        assert_eq!(act.advertises, vec![(NeedId::Hunger.index() as u8, 35.0)]);
        assert_eq!(pack.find("fridge"), Some(ObjectDefId(0)));
        assert_eq!(pack.find("nope"), None);
    }

    #[test]
    fn rejects_an_advert_naming_an_unknown_need() {
        let mut act = snack();
        act.advertises.insert("vibes".into(), 1.0);
        let err = compile(full_needs(), one_object(act)).unwrap_err();
        assert_eq!(
            err,
            ContentError::UnknownNeed {
                object: "fridge".into(),
                interaction: "grab_snack".into(),
                need: "vibes".into()
            }
        );
    }

    #[test]
    fn rejects_a_missing_need_decay() {
        let mut needs = full_needs();
        needs.need.retain(|n| n.id != "comfort");
        let err = compile(needs, one_object(snack())).unwrap_err();
        assert_eq!(err, ContentError::MissingNeedDecay { need: "comfort".into() });
    }

    #[test]
    fn rejects_an_unknown_need_decay() {
        let mut needs = full_needs();
        needs.need.push(NeedDef { id: "vibes".into(), decay_per_tick: 0.1 });
        let err = compile(needs, one_object(snack())).unwrap_err();
        assert_eq!(err, ContentError::UnknownNeedDecay { need: "vibes".into() });
    }

    #[test]
    fn rejects_a_duplicate_need_decay() {
        let mut needs = full_needs();
        needs.need.push(NeedDef { id: "hunger".into(), decay_per_tick: 0.2 });
        let err = compile(needs, one_object(snack())).unwrap_err();
        assert_eq!(err, ContentError::DuplicateNeedDecay { need: "hunger".into() });
    }

    #[test]
    fn rejects_duplicate_object_ids() {
        let mut objects = one_object(snack());
        objects.object.push(ObjectDef {
            id: "fridge".into(),
            name: "Another".into(),
            interaction: vec![],
        });
        let err = compile(full_needs(), objects).unwrap_err();
        assert_eq!(err, ContentError::DuplicateObjectId { id: "fridge".into() });
    }

    #[test]
    fn rejects_duplicate_interaction_ids_within_one_object() {
        let mut objects = one_object(snack());
        objects.object[0].interaction.push(snack());
        let err = compile(full_needs(), objects).unwrap_err();
        assert_eq!(
            err,
            ContentError::DuplicateInteractionId {
                object: "fridge".into(),
                id: "grab_snack".into()
            }
        );
    }

    #[test]
    fn allows_the_same_interaction_id_on_different_objects() {
        let mut objects = one_object(snack());
        objects.object.push(ObjectDef {
            id: "vending".into(),
            name: "Vending".into(),
            interaction: vec![snack()],
        });
        compile(full_needs(), objects).expect("ids are scoped to their object");
    }

    #[test]
    fn rejects_zero_duration() {
        let mut act = snack();
        act.duration_ticks = 0;
        let err = compile(full_needs(), one_object(act)).unwrap_err();
        assert_eq!(
            err,
            ContentError::ZeroDuration {
                object: "fridge".into(),
                interaction: "grab_snack".into()
            }
        );
    }

    #[test]
    fn rejects_zero_slots() {
        let mut act = snack();
        act.slots = 0;
        let err = compile(full_needs(), one_object(act)).unwrap_err();
        assert_eq!(
            err,
            ContentError::ZeroSlots {
                object: "fridge".into(),
                interaction: "grab_snack".into()
            }
        );
    }

    #[test]
    fn rejects_non_finite_and_negative_numbers() {
        let mut act = snack();
        act.advertises.insert("hunger".into(), f32::NAN);
        assert!(matches!(
            compile(full_needs(), one_object(act)).unwrap_err(),
            ContentError::NonFiniteValue { .. }
        ));

        let mut needs = full_needs();
        needs.need[0].decay_per_tick = -1.0;
        assert!(matches!(
            compile(needs, one_object(snack())).unwrap_err(),
            ContentError::NegativeValue { .. }
        ));
    }

    #[test]
    fn advertises_are_sorted_by_need_index() {
        // The pack is serialised and hashed downstream, so a
        // nondeterministic order would surface as a spurious content
        // diff rather than as an obvious bug.
        let mut act = snack();
        act.advertises.insert("comfort".into(), 5.0);
        act.advertises.insert("energy".into(), 3.0);
        let pack = compile(full_needs(), one_object(act)).expect("valid");
        let indices: Vec<u8> =
            pack.objects[0].interactions[0].advertises.iter().map(|(i, _)| *i).collect();
        let mut sorted = indices.clone();
        sorted.sort_unstable();
        assert_eq!(indices, sorted);
        assert_eq!(indices.len(), 3);
    }
}
```

- [ ] **Step 3: Run and verify the failure**

Run: `cargo test -p terri-data compile`
Expected: compile error naming `compile`. Not `0 tests`.

- [ ] **Step 4: Implement**

Above the `tests` module in `src/compile.rs`:

```rust
use crate::error::ContentError;
use crate::pack::{CompiledInteraction, CompiledObject, ContentPack, ObjectDefId};
use crate::schema::{NeedsFile, ObjectsFile};
use std::collections::BTreeSet;
use terri_core::{NeedId, NEED_COUNT};

fn check_number(value: f32, context: &str) -> Result<(), ContentError> {
    if !value.is_finite() {
        return Err(ContentError::NonFiniteValue { context: context.to_string() });
    }
    if value < 0.0 {
        return Err(ContentError::NegativeValue { context: context.to_string() });
    }
    Ok(())
}

/// Validates content and compiles it to a pack. Every failure mode here
/// is a build failure by design: a broken pack must not be constructible,
/// so it can never reach runtime. See [D9].
pub fn compile(needs: NeedsFile, objects: ObjectsFile) -> Result<ContentPack, ContentError> {
    let mut decay = [f32::NAN; NEED_COUNT];
    let mut seen_needs = BTreeSet::new();

    for def in &needs.need {
        let Some(id) = NeedId::from_name(&def.id) else {
            return Err(ContentError::UnknownNeedDecay { need: def.id.clone() });
        };
        if !seen_needs.insert(id) {
            return Err(ContentError::DuplicateNeedDecay { need: def.id.clone() });
        }
        check_number(def.decay_per_tick, &format!("decay_per_tick for '{}'", def.id))?;
        decay[id.index()] = def.decay_per_tick;
    }

    for id in NeedId::ALL {
        if !seen_needs.contains(&id) {
            return Err(ContentError::MissingNeedDecay { need: id.as_str().to_string() });
        }
    }

    let mut seen_objects = BTreeSet::new();
    let mut compiled = Vec::with_capacity(objects.object.len());

    for object in &objects.object {
        if !seen_objects.insert(object.id.clone()) {
            return Err(ContentError::DuplicateObjectId { id: object.id.clone() });
        }

        let mut seen_interactions = BTreeSet::new();
        let mut interactions = Vec::with_capacity(object.interaction.len());

        for act in &object.interaction {
            if !seen_interactions.insert(act.id.clone()) {
                return Err(ContentError::DuplicateInteractionId {
                    object: object.id.clone(),
                    id: act.id.clone(),
                });
            }
            if act.duration_ticks == 0 {
                return Err(ContentError::ZeroDuration {
                    object: object.id.clone(),
                    interaction: act.id.clone(),
                });
            }
            if act.slots == 0 {
                return Err(ContentError::ZeroSlots {
                    object: object.id.clone(),
                    interaction: act.id.clone(),
                });
            }

            let mut advertises = Vec::with_capacity(act.advertises.len());
            for (need_name, delta) in &act.advertises {
                let Some(id) = NeedId::from_name(need_name) else {
                    return Err(ContentError::UnknownNeed {
                        object: object.id.clone(),
                        interaction: act.id.clone(),
                        need: need_name.clone(),
                    });
                };
                check_number(
                    *delta,
                    &format!("advert '{}' on '{}'", need_name, act.id),
                )?;
                advertises.push((id.index() as u8, *delta));
            }
            // BTreeMap iterates by name; the pack is keyed by index, so
            // sort explicitly rather than relying on the two agreeing.
            advertises.sort_unstable_by_key(|(i, _)| *i);

            interactions.push(CompiledInteraction {
                id: act.id.clone(),
                advertises,
                duration_ticks: act.duration_ticks,
                slots: act.slots,
            });
        }

        compiled.push(CompiledObject {
            id: object.id.clone(),
            name: object.name.clone(),
            interactions,
        });
    }

    Ok(ContentPack { decay_per_tick: decay, objects: compiled })
}
```

Note the `ObjectDefId` import is used by the tests; keep it.

- [ ] **Step 5: Verify**

Run: `cargo test -p terri-data`
Expected: 15 passed (3 schema plus 12 compile).

- [ ] **Step 6: Mutation-verify two validation rules**

Rules that silently pass are the whole risk here. Apply, confirm, restore, hash-check:

1. Delete the `for id in NeedId::ALL` completeness loop. Expect `rejects_a_missing_need_decay` to fail.
2. Delete the `advertises.sort_unstable_by_key` line. Expect `advertises_are_sorted_by_need_index` to fail. **If it does not, the test is passing on an accidental ordering** - say so and strengthen it rather than moving on.

- [ ] **Step 7: Commit**

```bash
git add crates/terri-data && git commit -m "Add content validation and pack compilation

Every validation rule has a failing-case test as well as a passing one.
A validator tested only on valid input is the shape the testing protocol
exists to prevent, and this one is the [D9] guarantee: a broken pack must
not be constructible.

Advert lists are sorted by need index explicitly rather than relying on
the BTreeMap's name ordering to coincide, because the pack is serialised
downstream and a nondeterministic order would read as a content diff."
```

---

### Task 5: `build.rs` and pack embedding

**Files:**
- Create: `crates/terri-data/build.rs`, `content/needs.toml`, `content/objects.toml`
- Modify: `crates/terri-data/src/lib.rs`

**Interfaces:**
- Consumes: Task 4's `compile`
- Produces: `terri_data::pack() -> &'static ContentPack`

- [ ] **Step 1: Write the content files**

`content/needs.toml`. Hunger keeps M0's rate; the rest are first guesses to be balanced in M1b.

```toml
# Need decay per tick. One tick is one sim-minute, so 0.104 drains a
# full need in roughly 16 sim-hours.
#
# Every NeedId variant must appear exactly once. A missing or unknown
# entry fails the build.

[[need]]
id = "hunger"
decay_per_tick = 0.104

[[need]]
id = "energy"
decay_per_tick = 0.069

[[need]]
id = "hygiene"
decay_per_tick = 0.052

[[need]]
id = "bladder"
decay_per_tick = 0.139

[[need]]
id = "social"
decay_per_tick = 0.035

[[need]]
id = "fun"
decay_per_tick = 0.042

[[need]]
id = "comfort"
decay_per_tick = 0.028
```

`content/objects.toml`:

```toml
# Smart objects. Each interaction advertises what it satisfies; agents
# score those adverts against their own deficits. Adding an object here
# is all it takes for agents to start using it.

[[object]]
id = "fridge"
name = "Chill-o-Matic 3000"

  [[object.interaction]]
  id = "grab_snack"
  advertises = { hunger = 40.0 }
  duration_ticks = 15
  slots = 1
```

The delta is 40.0 and the duration 15 to match M0's hardcoded values exactly, so this task changes no behaviour.

- [ ] **Step 2: Write `build.rs`**

```rust
//! Compiles content/*.toml into a postcard pack in OUT_DIR.
//!
//! Validation failures abort the build on purpose. A broken pack must not
//! be constructible, so it can never reach runtime. See [D9].

use std::path::PathBuf;
use std::{env, fs};

#[path = "src/compile.rs"]
mod compile;
#[path = "src/error.rs"]
mod error;
#[path = "src/pack.rs"]
mod pack;
#[path = "src/schema.rs"]
mod schema;

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("..")
        .join("..")
        .join("content");

    let needs_path = root.join("needs.toml");
    let objects_path = root.join("objects.toml");

    // Without these, editing content does not trigger a rebuild and you
    // silently run the previous pack.
    println!("cargo:rerun-if-changed={}", needs_path.display());
    println!("cargo:rerun-if-changed={}", objects_path.display());

    let needs_src = fs::read_to_string(&needs_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", needs_path.display()));
    let objects_src = fs::read_to_string(&objects_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", objects_path.display()));

    let needs: schema::NeedsFile = toml::from_str(&needs_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", needs_path.display()));
    let objects: schema::ObjectsFile = toml::from_str(&objects_src)
        .unwrap_or_else(|e| panic!("{} is not valid TOML: {e}", objects_path.display()));

    let pack = compile::compile(needs, objects)
        .unwrap_or_else(|e| panic!("content is invalid: {e}"));

    let bytes = postcard::to_allocvec(&pack).expect("pack serialises");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("content_pack.postcard");
    fs::write(&out, bytes).expect("write pack");
}
```

The `#[path]` module includes are how `build.rs` reuses the same validation code the library and its tests use, rather than a second copy that could drift.

- [ ] **Step 3: Write the failing accessor test**

In `crates/terri-data/src/lib.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_embedded_pack_deserialises_and_holds_the_fridge() {
        let p = pack();
        let id = p.find("fridge").expect("content/objects.toml declares a fridge");
        let fridge = p.object(id);
        assert_eq!(fridge.interactions.len(), 1);
        let act = &fridge.interactions[0];
        assert_eq!(act.id, "grab_snack");
        assert_eq!(act.duration_ticks, 15);
        assert_eq!(act.advertises, vec![(terri_core::NeedId::Hunger.index() as u8, 40.0)]);
    }

    #[test]
    fn every_need_has_a_finite_decay_rate() {
        // compile() fills this array from content and leaves NaN where a
        // rate is missing, so a NaN here means validation was bypassed.
        for id in terri_core::NeedId::ALL {
            let rate = pack().decay_per_tick[id.index()];
            assert!(rate.is_finite(), "{} has no decay rate", id.as_str());
        }
    }

    #[test]
    fn the_pack_is_the_same_instance_every_call() {
        assert!(std::ptr::eq(pack(), pack()), "pack must be deserialised once");
    }
}
```

- [ ] **Step 4: Run and verify the failure**

Run: `cargo test -p terri-data`
Expected: compile error naming `pack`.

- [ ] **Step 5: Implement the accessor**

Above the tests in `src/lib.rs`:

```rust
//! Content schema, validation, and the compiled pack.
//!
//! No web dependencies, ever.

pub mod compile;
pub mod error;
pub mod pack;
pub mod schema;

pub use error::ContentError;
pub use pack::{CompiledInteraction, CompiledObject, ContentPack, ObjectDefId};

use std::sync::OnceLock;

static PACK_BYTES: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/content_pack.postcard"));

/// The compiled content pack, deserialised once on first use.
///
/// Cannot fail at runtime: build.rs aborts the build on invalid content,
/// and the bytes are embedded from that same build.
pub fn pack() -> &'static ContentPack {
    static PACK: OnceLock<ContentPack> = OnceLock::new();
    PACK.get_or_init(|| {
        postcard::from_bytes(PACK_BYTES).expect("embedded pack was written by build.rs")
    })
}
```

- [ ] **Step 6: Verify, including that bad content really does fail the build**

Run: `cargo test -p terri-data`
Expected: 18 passed.

Then prove the build gate works rather than assuming it. Temporarily change `advertises = { hunger = 40.0 }` in `content/objects.toml` to `{ vibes = 40.0 }` and run `cargo build -p terri-data`. Expect a build failure reading `content is invalid: object 'fridge' interaction 'grab_snack' advertises unknown need 'vibes'`. Restore the file, rebuild, and paste both outputs.

Also confirm the rerun trigger: touch `content/objects.toml` and check `cargo build -p terri-data` recompiles rather than reporting Fresh.

- [ ] **Step 7: Commit**

```bash
git add content crates/terri-data && git commit -m "Compile content to an embedded pack at build time

build.rs validates content/*.toml and writes a postcard pack to OUT_DIR,
embedded with include_bytes. Invalid content aborts the build, so a
broken pack cannot reach runtime, which is the [D9] guarantee.

build.rs includes the same compile.rs the library and its tests use via
#[path] rather than keeping a second copy that could drift.

The fridge's numbers match M0's hardcoded values exactly, so this
changes no behaviour."
```

---

### Task 6: `SmartObject` becomes an id, systems read the pack

**Files:**
- Modify: `crates/terri-core/src/components.rs`, `crates/terri-sim/src/lib.rs`, `src/systems/action.rs`, `src/systems/advertise.rs`, `src/systems/interact.rs`, `crates/terri-sim/Cargo.toml`, `crates/terri-wasm/src/lib.rs`

**Interfaces:**
- Consumes: `terri_data::pack()`, `ObjectDefId` (from `terri-core`, Task 1), `CompiledInteraction`
- Produces: `SmartObject(pub ObjectDefId)`; `Content(pub &'static ContentPack)` as a `bevy_ecs` `Resource`; `select_action` and `tick_interactions` resolve adverts through the pack

> **This task is specified at a higher level than the others in this plan.**
> It is a refactor across five files whose exact shape depends on code you
> should read first, so the steps below give the design decisions and the
> non-obvious constraints rather than complete replacement code. **Read
> `systems/action.rs`, `systems/interact.rs`, and `systems/advertise.rs`
> in full before editing.** If anything below turns out to conflict with
> what is actually there, report it rather than guessing - a wrong guess
> here silently weakens the tie-break tests.

- [ ] **Step 1: Add the dependency, the component, and the resource**

Add `terri-data = { path = "../terri-data" }` to `crates/terri-sim/Cargo.toml`.

In `components.rs`, replace `SmartObject`:

```rust
/// A placed object. The advertised interactions live in the content
/// pack, not here, which is what lets an advert be a variable-length
/// list of need deltas rather than one named field.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct SmartObject(pub ObjectDefId);
```

`ObjectDefId` already lives in `terri-core` from Task 1, so no dependency is added to the lowest layer.

In `crates/terri-sim/src/lib.rs`, add the resource and insert it in `Sim::new`:

```rust
/// The content pack, as a resource so systems can resolve object ids.
/// Holds a &'static because the pack is embedded and deserialised once.
#[derive(Resource, Debug, Clone, Copy)]
pub struct Content(pub &'static terri_data::ContentPack);
```

```rust
world.insert_resource(Content(terri_data::pack()));
```

Also register `SmartObject` as before; the component list in `Sim::new` is unchanged in membership.

- [ ] **Step 2: Update `select_action` to score pack adverts**

`select_action` gains `pack: Res<Content>`, the resource added in Step 1. The scoring loop changes from one `hunger_delta` to a sum over advertised deltas:

```rust
let mut score = 0.0;
for (need_index, delta) in &advert.advertises {
    let id = NeedId::ALL[*need_index as usize];
    score += score_advertisement(
        needs.deficit(id),
        *delta,
        advert.duration_ticks,
        distance,
    );
}
```

**Summing per-need scores is a design decision, not a mechanical port.** An object satisfying two needs a little should be able to beat one satisfying a single need slightly better. Add a test pinning that: a two-need object with modest deltas must outscore a one-need object with a larger single delta, given equal deficits and distance.

- [ ] **Step 3: Update `tick_interactions` to fill every advertised need**

`Eating` currently holds one `delta_per_tick`. It becomes the interaction reference plus remaining ticks, and the system fills each advertised need by `delta / duration_ticks`.

- [ ] **Step 4: Migrate the tests in these three files**

Same discipline as Task 2: preserve the mechanism, not just the compile. The tie-break tests construct `SmartObject` literals with identical adverts; they now construct entities pointing at content-pack objects. **You will need test-only content**, since `content/objects.toml` has one object and several tests need two or three with controlled adverts. Add a `#[cfg(test)]` constructor on `ContentPack` that builds one in memory rather than adding test fixtures to shipped content.

- [ ] **Step 5: Verify the full gate and the mutation sweep**

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all -- --check`

Then the sweep, comparing to the committed baseline exactly as in Task 2 Step 6. Report any new survivors. Line numbers will have moved substantially; report stale baseline entries too but do not edit the baseline.

- [ ] **Step 6: Commit**

```bash
git add crates && git commit -m "Make SmartObject an index into the content pack

The component stops naming needs, so an advert becomes a variable-length
list of need deltas rather than one hunger_delta field. Scoring sums the
per-need scores, so an object satisfying two needs modestly can beat one
satisfying a single need slightly better; that is pinned by a test rather
than left implicit.

ObjectDefId lives in terri-core rather than terri-data so the lowest
layer does not gain a dependency on the content crate."
```

---

### Task 7: Content-driven decay

**Files:**
- Modify: `crates/terri-sim/src/systems/needs.rs`

**Interfaces:**
- Consumes: `Content` resource from Task 6
- Produces: `decay_needs` drains all seven needs at content rates

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn every_need_decays_at_its_content_rate() {
    let mut sim = Sim::new();
    let id = sim.world_mut().spawn((Agent, Needs::all_at(100.0))).id();

    for _ in 0..100 {
        sim.tick();
    }

    let needs = *sim.world().get::<Needs>(id).unwrap();
    let rates = terri_data::pack().decay_per_tick;
    for need in NeedId::ALL {
        let expected = 100.0 - rates[need.index()] * 100.0;
        assert!(
            (needs.get(need) - expected).abs() < 0.001,
            "{} expected ~{expected}, got {}",
            need.as_str(),
            needs.get(need)
        );
    }
}

#[test]
fn needs_decay_at_different_rates() {
    // A single shared rate would satisfy the test above only if every
    // content rate happened to be equal, so pin that they are not.
    let rates = terri_data::pack().decay_per_tick;
    let first = rates[0];
    assert!(
        rates.iter().any(|r| *r != first),
        "content declares one rate for every need; this test proves nothing"
    );
}
```

- [ ] **Step 2: Run, verify failure, implement, verify pass**

Run: `cargo test -p terri-sim decay`
Expected first: a compile error or a failure naming a need other than hunger.

Implementation replaces the `HUNGER_DECAY_PER_TICK` constant with a loop over `NeedId::ALL` reading `pack.decay_per_tick`.

Expected after: pass.

- [ ] **Step 3: Commit**

```bash
git add crates && git commit -m "Drive need decay from content rates

Removes the hardcoded HUNGER_DECAY_PER_TICK. All seven needs now decay
at rates declared in content/needs.toml.

The second test exists because the first would pass for a single shared
rate applied to every need; it asserts the content actually declares
different ones."
```

---

### Task 8: Spawn by content id across the boundary

**Files:**
- Modify: `crates/terri-wasm/src/lib.rs`, `web/src/main.ts`, `web/src/bridge.ts`, `web/tests/bridge.test.ts`

**Interfaces:**
- Produces: `SimHandle::spawn_object(x, y, content_id: &str) -> bool`, returning false for an unknown id

- [ ] **Step 1: Write the failing Rust test**

```rust
#[test]
fn spawning_an_unknown_content_id_is_rejected_rather_than_panicking() {
    let mut sim = SimHandle::new(16, 16);
    assert!(sim.spawn_object(4.0, 5.0, "fridge"));
    assert!(!sim.spawn_object(4.0, 6.0, "no_such_object"));
    assert_eq!(sim.entity_count(), 1);
}
```

An unknown id must not panic: it arrives from JavaScript, which is the boundary where inputs are hostile, per `docs/testing-protocol.md` rule 8.

- [ ] **Step 2: Implement, verify, and update the TypeScript side**

`spawn_object` resolves through `pack().find(content_id)` and returns `false` on `None`. `SimBridge.spawnObject` gains the id parameter; `main.ts` passes `"fridge"`.

- [ ] **Step 3: Rebuild WASM and verify the web suite**

```bash
wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm
cd web && npm run typecheck && npm test
```

Rebuilding first is not optional; skipping it tests the previous artifact ([L8]).

- [ ] **Step 4: Commit**

---

### Task 9: Re-sweep, update the baseline, and update the docs

**Files:**
- Modify: `docs/mutants-baseline.txt`, `docs/mutation-baseline.md`, `docs/FEATURES.md`, `docs/ARCHITECTURE.md`

- [ ] **Step 1: Run the full sweep**

```bash
cargo mutants --package terri-core --package terri-sim --package terri-data --test-workspace true --timeout 60
```

Note `terri-data` is now in scope. Expect the total to rise.

- [ ] **Step 2: Triage every survivor**

For each survivor not in the old baseline, decide: kill it with a test, or record it as accepted debt **with a written argument** in `docs/mutation-baseline.md`. Adding a baseline entry without an argument is what turns the file into a permission slip.

Pay particular attention to survivors in code that Task 2 or Task 6 migrated. Those are the ones most likely to indicate a test that lost its teeth in the port.

- [ ] **Step 3: Regenerate the baseline and update the docs**

```bash
sort mutants.out/missed.txt > docs/mutants-baseline.txt
```

Update `docs/mutation-baseline.md` with the new totals and what changed. In `docs/FEATURES.md`, mark M0 complete and record M1a. In `docs/ARCHITECTURE.md`, update [D6] and [D9] to describe what now exists rather than what is planned.

- [ ] **Step 4: Full gate, then commit**

---

## Definition of done

- [ ] `content/objects.toml` defines the fridge; no component field names a need
- [ ] `cargo build` fails with a clear message on each of the validation rules, demonstrated for at least one
- [ ] All seven needs decay at content-declared rates
- [ ] A hungry sim still paths to the fridge and eats; behaviour is unchanged
- [ ] `cargo test --workspace`, clippy, fmt, and the web suite all pass
- [ ] **The mutation survivor set has not grown** except where each addition carries a written argument
- [ ] Golden world-hash vectors updated, with the wasm32 value **observed** rather than assumed equal to native

## Out of scope

Hot reload (M1e); traits, careers, and moodlets as content (M1b); any new need *behaviour* beyond decay (M1b); build and buy mode (M1e).
