//! Tests for wall edits - [WT-rules] and [WT-apply] in
//! `docs/specs/2026-09-21-wall-tool.md`.

use super::*;
use crate::{Content, Sim};
use terri_core::layout::{EdgeAxis::*, WallState::*};
use terri_core::{CommandQueue, Footprint, SimCommand};

/// A 7 by 7 house with the given edges, a fridge in the corner at (0, 0), and
/// the front door on the east side at (6, 3) with its landing at (5, 3).
fn house(edges: Vec<WallEdge>) -> (Sim, Entity) {
    house_with_door((6, 3), (5, 3), edges)
}

fn house_with_door(door: (u32, u32), landing: (u32, u32), edges: Vec<WallEdge>) -> (Sim, Entity) {
    let mut pack = terri_data::pack().clone();
    pack.lot.width = 7;
    pack.lot.height = 7;
    pack.lot.wall_edges.clear();
    pack.lot.walls.clear();
    pack.lot.placements.clear();
    pack.lot.front_door = Some(door);
    pack.portals[0].position = door;
    pack.portals[0].inward = landing;
    let pack = Box::leak(Box::new(pack));
    let mut sim = Sim::new_from_lot(&pack.lot, &pack.objects);
    sim.world_mut().insert_resource(Content(pack));
    let fridge = sim.spawn_object(Position { x: 0.0, y: 0.0 }, pack.find("fridge").unwrap());
    let mut grid = TileGrid::new(7, 7);
    grid.set_blocked(0, 0, true);
    for edge in &edges {
        let [a, b] = edge.cells();
        grid.set_edge_blocked(a, b, !edge.doorway);
    }
    sim.world_mut().insert_resource(grid);
    sim.world_mut()
        .insert_resource(SavedLayout::EdgeWallsV1 { edges });
    (sim, fridge)
}

fn line(axis: EdgeAxis, x: u32, y: u32, doorway: bool) -> WallEdge {
    WallEdge {
        axis,
        x,
        y,
        doorway,
    }
}

fn edit(axis: EdgeAxis, x: u32, y: u32, state: WallState) -> WallEdit {
    WallEdit { axis, x, y, state }
}

/// Every vertical line at `x`, as walls: a partition across the whole house.
fn partition(x: u32) -> Vec<WallEdge> {
    (0..7).map(|y| line(Vertical, x, y, false)).collect()
}

fn stage(sim: &mut Sim, edit: WallEdit) {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetWallEdge {
            axis: edit.axis,
            x: edit.x,
            y: edit.y,
            state: edit.state,
        });
    sim.flush_commands();
}

fn edges(sim: &Sim) -> Vec<WallEdge> {
    match sim.world().resource::<SavedLayout>() {
        SavedLayout::EdgeWallsV1 { edges } => edges.clone(),
        other => panic!("expected edge walls, found {other:?}"),
    }
}

fn revision(sim: &Sim) -> u64 {
    sim.world().resource::<LotEditState>().revision
}

fn last(sim: &Sim) -> Option<WallEditResult> {
    sim.world().resource::<LotEditState>().last_wall_result
}

/// The preview refuses with `expected`, and so does the commit, and neither
/// writes anything: not the save, not the lot revision.
fn refused(sim: &mut Sim, request: WallEdit, expected: PlacementRefusal) {
    let before = sim.save_snapshot_v3();
    let revision_before = revision(sim);
    assert_eq!(
        validate_wall_edit(sim.world(), request).unwrap_err(),
        expected,
        "preview of {request:?}"
    );
    assert_eq!(sim.save_snapshot_v3(), before, "preview wrote state");
    stage(sim, request);
    assert_eq!(
        last(sim),
        Some(WallEditResult {
            edit: request,
            reason: Some(expected)
        })
    );
    assert_eq!(sim.save_snapshot_v3(), before, "a refused edit wrote state");
    assert_eq!(
        revision(sim),
        revision_before,
        "a refused edit moved the revision"
    );
}

