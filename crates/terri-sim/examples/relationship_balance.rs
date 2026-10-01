//! Reproducible relationship balance runs: start seed, end seed, optional scenario.
//! `cargo run --release -p terri-sim --example relationship_balance -- 1 16`
use std::collections::{BTreeMap, BTreeSet};
use terri_core::*;
use terri_sim::{relationship_effects::RelationshipCause, Content, Sim};

struct ChainObservation {
    state: ChainState,
    work: Option<u32>,
    started: u64,
    last_progress: u64,
}

#[derive(Clone, Copy, Debug)]
struct Overrides {
    talk_gain: Option<f32>,
    respect: Option<f32>,
    proximity: Option<f32>,
    friction: Option<f32>,
    television: bool,
}

fn furnished(count: usize) -> Sim {
    let pack = terri_data::pack();
    let mut lot = pack.lot.clone();
    lot.width = 18;
    lot.height = 12;
    lot.walls.clear();
    lot.placements.clear();
    lot.front_door = None;
    lot.wall_edges.clear();
    use terri_core::layout::{EdgeAxis, WallEdge};
    for y in 0..12 {
        lot.wall_edges.push(WallEdge {
            axis: EdgeAxis::Vertical,
            x: 12,
            y,
            doorway: y == 2 || y == 8,
        });
    }
    for x in 12..18 {
        lot.wall_edges.push(WallEdge {
            axis: EdgeAxis::Horizontal,
            x,
            y: 6,
            doorway: false,
        });
    }
    for x in 0..12 {
        lot.wall_edges.push(WallEdge {
            axis: EdgeAxis::Horizontal,
            x,
            y: 7,
            doorway: x == 4,
        });
    }
    let mut sim = Sim::new_from_lot(&lot, &pack.objects);
    let bed = pack
        .objects
        .iter()
        .find(|o| {
            o.interactions
                .iter()
                .any(|a| a.tags.iter().any(|t| t == &pack.sleep_tag))
        })
        .unwrap()
        .id
        .clone();
    for (name, x, y) in [
        ("fridge", 0, 0),
        ("stove", 3, 0),
        ("counter", 6, 0),
        ("dining_table", 9, 0),
        ("bookshelf", 0, 4),
        ("reading_chair", 2, 4),
        ("moving_box", 4, 4),
        ("reference_shelf", 7, 4),
        ("reference_shelf", 9, 4),
        ("toilet", 14, 4),
        ("shower", 14, 0),
        ("toilet", 14, 10),
        ("shower", 14, 6),
    ] {
        place(&mut sim, name, x, y);
    }
    for index in 0..count {
        place(&mut sim, &bed, (index * 3) as i32, 9);
        let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
        sim.world_mut().spawn((
            Agent,
            id,
            SimName(format!("Resident {}", index + 1)),
            Shyness::new(50).unwrap(),
            Position {
                x: 1.0 + index as f32 * 2.0,
                y: 2.0,
            },
            Needs::all_at(80.0 + index as f32 * 3.0),
            Personality::with_dispositions([1.0; 7], [1.0; 7], vec![]),
            Satisfaction::default(),
        ));
    }
    sim
}

fn place(sim: &mut Sim, name: &str, x: i32, y: i32) {
    let pack = terri_data::pack();
    let id = pack.find(name).unwrap_or_else(|| panic!("missing {name}"));
    let footprint = pack.object(id).footprint;
    for dy in 0..footprint.depth {
        for dx in 0..footprint.width {
            let (px, py) = (x as usize + dx as usize, y as usize + dy as usize);
            let mut grid = sim.world_mut().resource_mut::<TileGrid>();
            assert!(
                grid.is_walkable(px as i32, py as i32),
                "overlapping {name} at {px},{py}"
            );
            grid.set_blocked(px, py, true);
        }
    }
    sim.spawn_object(
        Position {
            x: x as f32,
            y: y as f32,
        },
        id,
    );
}

fn people(sim: &mut Sim) -> Vec<(Entity, SimId)> {
    let mut result: Vec<_> = sim
        .world_mut()
        .query_filtered::<(Entity, &SimId), bevy_ecs::prelude::With<Agent>>()
        .iter(sim.world())
        .map(|(e, id)| (e, *id))
        .collect();
    result.sort_by_key(|(_, id)| id.0);
    result
}

