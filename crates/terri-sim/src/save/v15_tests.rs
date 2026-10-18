use crate::{Content, Sim};
use terri_core::{
    character::CharacterPatchV1,
    command::{BookCommand, CharacterCommand, PlayerOrder},
    CommandQueue, SimCommand,
};

fn references(sim: &Sim) -> (u32, u32, u32, u32) {
    let saved = sim.save_snapshot_v6();
    let people: Vec<_> = saved
        .legacy
        .world
        .entities
        .iter()
        .filter(|entity| entity.agent)
        .map(|entity| entity.index)
        .collect();
    let object = saved
        .legacy
        .world
        .entities
        .iter()
        .find(|entity| {
            entity
                .smart_object
                .as_deref()
                .and_then(|id| terri_data::pack().find(id))
                .is_some_and(|id| terri_data::pack().object(id).interactions.len() > 1)
        })
        .unwrap()
        .index;
    let shelf = saved
        .legacy
        .world
        .entities
        .iter()
        .find(|entity| {
            entity
                .smart_object
                .as_deref()
                .and_then(|id| terri_data::pack().find(id))
                .is_some_and(|id| {
                    terri_data::pack()
                        .object(id)
                        .interactions
                        .iter()
                        .any(|row| row.book_reading)
                })
        })
        .unwrap()
        .index;
    (people[0], people[1], object, shelf)
}

fn staged_commands(sim: &Sim) -> Vec<SimCommand> {
    let (agent, target, object, shelf) = references(sim);
    let saved = sim.save_snapshot_v6();
    let model = saved
        .legacy
        .world
        .entities
        .iter()
        .find(|entity| entity.index == shelf)
        .unwrap()
        .smart_object
        .as_deref()
        .unwrap();
    let action = terri_data::pack()
        .object(terri_data::pack().find(model).unwrap())
        .interactions
        .iter()
        .find(|row| row.book_reading)
        .unwrap()
        .id
        .clone();
    let title = saved.books.copies[0].title_id.clone();
    vec![
        SimCommand::Select(Some(agent)),
        SimCommand::ConfirmedOrder {
            fingerprint: 17,
            command: PlayerOrder::UseObject {
                agent,
                object,
                interaction: 0,
                front: false,
            },
        },
        SimCommand::Book(BookCommand::Purchase {
            title: title.clone(),
            shelf: None,
        }),
        SimCommand::Character(Box::new(CharacterCommand::Edit {
            request: 19,
            sim: 0,
            patch: CharacterPatchV1 {
                name: Some("Saved person".into()),
                ..Default::default()
            },
        })),
        SimCommand::ConfirmedOrder {
            fingerprint: 23,
            command: PlayerOrder::ReadBook {
                agent,
                object: shelf,
                action,
                title,
                front: true,
            },
        },
        SimCommand::UseObject {
            agent,
            object,
            interaction: 0,
        },
        SimCommand::ConfirmedOrder {
            fingerprint: 29,
            command: PlayerOrder::TalkTo {
                agent,
                target,
                interaction: 0,
                front: true,
            },
        },
        SimCommand::Select(None),
    ]
}

fn stage(sim: &mut Sim, commands: &[SimCommand]) {
    for command in commands {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(command.clone());
    }
}

#[test]
fn mixed_ordinary_book_character_and_confirmed_commands_round_trip_in_order() {
    let mut source = Sim::new_from_shipped_lot();
    let commands = staged_commands(&source);
    stage(&mut source, &commands);
    let saved = source.save_snapshot_v15();
    assert_eq!(
        saved
            .confirmed_commands
            .iter()
            .map(|row| row.0)
            .collect::<Vec<_>>(),
        vec![1, 4, 6]
    );
    let mut restored = Sim::new_from_shipped_lot();
    restored.load_snapshot_v15(saved.clone()).unwrap();
    assert_eq!(restored.save_snapshot_v15(), saved);
    assert_eq!(
        restored.world().resource::<CommandQueue>().as_slice(),
        commands
    );
    assert_eq!(restored.world_hash(), source.world_hash());
    source.flush_commands();
    restored.flush_commands();
    assert_eq!(restored.save_snapshot_v15(), source.save_snapshot_v15());
    for _ in 0..10 {
        source.tick();
        restored.tick();
        assert_eq!(restored.world_hash(), source.world_hash());
    }
}

#[test]
fn malformed_confirmation_positions_refuse_without_adopting_any_state() {
    let mut source = Sim::new_from_shipped_lot();
    let commands = staged_commands(&source);
    stage(&mut source, &commands);
    let saved = source.save_snapshot_v15();
    let mut live = Sim::new_from_shipped_lot_with_seed(572);
    let before = live.save_snapshot_v15();
    let hash = live.world_hash();
    for fault in 0..3 {
        let mut bad = saved.clone();
        match fault {
            0 => bad.confirmed_commands[1].0 = bad.confirmed_commands[0].0,
            1 => bad.confirmed_commands.swap(0, 1),
            _ => bad.confirmed_commands[2].0 = commands.len() as u32,
        }
        assert!(
            live.load_snapshot_v15(bad).is_err(),
            "accepted position fault {fault}"
        );
        assert_eq!(live.save_snapshot_v15(), before);
        assert_eq!(live.world_hash(), hash);
    }
}