/// Applied, with nothing refused.
fn applied(sim: &mut Sim, request: WallEdit) {
    assert!(
        validate_wall_edit(sim.world(), request).is_ok(),
        "preview of {request:?}"
    );
    stage(sim, request);
    assert_eq!(
        last(sim),
        Some(WallEditResult {
            edit: request,
            reason: None
        })
    );
}

#[test]
fn a_wall_a_doorway_and_an_opening_each_apply_to_the_grid_and_the_saved_house() {
    let (mut sim, _) = house(vec![]);
    let (a, b) = ((2, 2), (3, 2));
    let start = revision(&sim);

    applied(&mut sim, edit(Vertical, 3, 2, Wall));
    assert_eq!(edges(&sim), [line(Vertical, 3, 2, false)]);
    assert!(!sim.world().resource::<TileGrid>().can_cross(a, b));
    assert_eq!(revision(&sim), start + 1);

    applied(&mut sim, edit(Vertical, 3, 2, Doorway));
    assert_eq!(edges(&sim), [line(Vertical, 3, 2, true)]);
    assert!(sim.world().resource::<TileGrid>().can_cross(a, b));
    assert_eq!(revision(&sim), start + 2);

    applied(&mut sim, edit(Vertical, 3, 2, Wall));
    assert_eq!(edges(&sim), [line(Vertical, 3, 2, false)]);
    assert!(!sim.world().resource::<TileGrid>().can_cross(a, b));

    applied(&mut sim, edit(Vertical, 3, 2, Open));
    assert!(edges(&sim).is_empty());
    assert!(sim.world().resource::<TileGrid>().can_cross(a, b));
    assert_eq!(revision(&sim), start + 4);

    // A horizontal line separates a tile from the one below it.
    applied(&mut sim, edit(Horizontal, 4, 5, Wall));
    assert!(!sim.world().resource::<TileGrid>().can_cross((4, 4), (4, 5)));
    assert!(sim.world().resource::<TileGrid>().can_cross((4, 5), (5, 5)));
}

/// [WT-apply]: updated in place, appended when new, removed when opened, and
/// never re-sorted, so the same edits in the same order give the same bytes.
#[test]
fn the_saved_list_is_updated_in_place_appended_to_and_never_resorted() {
    let (mut sim, _) = house(vec![
        line(Horizontal, 1, 4, false),
        line(Vertical, 5, 1, false),
    ]);
    applied(&mut sim, edit(Vertical, 2, 5, Wall));
    applied(&mut sim, edit(Horizontal, 1, 4, Doorway));
    applied(&mut sim, edit(Vertical, 5, 1, Open));
    assert_eq!(
        edges(&sim),
        [line(Horizontal, 1, 4, true), line(Vertical, 2, 5, false)]
    );
}

#[test]
fn asking_for_the_state_a_line_already_has_writes_nothing() {
    let (mut sim, _) = house(vec![
        line(Vertical, 3, 2, false),
        line(Vertical, 3, 4, true),
    ]);
    for request in [
        edit(Vertical, 3, 2, Wall),
        edit(Vertical, 3, 4, Doorway),
        edit(Vertical, 3, 3, Open),
    ] {
        let before = sim.save_snapshot_v3();
        let revision_before = revision(&sim);
        let plan = validate_wall_edit(sim.world(), request).unwrap();
        assert!(!plan.changed, "{request:?}");
        applied(&mut sim, request);
        assert_eq!(sim.save_snapshot_v3(), before, "{request:?}");
        assert_eq!(revision(&sim), revision_before, "{request:?}");
    }
}

