//! Bathroom uses over a trace: how long they last and where the meter ends.
//!
//! Issue 315 made a toilet, shower or bath last until its need is full. This
//! reads the three fixtures' uses off the household once a tick, from outside
//! the simulation, so the same harness measures a build from before the change
//! and a build after it:
//!
//! - **How long each kind of use lasts**, and how many ended with the need at
//!   100. Before the change a use lasted a drawn length and mostly ended short;
//!   after it a use that nobody interrupts ends full.
//! - **The need on the tick a use started and on the tick it ended**, which is
//!   what the person gained and what they left with.
//! - **The net change in Energy and Comfort** over a use. A shower's Energy
//!   cost and a bath's Comfort are paid per minute, so they follow the length.
//! - **How much of the run each kind of fixture was occupied**, since a longer
//!   use holds the room longer and others wait outside it.
//!
//! The length is counted as the ticks `Eating` was observed plus the tick it
//! ended on: `follow_path` inserts `Eating` and `tick_interactions` takes a
//! tick off it within the same tick, and the last tick of a use removes it, so
//! an outside observer sees one tick fewer than the use lasted.
use std::collections::BTreeMap;
use terri_core::{AtWork, Blocked, ChainState, Commuting, Eating, Entity, NeedId, Needs, Path};
use terri_data::CompiledActivity;
use terri_sim::Sim;

const KINDS: [(&str, NeedId); 3] = [
    ("toilet", NeedId::Bladder),
    ("shower", NeedId::Hygiene),
    ("bath", NeedId::Hygiene),
];

#[derive(Default, Clone)]
struct Tally {
    ticks: Vec<u32>,
    started: Vec<f32>,
    ended: Vec<f32>,
    energy: Vec<f32>,
    comfort: Vec<f32>,
    full: u32,
    occupied: u64,
}

struct Open {
    kind: usize,
    observed: u32,
    before: Needs,
}

pub struct Summary {
    /// What a housemate was doing on each tick their Bladder was critical.
    bladder_critical: BTreeMap<&'static str, u64>,
    open: Vec<Option<Open>>,
    previous: Vec<Option<Needs>>,
    tallies: [Tally; 3],
}

fn kind_of(eating: &Eating) -> Option<usize> {
    let pack = terri_data::pack();
    let action = &pack.object(eating.object).interactions[eating.interaction as usize];
    match action.activity? {
        CompiledActivity::UsingToilet => Some(0),
        CompiledActivity::Showering => Some(1),
        CompiledActivity::Bathing => Some(2),
        _ => None,
    }
}

impl Summary {
    pub fn new(sims: usize) -> Self {
        Summary {
            bladder_critical: BTreeMap::new(),
            open: (0..sims).map(|_| None).collect(),
            previous: vec![None; sims],
            tallies: Default::default(),
        }
    }

    /// Call once after every tick.
    pub fn observe(&mut self, sim: &Sim, sims: &[(Entity, String)]) {
        let world = sim.world();
        for (index, (entity, _)) in sims.iter().enumerate() {
            let Some(needs) = world.get::<Needs>(*entity).copied() else {
                self.open[index] = None;
                self.previous[index] = None;
                continue;
            };
            if needs.get(NeedId::Bladder) <= terri_data::pack().tuning.mood_critical_need_level {
                let what = if world.get::<AtWork>(*entity).is_some()
                    || world.get::<Commuting>(*entity).is_some()
                {
                    "at work or commuting"
                } else if let Some(eating) = world.get::<Eating>(*entity) {
                    let pack = terri_data::pack();
                    let action =
                        &pack.object(eating.object).interactions[eating.interaction as usize];
                    if kind_of(eating).is_some() {
                        "using a bathroom fixture"
                    } else if action.tags.contains(&pack.sleep_tag) {
                        "asleep"
                    } else {
                        "using something else"
                    }
                } else if world.get::<ChainState>(*entity).is_some() {
                    "in a multi-step errand"
                } else if world.get::<Path>(*entity).is_some() {
                    "walking"
                } else if world.get::<Blocked>(*entity).is_some() {
                    "blocked, waiting for an occupied target"
                } else {
                    "standing, not blocked"
                };
                *self.bladder_critical.entry(what).or_default() += 1;
            }
            let now = world.get::<Eating>(*entity).and_then(kind_of);
            let continuing =
                matches!((&self.open[index], now), (Some(open), Some(kind)) if open.kind == kind);
            if continuing {
                let open = self.open[index].as_mut().unwrap();
                open.observed += 1;
                self.tallies[open.kind].occupied += 1;
            } else {
                if let Some(open) = self.open[index].take() {
                    self.close(open, &needs);
                }
                if let (Some(kind), Some(before)) = (now, self.previous[index]) {
                    self.tallies[kind].occupied += 1;
                    self.open[index] = Some(Open {
                        kind,
                        observed: 1,
                        before,
                    });
                }
            }
            self.previous[index] = Some(needs);
        }
    }

    fn close(&mut self, open: Open, now: &Needs) {
        let (_, need) = KINDS[open.kind];
        let tally = &mut self.tallies[open.kind];
        // The tick the use ended on removed `Eating`, so it was never observed.
        tally.ticks.push(open.observed + 1);
        tally.occupied += 1;
        tally.started.push(open.before.get(need));
        let ended = now.get(need);
        tally.ended.push(ended);
        tally.full += u32::from(ended >= 99.99);
        tally
            .energy
            .push(now.get(NeedId::Energy) - open.before.get(NeedId::Energy));
        tally
            .comfort
            .push(now.get(NeedId::Comfort) - open.before.get(NeedId::Comfort));
    }

    pub fn print(&self, run_ticks: u64) {
        let mean = |values: &[f32]| {
            if values.is_empty() {
                f32::NAN
            } else {
                values.iter().sum::<f32>() / values.len() as f32
            }
        };
        println!(
            "\nBATHROOM USES, finished uses only (a use still running at the end is not counted)"
        );
        println!("kind     uses  full  ticks: mean   min   max | need: start    end | net Energy  net Comfort | occupied");
        for (index, (name, _)) in KINDS.iter().enumerate() {
            let tally = &self.tallies[index];
            let ticks: Vec<f32> = tally.ticks.iter().map(|t| *t as f32).collect();
            println!(
                "{name:<7} {:>5} {:>5}  {:>11.1} {:>5} {:>5} | {:>11.1} {:>6.1} | {:>10.1} {:>12.1} | {:>6.1}%",
                tally.ticks.len(),
                tally.full,
                mean(&ticks),
                tally.ticks.iter().min().map_or("-".into(), |v| v.to_string()),
                tally.ticks.iter().max().map_or("-".into(), |v| v.to_string()),
                mean(&tally.started),
                mean(&tally.ended),
                mean(&tally.energy),
                mean(&tally.comfort),
                100.0 * tally.occupied as f64 / run_ticks as f64,
            );
        }
        println!(
            "BLADDER CRITICAL, what housemates were doing on those ticks: {:?}",
            self.bladder_critical
        );
        println!("occupied is the share of the run in which any housemate was using that kind of fixture, counted per housemate (three housemates can add to over 100%)");
    }
}
