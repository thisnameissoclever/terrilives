# Room identity, naming, and cleaning

## Purpose and agreed behavior

Rooms have saved identities and player-editable names. Their boundaries come from architecture across the owned lot, including additions and purchased land. The player edits names in Build mode. Automatic room changes and their gameplay consequences become permanent only when the player confirms the complete build.

The owner approved these rules:

1. An open-plan space is one room when no architectural boundary separates it.
2. New rooms receive numbered default names. Players can rename them.
3. Outdoor flooring and applicable outdoor surfaces receive cleaning duties. Grass does not.
4. Splits, merges, and lost enclosures receive a review before the build is committed.
5. Removing and restoring a wall within one unconfirmed build preserves the original names and assignments.
6. Furniture, surfaces, and floor membership follow final physical location automatically.
7. Affirmative and backward/cancel controls follow the [shared action-color design](2026-10-17-action-button-colors.md).
8. Outside counts as one shared room for selection, naming, and chores.
9. Add Outdoor patio as a cleanable floor covering, appended after existing covering IDs.

The implementation choices below make these requirements concrete. This document describes intended behavior, not released functionality. The [implementation plan](../superpowers/plans/2026-10-17-room-identities.md) provides the work sequence.

## Terms

| Term | Meaning |
| --- | --- |
| Room | A connected floor region enclosed by architectural boundaries. Furniture and floor appearance do not define the enclosure. |
| Room identity | The permanent identifier of a room, independent of its name, tile coordinates, and furniture. |
| Room name | The player's display label. It grants no actions and changes no privacy or cleaning rules. |
| Outside | One shared room representing all exterior-connected space across the owned lot. It supports a common name and chores without making distant people share private-use consequences. |
| Cleaning area | A room's eligible floor/surfaces, or eligible outdoor floor/surfaces. This grouping does not redefine room-dependent social behavior. |
| Confirmed baseline | The last complete build accepted by the player. Saves and cancellation use this state. |
| Build draft | The paused, editable arrangement since the last confirmation, including pending names and construction. |
| Room-change review | The proposed room identities, names, and responsibility changes calculated from the baseline and final draft. |

## Architectural boundaries

Use one shared architectural calculation over the whole owned grid. A cardinal flood fill groups cells through absent edges; each cell is visited at most once. A component that reaches an unsealed outer grid edge is outside. Do not treat the movement grid's automatic off-lot barrier as a physical wall.

Solid walls, windows, and doorway boundaries separate rooms. A door remains a boundary while its animation is open. Preserve the original implicit house shell and the frozen legacy-house doorway exceptions for the exact historical house, including its translated form. On smaller opaque historical grids, interpret only the in-bounds frozen wall cells and doorway exceptions; retain the saved collision bitmap without inventing wall ownership. Explicit saved architecture remains strictly bounded. Explicit perimeter walls count; custom gaps without doorway records remain gaps. Legacy wall cells are not floor cells. Ordinary furniture occupancy never cuts a room into components.

Keep the full architectural membership separate from walkability. Floor under furniture belongs to its room even when cleaning cannot currently reach it. Walls must continue to refuse intersections with furniture footprints. Preserve existing footprint/anchor rules for object membership; do not add manual object-to-room overrides.

This slice does not add roofs, stairs, diagonal walls, multiple stories, named outdoor zones, or an indoor/outdoor weather model. A fully enclosed grassy courtyard therefore qualifies as a room, but its grass receives no floor-cleaning duty. The street is not household cleaning territory, even if the floor tool allows a covering there.

## Saved identity and names

Use a nonzero `RoomId(u32)` allocated monotonically. Zero identifies the single Outside room in selection and room-bearing chore keys. Save its editable name separately, defaulting to Outside. Its identity exists even when its eligible floor area is empty. Do not reuse retired IDs or derive identity from the lowest tile index. Keep a separate monotonic default-name number so deleting a room never renumbers surviving names.

Save each live room's ID, name, and canonical anchor cell. Rebuild its complete membership from architecture on load; do not save a second membership list on every object. Validate that every enclosed component has exactly one live record and that every live record resolves to one enclosed component. Retired records have no live anchor and remain only while saved history refers to them.

Name rules: trim surrounding whitespace; accept 1 through 48 Unicode scalar values; reject control characters. Treat names as text, never markup. Permit duplicate custom names and distinguish them with map markers and selection highlights. Skip a colliding name when generating a default. These limits and meanings must agree in Rust, TypeScript, and save validation.

