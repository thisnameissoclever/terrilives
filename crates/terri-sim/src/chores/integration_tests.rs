use super::*;
use crate::Sim;
use terri_core::{Agent, CommandQueue, Needs, Position, SimCommand, SimId, SmartObject, TileGrid};

fn daily_fixture() -> (Sim, Entity, ChoreKey, u32) {
    let mut sim = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
    ensure(sim.world_mut());
    let person = crate::edit::living_entity(sim.world(), 0).unwrap();
    // Keep unrelated mood outside the willingness clamp so each chore cause
    // can move the saved decision without relying on a shipped condition.
    sim.world_mut()
        .entity_mut(person)
        .insert((Needs::all_at(60.0), terri_core::Traits::default()));
    let counter = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| {
            sim.world()
                .resource::<crate::Content>()
                .0
                .object(object.0)
                .id
                == "counter"
        })
        .unwrap()
        .0;
    let room = groups::key_for(sim.world(), counter).unwrap().target;
    let grid = sim.world().resource::<TileGrid>();
    let rooms = crate::room_regions::RoomRegions::from_world(sim.world());
    let at = (0..grid.height())
        .flat_map(|y| (0..grid.width()).map(move |x| (x as i32, y as i32)))
        .find(|xy| grid.is_walkable(xy.0, xy.1) && rooms.at(*xy) == Some(room))
        .unwrap();
    sim.world_mut().entity_mut(person).insert(Position {
        x: at.0 as f32,
        y: at.1 as f32,
    });
    let bin = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| {
            sim.world()
                .resource::<crate::Content>()
                .0
                .object(object.0)
                .id
                == "trashcan"
        })
        .unwrap()
        .0;
    let key = ChoreKey {
        kind: ChoreKind::Bins,
        target: bin.index_u32(),
    };
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    state.profiles[0] = ChoreProfile::neutral(0);
    add(&mut state.bins, key.target, 1000);
    board::reconcile(sim.world(), &mut state);
    state
        .assignments
        .iter_mut()
        .find(|a| a.key == key)
        .unwrap()
        .owner = 0;
    for episode in &mut state.episodes {
        if episode.key == key {
            episode.owner = 0;
        } else {
            episode.decision = Some(false);
            episode.outcome = DutyOutcome::Skipped;
        }
    }
    sim.world_mut().insert_resource(state);
    (sim, person, key, room)
}

fn chance(sim: &Sim, person: Entity, key: ChoreKey) -> f32 {
    let state = sim.world().resource::<SavedChores>();
    let id = sim.world().get::<SimId>(person).unwrap().0;
    policy::willingness(
        state.profiles.iter().find(|p| p.sim_id == id).unwrap(),
        key.kind,
        crate::domestic::cleanliness(sim.world(), person),
        board::readiness(sim.world(), person),
        sim.mood_of(person.index_u32()).unwrap().overall_score / 8.0,
    )
}

fn decide(sim: &mut Sim, key: ChoreKey, seed: u64) -> bool {
    sim.world_mut().resource_mut::<SavedChores>().rng = Some(terri_core::SimRng::from_seed(seed));
    tick(sim.world_mut());
    sim.world()
        .resource::<SavedChores>()
        .episodes
        .iter()
        .find(|e| e.key == key && e.day == 0)
        .unwrap()
        .decision
        .expect("the idle owner gets one daily decision")
}

fn draw_between(a: f32, b: f32) -> u64 {
    assert!(a != b, "the isolated mood change must affect willingness");
    (0..100_000)
        .find(|seed| {
            let draw = terri_core::SimRng::from_seed(*seed).next_f32();
            draw > a.min(b) && draw < a.max(b)
        })
        .expect("a seeded draw falls between the two chances")
}

