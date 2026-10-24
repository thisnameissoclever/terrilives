//! Scheduled shifts and actual attendance for player-directed work interruptions.
use crate::{careers::Careers, Content};
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;
use terri_core::save_v17::{SavedAttendance, SavedScheduledShift, SavedShiftOutcome};
use terri_core::{
    Agent, AtWork, Career, Commuting, FnvHasher, Funds, NeedId, Needs, Path, Position, SimClock,
    SimId, TileGrid,
};

#[derive(Resource, Clone, Debug, Default, PartialEq)]
pub struct Attendance {
    pub shifts: BTreeMap<SimId, SavedScheduledShift>,
    pub outcomes: Vec<SavedShiftOutcome>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WorkConflict {
    pub agent: u32,
    pub sim: u32,
    /// 1: due at home, 2: outbound, 3: working, 4: returning.
    pub phase: u8,
    pub start_tick: u64,
    pub end_tick: u64,
    pub remaining_minutes: f32,
    pub total_minutes: f32,
    pub pay_cents: i64,
}
#[derive(Clone, Debug, PartialEq)]
pub struct WorkPreflight {
    pub fingerprint: u64,
    pub conflicts: Vec<WorkConflict>,
}

fn identity(world: &World, actor: Entity) -> SimId {
    world
        .get::<SimId>(actor)
        .copied()
        .unwrap_or(SimId(actor.index_u32()))
}
fn ensure(world: &mut World) {
    if !world.contains_resource::<Attendance>() {
        world.insert_resource(Attendance::default());
    }
}
fn entity_of(world: &mut World, sim: SimId) -> Option<Entity> {
    world
        .query_filtered::<Entity, With<Agent>>()
        .iter(world)
        .find(|e| identity(world, *e) == sim)
}

/// One token covers all participants and is checked again when input applies.
pub fn work_conflicts(world: &World, agents: &[u32]) -> WorkPreflight {
    let now = world.resource::<SimClock>().tick;
    let pack = world.resource::<Content>().0;
    let mut hash = FnvHasher::default();
    hash.write_u64(now);
    let mut agents = agents.to_vec();
    agents.sort_unstable();
    agents.dedup();
    let mut conflicts = Vec::new();
    for agent in agents {
        hash.write_u64(u64::from(agent));
        let Some(actor) = crate::family::sim_id_at(world, agent)
            .and_then(|id| crate::edit::living_entity(world, id))
        else {
            continue;
        };
        let sim = identity(world, actor);
        hash.write_u64(u64::from(sim.0));
        let Some(career) = world.get::<Career>(actor) else {
            continue;
        };
        hash.write_u64(u64::from(career.0));
        let job = &pack.careers[career.0 as usize];
        // [WS-systems] item 2: the hours are those of the shift worked
        // today, the held shift except on the day of a shift change.
        let shift = crate::shifts::shift_today(world, pack, actor, now).expect("employed");
        let saved = world
            .get_resource::<Attendance>()
            .and_then(|a| a.shifts.get(&sim))
            .filter(|s| !s.settled && s.end_tick > now);
        let due_now = crate::shifts::starts_at(world, &pack.tuning, sim, &shift, now);
        let away = world.get::<AtWork>(actor).is_some()
            || world.get::<Commuting>(actor) == Some(&Commuting::Outbound);
        if saved.is_none() && !due_now && !away {
            continue;
        }
        let start_tick = saved.map_or(now, |s| s.start_tick);
        let end_tick = saved.map_or(now + u64::from(shift.shift_ticks), |s| s.end_tick);
        let phase = if world.get::<AtWork>(actor).is_some() {
            3
        } else {
            match world.get::<Commuting>(actor) {
                Some(Commuting::Outbound) => 2,
                Some(Commuting::Inbound) => 4,
                None => 1,
            }
        };
        let pay_cents = saved.map_or_else(
            || {
                world
                    .get_resource::<Careers>()
                    .and_then(|c| c.record(sim))
                    .map_or(job.pay, |r| r.pay) as i64
                    * Funds::CENTS_PER_DOLLAR
            },
            |s| s.pay_cents,
        );
        for n in [
            start_tick,
            end_tick,
            saved.map_or(0, |s| s.worked_ticks),
            pay_cents as u64,
        ] {
            hash.write_u64(n);
        }
        conflicts.push(WorkConflict {
            agent,
            sim: sim.0,
            phase,
            start_tick,
            end_tick,
            remaining_minutes: (end_tick - now) as f32,
            total_minutes: (end_tick - start_tick) as f32,
            pay_cents,
        });
    }
    WorkPreflight {
        fingerprint: hash.finish(),
        conflicts,
    }
}

/// The accepted order returns a worker along the same route as a shift ending.
pub(crate) fn interrupt_for_order(world: &mut World, actor: Entity) {
    account_and_settle(world);
    if world.get::<AtWork>(actor).is_some()
        || world.get::<Commuting>(actor) == Some(&Commuting::Outbound)
    {
        return_home(world, actor);
    }
}

fn return_home(world: &mut World, actor: Entity) {
    let Some(position) = world.get::<Position>(actor).copied() else {
        return;
    };
    let pack = world.resource::<Content>().0;
    let origin = world
        .get_resource::<crate::lot_frame::LotFrame>()
        .map_or((0, 0), |f| f.origin);
    let portal =
        crate::portals::front_portal(pack).map(|p| crate::lot_frame::shift_portal(p, origin));
    let steps = portal.map(|p| {
        let landing = (p.inward.0 as i32, p.inward.1 as i32);
        let grid = world.resource::<TileGrid>();
        grid.find_path(
            (position.x.round() as i32, position.y.round() as i32),
            landing,
        )
        .and_then(|p| grid.anchor_path((position.x, position.y), p))
        .unwrap_or_else(|| vec![landing])
    });
    world
        .entity_mut(actor)
        .remove::<AtWork>()
        .remove::<Path>()
        .remove::<Commuting>();
    if let Some(steps) = steps {
        world
            .entity_mut(actor)
            .insert((Commuting::Inbound, Path { steps, cursor: 0 }));
    }
}

/// Accrue each elapsed office interval once, then settle at its original end.
pub(crate) fn account_and_settle(world: &mut World) {
    ensure(world);
    let now = world.resource::<SimClock>().tick;
    let ids: Vec<SimId> = world
        .resource::<Attendance>()
        .shifts
        .keys()
        .copied()
        .collect();
    for sim in ids {
        let Some(actor) = entity_of(world, sim) else {
            world.resource_mut::<Attendance>().shifts.remove(&sim);
            continue;
        };
        let working = world.get::<AtWork>(actor).is_some();
        let expired = {
            let mut attendance = world.resource_mut::<Attendance>();
            let shift = attendance.shifts.get_mut(&sim).unwrap();
            if shift.settled {
                continue;
            }
            let until = now.min(shift.end_tick);
            if working {
                shift.worked_ticks += until.saturating_sub(shift.accounted_tick);
            }
            shift.accounted_tick = until;
            now >= shift.end_tick
        };
        if expired {
            settle(world, actor, sim, Scoring::Week);
        }
    }
}
/// Whether a settled shift's score joins the week the person is reviewed
/// on.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Scoring {
    Week,
    /// Issue 296, [WS-select] item 3: a shift a shift change cuts short is
    /// forfeited. Pay, energy and reward follow the minutes worked, but the
    /// score stays out of the week, because the change costs only the
    /// good-week streak.
    Forfeit,
}
/// A successful job change settles the old scheduled obligation before replacing it.
pub(crate) fn close_for_career_change(world: &mut World, actor: Entity) {
    close_open_shift(world, actor, Scoring::Week);
}
/// A successful shift change settles the open scheduled shift as a job
/// change does, without scoring it into the week.
pub(crate) fn close_for_shift_change(world: &mut World, actor: Entity) {
    close_open_shift(world, actor, Scoring::Forfeit);
}
fn close_open_shift(world: &mut World, actor: Entity, scoring: Scoring) {
    account_and_settle(world);
    let sim = identity(world, actor);
    if world
        .get_resource::<Attendance>()
        .and_then(|a| a.shifts.get(&sim))
        .is_some_and(|s| !s.settled)
    {
        settle(world, actor, sim, scoring);
    }
}
fn settle(world: &mut World, actor: Entity, sim: SimId, scoring: Scoring) {
    let shift = {
        let mut attendance = world.resource_mut::<Attendance>();
        let shift = attendance.shifts.get_mut(&sim).unwrap();
        if shift.settled {
            return;
        }
        shift.settled = true;
        shift.clone()
    };
    let pack = world.resource::<Content>().0;
    let job = &pack.careers[shift.career as usize];
    let scheduled = shift.end_tick - shift.start_tick;
    let ratio = shift.worked_ticks as f32 / scheduled as f32;
    if let Some(mut needs) = world.get_mut::<Needs>(actor) {
        needs.drain(NeedId::Energy, job.energy_cost * ratio);
    }
    if world.get::<AtWork>(actor).is_some()
        || world.get::<Commuting>(actor) == Some(&Commuting::Outbound)
    {
        return_home(world, actor);
    }
    // Mood reads live needs and room context, as the original return did.
    let base = crate::careers::shift_score(
        crate::careers::fit(world, pack, job, actor),
        crate::careers::mastery(world, pack, job, actor),
        crate::careers::mood_term(world, actor),
    );
    let (pay, deduction, score) = settlement(
        shift.pay_cents,
        scheduled,
        shift.worked_ticks,
        base,
        pack.tuning.day_ticks,
    );
    let outcome = SavedShiftOutcome {
        sim: sim.0,
        career: shift.career,
        start_tick: shift.start_tick,
        end_tick: shift.end_tick,
        scheduled_minutes: scheduled as f32,
        worked_minutes: shift.worked_ticks as f32,
        missed_minutes: (scheduled - shift.worked_ticks) as f32,
        base_score: base,
        deduction,
        score,
        pay_cents: pay,
    };
    let reason = format!("Scheduled {:.1} min; worked {:.1} min; missed {:.1} min; base {:.2}; attendance deduction {:.2}; score {:.2}; pay {} cents", outcome.scheduled_minutes,outcome.worked_minutes,outcome.missed_minutes,outcome.base_score,outcome.deduction,outcome.score,outcome.pay_cents);
    world.resource_mut::<Attendance>().outcomes.push(outcome);
    crate::player_actions::record_work_outcome(world, actor, &reason);
    crate::careers::complete_attended_shift(
        world,
        actor,
        shift.career,
        pay,
        ratio,
        (scoring == Scoring::Week).then_some(score),
        crate::careers::week_of(shift.start_tick, pack.tuning.day_ticks),
    );
    world
        .entity_mut(actor)
        .remove::<crate::reading::PendingShift>();
}

