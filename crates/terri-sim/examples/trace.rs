//! Behaviour trace over the shipped lot, for balance passes.
//!
//! **This exists because it kept being thrown away.** Every feel pass so far
//! has rebuilt a throwaway harness, measured against it, quoted the numbers
//! into `content/tuning.toml` and `docs/alpha-feel-notes.md`, and deleted the
//! code - which [L40] complains about directly, because the numbers in those
//! comments are then unreproducible and the next person tuning a knob is back
//! to guessing. It is an example rather than a test: it asserts nothing, it
//! prints, and nothing in CI depends on it.
//!
//! It runs the **shipped** content and the **shipped** lot with the agent
//! `web/src/main.ts` spawns, so what it reports is what a player would get.
//!
//!     cargo run -p terri-sim --example trace -- 12000
//!
//! What it prints, and why each column is here rather than being eyeballed
//! from the running game:
//!
//! - **Interactions per object**, with the sampled length of each. This is
//!   what catches a duration whose whole band is clipped by
//!   `min_interaction_ticks`: the min, max and mean collapse onto one number,
//!   and the object silently delivers `floor / duration_ticks` times its
//!   advertised benefit. Three objects were in that state when it was last
//!   measured.
//! - **The need bands.** A need pinned at zero is unsatisfiable ([C2]); a
//!   need that never drops is over-served.
//! - **Time spent motionless**, split into wander pauses and the dead band
//!   between `idle_threshold` and `action_threshold`. Standing still is the
//!   single most visible thing a sim can do wrong.
//! - **Objects never used at all**, because an object nobody chooses is
//!   furniture, and no static check can see it ([C6]).

use std::collections::BTreeMap;
use terri_core::{Agent, Eating, NeedId, Needs, Path, Position, Wander, NEED_COUNT};
use terri_sim::Sim;

/// Where `web/src/main.ts` spawns the sim, and the hunger it starts with.
/// Kept in step with `START_TILE` there by hand; a divergence makes this
/// trace describe a game nobody plays.
const START: (f32, f32, f32) = (8.0, 6.0, 25.0);

struct Interaction {
    object: String,
    ticks: u32,
}