fn feeling(sim: &Sim, e: Entity, id: SimId) -> f32 {
    sim.world()
        .get::<Relationships>(e)
        .map_or(0.0, |r| r.feeling(id))
}

fn incident(sim: &mut Sim, residents: &[(Entity, SimId)], before: f32) {
    let pack = sim.world().resource::<Content>().0;
    let toilet = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| pack.object(o.0).id == "toilet")
        .unwrap()
        .0;
    let position = *sim.world().get::<Position>(toilet).unwrap();
    // A directed start is one real incident. All subsequent choices are autonomous.
    for &(e, _) in residents {
        if let Some(t) = sim.world().get::<Target>(e).copied() {
            sim.world_mut().entity_mut(t.object).remove::<Reserved>();
        }
        sim.world_mut().entity_mut(e).remove::<(
            Path,
            Target,
            Eating,
            Socialising,
            Reserved,
            ChainState,
            StepWork,
            Commuting,
            AtWork,
        )>();
    }
    let (actor, actor_id) = residents[0];
    let (observer, _) = residents[1];
    sim.world_mut().entity_mut(actor).insert((
        Position {
            x: position.x - 1.0,
            y: position.y,
        },
        Target {
            object: toilet,
            interaction: 0,
        },
        Path {
            steps: vec![],
            cursor: 0,
        },
        IntentQueue::from_intents(vec![Intent {
            object: toilet,
            interaction: 0,
        }]),
    ));
    sim.world_mut().entity_mut(toilet).insert(Reserved);
    let mut rel = Relationships::default();
    rel.bump(actor_id, before);
    sim.world_mut().entity_mut(observer).insert((
        Position {
            x: position.x - 1.0,
            y: position.y + 1.0,
        },
        rel,
    ));
    sim.tick();
    assert!(sim
        .relationship_effects()
        .iter()
        .any(|e| e.cause == RelationshipCause::PrivacyStart && e.affected == residents[1].1));
}