pub(crate) fn start_tick(world: &mut World) {
    account_and_settle(world);
    let now = world.resource::<SimClock>().tick;
    let pack = world.resource::<Content>().0;
    let mut actors: Vec<Entity> = world
        .query_filtered::<Entity, (With<Agent>, With<Career>)>()
        .iter(world)
        .collect();
    actors.sort_by_key(|e| identity(world, *e));
    for actor in actors {
        let sim = identity(world, actor);
        let career = world.get::<Career>(actor).unwrap().0;
        let job = &pack.careers[career as usize];
        // [WS-systems] item 1: a due shift is the held shift, or on the day
        // of a shift change the one held when the day began.
        let shift = crate::shifts::shift_today(world, pack, actor, now).expect("employed");
        let starts = crate::shifts::starts_at(world, &pack.tuning, sim, &shift, now);
        let untracked_legacy_work = world.get::<AtWork>(actor).is_some()
            && !world.resource::<Attendance>().shifts.contains_key(&sim);
        if starts
            && !untracked_legacy_work
            && world
                .resource::<Attendance>()
                .shifts
                .get(&sim)
                .is_none_or(|s| s.start_tick != now)
        {
            let pay = world
                .get_resource::<Careers>()
                .and_then(|c| c.record(sim))
                .map_or(job.pay, |r| r.pay);
            world.resource_mut::<Attendance>().shifts.insert(
                sim,
                SavedScheduledShift {
                    sim: sim.0,
                    career,
                    start_tick: now,
                    end_tick: now + u64::from(shift.shift_ticks),
                    worked_ticks: 0,
                    accounted_tick: now,
                    pay_cents: i64::from(pay) * Funds::CENTS_PER_DOLLAR,
                    settled: false,
                    legacy: false,
                },
            );
        }
        let active = world
            .resource::<Attendance>()
            .shifts
            .get(&sim)
            .is_some_and(|s| !s.settled && s.career == career && s.end_tick > now);
        if !active
            || world.get::<AtWork>(actor).is_some()
            || world.get::<Commuting>(actor).is_some()
            || crate::player_actions::has_player_work(world, actor)
        {
            continue;
        }
        if world.get::<crate::reading::ReadingJourney>(actor).is_some() {
            crate::reading::request_return(world, actor);
            continue;
        }
        depart(world, actor);
    }
}
fn depart(world: &mut World, actor: Entity) {
    let pack = world.resource::<Content>().0;
    let origin = world
        .get_resource::<crate::lot_frame::LotFrame>()
        .map_or((0, 0), |f| f.origin);
    let Some(door) = pack
        .lot
        .front_door
        .map(|(x, y)| (x + origin.0, y + origin.1))
    else {
        return;
    };
    let Some(position) = world.get::<Position>(actor).copied() else {
        return;
    };
    let grid = world.resource::<TileGrid>();
    let from = if grid.blocked_edges().next().is_some() {
        (position.x.round() as i32, position.y.round() as i32)
    } else {
        (position.x as i32, position.y as i32)
    };
    let route = |to: (u32, u32)| {
        grid.find_path(from, (to.0 as i32, to.1 as i32))
            .and_then(|p| grid.anchor_path((position.x, position.y), p))
    };
    let Some(steps) = crate::portals::street_exit_at(pack, origin, grid.width() as u32)
        .and_then(route)
        .or_else(|| route(door))
    else {
        return;
    };
    crate::recipe_actions::suspend(world, actor);
    if let Some(target) = world.get::<terri_core::Target>(actor).copied() {
        crate::reservations::release_now(world, actor, target);
    }
    let approachers: Vec<Entity> = world
        .query::<(Entity, &terri_core::Target)>()
        .iter(world)
        .filter(|(other, target)| {
            *other != actor
                && target.object == actor
                && world.get::<Commuting>(*other).is_none()
                && !crate::player_actions::has_player_work(world, *other)
        })
        .map(|(other, _)| other)
        .collect();
    for other in approachers {
        world
            .entity_mut(other)
            .remove::<terri_core::Target>()
            .remove::<Path>();
    }
    world
        .entity_mut(actor)
        .remove::<terri_core::Target>()
        .remove::<Path>()
        .remove::<terri_core::Eating>()
        .remove::<terri_core::Socialising>()
        .remove::<terri_core::ConversationVoice>()
        .remove::<terri_core::StepWork>()
        .remove::<terri_core::Fumbled>()
        .remove::<terri_core::Reserved>()
        .remove::<crate::reading::PendingShift>()
        .insert((Commuting::Outbound, Path { steps, cursor: 0 }));
}

