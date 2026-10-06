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
//! on one of the career's working days (`works_today`, [CAL-careers]
//! in docs/specs/2026-10-06-calendar.md) the worker drops whatever it
//! holds, walks out to the street's exit, or to the front door on a lot
//! with no yard beyond it ([OS-street]), and
//! vanishes into `AtWork` for `shift_ticks`; the return restores it where
//! it vanished, pays the shift, then walks it home to the door's landing
//! when the door has authored portal routing. Legacy lots still reappear
//! on the door tile. The two walks carry the same marker with its
//! direction written in, `Commuting::Outbound` and `Commuting::Inbound`,
//! so the end of a walk is read by the direction that started it and
//! never by where the worker stands.
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

/// Sends every worker whose shift starts THIS tick out to the street's
/// exit, or to the front door where there is no street or the exit cannot be
/// reached ([OS-street]). A shift starts at the career's `shift_start`
/// day-tick on a day `works_today` accepts; on a rest day the worker
/// stays home and nothing else about the day changes.
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
///
/// **The sweep also matches a sim ALREADY TALKING to the worker**, because
/// a talk's initiator carries the same `Target{worker}`. It loses its
/// Target here, keeps `Socialising` until `tick_social` runs later this
/// tick, and is free to choose something new in between. That is safe
/// only because `tick_social` removes a Target it still OWNS and no other
/// ([L-cleanup-removes-only-what-it-owns]); before that rule the talk's
/// cleanup deleted the new Target and froze the shipped household.
///
/// Known gap, unreachable while one sim has a career: with two workers
/// whose shifts start on the same tick, a worker walking toward the
/// OTHER worker has its fresh commute `Path` removed by that worker's
/// sweep, which still sees the old `Target`, and `commute_and_work` then
/// reads an outbound `Commuting` with no `Path` as an arrival. Whoever adds
/// a second career owns closing it; [B-jobs-careers] is where that lands.
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
                && works_today(career, &clock, &content.0.tuning)
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
            crate::reservations::release(&mut commands, worker, *target);
        }
        commands
            .entity(worker)
            .remove::<Target>()
            .remove::<Path>()
            .remove::<Eating>()
            .remove::<Socialising>()
            .remove::<terri_core::ConversationVoice>()
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

        // The commute, to the street's exit where the door opens onto a
        // yard ([OS-street]), else to the door. A worker standing on the
        // commute's end tile gets the empty path, walks it in zero steps,
        // and clocks in on this same tick's `commute_and_work`, wherever on
        // that tile it stands: the walk is outbound by construction.
        let from = if grid.blocked_edges().next().is_some() {
            (pos.x.round() as i32, pos.y.round() as i32)
        } else {
            (pos.x as i32, pos.y as i32)
        };
        let route = |to: (u32, u32)| {
            grid.find_path(from, (to.0 as i32, to.1 as i32))
                .and_then(|steps| grid.anchor_path((pos.x, pos.y), steps))
        };
        // Furniture a house was saved with can stand on the exit; the
        // worker then leaves by the door, as it did before the street.
        match crate::portals::street_exit(content.0, grid.width() as u32)
            .and_then(route)
            .or_else(|| route(door))
        {
            Some(steps) => {
                commands
                    .entity(worker)
                    .insert((Commuting::Outbound, Path { steps, cursor: 0 }));
            }
            // Unreachable on shipped content - the door is validated
            // connected, a sim never stands on a blocked tile, and the
            // street's exit falls back to the door - but a test world can
            // express it. The shift is simply missed:
            // the clock only matches once per day, which is the honest
            // consequence of being walled in at eight in the morning.
            None => continue,
        }
    }
}

/// Whether `career` works on the day `clock` is in ([CAL-careers] in
/// `docs/specs/2026-10-06-calendar.md`).
///
/// `start_shift` asks this only on a shift-start tick, so it decides
/// whether a shift STARTS and nothing else: a shift already running when
/// a rest day begins finishes and pays as normal. The day is the one the
/// current tick falls in, which `start_shift` reads after `advance_clock`,
/// so a shift starting at day-tick 0 follows the day that tick begins.
pub(crate) fn works_today(
    career: &terri_data::CompiledCareer,
    clock: &SimClock,
    tuning: &terri_data::Tuning,
) -> bool {
    career.works_on(terri_core::clock::weekday(
        clock.tick,
        tuning.day_ticks,
        tuning.first_weekday,
    ))
}

/// The direction of a saved commute, read back off the saved walk's
/// destination, because a save carries the marker and not its direction
/// (Save V1's `commuting` is one bit, and postcard writes an entity's
/// fields back to back, so a direction field could not be appended the way
/// a trailing snapshot field can).
///
/// A walk home ends on the front door's landing and nowhere else, and no
/// outbound walk ends there: the commute's end is the street's exit or the
/// door tile ([OS-street]), both outside the landing. A saved commuter with
/// no walk at all is outbound, the only direction that can be saved
/// without one, and loads to clock in where it stands.
pub(crate) fn saved_commute(
    content: &terri_data::ContentPack,
    destination: Option<(i32, i32)>,
) -> Commuting {
    let landing = crate::portals::front_portal(content)
        .map(|portal| (portal.inward.0 as i32, portal.inward.1 as i32));
    if destination.is_some() && destination == landing {
        Commuting::Inbound
    } else {
        Commuting::Outbound
    }
}

