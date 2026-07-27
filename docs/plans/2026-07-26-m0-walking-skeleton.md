# M0 Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One sim on one lot whose hunger decays, who paths to a fridge, eats, and recovers, rendered isometrically in a browser at 60fps with 1,000 entities on screen.

**Architecture:** A pure Rust simulation core (`terri-core`, `terri-sim`) with zero web dependencies, compiled to `wasm32` behind a single thin `wasm-bindgen` crate (`terri-wasm`). A TypeScript shell reads simulation state as zero-copy typed-array views over WASM linear memory and feeds it directly into an instanced WebGPU draw. The sim runs on a fixed 10 Hz timestep; the renderer interpolates between ticks at display refresh.

**Tech Stack:** Rust (stable), `bevy_ecs` standalone, `wasm-bindgen` + `wasm-pack`, TypeScript, Vite, WebGPU, Vitest.

**Why this milestone exists:** M0's real job is to make the WASM/JS bridge ([R1]) fail early if it is going to fail. Every other milestone rides on that boundary. Task 1 proves the toolchain end to end before a single line of simulation is written.

## Global Constraints

- **No em-dashes anywhere**, including code, comments, strings, and commit messages. Use spaced hyphens ( - ) or semicolons.
- **`terri-core` and `terri-sim` must contain zero `wasm-bindgen` and zero `web-sys`.** They compile natively and run under `cargo test`. This is [D1] and it is the load-bearing rule of the whole architecture. A dependency leak here invalidates the design.
- **Fixed timestep, 10 Hz. One tick advances one sim-minute.** Speed controls run more ticks per frame; they never change `dt`. This is [D2].
- **Single-threaded executor for M0.** Set `ExecutorKind::SingleThreaded` explicitly. Parallelism is [D4]/[A9] and arrives later; keeping it off now makes determinism trivially safe.
- **Zero-copy bridge: no per-entity JavaScript objects, ever.** This is [D11].
- **Determinism test runs in CI from Task 7 onward.** This is [D12].
- **Rust edition 2021. `bevy_ecs` is pinned to 0.18.1**, verified during Task 1. 0.19.0 exists but requires Rust 1.95.0 against the installed 1.94.1, so 0.18.1 is a hard ceiling rather than a preference. All code below was compiled and its assertions run against 0.18.1.
- **Two 0.18 API facts that differ from older bevy_ecs and are easy to get wrong:**
  - `World::iter_entities()` no longer exists. Use `World::query::<D>()` where you hold `&mut World`, or `World::try_query::<D>()` where you only hold `&World`. Both return an owned `QueryState` that must be bound `mut`, then iterated as `state.iter(&world)`. Note `World::entities()` is **not** the replacement; it returns `&Entities` metadata.
  - `Entity::index()` returns `EntityIndex`, not `u32`. `EntityIndex` derives `Ord`, and sorting by it was verified to match sorting by the raw integer, so it is safe for ordering. Use `index_u32() -> u32` only where a literal `u32` is required.
- **Every task ends with a commit.**
- **Declare `pub mod foo;` in the same step that creates `foo.rs`, never in a later step.** Several tasks below are written to create a file containing tests first and wire it into the module tree afterward. **Follow the intent, not that ordering.** Rust does not compile a `.rs` file that no `mod` declaration references, so the intervening "verify it fails" checkpoint would report success with `0 filtered out` - a test that never ran, mistaken for a red. This applies to Tasks 3, 4, and 5, and to `systems/mod.rs` as much as to `lib.rs`.
- **When verifying a red checkpoint, read the test count, not just the exit status.** A genuine red for a missing symbol is a compile error such as `E0433: failed to resolve: use of undeclared type`. `0 passed; 0 failed` is not a red; it is a test that did not run.
- **Bare `cargo` does not link on the development machine.** See [L1] in `docs/lessons-learned.md` for the cause and the `vcvars64.bat` workaround. CI runs on Linux and is unaffected.

## File Structure

```
Cargo.toml                          workspace root
crates/
  terri-core/
    Cargo.toml
    src/lib.rs                      re-exports
    src/clock.rs                    SimClock, fixed timestep
    src/components.rs               Position, Hunger, Agent, SmartObject, ...
    src/grid.rs                     TileGrid, walkability, A*
    src/hash.rs                     deterministic world hash
  terri-sim/
    Cargo.toml
    src/lib.rs                      Sim struct, schedule wiring
    src/render_buffer.rs            struct-of-arrays output for the bridge
    src/systems/mod.rs
    src/systems/needs.rs            decay
    src/systems/advertise.rs        advertisement scoring
    src/systems/action.rs           selection + reservation
    src/systems/movement.rs         path following
    src/systems/interact.rs         interaction execution
  terri-wasm/
    Cargo.toml
    src/lib.rs                      wasm-bindgen boundary ONLY
web/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/main.ts                       entry, fixed-timestep driver
  src/bridge.ts                     typed-array views over WASM memory
  src/render/device.ts              WebGPU init
  src/render/iso.ts                 isometric projection
  src/render/sprites.ts             instanced quad pipeline
  src/render/sprites.wgsl
  src/perf.ts                       frame-time harness
  tests/                            Vitest specs
```

Rust tests live in-crate under `#[cfg(test)]`. TypeScript tests live in `web/tests/`.

---

### Task 1: Workspace scaffold and toolchain smoke test

Proves Rust compiles to WASM, `wasm-pack` works on this machine, and JavaScript can call across the boundary. **Do this before writing any simulation code**, because a broken toolchain discovered at Task 9 costs a week.

**Files:**
- Create: `Cargo.toml`, `crates/terri-core/Cargo.toml`, `crates/terri-core/src/lib.rs`
- Create: `crates/terri-wasm/Cargo.toml`, `crates/terri-wasm/src/lib.rs`
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.ts`
- Test: `web/tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `terri_core::smoke_value() -> u32`; WASM export `smoke_value(): number`

- [ ] **Step 1: Install toolchain prerequisites**

```bash
rustup target add wasm32-unknown-unknown && cargo install wasm-pack
```

Expected: both complete without error. Verify with `wasm-pack --version`.

- [ ] **Step 2: Create the workspace root**

`Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["crates/terri-core", "crates/terri-sim", "crates/terri-wasm"]

[workspace.package]
edition = "2021"
version = "0.1.0"

[workspace.dependencies]
bevy_ecs = "0.18"
wasm-bindgen = "0.2"
```

- [ ] **Step 3: Create `terri-core` with the failing test**

`crates/terri-core/Cargo.toml`:

```toml
[package]
name = "terri-core"
edition.workspace = true
version.workspace = true

[dependencies]
bevy_ecs = { workspace = true }
```

`crates/terri-core/src/lib.rs`:

```rust
//! Pure simulation core. No web dependencies, ever.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_value_is_42() {
        assert_eq!(smoke_value(), 42);
    }
}
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cargo test -p terri-core`
Expected: FAIL, `cannot find function 'smoke_value' in this scope`

- [ ] **Step 5: Implement `smoke_value`**

Add above the `tests` module in `crates/terri-core/src/lib.rs`:

```rust
/// Trivial value used only to prove the Rust -> WASM -> JS path works.
/// Deleted once real state crosses the boundary.
pub fn smoke_value() -> u32 {
    42
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cargo test -p terri-core`
Expected: PASS, `test tests::smoke_value_is_42 ... ok`

- [ ] **Step 7: Create the WASM boundary crate**

`crates/terri-wasm/Cargo.toml`:

```toml
[package]
name = "terri-wasm"
edition.workspace = true
version.workspace = true

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
terri-core = { path = "../terri-core" }
wasm-bindgen = { workspace = true }
```

`crates/terri-wasm/src/lib.rs`:

```rust
//! The ONLY crate that knows JavaScript exists.
//! Nothing in here may contain simulation logic.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn smoke_value() -> u32 {
    terri_core::smoke_value()
}
```

- [ ] **Step 8: Build the WASM package**

Run: `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`
Expected: `[INFO]: :-) Done in ...`, and `web/src/wasm/terri_wasm.js` exists.

- [ ] **Step 9: Create the web project**

`web/package.json`:

```json
{
  "name": "terrilives-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^8.1.5",
    "vitest": "^4.1.10",
    "@types/node": "^24.13.3",
    "@webgpu/types": "^0.1.44"
  }
}
```

Vite 8 and Vitest 4 were adopted immediately after Task 1: Vite 5 pulled `esbuild <=0.24.2` with five audit vulnerabilities, and Vitest 4 is the first line that peers with Vite 8. Post-upgrade audit is clean. `@types/node` is required because the tests import `node:fs`.

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["@webgpu/types"]
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

`vitest/globals` is deliberately absent: globals are not enabled, and tests import `describe`/`it`/`expect` explicitly. `vite.config.ts` is included so it is actually type-checked.

`web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Required for SharedArrayBuffer / WASM threads later. Harmless now.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

`web/index.html`:

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>terrilives</title></head>
  <body>
    <canvas id="stage" width="1280" height="720"></canvas>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 10: Write the failing bridge test**

`web/tests/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import init, { smoke_value } from '../src/wasm/terri_wasm.js';
import { readFileSync } from 'node:fs';

describe('wasm toolchain', () => {
  it('returns 42 across the boundary', async () => {
    const bytes = readFileSync('src/wasm/terri_wasm_bg.wasm');
    await init({ module_or_path: bytes });
    expect(smoke_value()).toBe(42);
  });
});
```

- [ ] **Step 11: Run the test to verify it fails, then install and pass**

Run: `cd web && npm install && npm test`
Expected before install: module resolution failure. After install: PASS, `1 passed`.

If `init({ module_or_path })` is rejected, the installed `wasm-bindgen` predates that option; use `await init(bytes)` instead.

- [ ] **Step 12: Commit**

```bash
git add Cargo.toml crates web .gitignore && git commit -m "Add Rust/WASM/TS workspace and toolchain smoke test

