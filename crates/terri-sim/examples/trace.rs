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
use terri_core::{
    Eating, Entity, NeedId, Needs, Path, Relationships, Reserved, SimId, SimName, Socialising,
    Wander, NEED_COUNT,
};
use terri_sim::Sim;

struct Interaction {
    /// Index into the `sims` vec, so per-sim and aggregate views come off
    /// one list rather than two that could disagree.
    sim: usize,
    /// Display name only - "fridge", or "chat with Doug". Never parsed
    /// back: the indices below carry the machine-readable identity, so a
    /// social id containing " with " cannot corrupt a lookup.
    object: String,
    ticks: u32,
    /// `Some(index into pack.social)` when this was a conversation - the
    /// discriminant that routes it around the object tables.
    social: Option<u32>,
    /// The partner's index in `sims`, when the partner was still a known
    /// household member at recording time.
    partner: Option<usize>,
}

/// Per-sim motion tallies. Summed for the aggregate view, so the two
/// cannot drift.
#[derive(Default, Clone)]
struct Motion {
    walking: u64,
    interacting: u64,
    /// In a conversation, either side: the initiator carrying
    /// `Socialising` or the partner it points at.
    talking: u64,
    /// Reserved by an initiator who is still walking over. Standing
    /// still on purpose - without this state every conversation's lead-up
    /// would land in `frozen` and read as a dead band.
    waiting: u64,
    paused: u64,
    frozen: u64,
}

