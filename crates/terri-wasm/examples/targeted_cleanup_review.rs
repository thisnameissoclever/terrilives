//! Saved household for playing and inspecting targeted dish cleanup.
#[path = "support/mod.rs"]
mod support;
use terri_core::save::{SavedDining, SavedDishes, SavedDomestic};
use terri_sim::Sim;

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("provide the output save path");
    let mut sim = Sim::new_from_shipped_lot();
    let mut household = sim.save_snapshot_v17();
    let saved = support::v5_mut(&mut household);
    let table = saved
        .world
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("dining_table"))
        .unwrap()
        .index;
    let counters: Vec<_> = saved
        .world
        .entities
        .iter()
        .filter(|e| e.smart_object.as_deref() == Some("counter"))
        .map(|e| e.index)
        .collect();
    let people: Vec<_> = saved
        .world
        .entities
        .iter()
        .filter(|e| e.agent)
        .map(|e| e.index)
        .collect();
    saved.world.tick = 660;
    for person in saved.world.entities.iter_mut().filter(|e| e.agent) {
        person.career = None;
        person.needs = Some([100.0; 7]);
        person.personality.as_mut().unwrap().drain = [0.0; 7];
        person.selected = person.index == people[0];
        if person.index != people[0] {
            person.at_work_ticks = Some(10_000);
        }
    }
    saved.domestic = Some(SavedDomestic {
        next_dish: 5,
        cleanliness: people.iter().map(|p| (*p, 0.0)).collect(),
        dishes: vec![
            SavedDishes {
                id: 0,
                surface: table,
                owner: 0,
                units: 1,
            },
            SavedDishes {
                id: 1,
                surface: table,
                owner: 1,
                units: 1,
            },
            SavedDishes {
                id: 2,
                surface: table,
                owner: 2,
                units: 1,
            },
            SavedDishes {
                id: 3,
                surface: counters[0],
                owner: 0,
                units: 3,
            },
            SavedDishes {
                id: 4,
                surface: counters[1],
                owner: 1,
                units: 1,
            },
        ],
        ..Default::default()
    });
    saved.dining = Some(SavedDining {
        settings: vec![(0, 0), (1, 1), (2, 0)],
        ..Default::default()
    });
    sim.load_snapshot_v17(household)
        .expect("the played fixture must be a valid save");
    let bytes = support::encode(&sim);
    std::fs::write(path, bytes).expect("write the review fixture");
}
