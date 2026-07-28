# M1b Playable Alpha Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the game's feel judgeable - five competing needs, eight objects, need bars, time controls, and click-to-direct - without buying that speed with architecture we would have to undo.

**Architecture:** Player input crosses the WASM boundary as serialised commands drained at a fixed point in the tick, never as direct state mutation. Selection lives in the simulation. Picking inverts the isometric projection to a tile rather than hit-testing rendered quads. The DOM renders simulation state and sends commands; it owns nothing.

**Tech Stack:** Rust 1.94.1 (pinned), `bevy_ecs` 0.18.1, `serde`, `postcard`, TypeScript, WebGPU.

**Design doc:** `docs/specs/2026-07-28-m1b-playable-alpha-design.md`. Read it; this plan implements it and does not restate its reasoning.

## Global Constraints

- **No em-dashes anywhere.** Code, comments, strings, TOML, docs, commit messages. Spaced hyphens ( - ) or semicolons only. Hard project rule.
- **`terri-core`, `terri-sim`, and `terri-data` must contain zero `wasm-bindgen` and zero `web-sys`**, on host and `wasm32-unknown-unknown`. Only `terri-wasm` may reference JavaScript. Verify with explicit `--target` flags; a bare `cargo tree` misleads ([L4]).
- **Read `docs/testing-protocol.md` before writing any test.** Mutation-test every load-bearing invariant and report actual failure output. Prefer causal assertions. Any test that can pass on empty input needs an assertion that the input was not empty.
- **JavaScript never mutates simulation state.** Every player action is a serialised command. This is [D-2] and it is the milestone's reason for existing in this shape.
- **Speed control runs more ticks; it never changes `dt`** ([D2]).
- **Declare `pub mod foo;` in the same step that creates `foo.rs`** ([L2]). Read test counts, not exit status.
- **Never restore with `git checkout <path>`** ([L9]); snapshot on the **full repo-relative path** ([L22]); touch after restoring ([L8]). A mutation that fails to **compile** is inconclusive ([L21]).
- **Rebuild the WASM package before running the web suite** ([L8]): `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`.
- Rust edition 2021. CI gates on clippy `-D warnings`, `cargo fmt --check`, `npm run typecheck`, `npm test`, and the mutation baseline diff.
- Commit messages: imperative summary, why-body. **No AI or Claude attribution, no co-authored-by trailers.**
- Baseline at branch start: **98 Rust tests, 58 web tests.** Golden world hash `0x2FC6_69EF_A725_4F2D`.

## File Structure

```
content/
  objects.toml          eight objects, several advertising multiple needs
  lot.toml              hand-authored lot: size, walls, object placements   (new)
crates/
  terri-core/src/
    command.rs          SimCommand enum, the serialisable player input      (new)
    components.rs       Selected marker, IntentQueue
  terri-data/src/
    schema.rs           LotFile, WallDef, PlacementDef
  terri-sim/src/
    systems/command.rs  drains the command queue at a fixed tick step       (new)
    systems/action.rs   select_action skips agents with a non-empty queue
web/src/
  input.rs -> input.ts  pointer to tile, dispatches commands                (new)
  ui/needs-panel.ts     need bars, read-only                                (new)
  ui/time-controls.ts   pause and speed, read-only plus commands            (new)
  render/iso.ts         screenToWorld, the inverse projection
```

---

### Task 1: `SimCommand` and the command queue

The foundation of [D-2]. Pure addition; nothing consumes it yet.

**Files:**
- Create: `crates/terri-core/src/command.rs`
- Modify: `crates/terri-core/src/lib.rs`

**Interfaces:**
- Produces: `enum SimCommand { Select(Option<u32>), UseObject { agent: u32, object: u32 }, CancelIntents { agent: u32 }, SetSpeed(u8) }` deriving `Serialize`/`Deserialize`/`PartialEq`/`Debug`/`Clone`; `struct CommandQueue(Vec<SimCommand>)` as a `Resource` with `push`, `drain`, `len`, `is_empty`

