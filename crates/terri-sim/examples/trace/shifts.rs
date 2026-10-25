//! Shifts in the trace (issue 296, `docs/specs/2026-10-18-shifts-and-careers.md`,
//! [WS-tests] "Measurement"): each person's job and held shift, when each
//! person sleeps by hour of day, how a night worker meets each shift start,
//! and the longest any housemate waits on a sleeping conversation
//! recipient. Every report here reads the world; none draws a random
//! number or changes state.
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
}

/// Splits `--night-worker`, `--careers-seed <n>` and `--pre-shift-careers`
/// from the positional arguments, which keep their order.
pub fn split_args(args: impl Iterator<Item = String>) -> (Flags, Vec<String>) {
    let mut flags = Flags {
        night_worker: false,
        careers_seed: None,
        pre_shift_careers: false,
    };
    let mut positional = Vec::new();
    let mut args = args.peekable();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--night-worker" => flags.night_worker = true,
            "--pre-shift-careers" => flags.pre_shift_careers = true,
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

pub struct Summary {
    /// Sleeping ticks per person by hour of the day clock.
    sleep: Vec<[u64; 24]>,
    /// Per person, the shift starts seen and how they were met.
    starts: Vec<Vec<(u64, Start)>>,
    /// Consecutive waiting ticks per pending request while its recipient sleeps.
    waits: BTreeMap<u64, u64>,
    longest_wait: u64,
    /// The request behind the longest wait, worded when it is set.
    longest_detail: String,
    /// Every finished wait on a sleeping recipient longer than an hour.
    long_waits: Vec<String>,
    /// The wording of each wait still running, by request id.
    open: BTreeMap<u64, String>,
}

impl Summary {
    pub fn new(people: usize) -> Self {
        Self {
            sleep: vec![[0; 24]; people],
            starts: vec![Vec::new(); people],
            waits: BTreeMap::new(),
            longest_wait: 0,
            longest_detail: String::new(),
            long_waits: Vec::new(),
            open: BTreeMap::new(),
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
