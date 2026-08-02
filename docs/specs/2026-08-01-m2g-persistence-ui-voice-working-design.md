# M2g: persistence, readable UI, and the voice - working design

Status: persistence, shell storage, readable HUD, input discovery, and the
player-visible string inventory are built and locally verified. The
owner-authored voice pass remains open. Section IDs are stable and must not be
renumbered.

The last milestone of the alpha's eleven criteria: goal 9 (save and load), the
rest of goal 10 (readable UI), and goal 11 (the voice, authored WITH the owner
per [L58]). [D8] in `ARCHITECTURE.md` fixed the save model early; this
document cashes it in.

## [G1] A save is the complete resumable simulation, made nameful

The world hash is the minimum state two replays must agree on. A player-facing
save has a stricter job: it must resume the life the player was watching rather
than clear every action and ask the simulation to make a new decision. Version
1 therefore stores every current world resource, entity, component, entity
reference, and staged player command needed to continue the next tick.

- **World state:** compiled-content fingerprint, `SimClock::tick`, `Funds`, the
  `SimIdAllocator` counter, full `SimRng` state, lot dimensions and blocked
  tiles, and the ordered `CommandQueue`.
- **Every live entity:** original entity index, position, all persistent
  simulation components, marker components, and transient action state such as
  `Path`, `Target`, `Eating`, `Socialising`, `StepWork`, `Fumbled`, `Commuting`,
  `Blocked`, `Restless`, `Wander`, reservations, selection, and queued intents.
- **Content references are string ids:** objects, careers, traits, chains, and
  carried item kinds resolve against the current pack during validation. An
  `Entity` is similarly never persisted; entity references carry the saved
  entity index and are rebuilt against freshly spawned entities.

This is deliberately more complete than the earlier hash-row proposal. The
hash excludes random-number-generator state, allocator state, pending input,
selection, and transient action components. Immediate hash equality therefore
cannot prove save completeness. Acceptance requires direct snapshot equality
and continuation equivalence across hundreds of subsequent ticks.

`SpriteVariant` is not persisted as a raw atlas index. Facing is immutable
authored placement data in this alpha, so load re-derives it from the current
lot placement's object id and position. This decision expires when build mode
can move or rotate objects. That save schema must carry facing by a stable
authored name.

## [G2] Postcard behind a raw magic and version prefix, stored in OPFS

The WebAssembly boundary exposes `save_bytes() -> Vec<u8>` and transactional
`load_bytes(bytes) -> bool`. The shell owns file I/O, keeping browser APIs out
of the simulation crates.

The byte format is:

1. Eight raw magic bytes: `TERRISAV`.
2. A little-endian `u16` schema version outside the payload.
3. One postcard-encoded `SaveSnapshotV1` payload with no trailing bytes.

The external prefix lets a loader reject a future version before attempting to
decode a shape it cannot understand. The magic rejects unrelated files and
common corruption before allocation. Version 1 is the first migration hook;
the first incompatible schema change must bump it and decide whether to add a
migrator.

Storage is OPFS (Origin Private File System), per [D8], not `localStorage`.
Version 1 has one slot, an explicit Save button and Load button, and an
autosave on simulation-day cadence. Autosave starts during ordinary play and
is serialized with every manual save, load, and clear; an asynchronous write
begun only while the page is closing is not a save strategy, because browsers
are entirely within their rights to kill it halfway through. A visibility-loss
save is useful extra coverage, but it is never the sole write.

## [G3] Loading validates a fresh world and swaps only on success

Browser storage is untrusted input. `load_bytes` rejects all of the following
without mutating the running game:

1. Empty, truncated, oversized, corrupt, or trailing-byte payloads.
2. Wrong magic or unsupported schema version.
3. A content fingerprint different from the compiled pack in this build.
4. Invalid grid dimensions, multiplication overflow, mismatched blocked-tile
   count, excessive entity or list counts, and non-finite or out-of-range
   numeric state.
5. Unsorted or duplicate entity records, broken entity references, duplicate
   selection, duplicate stable sim ids, and an allocator counter that could
   reuse a restored id.
6. Missing object, career, trait, chain, item-kind, or interaction references.

Rejecting a content mismatch is intentional in version 1. Silently dropping a
job, dinner, or carried item makes a load appear successful while changing the
life being restored. A future migration can make narrower repairs once it has
a UI capable of naming each repair to the player.

Validation occurs before reconstruction. Reconstruction builds a fresh `Sim`,
restores references only against that candidate world, synchronizes its render
buffer, and swaps it into the live handle only after every step succeeds.

The verification set has three independent layers:

1. A rich snapshot round trip compares every saved field directly.
2. Native and WebAssembly handles continue for hundreds of ticks and remain
   identical after the save seam.
3. Each rejection case proves the already-running handle is unchanged.

## [G4] Readable UI, and where the voice slots in

Goal 10's remainder after A-11: the second axis and money are debug-only today,
and the game's one always-visible readout is the needs panel. Version 1 of the
real HUD stays deliberately small ahead of the voice pass:

- The selected sim's panel gains life satisfaction and, when employed, a work
  line.
- Household funds are always visible in the control cluster.
- Save and Load sit beside the speed controls, with visible success, failure,
  and autosave state. The shell reads `sim_tick()` and authored `day_ticks()`
  for simulation-day cadence; wall-clock time does not decide when a simulated
  day passed.

Button labels remain plain verbs until [G5]. Functional failure messages must
still be specific; a load that did nothing and says nothing is the same family
of defect as a click silently discarded.

## [G5] The voice pass is the owner's, scheduled last, scaffolded now

Goal 11 is dark comedy authored WITH the owner. The autonomous contribution is
scaffolding: an inventory of every player-visible string with the current plain
text beside a space for the owner's replacement. The pass itself is a session
with Tim, not an unsupervised attempt to be funny at him.

## Delivery sequence

1. Rust snapshot, validation, deterministic reconstruction, WASM byte methods,
   fixed-step tick accessor, and native/release-WASM verification.
2. OPFS worker I/O, explicit Save and Load controls, day-clock autosave, and
   visible failure handling.
3. HUD readouts, string inventory, owner voice pass, and a measured play session
   crossing a real save/load seam.
