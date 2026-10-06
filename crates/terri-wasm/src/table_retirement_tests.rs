use super::{SimHandle, SAVE_HEADER_BYTES, SAVE_MAGIC};
use terri_core::{save_v6::FrozenSaveSnapshotV6, SavedCommand};

const FIXTURES: &[&[u8]] = &[
    include_bytes!("../../terri-data/tests/fixtures/catalogue-retirement-v6/table-inactive-v6.sav"),
    include_bytes!("../../terri-data/tests/fixtures/catalogue-retirement-v6/table-queued-v6.sav"),
    include_bytes!("../../terri-data/tests/fixtures/catalogue-retirement-v6/table-active-v6.sav"),
    include_bytes!(
        "../../terri-data/tests/fixtures/catalogue-retirement-v6/table-active-pending-v6.sav"
    ),
    include_bytes!(
        "../../terri-data/tests/fixtures/catalogue-retirement-v6/table-active-waiter-v6.sav"
    ),
];
fn bytes(snapshot: &FrozenSaveSnapshotV6) -> Vec<u8> {
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend_from_slice(&6_u16.to_le_bytes());
    bytes.extend(postcard::to_allocvec(snapshot).unwrap());
    bytes
}
#[test]
fn table_retirement_public_v6_preserves_every_unrelated_field_and_order_identity() {
    for input in FIXTURES {
        let original: FrozenSaveSnapshotV6 =
            postcard::from_bytes(&input[SAVE_HEADER_BYTES..]).unwrap();
        assert_eq!(
            postcard::to_allocvec(&original).unwrap(),
            &input[SAVE_HEADER_BYTES..]
        );
        let mut expected = original.into_current();
        let migrated_values = super::current_v5(expected.legacy.clone());
        expected.legacy.affinities = migrated_values.affinities;
        expected.legacy.world.rng = migrated_values.world.rng;
        let table = expected
            .legacy
            .world
            .entities
            .iter()
            .find(|e| e.smart_object.as_deref() == Some("dining_table"))
            .unwrap()
            .index;
        for e in &mut expected.legacy.world.entities {
            if e.target
                .is_some_and(|t| t.object == table && t.interaction == 0)
            {
                e.target = None;
                e.eating = None;
                e.path = None;
                e.fumbled_delta_scale = None;
                e.restless = true;
            }
            if e.index == table {
                e.reserved = false;
            }
            if let Some(intents) = &mut e.intents {
                intents.retain(|i| i.object != table);
            }
            if let Some(habits) = &mut e.habituation {
                habits.retain(|h| h.object != "dining_table");
            }
            if let Some(personality) = &mut e.personality {
                personality
                    .dispositions
                    .retain(|h| h.object != "dining_table");
            }
        }
        for q in &mut expected.queues {
            q.orders.retain(|o| o.target != table);
        }
        let ordinary = std::mem::take(&mut expected.legacy.world.queued_commands);
        let mut ordinary = ordinary.into_iter();
        expected.command_order.retain(|row| {
            if row.is_some() { return true; }
            let command = ordinary.next().unwrap();
            if matches!(command, SavedCommand::UseObject {object, ..} | SavedCommand::UseObjectFirst {object, ..} if object == table) { return false; }
            expected.legacy.world.queued_commands.push(command); true
        });
        expected
            .actions
            .objects
            .iter_mut()
            .find(|o| o.model == "dining_table")
            .unwrap()
            .interactions = vec!["sit_properly".into(), "take_prepared_food".into()];
        let mut live = SimHandle::from_lot();
        assert!(live.load_bytes(input), "authentic pre-retirement V6 loads");
        let actual = live.sim.save_snapshot_v6();
        expected.legacy.world.content_fingerprint = actual.legacy.world.content_fingerprint;
        assert_eq!(
            actual, expected,
            "only documented table references may change"
        );
        let current = live.save_bytes();
        assert!(live.load_bytes(&current));
        assert_eq!(live.save_bytes(), current);
        assert!(!live
            .interaction_labels(table)
            .iter()
            .any(|s| s == "Sit down to eat"));
    }
}
#[test]
fn table_retirement_public_loader_validates_source_before_removing_retired_records() {
    let source: FrozenSaveSnapshotV6 =
        postcard::from_bytes(&FIXTURES[4][SAVE_HEADER_BYTES..]).unwrap();
    let table = source
        .legacy
        .world
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("dining_table"))
        .unwrap()
        .index;
    let mut live = SimHandle::from_lot();
    let clean = live.save_bytes();
    let hash = live.world_hash();
    for kind in 0..5 {
        let mut invalid = source.clone();
        match kind {
            0 => {
                invalid
                    .actions
                    .objects
                    .iter_mut()
                    .find(|o| o.model == "dining_table")
                    .unwrap()
                    .interactions[0] = "unknown_table_action".into()
            }
            1 => {
                invalid
                    .actions
                    .objects
                    .iter_mut()
                    .find(|o| o.model == "television")
                    .unwrap()
                    .interactions[0] = "unknown_tv_action".into()
            }
            2 => {
                invalid
                    .legacy
                    .world
                    .entities
                    .iter_mut()
                    .find(|e| e.target.is_some_and(|t| t.object == table))
                    .unwrap()
                    .target
                    .as_mut()
                    .unwrap()
                    .interaction = 1
            }
            3 => {
                invalid
                    .queues
                    .iter_mut()
                    .find(|q| q.orders.iter().any(|o| o.target == table))
                    .unwrap()
                    .orders
                    .iter_mut()
                    .find(|o| o.target == table)
                    .unwrap()
                    .action = "interaction:unknown_table_action".into()
            }
            _ => {
                invalid
                    .actions
                    .objects
                    .iter_mut()
                    .find(|o| o.model == "dining_table")
                    .unwrap()
                    .structure ^= 1
            }
        }
        assert!(
            !live.load_bytes(&bytes(&invalid)),
            "malformed source {kind} must reject before cleanup"
        );
        assert_eq!(live.save_bytes(), clean);
        assert_eq!(live.world_hash(), hash);
    }
}
#[test]
fn table_retirement_real_published_v5_household_keeps_dining_surface_and_loads_once() {
    let source =
        include_bytes!("../../terri-data/tests/fixtures/pre-books-920abaf/household-0.sav");
    let mut live = SimHandle::from_lot();
    assert!(live.load_bytes(source));
    let current = live.sim.save_snapshot_v6();
    assert_eq!(current.books.copies.len(), 5);
    assert_eq!(
        current
            .actions
            .objects
            .iter()
            .find(|o| o.model == "dining_table")
            .unwrap()
            .interactions,
        vec!["sit_properly".to_string(), "take_prepared_food".to_string()]
    );
    let pack = live.sim.world().resource::<terri_sim::Content>().0;
    let table = pack.object(pack.find("dining_table").unwrap());
    assert!(table
        .roles
        .iter()
        .any(|&r| pack.roles[r as usize] == "meal_table"));
    let saved = live.save_bytes();
    assert!(live.load_bytes(&saved));
    assert_eq!(live.save_bytes(), saved);
}
#[test]
fn table_retirement_frozen_published_contract_preserves_an_active_tv_and_table_waiter() {
    use terri_core::{CommandQueue, Entity, SimCommand, SimId, SmartObject};
    use terri_sim::{Content, Sim};
    let pack = Content::published_pre_books().0;
    let mut source = Sim::new_household_with_content(Content(pack), 1);
    let mut people: Vec<_> = source
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(source.world())
        .map(|(e, id)| (id.0, e))
        .collect();
    people.sort_by_key(|(id, _)| *id);
    let table = source
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(source.world())
        .find(|(_, o)| pack.object(o.0).id == "dining_table")
        .unwrap()
        .0;
    let tv = source
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(source.world())
        .find(|(_, o)| pack.object(o.0).id == "television")
        .unwrap()
        .0;
    assert_eq!(
        pack.object(pack.find("dining_table").unwrap()).interactions[0].id,
        "sit_properly"
    );
    for (person, object) in [(people[0].1, table), (people[1].1, tv)] {
        source
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObjectFirst {
                agent: person.index_u32(),
                object: object.index_u32(),
                interaction: 0,
            });
    }
    source.flush_commands();
    for _ in 0..100 {
        source.tick();
        if [people[0].1, people[1].1]
            .iter()
            .all(|p| source.world().get::<terri_core::Eating>(*p).is_some())
        {
            break;
        }
    }
    assert!(source
        .world()
        .get::<terri_core::Eating>(people[0].1)
        .is_some());
    assert_eq!(
        source
            .world()
            .get::<terri_core::Target>(people[0].1)
            .unwrap()
            .object,
        table
    );
    assert_eq!(
        source
            .world()
            .get::<terri_core::Target>(people[1].1)
            .unwrap()
            .object,
        tv
    );
    source
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: people[2].1.index_u32(),
            object: table.index_u32(),
            interaction: 0,
        });
    source.flush_commands();
    let old = source.save_snapshot_v5();
    let mut input = SAVE_MAGIC.to_vec();
    input.extend_from_slice(&5_u16.to_le_bytes());
    let mut payload = postcard::to_allocvec(&old).unwrap();
    let modern_tail: Vec<u8> = [
        postcard::to_allocvec(&old.affinities).unwrap(),
        postcard::to_allocvec(&old.targeted_cleanup).unwrap(),
        postcard::to_allocvec(&old.chores).unwrap(),
        postcard::to_allocvec(&old.grime).unwrap(),
    ]
    .into_iter()
    .flatten()
    .collect();
    assert!(payload.ends_with(&modern_tail));
    payload.truncate(payload.len() - modern_tail.len());
    input.extend(payload);
    let mut current = SimHandle::from_lot();
    assert!(current.load_bytes(&input));
    let migrated = current.sim.save_snapshot_v6();
    let old_tv = old
        .world
        .entities
        .iter()
        .find(|e| e.index == people[1].1.index_u32())
        .unwrap();
    let new_tv = migrated
        .legacy
        .world
        .entities
        .iter()
        .find(|e| e.index == people[1].1.index_u32())
        .unwrap();
    assert_eq!(new_tv, old_tv);
    assert_eq!(migrated.legacy.world.funds, old.world.funds);
    assert_eq!(
        migrated.legacy.world.rng,
        super::current_v5(old.clone()).world.rng
    );
    assert!(migrated
        .queues
        .iter()
        .flat_map(|q| &q.orders)
        .all(|o| o.target != table.index_u32()));
    assert!(migrated
        .legacy
        .world
        .entities
        .iter()
        .all(|e| e.target.is_none_or(|t| t.object != table.index_u32())));
    let saved = current.save_bytes();
    assert!(current.load_bytes(&saved));
    assert_eq!(current.save_bytes(), saved);
}
