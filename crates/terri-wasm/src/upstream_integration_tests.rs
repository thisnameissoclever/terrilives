use super::*;

/// Constructed source-admissibility evidence, not a normal-play capture.
/// The actual 845101d loader accepts this state. Preserve that accepted
/// continuation without promising same-device admission or general acceptance
/// of fabricated current snapshots.
#[test]
fn upstream_constructed_source_admissible_tv_continuation_survives_migration() {
    let bytes = include_bytes!("../../terri-data/tests/fixtures/source-admissibility/constructed-tv-continuation-845101d-v5.sav");
    let source = decode_v5(&bytes[SAVE_HEADER_BYTES..]).unwrap();
    let viewers: Vec<_> = source
        .world
        .entities
        .iter()
        .filter(|person| {
            person
                .eating
                .as_ref()
                .is_some_and(|activity| activity.object == "television")
        })
        .collect();
    assert_eq!(
        viewers.len(),
        2,
        "the labelled witness contains two accepted viewers"
    );
    assert_eq!(viewers[0].target, viewers[1].target);
    let mut handle = SimHandle::from_lot();
    assert!(handle.load_bytes(bytes));
    let migrated = handle.sim.save_snapshot_v6();
    assert_eq!(migrated.legacy.world.funds, source.world.funds);
    assert_eq!(
        migrated.legacy.world.rng,
        current_v5(source.clone()).world.rng
    );
    assert_eq!(migrated.legacy.world.tick, source.world.tick);
    for before in viewers {
        let after = migrated
            .legacy
            .world
            .entities
            .iter()
            .find(|person| person.index == before.index)
            .unwrap();
        assert_eq!(after.target, before.target);
        assert_eq!(after.eating, before.eating);
        assert_eq!(after.position, before.position);
        assert_eq!(after.path, before.path);
        assert_eq!(after.intents, before.intents);
        assert_eq!(after.relationships, before.relationships);
        assert_eq!(after.needs, before.needs);
    }
    let current = handle.save_bytes();
    let hash = handle.world_hash();
    assert!(handle.load_bytes(&current));
    assert_eq!(handle.sim.save_snapshot_v6(), migrated);
    assert_eq!(handle.save_bytes(), current);
    assert_eq!(handle.world_hash(), hash);
}

#[test]
fn upstream_published_empty_skill_state_is_authoritative() {
    let bytes = include_bytes!("../../terri-data/tests/fixtures/pre-books-920abaf/household-0.sav");
    let mut source = decode_v5(&bytes[SAVE_HEADER_BYTES..]).unwrap();
    assert!(!source.skills.as_ref().unwrap().rows.is_empty());
    source.skills = Some(terri_core::save::SavedSkills::default());
    let mut handle = SimHandle::from_lot();
    assert!(handle.load_bytes(&super::save_v3_tests::v5_bytes(&source)));
    assert!(handle
        .sim
        .save_snapshot_v6()
        .legacy
        .skills
        .unwrap()
        .rows
        .is_empty());
    let current = handle.save_bytes();
    assert!(handle.load_bytes(&current));
    assert_eq!(handle.save_bytes(), current);
}