Entity references cross the boundary as raw `u32` indices, not `Entity`, because JavaScript cannot construct an `Entity` and a generation would be meaningless to it. Resolution back to a live `Entity` happens in Task 5 and must handle a stale index.

- [ ] **Step 1: Create the file with its module declaration and failing tests**

Add `pub mod command;` to `lib.rs` in this same step.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_round_trip_through_postcard() {
        // Commands are the wire format for the save-file command log and,
        // later, for multiplayer. A silent encoding change would break a
        // replay long after the commit that caused it.
        let cases = vec![
            SimCommand::Select(Some(7)),
            SimCommand::Select(None),
            SimCommand::UseObject { agent: 3, object: 9 },
            SimCommand::CancelIntents { agent: 3 },
            SimCommand::SetSpeed(2),
        ];
        for cmd in cases {
            let bytes = postcard::to_allocvec(&cmd).expect("serialises");
            let back: SimCommand = postcard::from_bytes(&bytes).expect("deserialises");
            assert_eq!(back, cmd, "round trip changed {cmd:?}");
        }
    }

    #[test]
    fn the_queue_drains_in_order_and_empties() {
        // Order is load-bearing: two commands in one tick must apply in
        // the order the player issued them, or replay diverges.
        let mut q = CommandQueue::default();
        q.push(SimCommand::Select(Some(1)));
        q.push(SimCommand::SetSpeed(3));
        assert_eq!(q.len(), 2);

        let drained: Vec<_> = q.drain().collect();
        assert_eq!(
            drained,
            vec![SimCommand::Select(Some(1)), SimCommand::SetSpeed(3)]
        );
        assert!(q.is_empty(), "drain must leave the queue empty");
    }
}
```

- [ ] **Step 2: Run and verify the failure**

Run: `cargo test -p terri-core command`
Expected: `E0433` naming `SimCommand`. Not `0 tests`.

- [ ] **Step 3: Implement**

```rust
use bevy_ecs::prelude::Resource;
use serde::{Deserialize, Serialize};

/// One player action, as data.
///
/// This type is the whole anti-corner requirement of M1b. JavaScript
/// never mutates simulation state; it enqueues one of these, and the
/// simulation drains them at a fixed point in the tick. That is what
/// keeps determinism ([A5]), gives [D8]'s save model something to log,
/// and leaves Layer 2 multiplayer possible - the thing you would send
/// over a wire is exactly this.
///
/// Entities cross as raw u32 indices because JavaScript cannot build an
/// Entity. Resolution back to a live Entity must tolerate a stale index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SimCommand {
    /// Select an agent, or clear the selection with None.
    Select(Option<u32>),
    /// Direct an agent to use an object, overriding autonomy.
    UseObject { agent: u32, object: u32 },
    /// Clear an agent's queued intents, returning it to autonomy.
    CancelIntents { agent: u32 },
    /// Ticks per frame. 0 is paused. Never changes dt; see [D2].
    SetSpeed(u8),
}

/// Commands awaiting the next drain point. Ordered, because two commands
/// issued in one tick must apply in the order the player issued them.
#[derive(Resource, Debug, Default)]
pub struct CommandQueue(Vec<SimCommand>);

impl CommandQueue {
    pub fn push(&mut self, cmd: SimCommand) {
        self.0.push(cmd);
    }

    pub fn drain(&mut self) -> std::vec::Drain<'_, SimCommand> {
        self.0.drain(..)
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}
```

`terri-core` needs `postcard` as a dev-dependency for the round-trip test.

- [ ] **Step 4: Verify**

Run: `cargo test -p terri-core`
Expected: 100 passed (98 baseline plus 2).

- [ ] **Step 5: Mutation-verify both invariants**

1. Make `drain` return the commands without clearing (collect and clone rather than `Vec::drain`). Expect `the_queue_drains_in_order_and_empties` to fail on the `is_empty` assertion.
2. Reverse the order in `drain`. Expect the same test to fail on the order assertion.

Both compile, so both are conclusive ([L21]). Report the actual output.

- [ ] **Step 6: Commit**

```bash
git add crates/terri-core Cargo.toml Cargo.lock && git commit -m "Add SimCommand and the command queue

