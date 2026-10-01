use super::*;
use crate::Sim;
use terri_core::Reserved;
use terri_core::{CommandQueue, SimCommand};

fn household() -> (Sim, Vec<Entity>, Entity, Entity, Entity) {
    let mut sim = Sim::new_from_shipped_lot();
    let pack = sim.world().resource::<Content>().0;
    let mut people: Vec<_> = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .map(|(person, id)| (id.0, person))
        .collect();
    people.sort_by_key(|(id, _)| *id);
    let people: Vec<_> = people.into_iter().map(|(_, person)| person).collect();
    for person in &people {
        sim.world_mut()
            .entity_mut(*person)
            .remove::<terri_core::Career>();
        let mut personality = sim.world_mut().get_mut::<Personality>(*person).unwrap();
        personality.drain = [0.0; 7];
        sim.world_mut()
            .get_mut::<Needs>(*person)
            .unwrap()
            .set(NeedId::Hunger, 30.0);
    }
    let find = |sim: &mut Sim, id: &str| {
        sim.world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .find(|(_, object)| pack.object(object.0).id == id)
            .unwrap()
            .0
    };
    let fridge = find(&mut sim, "fridge");
    let counter = find(&mut sim, "counter");
    let table = find(&mut sim, "dining_table");
    (sim, people, fridge, counter, table)
}

#[test]
fn needs_override_tidiness_and_slobs_rarely_clean() {
    let full = Needs::all_at(100.0);
    assert!(
        (cleanup_probability(
            1.0,
            &full,
            15.0,
            &terri_data::pack().tuning.domestic.unwrap()
        ) - 0.90)
            .abs()
            < 0.00001
    );
    assert!(
        (cleanup_probability(
            0.0,
            &full,
            15.0,
            &terri_data::pack().tuning.domestic.unwrap()
        ) - 0.01)
            .abs()
            < 0.00001
    );
    let mut tired = full;
    tired.set(NeedId::Energy, 5.0);
    assert!(
        cleanup_probability(
            1.0,
            &tired,
            15.0,
            &terri_data::pack().tuning.domestic.unwrap()
        ) < 0.005
    );
    let mut social = full;
    social.set(NeedId::Social, 1.0);
    assert!(
        cleanup_probability(
            1.0,
            &social,
            15.0,
            &terri_data::pack().tuning.domestic.unwrap()
        ) < cleanup_probability(
            1.0,
            &full,
            15.0,
            &terri_data::pack().tuning.domestic.unwrap()
        )
    );
}

#[test]
fn meal_names_follow_the_clock_boundaries() {
    assert_eq!(meal_label(0, 1440), "Cook breakfast");
    assert_eq!(meal_label(659, 1440), "Cook breakfast");
    assert_eq!(meal_label(660, 1440), "Cook lunch");
    assert_eq!(meal_label(1020, 1440), "Cook dinner");
    assert_eq!(meal_label(1440, 1440), "Cook breakfast");
}

#[test]
fn snack_and_meal_leave_real_dishes_and_every_work_stage_round_trips() {
    for (row, expected_chain, minimum, dishes) in [(0, SNACK, 50, 2), (1, "cook_dinner", 300, 4)] {
        let (mut sim, people, fridge, counter, table) = household();
        let person = people[0];
        sim.world_mut().insert_resource(SavedDomestic {
            cleanliness: people.iter().map(|p| (p.index_u32(), 0.0)).collect(),
            ..Default::default()
        });
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObjectFirst {
                agent: person.index_u32(),
                object: fridge.index_u32(),
                interaction: row,
            });
        let mut seen = BTreeSet::new();
        let mut began = false;
        let mut ticks = 0;
        for _ in 0..2000 {
            sim.tick();
            ticks += 1;
            let active = sim.world().get::<ChainState>(person).copied();
            if let Some(chain) = active {
                if sim.world().resource::<Content>().0.chains[chain.chain as usize].id
                    == expected_chain
                {
                    began = true;
                    if sim.world().get::<StepWork>(person).is_some() {
                        seen.insert(chain.step);
                    }
                }
            }
            let snapshot = sim.save_snapshot_v5();
            let mut restored = Sim::new_from_shipped_lot();
            restored
                .load_snapshot_v5(snapshot)
                .expect("every in-flight domestic save loads");
            assert_eq!(
                sim.world_hash(),
                restored.world_hash(),
                "stage replay hash at tick {ticks}"
            );
            if began && active.is_none() {
                break;
            }
        }
        assert!(began && ticks > minimum);
        assert_eq!(seen.len(), if row == 0 { 3 } else { 6 });
        if row == 0 {
            let repetition = sim.world().get::<terri_core::Habituation>(person).unwrap();
            let pack = sim.world().resource::<Content>().0;
            let fridge_def = sim.world().get::<SmartObject>(fridge).unwrap().0;
            let visible_row = pack
                .object(fridge_def)
                .interactions
                .iter()
                .position(|action| action.id == "grab_snack")
                .unwrap() as u32;
            assert!(
                repetition.get(fridge_def, visible_row) > 0.0,
                "finishing a snack must affect its visible action's repetition"
            );
            let hidden_row = pack.object(fridge_def).interactions.len() as u32
                + pack
                    .chains
                    .iter()
                    .filter(|chain| chain.advertised_by == fridge_def)
                    .position(|chain| chain.id == SNACK)
                    .unwrap() as u32;
            assert_eq!(
                repetition.get(fridge_def, hidden_row),
                0.0,
                "the hidden implementation chain must not get a separate repetition row"
            );
        }
        let state = sim.world().resource::<SavedDomestic>();
        let own: Vec<_> = state.dishes.iter().filter(|dish| dish.owner == 0).collect();
        assert_eq!(own.iter().map(|dish| dish.units).sum::<u32>(), dishes);
        assert!(own.iter().any(|dish| dish.surface == counter.index_u32()));
        if row == 1 {
            assert!(own.iter().any(|dish| dish.surface == table.index_u32()));
        } else {
            assert!(own.iter().all(|dish| dish.surface == counter.index_u32()));
        }
    }
}