pub(crate) fn finish_tick(world: &mut World) {
    account_and_settle(world);
    let now = world.resource::<SimClock>().tick;
    let mut actors: Vec<Entity> = world
        .query_filtered::<Entity, (With<Agent>, Or<(With<Commuting>, With<AtWork>)>)>()
        .iter(world)
        .collect();
    actors.sort_by_key(|e| identity(world, *e));
    for actor in actors {
        if world.get::<Commuting>(actor) == Some(&Commuting::Inbound) {
            if world.get::<Path>(actor).is_none() {
                world.entity_mut(actor).remove::<Commuting>();
                if !has_open_shift(world, actor) {
                    crate::careers::settle_due_review(world, actor);
                }
            }
            continue;
        }
        let sim = identity(world, actor);
        let shift = world
            .resource::<Attendance>()
            .shifts
            .get(&sim)
            .filter(|s| !s.settled)
            .cloned();
        if let Some(shift) = shift {
            if world.get::<Commuting>(actor) == Some(&Commuting::Outbound)
                && world.get::<Path>(actor).is_none()
            {
                world
                    .entity_mut(actor)
                    .remove::<Commuting>()
                    .insert(AtWork {
                        remaining_ticks: (shift.end_tick - now) as u32,
                    });
            } else if let Some(mut work) = world.get_mut::<AtWork>(actor) {
                work.remaining_ticks = (shift.end_tick - now) as u32;
            }
        } else if world.get::<Career>(actor).is_none() {
            continue;
        } else if world.get::<Commuting>(actor) == Some(&Commuting::Outbound)
            && world.get::<Path>(actor).is_none()
        {
            let ticks = crate::shifts::shift_of(world, world.resource::<Content>().0, actor)
                .expect("employed")
                .shift_ticks;
            world
                .entity_mut(actor)
                .remove::<Commuting>()
                .insert(AtWork {
                    remaining_ticks: ticks,
                });
        } else if let Some(mut work) = world.get_mut::<AtWork>(actor) {
            // Pre-schema-fifteen and hand-built workers finish their saved countdown.
            work.remaining_ticks = work.remaining_ticks.saturating_sub(1);
            if work.remaining_ticks == 0 {
                let energy = world
                    .get::<Career>(actor)
                    .and_then(|c| world.resource::<Content>().0.careers.get(c.0 as usize))
                    .map(|c| c.energy_cost);
                if let Some(cost) = energy {
                    if let Some(mut needs) = world.get_mut::<Needs>(actor) {
                        needs.drain(NeedId::Energy, cost);
                    }
                }
                return_home(world, actor);
                crate::careers::complete_shift(world, actor);
            }
        }
    }
}
pub(crate) fn has_open_shift(world: &World, actor: Entity) -> bool {
    world
        .get_resource::<Attendance>()
        .and_then(|a| a.shifts.get(&identity(world, actor)))
        .is_some_and(|s| !s.settled)
}
pub(crate) fn scheduled_week(world: &World, actor: Entity) -> Option<u64> {
    world
        .get_resource::<Attendance>()
        .and_then(|a| a.shifts.get(&identity(world, actor)))
        .filter(|s| !s.settled)
        .map(|s| {
            crate::careers::week_of(s.start_tick, world.resource::<Content>().0.tuning.day_ticks)
        })
}
pub fn to_saved(world: &World) -> SavedAttendance {
    world
        .get_resource::<Attendance>()
        .map_or_else(SavedAttendance::default, |a| SavedAttendance {
            shifts: a.shifts.values().cloned().collect(),
            outcomes: a.outcomes.clone(),
        })
}
pub fn restore(world: &mut World, saved: SavedAttendance) {
    world.insert_resource(Attendance {
        shifts: saved
            .shifts
            .into_iter()
            .map(|s| (SimId(s.sim), s))
            .collect(),
        outcomes: saved.outcomes,
    });
}
pub fn hash(world: &World, hash: &mut FnvHasher) {
    let Some(a) = world.get_resource::<Attendance>() else {
        return;
    };
    if a.shifts.is_empty() && a.outcomes.is_empty() {
        return;
    }
    hash.write_bytes(b"attendance15");
    hash.write_u64(a.shifts.len() as u64);
    for s in a.shifts.values() {
        for n in [
            u64::from(s.sim),
            u64::from(s.career),
            s.start_tick,
            s.end_tick,
            s.worked_ticks,
            s.accounted_tick,
            s.pay_cents as u64,
            u64::from(s.settled),
            u64::from(s.legacy),
        ] {
            hash.write_u64(n)
        }
    }
    hash.write_u64(a.outcomes.len() as u64);
    for s in &a.outcomes {
        for n in [
            u64::from(s.sim),
            u64::from(s.career),
            s.start_tick,
            s.end_tick,
            s.pay_cents as u64,
        ] {
            hash.write_u64(n)
        }
        for n in [
            s.scheduled_minutes,
            s.worked_minutes,
            s.missed_minutes,
            s.base_score,
            s.deduction,
            s.score,
        ] {
            hash.write_u64(u64::from(n.to_bits()))
        }
    }
}
/// Latest settled attendance, or the running shift's minutes, at the job
/// the person holds now; no settlement is triggered. A shift of a job they
/// left, or of the level they held before a promotion or demotion, is not
/// reported, so the Career tab never shows an old job's pay under a new
/// title.
pub fn report(world: &World, actor: Entity) -> Vec<f32> {
    let sim = identity(world, actor);
    let Some(a) = world.get_resource::<Attendance>() else {
        return Vec::new();
    };
    let Some(career) = world.get::<Career>(actor).map(|career| career.0) else {
        return Vec::new();
    };
    if let Some(s) = a
        .shifts
        .get(&sim)
        .filter(|s| !s.settled && s.career == career)
    {
        let total = (s.end_tick - s.start_tick) as f32;
        return vec![
            total,
            s.worked_ticks as f32,
            s.accounted_tick
                .saturating_sub(s.start_tick)
                .saturating_sub(s.worked_ticks) as f32,
            -1.0,
            0.0,
            -1.0,
            0.0,
            0.0,
        ];
    }
    a.outcomes
        .iter()
        .rev()
        .find(|s| s.sim == sim.0)
        .filter(|s| s.career == career)
        .map(|s| {
            vec![
                s.scheduled_minutes,
                s.worked_minutes,
                s.missed_minutes,
                s.base_score,
                s.deduction,
                s.score,
                s.pay_cents as f32,
                1.0,
            ]
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use terri_core::{CommandQueue, IntentQueue, Satisfaction, SimCommand, SmartObject};
    fn fixture(start: u32) -> (crate::Sim, Entity, Entity) {
        let base = crate::test_content::pack(vec![crate::test_content::object(
            "long_action",
            &[(NeedId::Fun, 10.0)],
            1000,
        )]);
        let mut job = terri_data::pack().careers[0].clone();
        job.shift_start = start;
        job.shift_ticks = 480;
        job.pay = 130;
        job.pay_max = 200;
        job.working_days = 0b1111111;
        let pack = Box::leak(Box::new(terri_data::ContentPack {
            careers: vec![job],
            portals: vec![terri_data::CompiledPortal {
                position: (15, 2),
                inward: (15, 3),
                facing: terri_data::CompiledSocketFacing::PositiveX,
                hinge: terri_data::CompiledPortalHinge::Left,
                frame_sprite: 41,
                closed_sprite: 42,
                ajar_sprite: 43,
                open_sprite: 44,
            }],
            ..base.clone()
        }));
        let mut sim = crate::test_content::sim_with(16, 12, pack);
        let actor = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(1),
                Position { x: 15.0, y: 2.0 },
                Needs::all_at(80.0),
                Career(0),
                IntentQueue::default(),
                Satisfaction::from_value(0.0),
            ))
            .id();
        let object = sim
            .world_mut()
            .spawn((
                SmartObject(terri_core::ObjectDefId(0)),
                Position { x: 14.0, y: 2.0 },
            ))
            .id();
        (sim, actor, object)
    }
    fn command(sim: &mut crate::Sim, command: SimCommand) {
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
        sim.flush_commands();
    }
    fn time(sim: &mut crate::Sim, tick: u64) {
        sim.world_mut().resource_mut::<SimClock>().tick = tick;
    }
    fn arrive(sim: &mut crate::Sim, actor: Entity) {
        sim.world_mut().entity_mut(actor).remove::<Path>();
        finish_tick(sim.world_mut());
    }
    #[test]
    fn attendance_public_orders_defer_interrupt_and_resume_only_original_shift() {
        let (mut sim, actor, object) = fixture(60);
        command(
            &mut sim,
            SimCommand::UseObject {
                agent: actor.index_u32(),
                object: object.index_u32(),
                interaction: 0,
            },
        );
        time(&mut sim, 60);
        start_tick(sim.world_mut());
        assert!(
            sim.world().get::<Commuting>(actor).is_none(),
            "accepted work keeps the worker home"
        );
        assert_eq!(
            sim.world().resource::<Attendance>().shifts[&SimId(1)].end_tick,
            540
        );
        command(
            &mut sim,
            SimCommand::CancelIntents {
                agent: actor.index_u32(),
            },
        );
        time(&mut sim, 180);
        start_tick(sim.world_mut());
        arrive(&mut sim, actor);
        assert!(sim.world().get::<AtWork>(actor).is_some());
        time(&mut sim, 240);
        account_and_settle(sim.world_mut());
        command(
            &mut sim,
            SimCommand::UseObject {
                agent: actor.index_u32(),
                object: object.index_u32(),
                interaction: 0,
            },
        );
        assert_eq!(
            sim.world().get::<Commuting>(actor),
            Some(&Commuting::Inbound)
        );
        assert_eq!(sim.funds(), 0, "an interrupted shift has not settled");
        command(
            &mut sim,
            SimCommand::CancelIntents {
                agent: actor.index_u32(),
            },
        );
        arrive(&mut sim, actor);
        time(&mut sim, 300);
        start_tick(sim.world_mut());
        arrive(&mut sim, actor);
        time(&mut sim, 540);
        account_and_settle(sim.world_mut());
        assert_eq!(sim.funds(), 8125, "300 of 480 minutes paid in cents");
        assert_eq!(sim.world().resource::<Attendance>().outcomes.len(), 1);
        let out = &sim.world().resource::<Attendance>().outcomes[0];
        assert_eq!(out.worked_minutes, 300.0);
        assert_eq!(out.missed_minutes, 180.0);
        assert_eq!(out.deduction, 10.0);
        account_and_settle(sim.world_mut());
        finish_tick(sim.world_mut());
        assert_eq!(
            sim.funds(),
            8125,
            "settlement is once even on repeated maintenance"
        );
        assert_eq!(sim.world().resource::<Attendance>().outcomes.len(), 1);
    }
    #[test]
    fn attendance_repeated_orders_prorate_energy_and_rewards_once() {
        let (mut sim, actor, object) = fixture(60);
        time(&mut sim, 60);
        start_tick(sim.world_mut());
        arrive(&mut sim, actor);
        for (stop, resume) in [(120, 180), (240, 300)] {
            time(&mut sim, stop);
            command(
                &mut sim,
                SimCommand::UseObject {
                    agent: actor.index_u32(),
                    object: object.index_u32(),
                    interaction: 0,
                },
            );
            assert_eq!(
                sim.world().get::<Commuting>(actor),
                Some(&Commuting::Inbound)
            );
            command(
                &mut sim,
                SimCommand::CancelIntents {
                    agent: actor.index_u32(),
                },
            );
            arrive(&mut sim, actor);
            time(&mut sim, resume);
            start_tick(sim.world_mut());
            arrive(&mut sim, actor);
        }
        time(&mut sim, 540);
        account_and_settle(sim.world_mut());
        let job = &sim.world().resource::<Content>().0.careers[0];
        assert_eq!(sim.funds(), 9750);
        assert!(
            (sim.world().get::<Needs>(actor).unwrap().get(NeedId::Energy)
                - (80.0 - job.energy_cost * 0.75))
                .abs()
                < 0.001
        );
        assert!(
            (sim.world().get::<Satisfaction>(actor).unwrap().value()
                - job.satisfaction * 0.75 * Satisfaction::REWARD_SCALE)
                .abs()
                < 0.0000001,
            "authored career rewards convert to long-term satisfaction points"
        );
        let paid_energy = sim.world().get::<Needs>(actor).unwrap().get(NeedId::Energy);
        let paid_satisfaction = sim.world().get::<Satisfaction>(actor).unwrap().value();
        account_and_settle(sim.world_mut());
        finish_tick(sim.world_mut());
        assert_eq!(
            sim.world().get::<Needs>(actor).unwrap().get(NeedId::Energy),
            paid_energy
        );
        assert_eq!(
            sim.world().get::<Satisfaction>(actor).unwrap().value(),
            paid_satisfaction
        );
        assert_eq!(
            sim.world().resource::<Attendance>().outcomes[0].deduction,
            0.0
        );
        assert_eq!(sim.world().resource::<Attendance>().outcomes.len(), 1);
        assert_eq!(
            sim.world().resource::<Attendance>().shifts[&SimId(1)].end_tick,
            540
        );
    }
    #[test]
    fn attendance_successful_quit_settles_earned_pay_but_rejected_assignment_changes_nothing() {
        let (mut sim, actor, object) = fixture(60);
        time(&mut sim, 60);
        start_tick(sim.world_mut());
        arrive(&mut sim, actor);
        time(&mut sim, 180);
        command(
            &mut sim,
            SimCommand::UseObject {
                agent: actor.index_u32(),
                object: object.index_u32(),
                interaction: 0,
            },
        );
        arrive(&mut sim, actor);
        let before = to_saved(sim.world());
        command(
            &mut sim,
            SimCommand::AssignCareer {
                agent: actor.index_u32(),
                path: u32::MAX,
            },
        );
        assert_eq!(to_saved(sim.world()), before);
        command(
            &mut sim,
            SimCommand::QuitCareer {
                agent: actor.index_u32(),
            },
        );
        assert!(sim.world().get::<Career>(actor).is_none());
        assert_eq!(sim.funds(), 3250);
        assert_eq!(sim.world().resource::<Attendance>().outcomes.len(), 1);
        assert!(sim.world().resource::<Careers>().record(SimId(1)).is_none());
        assert_eq!(validate_saved(sim.world(), &to_saved(sim.world())), Ok(()));
        time(&mut sim, 540);
        account_and_settle(sim.world_mut());
        assert_eq!(sim.funds(), 3250);
    }
    #[test]
    fn attendance_no_show_has_zero_pay_score_and_reward() {
        let (mut sim, actor, object) = fixture(60);
        command(
            &mut sim,
            SimCommand::UseObject {
                agent: actor.index_u32(),
                object: object.index_u32(),
                interaction: 0,
            },
        );
        time(&mut sim, 60);
        start_tick(sim.world_mut());
        time(&mut sim, 540);
        account_and_settle(sim.world_mut());
        let out = &sim.world().resource::<Attendance>().outcomes[0];
        assert_eq!(
            (out.pay_cents, out.score, out.worked_minutes),
            (0, 0.0, 0.0)
        );
        assert_eq!(sim.world().get::<Satisfaction>(actor).unwrap().value(), 0.0);
        assert_eq!(
            sim.world()
                .resource::<Careers>()
                .record(SimId(1))
                .unwrap()
                .shifts,
            vec![0.0]
        );
    }
    #[test]
    fn attendance_overnight_is_scored_in_scheduled_week() {
        let (mut sim, actor, _) = fixture(1380);
        let start = 6 * 1440 + 1380;
        time(&mut sim, start);
        start_tick(sim.world_mut());
        arrive(&mut sim, actor);
        time(&mut sim, start + 480);
        account_and_settle(sim.world_mut());
        let record = sim.world().resource::<Careers>().record(SimId(1)).unwrap();
        assert_eq!(record.history.len(), 1);
        assert_eq!(record.history[0].week, 0);
        assert!(record.shifts.is_empty());
        assert_eq!(sim.funds(), 13000);
    }
    #[test]
    fn attendance_preflight_is_read_only_multi_person_and_tokens_expire() {
        let (mut sim, actor, _) = fixture(60);
        let other = sim
            .world_mut()
            .spawn((
                Agent,
                SimId(2),
                Position { x: 15.0, y: 2.0 },
                Needs::all_at(80.0),
                Career(0),
            ))
            .id();
        time(&mut sim, 60);
        start_tick(sim.world_mut());
        let saved = to_saved(sim.world());
        let request = work_conflicts(
            sim.world(),
            &[actor.index_u32(), other.index_u32(), actor.index_u32()],
        );
        assert_eq!(request.conflicts.len(), 2);
        assert_eq!(to_saved(sim.world()), saved);
        assert_eq!(request.conflicts[0].total_minutes, 480.0);
        time(&mut sim, 61);
        assert_ne!(
            request.fingerprint,
            work_conflicts(sim.world(), &[actor.index_u32(), other.index_u32()]).fingerprint
        );
    }
    #[test]
    fn attendance_two_confirmed_orders_in_one_frame_both_apply() {
        let (mut sim, actor, object) = fixture(60);
        time(&mut sim, 60);
        start_tick(sim.world_mut());
        arrive(&mut sim, actor);
        let fingerprint = work_conflicts(sim.world(), &[actor.index_u32()]).fingerprint;
        let order = SimCommand::UseObject {
            agent: actor.index_u32(),
            object: object.index_u32(),
            interaction: 0,
        }
        .into_player_order()
        .unwrap();
        for _ in 0..2 {
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::ConfirmedOrder {
                    fingerprint,
                    command: order.clone(),
                });
        }
        sim.flush_commands();
        assert_eq!(
            sim.world().get::<IntentQueue>(actor).unwrap().len(),
            2,
            "both intentional repeated orders survive one frame"
        );
        assert_eq!(
            work_conflicts(sim.world(), &[actor.index_u32()]).fingerprint,
            fingerprint,
            "normal return does not change the approved shift"
        );
        assert_eq!(
            sim.world().get::<Commuting>(actor),
            Some(&Commuting::Inbound)
        );
    }
    #[test]
    fn attendance_legacy_migration_preserves_work_and_resumes_after_interruption() {
        let (mut sim, actor, object) = fixture(60);
        time(&mut sim, 300);
        sim.world_mut().entity_mut(actor).insert(AtWork {
            remaining_ticks: 240,
        });
        migrate_legacy(sim.world_mut());
        let saved = to_saved(sim.world());
        assert!(saved.shifts[0].legacy);
        assert_eq!(saved.shifts[0].worked_ticks, 240);
        assert_eq!(saved.shifts[0].end_tick, 540);
        migrate_legacy(sim.world_mut());
        assert_eq!(to_saved(sim.world()), saved);
        assert_eq!(validate_saved(sim.world(), &saved), Ok(()));
        command(
            &mut sim,
            SimCommand::UseObject {
                agent: actor.index_u32(),
                object: object.index_u32(),
                interaction: 0,
            },
        );
        assert_eq!(
            sim.world().get::<Commuting>(actor),
            Some(&Commuting::Inbound)
        );
        command(
            &mut sim,
            SimCommand::CancelIntents {
                agent: actor.index_u32(),
            },
        );
        arrive(&mut sim, actor);
        time(&mut sim, 420);
        start_tick(sim.world_mut());
        arrive(&mut sim, actor);
        time(&mut sim, 540);
        account_and_settle(sim.world_mut());
        assert_eq!(sim.funds(), 9750);
        assert_eq!(
            sim.world().resource::<Attendance>().outcomes[0].worked_minutes,
            360.0
        );
    }
    #[test]
    fn attendance_save_accounting_roundtrips_and_refuses_corruption() {
        let (mut sim, actor, _) = fixture(60);
        time(&mut sim, 60);
        start_tick(sim.world_mut());
        arrive(&mut sim, actor);
        time(&mut sim, 135);
        account_and_settle(sim.world_mut());
        let saved = to_saved(sim.world());
        assert_eq!(validate_saved(sim.world(), &saved), Ok(()));
        let mut before = FnvHasher::default();
        hash(sim.world(), &mut before);
        restore(sim.world_mut(), saved.clone());
        let mut after = FnvHasher::default();
        hash(sim.world(), &mut after);
        assert_eq!(before.finish(), after.finish());
        let mut broken = saved;
        broken.shifts[0].worked_ticks = 500;
        assert!(validate_saved(sim.world(), &broken).is_err());
    }
    #[test]
    fn attendance_pay_is_integer_cents_and_missing_minutes_have_one_grace_period() {
        let (pay, deduction, score) = super::settlement(12345, 480, 299, 80.0, 1440);
        assert_eq!(pay, 7689);
        assert!((deduction - 10.166667).abs() < 0.0001);
        assert!((score - 69.833336).abs() < 0.0001);
        assert_eq!(super::settlement(12345, 480, 0, 80.0, 1440), (0, 60.0, 0.0));
        assert_eq!(
            super::settlement(12345, 480, 480, 80.0, 1440),
            (12345, 0.0, 80.0)
        );
        assert_eq!(super::settlement(12345, 480, 1, 1.0, 1440).2, 0.0);
    }
}
fn settlement(pay: i64, scheduled: u64, worked: u64, base: f32, _day: u32) -> (i64, f32, f32) {
    let worked = worked.min(scheduled);
    let pay = (i128::from(pay) * i128::from(worked) / i128::from(scheduled.max(1))) as i64;
    let missed_minutes = (scheduled - worked) as f32;
    let deduction = ((missed_minutes - 120.0).max(0.0) / 60.0) * 10.0;
    (
        pay,
        deduction,
        if worked == 0 {
            0.0
        } else {
            (base - deduction).max(0.0)
        },
    )
}

