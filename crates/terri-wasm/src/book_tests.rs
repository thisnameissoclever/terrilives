use super::*;
use terri_core::{books::BookCopy, command::BookCommand};
#[test]
fn book_boundary_commands_query_and_pending_round_trip() {
    let mut handle = SimHandle::from_lot();
    handle
        .sim
        .world_mut()
        .insert_resource(terri_core::Funds(100_000));
    let title = handle.sim.book_titles()[0].id.clone();
    let price = handle.sim.book_titles()[0].price;
    let funds = handle.sim.save_snapshot_v6().legacy.world.funds;
    let original = handle.sim.book_copies().to_vec();
    assert_eq!(original.len(), 3);
    assert_eq!(
        original
            .iter()
            .map(|copy| &copy.title_id)
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        3
    );
    let next = handle.sim.save_snapshot_v6().books.next_copy_id;
    assert!(handle.buy_book(title.clone(), None));
    assert!(handle.enqueue_command(&postcard::to_allocvec(&SimCommand::Select(None)).unwrap()));
    assert!(handle.transfer_book(f64::from(next), None));
    let bytes = handle.save_bytes();
    let hash = handle.world_hash();
    for _ in 0..10 {
        handle.book_catalogue();
        handle.book_copies();
        handle.book_shelves();
    }
    assert_eq!(handle.save_bytes(), bytes);
    assert_eq!(handle.world_hash(), hash);
    assert!(handle.load_bytes(&bytes));
    handle.sim.flush_commands();
    let copies: Vec<BookCopy> = postcard::from_bytes(&handle.book_copies()).unwrap();
    assert_eq!(copies.len(), 4);
    assert_eq!(&copies[..3], original.as_slice());
    assert_eq!(copies[3].id.0, next);
    assert_eq!(copies[3].title_id, title);
    assert!(matches!(
        copies[3].location,
        terri_core::books::BookLocation::Shelf(_)
    ));
    assert_eq!(
        handle.sim.save_snapshot_v6().legacy.world.funds,
        funds - i64::from(price)
    );
    assert_eq!(
        handle.take_book_results(),
        vec![
            "1".to_string(),
            next.to_string(),
            "".into(),
            "".into(),
            "2".into(),
            next.to_string(),
            "".into(),
            "".into()
        ]
    );
    assert!(handle.take_book_results().is_empty());
    assert!(handle.buy_book("unknown_title".into(), None));
    handle.sim.flush_commands();
    assert_eq!(
        handle.take_book_results(),
        vec!["3", "", "", "unknown_title"]
    );
}
#[test]
fn book_boundary_legacy_notice_is_only_for_successful_historical_import() {
    let mut handle = SimHandle::from_lot();
    assert!(!handle.take_legacy_book_import_notice());
    let historical = include_bytes!("../../terri-data/tests/fixtures/pre-books/household-0.sav");
    assert!(handle.load_bytes(historical));
    assert!(handle.take_legacy_book_import_notice());
    assert!(!handle.take_legacy_book_import_notice());
    let current = handle.save_bytes();
    assert!(handle.load_bytes(&current));
    assert!(!handle.take_legacy_book_import_notice());
    assert!(handle.load_bytes(historical));
    assert!(!handle.load_bytes(&[0]));
    assert!(!handle.take_legacy_book_import_notice());
}
#[test]
fn book_boundary_all_frozen_envelopes_refuse_each_new_command_with_valid_controls() {
    let mut source = Sim::new_with_lot_and_content(8, 8, Content::pre_books());
    for speed in [251, 252, 253] {
        source
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::SetSpeed(speed));
    }
    let marker = postcard::to_allocvec(&vec![
        terri_core::SavedCommand::SetSpeed(251),
        terri_core::SavedCommand::SetSpeed(252),
        terri_core::SavedCommand::SetSpeed(253),
    ])
    .unwrap();
    let payloads = [
        postcard::to_allocvec(&source.save_snapshot()).unwrap(),
        postcard::to_allocvec(&source.save_snapshot_v2()).unwrap(),
        postcard::to_allocvec(&source.save_snapshot_v3()).unwrap(),
        postcard::to_allocvec(&source.save_snapshot_v4()).unwrap(),
        postcard::to_allocvec(&source.save_snapshot_v5()).unwrap(),
    ];
    let commands = [
        BookCommand::Purchase {
            title: "the_locked_laundry".into(),
            shelf: None,
        },
        BookCommand::Transfer {
            copy: 0,
            shelf: None,
        },
        BookCommand::Read {
            agent: 0,
            object: 1,
            action: "read".into(),
            title: "the_locked_laundry".into(),
            front: false,
        },
    ];
    for (i, payload) in payloads.into_iter().enumerate() {
        let mut bytes = SAVE_MAGIC.to_vec();
        bytes.extend_from_slice(&((i + 1) as u16).to_le_bytes());
        bytes.extend(payload);
        let mut handle = SimHandle::from_lot();
        assert!(handle.load_bytes(&bytes), "valid V{} control", i + 1);
        let before = handle.save_bytes();
        let hash = handle.world_hash();
        let offsets: Vec<_> = bytes
            .windows(marker.len())
            .enumerate()
            .filter_map(|(i, w)| (w == marker).then_some(i))
            .collect();
        assert_eq!(offsets.len(), 1);
        for command in &commands {
            let mut bad = bytes.clone();
            let start = offsets[0] + 1;
            bad.splice(
                start..start + 2,
                postcard::to_allocvec(&SimCommand::Book(command.clone())).unwrap(),
            );
            assert!(!handle.load_bytes(&bad), "V{} accepted {command:?}", i + 1);
            assert_eq!(handle.save_bytes(), before);
            assert_eq!(handle.world_hash(), hash);
        }
    }
}