#[test]
fn complaints_are_directional_once_per_visit_and_stronger_for_neat_people() {
    let (mut sim, people, _, counter, _) = household();
    let dirty = people[0];
    let observer = people[1];
    let position = *sim.world().get::<Position>(counter).unwrap();
    sim.world_mut().get_mut::<Position>(observer).unwrap().x = position.x;
    sim.world_mut().get_mut::<Position>(observer).unwrap().y = position.y;
    // Pending player intent makes the observer busy without changing its room.
    sim.world_mut()
        .entity_mut(observer)
        .insert(ChainState::begin(0));
    sim.world_mut().insert_resource(SavedDomestic {
        cleanliness: vec![(observer.index_u32(), 1.0)],
        ..Default::default()
    });
    add_dishes(sim.world_mut(), counter.index_u32(), 0, 3);
    tick(sim.world_mut());
    let first = sim
        .world()
        .get::<Relationships>(observer)
        .unwrap()
        .feeling(SimId(0));
    assert!((first + 0.03).abs() < 0.00001);
    assert!(mood_penalty(sim.world(), observer).unwrap() > 7.0);
    assert_eq!(
        sim.world()
            .get::<Relationships>(dirty)
            .map_or(0.0, |r| r.feeling(SimId(1))),
        0.0
    );
    tick(sim.world_mut());
    assert_eq!(
        sim.world()
            .get::<Relationships>(observer)
            .unwrap()
            .feeling(SimId(0)),
        first
    );
    *sim.world_mut().get_mut::<Position>(observer).unwrap() = Position { x: 10.0, y: 1.0 };
    tick(sim.world_mut());
    *sim.world_mut().get_mut::<Position>(observer).unwrap() = position;
    tick(sim.world_mut());
    assert!(
        (sim.world()
            .get::<Relationships>(observer)
            .unwrap()
            .feeling(SimId(0))
            + 0.06)
            .abs()
            < 0.00001
    );
    sim.world_mut()
        .resource_mut::<SavedDomestic>()
        .cleanliness
        .iter_mut()
        .find(|(id, _)| *id == observer.index_u32())
        .unwrap()
        .1 = 0.0;
    assert!(mood_penalty(sim.world(), observer).unwrap() < 2.0);
}

#[test]
fn cleanup_collects_each_surface_and_washes_only_its_claimed_dishes() {
    let (mut sim, people, _, counter, table) = household();
    for person in &people {
        *sim.world_mut().get_mut::<Needs>(*person).unwrap() = Needs::all_at(100.0);
    }
    add_dishes(sim.world_mut(), counter.index_u32(), 0, 3);
    add_dishes(sim.world_mut(), table.index_u32(), 0, 1);
    add_dishes(sim.world_mut(), counter.index_u32(), 1, 1);
    assert!(start_cleanup(sim.world_mut(), people[0], vec![0, 1], true));
    let mut seen = BTreeSet::new();
    let mut seen_loads = BTreeSet::new();
    for _ in 0..1000 {
        sim.tick();
        sim.sync_render_buffer();
        let carrier = sim
            .render_buffer()
            .ids
            .iter()
            .position(|id| *id == people[0].index_u32())
            .unwrap();
        let load = sim.render_buffer().carried_dishes[carrier];
        seen_loads.insert(load);
        let visible: u32 = sim.render_buffer().dirty_dishes.iter().sum();
        if !sim.world().resource::<SavedDomestic>().cleanup.is_empty() {
            assert_eq!(
                visible + load,
                5,
                "pickup transfers dishes rather than losing or duplicating them"
            );
        }
        let saved = sim.save_snapshot_v5();
        let mut loaded = Sim::new_from_shipped_lot();
        loaded
            .load_snapshot_v5(saved)
            .expect("cleanup saves load, including washing completion");
        assert_eq!(loaded.world_hash(), sim.world_hash());
        assert_eq!(
            loaded.render_buffer().carried_dishes,
            sim.render_buffer().carried_dishes
        );
        if let Some(target) = sim.world().get::<Target>(people[0]) {
            seen.insert(target.object);
        }
        if sim.world().resource::<SavedDomestic>().cleanup.is_empty() {
            break;
        }
    }
    assert!(seen.contains(&counter) && seen.contains(&table));
    assert!(seen_loads.contains(&3) && seen_loads.contains(&4) && seen_loads.contains(&0));
    let state = sim.world().resource::<SavedDomestic>();
    assert!(!state.dishes.iter().any(|dish| dish.owner == 0));
    assert!(state.dishes.iter().any(|dish| dish.owner == 1));
}

