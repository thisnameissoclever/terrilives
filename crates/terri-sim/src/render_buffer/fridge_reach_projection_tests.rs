use super::{displayed_position_of, neutral_instincts, projection_of};
use crate::{
    apply_object_placement,
    render_buffer::{activity, facing, visual_action},
    systems::chain::CHAIN_STEP,
    Content, Sim,
};
use terri_core::{Agent, ChainState, Position, StepWork, StepWorkTotal, Target};
use terri_data::Facing;

/// The tile in front of a fridge placed at (20, 20) and the facing that looks
/// back at it, for each turn of the SE-authored model.
const FRONTS: [(Facing, (f32, f32), u32); 4] = [
    (Facing::SouthEast, (21.0, 20.0), facing::NEGATIVE_X),
    (Facing::SouthWest, (20.0, 21.0), facing::NEGATIVE_Y),
    (Facing::NorthWest, (19.0, 20.0), facing::POSITIVE_X),
    (Facing::NorthEast, (20.0, 19.0), facing::POSITIVE_Y),
];

fn chain(sim: &Sim, id: &str) -> u32 {
    sim.world()
        .resource::<Content>()
        .0
        .chains
        .iter()
        .position(|chain| chain.id == id)
        .unwrap() as u32
}

fn fetching(
    sim: &mut Sim,
    turn: Facing,
    at: (f32, f32),
    recipe: &str,
    remaining: u32,
    total: u32,
) -> (bevy_ecs::entity::Entity, bevy_ecs::entity::Entity) {
    let definition = sim.world().resource::<Content>().0.find("fridge").unwrap();
    let position = Position { x: 20.0, y: 20.0 };
    let fridge = sim.spawn_object(position, definition);
    apply_object_placement(
        sim.world_mut(),
        fridge,
        terri_data::pack().object(definition),
        position,
        turn,
    );
    let recipe = chain(sim, recipe);
    let user = sim
        .world_mut()
        .spawn((
            Agent,
            Position { x: at.0, y: at.1 },
            ChainState::begin(recipe),
            StepWork {
                remaining_ticks: remaining,
            },
            StepWorkTotal { ticks: total },
            Target {
                object: fridge,
                interaction: CHAIN_STEP,
            },
        ))
        .id();
    neutral_instincts(sim);
    (user, fridge)
}

fn row_of(sim: &Sim, entity: bevy_ecs::entity::Entity) -> usize {
    sim.render_buffer()
        .ids
        .iter()
        .position(|&id| id == entity.index_u32())
        .unwrap()
}

#[test]
fn both_fridge_steps_project_the_reach_in_every_facing_without_changing_saves() {
    for recipe in ["cook_dinner", "prepare_snack"] {
        for (turn, front, direction) in FRONTS {
            let mut sim = Sim::new_with_lot(48, 48);
            let (user, fridge) = fetching(&mut sim, turn, front, recipe, 30, 30);
            let before_hash = sim.world_hash();
            let before_save = sim.save_snapshot_v5();
            sim.sync_render_buffer();
            assert_eq!(
                projection_of(sim.render_buffer(), user),
                (visual_action::FETCH, direction, activity::GETTING_INGREDIENTS),
                "{recipe} {turn:?}"
            );
            assert_eq!(displayed_position_of(sim.render_buffer(), user), (front, front));
            let row = row_of(&sim, user);
            assert_eq!(
                sim.render_buffer().interaction_targets[row],
                fridge.index_u32()
            );
            assert_eq!(sim.render_buffer().chore_progress[row], 0);
            assert_eq!(sim.world_hash(), before_hash);
            assert_eq!(sim.save_snapshot_v5(), before_save);
        }
    }
}

