//! Target-specific ottoman seating preserves simulation positions and saved state.
use super::*;
use crate::render_buffer::{activity, facing, visual_action, NO_INTERACTION_TARGET};
use terri_core::{
    Agent, CommandQueue, Eating, Facing, Position, SelfPreservation, SimCommand, Target,
};

const PATH: Position = Position { x: 8.0, y: 7.0 };
const SEAT: Position = Position { x: 8.0, y: 8.0 };

fn fixture(direction: Facing) -> (Sim, Entity, Entity) {
    fixture_at(direction, PATH)
}

fn fixture_at(direction: Facing, path: Position) -> (Sim, Entity, Entity) {
    let pack = terri_data::pack();
    let object = pack.find("sofa").unwrap();
    let mut sim = Sim::new_with_lot(24, 24);
    let target = sim.spawn_object(SEAT, object);
    apply_object_placement(
        sim.world_mut(),
        target,
        pack.object(object),
        SEAT,
        direction,
    );
    let agent = sim
        .world_mut()
        .spawn((Agent, path, SelfPreservation(50)))
        .id();
    sim.sync_render_buffer();
    sim.world_mut().entity_mut(agent).insert((
        Eating {
            object,
            interaction: 0,
            remaining_ticks: 10,
        },
        Target {
            object: target,
            interaction: 0,
        },
    ));
    (sim, target, agent)
}

fn row(sim: &Sim, entity: Entity) -> usize {
    sim.render_buffer()
        .ids
        .iter()
        .position(|&id| id == entity.index_u32())
        .expect("live entity missing from render buffer")
}

fn seated(sim: &Sim, target: Entity, agent: Entity, direction: u32) {
    seated_at(sim, target, agent, direction, PATH);
}

fn seated_at(sim: &Sim, target: Entity, agent: Entity, direction: u32, path: Position) {
    let render = sim.render_buffer();
    let index = row(sim, agent);
    assert_eq!(render.visual_actions[index], visual_action::SIT);
    assert_eq!(render.activities[index], activity::SITTING);
    assert_eq!(render.facings[index], direction);
    assert_eq!(render.interaction_targets[index], target.index_u32());
    assert_eq!(&render.positions[index * 2..index * 2 + 2], &[8.0, 8.0]);
    assert_eq!(
        &render.prev_positions[index * 2..index * 2 + 2],
        &[8.0, 8.0]
    );
    assert_eq!(sim.world().get::<Position>(agent), Some(&path));
}

#[test]
fn all_ottoman_facings_reseed_at_the_seat_and_restore_without_ticking() {
    for (direction, expected, path) in [
        (
            Facing::SouthEast,
            facing::POSITIVE_Y,
            Position { x: 8.0, y: 9.0 },
        ),
        (
            Facing::SouthWest,
            facing::NEGATIVE_X,
            Position { x: 7.0, y: 8.0 },
        ),
        (Facing::NorthWest, facing::NEGATIVE_Y, PATH),
        (
            Facing::NorthEast,
            facing::POSITIVE_X,
            Position { x: 9.0, y: 8.0 },
        ),
    ] {
        let (mut sim, target, agent) = fixture_at(direction, path);
        let before = sim.save_snapshot_v5();
        let hash = sim.world_hash();
        sim.sync_render_buffer_after_commands();
        seated_at(&sim, target, agent, expected, path);
        sim.sync_render_buffer();
        seated_at(&sim, target, agent, expected, path);
        assert_eq!(sim.save_snapshot_v5(), before);
        assert_eq!(sim.world_hash(), hash);

        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::SetColourway {
                object: target.index_u32(),
                colourway: 2,
            });
        sim.flush_commands();
        sim.sync_render_buffer_after_commands();
        assert_eq!(sim.render_buffer().colourways[row(&sim, target)], 2);
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::SetColourway {
                object: target.index_u32(),
                colourway: 3,
            });
        let pending = sim.save_snapshot_v5();
        let pending_hash = sim.world_hash();
        let mut restored = Sim::new_with_lot(1, 1);
        restored.load_snapshot_v5(pending.clone()).unwrap();
        seated_at(&restored, target, agent, expected, path);
        assert_eq!(restored.save_snapshot_v5(), pending);
        assert_eq!(restored.world_hash(), pending_hash);
        assert_eq!(
            restored.render_buffer().colourways[row(&restored, target)],
            2
        );
        restored.flush_commands();
        restored.sync_render_buffer_after_commands();
        assert_eq!(
            restored.render_buffer().colourways[row(&restored, target)],
            3
        );
        seated_at(&restored, target, agent, expected, path);
    }
}

