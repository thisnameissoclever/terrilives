use bevy_ecs::prelude::*;
use terri_core::{Eating, Habituation, IntentQueue, NeedId, Needs, Reserved, SimRng, Target};

use crate::Content;

/// How many ticks an interaction actually takes, sampled around the
/// `duration_ticks` its content declares - [D-4].
///
/// The content number is a **centre**, not a fixed value. Two sims
/// grabbing the same snack should not take the same number of ticks to
/// the tick, because that is one of the few things that reads
/// unmistakably as a machine rather than a person.
///
/// # The three properties, and which is which
///
/// **`centre` is still the centre.** With `variance` at zero the factor
/// below is exactly `1.0` in `f32` - `1.0 - 0.0 + 2.0 * 0.0 * anything` -
/// so the result is the content value itself, unrounded and unshifted.
/// That is what `with_variance_at_zero_a_meal_takes_exactly_its_content_duration`
/// pins, and it is the property that separates "sampled around the
/// content number" from "the content number is ignored".
///
/// **The sample is biased SHORTER.** The draw is squared before it is
/// spread across the band, which pushes its mass toward the low end:
/// `roll * roll` is below a half for about 71% of draws rather than 50%,
/// so the mean factor is `1 - variance / 3` rather than `1`. Longer than
/// the centre is still reachable, at the top of the band - a bias, not a
/// cap. Being able to run long matters as much as the bias does: a rule
/// that only ever shortens would make the content number a maximum, and
/// a designer authoring 60 would never see 60.
///
/// **The floor is a REAL-TIME floor.** `min_interaction_ticks` is stated
/// in ticks because that is what the simulation counts, but the reason it
/// exists is wall-clock: at 1x speed the sim runs `TICK_HZ` = 10 ticks a
/// second, so the shipped 12 is 1.2 seconds. Anything shorter reads as a
/// sim teleporting through an action however sensible the tick count
/// looks.
///
/// **A floor that binds is a duration, not a floor**, and the alpha feel
/// pass measured this one binding on 61% of interactions at its original
/// 25. An interaction whose whole sampled band sits under the floor has a
/// FIXED length, so [D-4] is inert for it, and it also delivers
/// `floor / duration_ticks` times what its content advertises, because
/// the refill below divides by the content duration.
///
/// **That is now impossible to author.** `ClippedDuration` in terri-data
/// fails the build for any interaction whose band bottoms out below the
/// floor - the condition is
/// `duration_ticks * (1 - duration_variance) >= min_interaction_ticks` -
/// so the floor here is a genuine safety net rather than a balance lever.
/// No shipped interaction is within reach of it, which
/// `no_shipped_interaction_is_clipped_by_the_interaction_floor` asserts.
///
/// # One draw, always
///
/// The draw is taken before anything is decided with it, including when
/// `variance` is zero and its value cannot matter. That keeps PRNG
/// consumption a function of what the simulation DOES rather than of how
/// the knobs happen to be set: turning variance down to zero to debug
/// something would otherwise shift every subsequent draw in the run and
/// change behaviour that has nothing to do with durations.
///
/// `variance` is in `[0, 1)` and `floor` is at least 1 by content
/// validation, so neither is re-checked here.
pub fn sample_duration(centre: u32, variance: f32, floor: u32, rng: &mut SimRng) -> u32 {
    let roll = rng.next_f32();
    let biased = roll * roll;
    let factor = 1.0 - variance + 2.0 * variance * biased;
    let ticks = (centre as f32 * factor).round() as u32;
    ticks.max(floor)
}