#[test]
fn paused_cancel_reissue_and_furniture_sales_preserve_valid_claims() {
    let (mut sim, people, fridge, counter, table) = household();
    add_dishes(sim.world_mut(), counter.index_u32(), 0, 2);
    assert!(start_cleanup(sim.world_mut(), people[0], vec![0], true));
    add_dishes(sim.world_mut(), table.index_u32(), 1, 1);
    directed_cleanup(sim.world_mut(), people[0]);
    assert_eq!(sim.world().resource::<SavedDomestic>().cleanup.len(), 1);
    assert_eq!(
        sim.world().resource::<SavedDomestic>().cleanup[0]
            .dishes
            .len(),
        2
    );
    assert!(matches!(
        crate::placement::sale::validate_sale(sim.world(), counter.index_u32()),
        Err(crate::placement::PlacementRefusal::InUse)
    ));
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: people[0].index_u32(),
            object: fridge.index_u32(),
            interaction: 0,
        });
    sim.flush_commands();
    // Intent serving happens during a tick; paused Clear orders removes the chore now.
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: people[0].index_u32(),
        });
    sim.flush_commands();
    assert!(sim.world().resource::<SavedDomestic>().cleanup.is_empty());
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(loaded.world_hash(), sim.world_hash());
    let sink = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| {
            sim.world().resource::<Content>().0.object(object.0).id == "kitchen_sink"
        })
        .unwrap()
        .0;
    assert!(crate::placement::sale::validate_sale(sim.world(), sink.index_u32()).is_ok());
}

#[test]
fn interrupting_a_collected_cleanup_frees_the_hands_and_preserves_the_dishes() {
    let (mut sim, people, _, counter, _) = household();
    for person in &people {
        *sim.world_mut().get_mut::<Needs>(*person).unwrap() = Needs::all_at(100.0);
    }
    add_dishes(sim.world_mut(), counter.index_u32(), 0, 2);
    assert!(start_cleanup(sim.world_mut(), people[0], vec![0], true));
    for _ in 0..300 {
        sim.tick();
        if carried_dishes(sim.world()).get(&people[0].index_u32()) == Some(&2) {
            break;
        }
    }
    assert_eq!(
        carried_dishes(sim.world()).get(&people[0].index_u32()),
        Some(&2)
    );
    let bed = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| sim.world().resource::<Content>().0.object(object.0).id == "bed")
        .unwrap()
        .0;
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: people[0].index_u32(),
            object: bed.index_u32(),
            interaction: 0,
        });
    sim.tick();
    sim.sync_render_buffer();
    assert_eq!(
        carried_dishes(sim.world()).get(&people[0].index_u32()),
        Some(&0)
    );
    assert_eq!(sim.world().get::<ChainState>(people[0]).unwrap().step, 0);
    assert_eq!(surface_items(sim.world()), vec![counter.index_u32(), 2, 0]);
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(loaded.world_hash(), sim.world_hash());
    assert_eq!(
        loaded.render_buffer().carried_dishes,
        sim.render_buffer().carried_dishes
    );
}

#[test]
fn selling_the_unused_last_sink_releases_pending_cleanup_and_keeps_attributed_mess() {
    let (mut sim, people, _, counter, _) = household();
    add_dishes(sim.world_mut(), counter.index_u32(), 0, 3);
    assert!(start_cleanup(sim.world_mut(), people[0], vec![0], true));
    let sink = sim
        .world_mut()
        .query::<(Entity, &SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| {
            sim.world().resource::<Content>().0.object(object.0).id == "kitchen_sink"
        })
        .unwrap()
        .0;
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SellObject {
            object: sink.index_u32(),
        });
    sim.flush_commands();
    assert!(sim.world().get_entity(sink).is_err());
    sim.tick();
    let state = sim.world().resource::<SavedDomestic>();
    assert!(state.cleanup.is_empty());
    assert_eq!(state.dishes[0].surface, counter.index_u32());
    assert_eq!(state.dishes[0].owner, 0);
    assert_eq!(state.dishes[0].units, 3);
    assert!(sim.world().get::<ChainState>(people[0]).is_none());
    let mut restored = Sim::new_from_shipped_lot();
    restored.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(restored.world_hash(), sim.world_hash());
}