fn matching_settlement(shift: &SavedScheduledShift, outcome: Option<&SavedShiftOutcome>) -> bool {
    let Some(outcome) = outcome else {
        return !shift.settled;
    };
    if !shift.settled {
        return false;
    }
    let Some(duration) = shift.end_tick.checked_sub(shift.start_tick) else {
        return false;
    };
    let (pay, deduction, score) = settlement(
        shift.pay_cents,
        duration,
        shift.worked_ticks,
        outcome.base_score,
        1440,
    );
    outcome.sim == shift.sim
        && outcome.career == shift.career
        && outcome.start_tick == shift.start_tick
        && outcome.end_tick == shift.end_tick
        && outcome.scheduled_minutes == duration as f32
        && outcome.worked_minutes == shift.worked_ticks as f32
        && outcome.missed_minutes == duration.saturating_sub(shift.worked_ticks) as f32
        && outcome.pay_cents == pay
        && (outcome.deduction - deduction).abs() < 0.001
        && (outcome.score - score).abs() < 0.001
}

/// Whether a scheduled shift from `start` for `ticks` matches one shift
/// `job` lists, its start time of day, weekday and length together
/// (issue 296, [WS-systems] item 3): a promotion or a shift change can move
/// the held shift after a scheduled shift was recorded under the old one,
/// so the record is checked against the row, not the held shift.
fn matches_a_listed_shift(
    job: &terri_data::CompiledCareer,
    tuning: &terri_data::Tuning,
    start: u64,
    ticks: u64,
) -> bool {
    let weekday = terri_core::clock::weekday(start, tuning.day_ticks, tuning.first_weekday);
    (0..job.shift_count())
        .filter_map(|index| job.shift(index))
        .any(|listed| {
            u64::from(listed.shift_ticks) == ticks
                && start % u64::from(tuning.day_ticks) == u64::from(listed.shift_start)
                && listed.works_on(weekday)
        })
}