For new households, seed the authored starter rooms with familiar names once. For historical saves, preserve currently inferred labels where a valid old room maps to a new one. Furniture never automatically renames an established room afterward. Added rooms receive `Room N`.

## Identity matching at Confirm

Compare final components directly with baseline components in the same coordinate frame. Account for north/west land expansion before measuring overlap. Do not compare a wall edit with the immediately preceding draft edit.

Build a sparse old-room/new-component overlap table by visiting tiles. Prefer exact membership matches. For remaining candidates, propose one-to-one inheritance in descending shared-tile count, then descending fraction of the old room retained, then ascending old ID and final component anchor. Use integer comparisons for fractions. This deterministic default is a proposal; the review lets the player change valid inheritance choices.

| Change | Result |
| --- | --- |
| Rename only | Keep identity, membership, duty owners, daily decisions, and progress. |
| Unchanged final architecture | Preserve room IDs and names; still reconcile actual furniture, surface, or flooring changes. |
| No net relevant build change | Preserve all existing IDs, names, allocators, assignments, work state, and random streams, apart from explicit pending renames. |
| Resize with one surviving enclosed component | Keep the old identity and name. Reconcile only genuinely changed membership. |
| Split | One chosen child keeps the old identity/name. Other children get fresh IDs and default names. |
| Merge | One chosen predecessor survives. Its floor owner stays assigned. Show the resulting area and retiring duties. |
| Many rooms repartitioned | Show the complete connected overlap group. Enforce at most one surviving use of any old ID. |
| Lost enclosure | Retire the room; move eligible targets into outdoor cleaning. Preserve dirt and historical outcomes. |
| New unrelated enclosure | Allocate a new identity and default name at commit. Do not demand an extra review when nothing existing is split, merged, or opened. |

Apply pending renames to the inherited identity. If a renamed room retires in a merge, offer that name in the review without silently changing the surviving owner. A final review names each resulting room, identifies each retained owner, and shows newly assigned or retired duties. Previewing choices never consumes live IDs or randomness.

After an enclosure loss is confirmed, rebuilding the enclosure in a later batch creates a new room. Automatic resurrection of retired rooms is outside this slice. Cancellation and remove/re-add within the same batch remain exact.

## Build transaction

Extend the existing Build session with a simulation-owned transaction. One module owns the valid baseline, accepted-command journal, pending names, prepared review, and transaction revision. The browser controller continues settling previews and presenting controls; it must not own a competing baseline.

1. Begin after draining preexisting commands. Capture a valid current snapshot and freeze simulation time.
2. Apply accepted build commands to the paused draft for placement checks and visible feedback. Record accepted commands in order. Keep purchases, sales, inventory changes, coordinate translation, and placement refusals authoritative during editing.
3. Defer room identity allocation, assignment reconciliation, room-entry consequences, and topology-driven cancellation/settlement of cleaning work. Keep existing refusal rules for moving or selling actively used objects. Do not enable unrelated gameplay commands or ticking during the transaction.
4. When Confirm is pressed, settle previews and construct a private candidate from the valid baseline. Replay the accepted journal under transaction rules. Verify that its final authored arrangement, money, inventory, and object identities match the draft. Rejected commands are not replayed; a rejection must have no hidden allocation or gameplay effect.
5. Match the candidate's final geometry to the baseline. Apply review choices and reconcile dependent gameplay state once. New automatic assignments use the candidate's copied random stream, not the live draft's stream.
6. Validate the complete candidate through the current save/load validation path. Keep at most one prepared candidate, identified by a token tied to the session, journal revision, and review choices.
7. Confirm changes adopts that exact candidate and replaces the baseline atomically. A stale token, replay failure, or validation failure changes neither the draft nor the baseline. Retain the draft, stay paused, and report the actual failure.
8. Back to build discards only the prepared review. Cancel or Exit build restores the baseline and discards the journal and pending names. Confirming one batch and cancelling a later batch retains the first batch.

Every persistence path, including manual Save, visibility-triggered saving and autosave, requests committed bytes. Never serialize a partly reconciled draft as a resumable save. Graphics recovery preserves the native handle and transaction.

A successful Load replaces the baseline and clears the old journal. During active Build, the privately loaded household settles its saved command stream once, without advancing time, before establishing the fresh baseline, as at Build entry. Rejected loading or settlement leaves the live household and transaction unchanged. The draft is intentionally transient, but ordinary untrusted save validation remains strict.