#[test]
fn a_legacy_house_and_the_outside_wall_are_refused() {
    let (mut sim, _) = house(vec![]);
    sim.world_mut()
        .insert_resource(SavedLayout::LegacyCells { walls: vec![] });
    refused(
        &mut sim,
        edit(Vertical, 3, 2, Wall),
        PlacementRefusal::UnsupportedLayout,
    );
    // Opening is refused too: a legacy house has no edge list to edit.
    refused(
        &mut sim,
        edit(Vertical, 3, 2, Open),
        PlacementRefusal::UnsupportedLayout,
    );

    let (mut sim, _) = house(vec![]);
    for request in [
        edit(Vertical, 0, 2, Wall),
        edit(Vertical, 7, 2, Wall),
        edit(Vertical, 3, 7, Wall),
        edit(Horizontal, 2, 0, Wall),
        edit(Horizontal, 2, 7, Wall),
        edit(Horizontal, 7, 2, Wall),
        edit(Vertical, u32::MAX, 2, Doorway),
    ] {
        refused(&mut sim, request, PlacementRefusal::OutOfBounds);
    }
}

#[test]
fn a_grid_nobody_can_explain_is_refused_before_anything_else() {
    let (mut sim, _) = house(vec![]);
    // A blocked tile no furniture and no wall accounts for.
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(4, 4, true);
    refused(
        &mut sim,
        edit(Vertical, 3, 2, Wall),
        PlacementRefusal::UnsupportedLayout,
    );
}

#[test]
fn a_wall_cannot_cut_furniture_in_half_but_a_doorway_or_an_opening_can_pass_through_it() {
    let (mut sim, _) = house(vec![]);
    let pack = sim.world().resource::<Content>().0;
    let sofa = pack.find("long_sofa").unwrap();
    let footprint: Footprint = pack
        .object(sofa)
        .footprint_at(pack.object(sofa).base_facing);
    assert_eq!(
        (footprint.width, footprint.depth),
        (2, 1),
        "fixture assumption"
    );
    sim.spawn_object(Position { x: 1.0, y: 5.0 }, sofa);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(1, 5, true);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(2, 5, true);

    refused(
        &mut sim,
        edit(Vertical, 2, 5, Wall),
        PlacementRefusal::WallOverlap,
    );
    applied(&mut sim, edit(Vertical, 2, 5, Doorway));
    applied(&mut sim, edit(Vertical, 2, 5, Open));
    // The line beside the sofa is not inside it.
    applied(&mut sim, edit(Vertical, 3, 5, Wall));
}

#[test]
fn a_wall_cannot_come_down_on_a_sim_standing_across_the_line() {
    let (mut sim, _) = house(vec![]);
    let person = sim
        .world_mut()
        .spawn((Agent, Position { x: 2.5, y: 1.0 }))
        .id();
    refused(
        &mut sim,
        edit(Vertical, 3, 1, Wall),
        PlacementRefusal::SimOverlap,
    );
    applied(&mut sim, edit(Vertical, 3, 1, Doorway));
    // Standing wholly on one side is not across it.
    sim.world_mut()
        .entity_mut(person)
        .insert(Position { x: 2.0, y: 1.0 });
    applied(&mut sim, edit(Vertical, 3, 1, Wall));
}

#[test]
fn a_wall_cannot_come_between_a_sim_and_what_it_is_using_or_who_it_is_talking_to() {
    let (mut sim, fridge) = house(vec![]);
    let user = sim
        .world_mut()
        .spawn((
            Agent,
            Position { x: 1.0, y: 0.0 },
            Target {
                object: fridge,
                interaction: 0,
            },
        ))
        .id();
    refused(
        &mut sim,
        edit(Vertical, 1, 0, Wall),
        PlacementRefusal::InUse,
    );
    // The same sim with no target is only standing there.
    sim.world_mut().entity_mut(user).remove::<Target>();
    applied(&mut sim, edit(Vertical, 1, 0, Wall));
    applied(&mut sim, edit(Vertical, 1, 0, Open));

    let listener = sim
        .world_mut()
        .spawn((Agent, Position { x: 4.0, y: 5.0 }))
        .id();
    let talker = sim
        .world_mut()
        .spawn((
            Agent,
            Position { x: 3.0, y: 5.0 },
            Target {
                object: listener,
                interaction: 0,
            },
        ))
        .id();
    refused(
        &mut sim,
        edit(Vertical, 4, 5, Wall),
        PlacementRefusal::InUse,
    );
    // The rule reads both ways: the target on the near side, the sim beyond.
    sim.world_mut()
        .entity_mut(talker)
        .insert(Position { x: 5.0, y: 5.0 });
    refused(
        &mut sim,
        edit(Vertical, 5, 5, Wall),
        PlacementRefusal::InUse,
    );
    // A line elsewhere is not between them.
    applied(&mut sim, edit(Vertical, 4, 2, Wall));
}

