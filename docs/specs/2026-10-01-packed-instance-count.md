# Draw the exact packed instance prefix

## Goal and scope

Pack each rendered frame once and use the number of rows actually written.
The current loop packs instances, then repeats world-column reads, interaction
selection and an entity traversal to reconstruct the count. The two paths have
already drifted: floor-tool highlights are packed but omitted from the draw
count. Restore their intended display without changing simulation or saving.

This is an independent renderer correctness and performance change from main.
It does not import held ambience or toilet audio, change their memory contract,
or establish that the duplicated traversal caused the audio memory failure.

## Design

1. Add `buildInstanceBatch` with the existing `buildInstances` parameters and
   defaults. It returns a borrowed, module-owned `{ instances, count }` result.
   Both the result object and its high-water-mark array are reused; their
   contents are valid only until the next call through either building API.
2. The packing loop owns the count. It starts with the fixed entity rows and
   advances its slot for every actual portal, foreground, indicator, prop,
   selection marker, placement preview and tile highlight written. Capture
   `writeTileHighlight`'s returned slot. Publish count on every call, including
   smaller and empty frames. Refresh the array reference when storage grows.
3. Preserve `buildInstances` as an explicit-parameter forwarding wrapper that
   returns the batch's array, with no new per-call array, tuple or object.
   Preserve `instanceCount` for existing verification consumers, but remove
   its import and call from the production frame loop. No last-count global
   getter, reconstructed count or hidden secondary traversal is acceptable.
4. Production draws `batch.instances` with `batch.count` immediately. Keep its
   real tick, reduced-motion, interaction selection, colourway, camera, sky,
   lighting and wall-fade behavior. The renderer API and 16-float row layout
   remain unchanged. Never clear or inspect unused trailing capacity.
5. Preserve the current presentation rules. Fixed entity rows include hidden
   off-screen rows. Foregrounds, indicators and carried props have distinct
   suppression rules. Each portal adds two rows. Any drawable move preview
   replaces its original, including refused and nonoverlapping previews;
   an empty preview adds nothing. Selection ownership and exact eating props
   retain their current behavior. No art or geometry is reauthored.

## Verification

Use behavioral regression tests with independent expected counts and rows, not
only equality with the legacy counter. Cover combined extras, highlight-only
frames, portals, paired interactions, selection, refused/nonoverlapping moves,
held food, real tick/reduced motion and buffer growth followed by shrink/empty.
Pin stable batch identity and warm storage reuse. Instrument the real
InteractionSelection to prove one update with the actual arguments.

Verify the production draw boundary, including a floor-tool highlight reaching
the live uploaded prefix and absence of the old recount. Meaningful mutations
must fail assertions when final highlight/count/pointer updates are removed,
the result is freshly allocated, or the production recount returns.

Run focused tests while implementing, then one single-worker full web suite,
typecheck, production build, documentation IDs and whitespace. Reuse the verified
main-matching WASM artifact; no Rust or dependency changes are needed. Independent
task and whole-branch reviews precede delivery. Root must inspect the actual
game and builder floor/placement previews, including reduced motion and a
small viewport. Close task-owned pages and servers. Report the eliminated work
and observed browser results, not an unmeasured timing or audio-memory gain.