#[test]
fn reach_progress_rises_through_every_sample_for_any_sampled_length() {
    // Sampled lengths run from the 12-tick floor to 1.4 times the 30-tick
    // content duration, and a little beyond.
    for total in 12..=48 {
        let mut sim = Sim::new_with_lot(48, 48);
        let (user, _) = fetching(
            &mut sim,
            Facing::SouthEast,
            (21.0, 20.0),
            "cook_dinner",
            total,
            total,
        );
        let mut previous = 0;
        let mut samples = Vec::new();
        for remaining in (1..=total).rev() {
            sim.world_mut()
                .get_mut::<StepWork>(user)
                .unwrap()
                .remaining_ticks = remaining;
            sim.sync_render_buffer();
            let row = row_of(&sim, user);
            assert_eq!(sim.render_buffer().visual_actions[row], visual_action::FETCH);
            let progress = sim.render_buffer().chore_progress[row];
            assert!(progress >= previous && progress < 1000, "{total}: {progress}");
            previous = progress;
            // The web's fetchFrame rule over eight samples.
            let sample = (progress * 8 / 1000).min(7);
            if samples.last() != Some(&sample) {
                samples.push(sample);
            }
        }
        assert_eq!(samples, (0..8).collect::<Vec<_>>(), "{total}");
    }
}

#[test]
fn a_loaded_reach_resumes_halfway_and_the_save_is_unchanged() {
    let mut sim = Sim::new_with_lot(48, 48);
    let (user, _) = fetching(
        &mut sim,
        Facing::SouthWest,
        (20.0, 21.0),
        "prepare_snack",
        9,
        20,
    );
    let save = sim.save_snapshot_v5();
    let hash = sim.world_hash();
    let mut loaded = Sim::new_with_lot(1, 1);
    loaded.load_snapshot_v5(save.clone()).unwrap();
    assert_eq!(loaded.save_snapshot_v5(), save);
    assert_eq!(loaded.world_hash(), hash);
    assert_eq!(
        loaded.world().get::<StepWorkTotal>(user),
        Some(&StepWorkTotal { ticks: 18 })
    );
    loaded.sync_render_buffer();
    assert_eq!(
        projection_of(loaded.render_buffer(), user),
        (
            visual_action::FETCH,
            facing::NEGATIVE_Y,
            activity::GETTING_INGREDIENTS
        )
    );
    let row = row_of(&loaded, user);
    assert_eq!(loaded.render_buffer().chore_progress[row], 500);
}

#[test]
fn cancelled_misplaced_or_wrong_station_reaches_keep_the_standing_pose() {
    let mut sim = Sim::new_with_lot(48, 48);
    let (user, _) = fetching(
        &mut sim,
        Facing::SouthEast,
        (21.0, 20.0),
        "cook_dinner",
        20,
        30,
    );
    sim.sync_render_buffer();
    let row = row_of(&sim, user);
    assert_eq!(sim.render_buffer().visual_actions[row], visual_action::FETCH);
    assert_eq!(sim.render_buffer().chore_progress[row], 333);

    // A body beside the fridge rather than in front of its door.
    sim.world_mut()
        .entity_mut(user)
        .insert(Position { x: 20.0, y: 21.0 });
    sim.sync_render_buffer();
    let row = row_of(&sim, user);
    assert_ne!(sim.render_buffer().visual_actions[row], visual_action::FETCH);
    assert_eq!(sim.render_buffer().chore_progress[row], 0);
    assert_eq!(
        displayed_position_of(sim.render_buffer(), user),
        ((20.0, 21.0), (20.0, 21.0))
    );

    // A blocked front tile cannot hold the reach either.
    sim.world_mut()
        .entity_mut(user)
        .insert(Position { x: 21.0, y: 20.0 });
    sim.world_mut()
        .resource_mut::<terri_core::TileGrid>()
        .set_blocked(21, 20, true);
    sim.sync_render_buffer();
    assert_ne!(projection_of(sim.render_buffer(), user).0, visual_action::FETCH);
    sim.world_mut()
        .resource_mut::<terri_core::TileGrid>()
        .set_blocked(21, 20, false);
    sim.sync_render_buffer();
    assert_eq!(projection_of(sim.render_buffer(), user).0, visual_action::FETCH);

    // A later step of the same chain is not a fetch.
    sim.world_mut().get_mut::<ChainState>(user).unwrap().step = 1;
    sim.sync_render_buffer();
    assert_ne!(projection_of(sim.render_buffer(), user).0, visual_action::FETCH);
    sim.world_mut().get_mut::<ChainState>(user).unwrap().step = 0;

    // Cancellation removes the step work and with it the reach.
    sim.world_mut()
        .entity_mut(user)
        .remove::<StepWork>()
        .remove::<StepWorkTotal>();
    sim.sync_render_buffer();
    let row = row_of(&sim, user);
    assert_ne!(sim.render_buffer().visual_actions[row], visual_action::FETCH);
    assert_eq!(sim.render_buffer().chore_progress[row], 0);
}

