use super::*;
use crate::Sim;
use terri_core::{CommandQueue, Facing, Needs, Personality, SimCommand};

fn place(sim: &mut Sim, model: &str, x: usize, y: usize, facing: Facing) -> Entity {
    let pack = sim.world().resource::<Content>().0;
    let kind = pack.find(model).unwrap();
    let definition = pack.object(kind);
    let position = Position {
        x: x as f32,
        y: y as f32,
    };
    let object = sim.spawn_object(position, kind);
    crate::apply_object_placement(sim.world_mut(), object, definition, position, facing);
    let footprint = definition.footprint_at(facing);
    for dx in 0..footprint.width {
        for dy in 0..footprint.depth {
            sim.world_mut().resource_mut::<TileGrid>().set_blocked(
                x + dx as usize,
                y + dy as usize,
                true,
            );
        }
    }
    object
}

fn queued_meal(facing: Facing, setting: usize) -> (Sim, Entity, Entity, Entity) {
    let mut sim = Sim::new_with_lot(16, 16);
    let fridge = place(&mut sim, "fridge", 2, 2, Facing::SouthEast);
    place(&mut sim, "counter", 5, 2, Facing::SouthEast);
    place(&mut sim, "stove", 8, 2, Facing::SouthEast);
    let table = place(&mut sim, "dining_table", 8, 8, facing);
    // Explicit physical positions keep the fixture independent of setting_at.
    let positions = [
        [(8, 7), (9, 7), (8, 9), (9, 9)],
        [(9, 8), (9, 9), (7, 8), (7, 9)],
        [(9, 9), (8, 9), (9, 7), (8, 7)],
        [(7, 9), (7, 8), (9, 9), (9, 8)],
    ];
    let (x, y) = positions[facing.code() as usize][setting];
    let chair_facing = if setting < 2 {
        facing
    } else {
        facing.turned().turned()
    };
    let chair = place(&mut sim, "chair", x, y, chair_facing);
    let pack = sim.world().resource::<Content>().0;
    let person = crate::household::spawn_member(
        sim.world_mut(),
        &pack.personalities,
        &pack.traits,
        crate::household::Member {
            name: "Diner".into(),
            personality: 0,
            position: Position { x: 3., y: 5. },
            needs: [100.; 7],
            hobbies: vec![],
            traits: &[],
            career: None,
            instinct: Some(50),
        },
    );
    sim.world_mut()
        .get_mut::<Personality>(person)
        .unwrap()
        .drain = [0.; 7];
    sim.world_mut()
        .entity_mut(person)
        .insert(Needs::all_at(100.));
    let pack = sim.world().resource::<Content>().0;
    let interaction = pack
        .object(pack.find("fridge").unwrap())
        .interactions
        .iter()
        .position(|action| action.id == "cook_dinner")
        .unwrap() as u32;
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: person.index_u32(),
            object: fridge.index_u32(),
            interaction,
        });
    sim.flush_commands();
    assert!(!sim.world().get::<IntentQueue>(person).unwrap().is_empty());
    (sim, person, table, chair)
}

fn finish_queued_meal(sim: &mut Sim, person: Entity, table: Entity, chair: Entity, setting: u8) {
    let mut steps = std::collections::BTreeSet::new();
    let mut was_seated = false;
    for _ in 0..1500 {
        sim.tick();
        if let Some(chain) = sim.world().get::<ChainState>(person) {
            steps.insert(chain.step);
            if chain.step == 5 && sim.world().get::<StepWork>(person).is_some() {
                let diner = claim(sim.world(), person.index_u32()).unwrap();
                assert_eq!(diner.station, table.index_u32());
                assert_eq!(diner.chair, Some(chair.index_u32()));
                assert_eq!(diner.setting, Some(setting));
                was_seated = true;
            }
        }
        let state = sim.world().resource::<SavedDomestic>();
        if let Some(dish) = state.dishes.iter().find(|d| d.surface == table.index_u32()) {
            assert!(was_seated, "The queued meal must reach occupied chair work");
            assert_eq!(
                steps.into_iter().collect::<Vec<_>>(),
                vec![0, 1, 2, 3, 4, 5]
            );
            assert_eq!(dish.units, 1);
            assert_eq!(dish.owner, sim.world().get::<SimId>(person).unwrap().0);
            assert_eq!(
                state
                    .dishes
                    .iter()
                    .filter(|d| d.surface == table.index_u32())
                    .count(),
                1
            );
            assert_eq!(
                sim.world().resource::<SavedDining>().settings,
                vec![(dish.id, setting)],
                "The finished dish must retain the exact occupied place setting",
            );
            let visible = sim.dish_piles();
            let table_piles: Vec<_> = visible
                .chunks_exact(3)
                .filter(|pile| pile[0] == table.index_u32())
                .collect();
            let visual_setting = [2, 0, 1, 3][setting as usize];
            assert_eq!(
                table_piles,
                vec![&[table.index_u32(), visual_setting, dish.id][..]]
            );
            assert_released(sim, person, table, chair);
            let saved = sim.current_v10_view();
            let hash = sim.world_hash();
            sim.load_current_v10_view(saved.clone()).unwrap();
            assert_eq!(sim.current_v10_view(), saved);
            assert_eq!(sim.world_hash(), hash);
            return;
        }
    }
    panic!("Queued meal did not finish at table setting {setting}; steps={steps:?}");
}