/// The longest shift `job` lists: no scheduled shift or outcome at that
/// row can run longer.
fn longest_listed_shift(job: &terri_data::CompiledCareer) -> u32 {
    (0..job.shift_count())
        .filter_map(|index| job.shift(index))
        .map(|listed| listed.shift_ticks)
        .max()
        .unwrap_or(job.shift_ticks)
}

/// Refuse inconsistent accounting before changing the live world.
pub fn validate_saved(world: &World, saved: &SavedAttendance) -> Result<(), crate::SaveError> {
    use crate::SaveError::InvalidValue;
    let pack = world.resource::<Content>().0;
    let now = world.resource::<SimClock>().tick;
    if saved.shifts.len() > 100_000
        || saved.outcomes.len() > 100_000
        || saved.shifts.windows(2).any(|p| p[0].sim >= p[1].sim)
    {
        return Err(InvalidValue);
    }
    for shift in &saved.shifts {
        let Some(actor) = crate::edit::living_entity(world, shift.sim) else {
            return Err(InvalidValue);
        };
        let Some(job) = pack.careers.get(shift.career as usize) else {
            return Err(InvalidValue);
        };
        let start = shift.start_tick;
        let duration = shift.end_tick.checked_sub(start);
        if duration.is_none_or(|d| {
            d == 0
                || d > u64::from(longest_listed_shift(job))
                || (!shift.legacy && !matches_a_listed_shift(job, &pack.tuning, start, d))
        }) || start > now
            || shift.accounted_tick < start
            || shift.accounted_tick > now.min(shift.end_tick)
            || shift.worked_ticks > shift.accounted_tick - start
            || shift.pay_cents < i64::from(job.pay) * Funds::CENTS_PER_DOLLAR
            || shift.pay_cents > i64::from(job.pay_max) * Funds::CENTS_PER_DOLLAR
            || (!shift.settled && shift.end_tick <= now)
            || (shift.settled
                && (world.get::<AtWork>(actor).is_some()
                    || world.get::<Commuting>(actor) == Some(&Commuting::Outbound)))
            || (!shift.settled
                && world
                    .get::<Career>(actor)
                    .is_none_or(|c| c.0 != shift.career))
        {
            return Err(InvalidValue);
        }
    }
    let mut seen = BTreeMap::new();
    for outcome in &saved.outcomes {
        let Some(job) = pack.careers.get(outcome.career as usize) else {
            return Err(InvalidValue);
        };
        let scheduled = outcome.end_tick.saturating_sub(outcome.start_tick) as f64;
        let finite = [
            outcome.scheduled_minutes,
            outcome.worked_minutes,
            outcome.missed_minutes,
            outcome.base_score,
            outcome.deduction,
            outcome.score,
        ]
        .iter()
        .all(|v| v.is_finite() && *v >= 0.0);
        if !finite
            || crate::edit::living_entity(world, outcome.sim).is_none()
            || outcome
                .end_tick
                .checked_sub(outcome.start_tick)
                .is_none_or(|d| d == 0 || d > u64::from(longest_listed_shift(job)))
            || outcome.start_tick > now
            || outcome.worked_minutes > now.saturating_sub(outcome.start_tick) as f32 + 0.01
            || seen
                .insert((outcome.sim, outcome.start_tick), outcome)
                .is_some()
            || (f64::from(outcome.scheduled_minutes) - scheduled).abs() > 0.01
            || (outcome.worked_minutes + outcome.missed_minutes - outcome.scheduled_minutes).abs()
                > 0.01
            || outcome.worked_minutes > outcome.scheduled_minutes
            || outcome.worked_minutes.fract() != 0.0
            || outcome.missed_minutes.fract() != 0.0
            || outcome.base_score > 100.0
            || outcome.score > 100.0
            || (outcome.deduction - ((outcome.missed_minutes - 120.0).max(0.0) / 60.0) * 10.0).abs()
                > 0.001
            || (outcome.score
                - if outcome.worked_minutes == 0.0 {
                    0.0
                } else {
                    (outcome.base_score - outcome.deduction).max(0.0)
                })
            .abs()
                > 0.001
            || outcome.pay_cents < 0
            || outcome.pay_cents > i64::from(job.pay_max) * Funds::CENTS_PER_DOLLAR
            || (outcome.worked_minutes == 0.0 && outcome.pay_cents != 0)
        {
            return Err(InvalidValue);
        }
    }
    for shift in &saved.shifts {
        if !matching_settlement(shift, seen.get(&(shift.sim, shift.start_tick)).copied()) {
            return Err(InvalidValue);
        }
    }
    Ok(())
}
/// Death removes attendance records along with the person's career record.
pub(crate) fn forget(world: &mut World, sim: SimId) {
    if let Some(mut a) = world.get_resource_mut::<Attendance>() {
        a.shifts.remove(&sim);
        a.outcomes.retain(|s| s.sim != sim.0);
    }
}

