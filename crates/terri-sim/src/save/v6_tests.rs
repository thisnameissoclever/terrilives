use super::{action_refs, v6};
use crate::{
    books::{BookLibrary, MIGRATION_STARTER_TITLES},
    Content, LegacySnapshot, Sim,
};
use terri_core::{
    books::*, save::SavedBoundaryDecision, SavedCommand, SavedEating, SavedHabituation,
    SavedIntent, SavedSocialising, SavedTarget, SimId,
};

fn after_affinity_migration(snapshot: &terri_core::SaveSnapshotV5) -> terri_core::SimRng {
    let mut rng = snapshot.world.rng.clone();
    if snapshot.affinities.is_none() {
        let people = snapshot
            .world
            .entities
            .iter()
            .filter(|entity| entity.agent)
            .count();
        for _ in 0..people * terri_data::pack().affinities.len() {
            rng.next_f32();
        }
    }
    rng
}

#[test]
fn v6_migration_fills_available_shelves_then_inventory_without_touching_rng() {
    for capacity in [0, 2, 24] {
        let source = crate::test_content::pre_books_sim();
        let old = source.save_snapshot_v5();
        let mut pack = terri_data::pack().clone();
        for object in &mut pack.objects {
            if object.shelf_capacity > 0 {
                object.shelf_capacity = capacity;
            }
        }
        let mut current = Sim::new_from_shipped_lot();
        current
            .world
            .insert_resource(Content(Box::leak(Box::new(pack))));
        current
            .load_legacy_snapshot(LegacySnapshot::V5(Box::new(old.clone())))
            .unwrap();
        let state = current.save_snapshot_v6();
        assert_eq!(state.books.copies.len(), 5);
        assert_eq!(
            state
                .books
                .copies
                .iter()
                .filter(|copy| copy.home.is_some())
                .count(),
            usize::from(capacity.min(5))
        );
        assert_eq!(state.legacy.world.rng, after_affinity_migration(&old));
        assert_eq!(state.legacy.world.funds, old.world.funds);
        assert_eq!(
            state
                .books
                .copies
                .iter()
                .map(|copy| copy.title_id.as_str())
                .collect::<Vec<_>>(),
            MIGRATION_STARTER_TITLES
        );
        current.load_snapshot_v6(state.clone()).unwrap();
        assert_eq!(current.save_snapshot_v6(), state);
    }
}

#[test]
fn v6_owned_copies_title_memory_and_taste_seed_round_trip() {
    let mut source = Sim::new_from_shipped_lot_with_seed(1991);
    for _ in 0..100 {
        source.tick();
    }
    let mut library = source.world.resource::<BookLibrary>().clone();
    let rng = source.save_snapshot().rng;
    v6::with_book_world(&source.world, |world| {
        let person = world.living_sims[0];
        let copy = library.grant_migration_starters(world)?[0];
        library.reserve(copy, person, world)?;
        library.pick_up(copy, person, world)?;
        library.read_work(copy, person, 30, world)?;
        library.return_copy(copy, person, world)?;
        Ok(())
    })
    .unwrap();
    source.world.insert_resource(library);
    assert_eq!(source.save_snapshot().rng, rng);
    let saved = source.save_snapshot_v6();
    assert_eq!(saved.books.taste_seed, 1991);
    assert_eq!(saved.books.memories[0].progress_ticks, 30);
    assert!(matches!(
        saved.books.copies[0].location,
        BookLocation::Shelf(_)
    ));
    let hash = source.world_hash();
    let mut restored = Sim::new_from_shipped_lot();
    restored.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(restored.save_snapshot_v6(), saved);
    assert_eq!(restored.world_hash(), hash);
    let mut invalid = saved.clone();
    invalid.books.copies[0].borrower = Some(SimId(u32::MAX));
    assert!(restored.load_snapshot_v6(invalid).is_err());
    assert_eq!(restored.save_snapshot_v6(), saved);
}

