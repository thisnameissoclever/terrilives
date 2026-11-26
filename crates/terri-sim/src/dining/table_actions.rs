use super::*;

/// The meal table's plain sitting action. A pack can list a table's actions
/// in any order, so it is found by its id and never by its position.
pub(crate) const SIT_PROPERLY: &str = "sit_properly";

/// The dining table's Eat prepared food action, also found by its id.
pub(crate) const TAKE_PREPARED_FOOD: &str = "take_prepared_food";

/// Whether `interaction` is the dining table's sitting action.
pub(crate) fn is_table_sit(object: &terri_data::CompiledObject, interaction: u32) -> bool {
    object.id == "dining_table"
        && object
            .interactions
            .get(interaction as usize)
            .is_some_and(|action| action.id == SIT_PROPERLY)
}

/// Whether `interaction` is the dining table's Eat prepared food action. A
/// historical table lists only sitting and addresses the managed meal at
/// position 1, past its authored actions.
pub(crate) fn is_table_meal(object: &terri_data::CompiledObject, interaction: u32) -> bool {
    if object.id != "dining_table" {
        return false;
    }
    match object.interactions.get(interaction as usize) {
        Some(action) => action.id == TAKE_PREPARED_FOOD,
        None => {
            interaction == 1
                && object.interactions.len() == 1
                && object.interactions[0].id == SIT_PROPERLY
        }
    }
}

pub(crate) fn ordinary_sitting(world: &World, person: Entity) -> Option<Entity> {
    let target = world.get::<Target>(person)?;
    let object = world.get::<SmartObject>(target.object)?;
    let action = world
        .resource::<Content>()
        .0
        .object(object.0)
        .interactions
        .get(target.interaction as usize)?;
    (action.id == SIT_PROPERLY && role(world, target.object, "meal_table")).then_some(target.object)
}

fn chairs(world: &World, table: Entity) -> Vec<Entity> {
    let Some(mut objects) = world.try_query::<(Entity, &SmartObject)>() else {
        return vec![];
    };
    let mut chairs: Vec<_> = objects
        .iter(world)
        .filter(|(e, _)| setting_for(world, table, *e).is_some())
        .map(|(e, _)| e)
        .collect();
    chairs.sort_by_key(|e| e.index_u32());
    chairs
}

pub(crate) fn table_actions(
    world: &World,
    table: u32,
    person: Option<u32>,
) -> Option<(bool, bool)> {
    let table = entity(world, table).filter(|e| role(world, *e, "meal_table"))?;
    let sit = !chairs(world, table).is_empty();
    let eat = person
        .and_then(|id| entity(world, id))
        .and_then(|e| world.get::<SimId>(e))
        .is_some_and(|id| meal_index(world, *id, table.index_u32()).is_some());
    Some((sit, eat))
}

fn meal_index(world: &World, person: SimId, table: u32) -> Option<usize> {
    world
        .get_resource::<SavedDomestic>()?
        .meals
        .iter()
        .position(|m| {
            m.table.is_none_or(|id| id == table)
                && m.guests.contains(&person.0)
                && !m.claimed.contains(&person.0)
                && !m.eaten.contains(&person.0)
        })
}