/// Preserve the remaining entitlement of old saves whose office countdown began on arrival.
/// Frozen readers stay unchanged; adoption invokes this once before new gameplay.
pub(crate) fn migrate_legacy(world: &mut World) {
    ensure(world);
    let now = world.resource::<SimClock>().tick;
    let pack = world.resource::<Content>().0;
    let actors: Vec<_> = world
        .query_filtered::<(Entity, &SimId, &Career), With<Agent>>()
        .iter(world)
        .map(|(e, s, c)| (e, *s, c.0))
        .collect();
    for (actor, sim, career) in actors {
        if world.resource::<Attendance>().shifts.contains_key(&sim) {
            continue;
        }
        let pending = world.get::<crate::reading::PendingShift>(actor).cloned();
        let career = pending.as_ref().map_or(career, |p| p.career);
        let job = &pack.careers[career as usize];
        let length = crate::shifts::shift_at(world, pack, actor, career)
            .map_or(job.shift_ticks, |shift| shift.shift_ticks);
        let (start_tick, end_tick, worked, accounted_tick) = if let Some(pending) = pending {
            let end = pending.scheduled_tick + u64::from(length);
            (pending.scheduled_tick, end, 0, now.min(end))
        } else {
            let (worked, remaining) = if let Some(work) = world.get::<AtWork>(actor) {
                let remaining = work.remaining_ticks.min(length);
                if remaining == 0 {
                    continue;
                }
                (u64::from(length - remaining).min(now), u64::from(remaining))
            } else if world.get::<Commuting>(actor) == Some(&Commuting::Outbound) {
                (0, u64::from(length))
            } else {
                continue;
            };
            (now - worked, now + remaining, worked, now)
        };
        let pay = world
            .get_resource::<Careers>()
            .and_then(|c| c.record(sim))
            .map_or(job.pay, |r| r.pay);
        world.resource_mut::<Attendance>().shifts.insert(
            sim,
            SavedScheduledShift {
                sim: sim.0,
                career,
                start_tick,
                end_tick,
                worked_ticks: worked,
                accounted_tick,
                pay_cents: i64::from(pay) * Funds::CENTS_PER_DOLLAR,
                settled: false,
                legacy: true,
            },
        );
    }
    account_and_settle(world);
}

#[cfg(test)]
#[path = "attendance_tests.rs"]
mod continuation_tests;
