use super::{displayed_position_of, neutral_instincts, projection_of};
use crate::{
    apply_object_placement,
    render_buffer::{activity, facing, visual_action},
    Content, Sim,
};
use terri_core::{Agent, Eating, Position, Target};
use terri_data::Facing;

fn active_bathtub(
    sim: &mut Sim,
    turn: Facing,
) -> (bevy_ecs::entity::Entity, bevy_ecs::entity::Entity) {
    let definition = sim.world().resource::<Content>().0.find("bathtub").unwrap();
    let position = Position { x: 20.0, y: 20.0 };
    let fixture = sim.spawn_object(position, definition);
    apply_object_placement(
        sim.world_mut(),
        fixture,
        terri_data::pack().object(definition),
        position,
        turn,
    );
    let user = sim
        .world_mut()
        .spawn((
            Agent,
            Position { x: 19.0, y: 20.0 },
            Eating {
                object: definition,
                interaction: 0,
                remaining_ticks: 60,
            },
            Target {
                object: fixture,
                interaction: 0,
            },
        ))
        .id();
    neutral_instincts(sim);
    (user, fixture)
}

#[test]
fn bathtub_projects_all_facings_without_changing_positions_or_saves() {
    for (turn, direction, centre) in [
        (Facing::SouthEast, facing::POSITIVE_X, (20.5, 20.0)),
        (Facing::NorthWest, facing::NEGATIVE_X, (20.5, 20.0)),
        (Facing::SouthWest, facing::POSITIVE_Y, (20.0, 20.5)),
        (Facing::NorthEast, facing::NEGATIVE_Y, (20.0, 20.5)),
    ] {
        let mut sim = Sim::new_with_lot(48, 48);
        let (user, fixture) = active_bathtub(&mut sim, turn);
        // The basin socket sits at the tub's origin, which the two-tile
        // footprint turns around its centre, so the displayed body sits half a
        // tile along the footprint's long axis from the placed position.
        let definition = sim.world().resource::<Content>().0.find("bathtub").unwrap();
        let socket = &terri_data::pack().object(definition).sockets_at(20.0, 20.0, turn)[0];
        assert_eq!((socket.x, socket.y), centre);
        let before_position = *sim.world().get::<Position>(user).unwrap();
        let before_hash = sim.world_hash();
        let before_save = sim.save_snapshot_v5();
        sim.sync_render_buffer();
        assert_eq!(
            projection_of(sim.render_buffer(), user),
            (visual_action::BATHE, direction, activity::BATHING)
        );
        assert_eq!(displayed_position_of(sim.render_buffer(), user), (centre, centre));
        let row = sim
            .render_buffer()
            .ids
            .iter()
            .position(|&id| id == user.index_u32())
            .unwrap();
        assert_eq!(
            sim.render_buffer().interaction_targets[row],
            fixture.index_u32()
        );
        assert_eq!(*sim.world().get::<Position>(user).unwrap(), before_position);
        assert_eq!(sim.world_hash(), before_hash);
        assert_eq!(sim.save_snapshot_v5(), before_save);
        let mut loaded = Sim::new_with_lot(1, 1);
        loaded.load_snapshot_v5(before_save.clone()).unwrap();
        assert_eq!(loaded.save_snapshot_v5(), before_save);
        assert_eq!(loaded.world_hash(), before_hash);
        assert_eq!(
            projection_of(loaded.render_buffer(), user),
            (visual_action::BATHE, direction, activity::BATHING)
        );
        assert_eq!(displayed_position_of(loaded.render_buffer(), user), (centre, centre));
    }
}

#[test]
fn mismatched_or_completed_use_does_not_keep_the_bathing_pose() {
    let mut sim = Sim::new_with_lot(48, 48);
    let (user, _) = active_bathtub(&mut sim, Facing::SouthEast);
    sim.sync_render_buffer();
    assert_eq!(projection_of(sim.render_buffer(), user).0, visual_action::BATHE);
    sim.world_mut()
        .entity_mut(user)
        .get_mut::<Target>()
        .unwrap()
        .interaction = 1;
    sim.sync_render_buffer();
    assert_ne!(projection_of(sim.render_buffer(), user).0, visual_action::BATHE);
    sim.world_mut()
        .entity_mut(user)
        .get_mut::<Target>()
        .unwrap()
        .interaction = 0;
    sim.world_mut().entity_mut(user).remove::<Eating>();
    sim.sync_render_buffer();
    assert_ne!(projection_of(sim.render_buffer(), user).0, visual_action::BATHE);
    assert_eq!(
        displayed_position_of(sim.render_buffer(), user),
        ((19.0, 20.0), (19.0, 20.0))
    );
}

#[test]
fn conflicting_work_or_wrong_object_suppresses_bathing_projection() {
    let mut sim = Sim::new_with_lot(48, 48);
    let (user, _) = active_bathtub(&mut sim, Facing::SouthEast);
    sim.sync_render_buffer();
    assert_eq!(projection_of(sim.render_buffer(), user).0, visual_action::BATHE);
    sim.world_mut()
        .entity_mut(user)
        .insert(terri_core::StepWork { remaining_ticks: 4 });
    sim.sync_render_buffer();
    assert_ne!(projection_of(sim.render_buffer(), user).0, visual_action::BATHE);
    sim.world_mut()
        .entity_mut(user)
        .remove::<terri_core::StepWork>();
    sim.world_mut()
        .entity_mut(user)
        .insert(terri_core::AtWork { remaining_ticks: 4 });
    sim.sync_render_buffer();
    assert_eq!(
        projection_of(sim.render_buffer(), user),
        (0, 0, activity::AT_WORK)
    );
    sim.world_mut()
        .entity_mut(user)
        .remove::<terri_core::AtWork>();
    let wrong = terri_data::pack().find("toilet").unwrap();
    sim.world_mut()
        .entity_mut(user)
        .get_mut::<Eating>()
        .unwrap()
        .object = wrong;
    sim.sync_render_buffer();
    assert_ne!(projection_of(sim.render_buffer(), user).0, visual_action::BATHE);
    assert_eq!(
        displayed_position_of(sim.render_buffer(), user),
        ((19.0, 20.0), (19.0, 20.0))
    );
}
