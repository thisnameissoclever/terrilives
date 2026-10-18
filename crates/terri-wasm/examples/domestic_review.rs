//! Reproducible saved household for reviewing a four-person shared meal.
#[path = "support/mod.rs"]
mod support;
use terri_core::{CommandQueue, NeedId, SimCommand};
use terri_sim::Sim;

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("provide an output save path");
    let mut sim = Sim::new_from_shipped_lot();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::AddHousemate {
            name: "Robin".to_owned(),
            personality: 1,
            traits: vec![],
        });
    sim.flush_commands();
    let mut household = support::capture(&sim);
    let saved = support::v5_mut(&mut household);
    let people: Vec<_> = saved
        .world
        .entities
        .iter()
        .filter_map(|person| person.sim_id.map(|id| (person.index, id)))
        .collect();
    assert_eq!(people.len(), 4);
    let cook = people[0].0;
    let cook_id = people[0].1;
    for person in saved
        .world
        .entities
        .iter_mut()
        .filter(|person| person.agent)
    {
        person.career = None;
        person.needs = Some([100.; 7]);
        person.personality.as_mut().unwrap().drain = [0.; 7];
        person.relationships = Some(
            people
                .iter()
                .filter(|(_, id)| Some(*id) != person.sim_id)
                .map(|(_, id)| (*id, 0.8))
                .collect(),
        );
        if person.index != cook {
            person.wander_pause_ticks = Some(10_000);
        }
    }
    sim.load_snapshot_v16(household).unwrap();
    let pack = sim.world().resource::<terri_sim::Content>().0;
    let fridge_model = pack.find("fridge").unwrap();
    let fridge = sim
        .world_mut()
        .query::<(terri_core::Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| object.0 == fridge_model)
        .unwrap()
        .0;
    let action = pack
        .object(fridge_model)
        .interactions
        .iter()
        .position(|action| action.id == "cook_dinner")
        .unwrap() as u32;
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: cook,
            object: fridge.index_u32(),
            interaction: action,
        });
    let mut reached = false;
    for _ in 0..1500 {
        sim.tick();
        let state = sim.save_snapshot_v16();
        let five = &state
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy;
        if five.world.entities.iter().any(|person| {
            person.index == cook
                && person.chain.as_ref().is_some_and(|chain| chain.step == 4)
                && person.step_work_ticks == Some(1)
        }) {
            reached = true;
            break;
        }
    }
    assert!(reached, "cook never reached plating");
    let mut household = support::capture(&sim);
    for person in support::v5_mut(&mut household)
        .world
        .entities
        .iter_mut()
        .filter(|person| person.agent)
    {
        person.needs.as_mut().unwrap()[NeedId::Hunger.index()] = 30.;
    }
    sim.load_snapshot_v16(household).unwrap();
    sim.tick();
    let snapshot = support::capture(&sim);
    let mut expected_guests: Vec<_> = people.iter().skip(1).map(|(_, id)| *id).collect();
    expected_guests.sort_unstable();
    let five = &snapshot
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy;
    let meal = five
        .domestic
        .as_ref()
        .unwrap()
        .meals
        .iter()
        .find(|meal| meal.cook == cook_id)
        .expect("real plating must invite the hungry friends");
    assert_eq!(meal.guests, expected_guests);
    let meal_tick = meal.tick;
    // Retain the just-plated scene; independently prove its invited friends collect food.
    let mut continuation = Sim::new_from_shipped_lot();
    continuation.load_snapshot_v16(snapshot).unwrap();
    let mut collected = std::collections::BTreeSet::new();
    for _ in 0..300 {
        continuation.tick();
        let state = continuation.save_snapshot_v16();
        let five = &state
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy;
        if let Some(meal) = five
            .domestic
            .as_ref()
            .unwrap()
            .meals
            .iter()
            .find(|meal| meal.cook == cook_id && meal.tick == meal_tick)
        {
            collected.extend(meal.collected.iter().copied());
        }
        if expected_guests
            .iter()
            .all(|guest| collected.contains(guest))
        {
            break;
        }
    }
    assert!(
        expected_guests
            .iter()
            .all(|guest| collected.contains(guest)),
        "all invited friends must collect through normal dining"
    );
    std::fs::write(&path, support::encode(&sim)).unwrap();
    println!("Saved a plated meal with three hungry friends ready to collect it to {path}");
}