fn main() {
    let ticks: u64 = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(12_000);
    if ticks == 0 {
        // Zero ticks traces nothing, and the per-sim percentage lines
        // would divide by it and print NaN, which reads as a broken
        // harness rather than as an empty ask.
        eprintln!("zero ticks traces nothing; pass a positive count");
        return;
    }

    let pack = terri_data::pack();
    let mut sim = Sim::new_from_shipped_lot();

    // The household, in SimId order - which is declaration order in
    // content/household.toml, so this trace's "sim 0" is the page's Terri.
    let sims: Vec<(Entity, String)> = {
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
    // (display name, sampled length, social interaction index if a
    // conversation, partner index if known) - the same fields
    // `Interaction` records, before the record is closed.
    type Open = (String, u32, Option<u32>, Option<usize>);
    let mut running: Vec<Option<Open>> = vec![None; sims.len()];
    let mut interactions: Vec<Interaction> = Vec::new();

    let mut low = vec![[f32::INFINITY; NEED_COUNT]; sims.len()];
    let mut high = vec![[f32::NEG_INFINITY; NEED_COUNT]; sims.len()];
    let mut motion = vec![Motion::default(); sims.len()];

    let index_of = |entity: Entity, sims: &[(Entity, String)]| -> Option<usize> {
        sims.iter().position(|(e, _)| *e == entity)
    };

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

            // Whether somebody's conversation currently points AT this sim,
            // which is the partner's only observable difference from a sim
            // merely reserved-and-waited-for: the partner carries nothing
            // but `Reserved`, by design.
            let is_partner = sims.iter().any(|(other, _)| {
                world
                    .get::<Socialising>(*other)
                    .is_some_and(|s| s.partner == agent)
            });

            // Motion, and **`Eating` is tested first on purpose**. A `Wander`
            // marker is not cleared while an interaction runs, so testing it
            // before `Eating` counts every tick of every meal as a wander
            // pause: the first version of this harness reported 52.3% of the
            // run paused and 0.2% interacting, for 124 interactions averaging
            // 30 ticks, which cannot both be true. The ordering here is the
            // whole difference between that and a usable figure.
            //
            // `Socialising`/partner before `Reserved`, for the same class of
            // reason: a conversing partner is still Reserved, and testing
            // Reserved first would count every tick of every conversation's
            // receiving end as waiting.
            if world.get::<Eating>(agent).is_some() {
                motion[index].interacting += 1;
            } else if world.get::<Socialising>(agent).is_some() || is_partner {
                motion[index].talking += 1;
            } else if world.get::<Reserved>(agent).is_some() {
                motion[index].waiting += 1;
            } else if world.get::<Path>(agent).is_some() {
                motion[index].walking += 1;
            } else if world.get::<Wander>(agent).is_some() {
                motion[index].paused += 1;
            } else {
                motion[index].frozen += 1;
            }

            // One record per meal OR conversation, the same off-by-one
            // correction for both: the ticking system runs after the
            // inserting one inside a single tick, so the first observable
            // value is already one lower than the sample.
            let open_now: Option<(String, u32, Option<u32>, Option<usize>)> =
                if let Some(eating) = world.get::<Eating>(agent) {
                    Some((
                        pack.object(eating.object).id.clone(),
                        eating.remaining_ticks + 1,
                        None,
                        None,
                    ))
                } else {
                    world.get::<Socialising>(agent).map(|s| {
                        let partner = index_of(s.partner, &sims);
                        let with = partner
                            .map(|p| sims[p].1.as_str())
                            .unwrap_or("someone gone");
                        (
                            format!("{} with {}", pack.social[s.interaction as usize].id, with),
                            s.remaining_ticks + 1,
                            Some(s.interaction),
                            partner,
                        )
                    })
                };

            match (open_now, running[index].take()) {
                // Already counted; carry it forward untouched.
                (Some(_), Some(open)) => running[index] = Some(open),
                (Some(fresh), None) => running[index] = Some(fresh),
                (None, Some((object, sampled, social, partner))) => {
                    interactions.push(Interaction {
                        sim: index,
                        object,
                        ticks: sampled,
                        social,
                        partner,
                    })
                }
                (None, None) => {}
            }
        }
    }
    for (index, open) in running.iter().enumerate() {
        if let Some((object, elapsed, _, _)) = open {
            // Counted, and flagged, because an interaction still running at
            // the end is truncated and its length is a floor, not a sample.
            println!(
                "({}'s {object} interaction was still running at tick {ticks}: \
                 {elapsed} ticks so far, not counted)",
                sims[index].1
            );
        }
    }

    // Conversations are routed to their own table: the object table below
    // iterates `pack.objects`, and a chat has no object behind it.
    let mut per_object: BTreeMap<&str, Vec<u32>> = BTreeMap::new();
    for entry in interactions.iter().filter(|i| i.social.is_none()) {
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

    // CONVERSATIONS, by ordered pair: who sought whom out, how often, and
    // for how long. Goal item 2's criterion made countable - and ordered
    // on purpose, because "Nadia chats Doug up 9 times and Doug never once
    // returns the favour" is exactly the asymmetry [H5] stores.
    {
        let talks: Vec<&Interaction> = interactions.iter().filter(|i| i.social.is_some()).collect();
        println!("\nCONVERSATIONS  {} total", talks.len());
        if !talks.is_empty() {
            let mut per_pair: BTreeMap<(usize, usize), Vec<u32>> = BTreeMap::new();
            for entry in &talks {
                // A talk whose partner left the household is counted in
                // the total above but has no pair row to sit in.
                let Some(partner) = entry.partner else {
                    continue;
                };
                per_pair
                    .entry((entry.sim, partner))
                    .or_default()
                    .push(entry.ticks);
            }
            println!(
                "{:<22} {:>5} {:>5} {:>5} {:>6}",
                "initiator -> partner", "count", "min", "max", "mean"
            );
            for ((initiator, partner), lengths) in &per_pair {
                let min = *lengths.iter().min().expect("non-empty");
                let max = *lengths.iter().max().expect("non-empty");
                let mean = lengths.iter().sum::<u32>() as f64 / lengths.len() as f64;
                println!(
                    "{:<22} {:>5} {:>5} {:>5} {:>6.1}",
                    format!("{} -> {}", sims[*initiator].1, sims[*partner].1),
                    lengths.len(),
                    min,
                    max,
                    mean
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
            // The PEOPLE, with the same ARITHMETIC selection uses: no
            // habituation, no disposition, the relationship through
            // `relationship_scale` in their place - [H7]/[H8]. A table
            // that showed only the furniture would be the trace lying
            // about the newest thing selection weighs. Eligibility is a
            // separate question from arithmetic, and rows the live query
            // would filter out - a sim mid-meal, mid-walk, or already in
            // a conversation - are printed anyway with a (busy) marker,
            // because "what would this be worth if they were free" is
            // exactly what a balance pass wants to know.
            let feelings = world
                .get::<Relationships>(agent)
                .cloned()
                .unwrap_or_default();
            for (other, other_name) in &sims {
                if *other == agent {
                    continue;
                }
                let busy = world.get::<terri_core::Target>(*other).is_some()
                    || world.get::<Eating>(*other).is_some()
                    || world.get::<Socialising>(*other).is_some()
                    || world.get::<Path>(*other).is_some()
                    || world.get::<Reserved>(*other).is_some();
                let other_pos = world.get::<Position>(*other).expect("a sim has a position");
                let other_id = world.get::<SimId>(*other).expect("a sim has an id");
                let to = (other_pos.x.round() as i32, other_pos.y.round() as i32);
                let Some(steps) = grid.find_path_adjacent_to_tile(from, to) else {
                    println!("{:<14} unreachable (person)", other_name);
                    continue;
                };
                let distance = steps.len() as f32;
                let feeling = feelings.feeling(*other_id);
                let scale = terri_sim::systems::advertise::relationship_scale(
                    feeling,
                    pack.tuning.relationship_delta_scale,
                );
                for act in &pack.social {
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
                        "{:<14} {:>5.0} {:>6} {:>6.2} {:>6.2} {:>9.4}  {} ({}){}",
                        other_name,
                        distance,
                        "-",
                        feeling,
                        scale,
                        total,
                        parts,
                        act.id,
                        if busy { " (busy)" } else { "" }
                    );
                }
            }
        }
        println!(
            "(action_threshold {:.3}, idle_threshold {:.3}, temperature {:.3}; \
             person rows: third column is the relationship, not a disposition)",
            pack.tuning.action_threshold,
            pack.tuning.idle_threshold,
            pack.tuning.choice_temperature
        );
    }

    // RELATIONSHIPS at the end of the run: every ordered pair, so the
    // asymmetry is visible - [H5] stores A's feeling about B apart from
    // B's about A precisely so these two numbers can disagree.
    println!("\nRELATIONSHIPS at tick {ticks} (row feels about column)");
    {
        let world = sim.world();
        let header = sims
            .iter()
            .map(|(_, name)| format!("{name:>8}"))
            .collect::<Vec<_>>()
            .join("");
        println!("{:<8}{header}", "");
        for (agent, name) in &sims {
            let feelings = world
                .get::<Relationships>(*agent)
                .cloned()
                .unwrap_or_default();
            let row = sims
                .iter()
                .map(|(other, _)| {
                    if other == agent {
                        format!("{:>8}", "-")
                    } else {
                        let id = world.get::<SimId>(*other).expect("a sim has an id");
                        format!("{:>8.3}", feelings.feeling(*id))
                    }
                })
                .collect::<Vec<_>>()
                .join("");
            println!("{name:<8}{row}");
        }
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

        // Supply is what was DELIVERED, so each earning sim's satisfaction
        // multiplier applies - the same asymmetry the drain column already
        // honours, and it matters most on the social row this table exists
        // to watch: Nadia receives 0.75x every social delta she earns, and
        // counting her at full strength would overstate exactly the need
        // [A-9] singles out.
        let satisfaction_of: Vec<[f32; NEED_COUNT]> = sims
            .iter()
            .map(|(agent, _)| {
                sim.world()
                    .get::<terri_core::Personality>(*agent)
                    .map(|p| p.satisfaction)
                    .unwrap_or([1.0; NEED_COUNT])
            })
            .collect();
        let mut supply = [0.0f32; NEED_COUNT];
        for entry in &interactions {
            match entry.social {
                // A conversation supplies BOTH participants, each through
                // their own satisfaction - the partner half only while the
                // partner is a known household member. The relationship
                // multiplier is deliberately omitted: it drifts across the
                // run as feelings form and cool, so any single factor here
                // would be wrong for most of the interactions it
                // multiplied. This column is an estimate and says so.
                Some(social) => {
                    let act = &pack.social[social as usize];
                    for (need_index, delta) in &act.advertises {
                        if *delta > 0.0 {
                            let mut earned = satisfaction_of[entry.sim][*need_index as usize];
                            if let Some(partner) = entry.partner {
                                earned += satisfaction_of[partner][*need_index as usize];
                            }
                            supply[*need_index as usize] += delta * earned;
                        }
                    }
                }
                None => {
                    let def = pack
                        .objects
                        .iter()
                        .find(|o| o.id == entry.object)
                        .expect("traced object is in the pack");
                    // The FIRST interaction, matching what UseObject and
                    // single-interaction content both do. Good enough for a
                    // supply estimate.
                    for (need_index, delta) in &def.interactions[0].advertises {
                        if *delta > 0.0 {
                            supply[*need_index as usize] +=
                                delta * satisfaction_of[entry.sim][*need_index as usize];
                        }
                    }
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
        talking: sum.talking + m.talking,
        waiting: sum.waiting + m.waiting,
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
        "talking     {:>6}  {:>5.1}%",
        total.talking,
        100.0 * total.talking as f64 / sim_ticks as f64
    );
    println!(
        "waiting     {:>6}  {:>5.1}%   <-- reserved for a talk, initiator inbound",
        total.waiting,
        100.0 * total.waiting as f64 / sim_ticks as f64
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
            "  {:<8} walk {:>4.1}%  interact {:>4.1}%  talk {:>4.1}%  idle {:>4.1}%",
            name,
            100.0 * m.walking as f64 / ticks as f64,
            100.0 * m.interacting as f64 / ticks as f64,
            100.0 * (m.talking + m.waiting) as f64 / ticks as f64,
            100.0 * (m.paused + m.frozen) as f64 / ticks as f64
        );
    }

    // The second axis, per sim - what a whole session earned each LIFE
    // ([E1]). Read straight off the components rather than accumulated
    // in the loop, because the ledger IS the accumulator.
    println!("\nLIFE SATISFACTION (accrued over the whole run)");
    for (entity, name) in &sims {
        let ledger = sim
            .world()
            .get::<terri_core::Satisfaction>(*entity)
            .map_or(-1.0, |s| s.value());
        let hobbies = sim
            .world()
            .get::<terri_core::Hobbies>(*entity)
            .map_or_else(String::new, |h| h.0.join(", "));
        println!("  {name:<8} {ledger:>8.1}   loves: {hobbies}");
        // Worn traits with their live states ([E3]): a capability's
        // level says how the learning went, a condition's severity how
        // the managing did. Where the whole trait pass gets measured.
        if let Some(worn) = sim.world().get::<terri_core::Traits>(*entity) {
            for (index, state) in worn.entries() {
                let def = &pack.traits[*index as usize];
                let kind = match def.kind {
                    terri_data::CompiledTraitKind::Disposition { score_multiplier } => {
                        format!("disposition x{score_multiplier}")
                    }
                    terri_data::CompiledTraitKind::Capability { .. } => {
                        format!("capability, level {state:.2}")
                    }
                    terri_data::CompiledTraitKind::Condition { .. } => {
                        format!("condition, severity {state:.2}")
                    }
                };
                println!("           wears: {} ({kind})", def.label);
            }
        }
    }

    println!("\nworld hash {:#018x}", sim.world_hash());
}
