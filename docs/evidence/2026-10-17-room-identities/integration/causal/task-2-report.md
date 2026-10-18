# Task 2: stable room identity and matching

Status: implementation and targeted verification complete. Commit `6b7a4fbb2` (`Add stable room identities and deterministic room matching`).

## Scope

1. Added saved room identities, the shared editable Outside name, canonical live anchors, monotonic ID/default-name allocators, bounded retained records, and Unicode name validation.
2. Added pure baseline-to-final sparse overlap matching with deterministic exact/shared-count/retained-fraction/old-ID/row-order preference, connected review groups, explicit inheritance/name choices, and strict current-registry adoption.
3. Added an opt-in land translation path. A world with `SavedRooms` preserves stable room references while moving anchors, confirmed map membership, and tile coordinates. A world without the registry retains the original legacy seed translation.
4. No new-world initialization, runtime room consumers, save envelopes, schema markers, dependencies, or public player-facing behavior changed. No public changelog note is needed for this internal identity layer; the final feature needs one before delivery.

## Public contract

Core module: `terri_core::rooms`.

1. `RoomId` privately wraps `u32`; `RoomId::new(u32) -> Option<RoomId>` refuses zero, `get()` returns the integer, and serde refuses zero on decode. It serializes as the integer. `TryFrom<u32>` and `From<RoomId> for u32` are available.
2. `RoomSelection::{Outside, Room(RoomId)}` maps to room-bearing keys with `key()` and `from_key(u32)`; Outside is always zero.
3. `RoomRecord { id, name, anchor: Option<(u32,u32)> }` stores one live canonical anchor or a retired record with no anchor.
4. `SavedRooms` is a resource with `outside_name`, `next_id`, `next_default_name`, and `records`. Default is Outside with both allocators at one. `validate()` checks names, unique IDs/live anchors, allocator bounds, and the 1,048,576-record cap. `record(id)` reads records. `retain_history(&BTreeSet<RoomId>)` prunes only unreferenced retired records and never rewinds allocators.
5. `validate_room_name(&str)` rejects raw control characters, trims surrounding whitespace, then requires 1 through 48 Unicode scalar values. Saved names must already equal their normalized form. Duplicate custom names and literal markup characters are accepted. The browser must use text rendering and Unicode scalar counting.

Simulation module: `terri_sim::rooms`.

1. `RoomMap { topology: RoomTopology, component_ids: Vec<RoomId> }` is a resource. IDs correspond to topology component order. `from_saved(topology, &saved)` strictly resolves the canonical anchors without migration/repair. `selection_at((u32,u32))` returns one Outside selection for all exterior cells and None for non-floor/out-of-bounds cells. `translated(width,height,(dx,dy))` shifts confirmed membership without inspecting draft walls.
2. `match_rooms(&before, &after, (i32,i32)) -> RoomMatchProposal` aligns old tiles into final coordinates and never mutates inputs. Proposal exposes `overlaps`, `default_inheritance`, `groups`, and `error`; its baseline/final topology is private.
3. Each overlap exposes `old_id`, `final_anchor`, `shared_tiles`, `old_tiles`, `final_tiles`, and `exact`. Fractions use integer cross multiplication. Groups expose `kind: Split | Merge | Repartition | LostEnclosure`, `old_ids`, and `final_anchors`. New unrelated rooms and simple resizes do not demand a group review.
4. `RoomChoices` has `inheritance: BTreeMap<(u32,u32),Option<RoomId>>`, `names: BTreeMap<(u32,u32),String>`, and `outside_name: Option<String>`. Omission uses the deterministic proposal; explicit None requests a new identity. Inheritance requires nonzero overlap and at most one use of any old ID. Explicit choices reserve identities first; remaining pairs are reconsidered in the same deterministic order.
5. `resolve_rooms(&proposal, &choices, &saved) -> Result<ResolvedRooms,RoomError>` returns `map`, `saved`, `correspondence: BTreeMap<RoomId,Option<RoomId>>`, `new_ids`, and `retired_ids`. Surviving IDs map to themselves; retired overlapping rooms map to the chosen final identity of their preferred overlapping component; complete enclosure loss maps to None. New IDs occur in final row order. Allocation/name exhaustion returns an error without mutating the input.

## Verification

1. Initial `cargo test -p terri-sim rooms` red run: 36 passed, 11 intended failures in unimplemented matching/name behavior. First implementation green: 47 passed.
2. The native land regression failed before the guard: room ID 9001 became legacy-derived 13511. After the guard, west/north purchases preserve IDs/names/allocators and move anchors/tile state while object-key namespaces remain intact.
3. `cargo test -p terri-sim rooms::identity_tests`: 13 passed. Tests cover exact identity and complete saved-state preservation, resize, split/merge/repartition, deterministic ties, choices, lost enclosure and later rebuilding, Outside selection/name, Unicode limits, duplicate/custom/default names, invalid input, exhaustion, strict adoption/history pruning, and real land purchases.
4. `cargo test -p terri-core rooms`: 2 passed, including validated wire IDs, registry round trip, and malformed registry refusal.
5. Six targeted matching mutations were killed by assertion failures: reversed shared count, reversed retained fraction, reversed old-ID tie, column-before-row anchor tie, lost west translation, and duplicate inheritance admission. Source was restored byte-for-byte: SHA-256 `943a05e1649a20f9eac1277c64b4f66c3e550765c82fd25e8437989998cb2f98`. Logs and summary are in `task-2-mutation-evidence/`; runner is `task-2-mutations.py` in this ignored task folder.
6. Final restored `cargo test -p terri-sim rooms`: 49 passed. Legacy `cargo test -p terri-sim land::tests`: 7 passed. `git diff --check` passed for owned files.
7. `cargo clippy -p terri-core -p terri-sim --all-targets -- -D warnings` passed. Owned Rust files were formatted. The workspace format check reported only the patio worker's new `covering_names` assertion in `terri-wasm/src/lib.rs`; parent was notified for its owning worker to wrap that assertion. No full native workspace test run is claimed for this isolated task.

## Integration boundaries

1. Task 3 must collect all actual saved room-history references before calling `retain_history`. Resolution retains retired records safely until that reconciliation; it cannot infer chore/dining/domestic history from its narrow arguments. The bounded registry returns an error instead of silently dropping referenced history.
2. Native save integration must install registry/map before stable-reference validators and preserve frozen legacy paths. The new registry does not yet change save semantics or world hashing.
3. Outdoor duty creation, zero eligible-area duty suppression, runtime privacy behavior, paused build transactions, browser controls, and played visual acceptance belong to following tasks. This task proves the common Outside identity but makes no claim that the outdoor cleaning integration is delivered.
4. The land hook assumes any installed map/registry already passed strict adoption. It translates the confirmed map even when draft walls differ; the transaction must compare final architecture only at Confirm.

**Next steps**: Parent reviews the identity contract and continues Task 3; no user action is needed for this internal layer.