#[test]
fn a_shared_meal_feeds_only_three_hungry_friends_at_distinct_table_positions() {
    let (mut sim, _, _, counter, table) = household();
    for index in 3..5 {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::AddHousemate {
                name: format!("Guest {index}"),
                personality: 1,
                traits: vec![],
            });
        sim.flush_commands();
    }
    let mut people: Vec<Entity> = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .map(|(e, id)| (id.0, e))
        .collect::<Vec<_>>()
        .into_iter()
        .map(|(_, e)| e)
        .collect();
    people.sort_by_key(|e| sim.world().get::<SimId>(*e).unwrap().0);
    for (index, person) in people.iter().enumerate() {
        sim.world_mut()
            .entity_mut(*person)
            .remove::<Path>()
            .remove::<terri_core::Career>();
        sim.world_mut()
            .get_mut::<Personality>(*person)
            .unwrap()
            .drain = [0.0; 7];
        *sim.world_mut().get_mut::<Needs>(*person).unwrap() = Needs::all_at(100.0);
        sim.world_mut()
            .get_mut::<Needs>(*person)
            .unwrap()
            .set(NeedId::Hunger, 30.0);
        *sim.world_mut().get_mut::<Position>(*person).unwrap() = Position {
            x: 7.0 + index as f32,
            y: 8.0,
        };
    }
    let mut feelings = Relationships::default();
    for id in 1..5 {
        feelings.bump(SimId(id), 0.8);
    }
    sim.world_mut().entity_mut(people[0]).insert(feelings);
    let mut content = sim.world().resource::<Content>().0.clone();
    content.tuning.domestic.as_mut().unwrap().own_cleanup_min = 0.0;
    content.tuning.domestic.as_mut().unwrap().own_cleanup_bonus = 0.0;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(content))));
    sim.world_mut().insert_resource(SavedDomestic::default());
    let chain = chain_index(sim.world(), "cook_dinner").unwrap();
    let food = sim
        .world()
        .resource::<Content>()
        .0
        .item_kinds
        .iter()
        .position(|item| item == "dinner")
        .unwrap() as u32;
    sim.world_mut().entity_mut(people[0]).insert((
        ChainState {
            chain,
            step: 5,
            fumble_scale: 1.0,
        },
        terri_core::Carrying(food),
    ));
    completed(sim.world_mut(), people[0], chain, 4, Some(counter));
    assert_eq!(
        sim.world().resource::<SavedDomestic>().meals[0].guests,
        vec![1, 2, 3]
    );
    bind_table(sim.world_mut(), people[0], table);
    sim.world_mut().entity_mut(people[4]).insert(AtWork {
        remaining_ticks: 10_000,
    });
    let mut shared_seen = BTreeSet::new();
    let mut simultaneous = 0;
    for _ in 0..1000 {
        sim.tick();
        let mut seats = BTreeSet::new();
        for person in &people[..4] {
            if sim
                .world()
                .get::<Target>(*person)
                .is_some_and(|target| target.object == table)
                && sim.world().get::<StepWork>(*person).is_some()
            {
                let pos = sim.world().get::<Position>(*person).unwrap();
                assert!(
                    seats.insert((pos.x.to_bits(), pos.y.to_bits())),
                    "diners have distinct seats"
                );
                shared_seen.insert(sim.world().get::<SimId>(*person).unwrap().0);
            }
        }
        if seats.len() == 4
            && sim
                .world()
                .resource::<SavedDomestic>()
                .meals
                .iter()
                .any(|meal| meal.dining_started)
        {
            simultaneous += 1;
        }
        let mut loaded = Sim::new_from_shipped_lot();
        loaded
            .world_mut()
            .insert_resource(*sim.world().resource::<Content>());
        loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
        assert_eq!(loaded.world_hash(), sim.world_hash());
        if sim.world().resource::<SavedDomestic>().meals.is_empty() {
            break;
        }
    }
    assert!(simultaneous >= 30 && shared_seen == BTreeSet::from([0, 1, 2, 3]), "all invited guests eat with company for a full interval: seen={shared_seen:?}, overlap={simultaneous}, state={:?}, people={:?}",
        sim.world().resource::<SavedDomestic>(), people.iter().map(|e| (*e, sim.world().get::<Position>(*e), sim.world().get::<ChainState>(*e), sim.world().get::<Target>(*e), sim.world().get::<Needs>(*e))).collect::<Vec<_>>());
    for person in &people[..4] {
        assert!(
            sim.world()
                .get::<Needs>(*person)
                .unwrap()
                .get(NeedId::Hunger)
                > 70.0
        );
    }
    assert_eq!(
        sim.world()
            .get::<Needs>(people[4])
            .unwrap()
            .get(NeedId::Hunger),
        30.0
    );
}

#[test]
fn malformed_domestic_claims_are_rejected_without_replacing_the_live_world() {
    let (mut sim, people, _, counter, _) = household();
    add_dishes(sim.world_mut(), counter.index_u32(), 0, 3);
    start_cleanup(sim.world_mut(), people[0], vec![0], true);
    let before = sim.save_snapshot_v5();
    for kind in 0..4 {
        let mut invalid = before.clone();
        match kind {
            0 => invalid.domestic = None,
            1 => invalid.domestic.as_mut().unwrap().cleanup[0].dishes.push(0),
            2 => invalid.domestic.as_mut().unwrap().cleanup[0].person = people[1].index_u32(),
            _ => invalid.domestic.as_mut().unwrap().dishes[0].surface = people[0].index_u32(),
        }
        assert!(sim.load_snapshot_v5(invalid).is_err());
        assert_eq!(sim.save_snapshot_v5(), before);
    }
    let mut shared = before.clone();
    let guest = shared
        .world
        .entities
        .iter_mut()
        .find(|entity| entity.index == people[1].index_u32())
        .unwrap();
    guest.chain = Some(terri_core::save::SavedChainState {
        chain: SHARED.into(),
        step: 1,
        fumble_scale: 1.0,
    });
    assert!(
        sim.load_snapshot_v5(shared).is_err(),
        "an eat counter does not mint food without a real claim"
    );
}