Player input becomes serialisable data rather than direct state
mutation. That is what keeps the simulation deterministic, gives the
save model's command log something to record, and leaves multiplayer
possible, since the thing sent over a wire is exactly this type.

Entities cross as raw u32 indices because JavaScript cannot construct an
Entity; resolving one back to a live entity has to tolerate a stale
index, which the drain system handles."
```

---

### Task 2: `screenToWorld`, the inverse projection

**Files:**
- Modify: `web/src/render/iso.ts`, `web/tests/iso.test.ts`

**Interfaces:**
- Produces: `screenToWorld(sx: number, sy: number, originX: number, originY: number): [number, number]`

- [ ] **Step 1: Write the failing tests**

```ts
describe('screenToWorld', () => {
  it('is the exact inverse of worldToScreen', () => {
    // A sign error here produces picking that is subtly off rather than
    // obviously broken, which is the kind that survives manual testing.
    for (const [wx, wy] of [[0, 0], [1, 0], [0, 1], [5, 3], [12, 10], [15, 15]]) {
      const [sx, sy] = worldToScreen(wx, wy, 640, 60);
      const [bx, by] = screenToWorld(sx, sy, 640, 60);
      expect(bx).toBeCloseTo(wx, 6);
      expect(by).toBeCloseTo(wy, 6);
    }
  });

  it('maps the two screen axes to different world axes', () => {
    // Both formulas use both inputs, so a copy-paste error that made
    // them identical would still round-trip the origin.
    const [ax, ay] = screenToWorld(64, 0, 0, 0);
    expect(ax).not.toBeCloseTo(ay, 3);
  });

  it('ignores the origin offset consistently with worldToScreen', () => {
    const [sx, sy] = worldToScreen(4, 7, 300, 200);
    const [wx, wy] = screenToWorld(sx, sy, 300, 200);
    expect(wx).toBeCloseTo(4, 6);
    expect(wy).toBeCloseTo(7, 6);
  });
});
```

- [ ] **Step 2: Run, verify failure, implement**

```ts
/**
 * Screen pixels back to world tile coordinates. The exact inverse of
 * worldToScreen.
 *
 * Picking inverts the projection rather than hit-testing rendered quads,
 * deliberately. Quad-space picking couples input to the renderer's
 * current sprite size, so changing the art would silently break input.
 */
