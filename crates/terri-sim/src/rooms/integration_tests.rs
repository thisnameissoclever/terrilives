use super::*;
use crate::Sim;
use terri_core::{
    chores::{ChoreKey, ChoreKind},
    layout::SavedFloors,
};

#[test]
fn outdoor_coverings_create_one_outside_floor_duty() {
    let mut sim = Sim::new_from_shipped_lot();
    let mut floors = SavedFloors::default();
    floors.set(17, 13, 1);
    floors.set(18, 14, 4);
    sim.world_mut().insert_resource(floors);
    crate::chores::ensure(sim.world_mut());
    sim.world_mut()
        .resource_mut::<terri_core::chores::SavedChores>()
        .floors
        .push((13 * 20 + 17, 500));
    assert!(
        crate::chores::floor_at(sim.world(), 17, 13).is_some(),
        "outdoor boards are cleanable"
    );
    assert!(crate::chores::keys(sim.world()).contains(&ChoreKey {
        kind: ChoreKind::Floors,
        target: 0
    }));
    assert!(
        crate::chores::keys(sim.world())
            .iter()
            .filter(|k| k.kind == ChoreKind::Floors)
            .count()
            > 1
    );
}

#[test]
fn materials_outside_and_dormant_dirt_round_trip_without_cleaning() {
    for covering in 1..=4 {
        let mut sim = Sim::new_from_shipped_lot();
        let mut floors = SavedFloors::default();
        floors.set(17, 13, covering);
        floors.set(19, 13, covering);
        sim.world_mut().insert_resource(floors);
        assert_eq!(
            cleaning_area_at(sim.world(), (17, 13)),
            Some(CleaningArea::Outside)
        );
        assert_eq!(
            cleaning_area_at(sim.world(), (18, 13)),
            None,
            "unpainted grass"
        );
        assert_eq!(
            cleaning_area_at(sim.world(), (19, 13)),
            None,
            "street remains excluded"
        );
        crate::chores::ensure(sim.world_mut());
        sim.world_mut()
            .resource_mut::<terri_core::chores::SavedChores>()
            .floors
            .push((13 * 20 + 17, 700));
        sim.world_mut().resource_mut::<SavedFloors>().set(17, 13, 0);
        assert_eq!(crate::chores::floor_at(sim.world(), 17, 13), None);
        let saved = sim.save_snapshot_v16();
        let mut loaded = Sim::new_from_shipped_lot();
        loaded.load_snapshot_v16(saved.clone()).unwrap();
        assert_eq!(loaded.save_snapshot_v16(), saved);
        assert_eq!(
            loaded
                .world()
                .resource::<terri_core::chores::SavedChores>()
                .floors,
            vec![(13 * 20 + 17, 700)]
        );
        loaded
            .world_mut()
            .resource_mut::<SavedFloors>()
            .set(17, 13, covering);
        assert_eq!(
            crate::chores::floor_at(loaded.world(), 17, 13),
            Some(ChoreKey {
                kind: ChoreKind::Floors,
                target: 0
            })
        );
    }
}

#[test]
fn table_on_grass_has_outside_surface_duty_without_an_outside_floor_duty() {
    let mut sim = Sim::new_from_shipped_lot();
    let table = sim
        .world()
        .resource::<crate::Content>()
        .0
        .find("kitchen_table")
        .or_else(|| {
            sim.world()
                .resource::<crate::Content>()
                .0
                .find("dining_table")
        })
        .unwrap();
    let object = sim.spawn_object(terri_core::Position { x: 17.0, y: 13.0 }, table);
    let keys = crate::chores::keys(sim.world());
    assert!(keys.contains(&ChoreKey {
        kind: ChoreKind::TableSurfaces,
        target: 0
    }));
    assert!(!keys.contains(&ChoreKey {
        kind: ChoreKind::Floors,
        target: 0
    }));
    assert_eq!(
        sim.world().get::<terri_core::Position>(object).unwrap().x,
        17.0
    );
}

#[test]
fn rename_preserves_owners_daily_decisions_tasks_and_random_streams() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.tick();
    let before = crate::chores::RoomChangeContext::capture(sim.world()).unwrap();
    let old = sim
        .world()
        .resource::<terri_core::chores::SavedChores>()
        .clone();
    let rng = sim.world().resource::<terri_core::SimRng>().clone();
    let saved = sim
        .world()
        .resource::<terri_core::rooms::SavedRooms>()
        .clone();
    let proposal = match_rooms(&before.map, &before.map.topology, (0, 0));
    let mut choices = RoomChoices::default();
    choices.names.insert(
        before.map.topology.components[0].anchor,
        "Renamed kitchen".into(),
    );
    let resolved = resolve_rooms(&proposal, &choices, &saved).unwrap();
    let report = crate::chores::reconcile_committed_rooms(&mut sim, &before, &resolved).unwrap();
    assert!(report.replanned_people.is_empty());
    assert!(report.unavailable_people.is_empty());
    assert_eq!(
        sim.world().resource::<terri_core::chores::SavedChores>(),
        &old
    );
    assert_eq!(sim.world().resource::<terri_core::SimRng>(), &rng);
    let snapshot = sim.save_snapshot_v16();
    let mut resumed = Sim::new_from_shipped_lot();
    resumed.load_snapshot_v16(snapshot.clone()).unwrap();
    assert_eq!(resumed.save_snapshot_v16(), snapshot);
}

