//! Tests for a housemate moving in - [CS-command], [CS-arrival] and
//! [CS-save] in `docs/specs/2026-09-22-create-a-sim.md`.

use super::*;
use crate::Sim;
use terri_core::{CommandQueue, Needs, SimCommand, SimName, Traits};

fn move_in(sim: &mut Sim, name: &str, personality: u32, traits: &[u32]) -> HousemateResult {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::AddHousemate {
            name: name.to_string(),
            personality,
            traits: traits.to_vec(),
        });
    sim.flush_commands();
    sim.world()
        .resource::<LotEditState>()
        .last_housemate_result
        .expect("the drain recorded the move-in")
}

fn entity(sim: &Sim, index: u32) -> Entity {
    let index = bevy_ecs::entity::EntityIndex::from_raw_u32(index).unwrap();
    sim.world().entities().resolve_from_index(index)
}

/// The newcomer arrives on the street's exit, walking to the landing, and is
/// a household member made as the shipped ones are: the next sim id, the
/// trimmed name, the personality's numbers, full needs, no job or hobbies,
/// and each trait at its kind's starting state.
#[test]
fn a_housemate_moves_in_from_the_street() {
    let mut sim = Sim::new_from_shipped_lot();
    let content = sim.world().resource::<Content>().0;
    assert_eq!(household_size(sim.world()), 3);
    let worn: Vec<u32> = [
        "television_devotee",
        content.traits[content
            .traits
            .iter()
            .position(|t| matches!(t.kind, terri_data::CompiledTraitKind::Capability { .. }))
            .unwrap()]
        .id
        .as_str(),
    ]
    .iter()
    .map(|id| content.traits.iter().position(|t| t.id == *id).unwrap() as u32)
    .collect();
    let result = move_in(&mut sim, "  Ann  ", 1, &worn);
    assert_eq!(result.reason, None);
    let ann = entity(&sim, result.sim.expect("moved in"));
    let world = sim.world();
    assert_eq!(world.get::<SimName>(ann).unwrap().0, "Ann");
    assert_eq!(world.get::<SimId>(ann), Some(&SimId(3)));
    assert_eq!(
        *world.get::<Position>(ann).unwrap(),
        Position { x: 19.0, y: 2.0 }
    );
    assert_eq!(world.get::<Path>(ann).unwrap().steps.last(), Some(&(15, 3)));
    assert_eq!(
        world.get::<terri_core::Personality>(ann).unwrap().drain,
        content.personalities[1].drain
    );
    assert_eq!(*world.get::<Needs>(ann).unwrap(), Needs::all_at(NEED_MAX));
    assert!(world.get::<terri_core::Career>(ann).is_none());
    assert!(world.get::<terri_core::Hobbies>(ann).unwrap().0.is_empty());
    let terri_data::CompiledTraitKind::Capability { start_level, .. } =
        content.traits[worn[1] as usize].kind
    else {
        unreachable!("chosen as a capability");
    };
    let traits = world.get::<Traits>(ann).unwrap();
    assert_eq!(traits.state(worn[0]), Some(0.0));
    assert_eq!(traits.state(worn[1]), Some(start_level));
    assert_eq!(household_size(world), 4);
}

/// Every refusal writes nothing, not even a sim id, so the next move-in that
/// succeeds still gets the next one. Each limit's own end is allowed.
#[test]
fn a_refused_move_in_writes_nothing() {
    use HousemateRefusal::*;
    let mut sim = Sim::new_from_shipped_lot();
    let content = sim.world().resource::<Content>().0;
    let (max_chars, max_traits) = (
        content.tuning.housemate_name_max_chars as usize,
        content.tuning.housemate_max_traits as usize,
    );
    let people = content.personalities.len() as u32;
    let library = content.traits.len() as u32;
    let before = sim.world_hash();
    for (name, personality, traits, reason) in [
        ("   ".to_string(), 0, vec![], BadName),
        ("a".repeat(max_chars + 1), 0, vec![], BadName),
        ("Ann".to_string(), people, vec![], UnknownPersonality),
        (
            "Ann".to_string(),
            0,
            (0..=max_traits as u32).collect(),
            TooManyTraits,
        ),
        ("Ann".to_string(), 0, vec![library], UnknownTrait),
        ("Ann".to_string(), 0, vec![1, 1], RepeatedTrait),
    ] {
        let result = move_in(&mut sim, &name, personality, &traits);
        assert_eq!(
            (result.sim, result.reason),
            (None, Some(reason)),
            "{reason:?}"
        );
        assert_eq!(sim.world_hash(), before, "{reason:?} wrote something");
    }
    let longest = "a".repeat(max_chars);
    let result = move_in(
        &mut sim,
        &longest,
        people - 1,
        &(0..max_traits as u32).collect::<Vec<_>>(),
    );
    assert_eq!(result.reason, None, "every limit's own end is allowed");
    let newcomer = entity(&sim, result.sim.unwrap());
    assert_eq!(sim.world().get::<SimId>(newcomer), Some(&SimId(3)));
}