fn assert_released(sim: &Sim, person: Entity, table: Entity, chair: Entity) {
    assert!(sim.world().resource::<SavedDining>().diners.is_empty());
    assert!(sim
        .world()
        .get::<crate::seating::PhysicalClaim>(person)
        .is_none());
    assert!(sim.world().get::<Reserved>(table).is_none());
    assert!(sim.world().get::<Reserved>(chair).is_none());
    assert!(sim.world().get::<Target>(person).is_none());
    assert!(sim.world().get::<StepWork>(person).is_none());
    assert!(sim.world().get::<IntentQueue>(person).unwrap().is_empty());
}

#[test]
fn queued_meal_completion_retains_each_physical_setting_in_every_facing() {
    for facing in Facing::ALL {
        for setting in 0..4 {
            let (mut sim, person, table, chair) = queued_meal(facing, setting);
            finish_queued_meal(&mut sim, person, table, chair, setting as u8);
        }
    }
}

#[test]
fn queued_meal_cancel_releases_each_physical_setting_without_a_finished_dish() {
    for facing in Facing::ALL {
        for setting in 0..4 {
            let (mut sim, person, table, chair) = queued_meal(facing, setting);
            for _ in 0..1500 {
                sim.tick();
                if sim
                    .world()
                    .get::<ChainState>(person)
                    .is_some_and(|c| c.step == 5)
                    && sim.world().get::<StepWork>(person).is_some()
                {
                    break;
                }
            }
            let diner = claim(sim.world(), person.index_u32()).unwrap();
            assert_eq!(diner.chair, Some(chair.index_u32()));
            assert_eq!(diner.setting, Some(setting as u8));
            assert!(sim.world().get::<StepWork>(person).is_some());
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::CancelIntents {
                    agent: person.index_u32(),
                });
            sim.flush_commands();
            assert_released(&sim, person, table, chair);
            assert!(sim.world().get::<ChainState>(person).is_none());
            assert!(!sim
                .world()
                .resource::<SavedDomestic>()
                .dishes
                .iter()
                .any(|d| d.surface == table.index_u32()));
            let saved = sim.current_v10_view();
            sim.load_current_v10_view(saved.clone()).unwrap();
            assert_eq!(sim.current_v10_view(), saved);
        }
    }
}

#[test]
fn queued_meal_completion_does_not_borrow_another_person_or_tables_setting() {
    use bevy_ecs::system::RunSystemOnce;
    for wrong_person in [false, true] {
        let (mut sim, person, table, chair) = queued_meal(Facing::SouthEast, 3);
        for _ in 0..1500 {
            sim.tick();
            if sim
                .world()
                .get::<ChainState>(person)
                .is_some_and(|c| c.step == 5)
                && sim.world().get::<StepWork>(person).is_some()
            {
                break;
            }
        }
        assert_eq!(
            claim(sim.world(), person.index_u32()).unwrap().setting,
            Some(3)
        );
        sim.world_mut()
            .get_mut::<StepWork>(person)
            .unwrap()
            .remaining_ticks = 1;
        let foreign = sim.world_mut().spawn_empty().id().index_u32();
        let mut state = sim.world_mut().resource_mut::<SavedDining>();
        if wrong_person {
            state.diners[0].person = foreign;
        } else {
            state.diners[0].station = foreign;
        }
        // Run the real completion system directly so maintenance cannot remove
        // the mismatched record before its ownership check is exercised.
        sim.world_mut()
            .run_system_once(crate::systems::chain::tick_chain_steps)
            .unwrap();
        let dishes = &sim.world().resource::<SavedDomestic>().dishes;
        let dish = dishes
            .iter()
            .find(|d| d.surface == table.index_u32())
            .unwrap();
        assert_eq!(
            sim.world().resource::<SavedDining>().settings,
            vec![(dish.id, 0)]
        );
        assert_released(&sim, person, table, chair);
    }
}