#[test]
fn v6_every_action_space_maps_by_id_including_privacy_chain_sentinel() {
    let mut source_pack = terri_data::pack().clone();
    let mut extra = source_pack.objects[0].interactions[0].clone();
    extra.id = "extra_object_action".into();
    source_pack.objects[0].interactions.push(extra);
    let mut extra = source_pack.social[0].clone();
    extra.id = "extra_social_action".into();
    source_pack.social.push(extra);
    let pack = &source_pack;
    let mut saved = Sim::new_from_shipped_lot().save_snapshot_v5();
    let model = pack
        .objects
        .iter()
        .find(|object| object.interactions.len() > 1)
        .unwrap();
    let object = saved
        .world
        .entities
        .iter()
        .find(|entity| entity.smart_object.as_deref() == Some(&model.id))
        .unwrap()
        .index;
    let person = saved
        .world
        .entities
        .iter()
        .find(|entity| entity.agent)
        .unwrap()
        .index;
    let fridge_id = pack.find("fridge").unwrap();
    let fridge = saved
        .world
        .entities
        .iter()
        .find(|entity| entity.smart_object.as_deref() == Some("fridge"))
        .unwrap()
        .index;
    let chain_row = pack.object(fridge_id).interactions.len() as u32;
    let actor = saved
        .world
        .entities
        .iter_mut()
        .find(|entity| entity.index == person)
        .unwrap();
    actor.target = Some(SavedTarget {
        object,
        interaction: 0,
    });
    actor.eating = Some(SavedEating {
        object: model.id.clone(),
        interaction: 0,
        remaining_ticks: 10,
    });
    actor.intents = Some(vec![
        SavedIntent {
            object,
            interaction: 0,
        },
        SavedIntent {
            object: fridge,
            interaction: chain_row,
        },
        SavedIntent {
            object: person,
            interaction: 0,
        },
    ]);
    actor.habituation = Some(vec![SavedHabituation {
        object: "fridge".into(),
        interaction: chain_row,
        value: 0.3,
    }]);
    actor.personality.as_mut().unwrap().dispositions = vec![SavedHabituation {
        object: model.id.clone(),
        interaction: 0,
        value: 1.2,
    }];
    actor.socialising = Some(SavedSocialising {
        interaction: 0,
        partner: person,
        remaining_ticks: 10,
    });
    saved.world.queued_commands = vec![
        SavedCommand::UseObject {
            agent: person,
            object,
            interaction: 0,
        },
        SavedCommand::UseObjectFirst {
            agent: person,
            object: fridge,
            interaction: chain_row,
        },
        SavedCommand::TalkTo {
            agent: person,
            target: person,
            interaction: 0,
        },
        SavedCommand::TalkToFirst {
            agent: person,
            target: person,
            interaction: 0,
        },
    ];
    saved.boundaries = vec![
        SavedBoundaryDecision {
            actor: 0,
            expires: 1,
            lapse: false,
            waiting_since: None,
            goal: Some((object, 0)),
            directed_chain: Some(0),
        },
        SavedBoundaryDecision {
            actor: 1,
            expires: 1,
            lapse: false,
            waiting_since: None,
            goal: Some((fridge, super::CHAIN_STEP)),
            directed_chain: None,
        },
    ];
    let manifest = action_refs::capture(&saved, pack);
    for fault in 0..8 {
        let mut invalid = manifest.clone();
        match fault {
            0 => invalid.social.clear(),
            1 => invalid.social.push(invalid.social[0].clone()),
            2 => invalid.social[0] = "unknown-social".into(),
            3 => invalid.chains.clear(),
            4 => invalid.chains.push(invalid.chains[0].clone()),
            5 => invalid.chains[0].id = "unknown-chain".into(),
            6 => invalid.objects[0].structure ^= 1,
            7 => invalid.portal_structure ^= 1,
            _ => unreachable!(),
        }
        assert!(
            action_refs::remap(&mut saved.clone(), &invalid, pack, &[], false).is_err(),
            "accepted mapping fault {fault}"
        );
    }
    let mut reordered = pack.clone();
    for object in &mut reordered.objects {
        object.interactions.reverse();
    }
    reordered.social.reverse();
    reordered.chains.reverse();
    action_refs::remap(&mut saved, &manifest, &reordered, &[], false).unwrap();
    let action_row = model.interactions.len() as u32 - 1;
    let social_row = pack.social.len() as u32 - 1;
    let actor = saved
        .world
        .entities
        .iter()
        .find(|entity| entity.index == person)
        .unwrap();
    assert_eq!(actor.target.unwrap().interaction, action_row);
    assert_eq!(actor.eating.as_ref().unwrap().interaction, action_row);
    assert_eq!(
        actor.personality.as_ref().unwrap().dispositions[0].interaction,
        action_row
    );
    assert_eq!(actor.socialising.as_ref().unwrap().interaction, social_row);
    assert_eq!(actor.intents.as_ref().unwrap()[2].interaction, social_row);
    let new_fridge_chain = crate::action_rows::aliases(&reordered, fridge_id)
        .position(|(_, chain)| {
            chain.id
                == manifest
                    .objects
                    .iter()
                    .find(|object| object.model == "fridge")
                    .unwrap()
                    .advertised_chains[0]
        })
        .unwrap() as u32
        + chain_row;
    assert_eq!(
        actor.habituation.as_ref().unwrap()[0].interaction,
        new_fridge_chain
    );
    assert_eq!(
        actor.intents.as_ref().unwrap()[1].interaction,
        new_fridge_chain
    );
    assert_eq!(saved.boundaries[0].goal, Some((object, action_row)));
    assert_eq!(
        saved.boundaries[0].directed_chain,
        Some(pack.chains.len() as u32 - 1)
    );
    assert_eq!(saved.boundaries[1].goal, Some((fridge, super::CHAIN_STEP)));
    assert!(
        matches!(saved.world.queued_commands[0], SavedCommand::UseObject { interaction, .. } if interaction == action_row)
    );
    assert!(
        matches!(saved.world.queued_commands[1], SavedCommand::UseObjectFirst { interaction, .. } if interaction == new_fridge_chain)
    );
    assert!(
        matches!(saved.world.queued_commands[2], SavedCommand::TalkTo { interaction, .. } if interaction == social_row)
    );
    assert!(
        matches!(saved.world.queued_commands[3], SavedCommand::TalkToFirst { interaction, .. } if interaction == social_row)
    );
}