/// The household holds six at most: three move in beside the shipped three,
/// and the seventh is refused.
#[test]
fn the_household_holds_six_at_most() {
    let mut sim = Sim::new_from_shipped_lot();
    for name in ["Ann", "Bo", "Cy"] {
        assert_eq!(move_in(&mut sim, name, 0, &[]).reason, None, "{name}");
    }
    assert_eq!(household_size(sim.world()), MAX_HOUSEHOLD_SIZE);
    assert_eq!(
        move_in(&mut sim, "Di", 0, &[]).reason,
        Some(HousemateRefusal::HouseholdFull)
    );
}

/// [CS-arrival]: with furniture on the street's exit, the newcomer arrives on
/// the front door's tile instead.
#[test]
fn a_housemate_arrives_by_the_door_when_the_exit_is_shut() {
    let mut sim = Sim::new_from_shipped_lot();
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(19, 2, true);
    let result = move_in(&mut sim, "Ann", 0, &[]);
    let ann = entity(&sim, result.sim.unwrap());
    assert_eq!(
        *sim.world().get::<Position>(ann).unwrap(),
        Position { x: 15.0, y: 2.0 }
    );
    assert_eq!(sim.world().get::<Path>(ann).unwrap().steps, vec![(15, 3)]);
}

/// [CS-save]: the newcomer saves and loads like anyone, and the loaded game
/// plays on as the unsaved one does.
#[test]
fn a_housemate_saves_loads_and_plays_on() {
    let mut sim = Sim::new_from_shipped_lot();
    let moved_in = move_in(&mut sim, "Ann", 2, &[3]);
    let ann = entity(&sim, moved_in.sim.unwrap());
    for _ in 0..40 {
        sim.tick();
    }
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(loaded.world().get::<SimName>(ann).unwrap().0, "Ann");
    assert_eq!(household_size(loaded.world()), 4);
    for _ in 0..300 {
        sim.tick();
        loaded.tick();
        assert_eq!(loaded.world_hash(), sim.world_hash());
    }
}

/// [CS-save]: a move-in staged just before a save is saved by the
/// personality's and the traits' ids, loads with the same digest, and moves
/// the same newcomer in. Ids the content no longer has are refused.
#[test]
fn a_staged_move_in_is_saved_and_replayed() {
    let stage = |sim: &mut Sim, command: SimCommand| {
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
    };
    let mut sim = Sim::new_from_shipped_lot();
    stage(
        &mut sim,
        SimCommand::AddHousemate {
            name: "Ann".to_string(),
            personality: 1,
            traits: vec![0, 4],
        },
    );
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(loaded.world_hash(), sim.world_hash());
    sim.flush_commands();
    loaded.flush_commands();
    assert_eq!(loaded.world_hash(), sim.world_hash());

    for (personality, traits, reason) in [
        (
            Some("a_retired_personality"),
            vec![],
            HousemateRefusal::UnknownPersonality,
        ),
        (
            None,
            vec![Some("a_retired_trait".to_string())],
            HousemateRefusal::UnknownTrait,
        ),
    ] {
        let fresh = Sim::new_from_shipped_lot();
        let mut saved = fresh.save_snapshot_v5();
        let personality = personality.unwrap_or(
            fresh.world().resource::<Content>().0.personalities[0]
                .id
                .as_str(),
        );
        saved
            .world
            .queued_commands
            .push(terri_core::SavedCommand::AddHousemate {
                name: "Ann".to_string(),
                personality: Some(personality.to_string()),
                traits,
            });
        let mut restored = Sim::new_from_shipped_lot();
        restored.load_snapshot_v5(saved).expect("loads");
        restored.flush_commands();
        let result = restored
            .world()
            .resource::<LotEditState>()
            .last_housemate_result;
        assert_eq!(result.and_then(|result| result.reason), Some(reason));
    }
}

