# The outside: saved ground, enclosure and boundary travel

The current world saves its base surfaces, walls, doors and windows explicitly. The original house and its entrance have the same editing rules as equivalent player-built geometry. Access follows the current layout. See [Build access review](2026-09-22-reach-from-the-door.md) for acknowledgment of inaccessible ground.

This is [B-outside] in `docs/FEATURES.md` and the larger lot in [S-build] in `docs/GAME-SYSTEMS.md`. The first yard release shipped in PR 106 at merge `00e8c81`; the street release shipped in PR 107 at merge `5f7cc73`. Their dated review observations remain below. Their original entrance and protected-exit rules do not describe current worlds.

## What the player gets

1. The lot includes indoor floor, grass and street surfaces. Furniture and construction use the same physical placement rules across those surfaces.
2. Walls, doors and ordinary openings determine access. Players can remove original geometry, move a doorway or use several entrances.
3. Workers leave through a reachable open lot boundary. Returning workers and new housemates use current routes into the layout.
4. Daylight follows the saved enclosure and reaches indoors through openings, doors and windows.

## [OS-grow] Lot dimensions and saved positions

The original yard release enlarged the authored lot from 16 by 12 to 20 by 16 by adding ground east and south. Existing coordinates did not move. That release's unchanged legacy fingerprint was a property of its frozen content and save contract.

Current worlds retain their saved dimensions and explicit geometry. Land expansion can add ground beyond the initial lot; its coordinate and save rules are in [Land expansion](2026-10-17-land-expansion.md). The original house rectangle does not protect an asset or constrain the player's current enclosure.

## [OS-yard] Saved surfaces determine the ground's appearance

`WorldSurfaces` stores a row-major base surface for each tile: indoor floor, grass or street. Applied floor coverings are saved separately. Removing a covering reveals the tile's base surface; removing indoor base floor exposes grass. A covering can therefore hide grass or street without changing the lot's boundary routes.

The renderer reads saved surfaces when present. Its house-rectangle and street-column calculation remains a fallback for historical input without explicit surfaces. Grass uses the authored yard color shift with seasonal changes from [SEA-yard] in `2026-10-17-seasons.md`; street uses the authored street shift. A covering uses its own appearance.

Movement uses the current collision grid and barriers. The displayed ground color does not designate an entrance or reserve a street tile.

## [OS-walls] All current walls are ordinary editable geometry

The initial house's east and south walls are authored edges. Historical north and west shell lines become explicit geometry during supported save adoption. Once adopted, original and player-built walls follow the same editing and physical-contact rules. The player can edit perimeter segments as well as interior segments.

During play, cutaway rendering exposes the rooms while collision and light continue to use complete saved geometry. Rear outlines follow current walls and windows. Door frames derive from current doorway lines on either axis. See [WB-draw] in `2026-09-22-walls-in-build.md` and `2026-09-30-cutaway-walls.md` for the presentation contract.

A valid edit that disconnects ground requires access review. Overlap, invalid source state and barriers through a visible person's active physical contact remain refusals.

## [OS-door] Every doorway follows its current line

Current door art and crossing animation derive from saved doorway geometry. A doorway may stand on either axis, inside the lot or on its perimeter. Original placement does not grant a name, protected landing or special travel role. Removing a door and creating another at a different position uses the same rules as any other edit.

A door opens for a person crossing its line under [DR-state] in `2026-09-22-interior-doors.md`. An ordinary wall opening can also provide access without a door model. Windows enclose ground and block movement while transmitting daylight.

Historical content fields and frozen save readers retain their identifiers for compatibility. Public adoption materializes their implied geometry once. Current loading does not recreate an original door that the player removed.

## [OS-migrate] Historical geometry becomes explicit on adoption

Frozen readers first restore and validate their own formats. The historical yard-growth step applies when a restored edge-wall grid exactly matches the content's house dimensions. It expands to the content lot, preserves existing collision cells and edges at their coordinates, and adds nonduplicate authored edges outside the old house. Its window barriers are rebuilt with the grown layout.

Public adoption then materializes the historical base surfaces and implied shell as current saved geometry. Generic old collision maps can require supported normalization of overlapping objects or off-lot people. Valid placements and useful progress are preserved; an input with no safe supported placement is refused. Original fixture bytes remain evidence of the historical readers.

Current worlds load their saved geometry directly. A missing original asset or an acknowledged inaccessible layout does not by itself make a current save invalid. Structural, reference and active-ownership validation still apply. See [RD-save] in `2026-09-22-reach-from-the-door.md` for the current approval boundary.

## [OS-camera] The view opens on the house

The camera frames the authored house at startup and supports panning and zooming across the lot. Lot bounds govern the pan constraint. The house's initial framing has no effect on placement, enclosure or access. See `web/src/render/iso.ts` for current framing arithmetic and [B1] in `2026-07-30-the-house-design.md` for the original framing evidence.

## [OS-street] Commuters use the current open boundary

`world_geometry::boundary_tiles` collects walkable perimeter tiles with an open outward segment. A wall or window blocks that segment; a doorway or ordinary opening permits it. Any qualifying side can provide an exit. Street appearance does not select an exit.

