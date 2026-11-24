# Editable world, interface cleanup and water activities

## Authority and constraints

The owner approved this implementation after reviewing the mock-ups in `docs/assets/review-evidence/editable-world-and-water/design/`. Subsequent textual corrections take precedence over illustrative image text. Apply the project writing and testing instructions. Preserve product and model names. No dependency changes are authorized. Older saves may change during necessary migration; preserve useful player progress and original historical fixture inputs.

The starting layout initializes ordinary editable world state. No starter door, wall, floor or furniture instance retains special gameplay authority. Current geometry, capabilities and explicit player choices determine behavior. Players may create unreachable layouts after ground highlighting and explicit Build confirmation. Ordinary Save/autosave does not repeat that approval.

Preserve authored model capabilities, prices, appearance customization, genuine player assignments, simulation determinism and useful diagnostics. Internal stable identifiers remain valid. Do not remove model names or replace special starter identities with a newly designated special replacement.

## Approved interface and visual references

1. `dock.png`: hollow mood, life-satisfaction and seven-need tracks with no selection; remove Nothing selected and repeated prompts. Selected states retain real values and existing mood bands. Hide Edit when no person is selected. Sim-dependent controls have meaningful disabled states.
2. `critical-needs.png`: small critical-needs text beside activity, understated meter colors, no large banner. Keep it visible in collapsed mode without an added row. Small separate down/up chevrons have accessible labels and 44px interaction areas.
3. `details.png`: correction to the image: person sections start expanded; their detail subsections start collapsed. Order history starts collapsed with All selected independently of game selection. Preserve all diagnostic fields, event filtering, individual record disclosure and full filtered Copy output.
4. `build-feedback.png`: local placement, loading, retry and confirmation feedback. Correction: use actual ordinary-object/route causes; never designate a front door or say pending changes are kept. Back to catalogue visibly exits current placement preview and reveals the existing catalogue, retaining filters/scroll/selected card and other pending Build changes.
5. `object-menu.png`: type primary, model secondary, click-operated separate description bubble, surrounding actions and small menu-close control. Clear orders replaces Nothing and appears only with player-issued orders. Closing the menu sends no order. Preserve model names and description text.
6. `pool.png`: approved deeper square wood-clad pool, stone rim, usable ladder steps; color-matched swimwear; fitted entry, doggy paddle and exit.
7. `bath.png`: opaque visible bath water covering legs/feet, supported pose, one random small duck/boat/submarine, shared nudge/lift/release motion and grip.
8. `options.png`: remove Player guide secondary instruction and its obsolete accessibility reference; match adjacent button height, retain normal link behavior.

## Task 1: Ordinary world state, routing and migration

Audit every dependency on starting placements, original bounds/coordinates, privileged identities and legacy shape inference. Trace initialization, saved authority, simulation consumers, presentation and migration separately. Materialize ordinary saved walls, doors/openings, terrain and floor surfaces. Remove live implicit rear-shell reconstruction and original-house floor/cleaning semantics. Resolve arrivals/departures through current traversable connections to the lot boundary, ranked by route length and stable coordinate tie-break. Replace designated entrance protection throughout placement, room operations, windows, movement, rendering and validation. Furniture and replacement objects use equivalent capability-based behavior.

Introduce the next save envelope and necessary current-state resources. Convert historical implicit geometry into explicit state without restoring removed starter objects. Preserve people, funds, inventory, relationships, object identities, player choices and valid activity ownership. Revalidate invalid current routes, fail only affected player orders with real reasons, preserve remaining queue entries, and let autonomy reconsider. Returning workers wait outside when entry is impossible.

Native Build preparation must report connected inaccessible ground regions and affected people/targets. Unreachable valid layouts can be committed only with acknowledgment bound to exact prepared revision. Keep corruption, overlap, invalid references and other structural invariants separate. Normal save/load accepts previously confirmed inaccessible layouts. The next task wires UI acknowledgment; keep current interfaces compatible where a staged implementation requires integration, and record every changed boundary.

Known sources: `content/lot.toml`; `lot_frame.rs`, `portals.rs`, `placement/`, `rooms/`, `attendance.rs`, `household.rs`, `save/` in terri-sim; browser_rooms and save boundaries in terri-wasm; house-shell, tiles and architecture rendering in web. Do not assume every model ID, initial placement or frozen legacy parser is a defect.

## Task 2: Unreachable-area review and useful Build feedback

Highlight native-reported ground and show a prompt before Build confirmation with exactly Confirm and Return to build mode. Keep the world visible. Explain unreachable external access or enclosed people succinctly. Return has initial keyboard focus; Escape returns to Build. Preserve draft and highlight. Confirm accepts the exact reviewed candidate and existing exit flow; edits invalidate acknowledgment. Integrate existing room-change review into one consistent preparation/adoption sequence. No extra prompt on Save/autosave of approved state.

Use structured operation feedback: operation, state, target, concise established cause/remedy and available recovery action. Placement messages stay beside Buy/Place; floor progress stays beside selected finish; confirmation errors stay beside Confirm. Retain complete operation/error/cause details in console. Remove reassurance and visually obvious filler. Useful success results appear briefly below active tool menu; actionable failures persist until resolved/superseded/dismissed. Back to catalogue performs the behavior in the approved reference above.