#[test]
fn book_boundary_rejects_fractional_nonfinite_negative_and_wrapping_references() {
    let mut handle = SimHandle::from_lot();
    let title = handle.sim.book_titles()[0].id.clone();
    assert!(handle.buy_book("missing".into(), None));
    handle.sim.flush_commands();
    let before = handle.save_bytes();
    for invalid in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        -1.0,
        0.5,
        4294967296.0,
    ] {
        assert!(!handle.buy_book(title.clone(), Some(invalid)));
        assert!(!handle.transfer_book(invalid, None));
        assert!(!handle.transfer_book(0.0, Some(invalid)));
        assert!(!handle.read_book(invalid, 0.0, "read".into(), title.clone(), false));
        assert!(!handle.read_book(0.0, invalid, "read".into(), title.clone(), true));
        assert!(handle.book_interest(invalid, &title).is_none());
        assert!(handle.book_shelf_slots(invalid, false).is_empty());
        assert_eq!(handle.save_bytes(), before);
    }
    assert_eq!(
        handle.take_book_results(),
        vec!["1", "", "", "unknown_title"]
    );
}
#[test]
fn book_boundary_store_estimate_is_pure_without_furniture_context() {
    let handle = SimHandle::from_lot();
    let title = handle.sim.book_titles()[0].id.clone();
    let person = handle
        .sim
        .save_snapshot_v6()
        .legacy
        .world
        .entities
        .iter()
        .find(|e| e.agent)
        .unwrap()
        .index;
    let before = handle.save_bytes();
    let hash = handle.world_hash();
    for _ in 0..20 {
        assert!(handle.book_interest(f64::from(person), &title).unwrap() > 0.0);
    }
    assert_eq!(handle.save_bytes(), before);
    assert_eq!(handle.world_hash(), hash);
}

