//! The activity log's simulation cost and bounded state, for [AL-perf] in
//! `docs/specs/2026-10-18-activity-log.md`.
//!
//!     cargo run --release -p terri-sim --example activity_log_cost -- \
//!         [--ticks 28800] [--chunk 1440] [--seed S] [--agents N] [--frame 5]
//!
//! Two worlds with the same seed run in lockstep in one process, one with
//! the log on and one with it off. Each chunk of ticks runs on both, in an
//! order that alternates from chunk to chunk, so a slow spell on a shared
//! machine lands on both modes rather than on one run of a pair. Each world
//! is drained every `--frame` ticks, as the page drains once a frame; the
//! disabled world's take returns nothing, as `?activitylog=0`'s does.
//!
//! For each chunk it prints the wall time and, on Windows, the thread's CPU
//! cycles from `QueryThreadCycleTime`, which leave out time the thread spent
//! descheduled. The summary gives the log's cost as a percentage of the
//! disabled world's: the ratio of the totals, and the median of the chunk
//! ratios with a bootstrap 95 percent interval. After every chunk it checks
//! that both worlds hash the same, and prints the log's own state: records
//! staged and dropped, the most records one frame staged, and the scratch
//! area's entry counts, which must stop growing.
//!
//! `--agents N` adds filler agents the way `?stress=N` does
//! (`web/src/debug/stress-spawn.ts`): every walkable cell once in row-major
//! order, then the accepted cells again in turn, each with hunger 100.

use std::time::{Duration, Instant};
use terri_sim::activity_log::{LogKind, RECORD_WORDS};
use terri_sim::Sim;

struct Args {
    ticks: u64,
    chunk: u64,
    seed: Option<u64>,
    agents: usize,
    frame: u64,
}

fn parse_args() -> Args {
    let mut args = Args {
        ticks: 28_800,
        chunk: 1_440,
        seed: None,
        agents: 0,
        frame: 5,
    };
    let mut input = std::env::args().skip(1);
    while let Some(flag) = input.next() {
        let mut value = || -> u64 {
            input
                .next()
                .and_then(|value| value.parse().ok())
                .unwrap_or_else(|| panic!("{flag} needs a whole number"))
        };
        match flag.as_str() {
            "--ticks" => args.ticks = value(),
            "--chunk" => args.chunk = value(),
            "--seed" => args.seed = Some(value()),
            "--agents" => args.agents = value() as usize,
            "--frame" => args.frame = value(),
            other => panic!("unknown argument {other}"),
        }
    }
    assert!(
        args.ticks > 0 && args.chunk > 0 && args.frame > 0,
        "counts must be positive"
    );
    args
}

/// The thread's CPU cycles so far, where the platform reports them.
#[cfg(windows)]
fn thread_cycles() -> Option<u64> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThread() -> *mut core::ffi::c_void;
        fn QueryThreadCycleTime(thread: *mut core::ffi::c_void, cycles: *mut u64) -> i32;
    }
    let mut cycles = 0u64;
    // SAFETY: the pseudo-handle of the calling thread is always valid and
    // `cycles` is a live, aligned u64.
    let ok = unsafe { QueryThreadCycleTime(GetCurrentThread(), &mut cycles) };
    (ok != 0).then_some(cycles)
}

#[cfg(not(windows))]
fn thread_cycles() -> Option<u64> {
    None
}

/// Filler agents placed as `spawnStressAgents` places them.
fn spawn_filler(sim: &mut Sim, requested: usize) {
    if requested == 0 {
        return;
    }
    let (width, height) = {
        let grid = sim.world().resource::<terri_core::TileGrid>();
        (grid.width(), grid.height())
    };
    let edges = sim
        .world()
        .resource::<terri_core::layout::SavedLayout>()
        .has_edges();
    let walkable = |sim: &Sim, x: usize, y: usize| {
        !edges
            || sim
                .world()
                .resource::<terri_core::TileGrid>()
                .is_walkable(x as i32, y as i32)
    };
    let mut accepted = Vec::new();
    for cell in 0..width * height {
        if accepted.len() == requested {
            break;
        }
        let (x, y) = (cell % width, cell / width);
        if walkable(sim, x, y) {
            sim.spawn_agent(
                terri_core::Position {
                    x: x as f32,
                    y: y as f32,
                },
                100.0,
            );
            accepted.push((x, y));
        }
    }
    assert!(!accepted.is_empty(), "no cell accepted a filler agent");
    for index in 0..requested - accepted.len() {
        let (x, y) = accepted[index % accepted.len()];
        sim.spawn_agent(
            terri_core::Position {
                x: x as f32,
                y: y as f32,
            },
            100.0,
        );
    }
}