#[test]
fn upstream_published_skills_households_migrate_without_losing_practice_or_identity() {
    for bytes in [
        include_bytes!("../../terri-data/tests/fixtures/pre-books-920abaf/household-0.sav")
            .as_slice(),
        include_bytes!("../../terri-data/tests/fixtures/pre-books-920abaf/household-100.sav")
            .as_slice(),
        include_bytes!("../../terri-data/tests/fixtures/pre-books-920abaf/household-1000.sav")
            .as_slice(),
        include_bytes!("../../terri-data/tests/fixtures/pre-books-920abaf/household-2000.sav")
            .as_slice(),
        include_bytes!("../../terri-data/tests/fixtures/pre-books-920abaf/pending-edit.sav")
            .as_slice(),
        include_bytes!("../../terri-data/tests/fixtures/pre-books-920abaf/edited.sav").as_slice(),
        include_bytes!(
            "../../terri-data/tests/fixtures/pre-books-920abaf/repeated-snacks-bill.sav"
        )
        .as_slice(),
    ] {
        let original = decode_v5(&bytes[SAVE_HEADER_BYTES..]).unwrap();
        assert!(original.skills.is_some());
        let mut handle = SimHandle::from_lot();
        assert!(
            handle.load_bytes(bytes),
            "published tick {}",
            original.world.tick
        );
        let saved = handle.sim.save_snapshot_v6();
        assert_eq!(saved.legacy.skills, original.skills);
        assert_eq!(saved.legacy.world.funds, original.world.funds);
        assert_eq!(
            saved.legacy.world.rng,
            current_v5(original.clone()).world.rng
        );
        assert_eq!(saved.legacy.world.tick, original.world.tick);
        assert_eq!(saved.legacy.family, original.family);
        assert_eq!(
            saved.legacy.world.issued_sim_ids,
            original.world.issued_sim_ids
        );
        for person in original.world.entities.iter().filter(|e| e.agent) {
            let migrated = saved
                .legacy
                .world
                .entities
                .iter()
                .find(|e| e.index == person.index)
                .unwrap();
            assert_eq!(migrated.sim_id, person.sim_id);
            assert_eq!(migrated.sim_name, person.sim_name);
            assert_eq!(migrated.needs, person.needs);
            assert_eq!(migrated.traits, person.traits);
            assert_eq!(migrated.relationships, person.relationships);
            assert_eq!(migrated.satisfaction, person.satisfaction);
        }
        assert_eq!(saved.books.copies.len(), 5);
        let current = handle.save_bytes();
        assert!(handle.load_bytes(&current));
        assert_eq!(handle.save_bytes(), current);
        for person in original.world.entities.iter().filter(|e| e.agent) {
            for repeated in person
                .habituation
                .iter()
                .flatten()
                .filter(|h| h.object == "fridge" && h.interaction == 0 && h.value > 1.0)
            {
                let after = handle.sim.save_snapshot_v6();
                let row = after
                    .legacy
                    .world
                    .entities
                    .iter()
                    .find(|e| e.index == person.index)
                    .unwrap()
                    .habituation
                    .iter()
                    .flatten()
                    .find(|h| h.object == "fridge" && h.interaction == 0)
                    .unwrap();
                assert_eq!(row.value, repeated.value);
                assert!(handle
                    .mood_summary_of(person.index)
                    .iter()
                    .any(|label| label == "Feeling sick"));
            }
        }
        if original
            .world
            .queued_commands
            .iter()
            .any(|c| matches!(c, terri_core::SavedCommand::EditHousemate { .. }))
        {
            handle.flush_commands();
            assert!(handle
                .sim
                .save_snapshot_v6()
                .legacy
                .world
                .entities
                .iter()
                .any(|e| e.sim_name.as_deref() == Some("Published reader")));
        }
    }
}

#[test]
fn upstream_pending_edit_and_book_commands_keep_wire_and_stream_order() {
    let mut handle = SimHandle::from_lot();
    handle
        .sim
        .world_mut()
        .insert_resource(terri_core::Funds(100));
    let title = handle.sim.book_titles()[0].id.clone();
    let next = handle.sim.save_snapshot_v6().books.next_copy_id;
    assert!(handle.buy_book(title, None));
    let edit = SimCommand::EditHousemate {
        sim: 0,
        name: "Updated reader".into(),
        personality: None,
        traits: vec![],
        ties: vec![],
    };
    let bytes = postcard::to_allocvec(&edit).unwrap();
    assert_eq!(
        bytes[0], 22,
        "published edit command keeps its wire identity"
    );
    assert!(handle.enqueue_command(&bytes));
    assert!(handle.transfer_book(f64::from(next), None));
    let snapshot = handle.sim.save_snapshot_v6();
    assert!(snapshot.command_order[0].is_some());
    assert!(snapshot.command_order[1].is_none());
    assert!(snapshot.command_order[2].is_some());
    let bytes = handle.save_bytes();
    assert!(handle.load_bytes(&bytes));
    assert_eq!(handle.save_bytes(), bytes);
    handle.flush_commands();
    let saved = handle.sim.save_snapshot_v6();
    assert_eq!(saved.books.copies.len(), 4);
    assert_eq!(
        saved
            .legacy
            .world
            .entities
            .iter()
            .find(|e| e.sim_id == Some(0))
            .unwrap()
            .sim_name
            .as_deref(),
        Some("Updated reader")
    );
}

#[test]
fn upstream_skill_era_rejects_unknown_practice_and_current_missing_skill_tail() {
    let bytes = include_bytes!("../../terri-data/tests/fixtures/pre-books-920abaf/household-0.sav");
    let mut handle = SimHandle::from_lot();
    let before = handle.save_bytes();
    let mut old = decode_v5(&bytes[SAVE_HEADER_BYTES..]).unwrap();
    assert!(!old.skills.as_ref().unwrap().rows.is_empty());
    old.skills.as_mut().unwrap().rows[0].1 = "unknown-skill".into();
    assert!(!handle.load_bytes(&super::save_v3_tests::v5_bytes(&old)));
    assert_eq!(handle.save_bytes(), before);
    let mut current = handle.sim.save_snapshot_v6();
    current.legacy.skills = None;
    assert!(handle.sim.load_snapshot_v6(current).is_err());
    assert_eq!(handle.save_bytes(), before);
}