/// [CS-save]: the digest sees a staged move-in's personality and traits by
/// what they are, and not the name; two indices naming nothing hash alike.
#[test]
fn the_world_hash_sees_a_staged_move_in_by_its_ids() {
    let staged = |name: &str, personality: u32, traits: Vec<u32>| {
        let mut sim = Sim::new_from_shipped_lot();
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::AddHousemate {
                name: name.to_string(),
                personality,
                traits,
            });
        sim.world_hash()
    };
    let reference = staged("Ann", 1, vec![0, 4]);
    assert_eq!(
        staged("Bo", 1, vec![0, 4]),
        reference,
        "the name is in no hash"
    );
    for (label, hash) in [
        ("personality", staged("Ann", 2, vec![0, 4])),
        ("a trait", staged("Ann", 1, vec![0, 5])),
        ("the order", staged("Ann", 1, vec![4, 0])),
        ("the count", staged("Ann", 1, vec![0])),
    ] {
        assert_ne!(hash, reference, "{label}");
    }
    assert_eq!(staged("Ann", 900, vec![]), staged("Ann", u32::MAX, vec![]));
    assert_eq!(
        staged("Ann", 1, vec![900]),
        staged("Ann", 1, vec![u32::MAX])
    );
}

#[test]
fn a_personality_is_labelled_by_its_id_in_words() {
    assert_eq!(personality_label("the_correspondent"), "The correspondent");
    assert_eq!(personality_label("x"), "X");
    assert_eq!(personality_label(""), "");
}

/// [CS-arrival]: with the street's exit and the front door's tile both under
/// furniture there is no way in, and the refusal writes nothing.
#[test]
fn a_housemate_with_no_way_in_is_refused() {
    let mut sim = Sim::new_from_shipped_lot();
    {
        let mut grid = sim.world_mut().resource_mut::<TileGrid>();
        grid.set_blocked(19, 2, true);
        grid.set_blocked(15, 2, true);
    }
    let before = sim.world_hash();
    let result = move_in(&mut sim, "Ann", 0, &[]);
    assert_eq!(result.reason, Some(HousemateRefusal::NoWayIn));
    assert_eq!(result.sim, None);
    assert_eq!(sim.world_hash(), before);
    assert_eq!(household_size(sim.world()), 3);
}

/// [CS-arrival]: a lot with no front door has no street to arrive from, so
/// the newcomer appears on its first open tile, in row order, and stands
/// there; with no open tile at all there is no way in.
#[test]
fn a_lot_with_no_front_door_takes_the_first_open_tile() {
    let mut lot = terri_data::pack().lot.clone();
    lot.front_door = None;
    let content: &'static terri_data::ContentPack = Box::leak(Box::new(terri_data::ContentPack {
        lot,
        ..terri_data::pack().clone()
    }));
    let mut sim = crate::test_content::sim_with(4, 3, content);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(0, 0, true);
    let result = move_in(&mut sim, "Ann", 0, &[]);
    let ann = entity(&sim, result.sim.expect("moved in"));
    assert_eq!(
        *sim.world().get::<Position>(ann).unwrap(),
        Position { x: 1.0, y: 0.0 }
    );
    assert!(sim.world().get::<Path>(ann).is_none());

    let mut walled = crate::test_content::sim_with(2, 1, content);
    {
        let mut grid = walled.world_mut().resource_mut::<TileGrid>();
        grid.set_blocked(0, 0, true);
        grid.set_blocked(1, 0, true);
    }
    assert_eq!(
        move_in(&mut walled, "Bo", 0, &[]).reason,
        Some(HousemateRefusal::NoWayIn)
    );
}

/// Every answer is numbered, refusals included, so the shell can tell a
/// fresh answer from the one before it.
#[test]
fn every_move_in_answer_is_numbered() {
    let mut sim = Sim::new_from_shipped_lot();
    assert_eq!(move_in(&mut sim, " ", 0, &[]).handled, 1);
    assert_eq!(move_in(&mut sim, "Ann", 0, &[]).handled, 2);
    assert_eq!(move_in(&mut sim, "", 0, &[]).handled, 3);
}

/// [CS-save]: a staged move-in whose name or trait list is past the size
/// every saved name and list is held to is refused by the loader, and one
/// just inside both limits loads.
#[test]
fn a_staged_move_in_is_held_to_the_saved_size_limits() {
    let fresh = Sim::new_from_shipped_lot();
    let personality = fresh.world().resource::<Content>().0.personalities[0]
        .id
        .clone();
    let staged = |name: String, traits: usize| {
        let mut saved = fresh.save_snapshot_v5();
        saved
            .world
            .queued_commands
            .push(terri_core::SavedCommand::AddHousemate {
                name,
                personality: Some(personality.clone()),
                traits: vec![None; traits],
            });
        Sim::new_from_shipped_lot().load_snapshot_v5(saved)
    };
    assert_eq!(
        staged("a".repeat(1_025), 0),
        Err(crate::SaveError::InvalidValue)
    );
    assert_eq!(
        staged("Ann".to_string(), 100_001),
        Err(crate::SaveError::InvalidValue)
    );
    assert_eq!(staged("a".repeat(1_024), 100_000), Ok(()));
}
