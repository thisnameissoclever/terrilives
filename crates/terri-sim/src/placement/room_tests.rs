//! Tests for building a room - [RT-rules] and [RT-apply] in
//! `docs/specs/2026-09-22-room-tool.md`.

use super::*;
use crate::placement::walls::{validate_wall_edit, WallEdit};
use crate::{Content, Sim};
use terri_core::layout::{EdgeAxis::*, WallState};
use terri_core::{Agent, CommandQueue, Position, SimCommand, Target};

/// A 7 by 7 house with the given edges, a fridge in the corner at (0, 0), and
/// the front door on the east side at (6, 3) with its landing at (5, 3).
fn house(edges: Vec<WallEdge>) -> (Sim, Entity) {
    let mut pack = terri_data::pack().clone();
    pack.lot.width = 7;
    pack.lot.height = 7;
    pack.lot.wall_edges.clear();
    pack.lot.walls.clear();
    pack.lot.placements.clear();
    pack.lot.front_door = Some((6, 3));
    pack.portals[0].position = (6, 3);
    pack.portals[0].inward = (5, 3);
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

fn line(axis: EdgeAxis, x: u32, y: u32) -> WallLine {
    WallLine { axis, x, y }
}

fn wall(axis: EdgeAxis, x: u32, y: u32, doorway: bool) -> WallEdge {
    WallEdge {
        axis,
        x,
        y,
        doorway,
    }
}

fn room(x0: u32, y0: u32, x1: u32, y1: u32, doorway: Option<WallLine>) -> RoomEdit {
    RoomEdit {
        x0,
        y0,
        x1,
        y1,
        doorway,
    }
}

fn command(edit: RoomEdit) -> SimCommand {
    SimCommand::BuildRoom {
        x0: edit.x0,
        y0: edit.y0,
        x1: edit.x1,
        y1: edit.y1,
        doorway: edit.doorway,
    }
}

fn stage(sim: &mut Sim, edit: RoomEdit) {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(command(edit));
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

fn last(sim: &Sim) -> Option<RoomEditResult> {
    sim.world().resource::<LotEditState>().last_room_result
}

/// The preview refuses with `expected`, and so does the commit, and neither
/// writes anything: not the save, not the lot revision.
fn refused(sim: &mut Sim, edit: RoomEdit, expected: PlacementRefusal) {
    let before = sim.save_snapshot_v3();
    let revision_before = revision(sim);
    assert_eq!(
        validate_room(sim.world(), edit).unwrap_err(),
        expected,
        "preview of {edit:?}"
    );
    stage(sim, edit);
    assert_eq!(
        last(sim),
        Some(RoomEditResult {
            edit,
            reason: Some(expected)
        })
    );
    assert_eq!(sim.save_snapshot_v3(), before, "a refused room wrote state");
    assert_eq!(revision(sim), revision_before);
}

fn built(sim: &mut Sim, edit: RoomEdit) {
    assert!(
        validate_room(sim.world(), edit).is_ok(),
        "preview of {edit:?}"
    );
    stage(sim, edit);
    assert_eq!(last(sim), Some(RoomEditResult { edit, reason: None }));
}

#[test]
fn the_outline_leaves_out_the_lot_edge_and_runs_top_bottom_left_right() {
    // A 2 by 2 room in the middle has eight lines.
    assert_eq!(
        outline(7, 7, (2, 2), (3, 3)),
        [
            line(Horizontal, 2, 2),
            line(Horizontal, 3, 2),
            line(Horizontal, 2, 4),
            line(Horizontal, 3, 4),
            line(Vertical, 2, 2),
            line(Vertical, 2, 3),
            line(Vertical, 4, 2),
            line(Vertical, 4, 3),
        ]
    );
    // In the top-left corner only the bottom and right sides are interior.
    assert_eq!(
        outline(7, 7, (0, 0), (1, 1)),
        [
            line(Horizontal, 0, 2),
            line(Horizontal, 1, 2),
            line(Vertical, 2, 0),
            line(Vertical, 2, 1),
        ]
    );
    // In the bottom-right corner only the top and left sides are.
    assert_eq!(
        outline(7, 7, (6, 6), (6, 6)),
        [line(Horizontal, 6, 6), line(Vertical, 6, 6)]
    );
    // The whole lot has no interior outline at all.
    assert!(outline(7, 7, (0, 0), (6, 6)).is_empty());
}

#[test]
fn a_room_walls_its_whole_outline_in_one_edit_in_either_corner_order() {
    for (x0, y0, x1, y1) in [(2, 1, 3, 2), (3, 2, 2, 1), (2, 2, 3, 1)] {
        let (mut sim, _) = house(vec![]);
        let before = revision(&sim);
        built(&mut sim, room(x0, y0, x1, y1, None));
        assert_eq!(revision(&sim), before + 1, "one edit, one revision");
        assert_eq!(
            edges(&sim),
            [
                wall(Horizontal, 2, 1, false),
                wall(Horizontal, 3, 1, false),
                wall(Horizontal, 2, 3, false),
                wall(Horizontal, 3, 3, false),
                wall(Vertical, 2, 1, false),
                wall(Vertical, 2, 2, false),
                wall(Vertical, 4, 1, false),
                wall(Vertical, 4, 2, false),
            ],
            "corners ({x0}, {y0}) and ({x1}, {y1})"
        );
        let grid = sim.world().resource::<TileGrid>();
        assert!(!grid.can_step((2, 0), (2, 1)));
        assert!(!grid.can_step((4, 2), (3, 2)));
        assert!(
            grid.can_step((2, 1), (3, 1)),
            "the room's inside stays open"
        );
    }
}

#[test]
fn a_doorway_on_the_outline_is_built_passable_and_saved_as_a_doorway() {
    let (mut sim, _) = house(vec![]);
    let door = line(Vertical, 4, 2);
    built(&mut sim, room(2, 1, 3, 2, Some(door)));
    assert!(edges(&sim).contains(&wall(Vertical, 4, 2, true)));
    let grid = sim.world().resource::<TileGrid>();
    assert!(grid.can_step((4, 2), (3, 2)));
    assert!(!grid.can_step((4, 1), (3, 1)));
}

#[test]
fn existing_doorways_are_kept_existing_walls_stay_and_the_asked_doorway_opens_a_wall() {
    let (mut sim, _) = house(vec![
        wall(Horizontal, 2, 1, true),
        wall(Vertical, 4, 1, false),
        wall(Vertical, 4, 2, false),
    ]);
    built(&mut sim, room(2, 1, 3, 2, Some(line(Vertical, 4, 2))));
    let after = edges(&sim);
    // Updated where they were, then the new lines in outline order.
    assert_eq!(
        after,
        [
            wall(Horizontal, 2, 1, true),
            wall(Vertical, 4, 1, false),
            wall(Vertical, 4, 2, true),
            wall(Horizontal, 3, 1, false),
            wall(Horizontal, 2, 3, false),
            wall(Horizontal, 3, 3, false),
            wall(Vertical, 2, 1, false),
            wall(Vertical, 2, 2, false),
        ]
    );
}

#[test]
fn a_room_whose_outline_already_stands_writes_nothing() {
    let (mut sim, _) = house(vec![]);
    built(&mut sim, room(2, 1, 3, 2, None));
    let before = sim.save_snapshot_v3();
    let revision_before = revision(&sim);
    let plan = validate_room(sim.world(), room(3, 2, 2, 1, None)).unwrap();
    assert!(!plan.changed);
    built(&mut sim, room(3, 2, 2, 1, None));
    assert_eq!(sim.save_snapshot_v3(), before);
    assert_eq!(revision(&sim), revision_before);
}

#[test]
fn a_room_is_refused_for_each_reason_the_design_lists() {
    // A legacy house keeps its frozen walls.
    let (mut sim, _) = house(vec![]);
    sim.world_mut()
        .insert_resource(SavedLayout::LegacyCells { walls: vec![] });
    refused(
        &mut sim,
        room(2, 1, 3, 2, None),
        PlacementRefusal::UnsupportedLayout,
    );

    let (mut sim, _) = house(vec![]);
    refused(
        &mut sim,
        room(2, 1, 7, 2, None),
        PlacementRefusal::OutOfBounds,
    );
    refused(
        &mut sim,
        room(2, 7, 3, 2, None),
        PlacementRefusal::OutOfBounds,
    );
    refused(
        &mut sim,
        room(2, 1, 3, 2, Some(line(Vertical, 3, 1))),
        PlacementRefusal::InvalidInput,
    );
    // The door's one step in, even with a doorway elsewhere on the outline.
    refused(
        &mut sim,
        room(4, 2, 5, 4, Some(line(Vertical, 4, 3))),
        PlacementRefusal::BlockedLanding,
    );
    // The fridge and the tile below it, walled in with no way through: the
    // fridge's only approach is inside.
    refused(
        &mut sim,
        room(0, 0, 0, 1, None),
        PlacementRefusal::InaccessibleInteraction,
    );
}

/// Review finding [F4] on the Room tool: the order of the checks, tested with
/// two faults at once so the first in [RT-rules] must be the one reported.
#[test]
fn with_two_faults_the_earlier_check_in_the_design_is_reported() {
    let (mut sim, _) = house(vec![]);
    // A corner off the lot outranks a doorway off the outline.
    refused(
        &mut sim,
        room(2, 1, 7, 2, Some(line(Vertical, 3, 1))),
        PlacementRefusal::OutOfBounds,
    );
    // A doorway off the outline outranks every rule for the walls.
    sim.world_mut().spawn((Agent, Position { x: 3.5, y: 2.0 }));
    refused(
        &mut sim,
        room(2, 1, 3, 2, Some(line(Vertical, 3, 1))),
        PlacementRefusal::InvalidInput,
    );
    // The door's one step in outranks furniture cut in half: the room's
    // right side runs down the door line, and its left side cuts a table.
    let (mut sim, _) = house(vec![]);
    let table = terri_data::pack().find("dining_table").unwrap();
    sim.spawn_object(Position { x: 3.0, y: 3.0 }, table);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(3, 3, true);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(4, 3, true);
    refused(
        &mut sim,
        room(4, 2, 5, 4, Some(line(Horizontal, 4, 2))),
        PlacementRefusal::BlockedLanding,
    );
}

/// The proofs run on the finished room, doorway included.
#[test]
fn a_room_around_furniture_is_built_when_its_doorway_lets_a_sim_reach_it() {
    let (mut sim, _) = house(vec![]);
    built(&mut sim, room(0, 0, 0, 1, Some(line(Vertical, 1, 1))));
    assert!(sim.world().resource::<TileGrid>().can_step((1, 1), (0, 1)));
}

#[test]
fn a_room_is_held_to_every_single_wall_rule_on_every_line() {
    // Furniture cut in half by the outline.
    let (mut sim, _) = house(vec![]);
    let table = terri_data::pack().find("dining_table").unwrap();
    let entity = sim.spawn_object(Position { x: 3.0, y: 5.0 }, table);
    let footprint = crate::placed_footprint(
        sim.world().resource::<Content>().0,
        table,
        sim.world().get::<terri_core::ObjectFacing>(entity),
    );
    assert_eq!((footprint.width, footprint.depth), (2, 1));
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(3, 5, true);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(4, 5, true);
    refused(
        &mut sim,
        room(1, 4, 3, 5, None),
        PlacementRefusal::WallOverlap,
    );

    // A sim standing across a line of the outline.
    let (mut sim, _) = house(vec![]);
    sim.world_mut().spawn((Agent, Position { x: 3.5, y: 2.0 }));
    refused(
        &mut sim,
        room(2, 1, 3, 2, Some(line(Horizontal, 2, 1))),
        PlacementRefusal::SimOverlap,
    );

    // A sim using the fridge from across a line of the outline.
    let (mut sim, fridge) = house(vec![]);
    sim.world_mut().spawn((
        Agent,
        Position { x: 1.0, y: 0.0 },
        Target {
            object: fridge,
            interaction: 0,
        },
    ));
    refused(
        &mut sim,
        room(1, 0, 2, 1, Some(line(Horizontal, 1, 2))),
        PlacementRefusal::InUse,
    );
}

/// The kinds of refusal come in [WT-rules] order across the whole outline,
/// not line by line: furniture cut by a later line outranks a sim across an
/// earlier one.
#[test]
fn the_first_kind_of_refusal_wins_across_the_whole_outline() {
    let (mut sim, _) = house(vec![]);
    // A sim across the top side, the first line in outline order.
    sim.world_mut().spawn((Agent, Position { x: 2.0, y: 0.5 }));
    // A table cut by the right side, the last lines in outline order.
    let table = terri_data::pack().find("dining_table").unwrap();
    sim.spawn_object(Position { x: 3.0, y: 2.0 }, table);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(3, 2, true);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(4, 2, true);
    refused(
        &mut sim,
        room(2, 1, 3, 2, Some(line(Horizontal, 2, 3))),
        PlacementRefusal::WallOverlap,
    );
}

#[test]
fn a_room_sees_the_orders_issued_before_it_and_not_those_after() {
    for cancel_first in [true, false] {
        let (mut sim, fridge) = house(vec![]);
        let user = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 0.0 },
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
        let build = command(room(1, 0, 2, 1, Some(line(Horizontal, 1, 2))));
        {
            let mut queue = sim.world_mut().resource_mut::<CommandQueue>();
            if cancel_first {
                queue.push(cancel);
                queue.push(build);
            } else {
                queue.push(build);
                queue.push(cancel);
            }
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
    }
}

#[test]
fn a_built_room_and_a_staged_room_survive_save_and_load() {
    let (mut sim, _) = house(vec![]);
    built(&mut sim, room(2, 1, 3, 2, Some(line(Vertical, 4, 2))));
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(command(room(1, 4, 2, 5, Some(line(Horizontal, 1, 4)))));
    let saved = sim.save_snapshot_v3();
    assert!(saved
        .world
        .queued_commands
        .contains(&terri_core::SavedCommand::BuildRoom {
            x0: 1,
            y0: 4,
            x1: 2,
            y1: 5,
            doorway: Some(line(Horizontal, 1, 4)),
        }));
    let (mut restored, _) = house(vec![]);
    restored
        .load_snapshot_v3(saved.clone())
        .expect("a built room loads");
    assert_eq!(restored.save_snapshot_v3(), saved);
    assert_eq!(restored.world_hash(), sim.world_hash());
    restored.flush_commands();
    sim.flush_commands();
    assert_eq!(restored.save_snapshot_v3(), sim.save_snapshot_v3());
    assert_eq!(restored.world_hash(), sim.world_hash());
    assert!(edges(&restored).contains(&wall(Horizontal, 1, 4, true)));
}

/// [RT-hash]. The digest sees every field of a staged room.
#[test]
fn the_world_hash_sees_every_field_of_a_staged_room() {
    let staged = |edit: RoomEdit| {
        let (mut sim, _) = house(vec![]);
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(command(edit));
        sim.world_hash()
    };
    let door = line(Vertical, 4, 2);
    let base = room(2, 1, 3, 2, Some(door));
    let reference = staged(base);
    for (name, changed) in [
        ("x0", RoomEdit { x0: 1, ..base }),
        ("y0", RoomEdit { y0: 0, ..base }),
        ("x1", RoomEdit { x1: 4, ..base }),
        ("y1", RoomEdit { y1: 3, ..base }),
        (
            "no doorway",
            RoomEdit {
                doorway: None,
                ..base
            },
        ),
        (
            "doorway axis",
            RoomEdit {
                doorway: Some(line(Horizontal, 4, 2)),
                ..base
            },
        ),
        (
            "doorway x",
            RoomEdit {
                doorway: Some(line(Vertical, 2, 2)),
                ..base
            },
        ),
        (
            "doorway y",
            RoomEdit {
                doorway: Some(line(Vertical, 4, 1)),
                ..base
            },
        ),
    ] {
        assert_ne!(staged(changed), reference, "{name}");
    }
}

/// Review finding [F2] on the Room tool. Without the doorway marker these two
/// queues write the same numbers, command count included: a room with no
/// doorway runs on into the next command's words. The marker keeps them apart.
#[test]
fn the_world_hash_keeps_a_room_s_words_from_running_into_the_next_command() {
    let hash = |commands: Vec<SimCommand>| {
        let (mut sim, _) = house(vec![]);
        for command in commands {
            sim.world_mut().resource_mut::<CommandQueue>().push(command);
        }
        sim.world_hash()
    };
    let corners = room(2, 1, 3, 2, None);
    let facing = terri_core::Facing::SouthWest;
    let a = hash(vec![
        command(corners),
        SimCommand::Select(Some(4)),
        SimCommand::PlaceObject {
            object: 3,
            x: 2,
            y: 2,
            facing,
        },
    ]);
    let b = hash(vec![
        command(RoomEdit {
            doorway: Some(line(Vertical, 4, 7)),
            ..corners
        }),
        SimCommand::SetSpeed(2),
        SimCommand::CancelIntents {
            agent: u32::from(facing.code()),
        },
    ]);
    assert_ne!(a, b);

    // And with only the "no doorway" marker missing: a room with a doorway
    // writes exactly what a room without one followed by an order with the
    // doorway's numbers would, so these two three-command queues would match.
    let order = |x: u32, y: u32| SimCommand::UseObject {
        agent: u32::from(Vertical.code()),
        object: x,
        interaction: y,
    };
    let (first, second) = (room(2, 1, 3, 2, None), room(1, 4, 2, 5, None));
    let with = |edit: RoomEdit, x: u32, y: u32| {
        command(RoomEdit {
            doorway: Some(line(Vertical, x, y)),
            ..edit
        })
    };
    let c = hash(vec![with(first, 4, 2), command(second), order(3, 5)]);
    let d = hash(vec![command(first), order(4, 2), with(second, 3, 5)]);
    assert_ne!(c, d);

    // And with only the 1 before a doorway missing, which the second review
    // found: the doorway's numbers then read as a speed change.
    let e = hash(vec![
        with(first, 3, 2),
        command(second),
        SimCommand::SetSpeed(1),
    ]);
    let f = hash(vec![
        command(first),
        SimCommand::SetSpeed(2),
        with(second, 3, 1),
    ]);
    assert_ne!(e, f);
}

#[test]
fn a_stream_with_rooms_drains_the_same_joined_or_split() {
    let stream = || {
        vec![
            command(room(2, 1, 3, 2, Some(line(Vertical, 4, 2)))),
            SimCommand::SetSpeed(2),
            command(room(0, 0, 1, 1, None)),
            command(room(1, 4, 2, 5, Some(line(Horizontal, 1, 4)))),
        ]
    };
    let (mut joined, _) = house(vec![]);
    for command in stream() {
        joined
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(command);
    }
    joined.flush_commands();
    let (mut split, _) = house(vec![]);
    for command in stream() {
        split
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(command);
        split.flush_commands();
    }
    assert_eq!(joined.world_hash(), split.world_hash());
    assert_eq!(joined.save_snapshot_v3(), split.save_snapshot_v3());
}

/// Every small room the shipped household accepts, with no doorway and with a
/// doorway on its first line, at two points in the day, is accepted by the
/// drain; one in three of them, chosen by a fixed count, is saved and loaded
/// back for real. Every room reaches the loader's own grid checks through
/// `check_new_walls` anyway, and a one-off review sweep of over 8,000 rooms a
/// tick saved and loaded every accepted one without a failure, so the sample
/// keeps the round trip honest while keeping this test fast: the mutation
/// sweep reruns it for every mutant, under a 60-second limit. The two ticks
/// run on their own threads for the same reason.
///
/// It also counts rooms that only the loader's own checks refuse: the finished
/// outline passes the usability proofs, fails the loader, and is refused as
/// `BlockedRoute`, which with the proofs passing only the loader can give. It
/// fails if it finds none, so a household change that moves the case away from
/// these ticks fails loudly rather than emptying the test, as its wall twin
/// does.
#[test]
fn every_small_room_the_shipped_household_accepts_leaves_a_save_that_loads() {
    let counts: Vec<(u32, u32)> = std::thread::scope(|scope| {
        let sweeps: Vec<_> = [180u64, 620]
            .into_iter()
            .map(|ticks| scope.spawn(move || sweep_small_rooms(ticks)))
            .collect();
        sweeps
            .into_iter()
            .map(|sweep| sweep.join().expect("a sweep panicked"))
            .collect()
    });
    for (accepted, _) in &counts {
        assert!(*accepted > 20, "a tick accepted only {accepted}");
    }
    assert!(
        counts.iter().map(|(_, loader)| loader).sum::<u32>() > 0,
        "no room here is refused by the loader's checks alone; choose ticks that hold one"
    );
}

/// One tick of the sweep above: how many rooms were accepted, and how many
/// only the loader refused.
fn sweep_small_rooms(ticks: u64) -> (u32, u32) {
    let mut sim = Sim::new_from_shipped_lot();
    for _ in 0..ticks {
        sim.tick();
    }
    assert_eq!(
        sim.world().resource::<terri_core::SimClock>().tick,
        ticks,
        "one tick per `Sim::tick`"
    );
    let base = sim.save_snapshot_v3();
    // One world to build each sampled room in and one to read its save back,
    // each reset by a Load.
    let mut builder = Sim::new_from_shipped_lot();
    let mut reader = Sim::new_from_shipped_lot();
    let rectangles = super::super::current_layout(sim.world())
        .expect("the shipped house is consistent")
        .rectangles;
    let (width, height) = {
        let grid = sim.world().resource::<TileGrid>();
        (grid.width() as u32, grid.height() as u32)
    };
    let (mut accepted, mut only_the_loader_refused) = (0, 0);
    for y in 0..height {
        for x in 0..width {
            for (w, h) in [(1, 1), (2, 1), (1, 2), (2, 2), (3, 2)] {
                if x + w > width || y + h > height {
                    continue;
                }
                let corner = (x + w - 1, y + h - 1);
                let first = outline(width, height, (x, y), corner).first().copied();
                for doorway in [None, first] {
                    let edit = room(x, y, corner.0, corner.1, doorway);
                    let grid = finished(&sim, edit);
                    let verdict = validate_room(sim.world(), edit);
                    if super::super::prove_lot_usable(sim.world(), &grid, &rectangles).is_ok()
                        && crate::save::candidate_grid_loads(sim.world(), &grid).is_err()
                    {
                        assert!(verdict.is_err(), "{edit:?}");
                        // Furniture cut in half is refused before the loader
                        // is asked; count only what reached it.
                        if verdict.as_ref().unwrap_err() == &PlacementRefusal::BlockedRoute {
                            only_the_loader_refused += 1;
                        }
                    }
                    match verdict {
                        Ok(plan) if plan.changed => {}
                        _ => continue,
                    }
                    accepted += 1;
                    if accepted % 3 != 0 {
                        continue;
                    }
                    builder.load_snapshot_v3(base.clone()).unwrap();
                    stage(&mut builder, edit);
                    assert_eq!(last(&builder).unwrap().reason, None, "{edit:?}");
                    reader
                        .load_snapshot_v3(builder.save_snapshot_v3())
                        .unwrap_or_else(|error| panic!("{edit:?} at tick {ticks}: {error:?}"));
                }
            }
        }
    }
    (accepted, only_the_loader_refused)
}

/// The grid a room would leave, built the way [RT-apply] builds it: every
/// outline line not already recorded becomes a wall or the doorway, and the
/// doorway asked for opens a wall already there.
fn finished(sim: &Sim, edit: RoomEdit) -> TileGrid {
    let mut grid = sim.world().resource::<TileGrid>().clone();
    let recorded = edges(sim);
    let (width, height) = (grid.width() as u32, grid.height() as u32);
    for line in outline(
        width,
        height,
        (edit.x0.min(edit.x1), edit.y0.min(edit.y1)),
        (edit.x0.max(edit.x1), edit.y0.max(edit.y1)),
    ) {
        let doorway = edit.doorway == Some(line);
        let [a, b] = wall(line.axis, line.x, line.y, doorway).cells();
        match recorded
            .iter()
            .find(|e| e.axis == line.axis && e.x == line.x && e.y == line.y)
        {
            Some(existing) if doorway && !existing.doorway => grid.set_edge_blocked(a, b, false),
            Some(_) => {}
            None => grid.set_edge_blocked(a, b, !doorway),
        }
    }
    grid
}

/// The doorway is not a wall: a sim standing across it, or using something
/// through it, does not stop the room.
#[test]
fn the_doorway_line_is_never_held_to_the_rules_for_a_wall() {
    let (mut sim, _) = house(vec![]);
    sim.world_mut().spawn((Agent, Position { x: 3.5, y: 2.0 }));
    refused(
        &mut sim,
        room(2, 1, 3, 2, None),
        PlacementRefusal::SimOverlap,
    );
    built(&mut sim, room(2, 1, 3, 2, Some(line(Vertical, 4, 2))));
}

/// [RD-root] in `docs/specs/2026-09-22-reach-from-the-door.md`: the house is
/// judged from its front door. The proofs used to flood the floor from the
/// first walkable tile, which in the shipped house is (7, 0), so an empty room
/// sealed around that tile made the rest of the house look cut off, while the
/// same room at (9, 0) was built.
#[test]
fn an_empty_sealed_room_is_built_wherever_it_stands() {
    let sim = Sim::new_from_shipped_lot();
    let grid = sim.world().resource::<TileGrid>();
    let first = (0..grid.height() as i32)
        .flat_map(|y| (0..grid.width() as i32).map(move |x| (x, y)))
        .find(|&(x, y)| grid.is_walkable(x, y));
    assert_eq!(
        first,
        Some((7, 0)),
        "the room below stands on the first walkable tile"
    );
    for x in [7, 9] {
        let mut sim = Sim::new_from_shipped_lot();
        built(&mut sim, room(x, 0, x, 0, None));
    }
}

/// Opening a doorway in a room that already stands only removes a barrier,
/// so it is accepted even in a house that is already cut in two, as a single
/// doorway is.
#[test]
fn a_room_that_only_opens_a_doorway_is_accepted_even_in_a_house_already_cut_in_two() {
    let mut walls: Vec<WallEdge> = (0..7).map(|y| wall(Vertical, 5, y, false)).collect();
    walls.extend([
        wall(Horizontal, 2, 1, false),
        wall(Horizontal, 2, 2, false),
        wall(Vertical, 2, 1, false),
        wall(Vertical, 3, 1, false),
    ]);
    let (mut sim, _) = house(walls);
    // The rest of the house, fridge included, is cut off from the door strip
    // beyond x = 5, so any new wall is refused ([RD-reasons]).
    refused(
        &mut sim,
        room(2, 3, 2, 3, None),
        PlacementRefusal::InaccessibleInteraction,
    );
    // The one-tile room at (2, 1) already stands; its doorway only opens it.
    built(&mut sim, room(2, 1, 2, 1, Some(line(Vertical, 3, 1))));
    assert!(edges(&sim).contains(&wall(Vertical, 3, 1, true)));
}

#[test]
fn a_single_wall_still_follows_the_single_wall_rules() {
    // The shared rules, called with one wall, refuse what they always did.
    let (mut sim, _) = house(vec![]);
    sim.world_mut().spawn((Agent, Position { x: 3.5, y: 2.0 }));
    assert_eq!(
        validate_wall_edit(
            sim.world(),
            WallEdit {
                axis: Vertical,
                x: 4,
                y: 2,
                state: WallState::Wall
            }
        )
        .unwrap_err(),
        PlacementRefusal::SimOverlap
    );
}

/// [OS-door] in `docs/specs/2026-09-22-the-outside.md`: once the player has
/// opened the front door's line, a room whose outline crosses it makes it the
/// room's doorway or is refused, since a wall there would shut the door. A
/// room that only touches the line's numbers along another axis is built.
#[test]
fn a_room_never_walls_the_front_doors_line() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetWallEdge {
            axis: Vertical,
            x: 16,
            y: 2,
            state: WallState::Open,
        });
    sim.flush_commands();
    let room = |x0, y0, x1, y1, doorway| {
        validate_room(
            sim.world(),
            RoomEdit {
                x0,
                y0,
                x1,
                y1,
                doorway,
            },
        )
    };
    // Out to the lot's east edge, so the street's exit is inside the room
    // the front door opens into ([OS-street]).
    assert_eq!(
        room(16, 1, 19, 3, None).err(),
        Some(PlacementRefusal::BlockedDoor)
    );
    assert!(
        room(16, 1, 19, 3, Some(line(Vertical, 16, 2)))
            .unwrap()
            .changed
    );
    // Short of the edge, the same room shuts the street off from the door.
    assert_eq!(
        room(16, 1, 18, 3, Some(line(Vertical, 16, 2))).err(),
        Some(PlacementRefusal::BlockedRoute)
    );
    assert!(room(16, 0, 18, 1, None).unwrap().changed);
}