/// Clocks departures in, counts shifts down, pays returns, and finishes arrivals.
///
/// Runs after `follow_path`: a commuter whose `Path` is gone has
/// arrived where it was going, because movement removes an exhausted
/// target-less path; that is the wander shape, reused on purpose so
/// there is exactly one mover. The same-tick handoff works because
/// command effects apply between systems: `follow_path` removes the
/// Path, this system sees `Commuting` without `Path` and reads the
/// marker's direction. An outbound walk's end is the clock-in, swapped
/// for [`AtWork`]; an inbound walk's end is home, and the marker is
/// removed rather than clocking the worker straight back in. The
/// direction is never inferred from the position: a worker already on
/// the commute's end tile when the shift starts arrives on the shift
/// tick a fraction of a tile from the tile's centre, and reading that as
/// "not on the door, so home" is the bug that sent it back to the sofa
/// unpaid.
///
/// The countdown starts on the tick AFTER arrival because the insert is
/// deferred. The office absence therefore occupies `shift_ticks + 1` ticks.
/// A content portal adds its ordinary one-tile walk after the worker is paid.
// The standing type_complexity allow: the query tuple is what pushes
// past clippy's threshold, and an alias would only move it.
#[allow(clippy::type_complexity)]
pub fn commute_and_work(
    mut commands: Commands,
    content: Res<Content>,
    grid: Res<TileGrid>,
    mut funds: ResMut<Funds>,
    mut workers: Query<
        (
            Entity,
            &Career,
            &Position,
            &mut Needs,
            &mut Satisfaction,
            Option<&mut AtWork>,
            Option<&Commuting>,
            Has<Path>,
        ),
        With<Agent>,
    >,
) {
    // Entity order: Funds is shared state and addition commutes, but
    // the discipline is cheaper than the argument for skipping it.
    let mut working: Vec<Entity> = workers.iter().map(|(entity, ..)| entity).collect();
    working.sort_by_key(|entity| entity.index());
    let front_portal = crate::portals::front_portal(content.0);

    for worker in working {
        let Ok((_, career, position, mut needs, mut satisfaction, at_work, commuting, has_path)) =
            workers.get_mut(worker)
        else {
            continue;
        };
        let career = &content.0.careers[career.0 as usize];

        match commuting {
            Some(Commuting::Inbound) if !has_path => {
                // Home on the landing. The walk was a normal one and the
                // shift was paid when it began, so there is nothing to do
                // but take the marker off.
                commands.entity(worker).remove::<Commuting>();
                continue;
            }
            Some(Commuting::Outbound) if !has_path => {
                // Arrived. The rabbit hole swallows the sim: render skips
                // it, selection and the people loops exclude it, and its
                // Position stays frozen where it vanished, on the street's
                // exit or the door, so its hash row (and its render slot)
                // survive the absence.
                commands
                    .entity(worker)
                    .remove::<Commuting>()
                    .insert(AtWork {
                        remaining_ticks: career.shift_ticks,
                    });
                continue;
            }
            _ => {}
        }

        let Some(mut at_work) = at_work else {
            continue;
        };
        at_work.remaining_ticks -= 1;
        if at_work.remaining_ticks == 0 {
            // The return settles all four shift effects on one tick:
            // reappear (the AtWork removal is what un-hides the sim),
            // pay the household, bill the body, and credit the life score.
            // An authored portal adds a normal one-tile walk, but the walk
            // owns no second payment edge.
            // Needs::drain clamps at zero; a worker who left exhausted
            // comes home at rock bottom, not in debt.
            let mut returning = commands.entity(worker);
            returning.remove::<AtWork>();
            if let Some(portal) = front_portal {
                // Home along a path to the landing: from the street's exit
                // back through the door ([OS-street]), from the door tile the
                // one step in it always was. A landing the grid cannot reach
                // keeps that one step, as before there were paths home.
                let landing = (portal.inward.0 as i32, portal.inward.1 as i32);
                let from = (position.x.round() as i32, position.y.round() as i32);
                let steps = grid
                    .find_path(from, landing)
                    .and_then(|steps| grid.anchor_path((position.x, position.y), steps))
                    .unwrap_or_else(|| vec![landing]);
                returning.insert((Commuting::Inbound, Path { steps, cursor: 0 }));
            }
            needs.drain(NeedId::Energy, career.energy_cost);
            funds.0 += career.pay as i64;
            satisfaction.reward(career.satisfaction);
        }
    }
}