fn main() {
    let ticks: u64 = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(12_000);

    let pack = terri_data::pack();
    let mut sim = Sim::new_from_lot(&pack.lot);
    let agent = sim
        .world_mut()
        .spawn((
            Agent,
            Position {
                x: START.0,
                y: START.1,
            },
            Needs::with(NeedId::Hunger, START.2),
        ))
        .id();

    // The interaction in progress, as (object name, sampled length).
    //
    // **The length is read once, on first sighting, and it is
    // `remaining_ticks + 1`.** Counting ticks by observation instead gives
    // `sampled - 1` every time, because `follow_path` inserts `Eating` with
    // the full sampled length and `tick_interactions` - last in the chain -
    // decrements it within that same tick, so the first value an outside
    // observer can ever see is already one lower. The first version of this
    // harness counted by observation and reported a minimum of 11 ticks
    // against a floor of 12, which reads as the floor being violated rather
    // than as the observer being off by one.
    let mut running: Option<(String, u32)> = None;
    let mut interactions: Vec<Interaction> = Vec::new();

    let mut low = [f32::INFINITY; NEED_COUNT];
    let mut high = [f32::NEG_INFINITY; NEED_COUNT];
    let mut frozen = 0u64;
    let mut paused = 0u64;
    let mut walking = 0u64;
    let mut interacting = 0u64;

    for _ in 0..ticks {
        sim.tick();

        let world = sim.world();
        let needs = world
            .get::<Needs>(agent)
            .expect("the agent keeps its needs");
        for (index, id) in NeedId::ALL.iter().enumerate() {
            let level = needs.get(*id);
            low[index] = low[index].min(level);
            high[index] = high[index].max(level);
        }

        // Motion, and **`Eating` is tested first on purpose**. A `Wander`
        // marker is not cleared while an interaction runs, so testing it
        // before `Eating` counts every tick of every meal as a wander pause:
        // the first version of this harness reported 52.3% of the run paused
        // and 0.2% interacting, for 124 interactions averaging 30 ticks,
        // which cannot both be true. The ordering here is the whole
        // difference between that and a usable figure.
        //
        // A wander PAUSE is still standing still, which is the distinction
        // `idle_threshold`'s tuning note in content/tuning.toml turns on, so
        // the two are counted separately and summed at the end.
        if world.get::<Eating>(agent).is_some() {
            interacting += 1;
        } else if world.get::<Path>(agent).is_some() {
            walking += 1;
        } else if world.get::<Wander>(agent).is_some() {
            paused += 1;
        } else {
            frozen += 1;
        }

        match (world.get::<Eating>(agent), running.take()) {
            // Already counted; carry it forward untouched.
            (Some(_), Some(open)) => running = Some(open),
            (Some(eating), None) => {
                running = Some((
                    pack.object(eating.object).id.clone(),
                    eating.remaining_ticks + 1,
                ));
            }
            (None, Some((object, sampled))) => interactions.push(Interaction {
                object,
                ticks: sampled,
            }),
            (None, None) => {}
        }
    }
    if let Some((object, elapsed)) = running {
        // Counted, and flagged, because an interaction still running at the
        // end is truncated and its length is a floor rather than a sample.
        println!("(one {object} interaction was still running at tick {ticks}: {elapsed} ticks so far, not counted)");
    }

    let mut per_object: BTreeMap<&str, Vec<u32>> = BTreeMap::new();
    for entry in &interactions {
        per_object
            .entry(entry.object.as_str())
            .or_default()
            .push(entry.ticks);
    }

    // Back-to-back use of the same object, which is [C5]. A finished sim is at
    // distance zero from what it just used - that object's maximum possible
    // score - so choosing it again is unusually likely.
    //
    // **Standing beside the object instead of on it did not change this**, and
    // this comment used to say it cost a tile. It costs nothing:
    // `find_path_adjacent` returns an empty path for an already-adjacent agent,
    // so the distance is 0 either way. Counted rather than assumed, which is
    // how the claim was caught.
    let repeats = interactions
        .windows(2)
        .filter(|pair| pair[0].object == pair[1].object)
        .count();

    println!("\n{ticks} ticks ({:.1} min at 1x)\n", ticks as f64 / 600.0);

    println!("INTERACTIONS  {} total", interactions.len());
    println!(
        "{:<12} {:>5} {:>6} {:>5} {:>5} {:>6}  content",
        "object", "count", "share", "min", "max", "mean"
    );
    for object in &pack.objects {
        let lengths = per_object.get(object.id.as_str());
        let declared: Vec<String> = object
            .interactions
            .iter()
            .map(|i| i.duration_ticks.to_string())
            .collect();
        match lengths {
            None => println!(
                "{:<12} {:>5} {:>6} {:>5} {:>5} {:>6}  {}   <-- NEVER USED",
                object.id,
                0,
                "0.0%",
                "-",
                "-",
                "-",
                declared.join(",")
            ),
            Some(lengths) => {
                let min = *lengths.iter().min().expect("non-empty");
                let max = *lengths.iter().max().expect("non-empty");
                let mean = lengths.iter().sum::<u32>() as f64 / lengths.len() as f64;
                // The tell for a clipped band: no variance at all across
                // repeated interactions means the floor, not the content,
                // is setting the length.
                //
                // **Two samples minimum, or this fires on noise.** A single
                // interaction trivially has min == max, so an object used
                // once was reported as pinned - which is how the sink looked
                // right after its duration was raised, when the real finding
                // was the opposite: it had stopped being chosen. A false
                // "band clipped" pointing at the number that was just fixed
                // is worse than no flag at all.
                let pinned = if min == max && lengths.len() > 1 {
                    "  <-- PINNED, band clipped"
                } else if lengths.len() < 3 {
                    "  <-- too few uses to say anything"
                } else {
                    ""
                };
                println!(
                    "{:<12} {:>5} {:>5.1}% {:>5} {:>5} {:>6.1}  {}{}",
                    object.id,
                    lengths.len(),
                    100.0 * lengths.len() as f64 / interactions.len().max(1) as f64,
                    min,
                    max,
                    mean,
                    declared.join(","),
                    pinned
                );
            }
        }
    }

    println!(
        "\nrepeated the same object back to back: {repeats} of {} ({:.1}%)  [C5]",
        interactions.len().saturating_sub(1),
        100.0 * repeats as f64 / interactions.len().saturating_sub(1).max(1) as f64
    );

    println!("\nNEED BANDS");
    for (index, id) in NeedId::ALL.iter().enumerate() {
        let pinned = if low[index] <= 0.0 {
            "  <-- hit zero"
        } else {
            ""
        };
        println!(
            "{:<10} {:>6.1} to {:>6.1}{}",
            format!("{id:?}").to_lowercase(),
            low[index],
            high[index],
            pinned
        );
    }

    let motionless = frozen + paused;
    println!("\nMOTION");
    println!(
        "walking     {walking:>6}  {:>5.1}%",
        100.0 * walking as f64 / ticks as f64
    );
    println!(
        "interacting {interacting:>6}  {:>5.1}%",
        100.0 * interacting as f64 / ticks as f64
    );
    println!(
        "wander pause{paused:>6}  {:>5.1}%",
        100.0 * paused as f64 / ticks as f64
    );
    println!(
        "frozen      {frozen:>6}  {:>5.1}%   <-- dead band plus anything unexplained",
        100.0 * frozen as f64 / ticks as f64
    );
    println!(
        "motionless  {motionless:>6}  {:>5.1}%   total",
        100.0 * motionless as f64 / ticks as f64
    );

    println!("\nworld hash {:#018x}", sim.world_hash());
}