/// The in-use rule is about what is ACROSS the line, not about who is near it.
/// A sim standing beside a line with a target elsewhere does not stop a wall.
/// Both cases sit one tile past the fridge's edge on each axis, so a rectangle
/// test that counted its far edge as inside would refuse them.
#[test]
fn a_sim_beside_a_line_using_something_elsewhere_does_not_stop_a_wall() {
    for (at, request) in [
        (Position { x: 2.0, y: 0.0 }, edit(Vertical, 2, 0, Wall)),
        (Position { x: 0.0, y: 2.0 }, edit(Horizontal, 0, 2, Wall)),
    ] {
        let (mut sim, fridge) = house(vec![]);
        sim.world_mut().spawn((
            Agent,
            at,
            Target {
                object: fridge,
                interaction: 0,
            },
        ));
        applied(&mut sim, request);
    }
}

#[test]
fn a_wall_is_held_to_every_proof_a_furniture_move_is() {
    // One gap left in a partition at x = 3; closing it cuts the fridge off
    // from the front door ([RD-reasons]).
    let mut walls = partition(3);
    walls.retain(|edge| edge.y != 3);
    let (mut sim, _) = house(walls.clone());
    refused(
        &mut sim,
        edit(Vertical, 3, 3, Wall),
        PlacementRefusal::InaccessibleInteraction,
    );

    // With a sim on the fridge's side, the sim is what the proofs find first.
    let (mut sim, _) = house(walls.clone());
    sim.world_mut().spawn((Agent, Position { x: 1.0, y: 5.0 }));
    refused(
        &mut sim,
        edit(Vertical, 3, 3, Wall),
        PlacementRefusal::BlockedRoute,
    );

    // Walling in the fridge's last approach.
    let (mut sim, _) = house(vec![line(Vertical, 1, 0, false)]);
    refused(
        &mut sim,
        edit(Horizontal, 0, 1, Wall),
        PlacementRefusal::InaccessibleInteraction,
    );
}

/// Swaps the house's content for a copy changed by `change`.
fn with_content(sim: &mut Sim, change: impl FnOnce(&mut terri_data::ContentPack)) {
    let mut pack = sim.world().resource::<Content>().0.clone();
    change(&mut pack);
    let pack: &'static terri_data::ContentPack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
}

/// [RD-root]: a lot whose content names no front door is judged from its
/// first open tile in reading order, (1, 0) here, as every lot was before.
/// Only test content has no front door; a blank custom lot keeps the shipped
/// one.
#[test]
fn a_house_with_no_front_door_is_judged_from_its_first_open_tile() {
    let mut walls = partition(3);
    walls.retain(|edge| edge.y != 3);
    let (mut sim, _) = house(walls.clone());
    with_content(&mut sim, |pack| {
        pack.lot.front_door = None;
        pack.portals.clear();
    });
    // Closing the gap leaves the fridge's side, where the flood starts, whole.
    applied(&mut sim, edit(Vertical, 3, 3, Wall));

    // A sim on the other side is cut off from it.
    let (mut sim, _) = house(walls);
    with_content(&mut sim, |pack| {
        pack.lot.front_door = None;
        pack.portals.clear();
    });
    sim.world_mut().spawn((Agent, Position { x: 5.0, y: 5.0 }));
    refused(
        &mut sim,
        edit(Vertical, 3, 3, Wall),
        PlacementRefusal::BlockedRoute,
    );
}