#[cfg(test)]
#[path = "street_tests.rs"]
mod street_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_content;
    use crate::Sim;
    use terri_core::{Agent, CommandQueue};
    use terri_data::{
        CompiledCareer, CompiledPortal, CompiledPortalHinge, CompiledSocketFacing, ContentPack,
    };

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
            working_days: 0b1111111,
        }
    }

    /// [CAL-careers]: `a_career` on Monday to Friday only. Day 0 of a
    /// `thirty_tick_day` fixture is a Monday, so days 5 and 6 (ticks 150
    /// to 209) are its weekend.
    fn weekday_career() -> CompiledCareer {
        CompiledCareer {
            working_days: 0b0011111,
            ..a_career()
        }
    }

    /// The 30-tick day every career fixture runs on. Zero variance so
    /// nothing here depends on a draw, and day 0 named a Monday here
    /// rather than inherited from the shipped tuning, so a retuned
    /// `first_weekday` cannot quietly move every weekend below.
    fn thirty_tick_day() -> terri_data::Tuning {
        terri_data::Tuning {
            day_ticks: 30,
            duration_variance: 0.0,
            first_weekday: 0,
            ..test_content::tuning()
        }
    }

    /// A pack whose lot carries the SHIPPED front door at (15, 2) -
    /// `pack_tuned` copies the shipped lot - plus one career and the
    /// given objects. Tests pair it with a 16x12 empty grid so the
    /// door tile exists and every walk is unobstructed.
    fn career_pack(objects: Vec<terri_data::CompiledObject>) -> &'static ContentPack {
        pack_with_career(a_career(), objects, thirty_tick_day())
    }

    fn pack_with_career(
        career: CompiledCareer,
        objects: Vec<terri_data::CompiledObject>,
        tuning: terri_data::Tuning,
    ) -> &'static ContentPack {
        let base = test_content::pack_tuned(objects, tuning);
        Box::leak(Box::new(ContentPack {
            careers: vec![career],
            ..base.clone()
        }))
    }

    fn career_pack_with_portal() -> &'static ContentPack {
        career_pack_with_portal_route((15, 2), (15, 3))
    }

    fn career_pack_with_portal_route(
        position: (u32, u32),
        inward: (u32, u32),
    ) -> &'static ContentPack {
        with_front_portal(career_pack(vec![]), position, inward)
    }

    /// `base` with its front door moved to `position` and given an
    /// authored portal whose landing is `inward`, so a return walks home.
    fn with_front_portal(
        base: &'static ContentPack,
        position: (u32, u32),
        inward: (u32, u32),
    ) -> &'static ContentPack {
        let mut lot = base.lot.clone();
        lot.front_door = Some(position);
        Box::leak(Box::new(ContentPack {
            lot,
            portals: vec![CompiledPortal {
                position,
                inward,
                facing: CompiledSocketFacing::PositiveX,
                hinge: CompiledPortalHinge::Left,
                frame_sprite: 41,
                closed_sprite: 42,
                ajar_sprite: 43,
                open_sprite: 44,
            }],
            ..base.clone()
        }))
    }

    fn clock(sim: &Sim) -> u64 {
        sim.world().resource::<SimClock>().tick
    }

    /// The weekday of the tick the sim last ran, 0 (Monday) to 6.
    fn today(sim: &Sim) -> u8 {
        let tuning = &sim.world().resource::<Content>().0.tuning;
        terri_core::clock::weekday(clock(sim), tuning.day_ticks, tuning.first_weekday)
    }

    /// Off the lot or on the way: the two states only a shift creates.
    fn away(sim: &Sim, worker: Entity) -> bool {
        sim.world().get::<Commuting>(worker).is_some()
            || sim.world().get::<AtWork>(worker).is_some()
    }

    /// Runs `sim` from its current tick to `last` inclusive, one tick at a
    /// time, and returns every tick on which `worker` went from home to
    /// away. That transition is a shift start and nothing else, because a
    /// return either ends away-ness or (through a portal) continues it, so
    /// the result is the departure schedule. Bounded by the tick count,
    /// never by simulation state ([L-a-test-that-waits-must-be-bounded]).
    fn departures(sim: &mut Sim, worker: Entity, last: u64) -> Vec<u64> {
        let first = clock(sim) + 1;
        let mut was_away = away(sim, worker);
        let mut ticks = Vec::new();
        for tick in first..=last {
            sim.tick();
            let is_away = away(sim, worker);
            if is_away && !was_away {
                ticks.push(tick);
            }
            was_away = is_away;
        }
        assert_eq!(clock(sim), last, "one tick per Sim::tick");
        ticks
    }

    fn a_worker(sim: &mut Sim, x: f32, y: f32) -> Entity {
        sim.world_mut()
            .spawn((
                Agent,
                Position { x, y },
                Needs::all_at(80.0),
                Satisfaction::from_value(0.0),
                Career(0),
            ))
            .id()
    }

    #[test]
    fn a_return_crosses_a_content_portal_and_save_load_does_not_pay_twice() {
        let pack = career_pack_with_portal();
        let mut sim = test_content::sim_with_portals(16, 12, pack);
        let worker = a_worker(&mut sim, 15.0, 2.0);
        sim.world_mut()
            .entity_mut(worker)
            .insert(AtWork { remaining_ticks: 1 });

        sim.tick();

        assert!(sim.world().get::<AtWork>(worker).is_none());
        assert!(sim.world().get::<Commuting>(worker).is_some());
        assert_eq!(
            sim.world()
                .get::<Path>(worker)
                .and_then(|path| path.steps.last().copied()),
            Some((15, 3)),
            "the return crosses one authored tile into the lot"
        );
        assert_eq!(sim.funds(), 130, "the completed shift pays once");

        let snapshot = sim.save_snapshot();
        let mut restored = test_content::sim_with_portals(16, 12, pack);
        assert_eq!(restored.load_snapshot(snapshot), Ok(()));
        assert_eq!(restored.funds(), 130);

        for _ in 0..20 {
            restored.tick();
            if restored.world().get::<Commuting>(worker).is_none() {
                break;
            }
        }

        assert!(restored.world().get::<AtWork>(worker).is_none());
        assert!(restored.world().get::<Commuting>(worker).is_none());
        let position = restored.world().get::<Position>(worker).unwrap();
        assert_eq!((position.x, position.y), (15.0, 3.0));
        assert_eq!(
            restored.funds(),
            130,
            "finishing the doorway walk cannot pay again"
        );
    }

    #[test]
    fn an_inbound_portal_walk_finishes_without_clocking_back_in_on_either_axis() {
        for (axis, door, inward) in [("x", (5, 4), (6, 4)), ("y", (5, 4), (5, 5))] {
            let pack = career_pack_with_portal_route(door, inward);
            let mut sim = test_content::sim_with(8, 8, pack);
            let worker = a_worker(&mut sim, door.0 as f32, door.1 as f32);
            sim.world_mut().entity_mut(worker).insert((
                Commuting::Inbound,
                Path {
                    steps: vec![(inward.0 as i32, inward.1 as i32)],
                    cursor: 0,
                },
            ));

            for _ in 0..8 {
                sim.tick();
                if sim.world().get::<Commuting>(worker).is_none() {
                    break;
                }
            }

            assert!(
                sim.world().get::<Commuting>(worker).is_none(),
                "the {axis}-axis return must finish"
            );
            assert!(
                sim.world().get::<AtWork>(worker).is_none(),
                "the {axis}-axis return must not clock the worker back in"
            );
            let position = sim.world().get::<Position>(worker).unwrap();
            assert_eq!(
                (position.x, position.y),
                (inward.0 as f32, inward.1 as f32),
                "the {axis}-axis return settles on its authored landing"
            );
        }
    }

    /// A worker standing a fraction of a tile off the door tile when the
    /// shift starts routes from the door tile it stands on, so its commute
    /// is the empty walk and it arrives on the shift tick. That arrival is
    /// outbound whatever the position reads, on each axis separately
    /// ([L-door-arrival-needs-independent-axis-tests]): the worker clocks
    /// in, the shift runs, and the return pays once. Clock-in and pay are
    /// observed, never predicted
    /// ([L-career-tests-follow-events-not-guessed-ticks]).
    #[test]
    fn a_worker_a_fraction_off_the_door_at_shift_start_still_clocks_in_and_is_paid_once() {
        let shift_start = a_career().shift_start as u64;
        for (axis, position) in [
            ("x", Position { x: 15.3, y: 2.0 }),
            ("y", Position { x: 15.0, y: 2.3 }),
        ] {
            let pack = career_pack_with_portal();
            let mut sim = test_content::sim_with_portals(16, 12, pack);
            let worker = a_worker(&mut sim, 15.0, 2.0);

            // Idle wandering moves the worker before the shift, so the
            // position is pinned on the tick before the shift starts, as
            // a wander the clock interrupts mid-step would leave it. The
            // 16x12 test lot has no wall edges, so the commute routes
            // from the tile the position truncates to, the door's own.
            for _ in 1..shift_start {
                sim.tick();
            }
            assert_eq!(clock(&sim), shift_start - 1, "one tick per Sim::tick");
            sim.world_mut()
                .entity_mut(worker)
                .remove::<Path>()
                .insert(position);

            let mut clocked_in_at = None;
            for tick in shift_start..=29u64 {
                sim.tick();
                if clocked_in_at.is_none() && sim.world().get::<AtWork>(worker).is_some() {
                    clocked_in_at = Some(tick);
                }
            }
            assert_eq!(clock(&sim), 29, "one tick per Sim::tick");

            assert_eq!(
                clocked_in_at,
                Some(shift_start),
                "the {axis}-axis worker is on the door tile already, so it clocks \
                 in on the shift tick instead of being read as home from work"
            );
            assert!(
                !away(&sim, worker),
                "the {axis}-axis worker's 6-tick shift is over well before tick 29"
            );
            assert_eq!(
                sim.funds(),
                a_career().pay as i64,
                "the {axis}-axis worker's one shift pays once"
            );
        }
    }

    /// An outbound commute that has ended is the clock-in, read from the
    /// marker's direction and not from where the worker stands: exactly on
    /// the door, a hair off it on either axis, a fraction of a tile off on
    /// either axis, and on the landing a walk home would end on
    /// ([L-door-arrival-needs-independent-axis-tests]).
    #[test]
    fn an_outbound_commute_that_has_ended_clocks_in_wherever_the_worker_stands() {
        for (case, door, position) in [
            ("nonzero exact door", (5, 4), Position { x: 5.0, y: 4.0 }),
            ("x hair off", (0, 0), Position { x: 0.01, y: 0.0 }),
            ("y hair off", (0, 0), Position { x: 0.0, y: 0.01 }),
            ("x fraction off", (5, 4), Position { x: 5.3, y: 4.0 }),
            ("y fraction off", (5, 4), Position { x: 5.0, y: 4.3 }),
            ("on the landing", (5, 4), Position { x: 5.0, y: 5.0 }),
        ] {
            let pack = career_pack_with_portal_route(door, (door.0, door.1 + 1));
            let mut sim = test_content::sim_with(8, 8, pack);
            let worker = a_worker(&mut sim, position.x, position.y);
            sim.world_mut()
                .entity_mut(worker)
                .insert(Commuting::Outbound);

            sim.tick();

            assert!(
                sim.world().get::<Commuting>(worker).is_none(),
                "{case} must finish the outbound commute"
            );
            assert_eq!(
                sim.world()
                    .get::<AtWork>(worker)
                    .map(|work| work.remaining_ticks),
                Some(a_career().shift_ticks),
                "{case} clocks in: the walk out has ended"
            );
            let settled = sim.world().get::<Position>(worker).unwrap();
            assert_eq!(
                (settled.x, settled.y),
                (position.x, position.y),
                "{case} vanishes where it stood"
            );
        }
    }

    #[test]
    fn career_return_replays_identically_with_or_without_portal_presentation() {
        let mut source = Sim::new_from_shipped_lot();
        let worker = {
            let mut workers = source
                .world_mut()
                .query_filtered::<Entity, (With<Agent>, With<Career>)>();
            workers
                .iter(source.world())
                .next()
                .expect("the shipped household has an employed Sim")
        };
        source
            .world_mut()
            .entity_mut(worker)
            .insert((Position { x: 15.0, y: 2.0 }, AtWork { remaining_ticks: 1 }));
        let snapshot = source.save_snapshot();

        let mut presented = Sim::new_from_shipped_lot();
        let mut headless = Sim::new();
        assert_eq!(presented.load_snapshot(snapshot.clone()), Ok(()));
        assert_eq!(headless.load_snapshot(snapshot), Ok(()));
        assert!(
            presented
                .world()
                .contains_resource::<crate::portals::ActivePortals>(),
            "the shipped constructor activates portal presentation"
        );
        assert!(
            !headless
                .world()
                .contains_resource::<crate::portals::ActivePortals>(),
            "the blank constructor deliberately has no portal presentation"
        );

        let mut settled = false;
        for tick in 1..=20 {
            presented.tick();
            headless.tick();
            assert_eq!(
                presented.save_snapshot(),
                headless.save_snapshot(),
                "presentation activation changed replay state on tick {tick}"
            );
            assert_eq!(
                presented.world_hash(),
                headless.world_hash(),
                "presentation activation changed the world hash on tick {tick}"
            );

            let position = presented
                .world()
                .get::<Position>(worker)
                .expect("the worker survives the return");
            if presented.world().get::<AtWork>(worker).is_none()
                && presented.world().get::<Commuting>(worker).is_none()
                && (position.x, position.y) == (15.0, 3.0)
            {
                settled = true;
                break;
            }
        }

        assert!(settled, "the worker must finish the authored return walk");
        let position = presented
            .world()
            .get::<Position>(worker)
            .expect("the worker survives the return");
        assert_eq!((position.x, position.y), (15.0, 3.0));
        assert!(presented.world().get::<AtWork>(worker).is_none());
        assert!(presented.world().get::<Commuting>(worker).is_none());
    }

    /// [CAL-evidence] 3 on the shipped lot: the employed Sim leaves for the
    /// shipped office job on day 1, a Monday, and stays home for the whole
    /// of day 6, a Saturday, with the household's money unchanged. The
    /// departure and the pay are observed within day 1 rather than
    /// predicted ([L-career-tests-follow-events-not-guessed-ticks]); every
    /// loop counts ticks and asserts the clock
    /// ([L-a-test-that-waits-must-be-bounded]).
    #[test]
    fn the_shipped_worker_leaves_on_day_one_and_stays_home_on_day_six() {
        let mut sim = Sim::new_from_shipped_lot();
        let content = sim.world().resource::<Content>().0;
        let day_ticks = content.tuning.day_ticks as u64;
        let worker = {
            let mut workers = sim
                .world_mut()
                .query_filtered::<Entity, (With<Agent>, With<Career>)>();
            workers
                .iter(sim.world())
                .next()
                .expect("the shipped household has an employed Sim")
        };
        let career = &content.careers[sim.world().get::<Career>(worker).unwrap().0 as usize];
        let (shift_start, pay) = (career.shift_start as u64, career.pay as i64);
        assert_eq!(today(&sim), 0, "day 1 is a Monday");

        let mut left_at = None;
        let mut paid_at = None;
        for tick in 1..day_ticks {
            sim.tick();
            if away(&sim, worker) {
                assert!(
                    tick >= shift_start,
                    "nobody leaves before the shift starts, tick {tick}"
                );
                left_at.get_or_insert(tick);
            }
            if sim.funds() == pay {
                paid_at.get_or_insert(tick);
            }
        }
        assert_eq!(clock(&sim), day_ticks - 1, "one tick per Sim::tick");
        assert!(left_at.is_some(), "the worker leaves for work during day 1");
        assert!(paid_at.is_some(), "and the shift pays before day 1 ends");

        for tick in day_ticks..5 * day_ticks {
            sim.tick();
            assert_eq!(clock(&sim), tick, "one tick per Sim::tick");
        }
        assert_eq!(today(&sim), 4, "the last tick before day 6 is a Friday");
        assert!(
            !away(&sim, worker),
            "Friday's shift is over before Saturday begins"
        );
        let funds = sim.funds();
        for tick in 5 * day_ticks..6 * day_ticks {
            sim.tick();
            assert_eq!(clock(&sim), tick, "one tick per Sim::tick");
            assert_eq!(today(&sim), 5, "tick {tick} is on Saturday");
            assert!(
                !away(&sim, worker),
                "the worker stays home on Saturday, tick {tick}"
            );
            assert_eq!(sim.funds(), funds, "nothing pays on Saturday, tick {tick}");
        }
    }

    #[test]
    fn a_visible_return_starts_at_the_boundary_plane_without_reversing_outward() {
        let pack = career_pack_with_portal();
        let mut sim = test_content::sim_with_portals(16, 12, pack);
        let worker = a_worker(&mut sim, 15.0, 2.0);
        sim.world_mut()
            .entity_mut(worker)
            .insert(AtWork { remaining_ticks: 2 });

        let samples = |sim: &Sim| {
            let buffer = sim.render_buffer();
            let row = buffer
                .ids
                .iter()
                .position(|id| *id == worker.index_u32())
                .expect("the hidden worker keeps its aligned render row");
            let offset = row * 2;
            (
                (
                    buffer.prev_positions[offset],
                    buffer.prev_positions[offset + 1],
                ),
                (buffer.positions[offset], buffer.positions[offset + 1]),
            )
        };

        sim.sync_render_buffer();
        sim.tick();
        sim.sync_render_buffer();
        assert_eq!(samples(&sim), ((15.5, 2.0), (15.5, 2.0)));

        sim.tick();
        sim.sync_render_buffer();
        assert!(sim.world().get::<AtWork>(worker).is_none());
        assert!(sim.world().get::<Commuting>(worker).is_some());
        assert_eq!(
            samples(&sim),
            ((15.5, 2.0), (15.5, 2.0)),
            "the first visible interval must not step outward and reverse"
        );
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
        // Ticks on which `decay_needs` SAW the worker at work, counted
        // rather than derived: decay runs before `start_shift` and
        // before `commute_and_work` in the schedule, so what matters is
        // the state at the top of the tick, and reading it here is the
        // only way to say that without restating the schedule.
        let mut scaled_ticks = 0.0f32;
        for tick in 1..=29u64 {
            if sim.world().get::<AtWork>(worker).is_some() {
                scaled_ticks += 1.0;
            }
            crate::test_content::disable_mood_satisfaction(&mut sim);
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
            2.25 * Satisfaction::REWARD_SCALE,
            "the career's satisfaction lands exactly once"
        );
        // Energy: 80 at spawn, minus 29 ticks of decay - the ones
        // spent at work scaled by `at_work_decay_scale` ([X2]) - minus
        // the 11.5 debit. Both the rate and the scale are read from
        // content per the standing rule rather than restated.
        let decay = test_content::decay_per_tick(NeedId::Energy);
        let scale = test_content::tuning().at_work_decay_scale;
        assert!(
            scaled_ticks > 0.0,
            "fixture is vacuous: the worker was never at work when decay ran"
        );
        let expected = 80.0 - (29.0 - scaled_ticks) * decay - scaled_ticks * decay * scale - 11.5;
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

    /// [L-cleanup-removes-only-what-it-owns]. The shipped household froze
    /// on this at tick 1799: Casey was mid-conversation with Tim, standing
    /// beside the toilet with her bladder low, when his shift started.
    ///
    /// A sim ALREADY TALKING to the worker carries `Target{worker}` too, so
    /// the approacher sweep took her Target and left her `Socialising`.
    /// Free of a Target she chose the toilet the same tick, and the
    /// conversation's cleanup then removed `Target` again - the NEW one.
    ///
    /// The same bug had two faces, and the fixture runs both. BESIDE the
    /// object she arrived that tick, so she was left `Eating` with no
    /// `Target`, which `tick_interactions` never counts down: she sat there
    /// for good, holding the only toilet. ACROSS THE ROOM she had only a
    /// `Path` by then, walked it as a stroll, and the toilet stayed
    /// reserved for somebody who was never coming.
    ///
    /// What is asserted is the general statement, and it holds whichever
    /// system carries the fix: nobody uses an object with no target, no
    /// object is reserved with nobody coming, and she gets what she went
    /// for.
    #[test]
    fn a_shift_start_ends_a_running_talk_without_stranding_the_talker() {
        for (toilet_at, ticks) in [((6.0, 6.0), 40u32), ((12.0, 9.0), 90u32)] {
            let base = test_content::pack_with_social(
                vec![test_content::object(
                    "toilet",
                    &[(NeedId::Bladder, 90.0)],
                    12,
                )],
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
            let toilet_def = pack.find("toilet").expect("fixture");
            let toilet = sim
                .world_mut()
                .spawn((
                    Position {
                        x: toilet_at.0,
                        y: toilet_at.1,
                    },
                    terri_core::SmartObject(toilet_def),
                ))
                .id();
            sim.world_mut().resource_mut::<TileGrid>().set_blocked(
                toilet_at.0 as usize,
                toilet_at.1 as usize,
                true,
            );

            let worker = a_worker(&mut sim, 5.0, 4.0);
            sim.world_mut().entity_mut(worker).insert(Reserved);
            // Desperate for the toilet, and two ticks into a talk with the
            // worker that has plenty left to run.
            let mut needs = Needs::all_at(80.0);
            needs.set(NeedId::Bladder, 5.0);
            let talker = sim
                .world_mut()
                .spawn((
                    Agent,
                    Position { x: 5.0, y: 6.0 },
                    needs,
                    Satisfaction::from_value(0.0),
                    Target {
                        object: worker,
                        interaction: 0,
                    },
                    Socialising {
                        interaction: 0,
                        partner: worker,
                        remaining_ticks: 25,
                    },
                ))
                .id();

            sim.tick();
            sim.tick();
            assert!(
                sim.world().get::<Socialising>(talker).is_some(),
                "before the shift the talk simply runs"
            );
            sim.tick(); // day-tick 3: the shift.

            assert!(
                sim.world().get::<Socialising>(talker).is_none(),
                "nobody talks to a sim who left for the office"
            );
            assert!(
                sim.world().get::<Reserved>(worker).is_none(),
                "the worker sheds the talk's claim and leaves"
            );

            let mut used_the_toilet = false;
            for tick in 0..ticks {
                sim.tick();
                let target = sim
                    .world()
                    .get::<Target>(talker)
                    .map(|target| target.object);
                if let Some(eating) = sim.world().get::<Eating>(talker).copied() {
                    assert_eq!(
                        target,
                        Some(toilet),
                        "{toilet_at:?} tick {tick}: using an object with no target never \
                         counts down ({eating:?})"
                    );
                    used_the_toilet = true;
                }
                if sim.world().get::<Reserved>(toilet).is_some() {
                    assert_eq!(
                        target,
                        Some(toilet),
                        "{toilet_at:?} tick {tick}: the toilet is reserved for nobody"
                    );
                }
            }
            assert!(
                used_the_toilet,
                "{toilet_at:?}: the fixture must reach the hazard"
            );
            assert!(
                sim.world().get::<Eating>(talker).is_none(),
                "{toilet_at:?}: a 12-tick interaction is over well inside the run"
            );
            assert!(
                sim.world().get::<Reserved>(toilet).is_none(),
                "{toilet_at:?}: and the toilet is free for the next person"
            );
            assert!(
                sim.world()
                    .get::<Needs>(talker)
                    .unwrap()
                    .get(NeedId::Bladder)
                    > 50.0,
                "{toilet_at:?}: she actually got what she went for"
            );
        }
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
    /// again. The career works Monday to Friday, and days 1 and 2 are
    /// Monday and Tuesday ([CAL-careers]).
    #[test]
    fn the_shift_fires_again_on_the_second_day() {
        let pack = pack_with_career(weekday_career(), vec![], thirty_tick_day());
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

    /// [CAL-careers], [CAL-evidence] 3: over one 30-tick week a Monday to
    /// Friday career leaves on days 0 to 4 at day-tick 3, the tick the
    /// schedule owns, pays five times, and on days 5 and 6 the worker is
    /// never commuting or at work on any tick. Without the gate it leaves
    /// seven times and is away on tick 153.
    #[test]
    fn a_weekday_career_pays_five_times_in_seven_days_and_rests_on_the_weekend() {
        let pack = pack_with_career(weekday_career(), vec![], thirty_tick_day());
        let mut sim = test_content::sim_with(16, 12, pack);
        let worker = a_worker(&mut sim, 15.0, 2.0);

        assert_eq!(
            departures(&mut sim, worker, 149),
            vec![3, 33, 63, 93, 123],
            "Monday to Friday each start one shift"
        );
        for tick in 150..=7 * 30u64 - 1 {
            sim.tick();
            assert_eq!(clock(&sim), tick, "one tick per Sim::tick");
            assert!(today(&sim) >= 5, "tick {tick} is on the weekend");
            assert!(
                !away(&sim, worker),
                "weekday {} is a rest day, but the worker was away on tick {tick}",
                today(&sim)
            );
        }
        assert_eq!(clock(&sim), 209);
        assert_eq!(
            sim.funds(),
            5 * weekday_career().pay as i64,
            "five working days, five pay packets"
        );
    }

    /// [CAL-evidence] 3: a career working only `sun` leaves on day 6 and
    /// day 13 of two weeks, and on no other day.
    #[test]
    fn a_sunday_only_career_pays_once_a_week() {
        let sunday = CompiledCareer {
            working_days: 0b1000000,
            ..a_career()
        };
        let pay = sunday.pay as i64;
        let pack = pack_with_career(sunday, vec![], thirty_tick_day());
        let mut sim = test_content::sim_with(16, 12, pack);
        let worker = a_worker(&mut sim, 15.0, 2.0);

        assert_eq!(
            departures(&mut sim, worker, 14 * 30),
            vec![6 * 30 + 3, 13 * 30 + 3],
            "one shift on each Sunday and none on any other day"
        );
        assert_eq!(sim.funds(), 2 * pay, "two weeks, two pay packets");
    }

    /// Review focus 1: a shift starting at day-tick 0 reads the weekday of
    /// the day that tick BEGINS, because `start_shift` runs after
    /// `advance_clock`. Tick 150 is Saturday's first tick and Friday's
    /// successor; tick 210 is Monday's first and Sunday's successor. A gate
    /// that read the previous tick's weekday leaves on 150 and not on 210.
    #[test]
    fn a_shift_at_midnight_respects_the_weekday_of_the_new_day() {
        let midnight = CompiledCareer {
            shift_start: 0,
            ..weekday_career()
        };
        let pack = pack_with_career(midnight, vec![], thirty_tick_day());
        let mut sim = test_content::sim_with(16, 12, pack);
        let worker = a_worker(&mut sim, 15.0, 2.0);

        // Tick 0 never runs a schedule, so Monday of the first week has
        // no midnight shift.
        assert_eq!(departures(&mut sim, worker, 149), vec![30, 60, 90, 120]);
        sim.tick();
        assert_eq!((clock(&sim), today(&sim)), (150, 5));
        assert!(!away(&sim, worker), "no departure on Saturday's first tick");
        assert_eq!(departures(&mut sim, worker, 209), Vec::<u64>::new());
        sim.tick();
        assert_eq!((clock(&sim), today(&sim)), (210, 0));
        assert!(away(&sim, worker), "the departure on Monday's first tick");
    }

    /// Review focus 2, [CAL-careers]: the gate decides only whether a shift
    /// STARTS. A Friday shift starting at day-tick 28 runs six ticks into
    /// Saturday, comes home and pays there, and no weekend shift follows.
    /// The pay tick is observed, not computed from the shift length
    /// ([L-career-tests-follow-events-not-guessed-ticks]).
    #[test]
    fn a_shift_running_into_the_weekend_still_pays() {
        let late = CompiledCareer {
            shift_start: 28,
            ..weekday_career()
        };
        let pay = late.pay as i64;
        let pack = pack_with_career(late, vec![], thirty_tick_day());
        let mut sim = test_content::sim_with(16, 12, pack);
        let worker = a_worker(&mut sim, 15.0, 2.0);

        assert_eq!(
            departures(&mut sim, worker, 149),
            vec![28, 58, 88, 118, 148]
        );
        assert!(
            away(&sim, worker),
            "Friday's shift is still running at Friday's last tick"
        );
        assert_eq!(sim.funds(), 4 * pay, "Friday's pay has not landed yet");

        let mut paid_on = None;
        let mut was_away = away(&sim, worker);
        for tick in 150..=209u64 {
            sim.tick();
            let is_away = away(&sim, worker);
            assert!(
                was_away || !is_away,
                "no departure on the weekend, tick {tick}"
            );
            was_away = is_away;
            if paid_on.is_none() && sim.funds() == 5 * pay {
                paid_on = Some((tick, today(&sim)));
            }
        }
        assert_eq!(clock(&sim), 209, "one tick per Sim::tick");
        let (tick, weekday) = paid_on.expect("Friday's shift must pay");
        assert_eq!(weekday, 5, "the pay on tick {tick} lands on Saturday");
        assert_eq!(sim.funds(), 5 * pay, "and nothing pays after it");
    }

    /// Review focus 3: a save written on Saturday with the worker walking
    /// home through the front door loads into a fresh world, both worlds
    /// agree tick for tick (for longer than the 70 ticks the plan names),
    /// and the next shift waits for Monday's start at tick 238.
    #[test]
    fn a_weekend_commute_loads_and_the_next_shift_waits_for_monday() {
        let late = CompiledCareer {
            shift_start: 28,
            ..weekday_career()
        };
        let pay = late.pay as i64;
        let pack = with_front_portal(
            pack_with_career(late, vec![], thirty_tick_day()),
            (15, 2),
            (15, 3),
        );
        // Loading draws a self-preservation instinct for every person
        // without one, and a hand-spawned worker has none, so the source
        // starts as a loaded world too. Otherwise the comparison below
        // would measure that one-time draw, not the weekend.
        let mut blank = test_content::sim_with_portals(16, 12, pack);
        let worker = a_worker(&mut blank, 15.0, 2.0);
        let mut source = test_content::sim_with_portals(16, 12, pack);
        assert_eq!(source.load_snapshot_v5(blank.save_snapshot_v5()), Ok(()));
        let worker = source.world().entities().resolve_from_index(worker.index());

        // The save point is the return itself: at work on one tick,
        // walking home the next. `Commuting` alone cannot mark it, because
        // Friday's OUTBOUND commute can still be walking on Saturday, and a
        // pay count cannot either, because it depends on where wandering
        // left the worker at each shift start. With the gate no Saturday
        // shift starts, so the first return on Saturday is Friday's.
        let mut saved_at = None;
        let mut was_at_work = false;
        for tick in 1..=179u64 {
            let funds_before = source.funds();
            source.tick();
            let at_work = source.world().get::<AtWork>(worker).is_some();
            if tick >= 150 && was_at_work && !at_work {
                assert!(
                    source.world().get::<Commuting>(worker).is_some(),
                    "the return walks home through the portal"
                );
                assert_eq!(source.funds(), funds_before + pay, "the return pays");
                saved_at = Some(tick);
                break;
            }
            was_at_work = at_work;
        }
        let saved_at = saved_at.expect("Friday's shift must return within Saturday");
        assert_eq!(clock(&source), saved_at, "one tick per Sim::tick");
        assert_eq!(today(&source), 5, "the walk home is on Saturday");
        let funds_at_save = source.funds();

        let mut restored = test_content::sim_with_portals(16, 12, pack);
        assert_eq!(restored.load_snapshot_v5(source.save_snapshot_v5()), Ok(()));
        assert!(restored.world().get::<Commuting>(worker).is_some());
        assert_eq!(clock(&restored), saved_at);

        // Monday's shift starts two ticks before Monday ends, so the walk to
        // the door finishes on Tuesday; one whole day after the start is
        // the outer bound for clocking in on this open 16x12 lot.
        let monday_shift = 7 * 30 + 28;
        let last = monday_shift + 30;
        assert!(saved_at + 70 < monday_shift);
        let mut clocked_in = None;
        for tick in saved_at + 1..=last {
            source.tick();
            restored.tick();
            assert_eq!(
                restored.world_hash(),
                source.world_hash(),
                "the loaded world diverged on tick {tick}"
            );
            assert_eq!(
                restored.save_snapshot_v5(),
                source.save_snapshot_v5(),
                "the loaded world's saved state diverged on tick {tick}"
            );
            let at_work = restored.world().get::<AtWork>(worker).is_some();
            if tick < monday_shift {
                assert!(!at_work, "no shift before Monday's start, tick {tick}");
                assert_eq!(
                    restored.funds(),
                    funds_at_save,
                    "loading the walk home cannot pay again, and no weekend \
                     shift pays, tick {tick}"
                );
            }
            if tick == monday_shift - 1 {
                assert!(
                    !away(&restored, worker),
                    "the walk home finished over the weekend"
                );
            }
            if tick == monday_shift {
                assert!(away(&restored, worker), "Monday's shift starts on time");
            }
            if at_work && clocked_in.is_none() {
                clocked_in = Some(tick);
            }
        }
        assert_eq!(clock(&restored), last, "one tick per Sim::tick");
        assert!(
            clocked_in.is_some_and(|tick| tick >= monday_shift),
            "the worker clocks in only once Monday's shift has started: {clocked_in:?}"
        );
    }

    /// Review focus 4: with `first_weekday` 6, day one (day index 0) is a
    /// Sunday, so a Monday to Friday career first leaves on day two (day
    /// index 1) at tick 33.
    #[test]
    fn first_weekday_six_moves_the_first_shift_to_day_two() {
        let pack = pack_with_career(
            weekday_career(),
            vec![],
            terri_data::Tuning {
                first_weekday: 6,
                ..thirty_tick_day()
            },
        );
        let mut sim = test_content::sim_with(16, 12, pack);
        let worker = a_worker(&mut sim, 15.0, 2.0);

        assert_eq!(departures(&mut sim, worker, 59), vec![33]);
        assert_eq!(sim.funds(), weekday_career().pay as i64);
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
