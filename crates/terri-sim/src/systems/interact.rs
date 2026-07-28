use bevy_ecs::prelude::*;
use terri_core::{Eating, NeedId, Needs, Reserved, Target};

use crate::Content;

/// Advances in-progress interactions. When one finishes, the agent
/// releases its reservation and becomes idle again.
///
/// The refill covers **every** need the chosen interaction advertises,
/// spread evenly across its duration: an interaction advertising `delta`
/// over `duration_ticks` delivers `delta / duration_ticks` a tick. A need
/// the interaction does not name is left alone, which is not the same as
/// filling it by zero - the advert list is sparse.
pub fn tick_interactions(
    mut commands: Commands,
    content: Res<Content>,
    mut agents: Query<(Entity, &mut Eating, &mut Needs, &Target)>,
) {
    for (entity, mut eating, mut needs, target) in &mut agents {
        // Every index here is in range by construction. The object and
        // interaction ids were read out of this same pack when
        // `follow_path` began the interaction, content validation rejects
        // an advert naming a need rustc does not know, and it rejects a
        // zero duration, so the division below cannot be by zero.
        let act = &content.0.object(eating.object).interactions[eating.interaction as usize];
        let duration = act.duration_ticks as f32;
        for (need_index, delta) in &act.advertises {
            needs.fill(NeedId::ALL[*need_index as usize], delta / duration);
        }
        eating.remaining_ticks = eating.remaining_ticks.saturating_sub(1);

        if eating.remaining_ticks == 0 {
            commands
                .entity(entity)
                .remove::<Eating>()
                .remove::<Target>();
            // try_remove, not remove: `Commands::entity` deliberately
            // does not validate, so a `Target` pointing at an entity
            // that no longer exists routes the queued removal to the
            // command error handler. `try_remove` silences it instead,
            // which keeps the failure a no-op rather than something
            // whose severity depends on the configured handler.
            //
            // Nothing in M0 despawns entities, so this is unreachable
            // today. Reservation leaks that remain UNHANDLED, and must
            // be revisited when despawning or component removal arrives:
            //   - the agent is despawned mid-interaction, so this system
            //     never runs for it and `Reserved` is never removed;
            //   - the target loses its `SmartObject` mid-walk, so
            //     `follow_path` drops `Path` and `Target` without
            //     releasing the reservation;
            //   - `Needs` is removed from an eating agent, dropping it
            //     out of this query with `Eating` and `Target` intact.
            // Reclaiming those needs a dedicated system, which is a
            // later milestone, not a patch here.
            commands.entity(target.object).try_remove::<Reserved>();
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::test_content;
    use crate::Sim;
    use bevy_ecs::entity::Entity;
    use terri_core::{Agent, Eating, NeedId, Needs, Position, Reserved, SmartObject, Target};

    fn level_of(sim: &Sim, agent: Entity, need: NeedId) -> f32 {
        sim.world()
            .get::<Needs>(agent)
            .expect("the agent must still have Needs")
            .get(need)
    }

    /// Ticks until the agent is mid-interaction, or fails. Bounded, and
    /// the bound failing is a real failure rather than a silent skip.
    fn tick_until_eating(sim: &mut Sim, agent: Entity) {
        for _ in 0..400 {
            sim.tick();
            if sim.world().get::<Eating>(agent).is_some() {
                return;
            }
        }
        panic!("the agent must reach the object and begin interacting");
    }

    /// Ticks until the interaction has finished, or fails.
    ///
    /// Breaks on completion rather than counting ticks: counting exactly
    /// `duration_ticks` lands on the re-target tick, where `Eating` is
    /// re-inserted in the same tick because the path is empty.
    fn tick_until_done(sim: &mut Sim, agent: Entity) {
        for _ in 0..64 {
            sim.tick();
            if sim.world().get::<Eating>(agent).is_none() {
                return;
            }
        }
        panic!("the interaction must terminate");
    }

    #[test]
    fn hungry_sim_walks_to_the_fridge_and_eats() {
        // Event-driven, not tick-counted, on purpose. Ticking a fixed
        // number of times and then asserting `Eating` is none proves
        // nothing: it passes just as well if the meal never started, the
        // "test that can pass on empty input" pattern from
        // lessons-learned [L3]. It is also phase-dependent, because the
        // agent oscillates between hunger and satiety forever, so any
        // change to the decay rate, walk speed, meal duration, action
        // threshold or spawn geometry moves which tick lands in an idle
        // window.
        //
        // This one uses the SHIPPED fridge rather than a fixture, so it
        // is the end-to-end check that real content produces the
        // behaviour [D-6] requires: a hungry sim paths to the fridge and
        // eats.
        let mut sim = Sim::new_with_lot(16, 16);

        let fridge = sim
            .world_mut()
            .spawn((Position { x: 10.0, y: 8.0 }, test_content::shipped_fridge()))
            .id();

        let sim_entity = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 1.0 },
                Needs::with(NeedId::Hunger, 20.0),
            ))
            .id();

        tick_until_eating(&mut sim, sim_entity);
        assert!(
            sim.world().get::<Reserved>(fridge).is_some(),
            "fridge must be reserved during the meal"
        );

        let pos = sim.world().get::<Position>(sim_entity).unwrap();
        let dist = ((pos.x - 10.0).powi(2) + (pos.y - 8.0).powi(2)).sqrt();
        assert!(dist < 2.0, "sim should be at the fridge; distance {dist}");

        let before = level_of(&sim, sim_entity, NeedId::Hunger);

        tick_until_done(&mut sim, sim_entity);
        assert!(
            sim.world().get::<Target>(sim_entity).is_none(),
            "target must clear on completion"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_none(),
            "reservation must be released"
        );

        let after = level_of(&sim, sim_entity, NeedId::Hunger);
        assert!(
            after > before + 30.0,
            "the meal must deliver most of the advertised hunger delta; \
             {before} -> {after}"
        );
    }

    #[test]
    fn satisfied_sim_does_not_seek_food() {
        let mut sim = Sim::new_with_lot(16, 16);
        sim.world_mut()
            .spawn((Position { x: 10.0, y: 8.0 }, test_content::shipped_fridge()));
        let sim_entity = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 1.0 },
                Needs::with(NeedId::Hunger, 100.0),
            ))
            .id();

        for _ in 0..5 {
            sim.tick();
        }

        assert!(
            sim.world().get::<Target>(sim_entity).is_none(),
            "a full sim should not target the fridge"
        );
    }

    #[test]
    fn an_interaction_fills_every_need_it_advertises_and_nothing_else() {
        // The whole point of [D-1]: an advert is a variable-length sparse
        // list of (need, delta) pairs, so the refill loop has to walk all
        // of them. Nothing else in the suite can see this, because every
        // other fixture and the shipped fridge advertise exactly one
        // need - `hungry_sim_walks_to_the_fridge_and_eats` would stay
        // green with the loop replaced by a single hunger fill.
        //
        // Both halves are asserted. Energy must RISE, which fails if the
        // loop stops after the first pair; comfort must NOT rise, which
        // fails if the refill sprays every need instead of the
        // advertised ones. Comfort starts below the ceiling so that a
        // stray fill has somewhere to go and cannot be hidden by
        // clamping - asserted as a precondition rather than assumed.
        const HUNGER_DELTA: f32 = 30.0;
        const ENERGY_DELTA: f32 = 20.0;
        const DURATION: u32 = 10;
        const COMFORT_START: f32 = 50.0;

        let content = test_content::pack(vec![test_content::object(
            "buffet",
            &[
                (NeedId::Hunger, HUNGER_DELTA),
                (NeedId::Energy, ENERGY_DELTA),
            ],
            DURATION,
        )]);
        let mut sim = test_content::sim_with(16, 16, content);
        sim.world_mut().spawn((
            Position { x: 10.0, y: 8.0 },
            SmartObject(content.find("buffet").expect("the fixture declares it")),
        ));

        let mut needs = Needs::all_at(terri_core::NEED_MAX);
        needs.set(NeedId::Hunger, 20.0);
        needs.set(NeedId::Energy, 20.0);
        needs.set(NeedId::Comfort, COMFORT_START);
        let agent = sim
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, needs))
            .id();

        tick_until_eating(&mut sim, agent);
        let hunger_before = level_of(&sim, agent, NeedId::Hunger);
        let energy_before = level_of(&sim, agent, NeedId::Energy);
        let comfort_before = level_of(&sim, agent, NeedId::Comfort);
        assert!(
            comfort_before < terri_core::NEED_MAX,
            "comfort must start below the ceiling, or a stray fill would \
             be clamped away and this test could not see it; got {comfort_before}"
        );

        tick_until_done(&mut sim, agent);

        let hunger_after = level_of(&sim, agent, NeedId::Hunger);
        let energy_after = level_of(&sim, agent, NeedId::Energy);
        let comfort_after = level_of(&sim, agent, NeedId::Comfort);
        assert!(
            hunger_after > hunger_before + 20.0,
            "the first advertised need must be filled; {hunger_before} -> {hunger_after}"
        );
        assert!(
            energy_after > energy_before + 15.0,
            "the SECOND advertised need must be filled too; a refill loop \
             that stops after one pair leaves this one where it started. \
             {energy_before} -> {energy_after}"
        );
        assert!(
            comfort_after <= comfort_before,
            "a need this interaction does not advertise must not be \
             filled; the advert list is sparse, and absent is not the \
             same as zero. {comfort_before} -> {comfort_after}"
        );
    }

    #[test]
    fn the_interaction_recorded_at_selection_is_the_one_that_fills() {
        // `select_action` scores every interaction an object offers and
        // records which one won; `follow_path` and this system resolve
        // that index rather than defaulting to the first. With the index
        // ignored the agent would nibble instead of feasting: 0.5 hunger
        // over 5 ticks, barely more than the 0.52 it loses to decay in
        // the same window, so the meal would leave it where it started.
        //
        // The two interactions have DIFFERENT durations, and that is
        // load-bearing rather than colour. `follow_path` resolves the
        // chosen interaction for one thing only - its duration - so with
        // equal durations, `follow_path` looking up the wrong interaction
        // is unobservable and this test cannot see it. Measured: with
        // both at 15 ticks, replacing `interactions[target.interaction]`
        // with `interactions[0]` in `follow_path` left the whole
        // workspace green. The `remaining_ticks` assertion below is what
        // closes that.
        const NIBBLE_DELTA: f32 = 0.5;
        const NIBBLE_DURATION: u32 = 5;
        const FEAST_DELTA: f32 = 40.0;
        const FEAST_DURATION: u32 = 15;

        let content = test_content::pack(vec![test_content::object_offering(
            "cupboard",
            vec![
                test_content::interaction(
                    "nibble",
                    &[(NeedId::Hunger, NIBBLE_DELTA)],
                    NIBBLE_DURATION,
                ),
                test_content::interaction(
                    "feast",
                    &[(NeedId::Hunger, FEAST_DELTA)],
                    FEAST_DURATION,
                ),
            ],
        )]);
        let cupboard = content.find("cupboard").expect("the fixture declares it");
        let mut sim = test_content::sim_with(16, 16, content);
        sim.world_mut()
            .spawn((Position { x: 10.0, y: 8.0 }, SmartObject(cupboard)));
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 1.0 },
                Needs::with(NeedId::Hunger, 20.0),
            ))
            .id();

        tick_until_eating(&mut sim, agent);
        let eating = *sim
            .world()
            .get::<Eating>(agent)
            .expect("tick_until_eating already checked this");
        // `tick_interactions` runs after `follow_path` in the same tick,
        // so one tick of the meal is already spent when this is read.
        assert_eq!(
            eating,
            Eating {
                object: cupboard,
                interaction: 1,
                remaining_ticks: FEAST_DURATION - 1,
            },
            "the interaction that won selection must be the one performed, \
             and for ITS duration; a remaining_ticks near {NIBBLE_DURATION} \
             means follow_path resolved the wrong interaction"
        );

        let before = level_of(&sim, agent, NeedId::Hunger);
        tick_until_done(&mut sim, agent);
        let after = level_of(&sim, agent, NeedId::Hunger);
        assert!(
            after > before + 30.0,
            "the meal must deliver the SECOND interaction's delta; a gain \
             near zero means the first one was performed instead. \
             {before} -> {after}"
        );
    }
}