#[test]
fn upstream_migration_clamps_practice_only_against_the_destination_ladder() {
    let bytes = include_bytes!("../../terri-data/tests/fixtures/pre-books-920abaf/household-0.sav");
    let mut saved = decode_v5(&bytes[SAVE_HEADER_BYTES..]).unwrap();
    saved.skills.as_mut().unwrap().rows[0].2 = 1.5;
    let mut handle = SimHandle::from_lot();
    let mut destination = handle.sim.world().resource::<Content>().0.clone();
    destination.tuning.skill_level_cost = 0.2;
    handle
        .sim
        .world_mut()
        .insert_resource(Content(Box::leak(Box::new(destination))));
    assert!(handle.load_bytes(&super::save_v3_tests::v5_bytes(&saved)));
    assert_eq!(
        handle.sim.save_snapshot_v6().legacy.skills.unwrap().rows[0].2,
        1.5
    );
}

#[test]
fn upstream_pre_skills_published_edits_migrate_and_seed_once() {
    for bytes in [
        include_bytes!(
            "../../terri-data/tests/fixtures/pre-books-edit-845101d/pending-edit-845101d.sav"
        )
        .as_slice(),
        include_bytes!("../../terri-data/tests/fixtures/pre-books-edit-845101d/edited-845101d.sav")
            .as_slice(),
    ] {
        let old = decode_v5(&bytes[SAVE_HEADER_BYTES..]).unwrap();
        assert!(
            old.skills.is_none(),
            "this fixture predates the published skills tail"
        );
        let mut handle = SimHandle::from_lot();
        assert!(handle.load_bytes(bytes));
        let saved = handle.sim.save_snapshot_v6();
        assert_eq!(saved.legacy.world.rng, current_v5(old.clone()).world.rng);
        assert_eq!(saved.legacy.world.funds, old.world.funds);
        assert_eq!(saved.books.copies.len(), 5);
        assert!(saved
            .legacy
            .skills
            .as_ref()
            .unwrap()
            .rows
            .iter()
            .any(|(_, id, practice)| id == "reading" && (*practice - 0.58).abs() < 0.000001));
        let current = handle.save_bytes();
        assert!(handle.load_bytes(&current));
        assert_eq!(handle.save_bytes(), current);
        handle.flush_commands();
        assert!(handle
            .sim
            .save_snapshot_v6()
            .legacy
            .world
            .entities
            .iter()
            .any(|e| e.sim_name.as_deref() == Some("Pre-skills edit")));
        let before = handle.save_bytes();
        let mut invalid = old;
        invalid
            .world
            .entities
            .iter_mut()
            .find(|e| e.agent)
            .unwrap()
            .habituation = Some(vec![terri_core::SavedHabituation {
            object: "fridge".into(),
            interaction: 0,
            value: 1.5,
        }]);
        assert!(
            !handle.load_bytes(&super::save_v3_tests::v5_bytes(&invalid)),
            "the pre-overdoing source still rejects values above one"
        );
        assert_eq!(handle.save_bytes(), before);
    }
}