/// Advances in-progress interactions. When one finishes, the agent
/// releases its reservation and becomes idle again.
///
/// The refill covers **every** need the chosen interaction advertises,
/// spread evenly across its duration: an interaction advertising `delta`
/// over `duration_ticks` delivers `delta / duration_ticks` a tick. A need
/// the interaction does not name is left alone, which is not the same as
/// filling it by zero - the advert list is sparse.
///
/// **The divisor is the CONTENT duration, not the sampled one**, and that
/// is a decision rather than an oversight now that [D-4] makes the two
/// differ. Content declares a rate: `delta` per `duration_ticks`. A meal
/// that runs short delivers less and one that runs long delivers more,
/// which keeps benefit-per-tick exactly the quantity `score_advertisement`
/// weighed when the interaction was chosen. Dividing by the sampled
/// duration instead would hold the total constant and make a short meal a
/// strictly better deal than the one that was scored.
///
/// The visible consequence used to be the shipped fridge, whose 15-tick
/// snack a 25-tick floor stretched to a flat 25, so it delivered about 67
/// hunger rather than 40. That took two passes to actually fix. The feel
/// pass lowered the floor from 25 to 12, which brought the fridge out from
/// under it but left the sink wholly beneath and the fridge and toilet
/// clipped at the bottom of their bands. The alpha pass then raised the
/// three content durations above the line and made being under it a build
/// error.
///
/// Measured after both, over 12 000 ticks of the shipped lot: the fridge
/// declares 30, samples 18 to 40, and averages 25.0 - below its centre
/// because the draw is biased shorter, which is [D-4] working rather than
/// the floor binding. Nothing is pinned to a single length any more. Rerun
/// it with `cargo run -p terri-sim --example trace`.
/// The type_complexity allow is for the same reason it sits on `select_action`
/// and `drain_commands`: the query tuple is what pushes past clippy's threshold,
/// and a type alias would only move the same type somewhere less readable. It
/// grew a sixth member when habituation arrived.
#[allow(clippy::type_complexity)]
pub fn tick_interactions(
    mut commands: Commands,
    content: Res<Content>,
    mut agents: Query<(
        Entity,
        &mut Eating,
        &mut Needs,
        &Target,
        Option<&mut IntentQueue>,
        Option<&mut Habituation>,
    )>,
) {
    for (entity, mut eating, mut needs, target, queue, habituation) in &mut agents {
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
            // **Habituation rises on COMPLETION, not per tick** - [S2]. The sim
            // is tired of the activity, not of the minutes, so a 180-tick sleep
            // and a 21-tick hand-wash habituate by the same amount. Per-tick
            // would make long interactions punish themselves and turn the
            // mechanic into a second duration penalty, which scoring already
            // has.
            //
            // It is raised for the interaction that just FINISHED, so an
            // interrupted one costs nothing - which is the same "only the
            // completed thing counts" rule the intent queue uses two lines
            // below, and the rule multi-step interactions will need.
            //
            // `Option<&mut Habituation>` because an agent gains the component
            // the first time it finishes anything. A fresh sim carries none,
            // and `Habituation::get` reads absent as zero, so nothing has to
            // special-case it - but the component has to be INSERTED here for
            // the first entry to exist at all.
            let amount = content.0.tuning.habituation_per_use;
            match habituation {
                Some(mut habituation) => {
                    habituation.bump(eating.object, eating.interaction, amount)
                }
                None => {
                    let mut fresh = Habituation::default();
                    fresh.bump(eating.object, eating.interaction, amount);
                    commands.entity(entity).insert(fresh);
                }
            }

            // **A player-issued intent lives until the interaction it
            // named finishes** - [D-3]'s "until it completes or is
            // cancelled" - so completing it is what pops it. Without
            // this the sim would re-serve the same intent for ever and a
            // single click would become a loop the player can only
            // escape with a cancel.
            //
            // Guarded on the front intent MATCHING what just finished,
            // rather than popping unconditionally, because an agent can
            // finish an autonomously chosen interaction with an intent it
            // has never started sitting at the front of its queue. The
            // reachable case: the click named an object another agent had
            // reserved, so `serve_intents` left the sim to finish its
            // meal and kept the intent for when the object frees up.
            // Popping there would discard an instruction that was never
            // carried out.
            if let Some(mut queue) = queue {
                if queue.front().is_some_and(|intent| {
                    intent.object == target.object && intent.interaction == target.interaction
                }) {
                    queue.pop();
                }
            }
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
    use super::sample_duration;
    use crate::test_content;
    use crate::Sim;
    use bevy_ecs::entity::Entity;
    use std::collections::BTreeSet;
    use terri_core::{
        Agent, Eating, NeedId, Needs, Position, Reserved, SimRng, SmartObject, Target, TICK_HZ,
    };
    use terri_data::{ContentPack, Tuning};

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
    ///
    /// The bound is generous rather than tight because [D-4] made the
    /// real length of an interaction a sampled value; a bound just above
    /// the longest fixture would start failing on an unlucky draw. It is
    /// a runaway detector, not an assertion about duration - the
    /// duration tests below measure that directly.
    fn tick_until_done(sim: &mut Sim, agent: Entity) {
        for _ in 0..1024 {
            sim.tick();
            if sim.world().get::<Eating>(agent).is_none() {
                return;
            }
        }
        panic!("the interaction must terminate");
    }

    /// The number of ticks the agent's next interaction lasts, measured
    /// through the running simulation rather than by calling the sampler.
    ///
    /// `tick_interactions` runs after `follow_path` in the same tick, so
    /// the first `remaining_ticks` an observer can ever see is already
    /// one short of the sampled total - hence the `+ 1`. The existing
    /// `the_interaction_recorded_at_selection_is_the_one_that_fills`
    /// asserts the same offset explicitly.
    ///
    /// The need reset is what makes repeated observation possible: a
    /// satisfied agent has nothing worth doing and would never start a
    /// second interaction. It is done through the world rather than by
    /// waiting for decay so the fixture does not depend on how long an
    /// interaction happens to run, which is the very thing under test.
    ///
    /// `need` is a parameter rather than always hunger because the object
    /// whose whole sampled band sits under the real-time floor is not the
    /// fridge any more; see
    /// `an_interaction_shorter_than_the_real_time_floor_is_stretched_up_to_it`.
    fn observe_one_interaction_of(sim: &mut Sim, agent: Entity, need: NeedId) -> u32 {
        sim.world_mut()
            .get_mut::<Needs>(agent)
            .expect("the agent must still have Needs")
            .set(need, 5.0);
        tick_until_eating(sim, agent);
        let remaining = sim
            .world()
            .get::<Eating>(agent)
            .expect("tick_until_eating already checked this")
            .remaining_ticks;
        tick_until_done(sim, agent);
        remaining + 1
    }

    fn observe_one_interaction(sim: &mut Sim, agent: Entity) -> u32 {
        observe_one_interaction_of(sim, agent, NeedId::Hunger)
    }

    /// `count` consecutive interaction lengths at the same object.
    fn observe_interactions(sim: &mut Sim, agent: Entity, count: usize) -> Vec<u32> {
        (0..count)
            .map(|_| observe_one_interaction(sim, agent))
            .collect()
    }

    /// `count` consecutive interaction lengths, driven by `need`.
    fn observe_interactions_of(
        sim: &mut Sim,
        agent: Entity,
        need: NeedId,
        count: usize,
    ) -> Vec<u32> {
        (0..count)
            .map(|_| observe_one_interaction_of(sim, agent, need))
            .collect()
    }

    /// A 16x16 sim holding one object next to one agent, both from
    /// `content`, ready for [`observe_interactions`].
    ///
    /// The agent is spawned one tile from the object so the walk is a
    /// single step: these tests are about how long an interaction lasts,
    /// and a long commute would only add ticks to wait through.
    fn eating_scenario(content: &'static ContentPack, object_id: &str) -> (Sim, Entity) {
        let mut sim = test_content::sim_with(16, 16, content);
        sim.world_mut().spawn((
            Position { x: 10.0, y: 8.0 },
            SmartObject(
                content
                    .find(object_id)
                    .unwrap_or_else(|| panic!("the fixture must declare '{object_id}'")),
            ),
        ));
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 9.0, y: 8.0 },
                Needs::with(NeedId::Hunger, 5.0),
            ))
            .id();
        (sim, agent)
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
        // How many fills are still to come. Taken here rather than
        // assumed, because [D-4] made the real length of a meal a
        // sampled value: `tick_interactions` has already run once by the
        // time `before` is readable, so the remaining count is what the
        // rest of this meal will deliver.
        let fills_left = sim
            .world()
            .get::<Eating>(sim_entity)
            .expect("tick_until_eating already checked this")
            .remaining_ticks;

        tick_until_done(&mut sim, sim_entity);
        assert!(
            sim.world().get::<Target>(sim_entity).is_none(),
            "target must clear on completion"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_none(),
            "reservation must be released"
        );

        // The rise is DERIVED, not a threshold picked to be comfortably
        // true. `tick_interactions` fills `delta / duration_ticks` a tick
        // and `decay_needs` drains `decay_per_tick` on the same tick, so
        // the net is exact arithmetic over `fills_left` ticks.
        //
        // A threshold is what this used to be, and the alpha feel pass is
        // what showed that up: `after > before + 30.0` was chosen while a
        // 25-tick floor stretched the fridge's 15-tick snack, so the meal
        // over-delivered by a factor of 5/3 and the bound had 30 points
        // of slack it was never going to use. Lowering the floor to 12
        // put the real delivery at 28.2 and the test went red for a
        // change in tuning rather than in behaviour. Derived, it moves
        // with the tuning and still fails if the refill stops happening.
        let snack = &terri_data::pack()
            .object(test_content::shipped_fridge().0)
            .interactions[0];
        let delta = snack
            .advertises
            .iter()
            .find(|(need, _)| usize::from(*need) == NeedId::Hunger.index())
            .map(|(_, delta)| *delta)
            .expect("the shipped snack advertises hunger");
        let per_tick =
            delta / snack.duration_ticks as f32 - test_content::decay_per_tick(NeedId::Hunger);
        let expected = fills_left as f32 * per_tick;
        assert!(
            expected > 0.0,
            "the fixture must gain ground on hunger, or 'the meal fills \
             it' is not what this test would be showing; {expected}"
        );

        let after = level_of(&sim, sim_entity, NeedId::Hunger);
        assert!(
            (after - before - expected).abs() < 0.05,
            "the meal delivered {} over {fills_left} ticks, but its \
             advertised rate of {delta} per {} ticks minus decay predicts \
             {expected}; {before} -> {after}",
            after - before,
            snack.duration_ticks
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
        //
        // **[D-4] put that mechanism under two new threats and the
        // fixture answers both.** The real duration is now sampled
        // around the content value and clamped up to
        // `min_interaction_ticks`, so:
        //
        //   - the two durations must both CLEAR the floor, or the clamp
        //     flattens them into one number and the test stops being able
        //     to tell the interactions apart. That is not hypothetical:
        //     at the original 5 and 15 against a floor of 25, both became
        //     25. It is asserted below rather than left to a reader to
        //     notice.
        //   - the variance is turned to zero for this fixture, so the
        //     exact `remaining_ticks` assertion is a statement about
        //     WHICH interaction was resolved rather than about a draw.
        //     Same move as `DECISIVE_TEMPERATURE` in action.rs: hold the
        //     knob that is not under test still.
        const NIBBLE_DELTA: f32 = 0.5;
        const NIBBLE_DURATION: u32 = 30;
        const FEAST_DELTA: f32 = 60.0;
        const FEAST_DURATION: u32 = 100;

        // The shorter of the two is the one that has to clear the floor;
        // clippy will not let both be stated, since the constants are
        // ordered here in the source.
        let floor = test_content::tuning().min_interaction_ticks;
        assert!(
            NIBBLE_DURATION.min(FEAST_DURATION) > floor,
            "both durations must clear the {floor} tick floor, or the \
             clamp collapses them to the same number and this test can no \
             longer tell one interaction from the other"
        );

        let content = test_content::pack_tuned(
            vec![test_content::object_offering(
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
            )],
            Tuning {
                duration_variance: 0.0,
                ..test_content::tuning()
            },
        );
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

    // ---------------------------------------------------------------
    // [D-4] Varied interaction duration.
    //
    // Four claims, and each is written where it can see the mutation it
    // exists for. Three run through the whole simulation, because
    // `sample_duration` being right is worth nothing if `follow_path`
    // does not call it: replacing the call with `act.duration_ticks`
    // leaves every unit test on the sampler green.
    // ---------------------------------------------------------------

    /// The centre used by the fixtures below that must clear the
    /// real-time floor, so the floor cannot be what produces their
    /// answer. Comfortably above the shipped 25, and not a round
    /// multiple of it.
    const LONG_DURATION: u32 = 96;

    /// An object whose single interaction takes [`LONG_DURATION`] ticks
    /// and restores enough hunger to be worth walking one tile for.
    fn long_interaction_object() -> terri_data::CompiledObject {
        test_content::object("banquet", &[(NeedId::Hunger, 40.0)], LONG_DURATION)
    }

    fn floor() -> u32 {
        test_content::tuning().min_interaction_ticks
    }

    #[test]
    fn repeated_interactions_at_one_object_do_not_all_take_the_same_time() {
        // The milestone's visible claim, and the one that pins the
        // WIRING: with `follow_path` still writing `act.duration_ticks`
        // straight into `Eating`, every one of these is identical and
        // this fails. Nothing else here can see that.
        //
        // Same object, same agent, same content duration, six meals. The
        // agent is re-hungered between them rather than left to decay,
        // so the only thing that differs between the six is the draw.
        const MEALS: usize = 6;

        let content = test_content::pack(vec![long_interaction_object()]);
        let (mut sim, agent) = eating_scenario(content, "banquet");
        let durations = observe_interactions(&mut sim, agent, MEALS);

        // Rule 5: an empty list satisfies "not all the same" vacuously.
        assert_eq!(
            durations.len(),
            MEALS,
            "every meal must actually have been observed"
        );
        assert!(
            test_content::tuning().duration_variance > 0.0,
            "the shipped variance must be non-zero, or this test is \
             asking the simulation for something it was told not to do"
        );
        let distinct: BTreeSet<u32> = durations.iter().copied().collect();
        assert!(
            distinct.len() > 1,
            "six meals at one object all took the same number of ticks, \
             so the content duration is being used as a fixed value \
             rather than as a centre: {durations:?}"
        );
    }

    #[test]
    fn a_sampled_duration_is_biased_shorter_than_its_centre_without_being_capped_at_it() {
        // BOTH halves are the claim. Biased shorter distinguishes this
        // from a symmetric jitter; still reaching past the centre
        // distinguishes it from a rule that only ever shortens, which
        // would quietly turn every authored duration into a maximum.
        //
        // A unit test rather than a simulation one because it is
        // statistical: the shape of the distribution is what is being
        // asserted, and a thousand draws through the ECS would be a
        // thousand meals.
        //
        // Mutations this sees, measured rather than asserted from
        // reading: `roll * roll` -> `roll + roll` puts the mean ABOVE
        // the centre; `roll * roll` -> `roll - roll` collapses the
        // sample to a constant and fails the spread assertions;
        // `1.0 - variance` -> `1.0 + variance` puts the whole band above
        // the centre. The floor is set to 1 so that it cannot be what
        // shapes any of this.
        const CENTRE: u32 = 1_000;
        const VARIANCE: f32 = 0.4;
        const SAMPLES: usize = 4_000;

        let mut rng = SimRng::from_seed(4_242);
        let samples: Vec<u32> = (0..SAMPLES)
            .map(|_| sample_duration(CENTRE, VARIANCE, 1, &mut rng))
            .collect();

        let mean = samples.iter().map(|t| *t as f64).sum::<f64>() / SAMPLES as f64;
        let low = *samples.iter().min().expect("SAMPLES is non-zero");
        let high = *samples.iter().max().expect("SAMPLES is non-zero");

        // The band. `1 - v` and `1 + v` either side of the centre, and
        // nothing outside it, which is what "within duration_variance
        // either side" means.
        assert!(
            low as f32 >= CENTRE as f32 * (1.0 - VARIANCE),
            "a sample fell below the band: {low}"
        );
        assert!(
            high as f32 <= CENTRE as f32 * (1.0 + VARIANCE),
            "a sample rose above the band: {high}"
        );

        // The bias. Squaring the draw puts the mean at
        // `centre * (1 - variance / 3)`, which is 866.7 here; a
        // symmetric spread would sit at 1000. The window is wide enough
        // that sampling noise cannot reach either edge - the standard
        // error at 4000 samples is about 3 ticks - and narrow enough
        // that neither the symmetric nor the doubled-draw alternative
        // lands in it.
        let expected = CENTRE as f64 * (1.0 - VARIANCE as f64 / 3.0);
        assert!(
            (mean - expected).abs() < 20.0,
            "the mean must sit near centre * (1 - variance / 3) = \
             {expected:.1}; got {mean:.1}. A mean near {CENTRE} means the \
             draw is not biased at all"
        );

        // Not a cap. Longer than the centre has to remain reachable, or
        // an authored duration is really a maximum.
        assert!(
            samples.iter().any(|t| *t > CENTRE),
            "no sample ran longer than the centre, so this is a cap \
             rather than a bias; the longest was {high}"
        );
        assert!(
            samples.iter().any(|t| *t < CENTRE),
            "no sample ran shorter than the centre; the shortest was {low}"
        );
    }

    #[test]
    fn an_interaction_shorter_than_the_real_time_floor_is_stretched_up_to_it() {
        // The floor is a REAL-TIME floor. `min_interaction_ticks` is
        // counted in ticks because that is the unit the simulation has,
        // but the reason for the number is wall-clock: at 1x the sim
        // runs TICK_HZ = 10 ticks a second, so the shipped 12 is 1.2
        // seconds, and anything below that reads as a sim teleporting
        // through an action. Asserting a bare `>= 12` would keep the
        // number and lose the reason, so the seconds are computed and
        // named here.
        //
        // **This used to use a shipped object and deliberately cannot any
        // more.** It was the sink, chosen because the sink's whole band sat
        // under the floor: at 8 declared ticks its widest draw was 11.2
        // against a floor of 12, so the clamp decided every one of its
        // interactions. That was a bug in shipped content, recorded as [C1],
        // and this test was quietly relying on it.
        //
        // The alpha balance pass fixed it and then made it unrepresentable:
        // `ClippedDuration` in terri-data now fails the BUILD for any
        // interaction whose band bottoms out below the floor, and
        // `no_shipped_interaction_is_clipped_by_the_interaction_floor` asserts
        // shipped content stays clear of the line. So there is no longer a
        // shipped object this test could use, and if one ever appears the
        // build breaks before this test runs.
        //
        // The clamp is still a real mechanism and still worth pinning, so the
        // fixture is now an invented object that the compiler would reject as
        // content - which fixtures may be, because `test_content` builds a
        // `CompiledObject` directly rather than going through `compile()`.
        // The trade is explicit: this is a statement about the CLAMP rather
        // than about the game, and the statement about the game is the
        // terri-data test named above.
        //
        // Equality rather than `>=`, and the precondition below is what
        // earns it: the widest draw the variance allows is still under
        // the floor, so the clamp decides EVERY interaction here and a
        // `>=` would also be satisfied by an unclamped shorter draw.
        const NEED: NeedId = NeedId::Hygiene;
        // The largest centre whose whole band still sits under the floor.
        //
        // At the shipped floor of 12 and variance of 0.4 the expression below
        // yields 7, whose band is 4.2 to 9.8 - entirely underneath. It is
        // derived from the tuning rather than written as a literal so that a
        // floor change cannot leave this fixture accidentally above the line
        // with the test still asserting equality.
        //
        // An earlier version of this comment said "6 ticks... band 3.6 to 8.4",
        // which is a different fixture from the one the code builds. A review
        // caught it. That is the shape [L40] warns about: a worked example in a
        // comment is not a measurement, and this one was never run.
        let tuning = test_content::tuning();
        let centre = ((tuning.min_interaction_ticks as f32 / (1.0 + tuning.duration_variance))
            .floor() as u32)
            .saturating_sub(1)
            .max(1);
        let content = test_content::pack(vec![test_content::object(
            "quick_rinse",
            &[(NEED, 30.0)],
            centre,
        )]);
        let mut sim = test_content::sim_with(16, 16, content);
        let object = SmartObject(
            content
                .find("quick_rinse")
                .expect("the fixture declares it"),
        );
        sim.world_mut()
            .spawn((Position { x: 10.0, y: 8.0 }, object));
        let agent = sim
            .world_mut()
            .spawn((Agent, Position { x: 9.0, y: 8.0 }, Needs::with(NEED, 5.0)))
            .id();

        let longest_unclamped = centre as f32 * (1.0 + tuning.duration_variance);
        assert!(
            longest_unclamped < floor() as f32,
            "the fixture's longest possible draw is {longest_unclamped} \
             ticks, which is not below the {} tick floor, so the clamp is \
             not what decides this test",
            floor()
        );

        let durations = observe_interactions_of(&mut sim, agent, NEED, 4);
        assert_eq!(durations.len(), 4, "every interaction must be observed");

        let floor_seconds = floor() as f64 / TICK_HZ;
        for ticks in &durations {
            assert_eq!(
                *ticks,
                floor(),
                "a {centre} tick interaction - {:.1} real seconds at 1x - \
                 came out at {ticks} ticks. The floor exists so that no \
                 action is over in less than {} ticks, which is \
                 {floor_seconds:.1} real seconds at {TICK_HZ} ticks a \
                 second; below that a sim teleports through the action \
                 instead of being seen to do it",
                centre as f64 / TICK_HZ,
                floor()
            );
        }
    }

    #[test]
    fn with_variance_at_zero_an_interaction_takes_exactly_its_content_duration() {
        // The one people skip, and the one that proves the content
        // number is still the CENTRE rather than an input the sampler
        // ignores. Every other duration test here is satisfied by a
        // sampler that invents a length out of the floor and the
        // variance alone.
        //
        // Three meals rather than one, because a single observation
        // cannot tell "exactly the centre" from "happened to draw the
        // centre this time".
        //
        // The centre is deliberately well above the floor, and that is
        // asserted rather than eyeballed: with a centre below the floor
        // the clamp would produce a constant and this test would pass
        // while proving nothing about the centre at all.
        let content = test_content::pack_tuned(
            vec![long_interaction_object()],
            Tuning {
                duration_variance: 0.0,
                ..test_content::tuning()
            },
        );
        assert!(
            LONG_DURATION > floor(),
            "the fixture's centre ({LONG_DURATION}) must clear the floor \
             ({}), or the clamp rather than the centre decides the answer",
            floor()
        );

        let (mut sim, agent) = eating_scenario(content, "banquet");
        let durations = observe_interactions(&mut sim, agent, 3);

        assert_eq!(
            durations,
            vec![LONG_DURATION; 3],
            "with duration_variance at zero every interaction must last \
             exactly the number of ticks its content declares; anything \
             else means the content value is not the centre it is \
             documented to be"
        );
    }

    // ---- The pop guard -------------------------------------------------

    /// A world with a fridge and a bed, and an agent one tick from
    /// finishing an interaction at `finishing`, holding a queued intent
    /// for `queued` that it has never started.
    ///
    /// Built by hand rather than reached through autonomy, deliberately.
    /// The state IS reachable - `serve_intents` leaves an intent queued
    /// when the object it names is reserved by somebody else, so a sim
    /// finishes the meal it chose for itself with a click still waiting -
    /// but reaching it through the schedule would put decay, selection
    /// and a second agent's reservation inside a test about one `if`.
    /// Rule 4 asks a guard's fixture to hold everything else constant.
    ///
    /// Returns the sim, the agent, and the two object entities.
    fn agent_finishing_with_a_queued_intent(
        same_object: bool,
    ) -> (Sim, Entity, terri_core::IntentQueue) {
        use bevy_ecs::schedule::Schedule;
        use terri_core::{Intent, IntentQueue};

        // Two objects, and the interaction index is 0 on BOTH, which is
        // the whole point of the fixture: the two fields disagree on the
        // object and agree on the index, so a guard that read only the
        // index would see a match where there is none.
        //
        // Both are single-interaction objects, so 0 is the only index
        // either of them has. That used to be the ONLY way to reach this
        // input domain, because `UseObject` hardcoded interaction 0; it now
        // carries a chosen index, so the agreement here is a property of
        // the fixture rather than of the command. The domain is the same
        // one either way and the mutant it corners is unchanged.
        let content = test_content::pack(vec![
            test_content::object("fridge", &[(NeedId::Hunger, 40.0)], 15),
            test_content::object("bed", &[(NeedId::Energy, 40.0)], 15),
        ]);
        let mut sim = test_content::sim_with(16, 16, content);
        let fridge_def = content
            .find("fridge")
            .expect("the fixture declares a fridge");
        let fridge = sim
            .world_mut()
            .spawn((Position { x: 10.0, y: 8.0 }, SmartObject(fridge_def)))
            .id();
        let bed = sim
            .world_mut()
            .spawn((
                Position { x: 2.0, y: 8.0 },
                SmartObject(content.find("bed").expect("the fixture declares a bed")),
            ))
            .id();

        let queued = if same_object { fridge } else { bed };
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 10.0, y: 8.0 },
                Needs::with(NeedId::Hunger, 5.0),
                Target {
                    object: fridge,
                    interaction: 0,
                },
                Eating {
                    object: fridge_def,
                    interaction: 0,
                    remaining_ticks: 1,
                },
                IntentQueue::from_intents(vec![Intent {
                    object: queued,
                    interaction: 0,
                }]),
            ))
            .id();

        // Only `tick_interactions`, so what is asserted afterwards is
        // what the guard did rather than what `serve_intents` did in
        // response to it on the same tick.
        let mut schedule = Schedule::default();
        schedule.add_systems(super::tick_interactions);
        schedule.run(sim.world_mut());

        let queue = sim
            .world()
            .get::<IntentQueue>(agent)
            .expect("the agent was spawned with a queue")
            .clone();
        (sim, agent, queue)
    }

    #[test]
    fn a_finished_interaction_pops_only_the_intent_that_named_the_object_it_finished() {
        // **Found by M1b Task 6's mutation sweep, and it is the twin of
        // the guard Task 5 fixed one file over.** The mutant is
        // `intent.object == target.object && intent.interaction ==
        // target.interaction` relaxed to `||`, and nothing in the
        // workspace could see it: every other fixture that reaches this
        // line has both fields agreeing, which is [L34]'s input domain
        // again. The full sweep that would have caught it at Task 5 was
        // stopped before it reached this file, so this is the first
        // complete sweep since the guard was written.
        //
        // What the relaxed form costs: every shipped object offers exactly
        // one interaction, so an autonomously chosen index and a clicked
        // one are both 0 across the whole shipped lot. A sim finishing the
        // meal it chose for itself, with a click for a DIFFERENT object
        // waiting behind it, would have that click silently discarded - the
        // player's instruction disappears with no error and the sim goes
        // back to autonomy as though nothing was ever asked of it.
        //
        // Both directions are asserted, because they fail to different
        // mutations. Keeping the non-matching intent is what `||` breaks;
        // popping the matching one is what deleting `queue.pop()`
        // altogether breaks, and without that half this test would pass
        // on a guard that never pops anything and turns one click into a
        // loop the player can only escape with a cancel.
        let (_sim, _agent, kept) = agent_finishing_with_a_queued_intent(false);
        assert_eq!(
            kept.len(),
            1,
            "an intent naming a DIFFERENT object must survive the \
             interaction the sim finished on its own; it shares only the \
             interaction index, and popping it throws away an instruction \
             that was never carried out"
        );

        let (_sim, _agent, popped) = agent_finishing_with_a_queued_intent(true);
        assert!(
            popped.is_empty(),
            "an intent naming the object that just finished must be \
             popped, or the sim re-serves it for ever and one click \
             becomes a loop"
        );
    }
}
