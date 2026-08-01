//! The career rabbit hole - [E4] in
//! docs/specs/2026-08-01-m2e-satisfaction-hobbies-career-design.md.
//!
//! Two systems, split by where they must sit in the tick. `start_shift`
//! runs beside the command drain, because a shift start IS a command -
//! the same preemption a player click gets, issued by the clock.
//! `commute_and_work` runs after movement, because arrival is a fact
//! `follow_path` establishes.
//!
//! What a shift does, end to end: at `tick % day_ticks == shift_start`
//! the worker drops whatever it holds, walks to the lot's front door
//! and vanishes into `AtWork` for `shift_ticks`; the return restores
//! it at the door, debits energy, credits the household [`Funds`] and
//! pays the career's (non-negative, deliberately small) satisfaction.
//! Needs keep decaying at work - a shift is tiring, and hungry - and
//! that time-tax on the second axis is the career's real price, which
//! is [S1]'s framing and the reason career satisfaction never needs to
//! be negative.

use bevy_ecs::prelude::*;
use terri_core::{
    Agent, AtWork, Career, Commuting, Eating, Fumbled, Funds, NeedId, Needs, Path, Position,
    Reserved, Satisfaction, SimClock, Socialising, Target, TileGrid,
};

use crate::Content;

/// Sends every worker whose shift starts THIS tick to the front door.
///
/// Runs before `serve_intents` and `select_action`, so on the shift
/// tick neither can hand the worker something new: the commute is
/// already its Path by the time they look, and both skip `Commuting`
/// agents outright. **Work outranks the queue** - a player intent
/// issued before the shift waits in the queue and is served after the
/// return, which is the v1 reading of "the same preemption a player
/// command gets": the clock preempts like a click, and nothing
/// preempts the clock. The first career verb (quit, skip a shift)
/// belongs to the milestone that gives careers a UI.
///
/// The preemption itself mirrors `CancelIntents`' removal set: release
/// the reserved target, drop Target/Path/Eating/Socialising/Fumbled.
/// Two career-specific additions. The worker sheds its OWN `Reserved`,
/// because a sim someone claimed for a conversation still leaves - the
/// partner's talk then fails tick_social's disturbed check and cleans
/// itself up, the standing self-heal. And any sim mid-walk TOWARD the
/// worker has its walk cancelled (Target and Path removed, nothing
/// else), because arriving beside an empty tile and starting a
/// conversation with a sim who is at the office is a scene nobody
/// authored; the approacher re-selects freely next tick.
#[allow(clippy::type_complexity)]
pub fn start_shift(
    mut commands: Commands,
    clock: Res<SimClock>,
    content: Res<Content>,
    grid: Res<TileGrid>,
    workers: Query<
        (Entity, &Position, &Career, Option<&Target>),
        (With<Agent>, Without<AtWork>, Without<Commuting>),
    >,
    approachers: Query<(Entity, &Target), With<Agent>>,
) {
    // Post-validation: a pack with a worker carries a door, so this
    // guard is for hand-built test worlds rather than shipped content.
    let Some(door) = content.0.lot.front_door else {
        return;
    };
    let day_ticks = content.0.tuning.day_ticks as u64;

    // Entity order, the standing discipline for any system that writes
    // per-agent state - no draws happen here, but the command log reads
    // deterministically and costs nothing.
    let mut leaving: Vec<Entity> = workers
        .iter()
        .filter(|(_, _, career, _)| {
            let career = &content.0.careers[career.0 as usize];
            clock.tick % day_ticks == career.shift_start as u64
        })
        .map(|(entity, _, _, _)| entity)
        .collect();
    leaving.sort_by_key(|entity| entity.index());

    for worker in leaving {
        let Ok((_, pos, career, target)) = workers.get(worker) else {
            continue;
        };
        let career = &content.0.careers[career.0 as usize];
        debug_assert_eq!(
            clock.tick % day_ticks,
            career.shift_start as u64,
            "the filter above selected this worker"
        );

        // The CancelIntents removal set: whatever the worker held is
        // released whole on this tick, not left to self-heal.
        if let Some(target) = target {
            commands.entity(target.object).try_remove::<Reserved>();
        }
        commands
            .entity(worker)
            .remove::<Target>()
            .remove::<Path>()
            .remove::<Eating>()
            .remove::<Socialising>()
            // A half-run chain STEP is dropped like a half-run meal;
            // the chain itself survives in its counter, and the worker
            // comes home and finishes cooking ([K4]).
            .remove::<terri_core::StepWork>()
            .remove::<Fumbled>()
            // The worker may itself be claimed - see the doc comment.
            .remove::<Reserved>();

        for (other, target) in approachers.iter() {
            if other != worker && target.object == worker {
                commands.entity(other).remove::<Target>().remove::<Path>();
            }
        }

        // The commute. A worker standing ON the door tile gets the
        // empty path, walks it in zero steps, and clocks in on this
        // same tick's `commute_and_work`.
        let from = (pos.x as i32, pos.y as i32);
        let to = (door.0 as i32, door.1 as i32);
        match grid.find_path(from, to) {
            Some(steps) => {
                commands
                    .entity(worker)
                    .insert((Commuting, Path { steps, cursor: 0 }));
            }
            // Unreachable on shipped content - the door is validated
            // connected and a sim never stands on a blocked tile - but
            // a test world can express it. The shift is simply missed:
            // the clock only matches once per day, which is the honest
            // consequence of being walled in at eight in the morning.
            None => continue,
        }
    }
}

