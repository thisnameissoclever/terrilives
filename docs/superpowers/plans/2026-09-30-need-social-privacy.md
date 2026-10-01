# Unmet needs and bathroom privacy implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Work in this confirmed isolated worktree; do not change another project's files.

**Goal:** Give inconvenient conversations and bathroom privacy violations directional affinity consequences, and document their interactions with needs, mood and life satisfaction.

**Architecture:** Rust records consequences at actual action starts and room crossings, then applies them through the existing Relationships component. Room regions derive from walls, windows and doorways; private-use classification comes from action content. Existing mood and satisfaction projections consume the resulting relationships without a second incident ledger.

**Tech Stack:** Existing Rust workspace, Bevy ECS, TOML content compiler, WASM bridge and TypeScript/Vitest browser shell. No new dependencies.

**Spec:** [Behavior and proposed balance](../../specs/2026-09-30-need-social-privacy.md). Read it before execution. Approved and implemented locally; the validation report records final evidence and delivery status.

## Global constraints

1. Worktree: `D:/VIBES/.worktrees/b770/terrilives`. Keep edits here and preserve other chats' changes.
2. No dependency additions, removals or upgrades without explicit owner permission.
3. Rust owns gameplay; browser projections do not invent affinity, room or satisfaction rules.
4. Relationships stay directional, keyed by stable SimId, sorted and clamped to -1 through +1.
5. No em dashes or substitute en dashes. Apply the three required writing skills; functional game copy stays literal and respects the existing owner review boundary.
6. Deterministic event order, bounded loops, compatible saves and causal mutation tests are required.
7. Close only task-owned game tabs in a finally block; stop only task-owned preview servers after verification.
8. Implementation, commit/push/merge and live deployment evidence are separate statuses. This planning request does not request publication.

## Review focus

1. A doorway permits walking without making two enclosed rooms one privacy region; furniture never partitions the room.
2. A start and an entry in the same tick must charge the direction matching their actual order, including deferred action components.
3. Under the owner's later reduced tuning, completion may recover a low-need start penalty; critical-need conversations retain a net loss at neutral shyness. helping the conversation's own needs must not count as obstructing them.
4. Loading, spawning, paused reads and layout edits must not manufacture entries or replay starts.
5. Several effects on one Sim must accumulate even when it had no Relationships component at phase start.

## File ownership and interfaces

| Files | Responsibility |
| --- | --- |
| `content/tuning.toml`; `crates/terri-data/src/{schema,pack,compile,error,lib}.rs` | Authored penalties, validation, fixtures and shipped-content assertions |
| `content/objects.toml` | Private-use tags on the three relevant actions |
| New `crates/terri-sim/src/room_regions.rs`; `crates/terri-sim/src/lib.rs` | Architecture-derived region helper and declaration |
| New `crates/terri-sim/src/systems/interpersonal.rs`; `systems/mod.rs` | Pure penalty selection, ordered events and affinity application |
| `crates/terri-sim/src/systems/movement.rs`; `crates/terri-sim/src/lib.rs` | Exact start/crossing hooks and schedule integration |
| `crates/terri-sim/src/{save,mood}.rs`; existing/new simulation tests | Replay, mood and satisfaction integration evidence |
| Relevant specs, `docs/GAME-SYSTEMS.md`, `docs/FEATURES.md` | Behavior, status and measured verification |

Proposed internal interfaces, implemented together with their owning tests:

```rust
// room_regions.rs; implementation uses the existing SavedLayout/TileGrid APIs.
pub(crate) struct RoomRegions { cells: Vec<Option<u32>>, width: usize }
impl RoomRegions {
    pub(crate) fn from_world(world: &bevy_ecs::world::World) -> Self;
    pub(crate) fn at(&self, tile: (i32, i32)) -> Option<u32>;
}

// systems/interpersonal.rs; no new public application boundary.
pub(crate) const PRIVATE_USE_TAG: &str = "bathroom_privacy";
pub(crate) struct AffinityEffect {
    pub offended: terri_core::SimId,
    pub responsible: terri_core::SimId,
    pub delta: f32,
}
pub(crate) fn unmet_need_penalty(
    levels: &[f32; 7],
    helped: &[bool; 7],
    low_level: f32,
    critical_level: f32,
    low_penalty: f32,
    critical_penalty: f32,
) -> f32;
```

`unmet_need_penalty` returns a nonnegative magnitude. Its caller records a negative delta. A movement-phase resource owns `Vec<AffinityEffect>` and is drained once after `follow_path`. Its context tracks each present Sim's region and active private use; build it before movement, update it inside movement in the existing walker order, then discard it after applying effects. Keep this context distinct from persistent world state.

### Task 1: Content tuning and need penalty selection

**Files:** Tuning/data files above; new `systems/interpersonal.rs` and its module declaration; `content/objects.toml`.

**Consumes:** Existing NeedId order, CompiledInteraction advertisements and tags, mood low/critical tuning and relationship completion gain.