The journal records build actions, including book transactions, floor covering, recoloring, and land purchases. Coordinate-changing purchases retain their original command order. Reserve journal storage before applying an action so allocation failure cannot produce an unrecorded edit. Replaying the journal is bounded by its recorded length; it must not advance the clock, run autonomy, or emit irreversible gameplay effects per intermediate edit.

## Chores, work, and room-dependent behavior

Keep dirt on tiles and objects. Name changes and room reassignment neither clean nor duplicate it. Preserve object IDs, dish ownership, task progress, queued orders, previous outcomes, and random state unless the final accepted change actually requires an update.

For floor duties, the surviving room keeps its owner for the current week. New rooms receive owners only when automatic assignment is enabled. With it disabled, expose the new targets without inventing owners. Retiring a duty through construction marks outstanding unavailable work appropriately; it creates no completion credit and no neglect penalty.

For grouped counter/table duties, match old and new groups by surviving object IDs within the same chore kind. Preserve an unchanged group owner even when its room identity changes. When groups combine, prefer an existing same-kind owner from the surviving room; otherwise prefer the group contributing the most surviving objects, then the old room ID. Show ownership changes in the review. Splitting a group retains one old assignment and creates the remaining duties through the normal assignment policy.

Preserve the surviving duty's saved daily decision. Do not reroll it for a rename, resize, review change, save/load, or no-net-change edit. Genuinely new duties use the existing one-decision-per-day policy. Preserve retiring episodes as history rather than rewriting them as a new duty's past. Construction itself never settles an episode as successfully completed.

Retain a cleaning task exactly when its targets, contact, and route remain valid. Otherwise replan its remaining physical work against the final arrangement; retain quantities already cleaned and existing completion accounting. If no valid work remains, terminate it as unavailable without charging neglect. Release only paths/reservations owned by that task. Never transfer a tile's dirt to another tile to make a task fit.

Privacy, environmental affinities, and room-based relationship calculations use the shared room map. Keep activities intentionally spanning rooms, such as shared devices, under their existing rules. Outside does not create lot-wide shared-room privacy, noise, dish-annoyance, or affinity effects. Existing independent proximity rules and household-wide dish duties continue. Do not add an outdoor mood system in this slice.

On accepted topology changes, update room-visit/cleanup memory without fabricating movement. Preserve noticed/known dish sets and cached decisions for the continuing visit. Suppress only construction-induced entry events; actual later movement still produces entry events. Test that removing a wall beside an occupied toilet does not retrospectively blame a stationary housemate for walking in.

## Outdoor cleaning

Determine cleanability from the resolved floor material and ownership, separately from enclosure. The existing covering IDs remain Boards=1, Tiles=2, Carpet=3. Append Outdoor patio as ID 4, with a distinct paved appearance. It uses the existing covering controls, is cleanable indoors and outdoors, and changes no walls or enclosure. Default house flooring is cleanable; default grass is not. A future grass covering must explicitly be noncleanable rather than relying on a positive covering ID. Keep the street excluded.

Create one household outdoor-floor duty covering eligible outside tiles. Paths may cross grass; cleaning patches may not clean it. Handle disconnected paved areas without looping on an unreachable patch: finish reachable work and report the inaccessible remainder under the existing unavailable-work rules. Counter and table surfaces outside remain cleanable even when standing on grass. Bins retain object-specific duties.

Removing a covering can make a dirty tile ineligible. Preserve its dirt as dormant tile state; do not award cleaning credit. Re-covering makes that dirt eligible again. Current-save validation accepts in-bounds dormant dirt, while active patches must refer to currently eligible targets. Land translation moves all tile-indexed dirt/traffic/patches exactly once without changing room IDs.

Retain existing footstep probabilities, grime increments, cleaning durations, thresholds, skills, and willingness formulas. Outside coverage extends eligibility; it does not rebalance cleaning. New eligible targets appear at Confirm and preserve existing outdoor owners where possible.

## Save compatibility

At the inspected source revision, `684707b3917b73d8e2fa5d65a58adf6691f0ca63`, native and browser markers are 14. Introduce schema 15 only if it remains unallocated at integration; otherwise choose the next unused schema and update this design, its plan, the native marker, and browser marker together.