#[test]
fn upstream_actual_pre_skills_media_and_dining_leases_migrate_strictly() {
    for bytes in [
        include_bytes!(
            "../../terri-data/tests/fixtures/pre-books-edit-845101d/contended-tv-845101d.sav"
        )
        .as_slice(),
        include_bytes!(
            "../../terri-data/tests/fixtures/pre-books-edit-845101d/contended-radio-845101d.sav"
        )
        .as_slice(),
        include_bytes!(
            "../../terri-data/tests/fixtures/pre-books-edit-845101d/active-dining-845101d.sav"
        )
        .as_slice(),
    ] {
        let old = decode_v5(&bytes[SAVE_HEADER_BYTES..]).unwrap();
        assert!(old.skills.is_none());
        let leases = &old.dining.as_ref().unwrap().diners;
        assert!(leases.iter().any(|d| d.chair.is_some()));
        let mut handle = SimHandle::from_lot();
        assert!(
            handle.load_bytes(bytes),
            "real published active lease at tick {}",
            old.world.tick
        );
        let saved = handle.sim.save_snapshot_v6();
        assert_eq!(saved.legacy.world.rng, current_v5(old.clone()).world.rng);
        assert_eq!(saved.legacy.world.funds, old.world.funds);
        for person in old.world.entities.iter().filter(|e| e.agent) {
            let after = saved
                .legacy
                .world
                .entities
                .iter()
                .find(|e| e.index == person.index)
                .unwrap();
            if person
                .eating
                .as_ref()
                .is_some_and(|a| matches!(a.object.as_str(), "television" | "radio"))
                || person
                    .chain
                    .as_ref()
                    .is_some_and(|c| c.chain == "cook_dinner" && c.step == 5)
                || (person.blocked
                    && person.intents.iter().flatten().any(|i| {
                        old.world.entities.iter().any(|o| {
                            o.index == i.object
                                && matches!(o.smart_object.as_deref(), Some("television" | "radio"))
                        })
                    }))
            {
                assert_eq!(after.target, person.target);
                assert_eq!(after.eating, person.eating);
                assert_eq!(after.step_work_ticks, person.step_work_ticks);
                assert_eq!(after.carrying, person.carrying);
                assert_eq!(after.intents, person.intents);
                assert_eq!(after.blocked, person.blocked);
            }
        }
        for lease in leases.iter().filter(|d| d.chair.is_some()) {
            assert!(saved
                .seats
                .iter()
                .any(|seat| seat.person == lease.person && Some(seat.furniture) == lease.chair));
        }
        let current = handle.save_bytes();
        assert!(handle.load_bytes(&current));
        assert_eq!(handle.save_bytes(), current);
        let mut wrong_owner = old.clone();
        let lease = &mut wrong_owner.dining.as_mut().unwrap().diners[0];
        lease.person = lease.station;
        assert!(!handle.load_bytes(&super::save_v3_tests::v5_bytes(&wrong_owner)));
        assert_eq!(handle.save_bytes(), current);
        if leases.len() >= 2 {
            let mut duplicate = old.clone();
            let leases = &mut duplicate.dining.as_mut().unwrap().diners;
            leases[1].chair = leases[0].chair;
            leases[1].endpoint = leases[0].endpoint;
            assert!(!handle.load_bytes(&super::save_v3_tests::v5_bytes(&duplicate)));
            assert_eq!(handle.save_bytes(), current);
        }
    }
}

#[test]
fn genuine_published_2f_saves_load_and_continue_transactionally() {
    for (name, bytes) in [
        (
            "initial",
            include_bytes!("../tests/fixtures/published-2f319c3b/initial.bin").as_slice(),
        ),
        (
            "played",
            include_bytes!("../tests/fixtures/published-2f319c3b/played.bin").as_slice(),
        ),
        (
            "handwash",
            include_bytes!("../tests/fixtures/published-2f319c3b/active-handwash.bin").as_slice(),
        ),
        (
            "toilet",
            include_bytes!("../tests/fixtures/published-2f319c3b/active-toilet.bin").as_slice(),
        ),
        (
            "pending",
            include_bytes!("../tests/fixtures/published-2f319c3b/pending-23-28.bin").as_slice(),
        ),
        (
            "television",
            include_bytes!("../tests/fixtures/published-2f319c3b/two-viewer-tv.bin").as_slice(),
        ),
        (
            "radio",
            include_bytes!("../tests/fixtures/published-2f319c3b/two-listener-radio.bin")
                .as_slice(),
        ),
    ] {
        let before = decode_v5(&bytes[SAVE_HEADER_BYTES..]).expect(name);
        let mut handle = SimHandle::from_lot();
        assert!(handle.load_bytes(bytes), "authentic {name} public load");
        assert_eq!(handle.sim_tick(), before.world.tick, "{name} tick");
        assert_eq!(
            handle.sim.save_snapshot_v6().legacy.world.rng,
            before.world.rng,
            "{name} RNG"
        );
        if name == "television" || name == "radio" {
            let model = if name == "television" {
                "television"
            } else {
                "radio"
            };
            assert_eq!(
                handle
                    .sim
                    .save_snapshot_v6()
                    .legacy
                    .world
                    .entities
                    .iter()
                    .filter(|e| e.eating.as_ref().is_some_and(|a| a.object == model))
                    .count(),
                2,
                "{name} keeps both actual viewers"
            );
        }
        let current = handle.save_bytes();
        let hash = handle.world_hash();
        let mut restored = SimHandle::from_lot();
        assert!(restored.load_bytes(&current), "{name} current roundtrip");
        assert_eq!(restored.save_bytes(), current);
        assert_eq!(restored.world_hash(), hash);
        handle.tick();
        restored.tick();
        assert_eq!(
            restored.save_bytes(),
            handle.save_bytes(),
            "{name} deterministic next tick"
        );
    }
}