#[test]
fn stable_visit_ids_exceeding_tile_count_validate_and_missing_ids_refuse_atomically() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.tick();
    let mut snapshot = sim.save_snapshot_v16();
    let state = &mut snapshot
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy;
    let person = state.world.entities.iter().find(|e| e.agent).unwrap().index;
    let record = snapshot.rooms.records[0].clone();
    snapshot.rooms.records.push(terri_core::rooms::RoomRecord {
        id: terri_core::rooms::RoomId::new(9001).unwrap(),
        name: "Retired kitchen".into(),
        anchor: None,
    });
    snapshot.rooms.next_id = 9002;
    state
        .domestic
        .as_mut()
        .unwrap()
        .visits
        .retain(|v| v.person != person);
    state
        .domestic
        .as_mut()
        .unwrap()
        .visits
        .push(terri_core::save::SavedRoomVisit {
            person,
            room: 9001,
            seen: vec![],
        });
    state
        .domestic
        .as_mut()
        .unwrap()
        .visits
        .sort_by_key(|v| v.person);
    sim.load_snapshot_v16(snapshot.clone()).unwrap();
    let before = sim.save_snapshot_v16();
    snapshot.rooms.records.retain(|r| r.id.get() != 9001);
    assert!(sim.load_snapshot_v16(snapshot).is_err());
    assert_eq!(sim.save_snapshot_v16(), before);
    assert!(before.rooms.records.contains(&record));
}

fn resolve_now(sim: &Sim, before: &crate::chores::RoomChangeContext) -> ResolvedRooms {
    let topology = RoomTopology::from_world(sim.world()).unwrap();
    let proposal = match_rooms(&before.map, &topology, (0, 0));
    resolve_rooms(
        &proposal,
        &RoomChoices::default(),
        sim.world().resource::<terri_core::rooms::SavedRooms>(),
    )
    .unwrap()
}

#[test]
fn new_grassy_enclosure_has_no_floor_duty_until_painted_and_auto_off_stays_unassigned() {
    use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
    let mut sim = Sim::new_from_shipped_lot();
    sim.tick();
    sim.world_mut()
        .resource_mut::<terri_core::chores::SavedChores>()
        .board_enabled = false;
    let before = crate::chores::RoomChangeContext::capture(sim.world()).unwrap();
    let old = sim
        .world()
        .resource::<terri_core::chores::SavedChores>()
        .clone();
    let layout = sim.world().resource::<SavedLayout>().clone();
    let mut edges = layout.edges().to_vec();
    for x in 16..19 {
        for y in [12, 15] {
            edges.push(WallEdge {
                axis: EdgeAxis::Horizontal,
                x,
                y,
                doorway: false,
            });
        }
    }
    for y in 12..15 {
        for x in [16, 19] {
            edges.push(WallEdge {
                axis: EdgeAxis::Vertical,
                x,
                y,
                doorway: false,
            });
        }
    }
    edges.sort_by_key(|edge| (edge.axis as u8, edge.x, edge.y));
    edges.dedup();
    sim.world_mut()
        .insert_resource(SavedLayout::from_window_placements(
            edges,
            layout.window_placements(),
        ));
    let resolved = resolve_now(&sim, &before);
    let added = resolved.new_ids[0];
    crate::chores::reconcile_committed_rooms(&mut sim, &before, &resolved).unwrap();
    let key = ChoreKey {
        kind: ChoreKind::Floors,
        target: added.get(),
    };
    assert!(!crate::chores::keys(sim.world()).contains(&key));
    assert_eq!(cleaning_area_at(sim.world(), (17, 13)), None);
    let before = crate::chores::RoomChangeContext::capture(sim.world()).unwrap();
    sim.world_mut().insert_resource(SavedFloors::default());
    sim.world_mut().resource_mut::<SavedFloors>().set(17, 13, 4);
    let resolved = resolve_now(&sim, &before);
    let report = crate::chores::reconcile_committed_rooms(&mut sim, &before, &resolved).unwrap();
    assert!(crate::chores::keys(sim.world()).contains(&key));
    assert!(!sim
        .world()
        .resource::<terri_core::chores::SavedChores>()
        .assignments
        .iter()
        .any(|row| row.key == key));
    assert_eq!(
        sim.world()
            .resource::<terri_core::chores::SavedChores>()
            .rng,
        old.rng
    );
    assert!(report
        .duties
        .iter()
        .any(|row| row.key == key && row.kind == crate::chores::DutyChangeKind::Unassigned));
}

