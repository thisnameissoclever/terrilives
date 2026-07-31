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
//! It runs the **shipped** content, the **shipped** lot and the **shipped
//! household** - Terri, Doug and Nadia out of `content/household.toml`, the
//! same spawn the page performs - so what it reports is what a player would
//! get.
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
//! - **Who does what**, per sim. Goal item 1's criterion is "visibly
//!   different behaviour traceable to personality data", and this table is
//!   that criterion as numbers: three sims whose top objects agree are three
//!   copies of one person whatever the personality file says.
//! - **The need bands, per sim.** A need pinned at zero is unsatisfiable
//!   ([C2]), and with personalities it can be unsatisfiable for ONE sim -
//!   Nadia's social floor is the shipped case to watch, and her archetype's
//!   comment names this table as the place to watch it.
//! - **Objects never used at all**, because an object nobody chooses is
//!   furniture, and no static check can see it ([C6]).

use std::collections::BTreeMap;
use terri_core::{Eating, Entity, NeedId, Needs, Path, SimId, SimName, Wander, NEED_COUNT};
use terri_sim::Sim;

struct Interaction {
    /// Index into the `sims` vec, so per-sim and aggregate views come off
    /// one list rather than two that could disagree.
    sim: usize,
    object: String,
    ticks: u32,
}

/// Per-sim motion tallies. Summed for the aggregate view, so the two
/// cannot drift.
#[derive(Default, Clone)]
struct Motion {
    walking: u64,
    interacting: u64,
    paused: u64,
    frozen: u64,
}

