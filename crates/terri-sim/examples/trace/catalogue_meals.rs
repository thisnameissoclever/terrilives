//! Controlled recipe attribution. These cases do not measure autonomous household frequency.
use std::collections::BTreeSet;
use terri_core::{
    Career, CommandQueue, Entity, NeedId, Needs, Personality, Relationships, Restless,
    SaveSnapshotV6, SavedEntity, SimCommand, SimId, SmartObject, Traits, Wander,
};
use terri_sim::{Content, Sim};

fn person(snapshot: &SaveSnapshotV6, index: u32) -> &SavedEntity {
    snapshot
        .legacy
        .world
        .entities
        .iter()
        .find(|p| p.index == index)
        .unwrap()
}
fn chain_is(p: &SavedEntity, recipe: &str) -> bool {
    p.chain.as_ref().is_some_and(|c| c.chain == recipe)
}
pub(super) fn terminal_delivery(
    before: &SavedEntity,
    after: &SavedEntity,
    recipe: &str,
    final_step: u32,
    owned: bool,
    cancelled: bool,
) -> bool {
    owned
        && !cancelled
        && before
            .chain
            .as_ref()
            .is_some_and(|c| c.chain == recipe && c.step == final_step)
        && before.step_work_ticks == Some(1)
        && before
            .target
            .is_some_and(|t| t.interaction == terri_sim::systems::chain::CHAIN_STEP)
        && before.carrying.as_deref() == Some("dinner")
        && !chain_is(after, recipe)
        && after.carrying.is_none()
}
#[derive(Default)]
struct Ledger {
    begun: bool,
    delivered: Option<u32>,
    interrupted: bool,
    countdown: u32,
    moving: u32,
    gathering: u32,
    minimum: f32,
    critical: u32,
    gain: [f32; 2],
    net: [f32; 2],
}

