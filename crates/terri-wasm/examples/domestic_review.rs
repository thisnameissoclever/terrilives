//! Reproducible saved household for reviewing a four-person shared meal.
use terri_core::{CommandQueue, NeedId, Needs, SimCommand, SAVE_MAGIC, SAVE_SCHEMA_VERSION};
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
    let mut saved = sim.save_snapshot_v5();
    let people: Vec<_> = saved
        .world
        .entities
        .iter()
        .filter_map(|person| person.sim_id.map(|id| (person.index, id)))
        .collect();
    let cook = people[0].0;
    for person in &mut saved.world.entities {
        if person.agent {
            person.career = None;
            person.needs = Some([100.0; 7]);
            person.personality.as_mut().unwrap().drain = [0.0; 7];
            person.relationships = Some(
                people
                    .iter()
                    .filter(|(_, id)| Some(*id) != person.sim_id)
                    .map(|(_, id)| (*id, 0.8))
                    .collect(),
            );
        }
    }
    sim.load_snapshot_v5(saved).unwrap();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: cook,
            object: 0,
            interaction: 1,
        });
    let mut reached = false;
    for _ in 0..1500 {
        sim.tick();
        let state = sim.save_snapshot_v5();
        if state.world.entities.iter().any(|person| {
            person.index == cook
                && person.chain.as_ref().is_some_and(|chain| chain.step == 4)
                && person.step_work_ticks == Some(1)
        }) {
            reached = true;
            break;
        }
    }
    assert!(reached, "cook never reached plating");
    for (guest, _) in people.iter().filter(|(index, _)| *index != cook) {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::CancelIntents { agent: *guest });
    }
    sim.flush_commands();
    let mut saved = sim.save_snapshot_v5();
    let mut hungry = Needs::all_at(100.0);
    hungry.set(NeedId::Hunger, 30.0);
    let stations: Vec<_> = ["reading_chair", "television", "long_sofa"]
        .iter()
        .map(|id| {
            let object = saved
                .world
                .entities
                .iter()
                .find(|entity| entity.smart_object.as_deref() == Some(*id))
                .unwrap();
            let position = object.position.unwrap();
            let pack = sim.world().resource::<terri_sim::Content>().0;
            let facing = saved
                .object_facings
                .iter()
                .find(|(index, _)| *index == object.index)
                .map_or(terri_core::Facing::SouthEast, |(_, facing)| {
                    terri_core::Facing::from_code(*facing).unwrap()
                });
            let footprint = pack.object(pack.find(id).unwrap()).footprint_at(facing);
            let grid = sim.world().resource::<terri_core::TileGrid>();
            let contact = (0..grid.height())
                .flat_map(|y| (0..grid.width()).map(move |x| (x as i32, y as i32)))
                .find(|from| {
                    grid.can_interact_with_rect(
                        *from,
                        (position.x.round() as i32, position.y.round() as i32),
                        footprint,
                    )
                })
                .unwrap();
            (object.index, (*id).to_owned(), contact)
        })
        .collect();
    // Guests finish non-food activities on the actual plating completion tick.
    // This leaves the scheduler, invitation, collection and payout paths intact.
    let mut guest = 0;
    for person in &mut saved.world.entities {
        if person.agent {
            person.needs = Some(*hungry.as_slice());
            if person.index != cook {
                let (station, object, contact) = &stations[guest];
                person.position = Some(terri_core::save::SavedPosition {
                    x: contact.0 as f32,
                    y: contact.1 as f32,
                });
                person.path = None;
                person.target = Some(terri_core::save::SavedTarget {
                    object: *station,
                    interaction: 0,
                });
                person.eating = Some(terri_core::save::SavedEating {
                    object: object.clone(),
                    interaction: 0,
                    remaining_ticks: 1,
                });
                person.socialising = None;
                person.conversation_voice = None;
                person.chain = None;
                person.step_work_ticks = None;
                person.carrying = None;
                person.intents = None;
                person.wander_pause_ticks = None;
                person.restless = false;
                person.blocked = false;
                person.reserved = false;
                person.fumbled_delta_scale = None;
                guest += 1;
            }
        }
    }
    let occupied: Vec<_> = saved
        .world
        .entities
        .iter()
        .filter_map(|entity| entity.target.map(|target| target.object))
        .collect();
    for entity in &mut saved.world.entities {
        if entity.smart_object.is_some() {
            entity.reserved = occupied.contains(&entity.index);
        }
    }
    sim.load_snapshot_v5(saved).unwrap();
    sim.tick();
    let mut bytes = Vec::from(SAVE_MAGIC);
    bytes.extend(SAVE_SCHEMA_VERSION.to_le_bytes());
    bytes.extend(postcard::to_allocvec(&sim.save_snapshot_v5()).unwrap());
    std::fs::write(&path, bytes).unwrap();
    println!("Saved a plated meal with three hungry friends ready to collect it to {path}");
}
