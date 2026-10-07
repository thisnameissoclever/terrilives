# Hand washing at both sinks, 2026-10-06

Base revision: `537ec40cee9677b818c071a19a1df1a4785af66a` (main after the bath batch).
This record covers the standing hand-washing presentation at the bathroom
sink and the kitchen sink. It ships no new art.

## Decision

The missing-animation audit found both sinks' Wash hands drawing the standing
idle. The only wash clip in the atlas (`rigSimWash*` and its blue and red
palettes) carries a ceramic plate baked into every frame, so it cannot serve
hand washing. On 2026-10-07 UTC the owner chose to reuse the prepare clip,
which keeps the hands working together at waist height with no props, and
deferred a dedicated hand-washing clip to a later art batch.

## Contract and runtime

Both sinks' interactions declare `visual = { action = "wash", anchor =
"object", facing = "toward_anchor" }` in `content/objects.toml`. The compiler
accepts `wash` on an object interaction with the `object` anchor and
`toward_anchor` facing and no socket; `station` anchoring remains the chain
steps' form. The simulation maps that contract to render action code 21
(`visual_action::WASH_HANDS`) with the `WASHING_HANDS` activity through the
same object-facing projection as standing reading and aquarium watching, so
the body stands on its own tile facing the sink's footprint centre. Code 20
stays reserved for the shower. Gameplay duration, Hygiene gain, privacy and
the save fingerprint are unchanged, pinned by
`the_shipped_sinks_carry_the_exact_standing_wash_contract`.

The web renderer draws code 21 with the prepare clip (four frames per facing,
ten ticks per half cycle) and holds the rest frame under reduced motion. A
later hand-washing clip replaces one table entry without touching content.

## Verification

1. `cargo test --workspace -j 2`, `cargo fmt --all -- --check` and
   `cargo clippy --workspace --all-targets -j 2 -- -D warnings`: passed. The
   shipped-interaction table and the Load rebuild test now expect code 21
   for both sinks; the distinctness test uses the shower as its generic
   example because the sink is no longer generic.
2. `wasm-pack build` rebuilt the package; `npm --prefix web test --
   --maxWorkers=1`, typecheck and production build: passed.
   `web/tests/wash-hands-production.test.ts` checks the clip for every shirt
   and facing, compiled use through the WebAssembly bridge at both sinks,
   save and load restoring the drawn pose, and cancellation clearing it. The
   bridge wire test now carries the literal body action 21 beside activity 16.
3. Changelog tests and build, document identifiers: passed.
4. Played in a task-owned game served from this worktree at the
   `127.0.0.1:5174` origin in the browser pane: Casey was ordered to Wash
   hands at Basin, Communal through its menu, walked from the living room,
   stood on the tile beside the basin facing it with the hand-washing bubble
   above her and her hands working at waist height, and returned to deciding
   what to do when the wash ended. `wash-hands-played.png` shows the paused
   wash; `wash-hands-after-played.png` shows the same frame after it ended.
   The browser tab and the dev server were closed afterwards.

Source review and local runtime proof do not establish public deployment.