#[test]
fn legacy_reading_ends_safely_and_preserves_bookmark_independent_progress() {
    let mut source = crate::test_content::pre_books_sim();
    let snapshot = source.save_snapshot();
    let person = snapshot
        .entities
        .iter()
        .find(|entity| entity.agent)
        .unwrap()
        .index;
    let object = snapshot
        .entities
        .iter()
        .find(|entity| entity.smart_object.as_deref() == Some("reading_chair"))
        .unwrap()
        .index;
    source
        .world
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::UseObjectFirst {
            agent: person,
            object,
            interaction: 0,
        });
    for _ in 0..600 {
        source.tick();
        if source
            .save_snapshot()
            .entities
            .iter()
            .find(|entity| entity.index == person)
            .unwrap()
            .eating
            .as_ref()
            .is_some_and(|action| action.object == "reading_chair")
        {
            break;
        }
    }
    let before = source.save_snapshot_v5();
    let old_person = before
        .world
        .entities
        .iter()
        .find(|entity| entity.index == person)
        .unwrap();
    assert_eq!(old_person.eating.as_ref().unwrap().object, "reading_chair");
    let mut current = Sim::new_from_shipped_lot();
    current
        .load_legacy_snapshot(LegacySnapshot::V5(Box::new(before.clone())))
        .unwrap();
    let state = current.save_snapshot_v6();
    let new_person = state
        .legacy
        .world
        .entities
        .iter()
        .find(|entity| entity.index == person)
        .unwrap();
    assert!(
        new_person.eating.is_none() && new_person.target.is_none() && new_person.path.is_none()
    );
    assert_eq!(new_person.needs, old_person.needs);
    assert_eq!(new_person.satisfaction, old_person.satisfaction);
    assert_eq!(new_person.relationships, old_person.relationships);
    assert_eq!(state.legacy.world.rng, after_affinity_migration(&before));
    assert_eq!(state.books.copies.len(), 5);
    assert!(state.books.memories.is_empty());
}