#[test]
fn daily_decisions_include_floor_and_surface_grime_mood() {
    for surfaces in [false, true] {
        let (mut clean, person, key, _) = daily_fixture();
        let (mut dirty, dirty_person, dirty_key, room) = daily_fixture();
        assert_eq!(person, dirty_person);
        assert_eq!(key, dirty_key);
        let members = if surfaces {
            let mut members = groups::members(
                dirty.world(),
                ChoreKey {
                    kind: ChoreKind::CounterSurfaces,
                    target: room,
                },
            );
            members.extend(groups::members(
                dirty.world(),
                ChoreKey {
                    kind: ChoreKind::TableSurfaces,
                    target: room,
                },
            ));
            members
        } else {
            let grid = dirty.world().resource::<TileGrid>();
            let rooms = crate::room_regions::RoomRegions::from_world(dirty.world());
            (0..grid.height())
                .flat_map(|y| (0..grid.width()).map(move |x| (x, y)))
                .filter(|(x, y)| {
                    grid.is_walkable(*x as i32, *y as i32)
                        && rooms.at((*x as i32, *y as i32)) == Some(room)
                })
                .map(|(x, y)| (y * grid.width() + x) as u32)
                .collect()
        };
        assert!(!members.is_empty());
        let mut state = dirty.world_mut().resource_mut::<SavedChores>();
        for member in members {
            add(
                if surfaces {
                    &mut state.surfaces
                } else {
                    &mut state.floors
                },
                member,
                1000,
            );
        }
        let clean_chance = chance(&clean, person, key);
        let dirty_chance = chance(&dirty, person, key);
        assert!(clean_chance > dirty_chance);
        let seed = draw_between(clean_chance, dirty_chance);
        assert!(
            decide(&mut clean, key, seed),
            "the clean-room owner accepts"
        );
        assert!(
            !decide(&mut dirty, key, seed),
            "grime mood lowers the same saved decision"
        );
    }
}

#[test]
fn daily_decisions_include_recent_chore_feelings() {
    for feeling in [-100, 100] {
        let (mut neutral, person, key, _) = daily_fixture();
        let (mut affected, _, _, _) = daily_fixture();
        affected
            .world_mut()
            .resource_mut::<SavedChores>()
            .feelings
            .push(ChoreFeeling {
                person: 0,
                kind: ChoreKind::Surfaces,
                score: feeling,
                expires: 60,
            });
        let neutral_chance = chance(&neutral, person, key);
        let affected_chance = chance(&affected, person, key);
        assert_eq!(affected_chance > neutral_chance, feeling > 0);
        let seed = draw_between(neutral_chance, affected_chance);
        assert_eq!(decide(&mut neutral, key, seed), feeling < 0);
        assert_eq!(decide(&mut affected, key, seed), feeling > 0);
    }
}

#[test]
fn personality_edit_preserves_profile_and_active_chore_but_changes_cleanliness() {
    let (mut sim, person, key, _) = daily_fixture();
    let profile = ChoreProfile {
        sim_id: 0,
        responsibility: 73,
        commitment: 81,
        preferences: [34, -27, 58, -11],
    };
    let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
    state.board_enabled = false;
    state.profiles[0] = profile.clone();
    assert!(work::start(sim.world_mut(), &mut state, person, key, true));
    sim.world_mut().insert_resource(state);
    tick(sim.world_mut());
    let task = sim.world().resource::<SavedChores>().tasks[0].clone();
    let path = sim.world().get::<terri_core::Path>(person).cloned();
    let before = crate::domestic::cleanliness(sim.world(), person);
    let personality = sim
        .world()
        .resource::<crate::Content>()
        .0
        .personalities
        .iter()
        .position(|p| p.id == "the_settled")
        .unwrap() as u32;
    let after =
        sim.world().resource::<crate::Content>().0.personalities[personality as usize].cleanliness;
    assert_ne!(before, after);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::EditHousemate {
            sim: 0,
            name: "Tim".into(),
            personality: Some(personality),
            traits: vec![],
            ties: vec![],
        });
    sim.flush_commands();
    assert!(sim
        .world()
        .resource::<crate::placement::LotEditState>()
        .last_edit_result
        .unwrap()
        .reason
        .is_none());
    assert_eq!(crate::domestic::cleanliness(sim.world(), person), after);
    assert_eq!(
        super::profile(sim.world(), person.index_u32()),
        Some(profile)
    );
    assert_eq!(sim.world().resource::<SavedChores>().tasks, vec![task]);
    assert_eq!(
        sim.world()
            .get::<terri_core::Path>(person)
            .map(|p| (&p.steps, p.cursor)),
        path.as_ref().map(|p| (&p.steps, p.cursor))
    );
    assert!(sim.world().get::<ChoreWork>(person).is_some());
    assert!(sim.world().get::<Agent>(person).is_some());
    let mut restored = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
    restored.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(restored.world_hash(), sim.world_hash());
}