**Produces:** The pure penalty function and these authored values:

```toml
social_unmet_need_penalty = 0.20
social_critical_need_penalty = 0.35
bathroom_privacy_penalty = 0.45
```

1. [x] Add causal table tests before production logic. Sample all-high, low, critical, threshold edges, several low needs and a helped critical need. A representative assertion is:

   ```rust
   let mut levels = [100.0; 7];
   levels[terri_core::NeedId::Bladder as usize] = 20.0;
   let mut helped = [false; 7];
   assert_eq!(unmet_need_penalty(&levels, &helped, 40.0, 20.0, 0.20, 0.35), 0.35);
   helped[terri_core::NeedId::Bladder as usize] = true;
   assert_eq!(unmet_need_penalty(&levels, &helped, 40.0, 20.0, 0.20, 0.35), 0.0);
   ```

2. [x] Run `cargo test -p terri-sim unmet_need -- --nocapture`; establish an actual failing assertion before adding the mechanism.
3. [x] Implement a single pass over the seven eligible levels: return the critical magnitude if any unhelped need is critical; otherwise the low magnitude if any is low; otherwise zero. Do not sum need penalties. Build `helped` only from positive advertisements of the selected conversation.
4. [x] Add the three fields through schema, compiled tuning, defaults, compiler and every explicit tuning fixture. Search all field/type references before editing. Reject NaN/infinity, negative or above-one magnitudes, and critical below low. Zero remains valid.
5. [x] Append `bathroom_privacy` to existing tags on `relieve_self`, `take_shower` and `soak`; preserve their advertisements, labels and other tags. Assert that sinks and ordinary seating are not tagged.
6. [x] Test shipped values against completion gain, and pin content/save compatibility. The current fingerprint deliberately excludes tags and tuning; prove these additions do not invalidate prior saves instead of broadening legacy bridges.
7. [x] Run `cargo test -p terri-data` and the targeted simulation tests. Delete the helped-need exclusion and swap critical/low classification separately; each must fail its causal test, then restore byte-identical production code.

### Task 2: Architecture-derived room regions

**Files:** New `room_regions.rs`; declaration in `lib.rs`; module-local tests.

**Consumes:** Current TileGrid dimensions and supported saved layout representations, including `SavedLayout::state_of`, `WallLine`, windows and doorway records.

**Produces:** `RoomRegions::from_world` and `RoomRegions::at` as specified above.

1. [x] Create a two-room fixture with a doorway and two occupied furniture footprints. Test equal regions inside each room, unequal regions across the doorway, and agreement between an object's anchor and its occupied tiles. Test an open-plan room with a toilet as one shared region.
2. [x] Run `cargo test -p terri-sim room_regions -- --nocapture`; confirm failure before adding region logic.
3. [x] Implement bounded row-major cardinal flood fill across architectural floor tiles. Cross only `WallState::Open`; a wall, window or doorway stops region traversal. Treat furniture tiles as belonging to the floor rather than as structural barriers. Exclude outside/non-floor cells using the existing lot representation, not occupancy alone. Reuse historical architecture conversion for supported legacy layouts.
4. [x] Define `at` to return None outside the region map. Tests cover a genuine missing-wall gap, a window, multi-tile bath, a yard/outside position and a layout rebuilt between ticks.
5. [x] Run the room tests. Delete the doorway barrier and the furniture-occupancy exemption separately; confirm each relevant test fails, then restore production code.

### Task 3: Ordered conversation and bathroom events

**Files:** `systems/interpersonal.rs`, `systems/movement.rs`, `systems/mod.rs`, `lib.rs`; focused integration tests colocated with the mechanism.

**Consumes:** RoomRegions, present Sim positions and identities, existing Eating/Target private uses, the tagged action classification and Task 1 magnitudes.

**Produces:** Ordered AffinityEffect records and their application before `tick_interactions`, `tick_social` and mood accrual.

1. [x] Build deterministic fixtures with two neutral Sims and controlled orders, rather than hoping autonomy chooses the event. Establish each initial affinity, trigger exactly one event and assert the changed ordered pair and unchanged reciprocal pair before any unrelated completion.
2. [x] Cover three fixtures: a critically unmet recipient at conversation start; an entrant while someone is already using private furniture; an observer present before private use starts. Cover toilet, shower and bathtub, plus a living-room toilet and several observers.
3. [x] Run the new tests and record their expected failures before adding hooks.
4. [x] Capture present occupants and active private users before `follow_path`. At each accepted action start or region transition, generate effects using the context at that point in existing entity-index order. Update context immediately when a private start is accepted, despite deferred Eating insertion. Record entry before private start when that is the actual movement order.
5. [x] For actual conversation starts, snapshot the recipient's needs before delivery and record `delta = -unmet_need_penalty(...)`. Do not charge queued orders, reservation attempts or approaches that fail arrival validation.
6. [x] At private-use start, record an effect from every existing observer toward the user. At room entry, record an effect from every current private user toward the entrant. Ignore self-pairs, absent regions and nonpresent Sims.
7. [x] Drain the ordered effects in a system immediately after movement. Resolve participants by stable SimId, apply through Relationships::bump, and create missing components without losing earlier effects. Keep event order where clamping can make order observable. Remove all phase-local data before public save/hash boundaries.
8. [x] Test zero penalty, lower-bound clamp, failed approach, canceled conversation after start, ordinary completion, remaining in the same room, leaving/reentering, two events on one initially component-less Sim, and both same-tick entry/start orders.
9. [x] Ensure no reservation, Target or cleanup ownership rules change. Retain the existing conversation-target ownership regression tests.
10. [x] Delete each hook and reverse one directed effect separately. The corresponding tests must fail. Restore the exact production bytes after every mutation.

