use super::*;
use crate::{Content, Sim};
use terri_core::layout::{EdgeAxis, WallState};
use terri_core::{AtWork, Career, CommandQueue, Funds, SimCommand};

fn worker(position: Position, waiting: bool) -> (Sim, Entity) {
    let mut historical = Sim::new_from_shipped_lot();
    let actor = historical
        .world_mut()
        .query_filtered::<Entity, With<Career>>()
        .iter(historical.world())
        .min_by_key(|e| e.index_u32())
        .unwrap();
    historical.world_mut().entity_mut(actor).insert((
        Position { x: -2., y: 1. },
        AtWork {
            remaining_ticks: 10,
        },
    ));
    let mut sim = Sim::new_from_shipped_lot();
    sim.load_snapshot(historical.save_snapshot())
        .expect("supported historical off-lot worker");
    sim.world_mut().entity_mut(actor).insert(position);
    if waiting {
        sim.world_mut()
            .entity_mut(actor)
            .insert(crate::world_geometry::WaitingToReturn);
    }
    let saved = sim.save_snapshot_v26();
    sim.load_snapshot_v26(saved.clone())
        .expect("valid current hidden-worker control");
    assert_eq!(sim.save_snapshot_v26(), saved);
    (sim, actor)
}
fn confirm(sim: &mut Sim) {
    let review = sim
        .prepare_build_commit(crate::rooms::RoomChoices::default())
        .unwrap();
    sim.commit_build_with_access_ack(review.token).unwrap();
    sim.end_build().unwrap();
    let saved = sim.save_snapshot_v26();
    sim.load_snapshot_v26(saved.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v26(), saved);
}
fn wall(sim: &mut Sim, x: u32, y: u32) {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetWallEdge {
            axis: EdgeAxis::Vertical,
            x,
            y,
            state: WallState::Wall,
        });
    sim.flush_commands();
    assert_eq!(
        sim.world()
            .resource::<LotEditState>()
            .last_wall_result
            .unwrap()
            .reason,
        None
    );
}
#[test]
fn hidden_offlot_and_occupied_workers_allow_unrelated_public_wall_edits() {
    let mut initial = Sim::new_from_shipped_lot();
    let occupied = *initial
        .world_mut()
        .query_filtered::<&Position, With<SmartObject>>()
        .iter(initial.world())
        .next()
        .unwrap();
    assert!(!initial
        .world()
        .resource::<TileGrid>()
        .is_walkable(occupied.x as i32, occupied.y as i32));
    for (position, waiting) in [
        (Position { x: -2., y: 1. }, false),
        (Position { x: -2., y: 1. }, true),
        (occupied, true),
    ] {
        let (mut sim, actor) = worker(position, waiting);
        sim.begin_build().unwrap();
        wall(&mut sim, 18, 10);
        confirm(&mut sim);
        assert_eq!(sim.world().get::<Position>(actor), Some(&position));
        assert!(sim.world().get::<AtWork>(actor).is_some());
        assert_eq!(
            sim.world()
                .get::<crate::world_geometry::WaitingToReturn>(actor)
                .is_some(),
            waiting
        );
    }
}
#[test]
fn hidden_fractional_body_does_not_block_a_wall_but_visible_body_does() {
    let position = Position { x: 18.5, y: 6. };
    let (mut hidden, actor) = worker(position, true);
    hidden.begin_build().unwrap();
    wall(&mut hidden, 19, 6);
    confirm(&mut hidden);
    assert_eq!(hidden.world().get::<Position>(actor), Some(&position));
    let mut visible = Sim::new_from_shipped_lot();
    let actor = visible
        .world_mut()
        .query_filtered::<Entity, With<Agent>>()
        .iter(visible.world())
        .next()
        .unwrap();
    visible.world_mut().entity_mut(actor).insert(position);
    visible
        .load_snapshot_v26(visible.save_snapshot_v26())
        .expect("valid visible actor control");
    visible.begin_build().unwrap();
    visible
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetWallEdge {
            axis: EdgeAxis::Vertical,
            x: 19,
            y: 6,
            state: WallState::Wall,
        });
    visible.flush_commands();
    assert_eq!(
        visible
            .world()
            .resource::<LotEditState>()
            .last_wall_result
            .unwrap()
            .reason,
        Some(PlacementRefusal::SimOverlap)
    );
    visible.end_build().unwrap();
}
#[test]
fn public_purchase_can_occupy_a_waiting_workers_retained_position() {
    let position = Position { x: 18., y: 8. };
    let (mut sim, actor) = worker(position, true);
    sim.world_mut().insert_resource(Funds::from_dollars(10000));
    let pack = sim.world().resource::<Content>().0;
    let model = pack.find("counter").unwrap();
    sim.begin_build().unwrap();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::BuyObject {
            definition: model.0,
            x: 18,
            y: 8,
            facing: pack.object(model).base_facing,
        });
    sim.flush_commands();
    let result = sim
        .world()
        .resource::<LotEditState>()
        .last_purchase_result
        .unwrap();
    assert_eq!(result.reason, None);
    assert!(result.object.is_some());
    confirm(&mut sim);
    assert!(!sim.world().resource::<TileGrid>().is_walkable(18, 8));
    assert_eq!(sim.world().get::<Position>(actor), Some(&position));
}
#[test]
fn hidden_state_with_a_live_path_still_refuses_build_atomically() {
    let (mut sim, actor) = worker(Position { x: -2., y: 1. }, true);
    sim.world_mut().entity_mut(actor).insert(Path {
        steps: vec![],
        cursor: 0,
    });
    let saved = sim.save_snapshot_v26();
    assert_eq!(
        walls::validate_wall_edit(
            sim.world(),
            walls::WallEdit {
                axis: EdgeAxis::Vertical,
                x: 18,
                y: 10,
                state: WallState::Wall,
            }
        )
        .err(),
        Some(PlacementRefusal::SimOverlap)
    );
    assert!(sim.begin_build().is_err());
    assert_eq!(sim.save_snapshot_v26(), saved);
}