Freeze every published V1-V14 wire layout and command discriminant. Add an outer envelope containing the unchanged V14 shape and room records/allocators. The outer version explicitly selects whether room-bearing integers mean legacy region seeds or stable IDs. A nominal V14 writer must never emit stable IDs under the old meaning; historical fixture projections must translate representable references or reject an unrepresentable projection.

Restore current saves with the registry installed before domestic, dining, chores, and grime validate their room references. Replace tile-count checks for current room identities with registry checks. Do not load with old semantics and repair after validation.

For historical saves, first decode and validate through the frozen source semantics. Reconstruct both old room maps: the original-house map used by chores/privacy and the separate domestic map. Convert only fields that actually contain room references, including queued `CleanChore` and `CleanChoreFirst` commands. Leave object indexes, person IDs, dish IDs, task/episode IDs, and tile indexes in their respective namespaces.

If an old domestic region becomes several current rooms, verify that the person's saved position belongs to that old region before mapping the continuing visit to the new containing room. Preserve the existing visit's known/noticed sets and pending decision; remembered dishes may remain outside the newly smaller room. Let ordinary boundary movement or visit reset end that memory. Do not duplicate it in a second saved structure or copy/reroll decisions into every child. If the saved position no longer belongs to the old region, retain the old reference as history and allow the ordinary next entry/reset to replace it without running an event during migration. An old seed whose historical geometry is gone remains an opaque retired-history reference, not an invented live room. Existing outcomes stay unchanged.

Preserve dirt, claims, in-progress work, queue order, personalities, books, careers, funds in cents, land frame, histories, and every random stream. Rebuild derived caches without ticking or applying relationship effects. Validate old active work under old rules, then explicitly replan only work whose new eligibility or geometry differs. Current-schema load is strict adoption, not another historical migration.

Before replacing an older browser save with the new schema, preserve its bytes in the established version-specific recovery file. Add a frozen V14 worker fixture. Prove that an old worker refuses the new primary file and that recovery bytes survive failed writes and New game. Reject truncated, trailing, ambiguous historical, unsupported-future, duplicate-room, and out-of-range records without mutating the live household.

## Interface and scope

Rename the existing Room navigation label to Rooms. Add Select rooms and Build room modes; default to Select rooms. Keep the existing rectangular construction controller for Build room. The six existing tool destinations, including Land, remain available. Do not infer that the five-tool descriptions in older build docs are a current inventory.

Select a room through a floor click/tap or a labeled dropdown. Selection takes precedence over furniture/book picking in Select rooms mode. Use the existing arbitrary tile highlight. One name field edits the draft immediately; changing selection or tools retains it. Enter in the field must not confirm the whole build. Room markers are presentation labels, not saved identity numbers.

Keep ordinary room selection on the confirmed room map until Confirm, translated to follow any draft land expansion. Show `Room boundaries update on Confirm` when wall edits are pending. A newly built unrelated enclosure appears as `Room N` after confirmation; Build remains open so the player can select and rename it in the next batch. The Confirm review uses revision-bound final-component anchors to name new split children before adoption. This is a proposed interface simplification: it avoids temporary room selection identities during editing, at the cost of an extra Confirm for a newly built room's custom name. Confirm-only persistence could also support provisional selection; this plan chooses the smaller interface for owner review.

The review groups all splits, merges, and lost enclosures in the current batch. A compact change list selects one highlighted change while retaining edits to the others. Show retained and new names, retiring names, owners that change, and relevant area changes. Show opening locates an exterior gap. Back to build preserves edits. Confirm changes accepts the complete reviewed batch once. Editing the draft invalidates the review token.

Retain the existing 304px desktop panel and compact bottom-dock behavior. Keep the room dropdown available when floor targets are too small or obscured. Test the on-screen keyboard, enlarged text, focus restoration, long/duplicate names, and cancellation after switching tools. The approved mockups are schematic interaction studies; they do not introduce a second camera or promise new furniture art.

## Acceptance

The implementation must prove no-net-change preservation, final-geometry matching, outdoor coverage, historical-save migration, worker recovery, and atomic failure behavior with causal tests. Run targeted mutations against the deferral, identity matching, current-schema validator, and conservation guards. Play the actual game through rename, split, merge, enclosure loss, land expansion, outdoor cleaning, Cancel, and save/reload. Inspect captures and obtain independent visual review under [Testing Protocol section 9](../testing-protocol.md#9-every-milestone-ends-with-a-played-visual-pass).

No dependencies or save resets are authorized. Update affected documentation and player-facing changelog notes when implementation is delivered. Keep review videos out of the repository.