/// The wall rules guard only the line between the front door and its own
/// landing, so the proofs keep every other portal's landing reachable from
/// the front door.
#[test]
fn a_wall_that_cuts_off_another_portals_landing_is_refused() {
    // Two walls of three around the empty corner tiles (0, 6) and (1, 6).
    let (mut sim, _) = house(vec![
        line(Horizontal, 0, 6, false),
        line(Horizontal, 1, 6, false),
    ]);
    with_content(&mut sim, |pack| {
        let mut back = pack.portals[0].clone();
        back.position = (0, 6);
        back.inward = (1, 6);
        pack.portals.push(back);
    });
    refused(
        &mut sim,
        edit(Vertical, 2, 6, Wall),
        PlacementRefusal::BlockedLanding,
    );
}

/// Opening a line or making it a doorway only removes a barrier, so it is
/// never held to the proofs: a house already in trouble can be mended.
#[test]
fn an_opening_or_a_doorway_is_accepted_even_in_a_house_that_is_already_cut_in_two() {
    let mut walls = partition(3);
    walls.extend(partition(5));
    let (mut sim, _) = house(walls);
    // The door strip beyond x = 5 stays cut off whatever happens at x = 3.
    applied(&mut sim, edit(Vertical, 3, 3, Open));
    applied(&mut sim, edit(Vertical, 3, 4, Doorway));
    // Closing a line in that same house is held to the proofs, and fails:
    // the fridge is out of reach from the front door ([RD-reasons]).
    refused(
        &mut sim,
        edit(Vertical, 3, 3, Wall),
        PlacementRefusal::InaccessibleInteraction,
    );
}

/// [WT-command]: a wall edit takes its place in the stream. A cancel issued
/// before it is applied first; a cancel issued after it is not.
#[test]
fn a_wall_edit_sees_the_orders_issued_before_it_and_not_those_after() {
    for cancel_first in [true, false] {
        let (mut sim, fridge) = house(vec![]);
        let user = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 0.0 },
                // An ORDERED use: a cancel releases only what the player
                // asked for, never what a sim chose for itself.
                terri_core::IntentQueue::from_intents(vec![terri_core::Intent {
                    object: fridge,
                    interaction: 0,
                }]),
                Target {
                    object: fridge,
                    interaction: 0,
                },
            ))
            .id();
        sim.world_mut()
            .entity_mut(fridge)
            .insert(terri_core::Reserved);
        let cancel = SimCommand::CancelIntents {
            agent: user.index_u32(),
        };
        let wall = SimCommand::SetWallEdge {
            axis: Vertical,
            x: 1,
            y: 0,
            state: Wall,
        };
        let mut queue = sim.world_mut().resource_mut::<CommandQueue>();
        if cancel_first {
            queue.push(cancel);
            queue.push(wall);
        } else {
            queue.push(wall);
            queue.push(cancel);
        }
        sim.flush_commands();
        assert_eq!(
            last(&sim).unwrap().reason,
            if cancel_first {
                None
            } else {
                Some(PlacementRefusal::InUse)
            },
            "cancel_first={cancel_first}"
        );
        assert!(
            sim.world().get::<Target>(user).is_none(),
            "the cancel applied"
        );
    }
}

#[test]
fn a_built_house_and_a_staged_wall_edit_survive_save_and_load() {
    let (mut sim, _) = house(vec![line(Vertical, 5, 1, false)]);
    applied(&mut sim, edit(Vertical, 2, 5, Wall));
    applied(&mut sim, edit(Horizontal, 4, 3, Doorway));
    applied(&mut sim, edit(Vertical, 5, 1, Open));
    // Staged and not yet drained when the save is taken.
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetWallEdge {
            axis: Horizontal,
            x: 1,
            y: 2,
            state: Wall,
        });
    let saved = sim.save_snapshot_v3();

    let (mut restored, _) = house(vec![]);
    restored
        .load_snapshot_v3(saved.clone())
        .expect("a built house loads");
    assert_eq!(restored.save_snapshot_v3(), saved);
    assert_eq!(restored.world_hash(), sim.world_hash());
    restored.flush_commands();
    sim.flush_commands();
    assert_eq!(
        edges(&restored),
        [
            line(Vertical, 2, 5, false),
            line(Horizontal, 4, 3, true),
            line(Horizontal, 1, 2, false)
        ]
    );
    assert!(!restored
        .world()
        .resource::<TileGrid>()
        .can_cross((1, 1), (1, 2)));
    assert_eq!(restored.world_hash(), sim.world_hash());
}