#[test]
fn v6_reordered_actions_and_new_unrelated_models_restore_a_running_household() {
    let mut source = Sim::new_from_shipped_lot();
    for _ in 0..1000 {
        source.tick();
    }
    let saved = source.save_snapshot_v6();
    let mut pack = terri_data::pack().clone();
    for object in &mut pack.objects {
        object.interactions.reverse();
    }
    pack.social.reverse();
    pack.chains.reverse();
    let mut extra = pack.objects[0].clone();
    extra.id = "new_unrelated_model".into();
    pack.objects.push(extra);
    let mut extra_action = pack.objects[0].interactions[0].clone();
    extra_action.id = "new_action".into();
    pack.objects[0].interactions.push(extra_action);
    let pack = Box::leak(Box::new(pack));
    let mut restored = Sim::new_from_shipped_lot();
    restored.world.insert_resource(Content(pack));
    restored.load_snapshot_v6(saved).unwrap();
    let current = restored.save_snapshot_v6();
    assert_eq!(current.legacy.world.tick, 1000);
    restored.load_snapshot_v6(current.clone()).unwrap();
    assert_eq!(restored.save_snapshot_v6(), current);
}

#[test]
fn legacy_frozen_validation_survives_new_actions_and_additive_named_roles() {
    let source = crate::test_content::pre_books_sim();
    let old = source.save_snapshot_v5();
    let mut pack = terri_data::pack().clone();
    pack.roles.insert(0, "new_seating_role".into());
    for object in &mut pack.objects {
        for role in &mut object.roles {
            *role += 1;
        }
    }
    for chain in &mut pack.chains {
        for step in &mut chain.steps {
            step.role += 1;
        }
    }
    pack.objects[0].roles.push(0);
    let mut action = pack.objects[0].interactions[0].clone();
    action.id = "added_action".into();
    pack.objects[0].interactions.insert(0, action);
    assert_ne!(
        old.world.content_fingerprint,
        terri_data::content_fingerprint(&pack)
    );
    let pack = Box::leak(Box::new(pack));
    let mut destination = Sim::new_from_shipped_lot();
    destination.world.insert_resource(Content(pack));
    destination
        .load_legacy_snapshot(LegacySnapshot::V5(Box::new(old)))
        .unwrap();
    let saved = destination.save_snapshot_v6();
    assert_eq!(saved.books.copies.len(), 5);
    assert_eq!(
        saved.legacy.world.content_fingerprint,
        terri_data::content_fingerprint(pack)
    );
    destination.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(destination.save_snapshot_v6(), saved);

    let mut removed = pack.clone();
    removed.objects[0].roles.clear();
    destination
        .world
        .insert_resource(Content(Box::leak(Box::new(removed))));
    assert!(destination.load_snapshot_v6(saved).is_err());
}

#[test]
fn v6_preserves_structural_checks_for_active_programs_voices_and_geometry() {
    let pack = terri_data::pack();
    let mut saved = Sim::new_from_shipped_lot().save_snapshot_v5();
    let actor = saved
        .world
        .entities
        .iter_mut()
        .find(|entity| entity.agent)
        .unwrap();
    actor.chain = Some(terri_core::SavedChainState {
        chain: pack.chains[0].id.clone(),
        step: 0,
        fumble_scale: 1.0,
    });
    actor.conversation_voice = Some(terri_core::SavedConversationVoice {
        first: 0,
        second: 1,
    });
    let manifest = action_refs::capture(&saved, pack);
    for fault in 0..5 {
        let mut changed = pack.clone();
        match fault {
            0 => changed.objects[0].footprint.width += 1,
            1 => changed.voice_clips[0].duration_ticks += 1,
            2 => changed.voice_clips.swap(0, 1),
            3 => {
                changed.chains[0].steps[0].role =
                    (changed.chains[0].steps[0].role + 1) % changed.roles.len() as u32
            }
            4 => changed
                .objects
                .iter_mut()
                .find(|object| !object.sleep_places.is_empty())
                .unwrap()
                .sleep_places[0]
                .id
                .push_str("_changed"),
            _ => unreachable!(),
        }
        assert!(
            action_refs::remap(&mut saved.clone(), &manifest, &changed, &[], false).is_err(),
            "accepted structure fault {fault}"
        );
    }
    let mut missing = manifest;
    missing.chains[0].structure = None;
    assert!(action_refs::remap(&mut saved, &missing, pack, &[], false).is_err());
}

