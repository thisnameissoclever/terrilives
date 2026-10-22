use super::*;
use terri_core::{SmartObject, TileGrid};

#[test]
fn historical_occupied_overlap_reconciles_an_active_media_seat_before_resave() {
    let mut sim = Sim::new_with_lot(16, 16);
    let pack = sim.world().resource::<Content>().0;
    let blocker = sim.spawn_object(Position { x: 10., y: 10. }, pack.find("counter").unwrap());
    let device = sim.spawn_object(Position { x: 2., y: 3. }, pack.find("television").unwrap());
    let chair = sim.spawn_object(Position { x: 5., y: 3. }, pack.find("armchair").unwrap());
    for (entity, facing) in [
        (blocker, Facing::SouthWest),
        (device, Facing::SouthEast),
        (chair, Facing::SouthWest),
    ] {
        let at = *sim.world().get::<Position>(entity).unwrap();
        let definition = pack.object(sim.world().get::<SmartObject>(entity).unwrap().0);
        crate::apply_object_placement(sim.world_mut(), entity, definition, at, facing);
        let footprint = definition.footprint_at(facing);
        for y in at.y as usize..at.y as usize + footprint.depth as usize {
            for x in at.x as usize..at.x as usize + footprint.width as usize {
                sim.world_mut()
                    .resource_mut::<TileGrid>()
                    .set_blocked(x, y, true);
            }
        }
    }
    let actor = sim.spawn_agent(Position { x: 0., y: 3. }, 100.);
    sim.world_mut()
        .entity_mut(actor)
        .insert(IntentQueue::from_intents(vec![Intent {
            cleanup: None,
            chore: None,
            object: device,
            interaction: 0,
        }]));
    for _ in 0..120 {
        sim.tick();
        if sim.world().get::<Eating>(actor).is_some() {
            break;
        }
    }
    assert!(sim.world().get::<Eating>(actor).is_some());
    assert_eq!(
        crate::seating::claim(sim.world(), actor.index_u32())
            .unwrap()
            .chair,
        Some(chair.index_u32())
    );
    let queue_ids = sim
        .world()
        .get::<IntentQueue>(actor)
        .unwrap()
        .entries()
        .iter()
        .map(|entry| entry.id)
        .collect::<Vec<_>>();
    let old = sim.save_snapshot_v19();
    let mut positive = Sim::new_with_lot(1, 1);
    positive
        .load_snapshot_v19(old)
        .expect("valid historical active media control");
    positive
        .load_snapshot_v21(positive.save_snapshot_v21())
        .expect("current control");
    let chair_position = *sim.world().get::<Position>(chair).unwrap();
    sim.world_mut().entity_mut(blocker).insert(chair_position);
    let overlapping = sim.save_snapshot_v19();
    let mut restored = Sim::new_with_lot(1, 1);
    restored
        .load_snapshot_v19(overlapping)
        .expect("supported historical occupied overlap with active media");
    assert_ne!(
        restored.world().get::<Position>(chair),
        Some(&Position { x: 5., y: 3. })
    );
    assert!(restored.world().get::<SmartObject>(blocker).is_some());
    assert!(restored.world().get::<SmartObject>(chair).is_some());
    assert_eq!(
        restored
            .world()
            .get::<Target>(actor)
            .map(|target| target.object),
        Some(device)
    );
    assert_eq!(
        restored
            .world()
            .get::<IntentQueue>(actor)
            .unwrap()
            .entries()
            .iter()
            .map(|entry| entry.id)
            .collect::<Vec<_>>(),
        queue_ids
    );
    assert!(!restored
        .world()
        .resource::<crate::social_episode::SocialEpisodes>()
        .communal
        .contains_key(&actor));
    let current = restored.save_snapshot_v21();
    restored
        .load_snapshot_v21(current.clone())
        .expect("adoption must reconcile the moved physical owner");
    assert_eq!(restored.save_snapshot_v21(), current);
}

#[test]
fn historical_occupied_overlap_reconciles_active_chore_contacts_before_resave() {
    use bevy_ecs::prelude::*;
    use terri_core::chores::{ChoreKind, SavedChores};
    let mut sim = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
    crate::chores::ensure(sim.world_mut());
    let pack = sim.world().resource::<Content>().0;
    let blocker = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, model)| pack.object(model.0).id == "fridge")
        .unwrap()
        .0;
    let actor = sim
        .world_mut()
        .query_filtered::<Entity, With<terri_core::Agent>>()
        .iter(sim.world())
        .next()
        .unwrap();
    let key = *crate::chores::keys(sim.world())
        .iter()
        .find(|key| key.kind == ChoreKind::CounterSurfaces)
        .unwrap();
    let counter_ids = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .filter(|(_, model)| pack.object(model.0).id == "counter")
        .map(|(entity, _)| entity.index_u32())
        .collect::<Vec<_>>();
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    state.board_enabled = false;
    state.surfaces = counter_ids.iter().map(|id| (*id, 850)).collect();
    state.surfaces.sort();
    assert!(crate::chores::start_response(
        sim.world_mut(),
        &mut state,
        actor,
        key,
        true
    ));
    sim.world_mut().insert_resource(state);
    for _ in 0..300 {
        sim.tick();
        if sim
            .world()
            .resource::<SavedChores>()
            .tasks
            .iter()
            .any(|task| task.person == actor.index_u32() && task.remaining > 0)
        {
            break;
        }
    }
    let task = sim
        .world()
        .resource::<SavedChores>()
        .tasks
        .iter()
        .find(|task| task.person == actor.index_u32())
        .unwrap()
        .clone();
    assert!(task.remaining > 0);
    let counter = crate::dining::entity(sim.world(), task.cells[task.cursor as usize]).unwrap();
    assert!(blocker.index_u32() < counter.index_u32());
    let old = sim.save_snapshot_v19();
    let mut positive = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
    positive
        .load_snapshot_v19(old)
        .expect("historical active chore control");
    positive
        .load_snapshot_v21(positive.save_snapshot_v21())
        .expect("current active chore control");
    let counter_position = *sim.world().get::<Position>(counter).unwrap();
    sim.world_mut().entity_mut(blocker).insert(counter_position);
    let overlapping = sim.save_snapshot_v19();
    let mut restored = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
    restored
        .load_snapshot_v19(overlapping)
        .expect("supported historical overlap with active chore");
    assert_ne!(
        restored.world().get::<Position>(counter),
        Some(&counter_position)
    );
    let current = restored.save_snapshot_v21();
    restored
        .load_snapshot_v21(current.clone())
        .expect("adoption must reconcile the moved chore contact");
    assert_eq!(restored.save_snapshot_v21(), current);
}