#[test]
fn moving_all_surface_objects_preserves_group_owner_and_daily_decision() {
    use terri_core::chores::*;
    let mut sim = Sim::new_from_shipped_lot();
    sim.tick();
    let before = crate::chores::RoomChangeContext::capture(sim.world()).unwrap();
    let (&old_key, objects) = before
        .groups
        .iter()
        .find(|(key, _)| key.kind == ChoreKind::CounterSurfaces)
        .unwrap();
    let old = sim.world().resource::<SavedChores>().clone();
    let assignment = old
        .assignments
        .iter()
        .find(|row| row.key == old_key)
        .unwrap();
    // Candidate edits have already passed placement admission. These object
    // positions directly model the final membership without running autonomy.
    for (index, id) in objects.iter().enumerate() {
        let entity = crate::dining::entity(sim.world(), *id).unwrap();
        sim.world_mut()
            .entity_mut(entity)
            .insert(terri_core::Position {
                x: 16.0 + index as f32,
                y: 13.0,
            });
    }
    let resolved = resolve_now(&sim, &before);
    let report = crate::chores::reconcile_committed_rooms(&mut sim, &before, &resolved).unwrap();
    let new_key = ChoreKey {
        kind: old_key.kind,
        target: 0,
    };
    let state = sim.world().resource::<SavedChores>();
    assert_eq!(
        state
            .assignments
            .iter()
            .find(|row| row.key == new_key)
            .unwrap()
            .owner,
        assignment.owner
    );
    for episode in old
        .episodes
        .iter()
        .filter(|row| row.key == old_key && !row.settled)
    {
        let current = state
            .episodes
            .iter()
            .find(|row| row.id == episode.id)
            .unwrap();
        assert_eq!(current.decision, episode.decision);
        assert_eq!(current.key, new_key);
    }
    assert!(report.duties.iter().any(|row| row.previous == Some(old_key)
        && row.key == new_key
        && row.kind == crate::chores::DutyChangeKind::Reassigned));
}