pub(crate) fn take_prepared_food(world: &mut World, person: Entity, table: Entity) -> bool {
    if world
        .get::<crate::reading::ReadingJourney>(person)
        .is_some()
    {
        crate::reading::request_return(world, person);
        return false;
    }
    if !role(world, table, "meal_table") {
        return false;
    }
    let Some(id) = world.get::<SimId>(person).copied() else {
        return false;
    };
    if meal_index(world, id, table.index_u32()).is_none() {
        return false;
    }
    let Some(chain) = world
        .resource::<Content>()
        .0
        .chains
        .iter()
        .position(|c| c.id == crate::domestic::SHARED)
    else {
        return false;
    };
    crate::domestic::abandon(world, person);
    let Some(at) = meal_index(world, id, table.index_u32()) else {
        return false;
    };
    let scale = {
        let mut state = world.resource_mut::<SavedDomestic>();
        let meal = &mut state.meals[at];
        meal.claimed.push(id.0);
        meal.table = Some(table.index_u32());
        meal.scale
    };
    if let Some(target) = world.get::<Target>(person).copied() {
        crate::reservations::release_now(world, person, target);
    }
    let (mut progress, origin, activity) =
        crate::recipe_actions::internal(world.resource::<Content>().0, chain as u32);
    progress.fumble_scale = scale;
    world
        .resource_mut::<crate::privacy::BoundaryDecisions>()
        .0
        .entry(id.0)
        .or_insert(SavedBoundaryDecision {
            actor: id.0,
            expires: 0,
            lapse: false,
            waiting_since: None,
            goal: None,
            directed_chain: None,
        })
        .directed_chain = Some(chain as u32);
    world
        .entity_mut(person)
        .remove::<Target>()
        .remove::<Path>()
        .remove::<Eating>()
        .remove::<Socialising>()
        .remove::<StepWork>()
        .remove::<terri_core::Carrying>()
        .remove::<crate::recipe_actions::RecipeOrder>()
        .insert((progress, origin, activity));
    true
}

pub(super) fn route_sitting(world: &mut World) {
    maintain(world);
    let people: Vec<_> = world
        .query::<(Entity, &Target)>()
        .iter(world)
        .filter(|(e, _)| ordinary_sitting(world, *e).is_some())
        .map(|(e, t)| (e, *t))
        .collect();
    for (person, target) in people {
        if claim(world, person.index_u32()).is_some() {
            continue;
        }
        let available = chairs(world, target.object);
        let Some(pos) = world.get::<Position>(person).copied() else {
            continue;
        };
        let occupancy = crate::seating::occupancy(world);
        let grid = world.resource::<TileGrid>();
        let from = (pos.x.round() as i32, pos.y.round() as i32);
        let mut choices = vec![];
        for chair in &available {
            if !occupancy.seat_available(person, *chair, 0)
                || world.get::<Reserved>(*chair).is_some()
                || world
                    .resource::<SavedDining>()
                    .diners
                    .iter()
                    .any(|d| d.chair == Some(chair.index_u32()))
            {
                continue;
            }
            let setting = setting_for(world, target.object, *chair).unwrap().0;
            for endpoint in chair_approaches(world, *chair) {
                if !occupancy.endpoint_available(crate::seating::EndpointUse {
                    owner: person,
                    endpoint,
                    kind: crate::seating::UseKind::TableSeat,
                }) || world
                    .resource::<SavedDining>()
                    .diners
                    .iter()
                    .any(|d| d.endpoint == endpoint)
                {
                    continue;
                }
                if let Some(path) = grid
                    .find_path(from, endpoint)
                    .and_then(|p| grid.anchor_path((pos.x, pos.y), p))
                {
                    choices.push((path.len(), chair.index_u32(), setting, endpoint, path));
                }
            }
        }
        choices.sort_by_key(|(length, chair, _, endpoint, _)| (*length, *chair, *endpoint));
        if let Some((_, chair, setting, endpoint, path)) = choices.into_iter().next() {
            world.resource_mut::<SavedDining>().diners.push(SavedDiner {
                person: person.index_u32(),
                station: target.object.index_u32(),
                chair: Some(chair),
                setting: Some(setting),
                endpoint,
                obstructing: vec![],
            });
            world
                .resource_mut::<SavedDining>()
                .diners
                .sort_by_key(|d| d.person);
            if let Some(chair_entity) = entity(world, chair) {
                if !world
                    .resource::<Content>()
                    .0
                    .object(world.get::<SmartObject>(chair_entity).unwrap().0)
                    .seats
                    .is_empty()
                {
                    crate::seating::install(world, person, chair_entity, 0, false);
                }
            }
            world.entity_mut(person).remove::<Eating>().insert(Path {
                steps: path,
                cursor: 0,
            });
        } else {
            crate::reservations::release_now(world, person, target);
            world
                .entity_mut(person)
                .remove::<Target>()
                .remove::<Path>()
                .remove::<Eating>();
            if available.is_empty() {
                if let Some(mut queue) = world.get_mut::<IntentQueue>(person) {
                    let intent = terri_core::Intent {
                        object: target.object,
                        interaction: 0,
                        cleanup: None,
                        chore: None,
                    };
                    queue.remove_first(intent);
                    crate::player_actions::terminal_matching(
                        world,
                        person,
                        intent,
                        "failed",
                        Some("No usable dining place remains"),
                    );
                }
            }
        }
    }
}

