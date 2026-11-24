# Build mode: review access through the current layout

Build preparation reports inaccessible ground and objects from the current saved geometry. The player may confirm a valid disconnected layout after reviewing the highlighted ground. No person, doorway or original asset serves as a privileged reachability root.

## What the player gets

1. Original walls, floors and doors follow the same editing rules as equivalent player-built assets. Multiple doors and ordinary wall openings can provide access.
2. Before confirming a disconnected layout, the game highlights the affected ground and explains the access issue. The prompt offers **Confirm** and **Return to build mode**.
3. Return to build mode receives initial keyboard focus. Return and Escape preserve the draft, choices and highlight so the player can adjust the layout.
4. A confirmed inaccessible layout can be saved and loaded. Save and autosave do not ask for the same approval again.

## Decisions

### [RD-root] Current connected ground determines access

`world_geometry::access_report` builds connected components using the current movement grid and edge barriers. An open boundary tile connects a component to the outside. A door or opening contributes through its ordinary traversable connection; no original door coordinate is required.

The report includes a component when it has no external access, or when an on-lot person occupies a different component. An empty enclosed area can therefore require acknowledgment. Components report their ground tiles, resident people, objects whose legal approaches belong only to that component, whether they have external access, and people who cannot reach them. Working people are excluded from the on-lot-person comparison.

Objects with no legal approach anywhere are reported separately with their footprint tiles. The interface highlights native-reported tiles and uses these structured causes. It does not infer a particular door's role or invent an obstruction from an error string.

### [RD-reasons] Access warnings and physical refusals have separate meanings

Inaccessible valid ground requires player acknowledgment. Corrupt source state, object overlap, a wall through a visible person, and a barrier through an ongoing interaction remain refusals. A wall cannot pass through someone's physical contact with an object merely because the player accepts an access warning.

A hidden working or waiting person's retained position does not count as a construction body. The current hidden-away rule requires AtWork with no live Path. A visible person and malformed live paths retain their physical constraints. Historical validation branches retain their frozen interpretation.

After a valid world edit, future routes are reconciled through the activity's own approach rules. A replacement path preserves the target, active order and any owned seat, sleeping place, book or station. If no legal continuation exists, the affected player order fails with its actual reason; later queued orders remain available.

### [RD-save] Approval belongs to an exact prepared candidate

`prepare_build_commit` produces the room review, access report and candidate token. Room choices must be applied before the final access acknowledgment. `commit_build` rejects a candidate requiring acknowledgment with `AccessAcknowledgmentRequired`. `commit_build_with_access_ack` accepts that exact prepared candidate after the player chooses Confirm.

The token is bound to the Build session, draft revision and preparation. Editing or preparing another candidate invalidates an earlier token. Returning to Build does not grant future approval. Normal Save/autosave persists the confirmed world rather than an unconfirmed draft.

The current save envelope stores explicit base surfaces and commute direction alongside saved architecture and activity continuation. Loading current state uses its walls, doors, windows, floors and surfaces; it does not reconstruct missing original assets. A confirmed access warning is not save corruption. Structural and reference validation still apply.

Historical readers remain frozen. Public adoption materializes their implicit geometry once and performs the supported migration before creating current state. Original fixture bytes remain evidence of those historical formats. Migration preserves useful progress and valid activity ownership, and refuses an input when no safe supported placement can be produced.

## [RD-slice-root] Construction boundaries

The Build transaction owns access approval. A construction command outside an explicit Build session may apply automatically only when it introduces no new access issue. It cannot silently approve a newly inaccessible layout.

Arrivals and departures use traversable connections to the current lot boundary. The route choice uses distance and stable coordinate ties. A worker who cannot return waits outside; the old entrance position does not become a required asset. Hidden retained positions remain state records rather than occupied ground.

## Verification

Exercise equivalent original and player-built assets, replacement doors at new positions, many doors, openings without doors, removed original walls and floors, empty enclosed ground, separated people, and objects with blocked approaches. Require exact candidate acknowledgment, stale-token refusal and current save/load of an approved inaccessible layout.

Exercise hidden working and waiting positions before ticking, alongside visible-body, active-contact and malformed-path controls. Block an old approach while independently proving an alternative exists, and require ownership and later queued orders to survive. Keep source rejection, migration, route repair, interface behavior and played visual evidence as separate checks.