#[test]
fn review_stale_legacy_visit_and_duty_seeds_remain_separate_retired_history() {
    use terri_core::save::{SavedCleanupOpportunity, SavedDishes, SavedRoomVisit};
    let mut source = Sim::new_from_shipped_lot();
    source.tick();
    let mut historical = source.try_save_snapshot_v14().unwrap();
    let old = &mut historical.legacy.legacy.legacy.legacy.legacy.legacy;
    let person = old
        .world
        .entities
        .iter()
        .find(|entity| entity.agent)
        .unwrap()
        .index;
    let surface = old
        .world
        .entities
        .iter()
        .find(|entity| entity.smart_object.as_deref() == Some("counter"))
        .unwrap()
        .index;
    let domestic = old.domestic.as_mut().unwrap();
    domestic.dishes.push(SavedDishes {
        id: 500,
        surface,
        owner: 0,
        units: 1,
    });
    domestic.next_dish = 501;
    domestic.visits.retain(|visit| visit.person != person);
    domestic.visits.push(SavedRoomVisit {
        person,
        room: 319,
        seen: vec![500],
    });
    domestic.visits.sort_by_key(|visit| visit.person);
    let dining = old.dining.get_or_insert_with(Default::default);
    dining.opportunities.retain(|row| row.person != person);
    dining.opportunities.push(SavedCleanupOpportunity {
        person,
        room: 319,
        known: vec![500],
        pending: true,
    });
    dining.opportunities.sort_by_key(|row| row.person);
    let chores = old.chores.as_mut().unwrap();
    let episode = chores
        .episodes
        .iter_mut()
        .find(|row| row.key.kind == ChoreKind::Floors)
        .unwrap();
    episode.key.target = 319;
    episode.settled = true;
    let episode_id = episode.id;
    let rng = old.world.rng.clone();
    let chore_rng = chores.rng.clone();
    let mut migrated = Sim::new_from_shipped_lot();
    migrated.load_snapshot_v14(historical).unwrap();
    let state = migrated
        .world()
        .resource::<terri_core::save::SavedDomestic>();
    let visit = state
        .visits
        .iter()
        .find(|visit| visit.person == person)
        .unwrap();
    assert_eq!(visit.seen, vec![500]);
    let visit_id = terri_core::rooms::RoomId::new(visit.room).unwrap();
    let rooms = migrated.world().resource::<terri_core::rooms::SavedRooms>();
    assert_eq!(rooms.record(visit_id).unwrap().anchor, None);
    let opportunity = migrated
        .world()
        .resource::<terri_core::save::SavedDining>()
        .opportunities
        .iter()
        .find(|row| row.person == person)
        .unwrap();
    assert_eq!(opportunity.room, visit.room);
    assert_eq!(opportunity.known, vec![500]);
    assert!(opportunity.pending);
    let chores = migrated
        .world()
        .resource::<terri_core::chores::SavedChores>();
    let retired = chores
        .episodes
        .iter()
        .find(|episode| episode.id == episode_id)
        .unwrap()
        .key
        .target;
    assert_ne!(
        retired, visit.room,
        "historical room namespaces are independent"
    );
    assert_eq!(
        rooms
            .record(terri_core::rooms::RoomId::new(retired).unwrap())
            .unwrap()
            .anchor,
        None
    );
    assert_eq!(migrated.world().resource::<terri_core::SimRng>(), &rng);
    assert_eq!(chores.rng, chore_rng);
    assert!(migrated.try_save_snapshot_v14().is_err());
    let current = migrated.current_v19_view();
    let mut resumed = Sim::new_from_shipped_lot();
    resumed.load_current_v19_view(current.clone()).unwrap();
    assert_eq!(resumed.current_v19_view(), current);
    let before = crate::chores::RoomChangeContext::capture(resumed.world()).unwrap();
    let mut choices = RoomChoices::default();
    choices.names.insert(
        before.map.topology.components[0].anchor,
        "Renamed before next visit".into(),
    );
    let proposal = match_rooms(&before.map, &before.map.topology, (0, 0));
    let resolved = resolve_rooms(
        &proposal,
        &choices,
        resumed.world().resource::<terri_core::rooms::SavedRooms>(),
    )
    .unwrap();
    crate::chores::reconcile_committed_rooms(&mut resumed, &before, &resolved).unwrap();
    let visit = resumed
        .world()
        .resource::<terri_core::save::SavedDomestic>()
        .visits
        .iter()
        .find(|row| row.person == person)
        .unwrap();
    assert_eq!(
        visit.room,
        visit_id.get(),
        "a rename must not revive stale history"
    );
    assert_eq!(visit.seen, vec![500]);
    crate::domestic::tick(resumed.world_mut());
    let visit = resumed
        .world()
        .resource::<terri_core::save::SavedDomestic>()
        .visits
        .iter()
        .find(|row| row.person == person)
        .unwrap();
    assert_ne!(visit.room, visit_id.get());
    assert!(visit.seen.is_empty());
    let opportunity = resumed
        .world()
        .resource::<terri_core::save::SavedDining>()
        .opportunities
        .iter()
        .find(|row| row.person == person)
        .unwrap();
    assert!(opportunity.known.is_empty());
    assert!(!opportunity.pending);
}

#[test]
fn review_historical_projection_refuses_a_clean_extension_in_a_queued_room_target() {
    use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
    let mut sim = Sim::new_with_lot(20, 16);
    sim.world_mut().insert_resource(crate::LotFrame::default());
    let mut edges: Vec<_> = (0..18)
        .flat_map(|x| {
            [0, 12].map(move |y| WallEdge {
                axis: EdgeAxis::Horizontal,
                x,
                y,
                doorway: false,
            })
        })
        .chain((0..12).flat_map(|y| {
            [0, 18].map(move |x| WallEdge {
                axis: EdgeAxis::Vertical,
                x,
                y,
                doorway: false,
            })
        }))
        .collect();
    edges.sort_by_key(|edge| (edge.axis as u8, edge.x, edge.y));
    let mut grid = terri_core::TileGrid::new(20, 16);
    for edge in &edges {
        let [from, to] = edge.cells();
        if from.0 >= 0 && from.1 >= 0 {
            grid.set_edge_blocked(from, to, true);
        }
    }
    sim.world_mut().insert_resource(grid);
    sim.world_mut()
        .insert_resource(SavedLayout::EdgeWallsV1 { edges });
    let pack = sim.world().resource::<crate::Content>().0;
    sim.spawn_household(&pack.personalities, &pack.household, &pack.traits);
    initialize(sim.world_mut()).unwrap();
    let map = sim.world().resource::<RoomMap>();
    assert_eq!(map.topology.components.len(), 1);
    assert_eq!(map.selection_at((1, 1)), map.selection_at((17, 1)));
    let target = map.component_ids[0].get();
    let person = sim
        .world_mut()
        .query_filtered::<terri_core::Entity, bevy_ecs::prelude::With<terri_core::Agent>>()
        .iter(sim.world())
        .next()
        .unwrap()
        .index_u32();
    sim.world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::CleanChoreFirst {
            agent: person,
            key: ChoreKey {
                kind: ChoreKind::Floors,
                target,
            },
        });
    assert!(
        sim.try_save_snapshot_v14().is_err(),
        "the clean extension must not disappear from the command target"
    );
}