pub(super) fn projection(world: &World, person: Entity) -> Option<crate::SocketActionProjection> {
    ordinary_sitting(world, person)?;
    if world.get::<Eating>(person).is_none() || world.get::<Path>(person).is_some() {
        return None;
    }
    let diner = claim(world, person.index_u32())?;
    let chair = entity(world, diner.chair?)?;
    let pos = world.get::<Position>(chair)?;
    let axis = world
        .get::<ObjectFacing>(chair)
        .map_or(terri_core::Facing::SouthEast, |f| f.0)
        .rotate_axis(0, 1);
    Some(crate::SocketActionProjection {
        x: pos.x,
        y: pos.y,
        facing: match axis {
            (1, 0) => 1,
            (-1, 0) => 2,
            (0, 1) => 3,
            _ => 4,
        },
        target_entity: chair.index_u32(),
        visual_action: crate::render_buffer::visual_action::SIT,
        activity: crate::render_buffer::activity::SITTING,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use terri_core::{CommandQueue, NeedId, Needs, SimCommand};
    fn fixture() -> (crate::Sim, Entity, Entity) {
        let mut sim = crate::Sim::new_from_shipped_lot();
        let people: Vec<_> = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .collect();
        let person = people[0];
        for other in people.iter().skip(1) {
            sim.world_mut().entity_mut(*other).insert(AtWork {
                remaining_ticks: 10000,
            });
        }
        let table = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .find(|(_, o)| sim.world().resource::<Content>().0.object(o.0).id == "dining_table")
            .unwrap()
            .0;
        (sim, person, table)
    }
    /// A pack may list the table's actions in another order, as a reordered
    /// V6 restore does. Sitting is recognised by the action's id, so the
    /// table's other action is never read as sitting and sitting is never
    /// missed at its new position.
    #[test]
    fn ordinary_sitting_names_the_action_by_id_in_any_order() {
        let (mut sim, person, table) = fixture();
        let mut pack = terri_data::pack().clone();
        for object in &mut pack.objects {
            object.interactions.reverse();
        }
        let pack: &'static terri_data::ContentPack = Box::leak(Box::new(pack));
        sim.world_mut().insert_resource(Content(pack));
        let model = sim.world().get::<SmartObject>(table).unwrap().0;
        let actions = &pack.object(model).interactions;
        let sit = actions
            .iter()
            .position(|action| action.id == SIT_PROPERLY)
            .unwrap() as u32;
        assert_ne!(sit, 0, "the reversed pack moves sitting off index 0");
        for (interaction, expected) in [(sit, Some(table)), (1 - sit, None)] {
            sim.world_mut().entity_mut(person).insert(Target {
                object: table,
                interaction,
            });
            assert_eq!(
                ordinary_sitting(sim.world(), person),
                expected,
                "{}",
                actions[interaction as usize].id
            );
        }
    }

    /// The shipped household with every object's actions listed in reverse,
    /// so the table's Eat prepared food is at position 0 and sitting at 1.
    fn reversed_table() -> (crate::Sim, Entity, Entity, u32, u32) {
        let (mut sim, person, table) = fixture();
        let mut pack = terri_data::pack().clone();
        for object in &mut pack.objects {
            object.interactions.reverse();
        }
        let pack: &'static terri_data::ContentPack = Box::leak(Box::new(pack));
        sim.world_mut().insert_resource(Content(pack));
        let model = sim.world().get::<SmartObject>(table).unwrap().0;
        let position = |id: &str| {
            pack.object(model)
                .interactions
                .iter()
                .position(|action| action.id == id)
                .unwrap() as u32
        };
        let (sit, eat) = (position(SIT_PROPERLY), position(TAKE_PREPARED_FOOD));
        assert_eq!(
            (sit, eat),
            (1, 0),
            "the reversed pack swaps the table's actions"
        );
        (sim, person, table, sit, eat)
    }

    /// The reason the person's order failed with on the next tick, if it did.
    fn order_at_table(
        sim: &mut crate::Sim,
        person: Entity,
        table: Entity,
        interaction: u32,
    ) -> Option<String> {
        let since = sim.action_events_since(0).events.len();
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObjectFirst {
                agent: person.index_u32(),
                object: table.index_u32(),
                interaction,
            });
        sim.tick();
        sim.action_events_since(0).events[since..]
            .iter()
            .find(|event| event.phase == "failed")
            .map(|event| event.reason.clone().unwrap_or_default())
    }

    /// Serving an order at the table names its two actions by id. With the
    /// actions reversed, Eat prepared food at position 0 takes the meal path,
    /// and sitting at position 1 takes the chair path, never the meal's.
    #[test]
    fn serving_table_orders_names_sit_and_eat_by_id_in_any_order() {
        let (mut sim, person, table, sit, eat) = reversed_table();
        assert_eq!(
            order_at_table(&mut sim, person, table, eat).as_deref(),
            Some("Prepared food unavailable"),
            "nothing is prepared, so the eat order fails on the meal path"
        );
        assert_eq!(
            order_at_table(&mut sim, person, table, sit),
            None,
            "the table has chairs, so the sit order is served"
        );

        let (mut sim, person, table, sit, _) = reversed_table();
        for chair in chairs(sim.world(), table) {
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::SellObject {
                    object: chair.index_u32(),
                });
            sim.flush_commands();
        }
        assert_eq!(
            order_at_table(&mut sim, person, table, sit).as_deref(),
            Some("No usable dining chair"),
            "without chairs the sit order fails on the chair path"
        );
    }

    #[test]
    fn empty_table_offers_sitting_only_when_physical_chairs_exist() {
        let (mut sim, person, table) = fixture();
        assert_eq!(
            table_actions(sim.world(), table.index_u32(), Some(person.index_u32())),
            Some((true, false))
        );
        for chair in chairs(sim.world(), table) {
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::SellObject {
                    object: chair.index_u32(),
                });
            sim.flush_commands();
        }
        assert_eq!(
            table_actions(sim.world(), table.index_u32(), Some(person.index_u32())),
            Some((false, false))
        );
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObjectFirst {
                agent: person.index_u32(),
                object: table.index_u32(),
                interaction: 0,
            });
        sim.tick();
        assert_ne!(ordinary_sitting(sim.world(), person), Some(table));
    }
    #[test]
    fn ordinary_sitting_claims_a_real_chair_without_food_and_saves_at_each_tick() {
        for historical in [false, true] {
            let (mut sim, person, table) = fixture();
            if historical {
                // Choose the historical room namespace before any action or grime update.
                sim.world_mut()
                    .remove_resource::<terri_core::rooms::SavedRooms>();
                sim.world_mut().remove_resource::<crate::rooms::RoomMap>();
                sim.world_mut()
                    .insert_resource(crate::rooms::RoomReferenceMode::Legacy);
            }
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObjectFirst {
                    agent: person.index_u32(),
                    object: table.index_u32(),
                    interaction: 0,
                });
            let mut seated = false;
            for _ in 0..400 {
                sim.tick();
                let mut loaded = crate::Sim::new_from_shipped_lot();
                if historical {
                    let frozen = sim.save_snapshot_v6();
                    let original_reader = crate::save::v6::restore(
                        frozen.clone(),
                        sim.world().resource::<Content>().0,
                        crate::save::Carried::for_load(sim.world()),
                    )
                    .unwrap();
                    assert_eq!(original_reader.save_snapshot_v6(), frozen);
                    loaded.load_snapshot_v6(frozen).unwrap();
                    crate::test_content::assert_current_admission(&loaded);
                } else {
                    loaded.load_current_v6_view(sim.current_v6_view()).unwrap();
                    assert_eq!(loaded.current_v6_view(), sim.current_v6_view());
                    assert_eq!(loaded.world_hash(), sim.world_hash());
                }
                if let Some(p) = projection(sim.world(), person) {
                    assert!(chairs(sim.world(), table)
                        .iter()
                        .any(|c| c.index_u32() == p.target_entity));
                    assert_eq!(p.visual_action, crate::render_buffer::visual_action::SIT);
                    assert!(sim.world().get::<terri_core::Carrying>(person).is_none());
                    seated = true;
                }
                if seated && ordinary_sitting(sim.world(), person).is_none() {
                    break;
                }
            }
            assert!(seated);
        }
    }
    #[test]
    fn prepared_food_order_claims_a_real_portion_and_survives_queued_and_active_saves() {
        let (mut sim, cook, table) = fixture();
        let person = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .find(|e| *e != cook)
            .unwrap();
        sim.world_mut().entity_mut(person).remove::<AtWork>();
        sim.world_mut().entity_mut(cook).insert(AtWork {
            remaining_ticks: 10000,
        });
        let id = sim.world().get::<SimId>(person).unwrap().0;
        let owner = sim.world().get::<SimId>(cook).unwrap().0;
        let counter = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .find(|(_, o)| sim.world().resource::<Content>().0.object(o.0).id == "counter")
            .unwrap()
            .0;
        sim.world_mut().insert_resource(SavedDomestic {
            meals: vec![SavedMeal {
                cook: owner,
                counter: counter.index_u32(),
                table: Some(table.index_u32()),
                guests: vec![id],
                claimed: vec![],
                collected: vec![],
                eaten: vec![],
                scale: 1.0,
                tick: 0,
                dining_started: true,
            }],
            ..Default::default()
        });
        sim.world_mut()
            .get_mut::<Needs>(person)
            .unwrap()
            .set(NeedId::Hunger, 30.0);
        assert_eq!(
            table_actions(sim.world(), table.index_u32(), Some(person.index_u32())),
            Some((true, true))
        );
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObjectFirst {
                agent: person.index_u32(),
                object: table.index_u32(),
                interaction: 1,
            });
        sim.flush_commands();
        let mut loaded = crate::Sim::new_from_shipped_lot();
        loaded
            .load_current_v10_view(sim.current_v10_view())
            .unwrap();
        let mut carrying = false;
        let mut ate = false;
        for _ in 0..600 {
            sim.tick();
            carrying |= sim.world().get::<terri_core::Carrying>(person).is_some();
            loaded
                .load_current_v10_view(sim.current_v10_view())
                .unwrap();
            assert_eq!(loaded.current_v10_view(), sim.current_v10_view());
            assert_eq!(loaded.world_hash(), sim.world_hash());
            if carrying
                && sim
                    .world()
                    .get::<Needs>(person)
                    .unwrap()
                    .get(NeedId::Hunger)
                    > 50.0
            {
                ate = true;
                break;
            }
        }
        assert!(carrying && ate);
        assert!(
            !table_actions(sim.world(), table.index_u32(), Some(person.index_u32()))
                .unwrap()
                .1
        );
    }
}
