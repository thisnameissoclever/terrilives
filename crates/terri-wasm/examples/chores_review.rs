//! Normal household with starting mess for playing chore behavior.
#[path = "support/mod.rs"]
mod support;
use terri_sim::Sim;

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("provide the output save path");
    let patch_amount = std::env::args()
        .nth(2)
        .map(|n| n.parse::<u16>().expect("grime units"));
    let review_sim = std::env::args()
        .nth(3)
        .map(|n| n.parse::<u32>().expect("review Sim identity"));
    assert!(patch_amount.is_none_or(|n| n <= 1000));
    let mut sim = Sim::new_from_shipped_lot();
    if patch_amount.is_some() {
        let person = sim
            .world_mut()
            .query::<(terri_core::Entity, &terri_core::Agent, &terri_core::SimId)>()
            .iter(sim.world())
            .filter(|(_, _, id)| review_sim.is_none_or(|wanted| id.0 == wanted))
            .min_by_key(|(person, _, _)| person.index_u32())
            .unwrap()
            .0;
        sim.world_mut()
            .entity_mut(person)
            .insert(terri_core::Position { x: 5.75, y: 3.0 });
    }
    let day = sim
        .world()
        .resource::<terri_sim::Content>()
        .0
        .tuning
        .day_ticks;
    sim.world_mut().resource_mut::<terri_core::SimClock>().tick = u64::from(day) * 5 + 660;
    sim.tick();
    let mut household = sim.save_snapshot_v18();
    let saved = support::v5_mut(&mut household);
    let people: Vec<_> = saved
        .world
        .entities
        .iter()
        .filter(|e| e.agent)
        .map(|e| e.index)
        .collect();
    let counter = saved
        .world
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("counter"))
        .unwrap()
        .index;
    let bin = saved
        .world
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("trashcan"))
        .unwrap()
        .index;
    for person in saved.world.entities.iter_mut().filter(|e| e.agent) {
        person.selected =
            review_sim.map_or(person.index == people[0], |id| person.sim_id == Some(id));
    }
    let chores = saved.chores.as_mut().unwrap();
    chores.board_enabled = true;
    chores.floors = if let Some(amount) = patch_amount {
        (2..=4)
            .flat_map(|y| (5..=7).map(move |x| (y * 20 + x, amount)))
            .filter(|r| r.1 > 0)
            .collect()
    } else {
        vec![(81, 850), (82, 850), (83, 850)]
    };
    chores.surfaces = vec![(counter, 850)];
    chores.bins = vec![(bin, 850)];
    sim.load_snapshot_v18(household)
        .expect("played fixture must be valid");
    if let Some(identity) = review_sim {
        let person = sim
            .world_mut()
            .query::<(terri_core::Entity, &terri_core::SimId)>()
            .iter(sim.world())
            .find(|(_, id)| id.0 == identity)
            .unwrap()
            .0;
        sim.world_mut()
            .entity_mut(person)
            .insert(terri_core::Position { x: 6.0, y: 3.0 });
        let room = terri_sim::rooms::cleaning_area_at(sim.world(), (6, 3))
            .expect("review tile is cleanable")
            .key();
        sim.world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(terri_core::SimCommand::CleanChoreFirst {
                agent: person.index_u32(),
                key: terri_core::chores::ChoreKey {
                    kind: terri_core::chores::ChoreKind::Floors,
                    target: room,
                },
            });
        let mut started = false;
        for _ in 0..40 {
            sim.tick();
            sim.sync_render_buffer();
            let row = sim
                .render_buffer()
                .ids
                .iter()
                .position(|id| *id == person.index_u32())
                .unwrap();
            if sim.render_buffer().visual_actions[row] == 14 {
                started = true;
                break;
            }
        }
        assert!(started, "review Sim must start the real floor chore");
    } else {
        sim.tick();
    }
    let bytes = support::encode(&sim);
    std::fs::write(path, bytes).expect("write the review fixture");
}
