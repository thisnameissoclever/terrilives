//! Tests for wall edits - [WT-rules] and [WT-apply] in
//! `docs/specs/2026-09-21-wall-tool.md`.

use super::*;
use crate::{Content, Sim};
use terri_core::layout::{EdgeAxis::*, WallState::*};
use terri_core::{CommandQueue, Footprint, SimCommand};

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

#[test]
fn a_wall_is_held_to_every_proof_a_furniture_move_is() {
    // One gap left in a partition at x = 3; closing it cuts the door off.
    let mut walls = partition(3);
    walls.retain(|edge| edge.y != 3);
    let (mut sim, _) = house(walls.clone());
    refused(
        &mut sim,
        edit(Vertical, 3, 3, Wall),
        PlacementRefusal::BlockedDoor,
    );

    // With a sim on the far side, the sim is what the proofs find first.
    let (mut sim, _) = house(walls.clone());
    sim.world_mut().spawn((Agent, Position { x: 5.0, y: 5.0 }));
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
    // Closing a line in that same house is held to the proofs, and fails.
    refused(
        &mut sim,
        edit(Vertical, 3, 3, Wall),
        PlacementRefusal::BlockedDoor,
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