#[test]
fn frozen_legacy_destination_is_pinned_and_has_no_book_catalogue() {
    let pack = terri_data::pre_books_pack();
    assert_eq!(terri_data::content_fingerprint(pack), 0xcf78_7472_e9e8_38f5);
    assert!(pack.books.is_empty());
    assert!(pack.reading.is_none());
}

#[test]
fn v6_deceased_memory_survives_but_a_dead_borrower_is_rejected() {
    let mut source = Sim::new_from_shipped_lot();
    source.world.resource_mut::<terri_core::SimClock>().tick = 100;
    let mut library = source.world.resource::<BookLibrary>().clone();
    let (person, copy) = v6::with_book_world(&source.world, |world| {
        let person = world.living_sims[0];
        let copy = library.grant_migration_starters(world)?[0];
        library.reserve(copy, person, world)?;
        library.pick_up(copy, person, world)?;
        library.read_work(copy, person, 20, world)?;
        library.return_copy(copy, person, world)?;
        Ok((person, copy))
    })
    .unwrap();
    source.world.insert_resource(library);
    let entity = source
        .world
        .query::<(terri_core::Entity, &SimId)>()
        .iter(&source.world)
        .find(|(_, id)| **id == person)
        .unwrap()
        .0;
    source
        .world
        .entity_mut(entity)
        .insert(terri_core::Needs::all_at(0.0));
    source
        .world
        .resource_mut::<terri_core::save::SavedMortality>()
        .counts = vec![(
        entity.index_u32(),
        terri_data::pack().tuning.death_after_ticks - 1,
    )];
    crate::mortality::tick(&mut source.world);
    let saved = source.save_snapshot_v6();
    assert_eq!(saved.books.memories[0].sim_id, person);
    let mut restored = Sim::new_from_shipped_lot();
    restored.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(restored.save_snapshot_v6(), saved);
    let mut invalid = saved.clone();
    let borrowed = invalid
        .books
        .copies
        .iter_mut()
        .find(|entry| entry.id == copy)
        .unwrap();
    borrowed.borrower = Some(person);
    borrowed.location = BookLocation::Carried(person);
    assert!(restored.load_snapshot_v6(invalid).is_err());
    assert_eq!(restored.save_snapshot_v6(), saved);
}