Proves the Rust to WASM to JavaScript path works end to end before any
simulation code depends on it. The bridge is the highest-risk part of the
architecture, so it gets validated first."
```

---

### Task 2: Fixed-timestep simulation clock

**Files:**
- Create: `crates/terri-core/src/clock.rs`
- Modify: `crates/terri-core/src/lib.rs`

**Interfaces:**
- Consumes: nothing
- Produces: `SimClock { tick: u64 }` (a `bevy_ecs` `Resource`), `SimClock::advance(&mut self)`, `SimClock::sim_minutes(&self) -> u64`, `SimClock::sim_hours(&self) -> u64`, `SimClock::is_hour_boundary(&self) -> bool`, constants `TICKS_PER_SIM_HOUR: u64 = 60` and `TICK_HZ: f64 = 10.0`

Note on `is_hour_boundary`: it returns `true` at `tick == 0`, which is correct since tick 0 does begin sim-hour 0. The unpinned part is the calling convention - whether a consumer running before or after `advance()` sees that first boundary. Nothing consumes it in M0. **Whichever task first adds a consumer (Tier 2 story progression, per [D3]) must pin the run order in a doc comment and lock it with a test.**

- [ ] **Step 1: Write the failing test**

`crates/terri-core/src/clock.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sixty_ticks_is_one_sim_hour() {
        let mut clock = SimClock::default();
        for _ in 0..60 {
            clock.advance();
        }
        assert_eq!(clock.sim_minutes(), 60);
        assert_eq!(clock.sim_hours(), 1);
    }

    #[test]
    fn clock_starts_at_zero() {
        let clock = SimClock::default();
        assert_eq!(clock.tick, 0);
        assert_eq!(clock.sim_hours(), 0);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p terri-core clock`
Expected: FAIL, `cannot find type 'SimClock' in this scope`

- [ ] **Step 3: Implement the clock**

Add above the `tests` module in `crates/terri-core/src/clock.rs`:

```rust
use bevy_ecs::prelude::Resource;

/// Simulation ticks per sim-hour. One tick is one sim-minute at 1x speed.
/// See ARCHITECTURE.md [D2]. Speed controls run MORE TICKS; they never
/// change dt, because variable dt would destroy determinism.
pub const TICKS_PER_SIM_HOUR: u64 = 60;

/// Ticks per real second at 1x speed.
pub const TICK_HZ: f64 = 10.0;

#[derive(Resource, Default, Debug, Clone, Copy, PartialEq, Eq)]
pub struct SimClock {
    pub tick: u64,
}

impl SimClock {
    pub fn advance(&mut self) {
        self.tick += 1;
    }

    pub fn sim_minutes(&self) -> u64 {
        self.tick
    }

    pub fn sim_hours(&self) -> u64 {
        self.tick / TICKS_PER_SIM_HOUR
    }

    /// True on the tick that begins a new sim-hour. Tier 2 story
    /// progression will hang off this later.
    pub fn is_hour_boundary(&self) -> bool {
        self.tick % TICKS_PER_SIM_HOUR == 0
    }
}
```

- [ ] **Step 4: Wire the module into the crate root**

Replace the contents of `crates/terri-core/src/lib.rs` above its `tests` module with:

```rust
//! Pure simulation core. No web dependencies, ever.

pub mod clock;

pub use clock::{SimClock, TICKS_PER_SIM_HOUR, TICK_HZ};

/// Trivial value used only to prove the Rust -> WASM -> JS path works.
/// Deleted once real state crosses the boundary.
pub fn smoke_value() -> u32 {
    42
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p terri-core`
Expected: PASS, `3 passed`

- [ ] **Step 6: Commit**

```bash
git add crates/terri-core && git commit -m "Add fixed-timestep simulation clock

One tick is one sim-minute; 60 ticks is one sim-hour. Speed control is
implemented later as a tick multiplier rather than a dt change, per [D2],
because variable dt would break determinism and foreclose multiplayer."
```

---

### Task 3: Components and need decay

**Files:**
- Create: `crates/terri-core/src/components.rs`
- Create: `crates/terri-sim/Cargo.toml`, `crates/terri-sim/src/lib.rs`
- Create: `crates/terri-sim/src/systems/mod.rs`, `crates/terri-sim/src/systems/needs.rs`
- Modify: `crates/terri-core/src/lib.rs`

**Interfaces:**
- Consumes: `SimClock` from Task 2
- Produces: components `Position { x: f32, y: f32 }`, `Agent`, `Hunger(pub f32)`; system `decay_needs`; `Sim::new() -> Sim`, `Sim::tick(&mut self)`, `Sim::world(&self) -> &World`, `Sim::world_mut(&mut self) -> &mut World`

- [ ] **Step 1: Write the failing component test**

`crates/terri-core/src/components.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hunger_clamps_to_range() {
        let mut h = Hunger(100.0);
        h.drain(150.0);
        assert_eq!(h.0, 0.0);
        h.fill(500.0);
        assert_eq!(h.0, 100.0);
    }

    #[test]
    fn deficit_is_inverse_of_level() {
        assert_eq!(Hunger(100.0).deficit(), 0.0);
        assert_eq!(Hunger(0.0).deficit(), 1.0);
        assert_eq!(Hunger(50.0).deficit(), 0.5);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p terri-core components`
Expected: FAIL, `cannot find type 'Hunger' in this scope`

- [ ] **Step 3: Implement the components**

Add above the `tests` module in `crates/terri-core/src/components.rs`:

```rust
use bevy_ecs::prelude::Component;

/// World-space position in tiles. Not screen space; the renderer
/// applies the isometric projection.
#[derive(Component, Debug, Clone, Copy, PartialEq)]
pub struct Position {
    pub x: f32,
    pub y: f32,
}

/// Marks an entity as a simulated person.
#[derive(Component, Debug, Clone, Copy)]
pub struct Agent;

/// A need level from 0.0 (desperate) to 100.0 (fully satisfied).
#[derive(Component, Debug, Clone, Copy, PartialEq)]
pub struct Hunger(pub f32);

pub const NEED_MAX: f32 = 100.0;
pub const NEED_MIN: f32 = 0.0;

impl Hunger {
    pub fn drain(&mut self, amount: f32) {
        self.0 = (self.0 - amount).clamp(NEED_MIN, NEED_MAX);
    }

    pub fn fill(&mut self, amount: f32) {
        self.0 = (self.0 + amount).clamp(NEED_MIN, NEED_MAX);
    }

    /// 0.0 when fully satisfied, 1.0 when desperate. Advertisement
    /// scoring in Task 5 weights this nonlinearly.
    pub fn deficit(&self) -> f32 {
        (NEED_MAX - self.0) / NEED_MAX
    }
}
```

- [ ] **Step 4: Wire into the crate root**

In `crates/terri-core/src/lib.rs`, add after `pub mod clock;`:

```rust
pub mod components;

pub use components::{Agent, Hunger, Position, NEED_MAX, NEED_MIN};
```

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test -p terri-core`
Expected: PASS, `5 passed`

- [ ] **Step 6: Create `terri-sim` with the failing decay test**

`crates/terri-sim/Cargo.toml`:

```toml
[package]
name = "terri-sim"
edition.workspace = true
version.workspace = true

[dependencies]
terri-core = { path = "../terri-core" }
bevy_ecs = { workspace = true }
```

`crates/terri-sim/src/systems/needs.rs`:

```rust
use bevy_ecs::prelude::*;
use terri_core::Hunger;

/// Hunger lost per tick (one sim-minute). At this rate a sim goes from
/// full to empty in roughly 16 sim-hours, which leaves room for sleep.
pub const HUNGER_DECAY_PER_TICK: f32 = 0.104;

pub fn decay_needs(mut query: Query<&mut Hunger>) {
    for mut hunger in &mut query {
        hunger.drain(HUNGER_DECAY_PER_TICK);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Sim;
    use terri_core::{Agent, Position};

    #[test]
    fn hunger_decays_over_ticks() {
        let mut sim = Sim::new();
        let id = sim
            .world_mut()
            .spawn((Agent, Position { x: 0.0, y: 0.0 }, Hunger(100.0)))
            .id();

        for _ in 0..100 {
            sim.tick();
        }

        let hunger = sim.world().get::<Hunger>(id).unwrap();
        let expected = 100.0 - (HUNGER_DECAY_PER_TICK * 100.0);
        assert!(
            (hunger.0 - expected).abs() < 0.001,
            "expected ~{expected}, got {}",
            hunger.0
        );
    }

    #[test]
    fn hunger_never_goes_negative() {
        let mut sim = Sim::new();
        let id = sim.world_mut().spawn((Agent, Hunger(1.0))).id();

        for _ in 0..1000 {
            sim.tick();
        }

        assert_eq!(sim.world().get::<Hunger>(id).unwrap().0, 0.0);
    }
}
```

`crates/terri-sim/src/systems/mod.rs`:

```rust
pub mod needs;
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cargo test -p terri-sim`
Expected: FAIL, `cannot find type 'Sim'`

- [ ] **Step 8: Implement the `Sim` container**

`crates/terri-sim/src/lib.rs`:

```rust
//! Simulation systems and scheduling. No web dependencies, ever.

pub mod systems;

use bevy_ecs::prelude::*;
use bevy_ecs::schedule::ExecutorKind;
use terri_core::SimClock;

/// Owns the ECS world and the tick schedule.
pub struct Sim {
    world: World,
    schedule: Schedule,
}

impl Sim {
    pub fn new() -> Self {
        let mut world = World::new();
        world.insert_resource(SimClock::default());

        // Register components eagerly. This is NOT optional bookkeeping:
        // World::try_query returns None if ANY component in the query is
        // unregistered, including one behind Option<&T>. Task 7's
        // world_hash uses try_query, so without this a world that never
        // spawned a Hunger would hash zero rows and the determinism test
        // would pass by comparing two empty hashes - green while testing
        // nothing. Later tasks must add their components here too.
        world.register_component::<terri_core::Position>();
        world.register_component::<terri_core::Agent>();
        world.register_component::<terri_core::Hunger>();
        // Task 6 must extend this list with SmartObject, Reserved, Path,
        // Target, and Eating as it introduces them. Forgetting one is
        // silent: try_query yields None and the determinism hash sees
        // zero rows.

        let mut schedule = Schedule::default();
        // M0 runs single-threaded on purpose. Parallelism is [A9]/[D4]
        // and requires the commutativity rule; keeping it off now makes
        // determinism trivially safe.
        schedule.set_executor_kind(ExecutorKind::SingleThreaded);
        schedule.add_systems((advance_clock, systems::needs::decay_needs).chain());

        Self { world, schedule }
    }

    pub fn tick(&mut self) {
        self.schedule.run(&mut self.world);
    }

    pub fn world(&self) -> &World {
        &self.world
    }

    pub fn world_mut(&mut self) -> &mut World {
        &mut self.world
    }
}

impl Default for Sim {
    fn default() -> Self {
        Self::new()
    }
}

fn advance_clock(mut clock: ResMut<SimClock>) {
    clock.advance();
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `cargo test -p terri-sim`
Expected: PASS, `2 passed`

- [ ] **Step 10: Commit**

```bash
git add crates && git commit -m "Add core components and need decay system

Hunger uses a 0-100 scale with a deficit accessor, which advertisement
scoring weights nonlinearly later. The schedule is pinned to the
single-threaded executor for now so determinism needs no extra care."
```

---

### Task 4: Tile grid and A* pathfinding

**Files:**
- Create: `crates/terri-core/src/grid.rs`
- Modify: `crates/terri-core/src/lib.rs`

**Interfaces:**
- Consumes: nothing
- Produces: `TileGrid::new(width: usize, height: usize) -> TileGrid`, `TileGrid::set_blocked(&mut self, x: usize, y: usize, blocked: bool)`, `TileGrid::is_walkable(&self, x: i32, y: i32) -> bool`, `TileGrid::find_path(&self, from: (i32, i32), to: (i32, i32)) -> Option<Vec<(i32, i32)>>`

Note: `find_path` returns the path **including** the destination and **excluding** the start. Movement in Task 6 relies on that exact shape.

- [ ] **Step 1: Write the failing tests**

`crates/terri-core/src/grid.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn straight_path_on_open_grid() {
        let grid = TileGrid::new(10, 10);
        let path = grid.find_path((0, 0), (3, 0)).expect("path exists");
        assert_eq!(path, vec![(1, 0), (2, 0), (3, 0)]);
    }

    #[test]
    fn path_routes_around_a_wall() {
        let mut grid = TileGrid::new(5, 5);
        for y in 0..4 {
            grid.set_blocked(2, y, true);
        }
        let path = grid.find_path((0, 0), (4, 0)).expect("path exists");
        assert_eq!(*path.last().unwrap(), (4, 0));
        assert!(
            path.iter().all(|&(x, y)| !(x == 2 && y < 4)),
            "path must not cross the wall: {path:?}"
        );
    }

    #[test]
    fn unreachable_target_returns_none() {
        let mut grid = TileGrid::new(5, 5);
        for y in 0..5 {
            grid.set_blocked(2, y, true);
        }
        assert!(grid.find_path((0, 0), (4, 0)).is_none());
    }

    #[test]
    fn path_to_self_is_empty() {
        let grid = TileGrid::new(5, 5);
        assert_eq!(grid.find_path((1, 1), (1, 1)), Some(vec![]));
    }

    #[test]
    fn out_of_bounds_is_not_walkable() {
        let grid = TileGrid::new(3, 3);
        assert!(!grid.is_walkable(-1, 0));
        assert!(!grid.is_walkable(3, 0));
        assert!(grid.is_walkable(2, 2));
    }

    #[test]
    fn pathfinding_is_deterministic() {
        let mut grid = TileGrid::new(12, 12);
        grid.set_blocked(5, 5, true);
        let a = grid.find_path((0, 0), (11, 11));
        let b = grid.find_path((0, 0), (11, 11));
        assert_eq!(a, b);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p terri-core grid`
Expected: FAIL, `cannot find type 'TileGrid' in this scope`

- [ ] **Step 3: Implement the grid and A***

Add above the `tests` module in `crates/terri-core/src/grid.rs`:

```rust
use bevy_ecs::prelude::Resource;
use std::collections::BinaryHeap;

/// A single lot's walkability grid. One tile is roughly one metre.
/// M0 is a single room; the room and portal graph in [D7] arrives with
/// multi-room lots.
#[derive(Resource, Debug, Clone)]
pub struct TileGrid {
    width: usize,
    height: usize,
    blocked: Vec<bool>,
}

/// Four-way movement only. Diagonals would need corner-cutting checks
/// and are not needed for M0.
const NEIGHBOURS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

impl TileGrid {
    pub fn new(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            blocked: vec![false; width * height],
        }
    }

    pub fn width(&self) -> usize {
        self.width
    }

    pub fn height(&self) -> usize {
        self.height
    }

    pub fn set_blocked(&mut self, x: usize, y: usize, blocked: bool) {
        let idx = y * self.width + x;
        self.blocked[idx] = blocked;
    }

    pub fn is_walkable(&self, x: i32, y: i32) -> bool {
        if x < 0 || y < 0 || x >= self.width as i32 || y >= self.height as i32 {
            return false;
        }
        !self.blocked[y as usize * self.width + x as usize]
    }

    fn index(&self, x: i32, y: i32) -> usize {
        y as usize * self.width + x as usize
    }

    /// A* over the tile grid. Returns the path excluding `from` and
    /// including `to`, or None if unreachable.
    ///
    /// Determinism note: the open set is a BinaryHeap ordered by
    /// (f_score, tile_index). Including the index breaks f-score ties in
    /// a stable way, so the same query always yields the same path.
    pub fn find_path(&self, from: (i32, i32), to: (i32, i32)) -> Option<Vec<(i32, i32)>> {
        if from == to {
            return Some(Vec::new());
        }
        if !self.is_walkable(to.0, to.1) || !self.is_walkable(from.0, from.1) {
            return None;
        }

        let cell_count = self.width * self.height;
        let mut g_score = vec![u32::MAX; cell_count];
        let mut came_from = vec![usize::MAX; cell_count];
        let mut closed = vec![false; cell_count];

        let start = self.index(from.0, from.1);
        let goal = self.index(to.0, to.1);
        g_score[start] = 0;

        let mut open = BinaryHeap::new();
        open.push(OpenNode {
            f_score: heuristic(from, to),
            index: start,
            pos: from,
        });

        while let Some(current) = open.pop() {
            if current.index == goal {
                return Some(reconstruct(&came_from, self.width, start, goal));
            }
            if closed[current.index] {
                continue;
            }
            closed[current.index] = true;

            for (dx, dy) in NEIGHBOURS {
                let next = (current.pos.0 + dx, current.pos.1 + dy);
                if !self.is_walkable(next.0, next.1) {
                    continue;
                }
                let next_idx = self.index(next.0, next.1);
                if closed[next_idx] {
                    continue;
                }
                let tentative = g_score[current.index].saturating_add(1);
                if tentative < g_score[next_idx] {
                    g_score[next_idx] = tentative;
                    came_from[next_idx] = current.index;
                    open.push(OpenNode {
                        f_score: tentative + heuristic(next, to),
                        index: next_idx,
                        pos: next,
                    });
                }
            }
        }

        None
    }
}

fn heuristic(a: (i32, i32), b: (i32, i32)) -> u32 {
    ((a.0 - b.0).abs() + (a.1 - b.1).abs()) as u32
}

fn reconstruct(
    came_from: &[usize],
    width: usize,
    start: usize,
    goal: usize,
) -> Vec<(i32, i32)> {
    let mut path = Vec::new();
    let mut cursor = goal;
    while cursor != start {
        path.push(((cursor % width) as i32, (cursor / width) as i32));
        cursor = came_from[cursor];
    }
    path.reverse();
    path
}

/// Min-heap entry. BinaryHeap is a max-heap, so Ord is reversed on
/// f_score. The index tiebreak keeps ordering total and stable.
#[derive(PartialEq, Eq)]
struct OpenNode {
    f_score: u32,
    index: usize,
    pos: (i32, i32),
}

impl Ord for OpenNode {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        other
            .f_score
            .cmp(&self.f_score)
            .then_with(|| other.index.cmp(&self.index))
    }
}

impl PartialOrd for OpenNode {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
```

- [ ] **Step 4: Wire into the crate root**

In `crates/terri-core/src/lib.rs`, add after `pub mod components;`:

```rust
pub mod grid;

pub use grid::TileGrid;
```

- [ ] **Step 5: Run to verify all tests pass**

Run: `cargo test -p terri-core`
Expected: PASS, `11 passed`

- [ ] **Step 6: Commit**

```bash
git add crates/terri-core && git commit -m "Add tile grid and deterministic A* pathfinding

Four-way movement on a single-room grid. The open set breaks f-score ties
on tile index so identical queries always return identical paths, which
the determinism test in a later task depends on."
```

---

### Task 5: Smart objects and advertisement scoring

Implements [D6], the mechanism that gives the game its personality. Objects advertise what they satisfy; agents score those advertisements against their own deficits.

**Files:**
- Create: `crates/terri-sim/src/systems/advertise.rs`
- Modify: `crates/terri-core/src/components.rs`, `crates/terri-sim/src/systems/mod.rs`

**Interfaces:**
- Consumes: `Hunger`, `Position` from Task 3
- Produces: components `SmartObject { hunger_delta: f32, duration_ticks: u32, slots: u8 }`, `Reserved`; function `score_advertisement(deficit: f32, delta: f32, duration_ticks: u32, distance: f32) -> f32`

- [ ] **Step 1: Add the components with failing tests**

Append to `crates/terri-core/src/components.rs`, above its `tests` module:

```rust
/// An object that advertises an interaction. See [D6]. M0 supports a
/// single need; the full version advertises a map of need deltas loaded
/// from content files.
#[derive(Component, Debug, Clone, Copy)]
pub struct SmartObject {
    pub hunger_delta: f32,
    pub duration_ticks: u32,
    pub slots: u8,
}

/// Marks a smart object as claimed. Reservation is serialized and
/// ordered by entity id so two agents never claim one slot.
#[derive(Component, Debug, Clone, Copy)]
pub struct Reserved;
```

Also add to the `pub use` line in `crates/terri-core/src/lib.rs`:

```rust
pub use components::{Agent, Hunger, Position, Reserved, SmartObject, NEED_MAX, NEED_MIN};
```

- [ ] **Step 2: Write the failing scoring tests**

`crates/terri-sim/src/systems/advertise.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desperate_agents_score_far_higher_than_comfortable_ones() {
        let desperate = score_advertisement(0.95, 35.0, 15, 5.0);
        let comfortable = score_advertisement(0.40, 35.0, 15, 5.0);
        assert!(
            desperate > comfortable * 4.0,
            "deficit weighting must be steeply nonlinear: {desperate} vs {comfortable}"
        );
    }

    #[test]
    fn zero_deficit_scores_zero() {
        assert_eq!(score_advertisement(0.0, 35.0, 15, 1.0), 0.0);
    }

    #[test]
    fn out_of_range_deficit_cannot_inflate_a_score() {
        // Hunger's field is public, so callers can construct values
        // outside 0..=100 and deficit() can return outside 0.0..=1.0.
        // Raising such a value to DEFICIT_EXPONENT would inflate the
        // score without bound, so scoring clamps its input.
        let sane = score_advertisement(1.0, 35.0, 15, 5.0);
        assert_eq!(score_advertisement(1.6, 35.0, 15, 5.0), sane);
        assert_eq!(score_advertisement(-0.4, 35.0, 15, 5.0), 0.0);
    }

    #[test]
    fn closer_objects_score_higher() {
        let near = score_advertisement(0.5, 35.0, 15, 1.0);
        let far = score_advertisement(0.5, 35.0, 15, 40.0);
        assert!(near > far, "{near} should beat {far}");
    }

    #[test]
    fn larger_need_delta_scores_higher() {
        let big = score_advertisement(0.5, 60.0, 15, 5.0);
        let small = score_advertisement(0.5, 10.0, 15, 5.0);
        assert!(big > small);
    }

    #[test]
    fn slower_interactions_score_lower_all_else_equal() {
        let quick = score_advertisement(0.5, 35.0, 10, 5.0);
        let slow = score_advertisement(0.5, 35.0, 120, 5.0);
        assert!(quick > slow);
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cargo test -p terri-sim advertise`
Expected: FAIL, `cannot find function 'score_advertisement'`

- [ ] **Step 4: Implement scoring**

Add above the `tests` module in `crates/terri-sim/src/systems/advertise.rs`:

```rust
/// How steeply need deficit is weighted. A sim at 5% hunger should want
/// food enormously more than one at 60%, not 12x more. Cubing the
/// deficit produces roughly that curve.
const DEFICIT_EXPONENT: f32 = 3.0;

/// Tiles per tick an agent walks. Used to convert distance into a time
/// cost so travel and duration are commensurable.
///
/// Public and shared on purpose: Task 6's movement system consumes this
/// same constant rather than declaring its own. If the two ever drift,
/// the scoring function's travel estimate silently becomes a lie and no
/// test fails.
pub const TILES_PER_TICK: f32 = 0.25;

/// Score one advertised interaction for one agent. Higher wins.
///
/// The shape is: benefit scaled by how badly the need is felt, divided
/// by the total time cost of getting there and doing it.
pub fn score_advertisement(
    deficit: f32,
    delta: f32,
    duration_ticks: u32,
    distance: f32,
) -> f32 {
    if deficit <= 0.0 || delta <= 0.0 {
        return 0.0;
    }
    // Clamp before exponentiating. Hunger's field is public, so nothing
    // structurally prevents a level outside 0..=100 and therefore a
    // deficit outside 0.0..=1.0; cubing 1.6 would inflate the score by
    // 4x with no bound. Clamping here rather than trusting callers keeps
    // the guarantee local to the function that depends on it.
    let urgency = deficit.clamp(0.0, 1.0).powf(DEFICIT_EXPONENT);
    let travel_ticks = distance / TILES_PER_TICK;
    let time_cost = travel_ticks + duration_ticks as f32;
    // The +1 keeps a zero-cost interaction from producing infinity.
    (urgency * delta) / (time_cost + 1.0)
}
```

Add to `crates/terri-sim/src/systems/mod.rs`:

```rust
pub mod advertise;
```

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test -p terri-sim`
Expected: PASS, `7 passed`

- [ ] **Step 6: Commit**

```bash
git add crates && git commit -m "Add smart object components and advertisement scoring

Implements the utility function at the heart of agent decision making
per [D6]. Deficit is cubed so a starving sim weights food far above a
peckish one, and travel distance is converted to ticks so it can be
traded off against interaction duration."
```

---

### Task 6: Close the loop - action selection, movement, and eating

The milestone's actual deliverable. After this task, a hungry sim walks to a fridge and eats.

**Files:**
- Create: `crates/terri-sim/src/systems/action.rs`, `crates/terri-sim/src/systems/movement.rs`, `crates/terri-sim/src/systems/interact.rs`
- Modify: `crates/terri-core/src/components.rs`, `crates/terri-sim/src/lib.rs`, `crates/terri-sim/src/systems/mod.rs`

**Interfaces:**
- Consumes: everything from Tasks 2-5
- Produces: components `Path { steps: Vec<(i32, i32)>, cursor: usize }`, `Target(pub Entity)`, `Eating { remaining_ticks: u32, delta_per_tick: f32 }`; systems `select_action`, `follow_path`, `tick_interactions`; `Sim::spawn_lot(&mut self)` test helper

- [ ] **Step 1: Add the remaining components**

Append to `crates/terri-core/src/components.rs`, above its `tests` module:

```rust
use bevy_ecs::prelude::Entity;

/// A tile path being followed. `steps` excludes the origin tile.
#[derive(Component, Debug, Clone)]
pub struct Path {
    pub steps: Vec<(i32, i32)>,
    pub cursor: usize,
}

impl Path {
    pub fn next_step(&self) -> Option<(i32, i32)> {
        self.steps.get(self.cursor).copied()
    }

    pub fn is_complete(&self) -> bool {
        self.cursor >= self.steps.len()
    }
}

/// The smart object this agent is currently travelling to.
#[derive(Component, Debug, Clone, Copy)]
pub struct Target(pub Entity);

/// An in-progress eating interaction.
#[derive(Component, Debug, Clone, Copy)]
pub struct Eating {
    pub remaining_ticks: u32,
    pub delta_per_tick: f32,
}
```

Update the `pub use` in `crates/terri-core/src/lib.rs`:

```rust
pub use components::{
    Agent, Eating, Hunger, Path, Position, Reserved, SmartObject, Target, NEED_MAX, NEED_MIN,
};
```

- [ ] **Step 2: Write the failing integration test**

`crates/terri-sim/src/systems/interact.rs`:

```rust
use bevy_ecs::prelude::*;
use terri_core::{Eating, Hunger, Reserved, Target};

/// Advances in-progress interactions. When one finishes, the agent
/// releases its reservation and becomes idle again.
pub fn tick_interactions(
    mut commands: Commands,
    mut agents: Query<(Entity, &mut Eating, &mut Hunger, &Target)>,
) {
    for (entity, mut eating, mut hunger, target) in &mut agents {
        hunger.fill(eating.delta_per_tick);
        eating.remaining_ticks = eating.remaining_ticks.saturating_sub(1);

        if eating.remaining_ticks == 0 {
            commands.entity(entity).remove::<Eating>().remove::<Target>();
            commands.entity(target.0).remove::<Reserved>();
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::Sim;
    use terri_core::{Agent, Eating, Hunger, Position, SmartObject, Target};

    #[test]
    fn hungry_sim_walks_to_the_fridge_and_eats() {
        let mut sim = Sim::new_with_lot(16, 16);

        let fridge = sim
            .world_mut()
            .spawn((
                Position { x: 10.0, y: 8.0 },
                SmartObject {
                    hunger_delta: 40.0,
                    duration_ticks: 15,
                    slots: 1,
                },
            ))
            .id();

        let sim_entity = sim
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, Hunger(20.0)))
            .id();

        // Long enough to path across the lot and finish the meal.
        for _ in 0..400 {
            sim.tick();
        }

        let hunger = sim.world().get::<Hunger>(sim_entity).unwrap().0;
        assert!(
            hunger > 40.0,
            "sim should have eaten and recovered; hunger is {hunger}"
        );

        let pos = sim.world().get::<Position>(sim_entity).unwrap();
        let dist = ((pos.x - 10.0).powi(2) + (pos.y - 8.0).powi(2)).sqrt();
        assert!(dist < 2.0, "sim should be at the fridge; distance {dist}");

        assert!(
            sim.world().get::<Eating>(sim_entity).is_none(),
            "interaction should have completed"
        );
        let _ = fridge;
    }

    #[test]
    fn satisfied_sim_does_not_seek_food() {
        let mut sim = Sim::new_with_lot(16, 16);
        sim.world_mut().spawn((
            Position { x: 10.0, y: 8.0 },
            SmartObject {
                hunger_delta: 40.0,
                duration_ticks: 15,
                slots: 1,
            },
        ));
        let sim_entity = sim
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, Hunger(100.0)))
            .id();

        for _ in 0..5 {
            sim.tick();
        }

        assert!(
            sim.world().get::<Target>(sim_entity).is_none(),
            "a full sim should not target the fridge"
        );
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cargo test -p terri-sim interact`
Expected: FAIL, `no function or associated item named 'new_with_lot'`

- [ ] **Step 4: Implement action selection**

`crates/terri-sim/src/systems/action.rs`:

```rust
use bevy_ecs::prelude::*;
use terri_core::{
    Agent, Eating, Hunger, Path, Position, Reserved, SmartObject, Target, TileGrid,
};

use super::advertise::score_advertisement;

/// Below this score nothing is worth doing, so the agent stays idle.
const ACTION_THRESHOLD: f32 = 0.05;

/// Idle agents scan advertisements, pick the best, reserve it, and path
/// to it. Serialized on purpose: reservation is contended state, so it
/// runs in deterministic entity order per [D4].
pub fn select_action(
    mut commands: Commands,
    grid: Res<TileGrid>,
    agents: Query<
        (Entity, &Position, &Hunger),
        (With<Agent>, Without<Target>, Without<Eating>),
    >,
    objects: Query<(Entity, &Position, &SmartObject), Without<Reserved>>,
) {
    // Collect and sort so iteration order cannot vary between runs.
    let mut idle: Vec<(Entity, Position, f32)> = agents
        .iter()
        .map(|(e, pos, hunger)| (e, *pos, hunger.deficit()))
        .collect();
    idle.sort_by_key(|(e, _, _)| e.index());

    let mut claimed: Vec<Entity> = Vec::new();

    for (agent, agent_pos, deficit) in idle {
        let mut best: Option<(Entity, Position, f32)> = None;

        for (object, object_pos, advert) in &objects {
            if claimed.contains(&object) {
                continue;
            }
            // Euclidean straight-line distance, deliberately, not A*
            // path length. Scoring runs against every candidate object
            // every tick, so pathing each one first would be far too
            // expensive. The cost is that an object one tile away
            // through a wall scores as near and is then walked around.
            // Acceptable in M0's single open room; revisit when [D7]'s
            // room and portal graph lands and walls become common.
            let dx = object_pos.x - agent_pos.x;
            let dy = object_pos.y - agent_pos.y;
            let distance = (dx * dx + dy * dy).sqrt();
            let score = score_advertisement(
                deficit,
                advert.hunger_delta,
                advert.duration_ticks,
                distance,
            );
            let better = match best {
                // Tiebreak on entity index so equal scores resolve
                // identically every run.
                Some((best_e, _, best_score)) => {
                    score > best_score || (score == best_score && object.index() < best_e.index())
                }
                None => true,
            };
            if score > ACTION_THRESHOLD && better {
                best = Some((object, *object_pos, score));
            }
        }

        let Some((object, object_pos, _)) = best else {
            continue;
        };

        let from = (agent_pos.x.round() as i32, agent_pos.y.round() as i32);
        let to = (object_pos.x.round() as i32, object_pos.y.round() as i32);
        let Some(steps) = grid.find_path(from, to) else {
            continue;
        };

        claimed.push(object);
        commands.entity(object).insert(Reserved);
        commands
            .entity(agent)
            .insert((Target(object), Path { steps, cursor: 0 }));
    }
}
```

- [ ] **Step 5: Implement movement**

`crates/terri-sim/src/systems/movement.rs`:

```rust
use bevy_ecs::prelude::*;
use terri_core::{Eating, Path, Position, SmartObject, Target};

use super::advertise::TILES_PER_TICK;

/// Tiles travelled per tick. Imported rather than redeclared so the
/// scoring function's travel estimate cannot silently drift out of step
/// with actual movement.
const SPEED: f32 = TILES_PER_TICK;

/// Advances agents along their path. On arrival, converts the target
/// into an in-progress interaction.
pub fn follow_path(
    mut commands: Commands,
    mut agents: Query<(Entity, &mut Position, &mut Path, &Target)>,
    objects: Query<&SmartObject>,
) {
    for (entity, mut pos, mut path, target) in &mut agents {
        let Some((tx, ty)) = path.next_step() else {
            // Path exhausted: begin the interaction.
            let Ok(advert) = objects.get(target.0) else {
                commands.entity(entity).remove::<Path>().remove::<Target>();
                continue;
            };
            let duration = advert.duration_ticks.max(1);
            commands.entity(entity).remove::<Path>().insert(Eating {
                remaining_ticks: duration,
                delta_per_tick: advert.hunger_delta / duration as f32,
            });
            continue;
        };

        let dx = tx as f32 - pos.x;
        let dy = ty as f32 - pos.y;
        let dist = (dx * dx + dy * dy).sqrt();

        if dist <= SPEED {
            pos.x = tx as f32;
            pos.y = ty as f32;
            path.cursor += 1;
        } else {
            pos.x += dx / dist * SPEED;
            pos.y += dy / dist * SPEED;
        }
    }
}
```

- [ ] **Step 6: Wire the systems into the schedule**

Replace `crates/terri-sim/src/systems/mod.rs` with:

```rust
pub mod action;
pub mod advertise;
pub mod interact;
pub mod movement;
pub mod needs;
```

In `crates/terri-sim/src/lib.rs`, replace the `schedule.add_systems(...)` line with:

```rust
        // Order matches the tick pipeline in ARCHITECTURE.md [D5],
        // reduced to the systems M0 needs.
        schedule.add_systems(
            (
                advance_clock,
                systems::needs::decay_needs,
                systems::action::select_action,
                systems::movement::follow_path,
                systems::interact::tick_interactions,
            )
                .chain(),
        );
```

And add the `new_with_lot` constructor to `impl Sim`:

```rust
    /// Creates a sim with an empty walkable lot of the given size.
    pub fn new_with_lot(width: usize, height: usize) -> Self {
        let mut sim = Self::new();
        sim.world.insert_resource(terri_core::TileGrid::new(width, height));
        sim
    }
```

`Sim::new()` must also insert a default grid so `Res<TileGrid>` never panics. Add to `Sim::new()` after `world.insert_resource(SimClock::default());`:

```rust
        world.insert_resource(terri_core::TileGrid::new(1, 1));
```

- [ ] **Step 7: Run to verify all tests pass**

Run: `cargo test -p terri-sim`
Expected: PASS, `9 passed`

- [ ] **Step 8: Commit**

```bash
git add crates && git commit -m "Close the M0 loop: a hungry sim paths to a fridge and eats

Adds action selection with reservation, path following, and interaction
execution. Selection is serialized and sorted by entity index so
contended reservations resolve identically on every run, which the
determinism test depends on."
```

---

### Task 7: Deterministic world hash and CI

[D12] calls this the highest-value test in the project. It is what stops the Layer 2 multiplayer option from decaying unnoticed.

**Files:**
- Create: `crates/terri-core/src/hash.rs`, `.github/workflows/ci.yml`
- Modify: `crates/terri-core/src/lib.rs`, `crates/terri-sim/src/lib.rs`

**Interfaces:**
- Consumes: `Sim` from Task 3
- Produces: `Sim::world_hash(&self) -> u64`

- [ ] **Step 1: Write the failing determinism test**

Append to `crates/terri-sim/src/lib.rs`:

```rust
#[cfg(test)]
mod determinism_tests {
    use super::*;
    use terri_core::{Agent, Hunger, Position, SmartObject};

    fn build_scenario() -> Sim {
        let mut sim = Sim::new_with_lot(24, 24);
        sim.world_mut().spawn((
            Position { x: 18.0, y: 14.0 },
            SmartObject {
                hunger_delta: 40.0,
                duration_ticks: 15,
                slots: 1,
            },
        ));
        for i in 0..8 {
            sim.world_mut().spawn((
                Agent,
                Position {
                    x: 1.0 + i as f32,
                    y: 1.0,
                },
                Hunger(30.0 + i as f32 * 5.0),
            ));
        }
        sim
    }

    #[test]
    fn identical_scenarios_produce_identical_world_hashes() {
        let mut a = build_scenario();
        let mut b = build_scenario();

        for _ in 0..500 {
            a.tick();
            b.tick();
        }

        // Guard against the empty-hash trap before asserting equality.
        // If any queried component were unregistered, try_query would
        // yield zero rows and this test would pass by comparing two
        // identical empty hashes - permanently green while testing
        // nothing. See lessons-learned [L3]. Any test that can pass on
        // empty input needs an assertion that the input was not empty.
        let empty = Sim::new_with_lot(24, 24);
        assert_ne!(
            a.world_hash(),
            empty.world_hash(),
            "world hash equals an empty world's; the hash is seeing no entities"
        );

        assert_eq!(
            a.world_hash(),
            b.world_hash(),
            "simulation diverged; determinism is broken"
        );
    }

    #[test]
    fn hash_changes_as_the_world_evolves() {
        let mut sim = build_scenario();
        let before = sim.world_hash();
        for _ in 0..50 {
            sim.tick();
        }
        assert_ne!(before, sim.world_hash());
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p terri-sim determinism`
Expected: FAIL, `no method named 'world_hash'`

- [ ] **Step 3: Implement the hash helper**

`crates/terri-core/src/hash.rs`:

```rust
//! Deterministic hashing for the world-state determinism test.
//!
//! FNV-1a is used rather than the standard library hasher because
//! DefaultHasher is explicitly not guaranteed stable across releases,
//! and this hash must be comparable over time.

const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

#[derive(Debug, Clone, Copy)]
pub struct FnvHasher(u64);

impl Default for FnvHasher {
    fn default() -> Self {
        Self(FNV_OFFSET)
    }
}

impl FnvHasher {
    pub fn write_bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= *byte as u64;
            self.0 = self.0.wrapping_mul(FNV_PRIME);
        }
    }

    pub fn write_u64(&mut self, value: u64) {
        self.write_bytes(&value.to_le_bytes());
    }

    /// Floats are quantized before hashing. Two runs that differ only by
    /// a last-bit rounding artefact should not be reported as divergent,
    /// but anything visible must be caught. 1e-4 tiles is far below one
    /// rendered pixel.
    pub fn write_f32(&mut self, value: f32) {
        let quantized = (value * 10_000.0).round() as i64;
        self.write_bytes(&quantized.to_le_bytes());
    }

    pub fn finish(&self) -> u64 {
        self.0
    }
}
```

Add to `crates/terri-core/src/lib.rs`:

```rust
pub mod hash;

pub use hash::FnvHasher;
```

- [ ] **Step 4: Implement `Sim::world_hash`**

Add to `impl Sim` in `crates/terri-sim/src/lib.rs`:

```rust
    /// Hashes all simulation-visible state. Entities are sorted by index
    /// first, because ECS iteration order is an implementation detail and
    /// must not affect the result.
    pub fn world_hash(&self) -> u64 {
        use terri_core::{Hunger, Position};

        let mut hasher = terri_core::FnvHasher::default();
        hasher.write_u64(self.world.resource::<SimClock>().tick);

        // (entity index, x, y, hunger). Hunger is -1.0 for entities that
        // have none, which distinguishes "no need" from "starving".
        let mut rows: Vec<(u32, f32, f32, f32)> = Vec::new();
        if let Some(mut state) = self
            .world
            .try_query::<(Entity, &Position, Option<&Hunger>)>()
        {
            for (entity, pos, hunger) in state.iter(&self.world) {
                let hunger = hunger.map_or(-1.0, |h| h.0);
                rows.push((entity.index_u32(), pos.x, pos.y, hunger));
            }
        }
        // The sort is load-bearing: query iteration is archetype order,
        // not entity order, and archetype order shifts as components are
        // added and removed.
        rows.sort_by_key(|(index, _, _, _)| *index);

        for (index, x, y, hunger) in rows {
            hasher.write_u64(index as u64);
            hasher.write_f32(x);
            hasher.write_f32(y);
            hasher.write_f32(hunger);
        }

        hasher.finish()
    }
```

`try_query` takes `&self`, so `world_hash`'s signature survives. It returns `Option<QueryState>`, and the state must be bound `mut` because `iter` takes `&mut self` on it; since the state is owned, `let Some(mut state)` then `state.iter(&self.world)` has no borrow conflict.

**Do not replace the `if let Some` with `.expect(..)` without reading the note in `Sim::new` about `register_component`.** Either form is a trap if components are unregistered: `expect` panics, and `if let Some` silently hashes zero rows, which makes the determinism test pass by comparing two empty hashes. Registration in `Sim::new` is what makes this correct.

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test -p terri-sim`
Expected: PASS, `11 passed`

- [ ] **Step 6: Add CI**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy, rustfmt
          targets: wasm32-unknown-unknown
      - name: Format check
        run: cargo fmt --all -- --check
      - name: Clippy
        run: cargo clippy --workspace --all-targets -- -D warnings
      - name: Test
        run: cargo test --workspace
      - name: Verify sim core has no web dependencies
        run: |
          set -e
          for target in x86_64-unknown-linux-gnu wasm32-unknown-unknown; do
            for crate in terri-core terri-sim; do
              if cargo tree -p "$crate" --target "$target" \
                   | grep -E 'wasm-bindgen|web-sys|js-sys'; then
                echo "FAIL: $crate depends on a web crate for $target"
                exit 1
              fi
            done
          done

  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      - uses: jetli/wasm-pack-action@v0.4.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # web/src/wasm/ is gitignored build output, so a fresh clone has no
      # WASM package. It must be built before the web tests can import it.
      - name: Build WASM package
        run: wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm
      - name: Install web dependencies
        working-directory: web
        run: npm ci
      - name: Type check
        working-directory: web
        run: npm run typecheck
      - name: Test
        working-directory: web
        run: npm test
```

The dependency check mechanically enforces [D1]. If it ever fails, the architecture's load-bearing rule has been broken.

**Why the check names explicit targets rather than running bare `cargo tree`.** `Cargo.lock` legitimately contains `wasm-bindgen`, `web-sys`, and `js-sys` entries as unactivated optional-dependency records, and under `--target all` there is a real-looking path:

```
terri-core -> bevy_ecs -> bevy_reflect -> bevy_reflect_derive -> uuid -> js-sys -> wasm-bindgen
```

That path is inert. `bevy_reflect_derive` is a proc-macro, so it always builds for the host, where `uuid`'s `cfg(all(target_arch = "wasm32", target_os = "unknown"))` block is inactive. Nothing links into `terri-core` on any real target. A bare `cargo tree` or a `--target all` check would therefore fail spuriously and train everyone to ignore it. Checking the two targets that actually get built is both correct and meaningful.

- [ ] **Step 7: Run the checks locally**

Run: `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: all pass, no warnings.

- [ ] **Step 8: Commit**

```bash
git add crates .github && git commit -m "Add deterministic world hash, determinism test, and CI

Two identical scenarios run 500 ticks and must produce the same world
hash. Per [D12] this is the highest-value test in the project: it is what
stops the multiplayer option from decaying unnoticed.

CI also mechanically enforces [D1] by failing if terri-core or terri-sim
ever picks up a wasm-bindgen or web-sys dependency."
```

---

### Task 8: Render buffer and WASM exports

**Files:**
- Create: `crates/terri-sim/src/render_buffer.rs`
- Modify: `crates/terri-sim/src/lib.rs`, `crates/terri-wasm/src/lib.rs`

**Interfaces:**
- Consumes: `Sim` from Task 6
- Produces: `RenderBuffer { positions: Vec<f32>, prev_positions: Vec<f32>, kinds: Vec<u32>, count: usize }`; `Sim::sync_render_buffer(&mut self)`; WASM class `SimHandle` with `new(width, height)`, `tick()`, `entity_count()`, `positions_ptr()`, `prev_positions_ptr()`, `kinds_ptr()`, `spawn_agent(x, y, hunger)`, `spawn_object(x, y)`, `world_hash()`

`positions` is interleaved `[x0, y0, x1, y1, ...]`. `kinds` is `0` for agents and `1` for smart objects.

- [ ] **Step 1: Write the failing render buffer test**

`crates/terri-sim/src/render_buffer.rs`:

```rust
/// Struct-of-arrays snapshot of render-relevant state, laid out so
/// JavaScript can view it directly with no copying and no per-entity
/// objects. See [D11].
#[derive(Debug, Default)]
pub struct RenderBuffer {
    /// Interleaved [x0, y0, x1, y1, ...] for the current tick.
    pub positions: Vec<f32>,
    /// Same layout, previous tick. The renderer interpolates between them.
    pub prev_positions: Vec<f32>,
    /// 0 = agent, 1 = smart object.
    pub kinds: Vec<u32>,
    pub count: usize,
}

#[cfg(test)]
mod tests {
    use crate::Sim;
    use terri_core::{Agent, Hunger, Position, SmartObject};

    #[test]
    fn render_buffer_matches_world_state() {
        let mut sim = Sim::new_with_lot(16, 16);
        sim.world_mut().spawn((
            Position { x: 4.0, y: 5.0 },
            SmartObject {
                hunger_delta: 40.0,
                duration_ticks: 15,
                slots: 1,
            },
        ));
        sim.world_mut()
            .spawn((Agent, Position { x: 1.0, y: 2.0 }, Hunger(50.0)));

        sim.sync_render_buffer();
        let buf = sim.render_buffer();

        assert_eq!(buf.count, 2);
        assert_eq!(buf.positions.len(), 4);
        assert_eq!(buf.kinds.len(), 2);
        // Sorted by entity index, so the object spawned first comes first.
        assert_eq!(buf.positions[0], 4.0);
        assert_eq!(buf.positions[1], 5.0);
        assert_eq!(buf.kinds[0], 1);
        assert_eq!(buf.kinds[1], 0);
    }

    #[test]
    fn prev_positions_lag_by_one_sync() {
        let mut sim = Sim::new_with_lot(16, 16);
        let id = sim
            .world_mut()
            .spawn((Agent, Position { x: 0.0, y: 0.0 }, Hunger(50.0)))
            .id();
        sim.sync_render_buffer();

        sim.world_mut().get_mut::<Position>(id).unwrap().x = 3.0;
        sim.sync_render_buffer();

        let buf = sim.render_buffer();
        assert_eq!(buf.prev_positions[0], 0.0);
        assert_eq!(buf.positions[0], 3.0);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p terri-sim render_buffer`
Expected: FAIL, `no method named 'sync_render_buffer'`

- [ ] **Step 3: Implement the sync**

Add `pub mod render_buffer;` to `crates/terri-sim/src/lib.rs`, add `render: render_buffer::RenderBuffer` to the `Sim` struct (initialized with `Default::default()` in `new()`), and add to `impl Sim`:

```rust
    /// Copies render-relevant state into the struct-of-arrays buffer that
    /// JavaScript views directly. Called once per tick, before the
    /// renderer reads. Entities are sorted by index so an entity keeps
    /// its slot between frames and interpolation stays coherent.
    pub fn sync_render_buffer(&mut self) {
        use terri_core::{Agent, Position};

        std::mem::swap(
            &mut self.render.prev_positions,
            &mut self.render.positions,
        );
        self.render.positions.clear();
        self.render.kinds.clear();

        // World::query (not try_query) registers components on demand and
        // cannot fail, so there is no Option to handle here. It returns an
        // owned QueryState, which ends the &mut borrow immediately and
        // leaves self.render free to write below.
        let mut state = self.world.query::<(Entity, &Position, Has<Agent>)>();
        let mut rows: Vec<(u32, f32, f32, u32)> = Vec::new();
        for (entity, pos, is_agent) in state.iter(&self.world) {
            let kind = if is_agent { 0 } else { 1 };
            rows.push((entity.index_u32(), pos.x, pos.y, kind));
        }
        rows.sort_by_key(|(index, _, _, _)| *index);

        for (_, x, y, kind) in &rows {
            self.render.positions.push(*x);
            self.render.positions.push(*y);
            self.render.kinds.push(*kind);
        }
        self.render.count = rows.len();

        // On the first sync there is no previous frame, so seed it with
        // the current one to avoid interpolating from garbage.
        if self.render.prev_positions.len() != self.render.positions.len() {
            self.render.prev_positions = self.render.positions.clone();
        }
    }

    pub fn render_buffer(&self) -> &render_buffer::RenderBuffer {
        &self.render
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p terri-sim`
Expected: PASS, `13 passed`

- [ ] **Step 5: Replace the WASM boundary**

`crates/terri-wasm/src/lib.rs`:

```rust
//! The ONLY crate that knows JavaScript exists.
//! Nothing in here may contain simulation logic.

use terri_core::{Agent, Hunger, Position, SmartObject};
use terri_sim::Sim;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct SimHandle {
    sim: Sim,
}

#[wasm_bindgen]
impl SimHandle {
    #[wasm_bindgen(constructor)]
    pub fn new(width: usize, height: usize) -> SimHandle {
        SimHandle {
            sim: Sim::new_with_lot(width, height),
        }
    }

    /// Advances one fixed tick and refreshes the render buffer.
    pub fn tick(&mut self) {
        self.sim.tick();
        self.sim.sync_render_buffer();
    }

    pub fn spawn_agent(&mut self, x: f32, y: f32, hunger: f32) {
        self.sim
            .world_mut()
            .spawn((Agent, Position { x, y }, Hunger(hunger)));
        self.sim.sync_render_buffer();
    }

    pub fn spawn_object(&mut self, x: f32, y: f32) {
        self.sim.world_mut().spawn((
            Position { x, y },
            SmartObject {
                hunger_delta: 40.0,
                duration_ticks: 15,
                slots: 1,
            },
        ));
        self.sim.sync_render_buffer();
    }

    pub fn entity_count(&self) -> usize {
        self.sim.render_buffer().count
    }

    /// Pointer into WASM linear memory. See the detachment warning in
    /// web/src/bridge.ts: these must be re-read after anything that can
    /// grow memory.
    pub fn positions_ptr(&self) -> *const f32 {
        self.sim.render_buffer().positions.as_ptr()
    }

    pub fn prev_positions_ptr(&self) -> *const f32 {
        self.sim.render_buffer().prev_positions.as_ptr()
    }

    pub fn kinds_ptr(&self) -> *const u32 {
        self.sim.render_buffer().kinds.as_ptr()
    }

    pub fn world_hash(&self) -> u64 {
        self.sim.world_hash()
    }
}
```

Delete `smoke_value` from both `terri-wasm` and `terri-core`, and delete `web/tests/smoke.test.ts`.

- [ ] **Step 6: Rebuild and verify the workspace still passes**

Run: `cargo test --workspace && wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`
Expected: tests pass; WASM build completes.

- [ ] **Step 7: Commit**

```bash
git add crates web && git commit -m "Add struct-of-arrays render buffer and WASM exports

The render buffer is the only state that crosses into JavaScript, laid
out as flat typed arrays so the shell can view WASM memory directly with
no copying and no per-entity objects, per [D11]. Entities are sorted by
index so a given entity keeps its buffer slot between frames, which
render interpolation depends on.

Removes the toolchain smoke test now that real state crosses the bridge."
```

---

### Task 9: Zero-copy TypeScript bridge

Where [R1] lives. **The single most important detail in this task is that WASM linear memory can grow, which silently detaches every existing typed-array view.** A view captured once and reused is the classic bug in this pattern; it manifests as entities freezing or reading zeroes.

**Files:**
- Create: `web/src/bridge.ts`, `web/tests/bridge.test.ts`

**Interfaces:**
- Consumes: `SimHandle` from Task 8
- Produces: `class SimBridge` with `tick(): void`, `get count(): number`, `positions(): Float32Array`, `prevPositions(): Float32Array`, `kinds(): Uint32Array`, `spawnAgent(x, y, hunger): void`, `spawnObject(x, y): void`, `worldHash(): bigint`

- [ ] **Step 1: Write the failing bridge test**

`web/tests/bridge.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';

beforeAll(async () => {
  await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') });
});

describe('SimBridge', () => {
  it('reads spawned positions without copying', () => {
    const bridge = new SimBridge(new SimHandle(16, 16));
    bridge.spawnObject(4, 5);
    bridge.spawnAgent(1, 2, 50);

    expect(bridge.count).toBe(2);
    const pos = bridge.positions();
    expect(pos.length).toBe(4);
    expect(pos[0]).toBe(4);
    expect(pos[1]).toBe(5);
    expect(pos[2]).toBe(1);
    expect(pos[3]).toBe(2);
  });

  it('tags agents and objects distinctly', () => {
    const bridge = new SimBridge(new SimHandle(16, 16));
    bridge.spawnObject(4, 5);
    bridge.spawnAgent(1, 2, 50);
    const kinds = bridge.kinds();
    expect(kinds[0]).toBe(1);
    expect(kinds[1]).toBe(0);
  });

  it('moves an agent toward the fridge over ticks', () => {
    const bridge = new SimBridge(new SimHandle(16, 16));
    bridge.spawnObject(12, 1);
    bridge.spawnAgent(1, 1, 20);

    const startX = bridge.positions()[2];
    for (let i = 0; i < 40; i++) bridge.tick();
    const endX = bridge.positions()[2];

    expect(endX).toBeGreaterThan(startX);
  });

  it('survives memory growth from many spawns', () => {
    const bridge = new SimBridge(new SimHandle(64, 64));
    for (let i = 0; i < 2000; i++) {
      bridge.spawnAgent(i % 60, Math.floor(i / 60) % 60, 80);
    }
    expect(bridge.count).toBe(2000);
    // If views were cached across growth this reads zeroes or throws.
    const pos = bridge.positions();
    expect(pos.length).toBe(4000);
    expect(pos.some((v) => v !== 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test`
Expected: FAIL, cannot resolve `../src/bridge.js`

- [ ] **Step 3: Implement the bridge**

`web/src/bridge.ts`:

```ts
import { memory } from './wasm/terri_wasm_bg.wasm';
import type { SimHandle } from './wasm/terri_wasm.js';

/**
 * Zero-copy view over simulation state living in WASM linear memory.
 *
 * CRITICAL: WASM memory can grow, and growth DETACHES every existing
 * typed-array view over the old ArrayBuffer. A detached view reads as
 * empty or throws. Views are therefore constructed fresh on every access
 * rather than cached. Constructing a typed-array view is a pointer-plus-
 * length operation with no copying, so this is cheap; caching them is
 * the classic bug in this pattern, not an optimisation.
 *
 * See ARCHITECTURE.md [D11] and risk [R1].
 */
export class SimBridge {
  constructor(private readonly handle: SimHandle) {}

  tick(): void {
    this.handle.tick();
  }

  get count(): number {
    return this.handle.entity_count();
  }

  positions(): Float32Array {
    return new Float32Array(
      memory.buffer,
      this.handle.positions_ptr(),
      this.count * 2,
    );
  }

  prevPositions(): Float32Array {
    return new Float32Array(
      memory.buffer,
      this.handle.prev_positions_ptr(),
      this.count * 2,
    );
  }

  kinds(): Uint32Array {
    return new Uint32Array(memory.buffer, this.handle.kinds_ptr(), this.count);
  }

  spawnAgent(x: number, y: number, hunger: number): void {
    this.handle.spawn_agent(x, y, hunger);
  }

  spawnObject(x: number, y: number): void {
    this.handle.spawn_object(x, y);
  }

  worldHash(): bigint {
    return this.handle.world_hash();
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test`
Expected: PASS, `4 passed`

If the `memory` import fails, `wasm-pack --target web` may not re-export it from the `_bg.wasm` module in the installed version. In that case capture the `WebAssembly.Memory` from the value returned by `init()` and pass it into `SimBridge`'s constructor instead. The zero-copy contract and the no-caching rule are unchanged.

- [ ] **Step 5: Commit**

```bash
git add web && git commit -m "Add zero-copy TypeScript bridge over WASM memory

Views are constructed fresh on every access rather than cached, because
WASM memory growth detaches existing typed-array views and a detached
view silently reads empty. A regression test spawns 2000 entities to
force growth and would catch a reintroduced cache.

This is the boundary flagged as [R1], and it is why M0 exists."
```

---

### Task 10: WebGPU device and instanced quad pipeline

**Files:**
- Create: `web/src/render/device.ts`, `web/src/render/sprites.wgsl`, `web/src/render/sprites.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `initDevice(canvas: HTMLCanvasElement): Promise<GpuContext>` where `GpuContext = { device, context, format }`; `class SpriteRenderer` with `constructor(gpu: GpuContext)`, `draw(instances: Float32Array, count: number): void`

Instance layout is 4 floats per entity: `[screenX, screenY, depth, kind]`.

- [ ] **Step 1: Implement device initialization**

`web/src/render/device.ts`:

```ts
export interface GpuContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}

export async function initDevice(
  canvas: HTMLCanvasElement,
): Promise<GpuContext> {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.');
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('No WebGPU adapter found.');
  }
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Could not acquire a WebGPU canvas context.');
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });
  return { device, context, format };
}
```

- [ ] **Step 2: Write the shader**

`web/src/render/sprites.wgsl`:

```wgsl
struct Uniforms {
  viewport: vec2<f32>,
  tileSize: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) color: vec3<f32>,
};

// Two triangles forming a unit quad centred on the origin.
const CORNERS = array<vec2<f32>, 6>(
  vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(-0.5, 0.5),
  vec2f(-0.5,  0.5), vec2f(0.5, -0.5), vec2f( 0.5, 0.5),
);

@vertex
fn vs(
  @builtin(vertex_index) vi: u32,
  @location(0) instance: vec4<f32>,
) -> VertexOut {
  let corner = CORNERS[vi] * u.tileSize;
  let screen = instance.xy + corner;

  // Screen pixels to clip space. Y is flipped because screen space
  // grows downward and clip space grows upward.
  let clipXy = vec2f(
    screen.x / u.viewport.x * 2.0 - 1.0,
    1.0 - screen.y / u.viewport.y * 2.0,
  );

  var out: VertexOut;
  out.clip = vec4f(clipXy, instance.z, 1.0);
  // kind 0 = agent (warm), kind 1 = smart object (cool).
  out.color = select(vec3f(0.95, 0.55, 0.35), vec3f(0.35, 0.65, 0.85), instance.w > 0.5);
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  return vec4f(in.color, 1.0);
}
```

- [ ] **Step 3: Implement the renderer**

`web/src/render/sprites.ts`:

```ts
import type { GpuContext } from './device.js';
import shaderSource from './sprites.wgsl?raw';

const FLOATS_PER_INSTANCE = 4;
const VERTICES_PER_QUAD = 6;
const INITIAL_CAPACITY = 4096;

/**
 * Draws every entity in a single instanced draw call. Depth comes from
 * the instance's z, so no CPU-side sorting is needed. See [D10]: at
 * 100k objects, not sorting beats sorting well.
 */
export class SpriteRenderer {
  private pipeline: GPURenderPipeline;
  private instanceBuffer: GPUBuffer;
  private capacity = INITIAL_CAPACITY;
  private uniformBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private depthTexture: GPUTexture | null = null;

  constructor(private readonly gpu: GpuContext) {
    const module = gpu.device.createShaderModule({ code: shaderSource });

    this.pipeline = gpu.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: FLOATS_PER_INSTANCE * 4,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [{ format: gpu.format }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    this.instanceBuffer = gpu.device.createBuffer({
      size: this.capacity * FLOATS_PER_INSTANCE * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.uniformBuffer = gpu.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = gpu.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  private ensureCapacity(count: number): void {
    if (count <= this.capacity) return;
    while (this.capacity < count) this.capacity *= 2;
    this.instanceBuffer.destroy();
    this.instanceBuffer = this.gpu.device.createBuffer({
      size: this.capacity * FLOATS_PER_INSTANCE * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  private ensureDepth(width: number, height: number): GPUTexture {
    if (
      this.depthTexture &&
      this.depthTexture.width === width &&
      this.depthTexture.height === height
    ) {
      return this.depthTexture;
    }
    this.depthTexture?.destroy();
    this.depthTexture = this.gpu.device.createTexture({
      size: { width, height },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    return this.depthTexture;
  }

  draw(instances: Float32Array, count: number): void {
    if (count === 0) return;
    this.ensureCapacity(count);

    const canvas = this.gpu.context.canvas as HTMLCanvasElement;
    this.gpu.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Float32Array([canvas.width, canvas.height, 24, 24]),
    );
    this.gpu.device.queue.writeBuffer(
      this.instanceBuffer,
      0,
      instances,
      0,
      count * FLOATS_PER_INSTANCE,
    );

    const depth = this.ensureDepth(canvas.width, canvas.height);
    const encoder = this.gpu.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.gpu.context.getCurrentTexture().createView(),
          clearValue: { r: 0.09, g: 0.09, b: 0.11, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.instanceBuffer);
    // One draw call for every entity on screen.
    pass.draw(VERTICES_PER_QUAD, count);
    pass.end();

    this.gpu.device.queue.submit([encoder.finish()]);
  }
}
```

- [ ] **Step 4: Verify it type-checks**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

If `?raw` imports are unrecognised, add `/// <reference types="vite/client" />` at the top of `web/src/render/sprites.ts`.

- [ ] **Step 5: Commit**

```bash
git add web && git commit -m "Add WebGPU device setup and instanced sprite pipeline

Every entity is drawn in a single instanced draw call, with depth taken
from the instance rather than from CPU-side sorting, per [D10]. The
instance buffer grows by doubling so entity count changes do not
reallocate per frame."
```

---

### Task 11: Isometric projection

**Files:**
- Create: `web/src/render/iso.ts`, `web/tests/iso.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `worldToScreen(wx: number, wy: number, originX: number, originY: number): [number, number]`, `worldDepth(wx: number, wy: number, gridSize: number): number`, constants `TILE_HALF_WIDTH = 32`, `TILE_HALF_HEIGHT = 16`

- [ ] **Step 1: Write the failing tests**

`web/tests/iso.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  worldToScreen,
  worldDepth,
  TILE_HALF_WIDTH,
  TILE_HALF_HEIGHT,
} from '../src/render/iso.js';

describe('isometric projection', () => {
  it('maps the origin to the screen origin', () => {
    expect(worldToScreen(0, 0, 0, 0)).toEqual([0, 0]);
  });

  it('moves +x up and to the right', () => {
    const [x, y] = worldToScreen(1, 0, 0, 0);
    expect(x).toBe(TILE_HALF_WIDTH);
    expect(y).toBe(TILE_HALF_HEIGHT);
  });

  it('moves +y up and to the left', () => {
    const [x, y] = worldToScreen(0, 1, 0, 0);
    expect(x).toBe(-TILE_HALF_WIDTH);
    expect(y).toBe(TILE_HALF_HEIGHT);
  });

  it('applies the screen origin offset', () => {
    expect(worldToScreen(0, 0, 640, 360)).toEqual([640, 360]);
  });

  it('gives farther tiles smaller depth so they draw behind', () => {
    expect(worldDepth(0, 0, 64)).toBeLessThan(worldDepth(10, 10, 64));
  });

  it('keeps depth inside the clip range', () => {
    expect(worldDepth(0, 0, 64)).toBeGreaterThanOrEqual(0);
    expect(worldDepth(63, 63, 64)).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test`
Expected: FAIL, cannot resolve `../src/render/iso.js`

- [ ] **Step 3: Implement the projection**

`web/src/render/iso.ts`:

```ts
/**
 * Fixed isometric projection. The camera angle never changes, which is
 * what makes props need no LODs, no back faces, and no normals. See
 * TECH_STACK.md [G2].
 */

export const TILE_HALF_WIDTH = 32;
export const TILE_HALF_HEIGHT = 16;

/** Converts world tile coordinates to screen pixels. */
export function worldToScreen(
  wx: number,
  wy: number,
  originX: number,
  originY: number,
): [number, number] {
  return [
    (wx - wy) * TILE_HALF_WIDTH + originX,
    (wx + wy) * TILE_HALF_HEIGHT + originY,
  ];
}

/**
 * Depth for the depth buffer, in [0, 1]. Tiles farther from the camera
 * (lower x + y) get smaller values and therefore draw behind, since the
 * pipeline compares with 'less'. Using the depth buffer avoids sorting
 * entirely, which matters at high object counts.
 */
export function worldDepth(wx: number, wy: number, gridSize: number): number {
  const maxSum = Math.max(1, (gridSize - 1) * 2);
  return Math.min(1, Math.max(0, (wx + wy) / maxSum));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test`
Expected: PASS, `10 passed`

- [ ] **Step 5: Commit**

```bash
git add web && git commit -m "Add fixed isometric projection and depth mapping

Depth is derived from world position and written to the depth buffer
rather than sorted on the CPU, so object count does not add sorting cost."
```

---

### Task 12: Fixed-timestep driver and render interpolation

**Files:**
- Create: `web/src/main.ts` (replacing the Task 1 placeholder), `web/src/frame.ts`, `web/tests/frame.test.ts`

**Interfaces:**
- Consumes: `SimBridge`, `SpriteRenderer`, `worldToScreen`, `worldDepth`
- Produces: `buildInstances(bridge, alpha, originX, originY, gridSize): Float32Array`, `class FixedStepDriver` with `constructor(tickHz: number, maxTicksPerFrame: number)`, `advance(deltaMs: number, onTick: () => void): number`

`advance` returns the interpolation alpha in `[0, 1)`.

- [ ] **Step 1: Write the failing tests**

`web/tests/frame.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FixedStepDriver, lerp } from '../src/frame.js';

describe('FixedStepDriver', () => {
  it('runs one tick per 100ms at 10Hz', () => {
    const driver = new FixedStepDriver(10, 5);
    let ticks = 0;
    driver.advance(100, () => ticks++);
    expect(ticks).toBe(1);
  });

  it('accumulates partial frames instead of dropping them', () => {
    const driver = new FixedStepDriver(10, 5);
    let ticks = 0;
    driver.advance(60, () => ticks++);
    expect(ticks).toBe(0);
    driver.advance(60, () => ticks++);
    expect(ticks).toBe(1);
  });

  it('returns an interpolation alpha between 0 and 1', () => {
    const driver = new FixedStepDriver(10, 5);
    const alpha = driver.advance(150, () => {});
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
    expect(alpha).toBeCloseTo(0.5, 5);
  });

  it('clamps runaway catch-up to avoid a death spiral', () => {
    const driver = new FixedStepDriver(10, 5);
    let ticks = 0;
    driver.advance(10_000, () => ticks++);
    expect(ticks).toBe(5);
  });
});

describe('lerp', () => {
  it('interpolates linearly', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test`
Expected: FAIL, cannot resolve `../src/frame.js`

- [ ] **Step 3: Implement the driver and instance builder**

`web/src/frame.ts`:

```ts
import type { SimBridge } from './bridge.js';
import { worldToScreen, worldDepth } from './render/iso.js';

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Fixed-timestep accumulator. The simulation always advances in whole
 * ticks of identical duration; only the number of ticks per frame varies.
 * This is [D2], and it is what keeps the simulation deterministic.
 *
 * Speed controls will multiply ticks per frame. They must never change
 * the tick duration.
 */
export class FixedStepDriver {
  private accumulatorMs = 0;
  private readonly stepMs: number;

  constructor(
    tickHz: number,
    private readonly maxTicksPerFrame: number,
  ) {
    this.stepMs = 1000 / tickHz;
  }

  /** Runs due ticks and returns the interpolation alpha in [0, 1). */
  advance(deltaMs: number, onTick: () => void): number {
    this.accumulatorMs += deltaMs;
    let ticks = 0;
    while (this.accumulatorMs >= this.stepMs && ticks < this.maxTicksPerFrame) {
      onTick();
      this.accumulatorMs -= this.stepMs;
      ticks++;
    }
    // If the tick budget was exhausted, discard the backlog rather than
    // carrying it forward, which would spiral on a slow machine.
    if (ticks >= this.maxTicksPerFrame) {
      this.accumulatorMs = 0;
    }
    return this.accumulatorMs / this.stepMs;
  }
}

const FLOATS_PER_INSTANCE = 4;
let scratch = new Float32Array(0);

/**
 * Builds the GPU instance array by interpolating between the previous
 * and current simulation ticks. The scratch buffer is reused across
 * frames so no allocation happens in the render loop.
 */
export function buildInstances(
  bridge: SimBridge,
  alpha: number,
  originX: number,
  originY: number,
  gridSize: number,
): Float32Array {
  const count = bridge.count;
  const needed = count * FLOATS_PER_INSTANCE;
  if (scratch.length < needed) {
    scratch = new Float32Array(needed);
  }

  // Views are re-read every frame on purpose; see the detachment note
  // in bridge.ts.
  const cur = bridge.positions();
  const prev = bridge.prevPositions();
  const kinds = bridge.kinds();

  for (let i = 0; i < count; i++) {
    const wx = lerp(prev[i * 2], cur[i * 2], alpha);
    const wy = lerp(prev[i * 2 + 1], cur[i * 2 + 1], alpha);
    const [sx, sy] = worldToScreen(wx, wy, originX, originY);
    const o = i * FLOATS_PER_INSTANCE;
    scratch[o] = sx;
    scratch[o + 1] = sy;
    scratch[o + 2] = worldDepth(wx, wy, gridSize);
    scratch[o + 3] = kinds[i];
  }

  return scratch;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test`
Expected: PASS, `15 passed`

- [ ] **Step 5: Wire up the entry point**

`web/src/main.ts`:

```ts
import init, { SimHandle } from './wasm/terri_wasm.js';
import { SimBridge } from './bridge.js';
import { initDevice } from './render/device.js';
import { SpriteRenderer } from './render/sprites.js';
import { FixedStepDriver, buildInstances } from './frame.js';

const GRID = 32;
const TICK_HZ = 10;
const MAX_TICKS_PER_FRAME = 5;

async function main(): Promise<void> {
  await init();

  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) throw new Error('Canvas #stage not found.');

  const gpu = await initDevice(canvas);
  const renderer = new SpriteRenderer(gpu);
  const bridge = new SimBridge(new SimHandle(GRID, GRID));

  bridge.spawnObject(24, 20);
  bridge.spawnAgent(2, 3, 25);

  const driver = new FixedStepDriver(TICK_HZ, MAX_TICKS_PER_FRAME);
  const originX = canvas.width / 2;
  const originY = 80;
  let last = performance.now();

  function frame(now: number): void {
    const delta = now - last;
    last = now;
    const alpha = driver.advance(delta, () => bridge.tick());
    const instances = buildInstances(bridge, alpha, originX, originY, GRID);
    renderer.draw(instances, bridge.count);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

void main();
```

- [ ] **Step 6: Run the app and confirm the loop works visually**

Run: `cd web && npm run dev`

Open the printed URL. Expected: a dark canvas with one blue diamond (the fridge) and one orange diamond (the sim). The orange one moves toward the blue one, pauses while eating, then idles. Movement must look smooth, not stepped at 10 Hz; if it is stepped, interpolation is not being applied.

- [ ] **Step 7: Commit**

```bash
git add web && git commit -m "Add fixed-timestep driver, render interpolation, and entry point

The simulation advances in whole 10Hz ticks while rendering runs at
display refresh and interpolates between the last two ticks, per [D2].
Tick catch-up is clamped so a slow frame cannot spiral.

The instance array is built into a reused scratch buffer so the render
loop allocates nothing per frame."
```

---

### Task 13: Performance harness and the M0 exit criterion

The gate. **The whole milestone exists to answer this question**, and if the answer is bad, the bridge design is what changes.

**Files:**
- Create: `web/src/perf.ts`
- Modify: `web/src/main.ts`

**Interfaces:**
- Consumes: everything
- Produces: `class FrameTimer` with `sample(ms: number): void`, `get p95(): number`, `get mean(): number`, `report(): string`

- [ ] **Step 1: Write the failing test**

`web/tests/perf.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FrameTimer } from '../src/perf.js';

describe('FrameTimer', () => {
  it('reports the mean of its samples', () => {
    const t = new FrameTimer(100);
    for (const v of [10, 20, 30]) t.sample(v);
    expect(t.mean).toBeCloseTo(20, 5);
  });

  it('reports p95 above the bulk of samples', () => {
    const t = new FrameTimer(200);
    for (let i = 0; i < 100; i++) t.sample(i < 95 ? 10 : 100);
    expect(t.p95).toBeGreaterThanOrEqual(10);
    expect(t.p95).toBeLessThanOrEqual(100);
  });

  it('keeps only the most recent samples', () => {
    const t = new FrameTimer(3);
    for (const v of [100, 100, 100, 1, 1, 1]) t.sample(v);
    expect(t.mean).toBeCloseTo(1, 5);
  });

  it('reports zero before any sample', () => {
    expect(new FrameTimer(10).mean).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npm test`
Expected: FAIL, cannot resolve `../src/perf.js`

- [ ] **Step 3: Implement the timer**

`web/src/perf.ts`:

```ts
/** Rolling frame-time statistics for the M0 exit criterion. */
export class FrameTimer {
  private samples: number[] = [];

  constructor(private readonly capacity: number) {}

  sample(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > this.capacity) {
      this.samples.shift();
    }
  }

  get mean(): number {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  /**
   * p95 matters more than mean here. A good average with a bad tail
   * still reads as stutter to the player.
   */
  get p95(): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.min(
      sorted.length - 1,
      Math.floor(sorted.length * 0.95),
    );
    return sorted[idx];
  }

  report(): string {
    return `mean ${this.mean.toFixed(2)}ms  p95 ${this.p95.toFixed(2)}ms`;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npm test`
Expected: PASS, `19 passed`

- [ ] **Step 5: Add the stress mode to the entry point**

In `web/src/main.ts`, add the import:

```ts
import { FrameTimer } from './perf.js';
```

Replace the two spawn lines with:

```ts
  // ?stress=1000 spawns idle entities to exercise the M0 exit criterion.
  const stress = Number(new URLSearchParams(location.search).get('stress') ?? 0);
  bridge.spawnObject(24, 20);
  bridge.spawnAgent(2, 3, 25);
  for (let i = 0; i < stress; i++) {
    // Hunger is high so these stay idle and do not all path at once;
    // this measures render and bridge throughput, not pathfinding.
    bridge.spawnAgent(i % GRID, Math.floor(i / GRID) % GRID, 100);
  }
```

Add the timer, declared before `frame`:

```ts
  const timer = new FrameTimer(240);
  let lastReport = performance.now();
```

And inside `frame`, after `renderer.draw(...)`:

```ts
    timer.sample(performance.now() - now);
    if (now - lastReport > 2000) {
      lastReport = now;
      console.log(`entities ${bridge.count}  ${timer.report()}`);
    }
```

- [ ] **Step 6: Measure the exit criterion**

Run: `cd web && npm run build && npm run preview`

Open the preview URL with `?stress=1000` appended. Let it run 30 seconds and read the console.

**Exit criterion: p95 frame time at or under 16.6ms with 1,000 entities**, measured on a release build (not `npm run dev`, which is unoptimized).

Also confirm in devtools that memory does not climb steadily over 60 seconds. A steady climb means something allocates per frame, most likely a typed-array view or instance array escaping the scratch buffer.

- [ ] **Step 7: If the criterion fails, diagnose in this order**

Do not optimize blindly. Check, in order:

1. **Is it the bridge or the GPU?** Comment out `renderer.draw(...)` and re-measure. If frame time collapses, the cost is rendering. If not, it is the bridge or the sim, which is [R1] and the more serious finding.
2. **Per-frame allocation.** Take a devtools allocation profile. `buildInstances` must reuse its scratch buffer, and no per-entity JS objects may be created anywhere.
3. **Release build.** Confirm `wasm-pack build --release` was used. A debug WASM build is easily 10x slower and has produced false alarms here.
4. **Draw call count.** Should be exactly one per frame. More means instancing is broken.

Record the result either way. **A failure here is a legitimate and valuable M0 outcome** - it means the bridge design needs revisiting before M1 builds on it, which is precisely what this milestone was for.

- [ ] **Step 8: Commit**

```bash
git add web && git commit -m "Add frame-time harness and M0 stress mode

Adds a rolling frame timer reporting mean and p95, plus a ?stress=N query
parameter that spawns idle entities. p95 is the number that matters: a
good average with a bad tail still reads as stutter.

This is the M0 exit gate. It exists to make the WASM/JS bridge fail early
if it is going to, rather than at M3 when a real game depends on it."
```

---

## Definition of done

- [ ] `cargo test --workspace` passes
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` is clean
- [ ] `cd web && npm test` passes
- [ ] CI is green, including the check that `terri-core` and `terri-sim` have no web dependencies
- [ ] The determinism test passes: 500 ticks from an identical scenario twice yields an identical world hash
- [ ] In a browser, a hungry sim paths to the fridge, eats, and recovers, with visibly smooth movement rather than 10 Hz stepping
- [ ] **p95 frame time at or under 16.6ms with 1,000 entities on a release build**, or a written finding explaining why not and what it implies for the bridge design
- [ ] Memory is stable over 60 seconds of runtime

## What M0 deliberately does not include

Recorded so scope creep is visible rather than accidental. Each belongs to a later milestone in FEATURES.md.

- Multiple needs, moods, moodlets, or traits (M1)
- Build or buy mode, or any UI at all (M1)
- Textures, sprites, or real art. M0 draws flat coloured quads on purpose.
- Save and load (M1)
- Multiple rooms, portal-graph pathfinding, or lot streaming (M3)
- Simulation LOD tiers (M3)
- Parallel system scheduling (deferred; single-threaded keeps determinism free)
- Content files. M0 hardcodes the one smart object; TOML loading is M1.