#[test]
fn a_reach_without_a_recorded_length_resumes_halfway() {
    let mut sim = Sim::new_with_lot(48, 48);
    let (user, _) = fetching(
        &mut sim,
        Facing::NorthEast,
        (20.0, 19.0),
        "cook_dinner",
        14,
        10,
    );
    // A recorded length shorter than the remaining work is not a length.
    sim.sync_render_buffer();
    let row = row_of(&sim, user);
    assert_eq!(sim.render_buffer().chore_progress[row], 500);
    sim.world_mut().entity_mut(user).remove::<StepWorkTotal>();
    sim.sync_render_buffer();
    assert_eq!(sim.render_buffer().chore_progress[row], 500);
}

#[test]
fn all_fridge_facings_route_the_fetch_to_the_door_front_or_fall_back_beside_it() {
    use bevy_ecs::prelude::{Entity, Schedule, With};
    use terri_core::{ObjectFacing, Path, Reserved, SmartObject, TileGrid};
    let mut sim = Sim::new_from_shipped_lot();
    let pack = sim.world().resource::<Content>().0;
    let person = sim
        .world_mut()
        .query_filtered::<Entity, With<Agent>>()
        .iter(sim.world())
        .next()
        .unwrap();
    let fridge = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| pack.object(o.0).id == "fridge")
        .unwrap()
        .0;
    let recipe = chain(&sim, "prepare_snack");
    // Open fixture space checks every facing independently of house walls.
    sim.world_mut().insert_resource(TileGrid::new(20, 20));
    sim.world_mut()
        .entity_mut(fridge)
        .insert(Position { x: 10.0, y: 10.0 });
    let route = |sim: &mut Sim| {
        sim.world_mut()
            .entity_mut(person)
            .remove::<Path>()
            .remove::<Target>()
            .remove::<StepWork>()
            .remove::<crate::recipe_actions::Origin>()
            .insert((Position { x: 4.0, y: 4.0 }, ChainState::begin(recipe)));
        sim.world_mut().entity_mut(fridge).remove::<Reserved>();
        let mut schedule = Schedule::default();
        schedule.add_systems(crate::systems::chain::advance_chains);
        schedule.run(sim.world_mut());
        sim.world().get::<Path>(person).unwrap().steps.last().copied()
    };
    for (turn, front, _) in FRONTS {
        // FRONTS places the fridge at (20, 20); this one stands at (10, 10).
        let expected = (front.0 as i32 - 10, front.1 as i32 - 10);
        sim.world_mut()
            .entity_mut(fridge)
            .insert(ObjectFacing(turn));
        assert_eq!(route(&mut sim), Some(expected), "{turn:?}");
        // A blocked door front leaves the fridge usable from another side.
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(expected.0 as usize, expected.1 as usize, true);
        let beside = route(&mut sim).unwrap();
        assert_ne!(beside, expected);
        assert_eq!((beside.0 - 10).abs() + (beside.1 - 10).abs(), 1, "{turn:?}");
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(expected.0 as usize, expected.1 as usize, false);
    }
}

