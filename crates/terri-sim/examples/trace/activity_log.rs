//! Activity log volume, for Task 7 of the activity log plan
//! (`docs/superpowers/plans/2026-10-18-activity-log.md`): records per kind
//! per game day, the most records in one tick and in five consecutive
//! ticks (the most one browser frame can run), and the records the staging
//! ring dropped. It drains the log once a tick, as the shell does once a
//! frame, and changes nothing in the simulation.

use std::collections::VecDeque;
use terri_sim::activity_log::{LogKind, RECORD_WORDS, STAGING_CAPACITY};
use terri_sim::Sim;

/// Ticks one browser frame can run (`MAX_TICKS_PER_FRAME` in
/// `web/src/main.ts`).
const FRAME_TICKS: usize = 5;

pub struct Volume {
    day_ticks: u64,
    /// Records per game day, indexed by kind code; slot 0 is unused.
    per_day: Vec<[u32; 13]>,
    /// Mess annoyances per game day, the research's other figure.
    mess_per_day: Vec<u32>,
    mess_label: u32,
    largest_tick: u32,
    window: VecDeque<u32>,
    largest_frame: u32,
    buffer: Vec<u32>,
}

impl Volume {
    pub fn new(sim: &Sim) -> Self {
        let mess_label = sim
            .activity_log_labels()
            .iter()
            .position(|label| label == "cause:household-mess")
            .map_or(u32::MAX, |index| index as u32);
        Self {
            day_ticks: u64::from(terri_data::pack().tuning.day_ticks),
            per_day: Vec::new(),
            mess_per_day: Vec::new(),
            mess_label,
            largest_tick: 0,
            window: VecDeque::with_capacity(FRAME_TICKS),
            largest_frame: 0,
            buffer: Vec::new(),
        }
    }

    /// Drains the records staged by the tick that just ran, counting each
    /// on the game day of its own tick.
    pub fn observe(&mut self, sim: &mut Sim) {
        self.buffer.clear();
        let count = sim.take_activity_log(&mut self.buffer);
        for words in self.buffer.chunks_exact(RECORD_WORDS) {
            let day = (u64::from(words[1]) / self.day_ticks.max(1)) as usize;
            while self.per_day.len() <= day {
                self.per_day.push([0; 13]);
                self.mess_per_day.push(0);
            }
            let code = (words[2] & 0xff) as usize;
            if LogKind::from_code(code as u8).is_some() {
                self.per_day[day][code] += 1;
            }
            if code == LogKind::Annoyed as usize && words[5] == self.mess_label {
                self.mess_per_day[day] += 1;
            }
        }
        self.largest_tick = self.largest_tick.max(count);
        if self.window.len() == FRAME_TICKS {
            self.window.pop_front();
        }
        self.window.push_back(count);
        self.largest_frame = self.largest_frame.max(self.window.iter().sum());
    }

    /// Prints the table; the mean covers the `ticks / day_ticks` whole days
    /// the run completed, so a few records stamped on the next day's first
    /// tick do not count as a day.
    pub fn print(&self, sim: &Sim, ticks: u64) {
        println!("\nACTIVITY LOG records per game day, by kind");
        let names: Vec<String> = LogKind::ALL
            .iter()
            .map(|kind| format!("{kind:?}"))
            .collect();
        println!(
            "{:<5}{} {:>6} {:>5}",
            "day",
            names.iter().map(|n| format!("{n:>15}")).collect::<String>(),
            "total",
            "mess"
        );
        let whole = (ticks / self.day_ticks.max(1)) as usize;
        let mut totals = [0u64; 13];
        let mut mess_total = 0u64;
        for (day, counts) in self.per_day.iter().enumerate() {
            let total: u32 = counts.iter().sum();
            let row: String = LogKind::ALL
                .iter()
                .map(|kind| format!("{:>15}", counts[*kind as usize]))
                .collect();
            println!(
                "{:<5}{row} {total:>6} {:>5}",
                day + 1,
                self.mess_per_day[day]
            );
            if day < whole {
                for (slot, value) in counts.iter().enumerate() {
                    totals[slot] += u64::from(*value);
                }
                mess_total += u64::from(self.mess_per_day[day]);
            }
        }
        let days = whole.max(1) as f64;
        let mean: String = LogKind::ALL
            .iter()
            .map(|kind| format!("{:>15.1}", totals[*kind as usize] as f64 / days))
            .collect();
        let all: u64 = totals.iter().sum();
        println!(
            "{:<5}{mean} {:>6.1} {:>5.1}",
            "mean",
            all as f64 / days,
            mess_total as f64 / days
        );
        println!(
            "largest tick {}; largest {FRAME_TICKS} consecutive ticks {}; staging ring {STAGING_CAPACITY}, a quarter is {}; dropped {}",
            self.largest_tick,
            self.largest_frame,
            STAGING_CAPACITY / 4,
            sim.activity_log_dropped()
        );
    }
}
