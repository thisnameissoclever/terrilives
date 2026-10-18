//! These immutable inputs were accepted and replayed by the original V15 module.
use super::*;

fn fixtures() -> [(&'static str, &'static [u8]); 9] {
    macro_rules! fixture {
        ($name:literal) => {
            (
                $name,
                include_bytes!(concat!(
                    "../tests/fixtures/room-identities-v15/",
                    $name,
                    ".sav"
                ))
                .as_slice(),
            )
        };
    }
    [
        fixture!("fresh"),
        fixture!("chat-queued"),
        fixture!("chat-approaching"),
        fixture!("chat-waiting-owned"),
        fixture!("chat-waiting-arrived"),
        fixture!("chat-waiting-private"),
        fixture!("chat-talking"),
        fixture!("chat-talking-later-identical"),
        fixture!("chat-suspended"),
    ]
}

fn decode(bytes: &[u8]) -> terri_core::SaveSnapshotV15 {
    assert_eq!(&bytes[..8], SAVE_MAGIC);
    assert_eq!(&bytes[8..10], &15u16.to_le_bytes());
    let (snapshot, tail) = postcard::take_from_bytes(&bytes[10..]).unwrap();
    assert!(tail.is_empty());
    snapshot
}

fn six(snapshot: &terri_core::SaveSnapshotV15) -> &terri_core::SaveSnapshotV6 {
    &snapshot.legacy.legacy.legacy.legacy.legacy.legacy
}

#[test]
fn checksum_control_compares_the_exact_original_published_state() {
    let bytes = include_bytes!("../../../docs/evidence/2026-10-17-room-identities/published-v15-producer/published-v15-golden-public-100.sav");
    let original = decode(bytes);
    for current in [false, true] {
        let mut sim = Sim::new_with_lot(24, 24);
        if !current {
            sim.world_mut()
                .remove_resource::<terri_core::rooms::SavedRooms>();
            sim.world_mut()
                .remove_resource::<terri_sim::rooms::RoomMap>();
            sim.world_mut()
                .insert_resource(terri_sim::rooms::RoomReferenceMode::Legacy);
            sim.world_mut()
                .insert_resource(six(&original).legacy.layout.clone());
        }
        let fridge = sim
            .world()
            .resource::<terri_sim::Content>()
            .0
            .find("fridge")
            .unwrap();
        sim.world_mut().spawn((
            terri_core::Position { x: 18., y: 14. },
            terri_core::SmartObject(fridge),
        ));
        for i in 0..8 {
            sim.spawn_agent(
                terri_core::Position {
                    x: 1. + i as f32,
                    y: 1.,
                },
                30. + i as f32 * 5.,
            );
        }
        for _ in 0..100 {
            sim.tick();
        }
        let mut captured = if current {
            sim.save_snapshot_v16().legacy
        } else {
            sim.save_snapshot_v15()
        };
        super::current_test_snapshot::project_reviewed_catalogue_fingerprint(
            six(&original).legacy.world.content_fingerprint,
            &mut captured
                .legacy
                .legacy
                .legacy
                .legacy
                .legacy
                .legacy
                .legacy
                .world
                .content_fingerprint,
        );
        if current {
            let original_five = &six(&original).legacy;
            let actual_five = &mut captured.legacy.legacy.legacy.legacy.legacy.legacy.legacy;
            assert!(
                matches!(&actual_five.layout, terri_core::layout::SavedLayout::EdgeWallsV1 { edges } if edges.is_empty())
            );
            assert_ne!(actual_five.layout, original_five.layout);
            assert_eq!(
                actual_five.world.entities.len(),
                original_five.world.entities.len()
            );
            let mut changed_relationships = 0;
            for (actual, expected) in actual_five
                .world
                .entities
                .iter_mut()
                .zip(&original_five.world.entities)
            {
                changed_relationships +=
                    usize::from(actual.relationships != expected.relationships);
                // Outside does not grant the whole blank lot indoor proximity friendship.
                // Every other entity field, request, order, allocator and random stream
                // must still match the exact published state after this projection.
                actual.relationships = expected.relationships.clone();
            }
            assert!(changed_relationships > 0);
            actual_five.layout = original_five.layout.clone();
            assert_eq!(
                captured, original,
                "after the reviewed catalogue fingerprint rewrite, only blank-layout encoding and Outside proximity relationships change"
            );
            assert_eq!(sim.world_hash(), 4661132544113609906);
            eprintln!("checksum cause: original=4676206450852028819 current={} relationship_rows={changed_relationships}", sim.world_hash());
        } else {
            assert_eq!(
                captured, original,
                "exact original producer state after only the reviewed catalogue fingerprint rewrite"
            );
            assert_eq!(sim.world_hash(), 4676206450852028819);
        }
    }
}

