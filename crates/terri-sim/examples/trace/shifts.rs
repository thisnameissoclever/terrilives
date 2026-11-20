//! Shifts in the trace (issue 296, `docs/specs/2026-10-18-shifts-and-careers.md`,
//! [WS-tests] "Measurement"): each person's job and held shift, when each
//! person sleeps by hour of day, how a night worker meets each shift start,
//! and the longest any housemate waits on a sleeping conversation
//! recipient, with separate totals for chats a housemate chose and for
//! fights the game started (issue 338). Every report here reads the world;
//! none draws a random number or changes state.
use std::collections::BTreeMap;
use terri_core::{AtWork, Commuting, Eating, Entity, SimClock, SimId};
use terri_sim::{Content, Sim};

/// The trace's own flags, taken out of the argument list before the
/// positional arguments (ticks, seed, instinct, scenario) are read.
pub struct Flags {
    /// Put Casey on the night watch's standard shift before the first tick.
    pub night_worker: bool,
    /// Reseed the careers stream before the first tick.
    pub careers_seed: Option<u64>,
    /// Run on the career content and search from before issue 296: the
    /// first three paths and twelve rows, standard shifts only, every
    /// shift sleep offset 0 and a search temperature of 0.
    pub pre_shift_careers: bool,
    /// Issue 309: replace `work_lateness_limit_ticks` before the first tick;
    /// 0 leaves on time, as before the issue.
    pub lateness_limit: Option<u32>,
}

/// Splits `--night-worker`, `--careers-seed <n>`, `--pre-shift-careers`,
/// `--lateness-limit <ticks>` from the
/// positional arguments, which keep their order.
pub fn split_args(args: impl Iterator<Item = String>) -> (Flags, Vec<String>) {
    let mut flags = Flags {
        night_worker: false,
        careers_seed: None,
        pre_shift_careers: false,
        lateness_limit: None,
    };
    let mut positional = Vec::new();
    let mut args = args.peekable();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--night-worker" => flags.night_worker = true,
            "--pre-shift-careers" => flags.pre_shift_careers = true,
            "--lateness-limit" => {
                flags.lateness_limit = Some(
                    args.next()
                        .and_then(|value| value.parse().ok())
                        .expect("--lateness-limit takes a whole number of ticks"),
                );
            }
            "--careers-seed" => {
                flags.careers_seed = Some(
                    args.next()
                        .and_then(|value| value.parse().ok())
                        .expect("--careers-seed takes a whole number"),
                );
            }
            _ => positional.push(arg),
        }
    }
    (flags, positional)
}

/// Applies the flags to a new game before its first tick.
pub fn prepare(sim: &mut Sim, flags: &Flags) {
    if flags.pre_shift_careers {
        let mut pack = terri_data::pack().clone();
        pack.careers.truncate(12);
        pack.career_paths.truncate(3);
        for job in &mut pack.careers {
            job.shifts.clear();
            job.standard_weight = 1;
        }
        pack.tuning.shift_sleep_offset_day = 0;
        pack.tuning.shift_sleep_offset_early = 0;
        pack.tuning.shift_sleep_offset_late = 0;
        pack.tuning.shift_sleep_offset_night = 0;
        pack.tuning.career_search_temperature = 0.0;
        pack.tuning.work_lateness_limit_ticks = 0;
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
    }
    if let Some(limit) = flags.lateness_limit {
        let mut pack = sim.world().resource::<Content>().0.clone();
            pack.tuning.work_lateness_limit_ticks = limit;
            pack.tuning.work_lateness_ramp_ticks =
                pack.tuning.work_lateness_ramp_ticks.min(limit.max(1));
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
    }
    if let Some(seed) = flags.careers_seed {
        sim.world_mut().resource_mut::<terri_sim::Careers>().rng =
            terri_core::SimRng::from_seed(seed);
    }
    if flags.night_worker {
        let casey = named(sim, "Casey").expect("the shipped household has Casey");
        let pack = sim.world().resource::<Content>().0;
        let night = pack
            .career_paths
            .iter()
            .position(|path| path.id == "night_watch")
            .expect("the shipped night watch") as u32;
        sim.world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(terri_core::SimCommand::AssignCareerShift {
                agent: casey.index_u32(),
                path: night,
                shift: 0,
            });
        sim.flush_commands();
        assert!(
            sim.world().get::<terri_core::Career>(casey).is_some(),
            "Casey holds the night watch"
        );
    }
}