/// [WT-hash]. The digest sees every wall and every doorway flag, and sees the
/// house rather than the order it was built in. The staged command's every
/// field reaches it too.
#[test]
fn the_world_hash_sees_the_house_and_every_field_of_a_staged_wall_edit() {
    let hash = |edges: Vec<WallEdge>| house(edges).0.world_hash();
    let a = line(Vertical, 3, 2, false);
    let b = line(Horizontal, 4, 5, false);
    let empty = hash(vec![]);
    assert_ne!(hash(vec![a]), empty);
    assert_ne!(hash(vec![a]), hash(vec![WallEdge { doorway: true, ..a }]));
    assert_ne!(hash(vec![a]), hash(vec![b]));
    assert_ne!(hash(vec![a]), hash(vec![WallEdge { x: 4, ..a }]));
    assert_ne!(hash(vec![a]), hash(vec![WallEdge { y: 3, ..a }]));
    assert_ne!(
        hash(vec![a]),
        hash(vec![WallEdge {
            axis: Horizontal,
            ..a
        }])
    );
    assert_eq!(hash(vec![a, b]), hash(vec![b, a]));

    let staged = |command: SimCommand| {
        let (mut sim, _) = house(vec![]);
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
        sim.world_hash()
    };
    let base = SimCommand::SetWallEdge {
        axis: Vertical,
        x: 3,
        y: 2,
        state: Wall,
    };
    let reference = staged(base.clone());
    assert_ne!(reference, empty);
    for changed in [
        SimCommand::SetWallEdge {
            axis: Horizontal,
            x: 3,
            y: 2,
            state: Wall,
        },
        SimCommand::SetWallEdge {
            axis: Vertical,
            x: 4,
            y: 2,
            state: Wall,
        },
        SimCommand::SetWallEdge {
            axis: Vertical,
            x: 3,
            y: 3,
            state: Wall,
        },
        SimCommand::SetWallEdge {
            axis: Vertical,
            x: 3,
            y: 2,
            state: Doorway,
        },
    ] {
        assert_ne!(staged(changed.clone()), reference, "{changed:?}");
    }
}

/// Review finding [F1] on PR 95. A sim walking to the fridge along
/// (2,0) then (1,0) would arrive beside it with a new wall between them. Every
/// rule of the wall validator's own passed, and the V3 loader refused the save.
#[test]
fn a_wall_between_where_a_walk_ends_and_what_it_is_walking_to_is_refused() {
    let (mut sim, fridge) = house(vec![]);
    sim.world_mut().spawn((
        Agent,
        Position { x: 3.0, y: 0.0 },
        terri_core::Path {
            steps: vec![(2, 0), (1, 0)],
            cursor: 0,
        },
        Target {
            object: fridge,
            interaction: 0,
        },
    ));
    refused(
        &mut sim,
        edit(Vertical, 1, 0, Wall),
        PlacementRefusal::BlockedRoute,
    );
    // The fridge's other side is not where this walk ends.
    applied(&mut sim, edit(Horizontal, 0, 1, Wall));
}