export function screenToWorld(
  sx: number,
  sy: number,
  originX: number,
  originY: number,
): [number, number] {
  const x = sx - originX;
  const y = sy - originY;
  return [
    (x / TILE_HALF_WIDTH + y / TILE_HALF_HEIGHT) / 2,
    (y / TILE_HALF_HEIGHT - x / TILE_HALF_WIDTH) / 2,
  ];
}
```

- [ ] **Step 3: Verify and mutation-check**

Run: `cd web && npm test`
Expected: 61 passed (58 plus 3).

Mutation: swap the `+` and `-` between the two returned expressions. Expect the round-trip test to fail. Restore and confirm.

- [ ] **Step 4: Commit**

---

### Task 3: Lot content - walls and placements

**Files:**
- Create: `content/lot.toml`
- Modify: `crates/terri-data/src/schema.rs`, `src/compile.rs`, `src/pack.rs`, `build.rs`, `content/objects.toml`

**Interfaces:**
- Produces: `LotFile { width, height, wall: Vec<WallDef>, place: Vec<PlacementDef> }`; `WallDef { x, y }`; `PlacementDef { object: String, x: f32, y: f32 }`; `ContentPack::lot -> &CompiledLot`

- [ ] **Step 1: Add the eight objects to `content/objects.toml`**

Keep `fridge` exactly as it is. Add bed (energy), shower (hygiene), toilet (bladder), television (fun), sofa (fun and comfort), sink (hygiene), bookshelf (fun). Durations and deltas are yours to choose; make them differ, because M1a found that fixtures sharing one value hide index bugs.

**`sofa` advertising two needs is deliberate** - it is the first place [D6]'s summing across advertised deltas becomes observable rather than merely tested.

- [ ] **Step 2: Reconsider the negative-delta rejection**

M1a's `check_number` rejects negative advertised deltas, which forecloses a shower that costs energy. **Trade-off interactions are part of how this genre feels.** Either allow negative deltas here and let scoring weigh them, or record explicitly in `docs/mutation-baseline.md` why not. If you allow them, `score_advertisement` needs a test for what a negative delta does to a score, since the current nonlinear weighting assumes positive.

- [ ] **Step 3: Add the lot schema with failing validation tests**

Validation rules, each needing a failing case: wall coordinates in bounds; placements in bounds; placements not on a wall; placed object ids exist in the pack.

- [ ] **Step 4: Write `content/lot.toml`, wire it into `build.rs`, verify the build gate**

Demonstrate the gate: place an object outside the lot, confirm `cargo build` fails naming it, restore, paste both outputs.

- [ ] **Step 5: Commit**

---

### Task 3b: Load the lot, and make scoring wall-aware

**Added after Task 3, which found the plan had no task for either.** Both are
prerequisites for Task 8's play session meaning anything.

**Files:**
- Modify: `crates/terri-sim/src/lib.rs`, `src/systems/action.rs`, `crates/terri-wasm/src/lib.rs`, `web/src/main.ts`

**Interfaces:**
- Produces: `Sim::new_from_lot(&CompiledLot) -> Sim`, which sizes the grid, marks walls unwalkable, and spawns the placed objects

**[1] Nothing loads the lot.** `pack().lot` is validated and reachable, but
`main.ts` still hardcodes a 16x16 room containing one fridge. The play session
would be run on the old room, against none of the content Task 3 authored.

This **will move the golden world hash**, because it is a real change to what
gets spawned. Update both sites deliberately, observing the wasm32 value rather
than assuming it matches native ([L13]).

**[2] Scoring measures straight-line distance, and walls now exist.**
`select_action`'s own comment says to revisit this "when walls become common".
A sim will score the shower as one tile away through the bathroom wall, then
walk around to the door - so its ranking disagrees with its own pathing, which
reads as a sim that wants something and then changes its mind.

**Use actual path length**, via the existing A*. At this scale - one agent,
eight objects - pathing every candidate each tick is trivially cheap, and M0's
"far too expensive" reasoning was about a thousand agents and a hundred thousand
objects.

**Why this is not a corner.** [D7] plans room-graph distance for exactly this
problem at scale. Both A* length and room-graph length are **wall-aware**, so
balance tuned against one survives the swap; tuning against Euclidean would not.
The metric is what matters, not the implementation. Say so in a comment so the
next person does not "optimise" it back to a straight line.

Note `find_path` returns `None` for an unreachable object. That must score as
unavailable rather than as free, and it interacts with the known debt that an
unreachable best object currently retries every tick with no runner-up fallback.
A lot with walls is the first configuration where that can actually happen.

- [ ] **Step 1: Write a failing test that a walled-off object loses to a nearer-by-path one**

Two objects advertising the same need with the same delta: one closer in a
straight line but behind a wall, one further in a straight line but directly
reachable. The reachable one must win. Assert the straight-line ordering is the
opposite, as a precondition, or the test proves nothing.

- [ ] **Step 2: Implement `Sim::new_from_lot`, verify, and update both golden vectors**

- [ ] **Step 3: Switch scoring to path length, verify, mutation-check**

Mutation: revert to Euclidean. The Step 1 test must fail.

- [ ] **Step 4: Wire `main.ts` to the lot, look at it in a browser, full gate, commit**

Confirm frames are genuinely produced ([L14]).

---

### Task 4: `Selected` and `IntentQueue`

**Files:**
- Modify: `crates/terri-core/src/components.rs`, `crates/terri-sim/src/lib.rs`, `crates/terri-sim/src/systems/action.rs`

**Interfaces:**
- Produces: `struct Selected` (marker Component); `struct IntentQueue(Vec<Intent>)` with `Intent { object: Entity, interaction: usize }`, plus `push`, `front`, `pop`, `clear`, `is_empty`

- [ ] **Step 1: Write the failing test for autonomy suppression**

```rust
#[test]
fn a_queued_intent_suppresses_autonomy() {
    // Directing a sim must beat autonomy or clicking feels ignored.
    // select_action therefore only runs for agents with an empty queue.
    let mut sim = Sim::new_with_lot(16, 16);
    let fridge = spawn_fridge(&mut sim, 12.0, 10.0);
    let bed = spawn_bed(&mut sim, 2.0, 2.0);
    let agent = spawn_agent_hungry_and_tired(&mut sim, 8.0, 8.0);

    // Autonomy alone would pick the fridge; queue the bed instead.
    sim.world_mut()
        .entity_mut(agent)
        .get_mut::<IntentQueue>()
        .unwrap()
        .push(Intent { object: bed, interaction: 0 });

    sim.tick();

    let target = sim.world().get::<Target>(agent).expect("a target was chosen");
    assert_eq!(target.object, bed, "the queued intent must win over autonomy");
    let _ = fridge;
}
```

- [ ] **Step 2: Run, verify failure, implement**

`select_action` gains `Without<...>` filtering or an explicit empty-queue check. **Preserve the existing sort and tie-break** - those took several review rounds to make non-vacuous.

- [ ] **Step 3: Register the new components in `Sim::new`**

`try_query` returns `None` on any unregistered component and `world_hash` uses it, so a miss is silent ([L3]).

- [ ] **Step 4: Verify, mutation-check the suppression, and run the mutation sweep**

Compare against `docs/mutants-baseline.txt`; report new survivors.

- [ ] **Step 5: Commit**

---

### Task 5: The command drain system

**Files:**
- Create: `crates/terri-sim/src/systems/command.rs`
- Modify: `crates/terri-sim/src/lib.rs`

**Interfaces:**
- Produces: `fn drain_commands(...)`, scheduled **first** in the tick, before `select_action`

- [ ] **Step 1: Write failing tests**

Cover: `Select` adds the marker and removes it from anything previously selected; `Select(None)` clears; `UseObject` pushes an intent; `CancelIntents` empties the queue; **a stale entity index is ignored rather than panicking**; and two commands in one tick apply in order.

The stale-index case is the important one. Indices arrive from JavaScript, which is the boundary where inputs are hostile ([testing-protocol rule 8]), and a panic traps the WASM module permanently - from the player's side, the game freezes.

- [ ] **Step 2: Implement, verify, mutation-check**

Resolve `u32` to `Entity` via the world's entity list, checking the entity is live. Mutation: make resolution `unwrap` instead of skipping. Expect the stale-index test to fail. **Verify in `--release`**, since `debug_assert` is absent from the shipped build ([L12]).

- [ ] **Step 3: Add a replay test - this is the milestone's determinism guarantee**

```rust
#[test]
fn a_recorded_command_sequence_replays_to_the_same_hash() {
    // The point of [D-2]. If this fails, JavaScript is mutating state
    // somewhere it should be enqueueing a command.
    let script = vec![
        (0, SimCommand::Select(Some(1))),
        (5, SimCommand::UseObject { agent: 1, object: 0 }),
        (40, SimCommand::CancelIntents { agent: 1 }),
    ];
    let a = run_scripted(&script, 200);
    let b = run_scripted(&script, 200);
    assert_ne!(a, empty_world_hash(), "the run must not be trivially empty");
    assert_eq!(a, b, "the same command script must replay identically");
}
```

- [ ] **Step 4: Commit**

---

### Task 6: The WASM boundary and the TypeScript bridge

**Files:**
- Modify: `crates/terri-wasm/src/lib.rs`, `web/src/bridge.ts`, `web/tests/bridge.test.ts`

**Interfaces:**
- Produces: `SimHandle::enqueue_command(bytes: &[u8]) -> bool`; `SimBridge.select(id)`, `.useObject(agent, object)`, `.cancelIntents(agent)`, `.setSpeed(n)`; `SimBridge.needsOf(entityIndex): Float32Array`; `SimBridge.selectedIndex(): number | null`

Commands cross as postcard bytes, so the wire format is the same one the save log and multiplayer would use. **Malformed bytes must return false, not panic.**

- [ ] Steps: failing test for malformed input, implement, rebuild WASM, verify the web suite, mutation-check the rejection path in release, commit.

---

### Task 7: Need bars and time controls

**Files:**
- Create: `web/src/ui/needs-panel.ts`, `web/src/ui/time-controls.ts`
- Modify: `web/src/main.ts`, `web/index.html`

**The rule, from [D-5]:** these render simulation state and send commands. They own nothing. The only state either may hold is a throttle timestamp.

- [ ] **Step 1: Need bars**

Seven bars for the selected sim, read from `needsOf` each frame at a throttled rate (60Hz is unnecessary; 10Hz matches the tick). Label each with its need name so a decision can be read against the bars.

- [ ] **Step 2: Time controls**

Pause, 1x, 2x, 3x, each dispatching `SetSpeed`. **The driver multiplies ticks per frame; it never touches `dt`** ([D2]). A test must pin that: at speed 2, twice as many ticks run for the same elapsed time, and the tick duration is unchanged.

- [ ] **Step 3: Verify, and look at it in a real browser**

[L14]: an agent-driven tab does not composite and reports zero frames as a beautiful pass. Confirm frames are genuinely produced and report the count.

- [ ] **Step 4: Commit**

---

### Task 8: Wire input, then play it

**Files:**
- Create: `web/src/input.ts`
- Modify: `web/src/main.ts`

- [ ] **Step 1: Pointer to tile to command**

`screenToWorld` gives a tile; ask the bridge what is on it; dispatch `Select` for an agent or `UseObject` for an object when an agent is selected.

- [ ] **Step 2: Play it and write down what you find**

Run the app and use it for several minutes. **Write observations to `docs/alpha-feel-notes.md`**: does the sim read as having priorities or as erratic? Does it thrash between objects? Does directing it feel responsive? Does anything about the decision-making look wrong in a way the tests would not catch?

**This is the milestone's actual deliverable.** The code is the means; the notes are the point. Be specific and do not flatter it.

- [ ] **Step 3: Full gate, mutation sweep, commit**

---

## Definition of done

- [ ] Five needs drive behaviour; the sim visibly changes priority as they compete
- [ ] Eight objects, all content-authored; the lot including walls is in `content/`
- [ ] Need bars for every need on the selected sim
- [ ] Pause, 1x, 2x, 3x as tick multipliers, pinned by a test
- [ ] Click selects a sim; click directs it to an object
- [ ] **Every player action crosses as a serialised command**, drained at a fixed tick step
- [ ] **A recorded command sequence replays to the same world hash**
- [ ] Full gate passes; no new mutation survivors without a written argument
- [ ] `docs/alpha-feel-notes.md` written from actually playing it

## Out of scope

Build mode, character creation, save/load, moodlets, multiple sims, art.