fn named(sim: &mut Sim, name: &str) -> Option<Entity> {
    sim.world_mut()
        .query::<(Entity, &terri_core::SimName)>()
        .iter(sim.world())
        .find(|(_, sim_name)| sim_name.0 == name)
        .map(|(entity, _)| entity)
}

fn asleep(sim: &Sim, entity: Entity) -> bool {
    let pack = sim.world().resource::<Content>().0;
    terri_sim::systems::circadian::is_asleep(pack, sim.world().get::<Eating>(entity))
}

/// One shift start of a worker: whether they were asleep at the start tick,
/// and whether they had left within the start tick's next ten minutes.
#[derive(Default, Clone)]
struct Start {
    asleep: bool,
    left: Option<bool>,
}

/// One shift start of a worker as issue 309 reads it: whether a counted
/// need (Hunger or Energy) was critical at the start tick, and the tick the
/// worker was first seen away, if ever. The shift's scheduled end is kept to
/// tell a late departure from a missed shift.
#[derive(Clone)]
struct Lateness {
    start: u64,
    end: u64,
    critical: bool,
    left: Option<u64>,
}

pub struct Summary {
    /// Sleeping ticks per person by hour of the day clock.
    sleep: Vec<[u64; 24]>,
    /// Per person, the shift starts seen and how they were met.
    starts: Vec<Vec<(u64, Start)>>,
    /// Per person, each shift start with its lateness (issue 309).
    lateness: Vec<Vec<Lateness>>,
    /// Per person, the lowest Bladder seen while at work and the ticks spent
    /// at work with it at or under the critical level (issue 309).
    work_bladder: Vec<(f32, u64)>,
    /// What each worker was doing on the ticks they were late (issue 309), kept
    /// to the first 200 for the report.
    late_ticks: Vec<String>,
    /// Consecutive waiting ticks per pending request while its recipient sleeps.
    waits: BTreeMap<u64, u64>,
    longest_wait: u64,
    /// The request behind the longest wait, worded when it is set.
    longest_detail: String,
    /// Every finished wait on a sleeping recipient longer than an hour.
    long_waits: Vec<String>,
    /// The wording of each wait still running, by request id.
    open: BTreeMap<u64, String>,
    /// Waiting ticks beside a sleeping recipient of chats a housemate chose
    /// for themselves (origin `Autonomous`), in all and the longest run.
    /// Issue 338's ruling makes both zero; player-ordered and unattributed
    /// legacy chats may still wait.
    chosen_ticks: u64,
    longest_chosen: u64,
    /// Fight orders at the front of a queue whose other person sleeps while
    /// the fight has not started, by initiator: the current run, and the
    /// ticks in all and the longest run. The trace gives no orders, so each
    /// is a fight the game started. Issue 338 withdraws these too: the
    /// coordinator decided on 2026-10-24, following the owner's ruling for
    /// chats and pull request 302's withdrawals, that game-made fights are
    /// not started against a sleeper and give up when the recipient sleeps.
    fight_runs: BTreeMap<Entity, u64>,
    fight_ticks: u64,
    longest_fight: u64,
}

impl Summary {
    pub fn new(people: usize) -> Self {
        Self {
            sleep: vec![[0; 24]; people],
            starts: vec![Vec::new(); people],
            lateness: vec![Vec::new(); people],
            work_bladder: vec![(f32::INFINITY, 0); people],
            late_ticks: Vec::new(),
            waits: BTreeMap::new(),
            longest_wait: 0,
            longest_detail: String::new(),
            long_waits: Vec::new(),
            open: BTreeMap::new(),
            chosen_ticks: 0,
            longest_chosen: 0,
            fight_runs: BTreeMap::new(),
            fight_ticks: 0,
            longest_fight: 0,
        }
    }