fn plate_with_guests_finishing_their_activity() -> (Sim, Vec<Entity>, Entity) {
    let (mut sim, people, fridge, _, table) = household();
    for person in &people {
        *sim.world_mut().get_mut::<Needs>(*person).unwrap() = Needs::all_at(100.0);
    }
    let mut feelings = Relationships::default();
    feelings.bump(SimId(1), 0.8);
    feelings.bump(SimId(2), 0.8);
    sim.world_mut().entity_mut(people[0]).insert(feelings);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: people[0].index_u32(),
            object: fridge.index_u32(),
            interaction: 1,
        });
    let mut ready = false;
    for _ in 0..1500 {
        sim.tick();
        if sim
            .world()
            .get::<ChainState>(people[0])
            .is_some_and(|chain| chain.step == 4)
            && sim
                .world()
                .get::<StepWork>(people[0])
                .is_some_and(|work| work.remaining_ticks == 1)
        {
            ready = true;
            break;
        }
    }
    assert!(ready);
    for person in &people[1..] {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::CancelIntents {
                agent: person.index_u32(),
            });
    }
    sim.flush_commands();
    for (person, station_id) in people[1..].iter().zip(["bed", "television"]) {
        let (station, object) = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .find(|(_, object)| {
                sim.world().resource::<Content>().0.object(object.0).id == station_id
            })
            .map(|(station, object)| (station, object.0))
            .unwrap();
        sim.world_mut()
            .get_mut::<Needs>(*person)
            .unwrap()
            .set(NeedId::Hunger, 30.0);
        sim.world_mut()
            .entity_mut(*person)
            .remove::<Path>()
            .insert((
                Target {
                    object: station,
                    interaction: 0,
                },
                Eating {
                    object,
                    interaction: 0,
                    remaining_ticks: 1,
                },
            ));
        sim.world_mut().entity_mut(station).insert(Reserved);
    }
    sim.tick();
    let state = sim.world().resource::<SavedDomestic>();
    assert_eq!(state.meals.len(), 1);
    assert_eq!(state.meals[0].guests, vec![1, 2]);
    assert_eq!(state.meals[0].table, None);
    assert!(people[1..].iter().all(|person| idle(sim.world(), *person)));
    (sim, people, table)
}

#[test]
fn plating_hands_idle_guests_to_shared_food_before_ordinary_autonomy() {
    let (mut sim, people, table) = plate_with_guests_finishing_their_activity();
    sim.tick();
    for guest in &people[1..] {
        let chain = sim.world().get::<ChainState>(*guest).unwrap();
        assert_eq!(
            sim.world().resource::<Content>().0.chains[chain.chain as usize].id,
            SHARED
        );
    }
    assert_eq!(
        sim.world().resource::<SavedDomestic>().meals[0].table,
        Some(table.index_u32())
    );
    for _ in 0..500 {
        sim.tick();
    }
    for guest in &people[1..] {
        assert!(
            sim.world()
                .get::<Needs>(*guest)
                .unwrap()
                .get(NeedId::Hunger)
                > 70.0
        );
    }
    assert!(sim.world().resource::<SavedDomestic>().meals.is_empty());
}

fn gathering_household() -> (Sim, Vec<Entity>, Entity) {
    let (mut sim, people, table) = plate_with_guests_finishing_their_activity();
    for _ in 0..200 {
        sim.tick();
        if sim.world().get::<StepWork>(people[0]).is_some() {
            assert!(!sim.world().resource::<SavedDomestic>().meals[0].dining_started);
            return (sim, people, table);
        }
    }
    panic!("cook never reached the gathering table");
}

#[test]
fn gathering_preserves_the_full_eating_interval_and_replays_after_loading() {
    let (mut sim, people, _) = gathering_household();
    let remaining = sim
        .world()
        .get::<StepWork>(people[0])
        .unwrap()
        .remaining_ticks;
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    let mut gathering_ticks = 0;
    let mut began = false;
    for _ in 0..350 {
        sim.tick();
        loaded.tick();
        assert_eq!(sim.world_hash(), loaded.world_hash());
        let state = sim.world().resource::<SavedDomestic>();
        if state.meals.is_empty() {
            break;
        }
        if !state.meals[0].dining_started {
            gathering_ticks += 1;
            assert_eq!(
                sim.world()
                    .get::<StepWork>(people[0])
                    .unwrap()
                    .remaining_ticks,
                remaining
            );
        } else if !began {
            began = true;
            assert_eq!(
                sim.world()
                    .get::<StepWork>(people[0])
                    .unwrap()
                    .remaining_ticks,
                remaining - 1
            );
            assert!(people
                .iter()
                .all(|person| sim.world().get::<StepWork>(*person).is_some()));
        }
    }
    assert!(gathering_ticks > 10 && began);
    assert!(sim.world().resource::<SavedDomestic>().meals.is_empty());
}

