//! Observe autonomous need-mood balance in one saved and one seeded household.
//! Run the release example with a local V23 save path, a week count, and a seed.
use std::{
    env,
    error::Error,
    fs::File,
    io::Read,
    path::Path,
    time::{Duration, Instant},
};
use terri_core::{
    Agent, Entity, NeedId, Needs, SaveSnapshotV23, SimClock, NEED_COUNT, NEED_MIN, SAVE_MAGIC,
};
use terri_sim::{
    need_mood::{NeedMood, MAX_UNITS},
    Content, Sim,
};

const MAX_SAVE_BYTES: u64 = 16 * 1024 * 1024;
const SAVE_HEADER_BYTES: usize = SAVE_MAGIC.len() + std::mem::size_of::<u16>();
const MAX_WEEKS: u32 = 12;
const MAX_HOUSEHOLD_RUNTIME: Duration = Duration::from_secs(360);

#[derive(Default)]
struct Week {
    living_minutes: u64,
    mood_ceiling_minutes: u64,
    mood_floor_minutes: u64,
    ledger_ceiling_minutes: u64,
    ledger_floor_minutes: u64,
    high_minutes: [u64; NEED_COUNT],
    zero_minutes: [u64; NEED_COUNT],
}

impl Week {
    fn observe(&mut self, needs: &Needs, high_level: f32, mood: f32, ledger: i32) {
        self.living_minutes += 1;
        self.mood_ceiling_minutes += u64::from(mood == 100.0);
        self.mood_floor_minutes += u64::from(mood == -100.0);
        self.ledger_ceiling_minutes += u64::from(ledger == MAX_UNITS);
        self.ledger_floor_minutes += u64::from(ledger == -MAX_UNITS);
        for need in NeedId::ALL {
            let value = needs.get(need);
            self.high_minutes[need.index()] += u64::from(value > NEED_MIN && value >= high_level);
            self.zero_minutes[need.index()] += u64::from(value == NEED_MIN);
        }
    }

    fn percent(&self, minutes: u64) -> String {
        if self.living_minutes == 0 {
            return String::from("NA");
        }
        format!("{:.4}", 100.0 * minutes as f64 / self.living_minutes as f64)
    }

    fn print(&self, household: &str, week: u32, living: usize) {
        println!(
            "{household},{week},{living},{},{},{},{},{},{},{},{},{}",
            self.living_minutes,
            self.mood_ceiling_minutes,
            self.percent(self.mood_ceiling_minutes),
            self.mood_floor_minutes,
            self.percent(self.mood_floor_minutes),
            self.ledger_ceiling_minutes,
            self.percent(self.ledger_ceiling_minutes),
            self.ledger_floor_minutes,
            self.percent(self.ledger_floor_minutes),
        );
        for need in NeedId::ALL {
            let high = self.high_minutes[need.index()];
            let zero = self.zero_minutes[need.index()];
            println!(
                "need,{household},{week},{need:?},{high},{},{zero},{}",
                self.percent(high),
                self.percent(zero),
            );
        }
    }
}

fn load_household(path: &Path) -> Result<Sim, Box<dyn Error>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_SAVE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_SAVE_BYTES {
        return Err("saved household exceeds the study's file size limit".into());
    }
    let Some((header, payload)) = bytes.split_at_checked(SAVE_HEADER_BYTES) else {
        return Err("truncated save header".into());
    };
    if header[..8] != SAVE_MAGIC {
        return Err("invalid save magic".into());
    }
    let version = u16::from_le_bytes([header[8], header[9]]);
    if version != 23 {
        return Err(format!("study expects a V23 save, received V{version}").into());
    }
    let (snapshot, trailing) = postcard::take_from_bytes::<SaveSnapshotV23>(payload)
        .map_err(|error| format!("V23 decode failed: {error}"))?;
    if !trailing.is_empty() {
        return Err("unexpected bytes after the V23 save".into());
    }
    let mut sim = Sim::new_with_lot(1, 1);
    sim.load_snapshot_v23(snapshot)
        .map_err(|error| format!("V23 save rejected: {error:?}"))?;
    Ok(sim)
}

fn study(household: &str, mut sim: Sim, weeks: u32) -> Result<(), Box<dyn Error>> {
    let deadline = Instant::now() + MAX_HOUSEHOLD_RUNTIME;
    let mut people = sim
        .world_mut()
        .query::<(Entity, &Agent, &Needs, Option<&NeedMood>)>();
    let pack = sim.world().resource::<Content>().0;
    let ticks_per_week = 7 * u64::from(pack.tuning.day_ticks);
    let rates = pack.need_mood;
    let start = sim.world().resource::<SimClock>().tick;
    let initial_living = people.iter(sim.world()).count();
    if initial_living == 0 {
        return Err(format!("{household} has no living people at the start").into());
    }
    println!("start,{household},{start},{initial_living},{ticks_per_week}");
    println!(
        "rates,{household},{},{},{},{MAX_UNITS}",
        rates.high_level, rates.high_gain_units, rates.empty_loss_units
    );
    for week in 1..=weeks {
        let mut totals = Week::default();
        for minute in 0..ticks_per_week {
            if minute % 64 == 0 && Instant::now() >= deadline {
                return Err(format!("time limit reached during {household} week {week}").into());
            }
            sim.tick();
            for (entity, _, needs, ledger) in people.iter(sim.world()) {
                let mood = sim
                    .mood_of(entity.index_u32())
                    .ok_or("living person has no mood snapshot")?;
                totals.observe(
                    needs,
                    rates.high_level,
                    mood.overall_score,
                    ledger.map_or(0, |ledger| ledger.0),
                );
            }
        }
        let expected = start + u64::from(week) * ticks_per_week;
        if sim.world().resource::<SimClock>().tick != expected {
            return Err(format!("{household} did not advance to tick {expected}").into());
        }
        totals.print(household, week, people.iter(sim.world()).count());
    }
    println!("finish,{household},{}", sim.world_hash());
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args_os().skip(1).collect();
    let [path, weeks, seed] = args.as_slice() else {
        return Err("usage: need_mood_study <local-save-path> <weeks> <starter-seed>".into());
    };
    let weeks: u32 = weeks.to_str().ok_or("invalid week count")?.parse()?;
    if !(2..=MAX_WEEKS).contains(&weeks) {
        return Err(format!("week count must be between 2 and {MAX_WEEKS}").into());
    }
    let seed: u64 = seed.to_str().ok_or("invalid starter seed")?.parse()?;
    let saved = load_household(Path::new(path))?;
    println!("inputs,save_version=23,starter_seed={seed},weeks={weeks}");
    println!(
        "household,week,living_at_end,living_minutes,overall_100_minutes,overall_100_percent,\
         overall_negative_100_minutes,overall_negative_100_percent,ledger_100_minutes,\
         ledger_100_percent,ledger_negative_100_minutes,ledger_negative_100_percent"
    );
    println!("kind,household,week,need,high_minutes,high_percent,zero_minutes,zero_percent");
    study("saved", saved, weeks)?;
    study("starter", Sim::new_from_shipped_lot_with_seed(seed), weeks)
}