/// Review finding [F2] on PR 95. With a worker in the house, the loader needs
/// a straight step from the front door to its landing. A second way in kept the
/// house connected, so the proofs passed, and the save would not load.
#[test]
fn a_wall_between_the_front_door_and_its_landing_is_refused_while_anyone_works() {
    let (mut sim, _) = house(vec![]);
    let worker = sim
        .world_mut()
        .spawn((Agent, Position { x: 2.0, y: 5.0 }, terri_core::Career(0)))
        .id();
    refused(
        &mut sim,
        edit(Vertical, 6, 3, Wall),
        PlacementRefusal::BlockedLanding,
    );
    // With nobody working the loader would accept it, and the first person to
    // take a job would meet a walled-off door, so the door line stays refused.
    sim.world_mut()
        .entity_mut(worker)
        .remove::<terri_core::Career>();
    refused(
        &mut sim,
        edit(Vertical, 6, 3, Wall),
        PlacementRefusal::BlockedLanding,
    );
    // A doorway there is still a way in, and the line beside it is not the door.
    applied(&mut sim, edit(Vertical, 6, 3, Doorway));
    applied(&mut sim, edit(Vertical, 6, 2, Wall));

    // A line lists its lower tile first. The east door above is the higher
    // tile of its line; the shipped house's door, like this north one, is the
    // lower. The rule has to recognise the door line both ways round.
    let (mut sim, _) = house_with_door((3, 0), (3, 1), vec![]);
    refused(
        &mut sim,
        edit(Horizontal, 3, 1, Wall),
        PlacementRefusal::BlockedLanding,
    );
}

/// The invariant the first review's blockers broke, over the real household:
/// every wall the validator accepts leaves a save that the V3 loader accepts.
/// Opening a line or making a doorway only removes a barrier and cannot make a
/// save unloadable, so walls are the state checked.
///
/// The test also proves it met the case it guards. Content changes move the
/// household, and after the trait library the ticks this first used no longer
/// held a wall that passes every other rule and fails the loader, so the test
/// passed with the loader check deleted. It now counts such walls, which the
/// loader check alone refuses, and fails if it finds none: a household change
/// that empties it fails loudly, and the fix is to choose ticks that hold one.
#[test]
fn every_wall_the_shipped_household_accepts_leaves_a_save_that_loads() {
    let mut sim = Sim::new_from_shipped_lot();
    let (width, height) = {
        let grid = sim.world().resource::<TileGrid>();
        (grid.width() as u32, grid.height() as u32)
    };
    let mut checked = 0;
    let mut only_the_loader_refused = 0;
    let mut reloaded = Sim::new_from_shipped_lot();
    for stop in [180u64, 620] {
        // Bounded, so a clock that stops advancing fails here instead of
        // spinning: the mutation sweep caught the unbounded form hanging when
        // `Sim::tick` did nothing.
        let from = sim.world().resource::<terri_core::SimClock>().tick;
        for _ in from..stop {
            sim.tick();
        }
        assert_eq!(
            sim.world().resource::<terri_core::SimClock>().tick,
            stop,
            "one tick per `Sim::tick`"
        );
        let base = sim.save_snapshot_v3();
        let rectangles = super::super::current_layout(sim.world())
            .expect("the shipped house is consistent")
            .rectangles;
        let lines = (1..width)
            .flat_map(|x| (0..height).map(move |y| (Vertical, x, y)))
            .chain((0..width).flat_map(|x| (1..height).map(move |y| (Horizontal, x, y))));
        for (axis, x, y) in lines {
            let request = edit(axis, x, y, Wall);
            let plan = match validate_wall_edit(sim.world(), request) {
                Ok(plan) => plan,
                Err(PlacementRefusal::BlockedRoute) => {
                    let [a, b] = line(axis, x, y, false).cells();
                    let mut grid = sim.world().resource::<TileGrid>().clone();
                    grid.set_edge_blocked(a, b, true);
                    if super::super::prove_lot_usable(sim.world(), &grid, &rectangles).is_ok()
                        && crate::save::candidate_grid_loads(sim.world(), &grid).is_err()
                    {
                        only_the_loader_refused += 1;
                    }
                    continue;
                }
                Err(_) => continue,
            };
            if !plan.changed {
                continue;
            }
            // A commit writes the plan's edge list and the grid built from it,
            // and the loader rebuilds that grid from the list, so the save a
            // commit would leave is the base save carrying this list.
            let mut after = base.clone();
            after.layout = SavedLayout::EdgeWallsV1 { edges: plan.edges };
            assert_eq!(
                reloaded.load_snapshot_v3(after).err(),
                None,
                "an accepted {request:?} at tick {stop} left a save that will not load"
            );
            checked += 1;
        }
    }
    assert!(checked > 100, "only {checked} walls were accepted to check");
    assert!(
        only_the_loader_refused > 0,
        "no wall at these ticks passes every other rule and fails the loader; the test \
         no longer covers the case it guards, so choose other ticks"
    );
}