#[test]
fn gathering_yields_to_critical_needs_player_interruptions_and_table_capacity() {
    let (sim, people, table) = gathering_household();
    let saved = sim.save_snapshot_v5();
    for case in 0..4 {
        let mut changed = Sim::new_from_shipped_lot();
        changed.load_snapshot_v5(saved.clone()).unwrap();
        match case {
            0 => changed
                .world_mut()
                .get_mut::<Needs>(people[0])
                .unwrap()
                .set(NeedId::Energy, 0.0),
            1 => {
                // Paused non-food orders take precedence; neither guest is required to arrive.
                for guest in &people[1..] {
                    changed.world_mut().entity_mut(*guest).insert(Target {
                        object: table,
                        interaction: 0,
                    });
                }
            }
            2 => {
                // Three committed diners cannot all fit while two other diners own seats.
                for id in 10..12 {
                    changed.world_mut().spawn((
                        SimId(id),
                        Target {
                            object: table,
                            interaction: crate::systems::chain::CHAIN_STEP,
                        },
                    ));
                }
            }
            _ => {
                // Walls can legally leave only two approaches to a dining table.
                let position = *changed.world().get::<Position>(table).unwrap();
                let origin = (position.x.round() as i32, position.y.round() as i32);
                let object = changed.world().get::<SmartObject>(table).unwrap();
                let footprint = crate::placed_footprint(
                    changed.world().resource::<Content>().0,
                    object.0,
                    changed.world().get::<terri_core::ObjectFacing>(table),
                );
                let cook_at = changed.world().get::<Position>(people[0]).unwrap();
                let cook_seat = (cook_at.x.round() as i32, cook_at.y.round() as i32);
                let grid = changed.world_mut().resource_mut::<TileGrid>().into_inner();
                let mut seats: Vec<_> = (origin.1 - 1..=origin.1 + footprint.depth as i32)
                    .flat_map(|y| {
                        (origin.0 - 1..=origin.0 + footprint.width as i32).map(move |x| (x, y))
                    })
                    .filter(|seat| grid.can_interact_with_rect(*seat, origin, footprint))
                    .collect();
                seats.sort_by_key(|seat| *seat != cook_seat);
                for seat in seats.into_iter().skip(2) {
                    let contact = (
                        seat.0
                            .clamp(origin.0, origin.0 + footprint.width as i32 - 1),
                        seat.1
                            .clamp(origin.1, origin.1 + footprint.depth as i32 - 1),
                    );
                    grid.set_edge_blocked(seat, contact, true);
                }
                assert_eq!(dining_capacity(changed.world(), table.index_u32()), 2);
            }
        }
        gather_diners(changed.world_mut());
        assert!(
            changed.world().resource::<SavedDomestic>().meals[0].dining_started,
            "gathering releases in case {case}"
        );
        // Gathering cannot restart when the excluding condition goes away.
        gather_diners(changed.world_mut());
        assert!(changed.world().resource::<SavedDomestic>().meals[0].dining_started);
    }
}

#[test]
fn a_guest_keeps_its_portion_while_tables_are_busy_and_can_dine_without_the_cook() {
    let (mut sim, people, table) = plate_with_guests_finishing_their_activity();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: people[0].index_u32(),
        });
    sim.flush_commands();
    sim.world_mut().entity_mut(table).insert(Reserved);
    for _ in 0..180 {
        sim.tick();
    }
    let state = sim.world().resource::<SavedDomestic>();
    assert_eq!(state.meals[0].table, None);
    assert_eq!(state.meals[0].collected.len(), 2);
    for guest in &people[1..] {
        assert_eq!(sim.world().get::<ChainState>(*guest).unwrap().step, 1);
        assert!(sim.world().get::<terri_core::Carrying>(*guest).is_some());
    }
    let mut restored = Sim::new_from_shipped_lot();
    restored.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(restored.world_hash(), sim.world_hash());
    sim.world_mut().entity_mut(table).remove::<Reserved>();
    for _ in 0..500 {
        sim.tick();
    }
    assert!(sim.world().resource::<SavedDomestic>().meals.is_empty());
    for guest in &people[1..] {
        assert!(
            sim.world()
                .get::<Needs>(*guest)
                .unwrap()
                .get(NeedId::Hunger)
                > 70.0
        );
    }
}

#[test]
fn prepared_food_does_not_replace_player_orders_or_critical_rest() {
    let (mut sim, people, _) = plate_with_guests_finishing_their_activity();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObjectFirst {
            agent: people[1].index_u32(),
            object: 0,
            interaction: 0,
        });
    sim.world_mut()
        .get_mut::<Needs>(people[2])
        .unwrap()
        .set(NeedId::Energy, 0.0);
    sim.tick();
    let chain = sim.world().get::<ChainState>(people[1]).unwrap();
    assert_eq!(
        sim.world().resource::<Content>().0.chains[chain.chain as usize].id,
        SNACK
    );
    assert!(sim.world().resource::<SavedDomestic>().meals[0]
        .claimed
        .is_empty());
    sim.tick();
    let chain = sim.world().get::<ChainState>(people[1]).unwrap();
    assert_eq!(
        sim.world().resource::<Content>().0.chains[chain.chain as usize].id,
        SNACK
    );
}