#[test]
fn authentic_published_fifteen_conserves_requests_orders_and_current_continuation() {
    for (name, bytes) in fixtures() {
        let original = decode(bytes);
        let mut source = SimHandle::from_lot();
        assert!(source.load_bytes(bytes), "authentic {name}");
        let migrated = decode_current(&source.save_bytes());
        assert_eq!(
            migrated.legacy.conversation_requests, original.conversation_requests,
            "{name} requests"
        );
        assert_eq!(
            six(&migrated.legacy).queues,
            six(&original).queues,
            "{name} exact order IDs"
        );
        assert_eq!(
            six(&migrated.legacy).legacy.world.queued_commands,
            six(&original).legacy.world.queued_commands,
            "{name} pending input"
        );
        assert_eq!(
            six(&migrated.legacy).legacy.world.rng,
            six(&original).legacy.world.rng,
            "{name} primary RNG"
        );
        if let (Some(old), Some(current)) = (
            &six(&original).legacy.chores,
            &six(&migrated.legacy).legacy.chores,
        ) {
            assert_eq!(current.rng, old.rng, "{name} chore RNG");
        }
        let current = source.save_bytes();
        let mut resumed = SimHandle::from_lot();
        assert!(
            resumed.load_bytes(&current),
            "{name} strict current admission"
        );
        assert_eq!(resumed.save_bytes(), current);
        for tick in 0..120 {
            source.tick();
            resumed.tick();
            assert_eq!(
                resumed.world_hash(),
                source.world_hash(),
                "{name} current tick {tick}"
            );
            assert_eq!(
                resumed.save_bytes(),
                source.save_bytes(),
                "{name} current bytes tick {tick}"
            );
        }
    }
}

#[test]
fn authentic_published_fifteen_survives_build_baselines_and_rejected_loads() {
    for (name, bytes) in fixtures() {
        let mut expected = SimHandle::from_lot();
        assert!(expected.load_bytes(bytes));
        expected.sim.flush_commands();
        assert_eq!(expected.sim.take_build_error(), None);
        let settled = expected.save_bytes();
        let mut live = SimHandle::from_lot();
        assert!(live.load_bytes(bytes));
        live.sim.begin_build().unwrap();
        assert_eq!(live.save_bytes(), settled, "{name} input settles once");
        live.sim
            .stage_room_name(
                terri_core::rooms::RoomSelection::Outside,
                "Corpus yard".into(),
            )
            .unwrap();
        let token = live
            .sim
            .prepare_build_commit(terri_sim::rooms::RoomChoices::default())
            .unwrap()
            .token;
        let draft_hash = live.world_hash();
        let rows = live.sim.build_rooms().unwrap();
        let original = decode(bytes);
        let mut malformed = Vec::new();
        if !original.conversation_requests.requests.is_empty() {
            for case in 0..7 {
                let mut corrupt = original.clone();
                let request = &mut corrupt.conversation_requests.requests[0];
                match case {
                    0 => corrupt.conversation_requests.next_id = 0,
                    1 => request.initiator = u32::MAX,
                    2 => request.recipient = request.initiator,
                    3 => request.created = six(&original).legacy.world.tick + 1,
                    4 => request.waiting_tile = Some((i32::MAX, i32::MAX)),
                    5 => {
                        request.origin = terri_core::save_v15::SavedConversationOrigin::Player {
                            order_id: u64::MAX,
                        }
                    }
                    _ => {
                        request.phase = terri_core::save_v15::SavedConversationPhase::Suspended;
                        request.target_owned = true;
                    }
                }
                let mut payload = Vec::from(SAVE_MAGIC);
                payload.extend(15u16.to_le_bytes());
                payload.extend(postcard::to_allocvec(&corrupt).unwrap());
                malformed.push(payload);
            }
        }
        malformed.push(bytes[..bytes.len() - 1].to_vec());
        let mut trailing = bytes.to_vec();
        trailing.push(0);
        malformed.push(trailing);
        for bad in malformed {
            assert!(!live.load_bytes(&bad), "{name} malformed published input");
            assert_eq!(live.save_bytes(), settled);
            assert_eq!(live.world_hash(), draft_hash);
            assert_eq!(live.sim.build_rooms().unwrap(), rows);
            assert_eq!(live.sim.validate_build_token(token), Ok(()));
        }
        live.sim.commit_build(token).unwrap();
        assert_eq!(
            decode_current(&live.save_bytes()).legacy,
            decode_current(&settled).legacy
        );
        let confirmed = live.save_bytes();
        live.sim
            .stage_room_name(
                terri_core::rooms::RoomSelection::Outside,
                "Discarded yard".into(),
            )
            .unwrap();
        live.sim.cancel_build().unwrap();
        assert_eq!(live.save_bytes(), confirmed);
        assert!(live.load_bytes(bytes), "{name} successful active load");
        assert_eq!(live.save_bytes(), settled);
        live.sim.end_build().unwrap();
        assert_eq!(live.save_bytes(), settled);
    }
}