/// What one world's log did over the run.
#[derive(Default)]
struct LogState {
    records: u64,
    largest_frame: u32,
    /// Records of each kind in the largest frame, indexed by kind code, and
    /// the tick that frame ended on.
    largest_kinds: [u32; 13],
    largest_tick: u64,
}

/// Runs `ticks` ticks, taking the log every `frame` ticks, and returns the
/// wall time and thread cycles of the loop.
fn run_chunk(
    sim: &mut Sim,
    ticks: u64,
    frame: u64,
    state: &mut LogState,
) -> (Duration, Option<u64>) {
    let cycles = thread_cycles();
    let started = Instant::now();
    for tick in 1..=ticks {
        sim.tick();
        if tick.is_multiple_of(frame) || tick == ticks {
            let taken = sim.take_activity_log_export();
            state.records += u64::from(taken);
            if taken > state.largest_frame {
                state.largest_frame = taken;
                state.largest_tick = sim.world().resource::<terri_core::SimClock>().tick;
                state.largest_kinds = [0; 13];
                for record in sim.activity_log_export().chunks_exact(RECORD_WORDS) {
                    let code = (record[2] & 0xff) as usize;
                    if code < state.largest_kinds.len() {
                        state.largest_kinds[code] += 1;
                    }
                }
            }
        }
    }
    let elapsed = started.elapsed();
    let spent = cycles.zip(thread_cycles()).map(|(from, to)| to - from);
    (elapsed, spent)
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    let middle = values.len() / 2;
    if values.len().is_multiple_of(2) {
        (values[middle - 1] + values[middle]) / 2.0
    } else {
        values[middle]
    }
}

/// A bootstrap 95 percent interval of the median, from a fixed-seed
/// generator so a run's summary can be reproduced from its chunk table.
fn median_interval(values: &[f64]) -> (f64, f64) {
    let mut state = 0x2545_f491_4f6c_dd1du64;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    let mut medians: Vec<f64> = (0..4_000)
        .map(|_| {
            let mut sample: Vec<f64> = (0..values.len())
                .map(|_| values[(next() % values.len() as u64) as usize])
                .collect();
            median(&mut sample)
        })
        .collect();
    medians.sort_by(f64::total_cmp);
    let at = |share: f64| medians[((medians.len() - 1) as f64 * share).round() as usize];
    (at(0.025), at(0.975))
}

fn percent(ratio: f64) -> f64 {
    (ratio - 1.0) * 100.0
}

fn summarize(name: &str, on: &[f64], off: &[f64]) {
    let total = on.iter().sum::<f64>() / off.iter().sum::<f64>();
    let mut ratios: Vec<f64> = on.iter().zip(off).map(|(on, off)| on / off).collect();
    let (low, high) = median_interval(&ratios);
    let middle = median(&mut ratios);
    let quartile = |share: f64| ratios[((ratios.len() - 1) as f64 * share).round() as usize];
    println!(
        "{name}: totals on {:.1} off {:.1}; log cost {:+.2}% of the totals; median chunk {:+.2}% (95% interval {:+.2}% to {:+.2}%); quartiles {:+.2}% to {:+.2}%",
        on.iter().sum::<f64>(),
        off.iter().sum::<f64>(),
        percent(total),
        percent(middle),
        percent(low),
        percent(high),
        percent(quartile(0.25)),
        percent(quartile(0.75)),
    );
}