#[test]
fn a_later_solo_meal_does_not_inherit_an_older_shared_table() {
    let (mut sim, people, _, counter, table) = household();
    let chain = chain_index(sim.world(), "cook_dinner").unwrap();
    let state = SavedDomestic {
        meals: vec![SavedMeal {
            cook: 0,
            counter: counter.index_u32(),
            table: Some(table.index_u32()),
            guests: vec![1],
            claimed: vec![],
            collected: vec![],
            eaten: vec![],
            scale: 1.0,
            tick: 0,
            dining_started: false,
        }],
        serving_meals: vec![(0, 0)],
        ..Default::default()
    };
    sim.world_mut().insert_resource(state);
    // A new solo meal has no guests, while the earlier portion remains available.
    completed(sim.world_mut(), people[0], chain, 4, Some(counter));
    let state = sim.world().resource::<SavedDomestic>();
    assert!(state.serving_meals.is_empty());
    assert_eq!(
        step_station(
            state,
            people[0].index_u32(),
            Some(SimId(0)),
            "cook_dinner",
            5
        ),
        None
    );
    assert_eq!(state.meals[0].table, Some(table.index_u32()));
}

#[test]
fn table_binding_changes_only_the_current_cooks_batch_or_active_guests_plate() {
    let mut old = SavedMeal {
        cook: 0,
        counter: 1,
        table: None,
        guests: vec![1, 2],
        claimed: vec![1],
        collected: vec![],
        eaten: vec![1],
        scale: 1.0,
        tick: 1,
        dining_started: false,
    };
    let mut current = old.clone();
    current.tick = 2;
    current.guests = vec![1];
    current.eaten.clear();
    let mut state = SavedDomestic {
        meals: vec![old.clone(), current.clone()],
        serving_meals: vec![(0, 2)],
        ..Default::default()
    };
    bind_meal_table(&mut state, SimId(0), 7, "cook_dinner");
    assert_eq!(state.meals[0], old);
    assert_eq!(state.meals[1].table, Some(7));
    state.meals[1].table = None;
    bind_meal_table(&mut state, SimId(1), 8, SHARED);
    assert_eq!(state.meals[0], old);
    assert_eq!(state.meals[1].table, Some(8));
    old.table = Some(9);
    state.meals[0] = old;
    assert_eq!(
        step_station(&state, 34, Some(SimId(0)), "cook_dinner", 5),
        Some(8)
    );
    // Cancelling the cook removes only its association; the guest keeps the batch.
    state.serving_meals.clear();
    assert_eq!(
        step_station(&state, 34, Some(SimId(0)), "cook_dinner", 5),
        None
    );
    assert_eq!(step_station(&state, 35, Some(SimId(1)), SHARED, 1), Some(8));
}

#[test]
fn current_meal_identity_survives_saves_and_rejects_invalid_references() {
    let (mut sim, people, _) = plate_with_guests_finishing_their_activity();
    let saved = sim.save_snapshot_v5();
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v5(saved.clone()).unwrap();
    assert_eq!(loaded.world_hash(), sim.world_hash());
    for case in 0..4 {
        let mut bad = saved.clone();
        let serving = &mut bad.domestic.as_mut().unwrap().serving_meals;
        match case {
            0 => serving[0].1 += 1,
            1 => serving.push(serving[0]),
            2 => serving[0].0 = 1,
            _ => {
                let meals = &mut bad.domestic.as_mut().unwrap().meals;
                let mut duplicate = meals[0].clone();
                meals[0].guests = vec![1];
                duplicate.guests = vec![2];
                meals.push(duplicate);
            }
        }
        assert_eq!(loaded.load_snapshot_v5(bad), Err(SaveError::InvalidValue));
        assert_eq!(loaded.world_hash(), sim.world_hash());
    }
    sim.tick();
    let assigned = sim.save_snapshot_v5();
    loaded.load_snapshot_v5(assigned.clone()).unwrap();
    assert_eq!(loaded.world_hash(), sim.world_hash());
    assert_eq!(
        sim.world().get::<Target>(people[0]).unwrap().interaction,
        crate::systems::chain::CHAIN_STEP
    );
    let mut bad = assigned;
    bad.domestic.as_mut().unwrap().meals[0].table = None;
    assert_eq!(loaded.load_snapshot_v5(bad), Err(SaveError::InvalidValue));
    assert_eq!(loaded.world_hash(), sim.world_hash());
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: people[0].index_u32(),
        });
    sim.flush_commands();
    assert!(sim
        .world()
        .resource::<SavedDomestic>()
        .serving_meals
        .is_empty());
    loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(loaded.world_hash(), sim.world_hash());
}