    /// Reads one tick. `requests` are the conversation requests the main
    /// loop already read from the save this tick.
    pub fn observe<'a>(
        &mut self,
        sim: &Sim,
        sims: &[(Entity, String)],
        requests: impl Iterator<Item = &'a terri_core::save_v15::SavedConversationRequest>,
    ) {
        let pack = sim.world().resource::<Content>().0;
        let day = u64::from(pack.tuning.day_ticks);
        let now = sim.world().resource::<SimClock>().tick;
        let hour = ((now % day) * 24 / day) as usize;
        for (index, (entity, _)) in sims.iter().enumerate() {
            if sim.world().get_entity(*entity).is_err() {
                continue;
            }
            if asleep(sim, *entity) {
                self.sleep[index][hour] += 1;
            }
            let Some(shift) = terri_sim::shifts::shift_of(sim.world(), pack, *entity) else {
                continue;
            };
            let weekday =
                terri_core::clock::weekday(now, pack.tuning.day_ticks, pack.tuning.first_weekday);
            if now % day == u64::from(shift.shift_start) && shift.works_on(weekday) {
                self.starts[index].push((
                    now,
                    Start {
                        asleep: asleep(sim, *entity),
                        left: None,
                    },
                ));
            }
            let away = sim.world().get::<AtWork>(*entity).is_some()
                || sim.world().get::<Commuting>(*entity) == Some(&Commuting::Outbound);
            // Issue 309: lateness of each shift start, and Bladder at work.
            if now % day == u64::from(shift.shift_start) && shift.works_on(weekday) {
                let needs = sim.world().get::<terri_core::Needs>(*entity);
                let level = pack.tuning.mood_critical_need_level;
                self.lateness[index].push(Lateness {
                    start: now,
                    end: now + u64::from(shift.shift_ticks),
                    critical: needs.is_some_and(|needs| {
                        [terri_core::NeedId::Hunger, terri_core::NeedId::Energy]
                            .iter()
                            .any(|&need| needs.get(need) <= level)
                    }),
                    left: None,
                });
            }
            if let Some(record) = self.lateness[index].last_mut() {
                if record.left.is_none() && away {
                    record.left = Some(now);
                }
                if record.left.is_none()
                    && now > record.start
                    && now < record.end
                    && self.late_ticks.len() < 200
                {
                    let needs = sim.world().get::<terri_core::Needs>(*entity);
                    self.late_ticks.push(format!(
                        "tick {now} ({} minutes late) {}: critical at start {}, hunger {:.1} energy {:.1} bladder {:.1}, eating {}, target {}, path {}, socialising {}, target {}, queued orders {}",
                        now - record.start,
                        sims[index].1,
                        record.critical,
                        needs.map_or(f32::NAN, |n| n.get(terri_core::NeedId::Hunger)),
                        needs.map_or(f32::NAN, |n| n.get(terri_core::NeedId::Energy)),
                        needs.map_or(f32::NAN, |n| n.get(terri_core::NeedId::Bladder)),
                        sim.world().get::<Eating>(*entity).is_some(),
                        sim.world().get::<terri_core::Target>(*entity).is_some(),
                        sim.world().get::<terri_core::Path>(*entity).is_some(),
                        sim.world().get::<terri_core::Socialising>(*entity).is_some(),
                        sim.world()
                            .get::<terri_core::Target>(*entity)
                            .and_then(|target| sim.world().get::<terri_core::SmartObject>(target.object))
                            .map_or("none".to_string(), |object| pack.object(object.0).id.clone()),
                        sim.world()
                            .get::<terri_core::IntentQueue>(*entity)
                            .map_or(0, |queue| queue.entries().len()),
                    ));
                }
            }
            if sim.world().get::<AtWork>(*entity).is_some() {
                if let Some(needs) = sim.world().get::<terri_core::Needs>(*entity) {
                    let bladder = needs.get(terri_core::NeedId::Bladder);
                    let row = &mut self.work_bladder[index];
                    row.0 = row.0.min(bladder);
                    if bladder <= pack.tuning.mood_critical_need_level {
                        row.1 += 1;
                    }
                }
            }
            if let Some((start, record)) = self.starts[index].last_mut() {
                if record.left.is_none() {
                    if away {
                        record.left = Some(true);
                    } else if now >= *start + 10 {
                        record.left = Some(false);
                    }
                }
            }
        }
        // A pending conversation request whose recipient sleeps is a wait on
        // a sleeping recipient ([WS-systems]). A suspended request waits on
        // its own initiator, who is busy elsewhere, so it is not counted.
        let mut seen = BTreeMap::new();
        for request in requests {
            if matches!(
                request.phase,
                terri_core::save_v15::SavedConversationPhase::Talking
                    | terri_core::save_v15::SavedConversationPhase::Suspended
            ) {
                continue;
            }
            let recipient = sim
                .world()
                .try_query::<(Entity, &SimId)>()
                .unwrap()
                .iter(sim.world())
                .find(|(_, id)| id.0 == request.recipient)
                .map(|(entity, _)| entity);
            if recipient.is_some_and(|recipient| asleep(sim, recipient)) {
                let run = self.waits.get(&request.id).copied().unwrap_or(0) + 1;
                let detail = format!(
                    "request {} from sim {} to sim {} ({}, {:?}), created at tick {}, {:?}, waiting on the sleeping recipient from tick {} to tick {now} ({run} ticks)",
                    request.id, request.initiator, request.recipient, request.interaction,
                    request.origin, request.created, request.phase, now + 1 - run
                );
                if run > self.longest_wait {
                    self.longest_wait = run;
                    self.longest_detail = detail.clone();
                }
                self.open.insert(request.id, detail);
                seen.insert(request.id, run);
                if request.origin == terri_core::save_v15::SavedConversationOrigin::Autonomous {
                    self.chosen_ticks += 1;
                    self.longest_chosen = self.longest_chosen.max(run);
                }
            }
        }
        for (id, run) in &self.waits {
            if !seen.contains_key(id) && *run > 60 {
                if let Some(detail) = self.open.get(id) {
                    self.long_waits.push(detail.clone());
                }
            }
        }
        self.open.retain(|id, _| seen.contains_key(id));
        self.waits = seen;
        for (entity, _) in sims {
            let waiting = sim.world().get_entity(*entity).is_ok()
                && sim
                    .world()
                    .get::<terri_core::Socialising>(*entity)
                    .is_none()
                && sim
                    .world()
                    .get::<terri_core::IntentQueue>(*entity)
                    .and_then(terri_core::IntentQueue::front)
                    .is_some_and(|intent| {
                        pack.social
                            .get(intent.interaction as usize)
                            .is_some_and(terri_sim::fights::is_fight)
                            && sim.world().get_entity(intent.object).is_ok()
                            && asleep(sim, intent.object)
                    });
            if waiting {
                let run = self.fight_runs.entry(*entity).or_insert(0);
                *run += 1;
                self.fight_ticks += 1;
                self.longest_fight = self.longest_fight.max(*run);
            } else {
                self.fight_runs.remove(entity);
            }
        }
    }

    pub fn print(&self, sim: &Sim, sims: &[(Entity, String)]) {
        let pack = sim.world().resource::<Content>().0;
        let careers = sim.world().resource::<terri_sim::Careers>();
        println!("\nSHIFTS");
        for (index, (entity, name)) in sims.iter().enumerate() {
            let job = terri_sim::careers::job_of(sim.world(), pack, *entity);
            let shift = terri_sim::shifts::shift_of(sim.world(), pack, *entity);
            match (job, shift) {
                (Some(job), Some(shift)) => {
                    println!(
                    "JOB {name}: {} ({}), shift {} kind {} from {} for {} ticks, days mask {:#09b}",
                    job.label, job.id, shift.id, shift.kind, shift.shift_start, shift.shift_ticks,
                    shift.working_days
                )
                }
                _ => println!("JOB {name}: none"),
            }
            let total: u64 = self.sleep[index].iter().sum();
            let day_sleep: u64 = self.sleep[index][7..18].iter().sum();
            println!(
                "SLEEP {name}: {total} ticks, {day_sleep} between 07:00 and 18:00, by hour {:?}",
                self.sleep[index]
            );
            let starts = &self.starts[index];
            if !starts.is_empty() {
                let asleep = starts.iter().filter(|(_, start)| start.asleep).count();
                let left = starts
                    .iter()
                    .filter(|(_, start)| start.left == Some(true))
                    .count();
                let rows: Vec<String> = starts
                    .iter()
                    .map(|(tick, start)| {
                        format!(
                            "{tick}:{}{}",
                            if start.asleep { "asleep" } else { "awake" },
                            match start.left {
                                Some(true) => ",left",
                                Some(false) => ",stayed",
                                None => ",open",
                            }
                        )
                    })
                    .collect();
                println!(
                    "STARTS {name}: {} shift starts, asleep at {asleep}, left within ten minutes at {left}: {}",
                    starts.len(),
                    rows.join(" ")
                );
            }
        }
        // Issue 309: how late each worker was, by what the day's first
        // away tick says, against the limit and the shift's end.
        let limit = u64::from(pack.tuning.work_lateness_limit_ticks);
        for (index, (_, name)) in sims.iter().enumerate() {
            let rows = &self.lateness[index];
            if rows.is_empty() {
                continue;
            }
            let lateness_of = |row: &Lateness| row.left.map(|left| left - row.start);
            let critical = rows.iter().filter(|row| row.critical).count();
            // A start with Hunger or Energy critical is the lateness this
            // issue bounds; any other late departure has another cause
            // (a reading journey's walk home, a stuck route), which this
            // issue does not change.
            let by_need: Vec<u64> = rows
                .iter()
                .filter(|row| row.critical)
                .filter_map(lateness_of)
                .collect();
            let other: Vec<u64> = rows
                .iter()
                .filter(|row| !row.critical)
                .filter_map(lateness_of)
                .filter(|late| *late > 0)
                .collect();
            let never_left = rows.iter().filter(|row| row.left.is_none()).count();
            let need_over_limit = by_need.iter().filter(|late| **late > limit).count();
            let after_end = rows
                .iter()
                .filter(|row| row.left.is_some_and(|left| left >= row.end))
                .count();
            println!(
                "LATENESS {name}: {} shift starts, {critical} with Hunger or Energy critical at the start (left {:?} minutes after the start, {need_over_limit} over the {limit} minute limit); {} other late departures (longest {} minutes); {after_end} after the shift's end, {never_left} never left",
                rows.len(),
                by_need,
                other.len(),
                other.iter().max().copied().unwrap_or(0),
            );
            let (lowest, critical_ticks) = self.work_bladder[index];
            if lowest.is_finite() {
                println!(
                    "WORK BLADDER {name}: lowest {lowest:.2} while at work, {critical_ticks} ticks at work with Bladder critical"
                );
            }
        }
        if std::env::var_os("TRACE_LATE_TICKS").is_some() {
            for line in &self.late_ticks {
                println!("LATE {line}");
            }
        }
        println!(
            "careers draws {}, shift draws {}",
            careers.draws, careers.shift_draws
        );
        println!(
            "longest wait on a sleeping conversation recipient: {} ticks",
            self.longest_wait
        );
        if !self.longest_detail.is_empty() {
            println!("LONGEST WAIT {}", self.longest_detail);
        }
        println!(
            "self-chosen chats waiting on a sleeping recipient: {} ticks in all, longest {} ticks",
            self.chosen_ticks, self.longest_chosen
        );
        println!(
            "game-made fights waiting on a sleeping recipient: {} ticks in all, longest {} ticks",
            self.fight_ticks, self.longest_fight
        );
        let running = self
            .open
            .iter()
            .filter(|(id, _)| self.waits.get(id).is_some_and(|run| *run > 60))
            .map(|(_, detail)| detail);
        for detail in self.long_waits.iter().chain(running) {
            println!("WAIT OVER AN HOUR {detail}");
        }
    }
}