/// The shipped house's fridge stands in the kitchen corner, facing SW, with
/// walls on two sides: its door front is (0, 1).
fn shipped_snack() -> (Sim, bevy_ecs::entity::Entity, bevy_ecs::entity::Entity) {
    use bevy_ecs::prelude::{Entity, With};
    use terri_core::{ObjectFacing, SmartObject};
    let mut sim = Sim::new_from_shipped_lot();
    let pack = sim.world().resource::<Content>().0;
    let people: Vec<Entity> = sim
        .world_mut()
        .query_filtered::<Entity, With<Agent>>()
        .iter(sim.world())
        .collect();
    let fridge = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| pack.object(o.0).id == "fridge")
        .unwrap()
        .0;
    assert_eq!(
        *sim.world().get::<Position>(fridge).unwrap(),
        Position { x: 0.0, y: 0.0 }
    );
    assert_eq!(
        sim.world().get::<ObjectFacing>(fridge).map(|f| f.0),
        Some(Facing::SouthWest)
    );
    let person = people[1];
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::UseObject {
            agent: person.index_u32(),
            object: fridge.index_u32(),
            interaction: 0,
        });
    (sim, person, fridge)
}

/// Ticks until the fetch step ends, asserting on every tick of the step that
/// the remaining work falls by one, the body stands on the door front and
/// the reach is projected with rising progress. Returns the ticks the step ran.
fn finish_fetch(sim: &mut Sim, person: bevy_ecs::entity::Entity, fridge: bevy_ecs::entity::Entity) -> u32 {
    let mut previous: Option<(u32, u32)> = None;
    let mut ticks = 0;
    for _ in 0..400 {
        sim.sync_render_buffer();
        // The order becomes a chain on the first tick; stop once it moves on.
        let state = sim.world().get::<ChainState>(person).map(|c| c.step);
        if state.is_some_and(|step| step >= 1) {
            break;
        }
        if let Some(work) = sim.world().get::<StepWork>(person).map(|w| w.remaining_ticks) {
            let row = row_of(sim, person);
            let buffer = sim.render_buffer();
            assert_eq!(
                (buffer.visual_actions[row], buffer.interaction_targets[row]),
                (visual_action::FETCH, fridge.index_u32())
            );
            assert_eq!(*sim.world().get::<Position>(person).unwrap(), Position { x: 0.0, y: 1.0 });
            let progress = buffer.chore_progress[row];
            if let Some((last_work, last_progress)) = previous {
                assert_eq!(work + 1, last_work, "the step must count down every tick");
                assert!(progress >= last_progress);
            }
            previous = Some((work, progress));
            ticks += 1;
        }
        sim.tick();
    }
    assert_eq!(sim.world().get::<ChainState>(person).map(|c| c.step), Some(1));
    ticks
}

#[test]
fn the_shipped_fridge_reach_runs_and_finishes_from_its_door_front() {
    let (mut sim, person, fridge) = shipped_snack();
    let ticks = finish_fetch(&mut sim, person, fridge);
    // The arrival tick also counts the first tick of work, so a sampled
    // length of 12 to 28 ticks is drawn for 11 to 27 frames.
    assert!((11..=27).contains(&ticks), "{ticks}");
}

#[test]
fn shipped_fridge_reach_survives_loads_before_and_during_the_step() {
    for during in [false, true] {
        let (mut sim, person, fridge) = shipped_snack();
        for _ in 0..400 {
            let working = sim.world().get::<StepWork>(person).map(|w| w.remaining_ticks);
            if (!during && sim.world().get::<terri_core::Path>(person).is_some())
                || (during && working.is_some_and(|w| w < 8))
            {
                break;
            }
            sim.tick();
        }
        let save = sim.save_snapshot_v6();
        let mut loaded = Sim::new_from_shipped_lot();
        loaded.load_snapshot_v6(save).unwrap();
        if during {
            loaded.sync_render_buffer();
            let row = row_of(&loaded, person);
            assert_eq!(loaded.render_buffer().visual_actions[row], visual_action::FETCH);
            assert_eq!(loaded.render_buffer().chore_progress[row], 500);
        }
        let ticks = finish_fetch(&mut loaded, person, fridge);
        assert!((1..=28).contains(&ticks), "{during}: {ticks}");
    }
}