fn run(seed: u64, scenario: &str, without_avoidance: bool, tuning: Overrides) {
    let mut sim = match scenario {
        "shipped" => Sim::new_from_shipped_lot_with_seed(seed),
        "three" => furnished(3),
        "four" => furnished(4),
        _ => furnished(2),
    };
    if scenario != "shipped" {
        sim.world_mut().insert_resource(SimRng::from_seed(seed));
        if tuning.television {
            // Independent company prevents the two-person normal fixture from
            // depending on a simultaneously available conversation partner.
            place(&mut sim, "television", 6, 6);
        }
    }
    {
        let mut pack = sim.world().resource::<Content>().0.clone();
        if let Some(gain) = tuning.talk_gain {
            pack.tuning.relationship_gain_per_talk = gain;
        }
        if let Some(value) = tuning.respect {
            pack.tuning.relationships.privacy_respect_chance = value;
        }
        if let Some(value) = tuning.proximity {
            pack.tuning.relationships.proximity_per_hour = value;
        }
        if let Some(value) = tuning.friction {
            pack.tuning.relationships.friction_per_hour = value;
        }
        if without_avoidance {
            pack.tuning.relationships.privacy_respect_chance = 0.0;
            pack.tuning.social_boundary_avoidance_cost = 0.0;
            pack.tuning.boundary_wander_reconsider_chance = 0.0;
            pack.tuning.shyness_wander_reconsider_strength = 0.0;
        }
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
    }
    let residents = people(&mut sim);
    for &(e, _) in &residents {
        sim.world_mut()
            .entity_mut(e)
            // Keep both behavioral stats at their ordinary midpoint across layouts.
            .insert((Shyness::new(50).unwrap(), SelfPreservation(50)));
    }
    if scenario == "incompatible" {
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.tuning.bathroom_privacy_penalty = 0.0;
        let shelf = pack.find("bookshelf").unwrap();
        let exercise = pack.find("moving_box").unwrap();
        sim.world_mut()
            .insert_resource(Content(Box::leak(Box::new(pack))));
        for (i, &(e, _)) in residents.iter().enumerate() {
            sim.world_mut()
                .entity_mut(e)
                .insert(Personality::with_dispositions(
                    [1.0; 7],
                    [1.0; 7],
                    vec![
                        (shelf, 0, if i == 0 { 2.0 } else { 0.0 }),
                        (exercise, 0, if i == 0 { 0.0 } else { 2.0 }),
                    ],
                ));
        }
    }
    let effective = sim.world().resource::<Content>().0.tuning;
    println!("SETTINGS,{scenario},{seed},respect={},proximity={},friction={},talk={},privacy_penalty={},television={}",
        effective.relationships.privacy_respect_chance, effective.relationships.proximity_per_hour,
        effective.relationships.friction_per_hour, effective.relationship_gain_per_talk,
        effective.bathroom_privacy_penalty, scenario == "shipped" || tuning.television);
    let settle = 7 * 1440;
    for _ in 0..settle {
        sim.tick();
    }
    let recovery = match scenario {
        "recovery0" => Some(0.0),
        "recovery5" => Some(0.5),
        _ => None,
    };
    if scenario == "incompatible" {
        for &(e, _) in &residents {
            sim.world_mut().entity_mut(e).remove::<Relationships>();
        }
    }
    if let Some(before) = recovery {
        incident(&mut sim, &residents, before);
    }
    let start = sim.world().resource::<SimClock>().tick;
    let mut effects: BTreeMap<RelationshipCause, (u64, f64, f64)> = BTreeMap::new();
    let mut incidents = 0u64;
    let mut emergency = 0u64;
    let mut directed = 0u64;
    let mut exposure = 0u64;
    let mut waiting = 0u64;
    let mut longest_wait = 0;
    let mut deprivation = 0;
    let mut samples = 0u64;
    let mut healthy = 0u64;
    let mut recovered = None;
    let mut hostile = BTreeMap::new();
    let mut subsequent = 0;
    let mut during_recovery = 0;
    let mut chains: BTreeMap<SimId, ChainObservation> = BTreeMap::new();
    let mut abandoned_chains = 0;
    let mut completed_chains = 0;
    let mut max_chain_age = 0;
    let mut max_chain_stall = 0;
    let mut essential_empty_minutes = 0;
    let mut essential_empty_while_waiting = 0;
    let mut entry_wait_minutes = 0;
    let mut start_wait_minutes = 0;
    let mut empty_states: BTreeMap<(usize, String, bool), u64> = BTreeMap::new();
    let mut last_wait = BTreeMap::new();
    let mut recovery_effects: BTreeMap<RelationshipCause, (u64, f64)> = BTreeMap::new();
    let mut critical_minutes = [0u64; 7];
    let mut first_positive = None;
    for elapsed in 1..=56 * 1440 {
        sim.tick();
        let mut seen = BTreeSet::new();
        exposure += sim.relationship_contacts().len() as u64;
        for &(id, private_start, minutes) in sim.privacy_waits() {
            last_wait.insert(id, elapsed);
            if private_start {
                start_wait_minutes += 1;
            } else {
                entry_wait_minutes += 1;
            }
            if residents
                .iter()
                .find(|(_, person)| *person == id)
                .is_some_and(|&(e, _)| {
                    sim.world().get::<Needs>(e).is_some_and(|n| {
                        n.get(NeedId::Hunger) == 0.0 || n.get(NeedId::Energy) == 0.0
                    })
                })
            {
                essential_empty_while_waiting += 1;
            }
            waiting += 1;
            longest_wait = longest_wait.max(minutes);
        }
        for e in sim.relationship_effects() {
            if recovery.is_some()
                && e.affected == residents[1].1
                && e.responsible == residents[0].1
                && e.actual > 0.0
                && e.cause != RelationshipCause::Decay
            {
                first_positive.get_or_insert(elapsed);
            }
            if recovery.is_some() && recovered.is_none() && e.affected == residents[1].1 {
                let row = recovery_effects.entry(e.cause).or_default();
                row.0 += 1;
                row.1 += f64::from(e.actual);
            }
            let row = effects.entry(e.cause).or_default();
            row.0 += 1;
            row.1 += f64::from(e.requested);
            row.2 += f64::from(e.actual);
            if matches!(
                e.cause,
                RelationshipCause::PrivacyEntry | RelationshipCause::PrivacyStart
            ) {
                if recovery.is_some()
                    && e.affected == residents[1].1
                    && e.responsible == residents[0].1
                {
                    subsequent += 1;
                    if recovered.is_none() {
                        during_recovery += 1;
                    }
                }
                if seen.insert((e.event, e.responsible)) {
                    if e.directed {
                        directed += 1;
                    } else if e.emergency {
                        emergency += 1;
                    } else {
                        incidents += 1;
                    }
                }
            }
        }
        if let Some(before) = recovery {
            if recovered.is_none() && feeling(&sim, residents[1].0, residents[0].1) >= before - 0.01
            {
                recovered = Some(elapsed);
            }
        }
        for &(a, id) in &residents {
            if let Some(needs) = sim.world().get::<Needs>(a) {
                for need in NeedId::ALL {
                    if needs.get(need)
                        <= sim
                            .world()
                            .resource::<Content>()
                            .0
                            .tuning
                            .mood_critical_need_level
                    {
                        critical_minutes[need.index()] += 1;
                    }
                }
                for need in [NeedId::Hunger, NeedId::Energy] {
                    if needs.get(need) == 0.0 {
                        let state = if sim.world().get::<AtWork>(a).is_some() {
                            "Work".into()
                        } else if let Some(e) = sim.world().get::<Eating>(a) {
                            let object = sim.world().resource::<Content>().0.object(e.object);
                            format!(
                                "{}:{}",
                                object.id, object.interactions[e.interaction as usize].id
                            )
                        } else if sim.world().get::<StepWork>(a).is_some() {
                            "Chain".into()
                        } else if sim.world().get::<Path>(a).is_some() {
                            "Walk".into()
                        } else if sim.world().get::<Socialising>(a).is_some()
                            || sim.world().get::<Reserved>(a).is_some()
                        {
                            "Conversation".into()
                        } else {
                            "Idle".into()
                        };
                        let recent = last_wait.get(&id).is_some_and(|tick| elapsed - tick <= 120);
                        *empty_states
                            .entry((need.index(), state, recent))
                            .or_default() += 1;
                    }
                }
            }
            let current = sim.world().get::<ChainState>(a).copied();
            let previous = chains.remove(&id);
            if let Some(previous) = previous.as_ref() {
                if current.is_none_or(|state| state.chain != previous.state.chain) {
                    // Observe the terminal countdown reaching its completion
                    // tick, rather than calling any final-step disappearance
                    // successful. These autonomous runs issue no cancellation.
                    let terminal = previous.state.step as usize + 1
                        == sim.world().resource::<Content>().0.chains
                            [previous.state.chain as usize]
                            .steps
                            .len();
                    if terminal
                        && previous.work.is_some_and(|ticks| ticks <= 1)
                        && sim.world().get::<Agent>(a).is_some()
                    {
                        completed_chains += 1;
                    } else {
                        abandoned_chains += 1;
                    }
                }
            }
            if let Some(state) = current {
                let work = sim.world().get::<StepWork>(a).map(|w| w.remaining_ticks);
                let previous = previous.filter(|p| p.state.chain == state.chain);
                let started = previous.as_ref().map_or(elapsed, |p| p.started);
                let last_progress = previous.as_ref().map_or(elapsed, |p| {
                    if p.state.step == state.step && p.work == work {
                        p.last_progress
                    } else {
                        elapsed
                    }
                });
                max_chain_age = max_chain_age.max(elapsed - started);
                max_chain_stall = max_chain_stall.max(elapsed - last_progress);
                chains.insert(
                    id,
                    ChainObservation {
                        state,
                        work,
                        started,
                        last_progress,
                    },
                );
            }
            if sim
                .world()
                .get::<Needs>(a)
                .is_some_and(|n| n.get(NeedId::Hunger) == 0.0 || n.get(NeedId::Energy) == 0.0)
            {
                essential_empty_minutes += 1;
            }
            if sim
                .world()
                .get::<Needs>(a)
                .is_some_and(|needs| NeedId::ALL.into_iter().any(|n| needs.get(n) <= 5.0))
            {
                deprivation += 1;
            }
            for &(b, other) in &residents {
                if a == b {
                    continue;
                }
                let value = feeling(&sim, a, other);
                if value <= -0.5 {
                    hostile.entry((id, other)).or_insert(elapsed);
                }
                if elapsed % 60 == 0 && sim.compatibility(id, other).is_some_and(|c| c >= -0.2) {
                    samples += 1;
                    if value > -0.5 {
                        healthy += 1;
                    }
                }
            }
        }
    }
    let alive = residents
        .iter()
        .filter(|(e, _)| sim.world().get::<Agent>(*e).is_some())
        .count();
    println!("RUN,{scenario},{seed},sims={},incidents={incidents},emergencies={emergency},directed={directed},per_week={:.5},exposure_hours={:.3},wait_minutes={waiting},entry_wait_minutes={entry_wait_minutes},start_wait_minutes={start_wait_minutes},max_wait={longest_wait},low_need_minutes={deprivation},essential_empty_minutes={essential_empty_minutes},essential_empty_while_waiting={essential_empty_while_waiting},chains_completed={completed_chains},chains_abandoned={abandoned_chains},alive={alive},healthy={healthy},samples={samples},recovery_days={},subsequent={subsequent},during_recovery={during_recovery},hash={:016x},start={start}",residents.len(),incidents as f64/(residents.len() as f64*8.0),exposure as f64/60.0,recovered.map_or("unfinished".into(),|t|format!("{:.4}",t as f64/1440.0)),sim.world_hash());
    println!("CHAIN,{scenario},{seed},active_at_end={},max_age_minutes={max_chain_age},max_stall_minutes={max_chain_stall}", chains.len());
    for (id, observation) in chains {
        println!("CHAIN_ACTIVE,{scenario},{seed},actor={},chain={},step={},age_minutes={},stall_minutes={}", id.0, observation.state.chain, observation.state.step, 56 * 1440 - observation.started, 56 * 1440 - observation.last_progress);
    }
    for (cause, (n, wanted, actual)) in effects {
        println!("EFFECT,{scenario},{seed},{cause:?},{n},{wanted:.8},{actual:.8}");
    }
    for (cause, (n, actual)) in recovery_effects {
        println!("RECOVERY_EFFECT,{scenario},{seed},{cause:?},{n},{actual:.8}");
    }
    println!(
        "ELIGIBILITY,{scenario},{seed},first_positive_minute={}",
        first_positive.map_or("none".into(), |t| t.to_string())
    );
    for need in NeedId::ALL {
        println!(
            "NEED,{scenario},{seed},{need:?},critical_minutes={}",
            critical_minutes[need.index()]
        );
    }
    for ((need, activity, recent_wait), minutes) in empty_states {
        println!(
            "EMPTY,{scenario},{seed},{:?},{activity},recent_wait={recent_wait},minutes={minutes}",
            NeedId::ALL[need]
        );
    }
    for &(a, id) in &residents {
        for &(b, other) in &residents {
            if a != b {
                println!(
                    "PAIR,{scenario},{seed},{},{},compatibility={:.4},end={:.6},hostile_day={}",
                    id.0,
                    other.0,
                    sim.compatibility(id, other).unwrap_or(0.0),
                    feeling(&sim, a, other),
                    hostile
                        .get(&(id, other))
                        .map_or("unfinished".into(), |t| format!(
                            "{:.4}",
                            *t as f64 / 1440.0
                        ))
                );
            }
        }
    }
}

fn main() {
    let args: Vec<_> = std::env::args().collect();
    let start = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(1);
    let end = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(start);
    let value = |flag: &str| {
        args.iter().find_map(|a| {
            a.strip_prefix(flag).map(|v| {
                let value: f32 = v.parse().expect("numeric tuning override");
                assert!(
                    value.is_finite() && (0.0..=1.0).contains(&value),
                    "invalid {flag}"
                );
                value
            })
        })
    };
    let tuning = Overrides {
        talk_gain: value("--talk-gain="),
        respect: value("--respect="),
        proximity: value("--proximity="),
        friction: value("--friction="),
        television: !args.iter().any(|s| s == "--social-stress"),
    };
    println!("CONFIG,{tuning:?}");
    for seed in start..=end {
        for scenario in [
            "shipped",
            "two",
            "three",
            "four",
            "recovery0",
            "recovery5",
            "incompatible",
        ] {
            if args
                .get(3)
                .is_none_or(|s| s == scenario || s == "all" || s.starts_with("--"))
            {
                run(
                    seed,
                    scenario,
                    args.iter().any(|s| s == "no-avoidance"),
                    tuning,
                );
            }
        }
    }
}
