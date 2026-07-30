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
const START: (f32, f32, f32) = (9.0, 2.0, 25.0);

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
    let mut sim = Sim::new_from_lot(&pack.lot, &pack.objects);
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
        "{:<20} {:>5} {:>6} {:>5} {:>5} {:>6}  {:<12}",
        "object", "count", "share", "min", "max", "mean", "content"
    );
    for object in &pack.objects {
        let lengths = per_object.get(object.id.as_str());
        let declared: Vec<String> = object
            .interactions
            .iter()
            .map(|i| i.duration_ticks.to_string())
            .collect();
        match lengths {
            // **"Never used" and "not usable" are different rows, and telling
            // them apart is worth the branch.** Since the five-room house,
            // roughly half the objects in the lot advertise nothing at all -
            // the counter, the coat rack, the box nobody unpacked - and they
            // are meant to. Flagging those as a finding buried the six
            // interactive objects that really were at zero under twelve that
            // never could be anything else, which is the failure mode
            // docs/testing-protocol.md rule 5 describes from the other end: a
            // signal that fires on everything says nothing.
            None if object.interactions.is_empty() => println!(
                "{:<20} {:>5} {:>6} {:>5} {:>5} {:>6}  {:<12} (scenery)",
                object.id, "-", "-", "-", "-", "-", ""
            ),
            None => println!(
                "{:<20} {:>5} {:>6} {:>5} {:>5} {:>6}  {:<12} <-- NEVER USED",
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
                    "{:<20} {:>5} {:>5.1}% {:>5} {:>5} {:>6.1}  {:<12}{}",
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

    // WHY an object never wins, rather than only that it does not. Recomputes
    // what selection saw for every object at the end of the run: the same
    // score_advertisement, the same habituation multiplier, the same distance.
    {
        use terri_core::{Habituation, Position, SmartObject, TileGrid};
        let agent_pos = *sim
            .world()
            .get::<Position>(agent)
            .expect("agent has a position");
        let hab = sim
            .world()
            .get::<Habituation>(agent)
            .cloned()
            .unwrap_or_default();
        let needs = *sim.world().get::<Needs>(agent).expect("agent has needs");
        let grid = sim.world().resource::<TileGrid>().clone();
        let from = (agent_pos.x.round() as i32, agent_pos.y.round() as i32);

        println!(
            "
CANDIDATE TABLE at tick {ticks}, agent at {from:?}"
        );
        println!(
            "{:<12} {:>5} {:>6} {:>6} {:>9}  contributions",
            "object", "dist", "hab", "scale", "score"
        );
        let mut state = sim.world_mut().query::<(&Position, &SmartObject)>();
        let placed: Vec<(Position, SmartObject)> =
            state.iter(sim.world()).map(|(p, o)| (*p, *o)).collect();
        for (pos, object) in placed {
            let def = pack.object(object.0);
            let to = (pos.x.round() as i32, pos.y.round() as i32);
            // The object's own rectangle, matching `select_action`. Passing
            // 1x1 here would print a distance the simulation does not use for
            // any object wider than a tile, which is the trace lying about
            // exactly the thing it exists to explain.
            let Some(steps) = grid.find_path_adjacent(from, to, def.footprint) else {
                println!("{:<12} unreachable", def.id);
                continue;
            };
            let distance = steps.len() as f32;
            for (index, act) in def.interactions.iter().enumerate() {
                let h = hab.get(object.0, index as u32);
                let scale = 1.0 - h * (1.0 - pack.tuning.habituation_floor);
                let mut total = 0.0;
                let mut parts = String::new();
                for (need_index, delta) in &act.advertises {
                    let id = NeedId::ALL[*need_index as usize];
                    let d = if *delta > 0.0 { delta * scale } else { *delta };
                    let c = terri_sim::systems::advertise::score_advertisement(
                        needs.deficit(id),
                        d,
                        act.duration_ticks,
                        distance,
                    );
                    total += c;
                    parts.push_str(&format!("{id:?} {c:.4} (lvl {:.0}) ", needs.get(id)));
                }
                println!(
                    "{:<12} {:>5.0} {:>6.2} {:>6.2} {:>9.4}  {}",
                    def.id, distance, h, scale, total, parts
                );
            }
        }
        println!(
            "(action_threshold {:.3}, idle_threshold {:.3}, temperature {:.3})",
            pack.tuning.action_threshold,
            pack.tuning.idle_threshold,
            pack.tuning.choice_temperature
        );
    }

    // SUPPLY AGAINST DEMAND, per need. The column that would have found [C6] and
    // the sink immediately instead of after five wrong guesses between them.
    //
    // A need whose suppliers deliver more than it drains sits near full for the
    // whole run, so its deficit stays tiny - and because score is
    // `delta * deficit^3`, a cubed tiny deficit is indistinguishable from zero.
    // Any object that advertises ONLY that need is then permanently worthless,
    // whatever its delta and whatever its duration. That is not a balance nudge
    // away from working; it is a zero, and both `fun` and `hygiene` were in that
    // state on shipped content.
    {
        let mut supply = [0.0f32; NEED_COUNT];
        for entry in &interactions {
            let def = pack
                .objects
                .iter()
                .find(|o| o.id == entry.object)
                .expect("traced object is in the pack");
            // The FIRST interaction, matching what UseObject and single-
            // interaction content both do. Good enough for a supply estimate.
            for (need_index, delta) in &def.interactions[0].advertises {
                if *delta > 0.0 {
                    supply[*need_index as usize] += delta;
                }
            }
        }
        println!(
            "
SUPPLY vs DRAIN over {ticks} ticks"
        );
        println!(
            "{:<10} {:>9} {:>9} {:>8} {:>7}",
            "need", "supplied", "drained", "ratio", "floor"
        );
        for (index, id) in NeedId::ALL.iter().enumerate() {
            let drained = pack.decay_per_tick[index] * ticks as f32;
            let ratio = supply[index] / drained.max(0.0001);
            // **The FLOOR is the diagnostic, not the ratio**, and calibrating
            // this the other way round was a mistake worth leaving a note about.
            //
            // A first version flagged any ratio above 1.35 as over-supplied, and
            // it fingered `bladder` at 2.02 - while the toilet was the
            // most-used object in the house. High ratios are normal: a sim tops
            // a need up before it empties, so supply always exceeds drain by
            // whatever headroom it leaves.
            //
            // What actually kills a single-need object is the need's LEVEL never
            // falling far, because score is `delta * deficit^3` and a cubed
            // small deficit is indistinguishable from zero. `fun` sat at a floor
            // of 98 and `hygiene` at 93; both their single-need objects were
            // used zero and one times. So the flag reads the floor, and the
            // ratio is kept beside it as the explanation rather than the test.
            let flag = if low[index] > 75.0 {
                "  <-- FLOOR TOO HIGH: an object advertising only this scores ~0"
            } else if low[index] < 8.0 {
                "  <-- floor near zero: this need is barely being served"
            } else {
                ""
            };
            println!(
                "{:<10} {:>9.0} {:>9.0} {:>8.2} {:>7.1}{}",
                format!("{id:?}").to_lowercase(),
                supply[index],
                drained,
                ratio,
                low[index],
                flag
            );
        }
    }

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
