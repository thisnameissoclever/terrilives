# Sim details: personality and habits

This is the first read-only slice of [S-sim-details] in `GAME-SYSTEMS.md`.
It fits the approved compact HUD: world controls on the left, Sim information
at the bottom, with detail available on request.

## Player behavior

Overview contains a native Personality, habits and bed disclosure, initially
closed. Its 44-pixel summary responds to Enter, Space and pointer input. The
existing sheet owns scrolling and Escape; the closed dock gains no height.
The original read-only slice shipped as Personality and habits. Its local
bed-assignment extension and remaining release checks are documented in
`2026-10-01-bed-assignment.md`.

1. Personality factors show Drain and Refill percentages for all seven needs.
   100% is the normal personality factor. These values do not incorporate
   work, sleep or traits. Refill means positive need recovery, not lifetime
   satisfaction; costs are not scaled by that factor.
2. Sleep rhythm converts the stored signed offset using the content pack's
   day length. Negative means earlier, positive later, and a saved zero means
   the usual schedule. This is a tendency, not a promised bedtime.
3. Repeated activities show recent repetition from 0 to 100%, rounded to a
   whole percentage. Each meter has its own accessible name and visible
   number. Repetition changes activity appeal, fades over time and is shared
   by objects of the same definition. Ordinary interactions and chains use
   their authored labels. A placed instance need not survive for history to
   remain readable. Tiny positive values can round to 0% before disappearing.

Opening the disclosure forces current values. Closed or hidden sections do
no periodic reads. Successful Load forces a refresh even if the entity index
has not changed. Missing selections and missing people clear old rows.

This does not add controls, personality identity, saved state, commands or
new simulation behavior. Future sensitivities, skills and editing remain
their own roadmap work. Traits and People retain their existing panels.

## Data contract

`Sim::details_of` requires Agent and Personality; Habituation is optional.
History is already stored in canonical object-definition/activity-row order.
Rows with no positive repetition or missing content metadata are omitted.
Chain rows follow the object's ordinary interaction rows and are resolved
only among chains advertised by that definition.

The two WASM exports accept an f64 entity index and validate it as u32 before
conversion. The numeric array is:

```
[sleep offset ticks, drain x7, refill x7, (object definition, activity row, repetition) ...]
```

The text array is `[object type, activity label, ...]`, aligned to repetition
rows. Both arrays are copies. The bridge validates lengths, integral keys and
offset, finite nonnegative factors and repetition within 0..1. It uses stable
`object:activity` keys for reused DOM rows. No archetype is inferred from
numeric factors.

## Verification

Personal details and the bed-assignment controls retain unchanged text nodes
across visible refreshes. Changed factors, sleep timing, repetition, assignment,
occupancy and status still update in the same refresh. Surface regression tests
cover both behaviors; these controls alone are not a whole-game memory result.

Local evidence is retained in `.tmp/sim-details/` for this worktree.

1. `cargo test --workspace -- --test-threads=1`: PASS, exit 0, 1,221 tests.
2. `npm test -- --maxWorkers=1`: PASS, exit 0, 1,467 tests in 105 files,
   including the real release WASM bridge.
   `npm run typecheck` and `npm run build`: PASS, exit 0.
   `cargo clippy --workspace --all-targets -- -D warnings`,
   `cargo fmt --all -- --check`, `python check-doc-ids.py`, and the 15 CI
   script tests also passed with exit 0. `wasm-pack build crates/terri-wasm
   --target web --out-dir ../../web/src/wasm` passed. The two new boundary
   tests passed again with `cargo test -p terri-wasm --release
   sim_details_tests -- --test-threads=1`, proving release-mode validation.
3. Targeted manual faults: 31 caught by named assertion failures. Tests caught
   swapped factors, wrong chain owners/order, signed-offset precision loss,
   removed numeric/label guards, wrong selected Sim, stale rows, missing Load
   refresh, closed-panel reads, wrong percentages and an open default.
   Every source file was restored byte-for-byte after each fault; hashes,
   commands, exit codes and failure output are in `faults/results.json` and
   the corresponding logs. The production functions are read-only by Rust
   borrowing; snapshot tests also check unchanged serialized state.
4. Displayed browser play: 1280x800, 360x640 and 640x400. The section began
   closed; Enter and Space toggled it; the last row was reachable without
   horizontal overflow; Escape returned focus to Sim details. Switching
   Tim -> Bill -> Casey changed factors and removed the previous person's
   habits. Activities generated and decayed repetition during play. Loading
   the earlier local save restored Bill at Day 1, 03:07 and removed Casey's
   later rows. No browser warnings or errors. Screenshots and browser notes
   are in the evidence directory. The task-owned tab and server were closed.

These browser sizes are responsive viewport checks, not a physical phone or
spoken screen-reader acceptance pass. Table header scopes and meter names
have automated and accessibility-tree evidence.