1. **Leaving.** The worker takes a shortest traversable route from the current position to an open boundary. Coordinate ordering resolves equal-distance destinations deterministically.
2. **Coming home.** Current indoor base floor or a laid covering supplies home destinations. Arrival chooses a shortest boundary-to-destination route, then resolves ties by entry coordinates and destination coordinates. A lot with no such floor target uses open ground.
3. **Waiting outside.** A worker who cannot return remains outside. Return retries do not settle the shift's wages again. The retained hidden position does not occupy construction ground.
4. **Editing access.** A valid disconnected layout can be confirmed after reviewing highlighted ground. No original exit or landing is protected. An active visible route or physical interaction retains its own safety checks.

Commute direction is saved explicitly in current state. Historical adoption interprets older commute records before current routing resumes. See `attendance.rs`, `world_geometry_navigation.rs` and [CS-arrival] in `2026-09-22-create-a-sim.md` for the ownership and arrival contracts.

## [OS-daylight] Daylight follows current enclosure

Each floor tile has a sky exposure between zero and one. For current saved geometry, the renderer floods inward from open perimeter segments to identify exterior ground. Walls, doorway lines and windows enclose ground for this exterior classification. The original house rectangle has no role in that calculation.

Exterior tiles start with exposure one. Light then travels through open connections, doorways and windows, losing `daylight_reach_per_tile` for each tile traveled. Solid walls stop the light. Perimeter apertures seed adjacent enclosed tiles from virtual exterior sky, including apertures with no drawable ground beyond the lot.

By day, `interior_daylight_shade` controls how much daylight an enclosed instance loses according to its exposure and the sun's strength. Lamps continue to lift the areas they illuminate. At night the sun contributes no additional indoor shade. Flat light disables the effect. Exposure is presentation state rebuilt after geometry changes; it does not alter needs, simulation state or the save hash.

Historical renderer callers without saved surfaces retain their house-rectangle and implicit-shell interpretation. A caller without edge geometry uses open-sky exposure. See `web/src/render/sky.ts` and its tests for the exact fallback and propagation rules.

## Slices

1. **[OS-slice-yard]** The original yard release established larger ground, editable house edges, migration and camera support.
2. **[OS-slice-street]** The original street release extended commuting beyond the house. Current travel uses the open-boundary contract above.
3. **[OS-slice-daylight]** Daylight exposure distinguishes exterior ground and enclosed rooms, including light through windows.
4. **[OS-slice-exterior]** Remaining exterior work is tracked under [B-outside] in `docs/FEATURES.md` and in the game-systems backlog; this anchor does not specify a new roof feature.
5. **[OS-slice-outdoor-objects]** Outdoor furnishings follow their own catalogue and activity contracts. Placement on grass does not grant an action.

## Historical release review record

These observations concern the original yard and street releases named above. References to a front door, protected exit or unfinished art describe those inspected revisions.


A fresh-context review of [OS-slice-yard] loaded 60 real saves written by the
build before the yard, one every 500 ticks with workers at work and
commuting, a player's wall and queued wall edits, and found every one loads,
grows and replays alike. It found an untested half of the check that a front
door stands inside the house, which the mutation sweep would have failed, now
pinned by a door on the first yard row below a house; and the front door's
line read from the presentation-only portal rows, so a world without the
door's art would take a wall the game refuses, now read from the content with
a test that the two worlds agree. It also found the tile beyond the door
unguarded once a player opens a second way into the yard, now kept open by
every lot edit; three doc comments moved off
their functions; a wrong reason for allowing only a south-east door; an
overclaim that every saved house grows; a stale comment on the door's far
side; and no real pre-yard Save V5 among the fixtures, now `pre-yard-600.hex`.
The cut-away walls showing nothing, a worker vanishing in the doorway, and a
crafted save with the door's line walled are recorded above as known until
later slices. It also judged a test that reads the startup source as text to
prove little; it stays, as the way this project checks `main.ts` wiring.

A second round found no fault in the code. It found that the new test for
the tile beyond the door passed without the rule, since that purchase was
already refused for its own approaches; the test now opens a second doorway
into the yard first. It also found that a walled-off yard behind the tile is
possible, now recorded above, a reason for not hashing the door's facing that
leaned on the lot's size, now reworded, and no lesson for reading a rule from
presentation-only state, now [L-a-rule-read-the-picture].

A fresh-context review of [OS-slice-street] played every real saved stage of
a shift, the front door release's at work and walking home and main's
walking out, and 22 more saves from main and the yard build, to their end,
each paid once. It found a house saved by the yard build with furniture on
the exit would miss every shift and refuse almost every edit, now sent out
by the door, with edits refused only for cutting off an exit the door
reaches; the door drawn closing for a walk home by another doorway, now only
the one step in closes it; a test for a shut-in exit that passed without its
rule, now isolated with a doorway that clears the straight line; the fixture
tests comparing two loaded games rather than the shift's end, now played to
it with a real mid-commute save from main; one test for standing on a tile
shared by the commute and the save check; and stale comments and docs.

A second round found the round's fixes sound across 30 saves played for
3,000 ticks each, and that a hand-edited save with a worker a hair short of
the exit had its way home judged from the wrong tile, now judged from the exit
itself, as the walk home starts there; no lesson for the first round's
stranded yard-build save, now [L-a-new-rule-meets-old-saves]; and a paragraph
left badly wrapped.