#[test]
fn cancel_ottoman_use_returns_to_the_unchanged_path_tile_without_gliding() {
    let (mut sim, target, agent) = fixture(Facing::SouthEast);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: agent.index_u32(),
            object: target.index_u32(),
            interaction: 0,
        });
    sim.flush_commands();
    sim.sync_render_buffer_after_commands();
    seated(&sim, target, agent, facing::POSITIVE_Y);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: agent.index_u32(),
        });
    sim.flush_commands();
    sim.sync_render_buffer_after_commands();
    let render = sim.render_buffer();
    let index = row(&sim, agent);
    assert_eq!(render.visual_actions[index], visual_action::NONE);
    assert_eq!(render.interaction_targets[index], NO_INTERACTION_TARGET);
    assert_eq!(&render.positions[index * 2..index * 2 + 2], &[8.0, 7.0]);
    assert_eq!(
        &render.prev_positions[index * 2..index * 2 + 2],
        &[8.0, 7.0]
    );
    assert_eq!(sim.world().get::<Position>(agent), Some(&PATH));
}

#[test]
fn cancelling_empty_orders_does_not_interrupt_autonomous_ottoman_use() {
    let (mut sim, target, agent) = fixture(Facing::SouthEast);
    sim.sync_render_buffer_after_commands();
    seated(&sim, target, agent, facing::POSITIVE_Y);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: agent.index_u32(),
        });
    sim.flush_commands();
    sim.sync_render_buffer_after_commands();
    seated(&sim, target, agent, facing::POSITIVE_Y);
}

#[test]
fn ottoman_pose_requires_the_matching_object_interaction_and_resolved_seat() {
    for missing in [
        "target",
        "different object",
        "interaction",
        "socket",
        "position",
    ] {
        let (mut sim, target, agent) = fixture(Facing::SouthEast);
        sim.sync_render_buffer_after_commands();
        seated(&sim, target, agent, facing::POSITIVE_Y);
        match missing {
            "target" => {
                sim.world_mut().entity_mut(agent).remove::<Target>();
            }
            "different object" => {
                let armchair = terri_data::pack().find("armchair").unwrap();
                let decoy = sim.spawn_object(Position { x: 12.0, y: 12.0 }, armchair);
                sim.world_mut().get_mut::<Target>(agent).unwrap().object = decoy;
            }
            "interaction" => {
                sim.world_mut()
                    .get_mut::<Eating>(agent)
                    .unwrap()
                    .interaction = 1;
            }
            "socket" => {
                sim.world_mut()
                    .entity_mut(target)
                    .remove::<ResolvedActionSockets>();
            }
            "position" => {
                sim.world_mut().entity_mut(target).remove::<Position>();
            }
            _ => unreachable!(),
        }
        sim.sync_render_buffer_after_commands();
        let render = sim.render_buffer();
        let index = row(&sim, agent);
        assert_eq!(
            render.visual_actions[index],
            visual_action::NONE,
            "{missing}"
        );
        assert_eq!(
            render.interaction_targets[index], NO_INTERACTION_TARGET,
            "{missing}"
        );
        assert_eq!(
            render.activities[index],
            activity::USING_OBJECT,
            "{missing}"
        );
        assert_eq!(
            &render.positions[index * 2..index * 2 + 2],
            &[8.0, 7.0],
            "{missing}"
        );
        assert_eq!(
            &render.prev_positions[index * 2..index * 2 + 2],
            &[8.0, 7.0],
            "{missing}"
        );
    }
}