fn main() {
    let args = parse_args();
    let seed = args.seed.unwrap_or(terri_data::pack().tuning.rng_seed);
    let mut on = Sim::new_from_shipped_lot_with_seed(seed);
    let mut off = Sim::new_from_shipped_lot_with_seed(seed);
    off.set_activity_log_enabled(false);
    spawn_filler(&mut on, args.agents);
    spawn_filler(&mut off, args.agents);
    assert_eq!(on.world_hash(), off.world_hash(), "worlds differ at start");
    println!(
        "seed {seed}; {} filler agents; {} ticks in chunks of {}; a take every {} ticks",
        args.agents, args.ticks, args.chunk, args.frame
    );
    println!(
        "{:>5} {:>6} {:>10} {:>10} {:>7} {:>14} {:>14} {:>7} {:>8} {:>7} {:>7} {:>8} {:>9} {:>9}",
        "chunk",
        "first",
        "on ms",
        "off ms",
        "ratio",
        "on cycles",
        "off cycles",
        "ratio",
        "records",
        "frame",
        "dropped",
        "company",
        "nuisances",
        "feelings"
    );
    let (mut on_state, mut off_state) = (LogState::default(), LogState::default());
    let (mut on_ms, mut off_ms, mut on_cycles, mut off_cycles) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut done = 0u64;
    let mut chunk = 0usize;
    while done < args.ticks {
        let ticks = args.chunk.min(args.ticks - done);
        let enabled_first = chunk.is_multiple_of(2);
        let (on_time, off_time) = if enabled_first {
            let a = run_chunk(&mut on, ticks, args.frame, &mut on_state);
            let b = run_chunk(&mut off, ticks, args.frame, &mut off_state);
            (a, b)
        } else {
            let b = run_chunk(&mut off, ticks, args.frame, &mut off_state);
            let a = run_chunk(&mut on, ticks, args.frame, &mut on_state);
            (a, b)
        };
        done += ticks;
        assert_eq!(
            on.world_hash(),
            off.world_hash(),
            "the log changed the world by tick {done}"
        );
        assert_eq!(off_state.records, 0, "the disabled log staged records");
        let (company, nuisances, feelings) = on.activity_log().scratch_sizes();
        let ms = |time: Duration| time.as_secs_f64() * 1_000.0;
        on_ms.push(ms(on_time.0));
        off_ms.push(ms(off_time.0));
        if let (Some(a), Some(b)) = (on_time.1, off_time.1) {
            on_cycles.push(a as f64);
            off_cycles.push(b as f64);
        }
        println!(
            "{:>5} {:>6} {:>10.1} {:>10.1} {:>7.4} {:>14} {:>14} {:>7} {:>8} {:>7} {:>7} {:>8} {:>9} {:>9}",
            chunk + 1,
            if enabled_first { "on" } else { "off" },
            ms(on_time.0),
            ms(off_time.0),
            ms(on_time.0) / ms(off_time.0),
            on_time.1.map_or("n/a".into(), |c| c.to_string()),
            off_time.1.map_or("n/a".into(), |c| c.to_string()),
            on_time
                .1
                .zip(off_time.1)
                .map_or("n/a".into(), |(a, b)| format!("{:.4}", a as f64 / b as f64)),
            on_state.records,
            on_state.largest_frame,
            on.activity_log_dropped(),
            company,
            nuisances,
            feelings,
        );
        chunk += 1;
    }
    println!(
        "records {}; largest frame {}; dropped {}; the worlds hashed the same after every chunk",
        on_state.records,
        on_state.largest_frame,
        on.activity_log_dropped()
    );
    let kinds: Vec<String> = LogKind::ALL
        .iter()
        .filter(|kind| on_state.largest_kinds[**kind as usize] > 0)
        .map(|kind| format!("{kind:?} {}", on_state.largest_kinds[*kind as usize]))
        .collect();
    println!(
        "largest frame ended at tick {}: {}",
        on_state.largest_tick,
        kinds.join(", ")
    );
    summarize("wall time ms", &on_ms, &off_ms);
    if !on_cycles.is_empty() {
        summarize("thread cycles", &on_cycles, &off_cycles);
    }
}