### Task 4: Replay, downstream effects and documentation

**Files:** Save and mood integration tests; the specs and status docs listed above; shared relationship documentation if it has landed by execution time.

**Consumes:** Completed event application and the existing mood/satisfaction pipeline.

**Produces:** Behavioral evidence and a consolidated description of the interactions.

1. [x] Save before each event, reload and execute the same commands; compare exact relationship outcomes and hashes. Save after start, reload and continue; the start penalty must not recur. Repeat around room entry and canceled use.
2. [x] Prove no event occurs on load, paused reads, adding a housemate, moving furniture or editing a wall. The next genuine start/entry must use the updated layout.
3. [x] Pin ordinary positive completion together with the start penalty. Pin the owner's revised low/critical base magnitudes of 0.11/0.20: completion yields +0.04/-0.05 at neutral shyness, within normal clamping limits. Keep initiator gain and ordinary hobby payout intact.
4. [x] In a controlled fixture, compare mood near the newly disliked person with mood away from them. Advance the clock to prove the mood contribution reaches satisfaction once per tick and does not create an extra direct event charge. Assert actual causal differences, not merely matching replays.
5. [x] Update the household/relationship spec, mood-and-waiting spec, game-system entries and feature ledger. Integrate the parallel meal/cleanliness documentation from the approved repository history first; if `docs/SIM-RELATIONSHIPS.md` exists, use it as the shared overview and link this spec. Keep unimplemented waiting affinity, compatibility drift and fights marked planned.
6. [x] Record a lessons-learned entry only if implementation exposes a material correction or significant mistake; document its cause, prevention and verification.
7. [x] Run `python check-doc-ids.py`. Review authored prose with the required writing skills and scan changed text for prohibited dashes and unsupported implementation claims.

### Task 5: Required validation and review

1. [x] Run, sequentially, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace`. Record exact commands, exit codes and PASS/FAIL results. Do not overlap heavy commands with this chat's own other builds.
2. [x] Run the existing repository content/asset and purity checks required by `.github/workflows/ci.yml`; use the installed Windows Python command. Do not install tooling or dependencies to clear a failure without approval.
3. [x] Run `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`. In `web`, run `npm run typecheck`, `npm test -- --maxWorkers=1` and `npm run build` with existing installed dependencies.
4. [x] Run targeted mutation checks for directionality, threshold guards, event timing, room separation and replay. Report manual statement-deletion evidence separately from any automated mutation sweep.
5. [x] Run `cargo run --release -p terri-sim --example trace -- 120000` and inspect stuck Sims, need floors and relationship ranges. Do not accept pervasive household hostility merely because the single-event tests pass; report measured balance and any proposed retuning.
6. [x] Play controlled local scenarios for all three requested cases, including misplaced bathroom furniture, and observe relationship changes through the existing UI. Record observed evidence; do not treat unobserved browser acceptance as passed. Close task-owned tabs and stop the task-owned server in cleanup.
7. [x] Review the final diff against the spec's four requested behaviors and proposed interpretations. Resolve known failures before reporting implementation complete. Recommend execution in this chat because the hooks and phase context share one ordered mechanism; no implementation delegation is needed.
8. [x] Report changed behavior, documentation, test evidence, balance limits and remaining owner acceptance. Commit, push, merge and deployment verification follow only when those delivery actions are authorized.

## Owner scope amendments during implementation

1. Reduce the original 0.20/0.35/0.45 penalties by about one third; that pass used 0.13/0.23/0.30. The later request to lower them slightly more sets current values to 0.11/0.20/0.25.
2. Add slight autonomous avoidance, with explicit player commands still available.
3. Add shyness from 1 to 100. Higher shyness mildly strengthens avoidance and the offended person's response. Save, hash, bridge and selected-person panel expose the same stat.
4. Causal checks cover actual object/social selection, bounded wandering with safe/unsafe/unavailable alternatives, zero influence, victim direction, a numerical initialization golden and current/previous V5 byte loading.

Final evidence: [verification report](../../evidence/need-social-privacy/verification.md). All implementation steps completed; the full automated mutation sweep and release delivery remain separate. Long-run hostility remains documented rather than treated as passed balance acceptance.
