# Bathtub quarter-turn implementation plan

**Goal:** Rotate the existing bathtub without resetting saved households.

**Architecture:** Change the shared bathtub definition to 1x2 and use its
existing SW art. A narrow, transactional source-to-destination migration
updates old collision and affected navigation before restoring the world.

**Tech stack:** Existing Rust simulation, postcard Save V1, TypeScript/WebGPU.

**Spec:** `docs/superpowers/specs/2026-09-20-interior-layout-design.md`.

## Constraints

No dependency changes, paid requests, user-save deletion, unrelated assets,
or writes outside the isolated checkout. Preserve all unaffected simulation
state. Do not restart cancelled full mutation sweeps for this task.

## Content and runtime proof

1. Add `crates/terri-data/tests/bathroom_layout.rs`, asserting the compiled
   bathtub has footprint `{ width: 1, depth: 2 }`, origin `(14,9)` and SW
   sprite 1123. Run `cargo test -p terri-data --test bathroom_layout -j 2`;
   observe failure against the old footprint before editing content.
2. Change the bathtub footprint and default sprite in `content/objects.toml`.
   Keep the authored origin unchanged and do not apply a second facing in
   `content/lot.toml`. Assert the default sprite is also 1123 so non-authored
   tubs cannot retain SE art over a 1x2 collision strip. Repeat the focused test.
3. Add a public byte-loader test in `crates/terri-wasm/src/lib.rs`: encode a
   V1 snapshot with old structural digest `a020602a6acd3a90` and old blocked
   cells, load it, assert the new grid and preserved entities, then compare
   300 ticks after resave/reload. Observe rejection before migration exists.

## Transactional save migration

1. Implement in a child module of `crates/terri-sim/src/save.rs`, keeping
   generic validation unchanged. Reconstruct and recognize the reviewed old
   content shape and independently frozen static layout, validate the input,
   rotate collision, reroute affected paths
   and relocate invalid active approaches, then validate the result.
2. Test ordinary saves, legacy bridges, active baths, newly blocked agent
   positions, crossing paths, retained queues/timers, idempotence and rejection
   without mutation. Test all realistic boundary branches locally.
3. Run Rust tests, format/clippy, web tests/typecheck and release builds once
   on the completed batch. Obtain independent review of code and live visuals.

## Publication

Document actual evidence and residual limits. Commit only the scoped files,
fetch and inspect main, publish the reviewed change using normal Git commands,
and verify the exact deployed revision and public assets. Do not conflate a
source merge with live deployment. Interior wall conversion remains the next
separate implementation under the same owner-approved layout work.