#[test]
fn abandoned_shared_plate_becomes_a_counter_dish_and_reservation_has_multiple_owners() {
    let (mut sim, people, _, counter, table) = household();
    sim.world_mut().insert_resource(SavedDomestic {
        meals: vec![SavedMeal {
            cook: 0,
            counter: counter.index_u32(),
            table: Some(table.index_u32()),
            guests: vec![1],
            claimed: vec![1],
            collected: vec![],
            eaten: vec![],
            scale: 0.25,
            tick: 0,
            dining_started: false,
        }],
        ..Default::default()
    });
    tick(sim.world_mut());
    let state = sim.world().resource::<SavedDomestic>();
    assert!(state.meals.is_empty());
    assert!(state
        .dishes
        .iter()
        .any(|dish| dish.surface == counter.index_u32() && dish.owner == 1));
    sim.world_mut().entity_mut(table).insert(Reserved);
    for person in &people[..2] {
        sim.world_mut().entity_mut(*person).insert(Target {
            object: table,
            interaction: crate::systems::chain::CHAIN_STEP,
        });
    }
    crate::reservations::release_now(
        sim.world_mut(),
        people[0],
        terri_core::Target {
            object: table,
            interaction: crate::systems::chain::CHAIN_STEP,
        },
    );
    assert!(sim.world().get::<Reserved>(table).is_some());
    sim.world_mut().entity_mut(people[0]).remove::<Target>();
    crate::reservations::release_now(
        sim.world_mut(),
        people[1],
        terri_core::Target {
            object: table,
            interaction: crate::systems::chain::CHAIN_STEP,
        },
    );
    assert!(sim.world().get::<Reserved>(table).is_none());
}

#[test]
fn a_visitor_draws_once_per_entry_at_one_fifth_of_own_willingness() {
    let (mut sim, people, _, counter, _) = household();
    let observer = people[1];
    for person in &people {
        *sim.world_mut().get_mut::<Needs>(*person).unwrap() = Needs::all_at(100.0);
        sim.world_mut()
            .entity_mut(*person)
            .insert(ChainState::begin(0));
    }
    *sim.world_mut().get_mut::<Position>(observer).unwrap() =
        *sim.world().get::<Position>(counter).unwrap();
    add_dishes(sim.world_mut(), counter.index_u32(), 0, 3);
    let mut decisions = 0;
    for seed in 0..200 {
        sim.world_mut().entity_mut(observer).remove::<ChainState>();
        let state = sim.world_mut().resource_mut::<SavedDomestic>().into_inner();
        state.cleanup.clear();
        state.visits.clear();
        state.cleanliness = people
            .iter()
            .map(|person| (person.index_u32(), 1.0))
            .collect();
        let mut expected = SimRng::from_seed(seed);
        let accepted = expected.next_f32() < 0.18;
        sim.world_mut().insert_resource(SimRng::from_seed(seed));
        tick(sim.world_mut());
        assert_eq!(
            !sim.world().resource::<SavedDomestic>().cleanup.is_empty(),
            accepted
        );
        assert_eq!(
            *sim.world().resource::<SimRng>(),
            expected,
            "one entry consumes exactly one draw"
        );
        tick(sim.world_mut());
        assert_eq!(
            *sim.world().resource::<SimRng>(),
            expected,
            "remaining in the room does not roll again"
        );
        decisions += usize::from(accepted);
    }
    assert!(decisions > 0 && decisions < 200);
}

#[test]
fn the_hash_observes_domestic_identity_memory_claims_and_quality() {
    let (mut sim, people, _, counter, table) = household();
    let state = SavedDomestic {
        cleanliness: vec![(people[0].index_u32(), 0.6)],
        dishes: vec![SavedDishes {
            id: 0,
            surface: counter.index_u32(),
            owner: 0,
            units: 3,
        }],
        visits: vec![SavedRoomVisit {
            person: people[1].index_u32(),
            room: 0,
            seen: vec![0],
        }],
        cleanup: vec![SavedCleanup {
            person: people[0].index_u32(),
            dishes: vec![0],
            collected: vec![],
            directed: true,
        }],
        meals: vec![SavedMeal {
            cook: 0,
            counter: counter.index_u32(),
            table: Some(table.index_u32()),
            guests: vec![1, 2],
            claimed: vec![1],
            collected: vec![],
            eaten: vec![],
            scale: 1.0,
            tick: 0,
            dining_started: false,
        }],
        next_dish: 1,
        serving_meals: vec![(0, 0)],
    };
    sim.world_mut().insert_resource(state.clone());
    let baseline = sim.world_hash();
    for field in 0..19 {
        let mut changed = state.clone();
        match field {
            0 => changed.cleanliness[0].1 = 0.7,
            1 => changed.dishes[0].owner = 1,
            2 => changed.dishes[0].surface = table.index_u32(),
            3 => changed.dishes[0].units = 2,
            4 => changed.next_dish += 1,
            5 => changed.visits[0].room = 1,
            6 => changed.visits[0].seen.clear(),
            7 => changed.cleanup[0].collected.push(0),
            8 => changed.cleanup[0].directed = false,
            9 => changed.meals[0].scale = 0.25,
            10 => changed.meals[0].tick = 1,
            11 => changed.meals[0].claimed.push(2),
            12 => changed.meals[0].eaten.push(1),
            13 => changed.meals[0].collected.push(1),
            14 => changed.meals[0].table = None,
            15 => changed.serving_meals.clear(),
            16 => changed.serving_meals[0].0 = 1,
            17 => changed.serving_meals[0].1 = 1,
            _ => changed.meals[0].dining_started = true,
        }
        sim.world_mut().insert_resource(changed);
        assert_ne!(
            baseline,
            sim.world_hash(),
            "hash observes domestic field {field}"
        );
        sim.world_mut().insert_resource(state.clone());
        assert_eq!(baseline, sim.world_hash());
    }
}
