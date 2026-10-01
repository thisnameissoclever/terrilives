use bevy_ecs::prelude::Entity;
use terri_core::{Agent, CommandQueue, Needs, Position, Selected, SimClock, SimCommand, SimRng};

use crate::Sim;

fn fixture() -> (Sim, [Entity; 2]) {
    let mut sim = Sim::new_with_lot(4, 4);
    let agents = [1.0, 2.0].map(|x| {
        sim.world_mut()
            .spawn((Agent, Position { x, y: 1.0 }, Needs::all_at(80.0)))
            .id()
    });
    (sim, agents)
}

fn select(sim: &mut Sim, agent: Option<Entity>) {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::Select(agent.map(Entity::index_u32)));
}

fn assert_selection_history(sim: &Sim, retained: usize) {
    let component = sim.world().component_id::<Selected>().unwrap();
    let messages = sim.world().removed_components().get(component);
    assert_eq!(messages.map_or(0, |messages| messages.len()), retained);
    assert_eq!(
        messages.map_or(0, |messages| messages
            .iter_current_update_messages()
            .count()),
        0,
        "the finished boundary must rotate its newest removals"
    );
}

#[test]
fn full_ticks_retain_only_the_latest_selection_removals() {
    let (mut sim, agents) = fixture();
    for boundary in 0..128 {
        let selected = agents[boundary % 2];
        select(&mut sim, Some(selected));
        sim.tick();
        assert_eq!(sim.selected_index(), Some(selected.index_u32()));
        assert_eq!(sim.world().resource::<SimClock>().tick, boundary as u64 + 1);
        assert_selection_history(&sim, usize::from(boundary > 0));
    }
}

#[test]
fn paused_drains_retire_removals_without_advancing_simulation() {
    let (mut sim, agents) = fixture();
    let rng = sim.world().resource::<SimRng>().clone();
    let needs = agents.map(|agent| *sim.world().get::<Needs>(agent).unwrap());
    for boundary in 0..128 {
        let selected = agents[boundary % 2];
        select(&mut sim, Some(selected));
        sim.flush_commands();
        assert_eq!(sim.selected_index(), Some(selected.index_u32()));
        assert_eq!(sim.world().resource::<SimClock>().tick, 0);
        assert_eq!(sim.world().resource::<SimRng>(), &rng);
        for (agent, expected) in agents.into_iter().zip(needs) {
            assert_eq!(sim.world().get::<Needs>(agent), Some(&expected));
        }
        assert_selection_history(&sim, usize::from(boundary > 0));
    }
    select(&mut sim, None);
    sim.flush_commands();
    assert_eq!(sim.selected_index(), None);
    assert_selection_history(&sim, 1);
    sim.flush_commands();
    assert_selection_history(&sim, 0);
}

#[test]
fn public_paused_drains_preserve_ordered_batches_and_subsequent_ticks() {
    let (mut split, split_agents) = fixture();
    let (mut batched, batched_agents) = fixture();
    for choice in [Some(0), None, Some(1)] {
        select(&mut split, choice.map(|index| split_agents[index]));
        split.flush_commands();
        select(&mut batched, choice.map(|index| batched_agents[index]));
    }
    batched.flush_commands();
    assert_eq!(split.selected_index(), Some(split_agents[1].index_u32()));
    assert_eq!(batched.selected_index(), split.selected_index());
    assert_eq!(split.save_snapshot_v5(), batched.save_snapshot_v5());
    for _ in 0..8 {
        split.tick();
        batched.tick();
        assert_eq!(split.save_snapshot_v5(), batched.save_snapshot_v5());
        assert_eq!(split.world_hash(), batched.world_hash());
    }
}