#[test]
fn book_hash_is_canonical_and_covers_all_persisted_book_fields() {
    let mut source = Sim::new_from_shipped_lot();
    source
        .load_legacy_snapshot(LegacySnapshot::V5(Box::new(
            crate::test_content::pre_books_sim().save_snapshot_v5(),
        )))
        .unwrap();
    source.world.resource_mut::<terri_core::SimClock>().tick = 100;
    let mut saved = source.world.resource::<BookLibrary>().state().clone();
    saved.next_copy_id = 6;
    saved.copies[0].location = BookLocation::Lot { x: 1.0, y: 1.0 };
    saved.memories = vec![
        TitleMemory {
            sim_id: SimId(0),
            title_id: MIGRATION_STARTER_TITLES[0].into(),
            progress_ticks: 10,
            progress_fraction: 0.0,
            pass_novelty: Some(1.0),
            familiarity: 0.1,
            last_read_tick: 100,
            completed_passes: 0,
        },
        TitleMemory {
            sim_id: SimId(1),
            title_id: MIGRATION_STARTER_TITLES[1].into(),
            progress_ticks: 20,
            progress_fraction: 0.0,
            pass_novelty: Some(0.8),
            familiarity: 0.2,
            last_read_tick: 99,
            completed_passes: 1,
        },
    ];
    let install = |sim: &mut Sim, books: SavedBookLibrary| {
        let library =
            v6::with_book_world(&sim.world, |world| BookLibrary::from_saved(books, world)).unwrap();
        sim.world.insert_resource(library);
    };
    install(&mut source, saved.clone());
    let hash = source.world_hash();
    let snapshot = source.save_snapshot_v6();
    let mut reverse = saved.clone();
    reverse.copies.reverse();
    reverse.memories.reverse();
    install(&mut source, reverse);
    assert_eq!(source.world_hash(), hash);
    assert_eq!(source.save_snapshot_v6(), snapshot);
    for field in 0..15 {
        let mut changed = saved.clone();
        match field {
            0 => changed.next_copy_id += 1,
            1 => changed.migration_granted = !changed.migration_granted,
            2 => changed.taste_seed += 1,
            3 => {
                changed.copies[0].id = BookCopyId(5);
            }
            4 => changed.copies[0].title_id = MIGRATION_STARTER_TITLES[1].into(),
            5 => {
                let home = changed.copies[0].home.as_mut().unwrap();
                home.slot = 22;
            }
            6 => {
                changed.copies[0].borrower = Some(SimId(0));
            }
            7 => changed.memories[0].progress_ticks += 1,
            8 => changed.memories[0].pass_novelty = Some(0.9),
            9 => changed.memories[0].familiarity += 0.1,
            10 => changed.memories[0].last_read_tick -= 1,
            11 => changed.memories[0].completed_passes += 1,
            12 => changed.memories[0].sim_id = SimId(2),
            13 => changed.memories[0].title_id = MIGRATION_STARTER_TITLES[2].into(),
            14 => changed.copies[0].location = BookLocation::Lot { x: 2.0, y: 1.0 },
            _ => unreachable!(),
        }
        install(&mut source, changed);
        assert_ne!(source.world_hash(), hash, "book hash omits field {field}");
    }
}

#[test]
fn book_lifecycle_sale_evacuates_copies_and_refuses_borrowed_homes_atomically() {
    for borrowed in [false, true] {
        let mut sim = Sim::new_from_shipped_lot();
        sim.load_legacy_snapshot(LegacySnapshot::V5(Box::new(
            crate::test_content::pre_books_sim().save_snapshot_v5(),
        )))
        .unwrap();
        let shelf = sim.world.resource::<BookLibrary>().state().copies[0]
            .home
            .unwrap()
            .shelf;
        if borrowed {
            let person = sim
                .world
                .query::<(terri_core::Entity, &SimId)>()
                .iter(&sim.world)
                .find(|(_, id)| id.0 == 0)
                .unwrap()
                .0;
            let shelf_entity = crate::dining::entity(&sim.world, shelf.0 as u32).unwrap();
            let plan = crate::reading::plans(
                &mut sim.world,
                person,
                terri_core::Target {
                    object: shelf_entity,
                    interaction: 0,
                },
                None,
            )
            .remove(0);
            assert!(crate::reading::commit_plan(
                &mut sim.world,
                person,
                terri_core::Target {
                    object: shelf_entity,
                    interaction: 0
                },
                None,
                plan
            ));
        }
        let before = sim.save_snapshot_v6();
        sim.world.resource_mut::<terri_core::CommandQueue>().push(
            terri_core::SimCommand::SellObject {
                object: shelf.0 as u32,
            },
        );
        sim.flush_commands();
        let after = sim.save_snapshot_v6();
        if borrowed {
            assert_eq!(
                sim.world
                    .resource::<crate::placement::LotEditState>()
                    .last_sale_result
                    .unwrap()
                    .reason,
                Some(crate::placement::PlacementRefusal::InUse)
            );
            assert_eq!(after, before);
        } else {
            assert!(after
                .books
                .copies
                .iter()
                .all(|copy| copy.home.is_none() && copy.location == BookLocation::Inventory));
            assert_eq!(
                after
                    .books
                    .copies
                    .iter()
                    .map(|copy| (copy.id, &copy.title_id))
                    .collect::<Vec<_>>(),
                before
                    .books
                    .copies
                    .iter()
                    .map(|copy| (copy.id, &copy.title_id))
                    .collect::<Vec<_>>()
            );
            assert!(after.legacy.world.funds > before.legacy.world.funds);
        }
        let mut restored = Sim::new_from_shipped_lot();
        restored.load_snapshot_v6(after.clone()).unwrap();
        assert_eq!(restored.save_snapshot_v6(), after);
    }
}