Known slow operations show spinners immediately; unexpected loads show one by 1.25s. Clear on success, error, cancellation and supersession. Audit startup, Save loading, character resources and graphics recovery; only display real progress fractions.

## Task 3: Person dock, diagnostics, Options and object menu

Implement approved references and corrections above, preserving native controls, keyboard/focus behavior, responsive layout and data integrity. Diagnostics should have structured per-person sections instead of a single wall of text. Only visible detailed sections need refresh work. All-person history works without selection. Clear orders includes active player commitment and queued orders, with no effect promised for autonomous behavior.

## Task 4: Incremental floor resources

Baseline cold and cached loading on the real desktop: fetch bytes, decode, upload, renderer creation, elapsed time and memory. Patio pattern is currently 256x256 and its inspected source PNG is 1004 bytes. Finish changes currently call loadArchitectureAtlas and SpriteRenderer.create. Split device-lifetime base resources from finish resources. Load only missing patterns, deduplicate by content identity, share patterns, retain the small active catalogue within device limits, cache pipeline variants and atomically update finish tables/bindings. Never recreate base atlas/renderer merely for a finish change.

Prepare finishes before staging dependent floor edits. Retain valid visible scene while waiting, prevent stale/canceled selections applying, and offer local Retry with the old floor intact. Whole-save/startup/device-recovery keep appropriate loading surfaces. Re-measure on same device/settings. Tests must prove no finish-triggered base reload/renderer recreation and correct supersession/resource cleanup.

## Task 5: Pool interaction and swimming presentation

Add ordinary Hop in interaction for orders and autonomy. One occupant at a time; reserve pool and ladder approach through entry/swim/exit. Keep square footprint/material identity; deepen basin and author ladder rungs, entry, paddle, exit and swimwear to approved art. All facings and representative body sizes must fit, contact rails/steps, and be obscured correctly by water/walls. Masculine trunks use pants color; feminine two-piece uses top color; usual outfit returns after exit.

Initial timing: 20 game minutes enter, 60 swim, 20 exit. Swimming phase grants Fun +30, Comfort +10, Energy -5 over elapsed swimming time via ordinary effects; normal decay continues. Interruptions perform controlled exit before release/next action. Persist phase, progress and ownership. Appearance remains temporary. Add Swim laps to backlog only: a future exercise action and its own animation/effects.

**November 22 choreography amendment.** The owner approved a forward hop from the crest and a separate climb out. The revised exit lasts 40 game minutes to allow time for the swimmer to approach the ladder, take the inside steps, cross the crest and descend outside. Cancellation before takeoff retraces the supported approach. After takeoff the person finishes landing and exits without starting a swimming reward. Verify save and load on both sides of takeoff, the landing transition and cancellation while paddling in the actual game.

## Task 6: Bath water, fitting and toys

Fit body to current tub with legs/feet contained under opaque water in all views/body sizes. Add activity-owned water and toy with correct mutual depth. Choose one duck, toy boat or toy submarine once per bath using simulation-owned randomness; preserve across pause/load. Shared dimensions/grip and gentle nudge/lift/release motion. Preserve existing bathing duration/effects. Clean up water/toy/appearance on completion/interruption. No model renaming.

## Task 7: Integration, player documentation and delivery review

Run native/web regressions, type checks, formatting and production builds with bounded concurrency. Exercise real displayed game, every new control/action, all four facings, normal/enlarged views and representative appearances. Watch full motion. Fresh independent visual reviewer must reject known defective bathing captures before judging repairs. Keep selected stills/measurements/written findings; no review videos in Git or uploads. Close owned tabs/servers.

Update player guide, desktop/mobile illustrations, string inventory, affected specs, changelog and Swim laps backlog. Review current source before updating fingerprints. Include novice guide review for substantial changes. Review full branch independently and fix findings. Refresh remote state before delivery and reconcile changelog dates. Publication/merge requires applicable owner authorization; do not infer completion from local tests.

## Required regression scenarios

Equivalent starter and player-created asset behavior across all families; replacement door one square away; many doors; openings without doors; original walls removed; rebuilt rooms and floors; duplicates; empty isolated spaces; trapped Sims; blocked arrival/return; revised draft after review; both review actions/Escape; save/load unreachable confirmed world; no selection/critical/collapsed/keyboard/touch/text enlargement; complete diagnostic copy; Clear orders versus Close; cold/warm/failed/retried/canceled/superseded/device-loss loads; pool autonomy/orders/contention/all interruption phases/partial rewards/outfit restore; toy determinism; save/load during both activities.

## Integration boundaries

Native world access report produces ground regions, affected entities and revision-bound acknowledgment. UI consumes it rather than interpreting error text. Explicit live surfaces feed render, route, cleaning and building consumers. Finish owner prepares/publishes/disposes independently of base renderer. Activity projection carries pool phases/progress/swimwear and bath toy identity. Renderer never invents gameplay progress or consumes gameplay random draws.
