use super::*;
use crate::{
    recipe_actions::{Origin, SelectedUse},
    Content,
};
use terri_core::{
    command::{BookCommand, CharacterCommand},
    save_v6::ChainOrigin,
    Agent, ChainState, CommandQueue, Funds, Intent, IntentQueue, SimCommand, SimId, SmartObject,
};

#[test]
fn command_free_projection_rederives_metadata_and_retains_orders_and_origins() {
    let mut pack = terri_data::pack().clone();
    pack.lot
        .placements
        .retain(|p| pack.objects[p.object.0 as usize].id == "fridge");
    let mut chair = pack.object(pack.find("chair").unwrap()).clone();
    chair.id = "queued_chair".into();
    let chair_index = pack.objects.len() as u32;
    let chair_facing = chair.base_facing;
    pack.objects.push(chair);
    let mut used = pack.object(pack.find("fridge").unwrap()).clone();
    used.id = "used_recipe_fridge".into();
    pack.objects.push(used);
    let pack = Box::leak(Box::new(pack));
    let mut sim = Sim::new_from_lot_and_content(&pack.lot, Content(pack));
    let title = &pack.books[0];
    let purchase_cents = (i64::from(title.price)
        + i64::from(pack.objects[chair_index as usize].price.unwrap()))
        * Funds::CENTS_PER_DOLLAR;
    sim.world_mut().insert_resource(Funds(purchase_cents));
    sim.spawn_household(&pack.personalities, &pack.household[..1], &pack.traits);
    assert_eq!(
        restore(capture(&sim), pack, Carried::for_load(sim.world())).err(),
        None,
        "base fixture"
    );
    let person = sim
        .world_mut()
        .query_filtered::<terri_core::Entity, bevy_ecs::prelude::With<Agent>>()
        .single(sim.world())
        .unwrap();
    let person_id = sim.world().get::<SimId>(person).unwrap().0;
    let fridge = sim
        .world_mut()
        .query_filtered::<terri_core::Entity, bevy_ecs::prelude::With<SmartObject>>()
        .single(sim.world())
        .unwrap();
    let recipe = pack
        .chains
        .iter()
        .position(|c| c.id == "cook_dinner")
        .unwrap() as u32;
    sim.world_mut().entity_mut(person).insert((
        ChainState {
            chain: recipe,
            step: 1,
            fumble_scale: 1.0,
        },
        Origin(
            ChainOrigin::Action {
                model: "used_recipe_fridge".into(),
                action: "cook_dinner".into(),
                recipe: "cook_dinner".into(),
                selected_step: 0,
            },
            SelectedUse::Complete,
        ),
    ));
    assert_eq!(
        restore(capture(&sim), pack, Carried::for_load(sim.world())).err(),
        None,
        "recipe fixture"
    );
    sim.world_mut()
        .entity_mut(person)
        .insert(IntentQueue::default());
    sim.world_mut()
        .get_mut::<IntentQueue>(person)
        .unwrap()
        .push(Intent {
            object: fridge,
            interaction: 0,
            cleanup: None,
            chore: None,
        });
    for command in [
        SimCommand::BuyObject {
            definition: chair_index,
            x: 3,
            y: 3,
            facing: chair_facing,
        },
        SimCommand::Book(BookCommand::Purchase {
            title: title.id.clone(),
            shelf: None,
        }),
        SimCommand::Character(Box::new(CharacterCommand::Edit {
            request: 7,
            sim: person_id,
            patch: Default::default(),
        })),
        SimCommand::SetDeathEnabled(false),
    ] {
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
    }
    let original = capture(&sim);
    let restore_snapshot = |snapshot| restore(snapshot, pack, Carried::for_load(sim.world()));
    assert_eq!(
        restore_snapshot(original.clone()).err(),
        None,
        "queued source is valid"
    );
    let mut raw = original.clone();
    let ten = &mut raw.legacy.legacy.legacy.legacy.legacy.legacy;
    ten.command_order.clear();
    ten.legacy.command_order.clear();
    ten.legacy.legacy.world.queued_commands.clear();
    assert_eq!(
        restore_snapshot(raw).err(),
        Some(SaveError::InvalidContentReference)
    );

    let projected = capture_without_commands(&sim);
    let six = &projected.legacy.legacy.legacy.legacy.legacy.legacy.legacy;
    let old_six = &original.legacy.legacy.legacy.legacy.legacy.legacy.legacy;
    assert!(six
        .actions
        .objects
        .iter()
        .all(|o| o.model != "queued_chair"));
    assert!(six
        .actions
        .objects
        .iter()
        .any(|o| o.model == "used_recipe_fridge"));
    assert_eq!(six.chain_origins, old_six.chain_origins);
    assert!(!six.chain_origins.is_empty());
    assert_eq!(six.queues, old_six.queues);
    assert!(six.queues.iter().any(|q| !q.orders.is_empty()));
    let restored = restore_snapshot(projected.clone()).unwrap();
    assert!(restored.world().resource::<CommandQueue>().is_empty());
    assert_eq!(capture(&restored), projected);
    assert_eq!(
        capture(&sim),
        original,
        "projection must leave pending input intact"
    );
}