#[test]
fn the_complete_staged_stream_obeys_the_shared_command_limit() {
    let mut source = Sim::new_from_shipped_lot();
    let commands = staged_commands(&source);
    stage(&mut source, &commands);
    let saved = source.save_snapshot_v15();
    let mut content = terri_data::pack().clone();
    content.tuning.max_queued_commands = commands.len() as u32 - 1;
    let mut live = Sim::new_from_shipped_lot_with_seed(573);
    live.world_mut()
        .insert_resource(Content(Box::leak(Box::new(content))));
    let before = live.save_snapshot_v15();
    let hash = live.world_hash();
    assert!(live.load_snapshot_v15(saved).is_err());
    assert_eq!(live.save_snapshot_v15(), before);
    assert_eq!(live.world_hash(), hash);
}

#[test]
fn new_suffix_action_ordinals_follow_the_frozen_manifest_after_content_reordering() {
    let mut source = Sim::new_from_shipped_lot();
    let (agent, target, object, shelf) = references(&source);
    let saved = source.save_snapshot_v6();
    let shelf_model = saved
        .legacy
        .world
        .entities
        .iter()
        .find(|entity| entity.index == shelf)
        .unwrap()
        .smart_object
        .as_deref()
        .unwrap();
    let read_action = terri_data::pack()
        .object(terri_data::pack().find(shelf_model).unwrap())
        .interactions
        .iter()
        .find(|row| row.book_reading)
        .unwrap()
        .id
        .clone();
    stage(
        &mut source,
        &[
            SimCommand::UseObject {
                agent,
                object,
                interaction: 0,
            },
            SimCommand::TalkTo {
                agent,
                target,
                interaction: 0,
            },
            SimCommand::Book(BookCommand::Read {
                agent,
                object: shelf,
                action: read_action,
                title: saved.books.copies[0].title_id.clone(),
                front: false,
            }),
        ],
    );
    source.flush_commands();
    let commands = staged_commands(&source);
    stage(&mut source, &commands);
    let saved = source.save_snapshot_v15();
    assert_eq!(saved.player_orders.orders.len(), 3);
    let mut reordered = terri_data::pack().clone();
    for model in &mut reordered.objects {
        model.interactions.reverse();
    }
    reordered.social.reverse();
    reordered.chains.reverse();
    let reordered = Box::leak(Box::new(reordered));
    let source_v6 = &saved.legacy.legacy.legacy.legacy.legacy.legacy;
    let mapped_row = |target: u32, row: u32| {
        let entity = source_v6
            .legacy
            .world
            .entities
            .iter()
            .find(|entity| entity.index == target)
            .unwrap();
        match entity.smart_object.as_deref() {
            Some(model) => {
                let source = terri_data::pack().object(terri_data::pack().find(model).unwrap());
                let current = reordered.object(reordered.find(model).unwrap());
                current
                    .interactions
                    .iter()
                    .position(|action| action.id == source.interactions[row as usize].id)
                    .unwrap() as u32
            }
            None => reordered
                .social
                .iter()
                .position(|action| action.id == terri_data::pack().social[row as usize].id)
                .unwrap() as u32,
        }
    };
    let mut expected_orders = saved.player_orders.clone();
    for order in &mut expected_orders.orders {
        order.interaction = mapped_row(order.target, order.interaction);
    }
    let mut expected_commands = commands;
    for command in &mut expected_commands {
        match command {
            SimCommand::UseObject {
                object,
                interaction,
                ..
            } => *interaction = mapped_row(*object, *interaction),
            SimCommand::ConfirmedOrder {
                command:
                    PlayerOrder::UseObject {
                        object,
                        interaction,
                        ..
                    },
                ..
            } => {
                *interaction = mapped_row(*object, *interaction);
            }
            SimCommand::ConfirmedOrder {
                command:
                    PlayerOrder::TalkTo {
                        target,
                        interaction,
                        ..
                    },
                ..
            } => {
                *interaction = mapped_row(*target, *interaction);
            }
            _ => {}
        }
    }
    let mut restored = Sim::new_from_shipped_lot();
    restored.world_mut().insert_resource(Content(reordered));
    restored.load_snapshot_v15(saved).unwrap();
    assert_eq!(restored.save_snapshot_v15().player_orders, expected_orders);
    assert_eq!(
        restored.world().resource::<CommandQueue>().as_slice(),
        expected_commands
    );
    let canonical = restored.save_snapshot_v15();
    let hash = restored.world_hash();
    restored.load_snapshot_v15(canonical.clone()).unwrap();
    assert_eq!(restored.save_snapshot_v15(), canonical);
    assert_eq!(restored.world_hash(), hash);
}
