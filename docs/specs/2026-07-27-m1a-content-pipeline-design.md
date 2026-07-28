# M1a Content Pipeline - Design

Status: agreed. Section IDs are stable; do not renumber.

## Why this is first in M1

M0 shipped a working simulation with **one** need and **one** smart object, both
hardcoded as Rust literals. [FEATURES.md](../FEATURES.md) M1 wants seven needs,
around forty objects, and fifteen traits. [A10] states the project is a content
engine with a game attached.

Building those against hardcoded types means rewriting them once the pipeline
lands, so the pipeline comes first. It also needs no art and nothing from the
project owner, which the other M1 sub-milestones do.

## [D-1] The actual problem is coupling, not file loading

Reading TOML instead of a Rust literal is roughly a day of work and buys almost
nothing on its own. The blocker is that **`SmartObject` names hunger in a
field**:

```rust
// today
pub struct SmartObject { pub hunger_delta: f32, duration_ticks: u32, slots: u8 }
```

So "content" can currently only mean numbers for the one need that exists. No
TOML schema fixes that; the component has to stop naming needs.

```rust
// after
pub struct SmartObject(pub ObjectDefId);   // an index into the content pack
```

The component becomes a **reference**; advertised interactions live in the
content pack. That is what allows an advert to be a variable-length sparse list
of `(NeedId, delta)` pairs, which is what makes seven needs expressible.

**Consequence:** `select_action` gains a `Res<ContentPack>` and resolves the id
in the hot loop. That is a slice index, and it sits next to an existing spatial
scan and a `sqrt` per candidate, so it should not be measurable. If it ever is,
the fallback is to copy fixed-size advert summaries into the component at spawn.

## [D-2] Needs representation

Chosen: **one component holding a fixed array, indexed by an enum.**

```rust
pub const NEED_COUNT: usize = 7;

#[derive(Component)]
pub struct Needs([f32; NEED_COUNT]);

#[repr(u8)]
pub enum NeedId { Hunger, Energy, Hygiene, Bladder, Social, Fun, Comfort }
```

`Hunger(f32)` is removed. `Needs` keeps the existing `drain`, `fill`, and
`deficit` semantics, each taking a `NeedId`. Clamping to `NEED_MIN..=NEED_MAX`
stays, as does `deficit`'s nonlinear use in scoring.

**All seven are defined now, with decay rates from content, even though only
food advertises in M1a.** Three reasons: it is barely more work than one; it
exercises the generic path immediately rather than leaving a single-need special
case to be discovered at M1b; and it fixes the world-hash shape once instead of
changing it twice.

**Rejected alternatives.** Seven concrete components would be marginally faster
and keep ECS queries precise, but `SmartObject` would grow seven delta fields
and adding a need would touch every system, so content would stay numbers-only
forever. Fully dynamic needs defined in content would need no recompile at all
and would suit modding best, but they surrender compile-time checking and make
the need count variable, which complicates the determinism hash that M0 spent
thirteen tasks establishing. The enum is a one-line edit and is honest that a
new need needs new *behaviour* - decay curves, moodlet thresholds - not just a
table row.

## [D-3] The pipeline

A new crate `terri-data`, already reserved in [D1]'s layout. It holds the
content schema and loader, uses `serde`, and performs no I/O of its own.

A `build.rs` compiles `content/*.toml` into a `postcard`-serialised pack written
to `OUT_DIR` and embedded with `include_bytes!`. **`cargo build` fails on
invalid content**, which is the [D9] guarantee: a broken pack cannot be built,
so it can never reach runtime.

`postcard` rather than `bincode` because it is `no_std`-friendly and compact,
which matters for the wasm payload.

Authoring format. Two files, because needs and objects are validated against
each other and it should be obvious which one declares the vocabulary:

`content/needs.toml` declares the decay rates. The `id` must match a `NeedId`
variant, and **every variant must appear exactly once** - a missing or unknown
entry is a build failure, so the enum and the content cannot drift apart.

```toml
[[need]]
id = "hunger"
decay_per_tick = 0.104

[[need]]
id = "energy"
decay_per_tick = 0.069
```

`content/objects.toml` declares objects and what they advertise:

```toml
[[object]]
id = "fridge"
name = "Chill-o-Matic 3000"

  [[object.interaction]]
  id = "grab_snack"
  advertises = { hunger = 35.0 }
  duration_ticks = 15
  slots = 1
```

`ObjectDefId` is a newtype over the object's index in the pack's object array,
assigned in the file's declaration order. Indices are stable for a given pack
and the pack is fixed at build time, so ids cannot shift under a running
simulation. **They are not stable across content edits**, which is why nothing
persists an `ObjectDefId` - save files, when M1c adds them, must store the
string id and resolve it on load.

### Validation performed at build time

- Every key in `advertises` names a known `NeedId`. **This is the dangling
  reference [D9] exists to catch.**
- `needs.toml` declares every `NeedId` variant exactly once, with no unknown
  ids. This is what stops the enum and the content drifting apart.
- Object ids are unique; interaction ids are unique within their object.
- `duration_ticks >= 1`.
- `slots >= 1`.
- Advertised deltas and decay rates are finite and non-negative.

Each rule needs a failing-case test, not just a passing one. A validator with no
negative tests is the shape `docs/testing-protocol.md` rule 1 exists to prevent.

## [D-4] Migration cost, stated plainly

**The bulk of this milestone is migrating existing tests, not writing the
pipeline.** `systems/action.rs` alone is 711 lines and builds `SmartObject`
literals in at least four places; `render_buffer.rs`, `systems/interact.rs`, and
`lib.rs` do too. Every one changes shape.

The work is mechanical but not small, and it lands on exactly the tests that
were hardest to make non-vacuous: the contention golden test with its induced
archetype churn, the score tie-break pin, and the determinism scenario. Several
took three review rounds to stop being permanently green.

**The risk is a careless migration quietly re-breaking one of them.**
Mitigations, both required:

1. Migrate one file at a time, running the suite between each.
2. **Re-run the full mutation sweep at the end and confirm the survivor set has
   not grown** against `docs/mutants-baseline.txt`. A migration that reintroduces
   a vacuous test shows up there and nowhere else.

The golden world-hash vectors change deliberately, because the hash will cover
seven needs rather than one. Per [L13] and `docs/mutation-baseline.md`, that is
an expected and explained update, and the new values must be observed on both
native and wasm32 rather than assumed to agree.

## [D-5] Out of scope

- **Hot reload.** In a wasm build this means re-fetching content and
  re-initialising without losing simulation state. Worth real money when
  authoring forty objects, worth little when authoring two. Revisit at M1e.
- **Traits, careers, moodlets as content.** M1b, once the needs they modify
  exist and behave.
- **Any new need behaviour.** All seven are defined and decay; only hunger is
  advertised against. Making energy drive sleep is M1b.
- **Build and buy mode**, which is M1e and depends on the art pipeline.

## [D-6] Definition of done

- `content/objects.toml` defines the fridge; no `SmartObject` field names a need.
- `cargo build` fails, with a clear message, on each of the five validation rules.
- All seven needs decay at content-specified rates.
- Existing behaviour is unchanged: a hungry sim still paths to the fridge and eats.
- `cargo test --workspace` and the web suite pass.
- **The mutation survivor set has not grown** against `docs/mutants-baseline.txt`.
- Golden world-hash vectors updated, with the new values observed on native and
  wasm32 rather than assumed equal.