fn main() {
    let ticks: u64 = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(12_000);

    let pack = terri_data::pack();
    let mut sim = Sim::new_from_shipped_lot();

    // The household, in SimId order - which is declaration order in
    // content/household.toml, so this trace's "sim 0" is the page's Terri.
    let mut sims: Vec<(Entity, String)> = {
        let world = sim.world_mut();
        let mut state = world
            .query::<(Entity, &SimId, &SimName)>()
            .iter(world)
            .map(|(entity, id, name)| (id.0, entity, name.0.clone()))
            .collect::<Vec<_>>();
        state.sort_by_key(|(id, ..)| *id);
        state
            .into_iter()
            .map(|(_, entity, name)| (entity, name))
            .collect()
    };
    if sims.is_empty() {
        // A trace of nobody would print all-zero tables that look like a
        // catastrophically broken game rather than an empty household.
        eprintln!("the shipped household is empty; nothing to trace");
        return;
    }
    sims.truncate(sims.len()); // (fixed size from here on; indices are stable)

    // The interaction in progress per sim, as (object name, sampled length).
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
    let mut running: Vec<Option<(String, u32)>> = vec![None; sims.len()];
    let mut interactions: Vec<Interaction> = Vec::new();

    let mut low = vec![[f32::INFINITY; NEED_COUNT]; sims.len()];
    let mut high = vec![[f32::NEG_INFINITY; NEED_COUNT]; sims.len()];
    let mut motion = vec![Motion::default(); sims.len()];

    for _ in 0..ticks {
        sim.tick();

        let world = sim.world();
        for (index, (agent, _)) in sims.iter().enumerate() {
            let agent = *agent;
            let needs = world.get::<Needs>(agent).expect("a sim keeps its needs");
            for (need, id) in NeedId::ALL.iter().enumerate() {
                let level = needs.get(*id);
                low[index][need] = low[index][need].min(level);
                high[index][need] = high[index][need].max(level);
            }

            // Motion, and **`Eating` is tested first on purpose**. A `Wander`
            // marker is not cleared while an interaction runs, so testing it
            // before `Eating` counts every tick of every meal as a wander
            // pause: the first version of this harness reported 52.3% of the
            // run paused and 0.2% interacting, for 124 interactions averaging
            // 30 ticks, which cannot both be true. The ordering here is the
            // whole difference between that and a usable figure.
            if world.get::<Eating>(agent).is_some() {
                motion[index].interacting += 1;
            } else if world.get::<Path>(agent).is_some() {
                motion[index].walking += 1;
            } else if world.get::<Wander>(agent).is_some() {
                motion[index].paused += 1;
            } else {
                motion[index].frozen += 1;
            }

            match (world.get::<Eating>(agent), running[index].take()) {
                // Already counted; carry it forward untouched.
                (Some(_), Some(open)) => running[index] = Some(open),
                (Some(eating), None) => {
                    running[index] = Some((
                        pack.object(eating.object).id.clone(),
                        eating.remaining_ticks + 1,
                    ));
                }
                (None, Some((object, sampled))) => interactions.push(Interaction {
                    sim: index,
                    object,
                    ticks: sampled,
                }),
                (None, None) => {}
            }
        }
    }
    for (index, open) in running.iter().enumerate() {
        if let Some((object, elapsed)) = open {
            // Counted, and flagged, because an interaction still running at
            // the end is truncated and its length is a floor, not a sample.
            println!(
                "({}'s {object} interaction was still running at tick {ticks}: \
                 {elapsed} ticks so far, not counted)",
                sims[index].1
            );
        }
    }

    let mut per_object: BTreeMap<&str, Vec<u32>> = BTreeMap::new();
    for entry in &interactions {
        per_object
            .entry(entry.object.as_str())
            .or_default()
            .push(entry.ticks);
    }

    println!(
        "\n{ticks} ticks ({:.1} min at 1x), household of {}\n",
        ticks as f64 / 600.0,
        sims.len()
    );

    println!("INTERACTIONS  {} total, all sims", interactions.len());
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
            // them apart is worth the branch.** Roughly a third of the house
            // advertises nothing at all - the counter, the coat rack, the box
            // nobody unpacked - and they are meant to. Flagging those as a
            // finding buried the interactive objects that really were at zero
            // under twelve that never could be anything else, which is
            // docs/testing-protocol.md rule 5 from the other end: a signal
            // that fires on everything says nothing.
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

    // WHO DOES WHAT. Goal item 1's "visibly different behaviour traceable to
    // personality data", as numbers: each sim's interactions by object, most
    // used first. Three sims with the same top three are three copies of one
    // person, whatever content/personalities.toml says - and per-sim
    // back-to-back repeats sit here too, because [C5] is a fact about one
    // sim's sequence and an aggregate over interleaved sims would understate
    // it in proportion to the household size.
    println!("\nWHO DOES WHAT");
    for (index, (_, name)) in sims.iter().enumerate() {
        let mine: Vec<&Interaction> = interactions.iter().filter(|i| i.sim == index).collect();
        let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
        for entry in &mine {
            *counts.entry(entry.object.as_str()).or_default() += 1;
        }
        let mut ranked: Vec<(&str, usize)> = counts.into_iter().collect();
        ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));

        let repeats = mine
            .windows(2)
            .filter(|pair| pair[0].object == pair[1].object)
            .count();
        let listed = ranked
            .iter()
            .map(|(object, count)| format!("{object} {count}"))
            .collect::<Vec<_>>()
            .join(", ");
        println!(
            "{:<8} {:>3} interactions, {} back to back  |  {}",
            name,
            mine.len(),
            repeats,
            listed
        );
    }

    // WHY an object never wins, rather than only that it does not: what
    // selection saw for every object at the end of the run, PER SIM, since
    // personality entered scoring - the same score_advertisement, the same
    // habituation multiplier, the same disposition and satisfaction weights,
    // the same distance. A table that skipped the personality terms would be
    // the trace lying about exactly the thing it exists to explain.
    {
        use terri_core::{Habituation, Personality, Position, SmartObject, TileGrid};
        use terri_sim::systems::advertise::{benefit_scale, scaled_delta, score_advertisement};

        let grid = sim.world().resource::<TileGrid>().clone();
        let mut state = sim.world_mut().query::<(&Position, &SmartObject)>();
        let placed: Vec<(Position, SmartObject)> = {
            let world = sim.world();
            state.iter(world).map(|(p, o)| (*p, *o)).collect()
        };

        for (agent, name) in &sims {
            let agent = *agent;
            let world = sim.world();
            let agent_pos = *world.get::<Position>(agent).expect("a sim has a position");
            let hab = world.get::<Habituation>(agent).cloned().unwrap_or_default();
            let personality = world.get::<Personality>(agent).cloned().unwrap_or_default();
            let needs = *world.get::<Needs>(agent).expect("a sim has needs");
            let from = (agent_pos.x.round() as i32, agent_pos.y.round() as i32);

            println!("\nCANDIDATE TABLE at tick {ticks}: {name} at {from:?}");
            println!(
                "{:<14} {:>5} {:>6} {:>6} {:>6} {:>9}  contributions",
                "object", "dist", "hab", "disp", "scale", "score"
            );
            for (pos, object) in &placed {
                let def = pack.object(object.0);
                let to = (pos.x.round() as i32, pos.y.round() as i32);
                // The object's own rectangle, matching `select_action`.
                // Passing 1x1 here would print a distance the simulation
                // does not use for any object wider than a tile.
                let Some(steps) = grid.find_path_adjacent(from, to, def.footprint) else {
                    if !def.interactions.is_empty() {
                        println!("{:<14} unreachable", def.id);
                    }
                    continue;
                };
                let distance = steps.len() as f32;
                for (index, act) in def.interactions.iter().enumerate() {
                    let h = hab.get(object.0, index as u32);
                    let disposition = personality.disposition(object.0, index as u32);
                    let scale = benefit_scale(h, pack.tuning.habituation_floor) * disposition;
                    let mut total = 0.0;
                    let mut parts = String::new();
                    for (need_index, delta) in &act.advertises {
                        let id = NeedId::ALL[*need_index as usize];
                        let satisfaction = personality.satisfaction[*need_index as usize];
                        let d = scaled_delta(*delta, scale * satisfaction);
                        let c =
                            score_advertisement(needs.deficit(id), d, act.duration_ticks, distance);
                        total += c;
                        parts.push_str(&format!("{id:?} {c:.4} (lvl {:.0}) ", needs.get(id)));
                    }
                    println!(
                        "{:<14} {:>5.0} {:>6.2} {:>6.2} {:>6.2} {:>9.4}  {}",
                        def.id, distance, h, disposition, scale, total, parts
                    );
                }
            }
        }
        println!(
            "(action_threshold {:.3}, idle_threshold {:.3}, temperature {:.3})",
            pack.tuning.action_threshold,
            pack.tuning.idle_threshold,
            pack.tuning.choice_temperature
        );
    }

    // SUPPLY AGAINST DEMAND, per need. The column that would have found [C6]
    // and the sink immediately instead of after five wrong guesses between
    // them.
    //
    // Drain now sums each sim's own multiplied rate, because Nadia's social
    // genuinely drains 1.4x as fast as the file rate and a table that used
    // the bare rate would overstate every ratio she is part of.
    {
        use terri_core::Personality;

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
        let mut drained = [0.0f32; NEED_COUNT];
        for (agent, _) in &sims {
            let personality = sim
                .world()
                .get::<Personality>(*agent)
                .cloned()
                .unwrap_or_default();
            for (index, total) in drained.iter_mut().enumerate() {
                *total += pack.decay_per_tick[index] * personality.drain[index] * ticks as f32;
            }
        }

        println!("\nSUPPLY vs DRAIN over {ticks} ticks, all sims");
        println!(
            "{:<10} {:>9} {:>9} {:>8}   floors: {}",
            "need",
            "supplied",
            "drained",
            "ratio",
            sims.iter()
                .map(|(_, name)| format!("{name:>7}"))
                .collect::<Vec<_>>()
                .join(" ")
        );
        for (index, id) in NeedId::ALL.iter().enumerate() {
            let ratio = supply[index] / drained[index].max(0.0001);
            // **The FLOOR is the diagnostic, not the ratio**, and calibrating
            // this the other way round was a mistake worth leaving a note
            // about; the ratio is kept beside it as the explanation rather
            // than the test. What kills a single-need object is the need's
            // LEVEL never falling far, because score is `delta * deficit^3`
            // and a cubed small deficit is indistinguishable from zero. With
            // a household the flag reads the LOWEST floor across sims: an
            // object is worth keeping if it is worth something to somebody.
            let worst = (0..sims.len())
                .map(|s| low[s][index])
                .fold(f32::INFINITY, f32::min);
            let flag = if worst > 75.0 {
                "  <-- FLOOR TOO HIGH: an object advertising only this scores ~0 for everyone"
            } else if worst < 8.0 {
                "  <-- floor near zero: somebody is barely being served"
            } else {
                ""
            };
            println!(
                "{:<10} {:>9.0} {:>9.0} {:>8.2}           {}{}",
                format!("{id:?}").to_lowercase(),
                supply[index],
                drained[index],
                ratio,
                (0..sims.len())
                    .map(|s| format!("{:>7.1}", low[s][index]))
                    .collect::<Vec<_>>()
                    .join(" "),
                flag
            );
        }
    }

    println!("\nNEED BANDS, per sim");
    for (index, (_, name)) in sims.iter().enumerate() {
        println!("{name}:");
        for (need, id) in NeedId::ALL.iter().enumerate() {
            let pinned = if low[index][need] <= 0.0 {
                "  <-- hit zero"
            } else {
                ""
            };
            println!(
                "  {:<10} {:>6.1} to {:>6.1}{}",
                format!("{id:?}").to_lowercase(),
                low[index][need],
                high[index][need],
                pinned
            );
        }
    }

    // Aggregate motion is per sim-tick, so the shares still sum to 100
    // whatever the household size; the per-sim idle column is where a lone
    // couch potato would show.
    let total: Motion = motion.iter().fold(Motion::default(), |sum, m| Motion {
        walking: sum.walking + m.walking,
        interacting: sum.interacting + m.interacting,
        paused: sum.paused + m.paused,
        frozen: sum.frozen + m.frozen,
    });
    let sim_ticks = (ticks * sims.len() as u64).max(1);
    println!("\nMOTION, all sims");
    println!(
        "walking     {:>6}  {:>5.1}%",
        total.walking,
        100.0 * total.walking as f64 / sim_ticks as f64
    );
    println!(
        "interacting {:>6}  {:>5.1}%",
        total.interacting,
        100.0 * total.interacting as f64 / sim_ticks as f64
    );
    println!(
        "wander pause{:>6}  {:>5.1}%",
        total.paused,
        100.0 * total.paused as f64 / sim_ticks as f64
    );
    println!(
        "frozen      {:>6}  {:>5.1}%   <-- dead band plus anything unexplained",
        total.frozen,
        100.0 * total.frozen as f64 / sim_ticks as f64
    );
    for (index, (_, name)) in sims.iter().enumerate() {
        let m = &motion[index];
        println!(
            "  {:<8} walk {:>4.1}%  interact {:>4.1}%  idle {:>4.1}%",
            name,
            100.0 * m.walking as f64 / ticks as f64,
            100.0 * m.interacting as f64 / ticks as f64,
            100.0 * (m.paused + m.frozen) as f64 / ticks as f64
        );
    }

    println!("\nworld hash {:#018x}", sim.world_hash());
}