#[test]
fn book_boundary_pending_deferred_refusals_survive_save_load() {
    let mut handle = SimHandle::from_lot();
    let before = handle.save_bytes();
    assert!(handle.buy_book("unknown".into(), None));
    assert!(handle.transfer_book(4294967295.0, None));
    let pending = handle.save_bytes();
    assert!(handle.load_bytes(&pending));
    handle.sim.flush_commands();
    assert_eq!(handle.save_bytes(), before);
    assert_eq!(
        handle.take_book_results(),
        vec!["1", "", "", "unknown_title", "2", "", "", "unknown_copy"]
    );
}
#[test]
fn book_boundary_current_v6_does_not_migrate_missing_optional_instinct_or_consume_rng() {
    let mut source = SimHandle::new(8, 8);
    source.spawn_agent(2.0, 2.0, 80.0);
    let person = source
        .sim
        .world_mut()
        .query::<(terri_core::Entity, &terri_core::Agent)>()
        .iter(source.sim.world())
        .next()
        .unwrap()
        .0;
    source
        .sim
        .world_mut()
        .entity_mut(person)
        .remove::<terri_core::SelfPreservation>();
    let bytes = source.save_bytes();
    let hash = source.world_hash();
    let rng = source.sim.save_snapshot_v6().legacy.world.rng;
    let mut restored = SimHandle::new(8, 8);
    assert!(restored.load_bytes(&bytes));
    assert_eq!(restored.save_bytes(), bytes);
    assert_eq!(restored.world_hash(), hash);
    assert_eq!(restored.sim.save_snapshot_v6().legacy.world.rng, rng);
    assert!(restored
        .sim
        .save_snapshot_v6()
        .legacy
        .self_preservation
        .is_empty());
}
#[test]
fn book_boundary_real_reading_stage_transport_and_progress_columns_round_trip() {
    let mut handle = SimHandle::new(12, 12);
    handle.spawn_agent(2.0, 2.0, 80.0);
    assert!(handle.spawn_object(6.0, 6.0, "reading_chair"));
    let person = handle
        .sim
        .world_mut()
        .query::<(terri_core::Entity, &terri_core::Agent)>()
        .iter(handle.sim.world())
        .next()
        .unwrap()
        .0;
    let chair = handle
        .sim
        .world_mut()
        .query::<(terri_core::Entity, &terri_core::SmartObject)>()
        .iter(handle.sim.world())
        .next()
        .unwrap()
        .0;
    super::boundary_tests::start_owned_reading(&mut handle, person, chair);
    handle.tick();
    let rows = handle.sim.render_buffer();
    let row = rows
        .ids
        .iter()
        .position(|id| *id == person.index_u32())
        .unwrap();
    assert_eq!(rows.reading_stages[row], 3);
    assert_eq!(rows.carried_books[row], 0);
    assert_eq!(rows.carrying[row], u32::MAX);
    assert_eq!(rows.reading_seats[row], chair.index_u32());
    assert_eq!(handle.carried_books_ptr(), rows.carried_books.as_ptr());
    assert_eq!(handle.reading_stages_ptr(), rows.reading_stages.as_ptr());
    assert_eq!(handle.reading_seats_ptr(), rows.reading_seats.as_ptr());
    let projection: Vec<terri_core::save_v6::SavedReadingJourney> =
        postcard::from_bytes(&handle.reading_journeys()).unwrap();
    assert_eq!(projection.len(), 1);
    let title = handle.sim.book_copies()[0].title_id.clone();
    let progress: Option<terri_core::books::TitleMemory> =
        postcard::from_bytes(&handle.reading_progress(f64::from(person.index_u32()), &title))
            .unwrap();
    assert_eq!(progress.unwrap().progress_ticks, 1);
    let saved = handle.save_bytes();
    let hash = handle.world_hash();
    assert!(handle.load_bytes(&saved));
    assert_eq!(handle.save_bytes(), saved);
    assert_eq!(handle.world_hash(), hash);
    for bad in [
        -1.0,
        0.5,
        f64::NAN,
        f64::INFINITY,
        f64::from(u32::MAX) + 1.0,
    ] {
        let p: Option<terri_core::books::TitleMemory> =
            postcard::from_bytes(&handle.reading_progress(bad, &title)).unwrap();
        assert!(p.is_none());
        assert!(handle.reading_action_benefits(bad, "settle_in").is_empty());
    }
}
#[test]
fn book_boundary_shelf_masks_cover_slot_31_and_32_without_truncating_capacity() {
    let mut handle = SimHandle::new(12, 12);
    let mut pack = handle.sim.world().resource::<Content>().0.clone();
    let shelf_def = pack.find("bookshelf").unwrap();
    pack.objects[shelf_def.0 as usize].shelf_capacity = 33;
    handle
        .sim
        .world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    assert!(handle.spawn_object(4.0, 4.0, "bookshelf"));
    assert!(handle.spawn_object(8.0, 8.0, "bookshelf"));
    handle
        .sim
        .world_mut()
        .insert_resource(terri_core::Funds(100000));
    let title = handle.sim.book_titles()[0].id.clone();
    for _ in 0..33 {
        assert!(handle.buy_book(title.clone(), Some(0.0)));
    }
    handle.sim.flush_commands();
    handle.sim.sync_render_buffer_after_commands();
    let r = handle.sim.render_buffer();
    assert_eq!(r.shelf_book_offsets, vec![0, 2]);
    assert_eq!(r.shelf_book_counts, vec![2, 2]);
    assert_eq!(r.shelf_book_masks, vec![u32::MAX, 1, 0, 0]);
    assert_eq!(handle.shelf_book_mask_count(), 4);
    assert_eq!(handle.shelf_book_masks_ptr(), r.shelf_book_masks.as_ptr());
    assert_eq!(
        handle.shelf_book_offsets_ptr(),
        r.shelf_book_offsets.as_ptr()
    );
    assert_eq!(handle.shelf_book_counts_ptr(), r.shelf_book_counts.as_ptr());
    assert!(handle.transfer_book(31.0, Some(1.0)));
    handle.sim.flush_commands();
    handle.sim.sync_render_buffer_after_commands();
    assert_eq!(
        handle.sim.render_buffer().shelf_book_masks,
        vec![0x7fff_ffff, 1, 1, 0]
    );
    assert!(handle.transfer_book(32.0, Some(1.0)));
    handle.sim.flush_commands();
    handle.sim.sync_render_buffer_after_commands();
    assert_eq!(
        handle.sim.render_buffer().shelf_book_masks,
        vec![0x7fff_ffff, 0, 3, 0]
    );
    let bytes = handle.save_bytes();
    assert!(handle.load_bytes(&bytes));
    assert_eq!(
        handle.sim.render_buffer().shelf_book_masks,
        vec![0x7fff_ffff, 0, 3, 0]
    );
    assert_eq!(handle.sim.book_copies().len(), 33);
}
#[test]
fn book_fix1_inflated_positive_midread_earnings_reject_with_bytes_hash_rng_unchanged() {
    let mut handle = SimHandle::new(16, 16);
    handle.spawn_agent(2.0, 2.0, 80.0);
    assert!(handle.spawn_object(6.0, 6.0, "reading_chair"));
    let person = handle
        .sim
        .world_mut()
        .query::<(terri_core::Entity, &terri_core::Agent)>()
        .iter(handle.sim.world())
        .next()
        .unwrap()
        .0;
    let chair = handle
        .sim
        .world_mut()
        .query::<(terri_core::Entity, &terri_core::SmartObject)>()
        .iter(handle.sim.world())
        .next()
        .unwrap()
        .0;
    handle
        .sim
        .world_mut()
        .entity_mut(person)
        .insert(terri_core::Satisfaction::from_value(50.0));
    super::boundary_tests::start_owned_reading(&mut handle, person, chair);
    handle.tick();
    let bytes = handle.save_bytes();
    let hash = handle.world_hash();
    let rng = handle.sim.save_snapshot_v6().legacy.world.rng;
    let mut bad = handle.sim.save_snapshot_v6();
    assert!(bad.reading[0].work > 0.0 && bad.reading[0].earned_satisfaction > 0.0);
    bad.reading[0].earned_satisfaction *= 100.0;
    let mut corrupted = SAVE_MAGIC.to_vec();
    corrupted.extend_from_slice(&6u16.to_le_bytes());
    corrupted.extend(postcard::to_allocvec(&bad).unwrap());
    assert!(!handle.load_bytes(&corrupted));
    assert_eq!(handle.save_bytes(), bytes);
    assert_eq!(handle.world_hash(), hash);
    assert_eq!(handle.sim.save_snapshot_v6().legacy.world.rng, rng);
    assert!(handle.load_bytes(&bytes));
    assert_eq!(handle.save_bytes(), bytes);
}
