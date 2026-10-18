//! Real partially completed work used by transaction conservation tests.
use super::*;
use terri_core::{Position, TileGrid};

pub(crate) fn suspended_floor(outside: bool) -> crate::Sim {
    let mut sim = crate::Sim::new_from_shipped_lot();
    ensure(sim.world_mut());
    let person = sim
        .world_mut()
        .query_filtered::<Entity, With<terri_core::Agent>>()
        .iter(sim.world())
        .next()
        .unwrap();
    let tile = if outside { (17, 13) } else { (1, 2) };
    if outside {
        sim.world_mut()
            .init_resource::<terri_core::layout::SavedFloors>();
        sim.world_mut()
            .resource_mut::<terri_core::layout::SavedFloors>()
            .set(tile.0, tile.1, 4);
    }
    sim.world_mut().entity_mut(person).insert(Position {
        x: tile.0 as f32,
        y: tile.1 as f32,
    });
    let width = sim.world().resource::<TileGrid>().width() as u32;
    let key = ChoreKey {
        kind: ChoreKind::Floors,
        target: sim
            .world()
            .resource::<crate::rooms::RoomMap>()
            .selection_at(tile)
            .unwrap()
            .key(),
    };
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    add(&mut state.floors, tile.1 * width + tile.0, 900);
    board::reconcile(sim.world(), &mut state);
    assert!(state.assignments.iter().any(|a| a.key == key));
    for episode in state.episodes.iter_mut().filter(|e| e.key == key) {
        episode.decision = Some(true);
        episode.needed = true;
        episode.outcome = DutyOutcome::WillDo;
    }
    state.board_enabled = false;
    assert!(work::start(sim.world_mut(), &mut state, person, key, true));
    for _ in 0..3 {
        work::advance(sim.world_mut(), &mut state);
    }
    assert!(state.tasks[0].completed_units > 0);
    state.tasks[0].suspended = true;
    sim.world_mut()
        .entity_mut(person)
        .remove::<(ChoreWork, terri_core::Path)>();
    sim.world_mut().insert_resource(state);
    let surface = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| sim.world().resource::<crate::Content>().0.object(o.0).id == "counter")
        .unwrap()
        .0;
    sim.world_mut()
        .insert_resource(terri_core::save::SavedDomestic {
            cleanliness: vec![(person.index_u32(), 1.0)],
            dishes: vec![terri_core::save::SavedDishes {
                id: 500,
                surface: surface.index_u32(),
                owner: 1,
                units: 4,
            }],
            visits: vec![terri_core::save::SavedRoomVisit {
                person: person.index_u32(),
                room: key.target,
                seen: vec![500],
            }],
            next_dish: 501,
            ..Default::default()
        });
    sim.world_mut()
        .insert_resource(terri_core::save::SavedDining {
            opportunities: vec![terri_core::save::SavedCleanupOpportunity {
                person: person.index_u32(),
                room: key.target,
                known: vec![500],
                pending: false,
            }],
            ..Default::default()
        });
    let saved = sim.save_snapshot_v16();
    let mut admitted = crate::Sim::new_from_shipped_lot();
    admitted
        .load_snapshot_v16(saved.clone())
        .expect("suspended task is admitted before Build");
    assert_eq!(admitted.save_snapshot_v16(), saved);
    admitted
}