/// [WT-hash]: an edge-wall house with no walls is a different save from a
/// legacy house, so the digest tells them apart.
#[test]
fn an_edge_house_with_no_walls_hashes_apart_from_a_legacy_house() {
    let (edge, _) = house(vec![]);
    let (mut legacy, _) = house(vec![]);
    legacy
        .world_mut()
        .insert_resource(SavedLayout::LegacyCells { walls: vec![] });
    assert_ne!(edge.world_hash(), legacy.world_hash());
}

/// [WT-command], held to the placement standard: the same stream drained in one
/// batch and one command at a time leaves the same save and the same hash.
#[test]
fn a_stream_with_wall_edits_drains_the_same_joined_or_split() {
    let stream = |fridge: Entity, user: Entity| {
        vec![
            SimCommand::Select(Some(user.index_u32())),
            SimCommand::SetWallEdge {
                axis: Vertical,
                x: 3,
                y: 2,
                state: Wall,
            },
            SimCommand::UseObject {
                agent: user.index_u32(),
                object: fridge.index_u32(),
                interaction: 0,
            },
            SimCommand::SetWallEdge {
                axis: Vertical,
                x: 3,
                y: 2,
                state: Doorway,
            },
            SimCommand::CancelIntents {
                agent: user.index_u32(),
            },
            SimCommand::SetWallEdge {
                axis: Horizontal,
                x: 4,
                y: 5,
                state: Wall,
            },
        ]
    };
    let world = |split: bool| {
        let (mut sim, fridge) = house(vec![]);
        let user = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 4.0, y: 1.0 },
                terri_core::Needs::all_at(60.0),
                terri_core::IntentQueue::default(),
            ))
            .id();
        for command in stream(fridge, user) {
            sim.world_mut().resource_mut::<CommandQueue>().push(command);
            if split {
                sim.flush_commands();
            }
        }
        sim.flush_commands();
        for _ in 0..30 {
            sim.tick();
        }
        (sim.save_snapshot_v3(), sim.world_hash())
    };
    let (joined, joined_hash) = world(false);
    let (split, split_hash) = world(true);
    assert_eq!(joined, split);
    assert_eq!(joined_hash, split_hash);
    assert!(matches!(
        &joined.layout,
        SavedLayout::EdgeWallsV1 { edges } if edges.len() == 2
    ));
}

/// [OS-door] in `docs/specs/2026-09-22-the-outside.md`: a wall on the front
/// door's line would shut the door, so it is refused; the line may still be
/// opened. The house's other outside walls, and a yard line that merely
/// shares the door line's numbers, change as any wall does.
#[test]
fn the_front_doors_line_is_never_walled() {
    let sim = Sim::new_from_shipped_lot();
    let edit = |axis, y, state| {
        validate_wall_edit(
            sim.world(),
            WallEdit {
                axis,
                x: 16,
                y,
                state,
            },
        )
    };
    assert_eq!(
        edit(Vertical, 2, Wall).err(),
        Some(PlacementRefusal::BlockedDoor)
    );
    assert!(edit(Vertical, 2, Open).unwrap().changed);
    assert!(edit(Vertical, 3, Doorway).unwrap().changed);
    assert!(edit(Horizontal, 2, Wall).unwrap().changed);
}