/// Clocks arrived commuters in, counts shifts down, and pays returns.
///
/// Runs after `follow_path`: a commuter whose `Path` is gone has
/// arrived at the door, because movement removes an exhausted
/// target-less path; that is the wander shape, reused on purpose so
/// there is exactly one mover. The same-tick handoff works because
/// command effects apply between systems: `follow_path` removes the
/// Path, this system sees `Commuting` without `Path` and swaps it for
/// [`AtWork`].
///
/// The countdown starts on the tick AFTER arrival - the insert is
/// deferred - so a shift occupies `shift_ticks + 1` ticks door to
/// door, the off-by-one every interaction's delivery loop shares.
// The standing type_complexity allow: the query tuple is what pushes
// past clippy's threshold, and an alias would only move it.
#[allow(clippy::type_complexity)]
pub fn commute_and_work(
    mut commands: Commands,
    content: Res<Content>,
    mut funds: ResMut<Funds>,
    mut workers: Query<
        (
            Entity,
            &Career,
            &mut Needs,
            &mut Satisfaction,
            Option<&mut AtWork>,
            Has<Commuting>,
            Has<Path>,
        ),
        With<Agent>,
    >,
) {
    // Entity order: Funds is shared state and addition commutes, but
    // the discipline is cheaper than the argument for skipping it.
    let mut working: Vec<Entity> = workers.iter().map(|(entity, ..)| entity).collect();
    working.sort_by_key(|entity| entity.index());

    for worker in working {
        let Ok((_, career, mut needs, mut satisfaction, at_work, commuting, has_path)) =
            workers.get_mut(worker)
        else {
            continue;
        };
        let career = &content.0.careers[career.0 as usize];

        if commuting && !has_path {
            // Arrived. The rabbit hole swallows the sim: render skips
            // it, selection and the people loops exclude it, and its
            // Position stays frozen at the door so its hash row (and
            // its render slot) survive the absence.
            commands
                .entity(worker)
                .remove::<Commuting>()
                .insert(AtWork {
                    remaining_ticks: career.shift_ticks,
                });
            continue;
        }

        let Some(mut at_work) = at_work else {
            continue;
        };
        at_work.remaining_ticks -= 1;
        if at_work.remaining_ticks == 0 {
            // The return, all four effects on one tick: reappear (the
            // AtWork removal is what un-hides the sim), pay the
            // household, bill the body, and credit the life score.
            // Needs::drain clamps at zero; a worker who left exhausted
            // comes home at rock bottom, not in debt.
            commands.entity(worker).remove::<AtWork>();
            needs.drain(NeedId::Energy, career.energy_cost);
            funds.0 += career.pay as i64;
            satisfaction.add(career.satisfaction);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_content;
    use crate::Sim;
    use terri_core::{Agent, CommandQueue};
    use terri_data::{CompiledCareer, ContentPack};

    /// A 6-tick shift starting at day-tick 3 of a 30-tick day, with
    /// pairwise distinct pay, energy and satisfaction so a payout read
    /// off the wrong field moves an assertion ([L34]). 30-tick days
    /// keep the wrap test fast; the compile step's shift-fits-the-day
    /// rules hold (3 < 30, 6 < 30) even though a hand-built Tuning
    /// never passes through them.
    fn a_career() -> CompiledCareer {
        CompiledCareer {
            id: "office_job".to_string(),
            label: "Office clerk".to_string(),
            shift_start: 3,
            shift_ticks: 6,
            pay: 130,
            energy_cost: 11.5,
            satisfaction: 2.25,
        }
    }

    /// A pack whose lot carries the SHIPPED front door at (15, 2) -
    /// `pack_tuned` copies the shipped lot - plus one career and the
    /// given objects. Tests pair it with a 16x12 empty grid so the
    /// door tile exists and every walk is unobstructed.
    fn career_pack(objects: Vec<terri_data::CompiledObject>) -> &'static ContentPack {
        let base = test_content::pack_tuned(
            objects,
            terri_data::Tuning {
                day_ticks: 30,
                // Zero variance so nothing here depends on a draw.
                duration_variance: 0.0,
                ..test_content::tuning()
            },
        );
        Box::leak(Box::new(ContentPack {
            careers: vec![a_career()],
            ..base.clone()
        }))
    }

    fn a_worker(sim: &mut Sim, x: f32, y: f32) -> Entity {
        sim.world_mut()
            .spawn((
                Agent,
                Position { x, y },
                Needs::all_at(80.0),
                Satisfaction::default(),
                Career(0),
            ))
            .id()
    }

    /// The whole rabbit hole on one worker: the shift starts on the
    /// day clock, the commute ends at the front door, the sim is
    /// AtWork with its position frozen there, and the return pays all
    /// three currencies at once - money to the household, energy off
    /// the body, satisfaction onto the life.
    #[test]
    fn a_shift_walks_to_the_door_vanishes_and_the_return_pays() {
        let pack = career_pack(vec![]);
        let mut sim = test_content::sim_with(16, 12, pack);
        let worker = a_worker(&mut sim, 13.0, 2.0);

        // Ride the day. Generous budget: the worker may stroll before
        // the shift and the commute length depends on where from.
        let mut clocked_in_at = None;
        for tick in 1..=29u64 {
            sim.tick();
            let at_work = sim.world().get::<AtWork>(worker).is_some();
            if at_work && clocked_in_at.is_none() {
                clocked_in_at = Some(tick);
                let pos = sim.world().get::<Position>(worker).unwrap();
                assert_eq!(
                    (pos.x, pos.y),
                    (15.0, 2.0),
                    "the rabbit hole opens at the front door and nowhere else"
                );
            }
            if let Some(started) = clocked_in_at {
                if tick <= started + 5 {
                    assert!(at_work, "a 6-tick shift does not end at tick {tick}");
                    let pos = sim.world().get::<Position>(worker).unwrap();
                    assert_eq!(
                        (pos.x, pos.y),
                        (15.0, 2.0),
                        "nothing may move a sim that is not on the lot"
                    );
                }
            }
        }
        let started = clocked_in_at.expect("the shift must have started inside one day");

        assert!(
            sim.world().get::<AtWork>(worker).is_none(),
            "clocked in at {started}, so the return is well before tick 29"
        );
        assert_eq!(sim.funds(), 130, "one shift, one pay packet");
        assert_eq!(
            sim.world().get::<Satisfaction>(worker).unwrap().value(),
            2.25,
            "the career's satisfaction lands exactly once"
        );
        // Energy: 80 at spawn, minus 29 ticks of shipped decay, minus
        // the 11.5 debit. Read the rate from content per the standing
        // rule rather than restating it.
        let decay = test_content::decay_per_tick(NeedId::Energy);
        let expected = 80.0 - 29.0 * decay - 11.5;
        let energy = sim
            .world()
            .get::<Needs>(worker)
            .unwrap()
            .get(NeedId::Energy);
        assert!(
            (energy - expected).abs() < 0.01,
            "the return must debit exactly energy_cost on top of decay: \
             read {energy}, expected {expected}"
        );
    }

    /// The clock preempts like a click: a worker mid-meal drops it
    /// whole on the shift tick - reservation released, Eating, Target
    /// and the fumble gone, the commute already inserted.
    #[test]
    fn a_shift_start_preempts_a_meal_and_releases_the_reservation() {
        let pack = career_pack(vec![test_content::object(
            "fridge",
            &[(NeedId::Hunger, 40.0)],
            30,
        )]);
        let mut sim = test_content::sim_with(16, 12, pack);
        let fridge_def = pack.find("fridge").expect("fixture");
        let fridge = sim
            .world_mut()
            .spawn((
                Position { x: 10.0, y: 2.0 },
                terri_core::SmartObject(fridge_def),
                Reserved,
            ))
            .id();
        let worker = a_worker(&mut sim, 9.0, 2.0);
        sim.world_mut().entity_mut(worker).insert((
            Target {
                object: fridge,
                interaction: 0,
            },
            Eating {
                object: fridge_def,
                interaction: 0,
                remaining_ticks: 200,
            },
            Fumbled { delta_scale: 0.0 },
        ));

        // Ticks 1 and 2: the meal simply runs.
        sim.tick();
        assert!(
            sim.world().get::<Eating>(worker).is_some(),
            "before the shift the meal is nobody's business"
        );
        sim.tick();
        sim.tick(); // day-tick 3: the shift.

        assert!(
            sim.world().get::<Eating>(worker).is_none(),
            "the shift drops the meal"
        );
        assert!(
            sim.world().get::<Target>(worker).is_none(),
            "and the commitment"
        );
        assert!(
            sim.world().get::<Fumbled>(worker).is_none(),
            "a fumble closes with its attempt, unlearned"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_none(),
            "the fridge is free the moment its user leaves for work"
        );
        assert!(
            sim.world().get::<Commuting>(worker).is_some()
                || sim.world().get::<AtWork>(worker).is_some(),
            "the worker is on its way the same tick"
        );
    }

    /// The door shuts in your face: a sim mid-walk TOWARD the worker
    /// has its walk cancelled on the shift tick - Target and Path gone,
    /// the worker's own Reserved (it was claimed as a partner) gone -
    /// so nobody arrives beside an empty tile and talks to it.
    #[test]
    fn a_shift_start_cancels_an_approaching_talker() {
        let pack = career_pack(vec![]);
        let mut sim = test_content::sim_with(16, 12, pack);
        let worker = a_worker(&mut sim, 13.0, 2.0);
        sim.world_mut().entity_mut(worker).insert(Reserved);
        let admirer = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 8.0 },
                Needs::all_at(80.0),
                Target {
                    object: worker,
                    interaction: 0,
                },
                Path {
                    steps: vec![(3, 8), (4, 8), (5, 8)],
                    cursor: 0,
                },
            ))
            .id();

        sim.tick();
        sim.tick();
        sim.tick(); // day-tick 3: the shift.

        assert!(
            sim.world().get::<Target>(admirer).is_none(),
            "the walk toward a departing worker is cancelled"
        );
        // No Path assertion, deliberately: the admirer is FREE the same
        // tick, and on this empty lot freedom means selection marks it
        // Restless and wander hands it a stroll - a fresh Path that is
        // the cancellation WORKING, not surviving. Target and the
        // conversation are what must be gone.
        assert!(
            sim.world().get::<Socialising>(admirer).is_none(),
            "nobody talks to a sim who left for the office"
        );
        assert!(
            sim.world().get::<Reserved>(worker).is_none(),
            "a claimed worker still leaves; the claim is released"
        );
    }

    /// The cancellation is AIMED: only walks toward the departing
    /// worker are cut. A bystander mid-walk to the fridge keeps its
    /// Target through the shift tick - the `&&`-to-`||` mutant cancels
    /// every walk in the house, and this is what catches it.
    #[test]
    fn a_shift_start_leaves_an_unrelated_walk_alone() {
        let pack = career_pack(vec![test_content::object(
            "fridge",
            &[(NeedId::Hunger, 40.0)],
            30,
        )]);
        let mut sim = test_content::sim_with(16, 12, pack);
        a_worker(&mut sim, 15.0, 2.0);
        let fridge_def = pack.find("fridge").expect("fixture");
        let fridge = sim
            .world_mut()
            .spawn((
                Position { x: 10.0, y: 8.0 },
                terri_core::SmartObject(fridge_def),
                Reserved,
            ))
            .id();
        let bystander = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 8.0 },
                Needs::all_at(80.0),
                Target {
                    object: fridge,
                    interaction: 0,
                },
                Path {
                    steps: vec![(3, 8), (4, 8), (5, 8), (6, 8), (7, 8), (8, 8), (9, 8)],
                    cursor: 0,
                },
            ))
            .id();

        sim.tick();
        sim.tick();
        sim.tick(); // day-tick 3: the worker leaves.

        assert_eq!(
            sim.world().get::<Target>(bystander).map(|t| t.object),
            Some(fridge),
            "an errand that has nothing to do with the worker survives \
             the shift tick"
        );
    }

    /// A working sim is GONE to autonomy: desperate needs, an
    /// available fridge, and it selects nothing until the shift ends.
    #[test]
    fn a_sim_at_work_chooses_nothing_however_desperate() {
        let pack = career_pack(vec![test_content::object(
            "fridge",
            &[(NeedId::Hunger, 40.0)],
            30,
        )]);
        let mut sim = test_content::sim_with(16, 12, pack);
        let fridge_def = pack.find("fridge").expect("fixture");
        sim.world_mut().spawn((
            Position { x: 10.0, y: 2.0 },
            terri_core::SmartObject(fridge_def),
        ));
        let worker = a_worker(&mut sim, 15.0, 2.0);
        let mut needs = Needs::all_at(80.0);
        needs.set(NeedId::Hunger, 5.0);
        sim.world_mut().entity_mut(worker).insert((
            needs,
            AtWork {
                remaining_ticks: 500,
            },
        ));

        for _ in 0..20 {
            sim.tick();
            assert!(
                sim.world().get::<Target>(worker).is_none()
                    && sim.world().get::<Eating>(worker).is_none()
                    && sim.world().get::<Path>(worker).is_none(),
                "a sim at the office cannot reach the fridge at home"
            );
        }
    }

    /// At work is BUSY, not gone, to a directed talk: the initiator
    /// waits (Blocked, intent standing) rather than starting a
    /// conversation beside an empty tile - [C3]'s wait-on-busy.
    #[test]
    fn a_directed_talk_at_a_worker_waits_by_the_door() {
        let base = test_content::pack_with_social(
            vec![],
            vec![test_content::interaction(
                "chat",
                &[(NeedId::Social, 20.0)],
                30,
            )],
            terri_data::Tuning {
                day_ticks: 30,
                duration_variance: 0.0,
                ..test_content::tuning()
            },
        );
        let pack: &'static ContentPack = Box::leak(Box::new(ContentPack {
            careers: vec![a_career()],
            ..base.clone()
        }));
        let mut sim = test_content::sim_with(16, 12, pack);
        let worker = a_worker(&mut sim, 15.0, 2.0);
        sim.world_mut().entity_mut(worker).insert(AtWork {
            remaining_ticks: 500,
        });
        let admirer = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 12.0, y: 2.0 },
                Needs::all_at(80.0),
                terri_core::IntentQueue::default(),
            ))
            .id();
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(terri_core::SimCommand::TalkTo {
                agent: admirer.index_u32(),
                target: worker.index_u32(),
                interaction: 0,
            });

        for _ in 0..10 {
            sim.tick();
            assert!(
                sim.world().get::<Socialising>(admirer).is_none(),
                "no conversation may start with a sim who is not there"
            );
            assert!(
                sim.world().get::<Target>(admirer).is_none(),
                "waiting happens standing, not walking"
            );
        }
        assert!(
            sim.world().get::<terri_core::Blocked>(admirer).is_some(),
            "the wait says why, out loud"
        );
        assert_eq!(
            sim.world()
                .get::<terri_core::IntentQueue>(admirer)
                .map(|q| q.len()),
            Some(1),
            "the intent stands and is served on the return"
        );
    }

    /// The worker's render row RIDES, flagged AT_WORK, so every later
    /// entity keeps its interpolation slot; the shell skips the draw.
    #[test]
    fn a_working_sims_row_rides_flagged_rather_than_disappearing() {
        let pack = career_pack(vec![]);
        let mut sim = test_content::sim_with(16, 12, pack);
        let worker = a_worker(&mut sim, 15.0, 2.0);
        sim.world_mut().entity_mut(worker).insert(AtWork {
            remaining_ticks: 500,
        });
        let bystander = sim
            .world_mut()
            .spawn((Agent, Position { x: 3.0, y: 3.0 }, Needs::all_at(80.0)))
            .id();

        sim.sync_render_buffer();
        let buf = sim.render_buffer();
        assert_eq!(buf.count, 2, "the row rides; nothing shifts");
        let row = buf
            .ids
            .iter()
            .position(|&id| id == worker.index_u32())
            .expect("the worker keeps a row");
        assert_eq!(buf.activities[row], crate::render_buffer::activity::AT_WORK);
        let other = buf
            .ids
            .iter()
            .position(|&id| id == bystander.index_u32())
            .expect("the bystander has a row");
        assert_ne!(
            buf.activities[other],
            crate::render_buffer::activity::AT_WORK,
            "only the worker is flagged"
        );
    }

    /// The day wraps: `tick % day_ticks` fires the shift again on day
    /// two, so two days pay twice. This is the modulo's whole job -
    /// an absolute-tick comparison passes day one and never fires
    /// again.
    #[test]
    fn the_shift_fires_again_on_the_second_day() {
        let pack = career_pack(vec![]);
        let mut sim = test_content::sim_with(16, 12, pack);
        a_worker(&mut sim, 15.0, 2.0);

        for _ in 0..29 {
            sim.tick();
        }
        assert_eq!(sim.funds(), 130, "day one pays once");
        for _ in 0..30 {
            sim.tick();
        }
        assert_eq!(sim.funds(), 260, "day two pays again");
    }

    /// Both new hash inputs, each from both sides: two worlds equal in
    /// everything but the countdown hash differently, and so do two
    /// equal in everything but the money. The determinism scenario's
    /// golden cannot see either - nobody there holds a job - so this
    /// is what fails if `world_hash` drops the new fields.
    #[test]
    fn the_hash_sees_the_countdown_and_the_money() {
        let build = |remaining: u32, funds: i64| {
            let pack = career_pack(vec![]);
            let mut sim = test_content::sim_with(16, 12, pack);
            let worker = a_worker(&mut sim, 15.0, 2.0);
            sim.world_mut().entity_mut(worker).insert(AtWork {
                remaining_ticks: remaining,
            });
            sim.world_mut().resource_mut::<Funds>().0 = funds;
            sim.world_hash()
        };

        assert_eq!(build(5, 40), build(5, 40), "equal worlds agree");
        assert_ne!(build(5, 40), build(6, 40), "the countdown is replay state");
        assert_ne!(build(5, 40), build(5, 41), "so is the money");
    }
}