pub fn run(seed: u64) {
    for (case, hunger, snacks, cancel) in [
        ("urgent_dinner", [30.0, 100.0, 100.0], false, false),
        ("urgent_snack", [30.0, 100.0, 100.0], true, false),
        ("eligible_dinner", [60.0, 50.0, 50.0], false, false),
        ("eligible_snacks", [60.0, 50.0, 50.0], true, false),
        (
            "original_late_eligibility",
            [30.0, 60.0, 60.0],
            false,
            false,
        ),
        ("cancel_terminal", [30.0, 100.0, 100.0], false, true),
    ] {
        let mut sim = Sim::new_from_shipped_lot_with_seed(seed);
        let pack = sim.world().resource::<Content>().0;
        let mut people: Vec<_> = sim
            .world_mut()
            .query::<(Entity, &SimId)>()
            .iter(sim.world())
            .map(|(e, id)| (id.0, e))
            .collect();
        people.sort_by_key(|(id, _)| *id);
        assert_eq!(people.len(), 3);
        let fridge = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .find(|(_, o)| pack.object(o.0).id == "fridge")
            .unwrap()
            .0;
        for (i, (_, e)) in people.iter().enumerate() {
            let mut needs = Needs::all_at(100.0);
            needs.set(NeedId::Hunger, hunger[i]);
            needs.set(NeedId::Comfort, 60.0);
            let mut feelings = Relationships::default();
            for (id, _) in &people {
                if *id != people[i].0 {
                    feelings.bump(SimId(*id), 0.9);
                }
            }
            sim.world_mut()
                .entity_mut(*e)
                .remove::<Career>()
                .remove::<Traits>()
                .remove::<Restless>()
                .insert((
                    Personality::neutral(),
                    needs,
                    feelings,
                    Wander {
                        pause_ticks: 10_000,
                    },
                ));
        }
        let action = if snacks { "grab_snack" } else { "cook_dinner" };
        let recipe = if snacks {
            "prepare_snack"
        } else {
            "cook_dinner"
        };
        let row = pack
            .object(pack.find("fridge").unwrap())
            .interactions
            .iter()
            .position(|a| a.id == action)
            .unwrap() as u32;
        let ordered = if case == "eligible_snacks" { 3 } else { 1 };
        for (_, e) in people.iter().take(ordered) {
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObjectFirst {
                    agent: e.index_u32(),
                    object: fridge.index_u32(),
                    interaction: row,
                });
        }
        sim.flush_commands();
        let mut ledgers: Vec<_> = hunger
            .iter()
            .map(|h| Ledger {
                minimum: *h,
                ..Default::default()
            })
            .collect();
        let mut batch = None;
        let mut plated = false;
        let mut invitations = BTreeSet::new();
        let mut collected = BTreeSet::new();
        let mut concurrent = 0;
        let mut dining_start = None;
        let mut cancel_sent = false;
        let mut elapsed = 0;
        let mut controls = false;
        println!("MEAL SETUP {case} seed {seed}; Hunger {hunger:?}, Comfort60, other needs100; neutral personal multipliers/no Traits or Career; global decay unchanged; idle pause10000; public commands {ordered}; action {action}; authored minutes {}",pack.object(pack.find("fridge").unwrap()).interactions[row as usize].duration_ticks);
        for tick in 1..=2000 {
            let before = sim.save_snapshot_v6();
            let cook_before = person(&before, people[0].1.index_u32());
            if cancel
                && !cancel_sent
                && cook_before
                    .chain
                    .as_ref()
                    .is_some_and(|c| c.chain == recipe && c.step == 5)
                && cook_before.step_work_ticks == Some(1)
            {
                sim.world_mut()
                    .resource_mut::<CommandQueue>()
                    .push(SimCommand::CancelIntents {
                        agent: people[0].1.index_u32(),
                    });
                cancel_sent = true;
            }
            sim.tick();
            elapsed = tick;
            let after = sim.save_snapshot_v6();
            let cook_after = person(&after, people[0].1.index_u32());
            if !snacks
                && !plated
                && cook_before
                    .chain
                    .as_ref()
                    .is_some_and(|c| c.chain == recipe && c.step == 4)
                && cook_after
                    .chain
                    .as_ref()
                    .is_some_and(|c| c.chain == recipe && c.step == 5)
            {
                plated = true;
                let own = after
                    .legacy
                    .domestic
                    .as_ref()
                    .unwrap()
                    .meals
                    .iter()
                    .find(|m| m.cook == people[0].0 && m.tick == after.legacy.world.tick);
                if let Some(meal) = own {
                    batch = Some((meal.cook, meal.tick));
                    invitations.extend(meal.guests.iter().copied());
                }
                println!("MEAL PLATING {case} tick{tick}; batch{batch:?}; invited{invitations:?}; Hunger {:?}",people.iter().map(|(_,e)|person(&after,e.index_u32()).needs.unwrap()[0]).collect::<Vec<_>>());
            }
            let matching = |s: &SaveSnapshotV6| {
                s.legacy
                    .domestic
                    .as_ref()
                    .and_then(|state| state.meals.iter().find(|m| Some((m.cook, m.tick)) == batch))
                    .cloned()
            };
            let prior_batch = matching(&before);
            let now_batch = matching(&after);
            if let Some(meal) = &now_batch {
                collected.extend(meal.collected.iter().copied());
                if meal.dining_started && dining_start.is_none() {
                    dining_start = Some(tick);
                    println!(
                        "MEAL DINING START {case} tick{tick}; Hunger/Energy/Bladder {:?}",
                        people
                            .iter()
                            .map(|(_, e)| {
                                let n = person(&after, e.index_u32()).needs.unwrap();
                                [n[0], n[1], n[3]]
                            })
                            .collect::<Vec<_>>()
                    );
                }
            }
            let mut eating = 0;
            for (i, (id, e)) in people.iter().enumerate() {
                let a = person(&before, e.index_u32());
                let b = person(&after, e.index_u32());
                let expected = if i < ordered {
                    Some(recipe)
                } else if invitations.contains(id) {
                    Some("eat_shared_meal")
                } else {
                    None
                };
                let Some(expected) = expected else { continue };
                let ledger = &mut ledgers[i];
                if ledger.delivered.is_some() || ledger.interrupted {
                    continue;
                }
                let guest_owned = i < ordered
                    || prior_batch
                        .as_ref()
                        .is_some_and(|m| m.claimed.contains(id) && m.collected.contains(id));
                let origin_ok = before.chain_origins.iter().any(|o| {
                    o.person == e.index_u32()
                        && match &o.origin {
                            terri_core::save_v6::ChainOrigin::Action {
                                model,
                                action: origin_action,
                                recipe: origin_recipe,
                                ..
                            } => {
                                i < ordered
                                    && model == "fridge"
                                    && origin_action == action
                                    && origin_recipe == expected
                            }
                            terri_core::save_v6::ChainOrigin::Internal {
                                recipe: origin_recipe,
                            } => i >= ordered && origin_recipe == "eat_shared_meal",
                        }
                });
                ledger.begun |= chain_is(a, expected) || chain_is(b, expected);
                let n = b.needs.unwrap();
                ledger.minimum = ledger.minimum.min(n[0]);
                ledger.critical += u32::from(n[0] <= 20.0);
                if chain_is(a, expected) {
                    if a.step_work_ticks
                        .is_some_and(|r| r > 0 && b.step_work_ticks.is_none_or(|next| next < r))
                    {
                        ledger.countdown += 1;
                    }
                    if a.path.is_some() && a.position != b.position {
                        ledger.moving += 1;
                    }
                    if a.step_work_ticks.is_some()
                        && a.step_work_ticks == b.step_work_ticks
                        && a.path.is_none()
                    {
                        ledger.gathering += 1;
                    }
                }
                let final_step = pack
                    .chains
                    .iter()
                    .find(|c| c.id == expected)
                    .unwrap()
                    .steps
                    .len() as u32
                    - 1;
                if b.chain
                    .as_ref()
                    .is_some_and(|c| c.chain == expected && c.step == final_step)
                    && b.step_work_ticks.is_some()
                    && b.path.is_none()
                {
                    eating += 1;
                }
                let delivered = terminal_delivery(
                    a,
                    b,
                    expected,
                    final_step,
                    guest_owned && origin_ok,
                    cancel_sent && i == 0,
                );
                if delivered {
                    assert!(
                        a.at_work_ticks.is_none() && a.eating.is_none(),
                        "owned recipe must be awake/on-lot for neutral decay reconstruction"
                    );
                    let requested = if expected == "prepare_snack" {
                        [40.0, 0.0]
                    } else {
                        [70.0, 15.0]
                    };
                    for (j, need) in [NeedId::Hunger, NeedId::Comfort].iter().enumerate() {
                        let index = need.index();
                        let decayed =
                            (a.needs.unwrap()[index] - pack.decay_per_tick[index]).max(0.0);
                        ledger.gain[j] = (n[index] - decayed).max(0.0);
                        ledger.net[j] = n[index] - if j == 0 { hunger[i] } else { 60.0 };
                        assert!(ledger.gain[j] <= requested[j] + 0.01);
                    }
                    ledger.delivered = Some(tick);
                    println!("MEAL DELIVERY {case} Sim{id} tick{tick}; origin{:?}; requested{requested:?}; clamped{:?}; net{:?}; minHunger{}; criticalTicks{}; observedCountdown{}; observedMoving{}; stationaryUnchangedCountdown{}",before.chain_origins.iter().find(|o|o.person==e.index_u32()).unwrap().origin,ledger.gain,ledger.net,ledger.minimum,ledger.critical,ledger.countdown,ledger.moving,ledger.gathering);
                    if !controls {
                        assert!(!terminal_delivery(
                            a,
                            b,
                            "unrelated_recipe",
                            final_step,
                            true,
                            false
                        ));
                        assert!(!terminal_delivery(a, b, expected, final_step, false, false));
                        assert!(!terminal_delivery(a, b, expected, final_step, true, true));
                        let mut asleep = a.clone();
                        asleep.chain = None;
                        asleep.step_work_ticks = None;
                        assert!(!terminal_delivery(
                            &asleep, b, expected, final_step, true, false
                        ));
                        let mut zero_gain = b.clone();
                        zero_gain.needs = a.needs;
                        assert!(
                            terminal_delivery(a, &zero_gain, expected, final_step, true, false),
                            "completion does not require a positive usable gain"
                        );
                        println!("MEAL ATTRIBUTION CONTROLS {case}: unrelated recipe, unrelated batch, cancellation, sleep-only reject; zero usable gain remains a completion");
                        controls = true;
                    }
                } else if ledger.begun && !chain_is(b, expected) && chain_is(a, expected) {
                    ledger.interrupted = true;
                    println!("MEAL INTERRUPTION {case} Sim{id} tick{tick}; next recipe {:?}; cancelled{}",b.chain.as_ref().map(|c|&c.chain),cancel_sent&&i==0);
                }
            }
            if eating >= 2
                && now_batch
                    .as_ref()
                    .or(prior_batch.as_ref())
                    .is_some_and(|m| m.dining_started)
            {
                concurrent += 1;
            }
            if cancel_sent {
                assert!(ledgers[0].delivered.is_none());
                assert!(
                    cook_after.needs.unwrap()[0] <= cook_before.needs.unwrap()[0],
                    "cancellation cannot pay food"
                );
                assert!(
                    !chain_is(cook_after, recipe),
                    "terminal cancellation ends its invocation"
                );
                break;
            }
            let cook_done = ledgers[0].delivered.is_some() || ledgers[0].interrupted;
            let guests_done = people.iter().enumerate().all(|(i, (id, _))| {
                !(i < ordered || invitations.contains(id))
                    || ledgers[i].delivered.is_some()
                    || ledgers[i].interrupted
            });
            if cook_done && guests_done {
                break;
            }
        }
        let served: Vec<_> = people
            .iter()
            .zip(&ledgers)
            .filter(|(_, l)| l.delivered.is_some())
            .map(|((id, _), _)| *id)
            .collect();
        let status = if cancel_sent {
            "cancelled"
        } else if elapsed == 2000 {
            "timed out"
        } else if ledgers.iter().any(|l| l.interrupted) {
            "partial/interrupted"
        } else if !snacks && invitations.is_empty() {
            "solo; no invitations"
        } else {
            "owned deliveries complete"
        };
        println!("MEAL RESULT {case}: {status}; elapsed{elapsed}; batch{batch:?}; invited{invitations:?}; collected{collected:?}; served{served:?}; diningStart{dining_start:?}; concurrentEatingTicks{concurrent}; dishesAtEnd{}; cleanup excluded; countdown/movement observations omit arrival transitions and are not a full time decomposition",sim.save_snapshot_v5().domestic.unwrap().dishes.iter().map(|d|d.units).sum::<u32>());
    }
}