#[test]
fn book_lifecycle_simultaneous_deaths_release_reservations_and_recover_carried_copy() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.world.resource_mut::<terri_core::SimClock>().tick = 100;
    let mut library = sim.world.resource::<BookLibrary>().clone();
    let people = v6::with_book_world(&sim.world, |world| {
        library.grant_migration_starters(world)?;
        for (index, &person) in world.living_sims[..2].iter().enumerate() {
            library.reserve(BookCopyId(index as u32), person, world)?;
        }
        library.pick_up(BookCopyId(0), world.living_sims[0], world)?;
        library.read_work(BookCopyId(0), world.living_sims[0], 15, world)?;
        Ok(world.living_sims[..2].to_vec())
    })
    .unwrap();
    sim.world.insert_resource(library);
    let before = sim.world.resource::<BookLibrary>().state().clone();
    let doomed: Vec<_> = sim
        .world
        .query::<(terri_core::Entity, &SimId, &terri_core::Position)>()
        .iter(&sim.world)
        .filter(|(_, id, _)| people.contains(id))
        .map(|(entity, _, position)| (entity, *position))
        .collect();
    let threshold = terri_data::pack().tuning.death_after_ticks;
    for (entity, _) in &doomed {
        sim.world
            .entity_mut(*entity)
            .insert(terri_core::Needs::all_at(0.0));
    }
    let mut counts: Vec<_> = doomed
        .iter()
        .map(|(entity, _)| (entity.index_u32(), threshold - 1))
        .collect();
    counts.sort_unstable();
    sim.world
        .resource_mut::<terri_core::save::SavedMortality>()
        .counts = counts;
    crate::mortality::tick(&mut sim.world);
    let saved = sim.save_snapshot_v6();
    assert!(saved
        .books
        .copies
        .iter()
        .all(|copy| copy.borrower.is_none()));
    let carried_position = doomed
        .iter()
        .find(|(entity, _)| entity.index_u32() == saved.legacy.retired_indices[0])
        .unwrap()
        .1;
    assert_eq!(
        saved.books.copies[0].location,
        BookLocation::Lot {
            x: carried_position.x,
            y: carried_position.y
        }
    );
    assert_eq!(saved.books.copies[1].location, before.copies[1].location);
    assert_eq!(saved.books.memories, before.memories);
    assert_eq!(saved.books.copies[0].home, before.copies[0].home);
    let mut restored = Sim::new_from_shipped_lot();
    restored.load_snapshot_v6(saved.clone()).unwrap();
    assert_eq!(restored.save_snapshot_v6(), saved);
}

#[test]
fn v6_rejects_a_borrower_without_a_recoverable_physical_position() {
    let mut source = Sim::new_from_shipped_lot();
    let mut library = source.world.resource::<BookLibrary>().clone();
    let person = v6::with_book_world(&source.world, |world| {
        library.grant_migration_starters(world)?;
        let person = world.living_sims[0];
        library.reserve(BookCopyId(0), person, world)?;
        library.pick_up(BookCopyId(0), person, world)?;
        Ok(person)
    })
    .unwrap();
    source.world.insert_resource(library);
    let before = source.save_snapshot_v6();
    let mut invalid = before.clone();
    invalid
        .legacy
        .world
        .entities
        .iter_mut()
        .find(|entity| entity.sim_id == Some(person.0))
        .unwrap()
        .position = None;
    assert!(
        Sim::new_from_shipped_lot()
            .load_snapshot_v5(invalid.legacy.clone())
            .is_ok(),
        "the physical borrower check must add to legacy validation"
    );
    assert!(source.load_snapshot_v6(invalid).is_err());
    assert_eq!(source.save_snapshot_v6(), before);
}
