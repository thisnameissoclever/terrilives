//! Tests for selling furniture - [SL-rules], [SL-pay] and [SL-despawn] in
//! `docs/specs/2026-09-22-selling-furniture.md`.

use super::*;
use crate::Sim;
use terri_core::layout::SavedLayout;
use terri_core::{Agent, CommandQueue, Intent, Position, SimCommand, SmartObject};
use terri_data::ContentPack;

/// A 7 by 7 open house with a fridge at (0, 0), a coat rack with no price at
/// (3, 3), a second fridge at (6, 6) so the first can be sold without leaving
/// Cook dinner without cold storage, the front door at (6, 3) and `funds` in
/// the bank. Returns the first fridge and the coat rack.
fn house(funds: i64) -> (Sim, Entity, Entity) {
    house_with(funds, |_| {})
}

/// [`house`], with `edit` applied to its content pack last.
fn house_with(funds: i64, edit: impl FnOnce(&mut ContentPack)) -> (Sim, Entity, Entity) {
    let mut pack = terri_data::pack().clone();
    pack.lot.width = 7;
    pack.lot.height = 7;
    pack.lot.wall_edges.clear();
    pack.lot.walls.clear();
    pack.lot.placements.clear();
    pack.lot.front_door = Some((6, 3));
    pack.portals[0].position = (6, 3);
    pack.portals[0].inward = (5, 3);
    let rack = pack.find("coat_rack").unwrap().0 as usize;
    pack.objects[rack].price = None;
    edit(&mut pack);
    let pack: &'static ContentPack = Box::leak(Box::new(pack));
    let mut sim = Sim::new_from_lot(&pack.lot, &pack.objects);
    sim.world_mut().insert_resource(Content(pack));
    let fridge = sim.spawn_object(Position { x: 0.0, y: 0.0 }, pack.find("fridge").unwrap());
    let rack = sim.spawn_object(Position { x: 3.0, y: 3.0 }, pack.find("coat_rack").unwrap());
    sim.spawn_object(Position { x: 6.0, y: 6.0 }, pack.find("fridge").unwrap());
    let mut grid = TileGrid::new(7, 7);
    grid.set_blocked(0, 0, true);
    grid.set_blocked(3, 3, true);
    grid.set_blocked(6, 6, true);
    sim.world_mut().insert_resource(grid);
    sim.world_mut()
        .insert_resource(SavedLayout::EdgeWallsV1 { edges: vec![] });
    sim.world_mut().insert_resource(Funds(funds));
    (sim, fridge, rack)
}

fn sell(sim: &mut Sim, object: Entity) {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SellObject {
            object: object.index_u32(),
        });
    sim.flush_commands();
}

fn last(sim: &Sim) -> Option<SaleResult> {
    sim.world().resource::<LotEditState>().last_sale_result
}

fn revision(sim: &Sim) -> u64 {
    sim.world().resource::<LotEditState>().revision
}

/// The preview refuses with `expected`, and so does the drain, and neither
/// writes anything: not the save, not the lot revision.
fn refused(sim: &mut Sim, object: Entity, expected: PlacementRefusal) {
    let before = sim.save_snapshot_v3();
    let revision_before = revision(sim);
    assert_eq!(
        validate_sale(sim.world(), object.index_u32()).unwrap_err(),
        expected
    );
    sell(sim, object);
    assert_eq!(
        last(sim),
        Some(SaleResult {
            object: object.index_u32(),
            payout: None,
            reason: Some(expected)
        })
    );
    assert_eq!(sim.save_snapshot_v3(), before, "a refused sale wrote state");
    assert_eq!(revision(sim), revision_before);
}

#[test]
fn a_sale_takes_the_object_away_opens_its_tiles_and_pays_back_part_of_its_price() {
    let (mut sim, fridge, _) = house(7);
    let price = terri_data::pack()
        .object(terri_data::pack().find("fridge").unwrap())
        .price
        .unwrap();
    let payout = sale_value(price, 0.5);
    assert_eq!(
        validate_sale(sim.world(), fridge.index_u32())
            .unwrap()
            .payout,
        payout
    );
    let before = revision(&sim);
    sell(&mut sim, fridge);
    assert_eq!(
        last(&sim),
        Some(SaleResult {
            object: fridge.index_u32(),
            payout: Some(payout),
            reason: None
        })
    );
    assert!(
        sim.world().get_entity(fridge).is_err(),
        "the fridge is gone"
    );
    assert!(sim.world().resource::<TileGrid>().is_walkable(0, 0));
    assert!(
        !sim.world().resource::<TileGrid>().is_walkable(3, 3),
        "the rack stays"
    );
    assert_eq!(sim.world().resource::<Funds>().0, 7 + i64::from(payout));
    assert_eq!(revision(&sim), before + 1, "one sale, one revision");
    // Selling the same index again finds nothing there.
    refused(&mut sim, fridge, PlacementRefusal::UnknownObject);
}

/// [SL-pay]: the price times the fraction, rounded down.
#[test]
fn a_sale_pays_the_price_times_the_fraction_rounded_down() {
    assert_eq!(sale_value(300, 0.5), 150);
    assert_eq!(sale_value(45, 0.5), 22);
    assert_eq!(sale_value(45, 0.0), 0);
    assert_eq!(sale_value(45, 1.0), 45);
    assert_eq!(sale_value(99, 0.25), 24);
}

/// [SL-rules], in order, each refusal writing nothing.
#[test]
fn a_sale_is_refused_for_each_reason_in_the_order_the_design_lists() {
    let (mut sim, fridge, rack) = house(0);
    // Nothing placed carries the index of a sim.
    let sim_entity = sim
        .world_mut()
        .spawn((Agent, Position { x: 5.0, y: 5.0 }))
        .id();
    refused(&mut sim, sim_entity, PlacementRefusal::UnknownObject);

    // A grid nobody can explain comes before whether the object is in use.
    let (mut broken, fridge_b, _) = house(0);
    broken
        .world_mut()
        .resource_mut::<TileGrid>()
        .set_blocked(5, 5, true);
    broken.world_mut().entity_mut(fridge_b).insert(Reserved);
    refused(&mut broken, fridge_b, PlacementRefusal::UnsupportedLayout);

    // In use three ways: reserved, the target of a walk, named by an order.
    sim.world_mut().entity_mut(fridge).insert(Reserved);
    refused(&mut sim, fridge, PlacementRefusal::InUse);
    sim.world_mut().entity_mut(fridge).remove::<Reserved>();
    sim.world_mut().entity_mut(sim_entity).insert(Target {
        object: fridge,
        interaction: 0,
    });
    refused(&mut sim, fridge, PlacementRefusal::InUse);
    sim.world_mut().entity_mut(sim_entity).remove::<Target>();
    sim.world_mut()
        .entity_mut(sim_entity)
        .insert(IntentQueue::from_intents(vec![Intent {
            object: fridge,
            interaction: 0,
        }]));
    refused(&mut sim, fridge, PlacementRefusal::InUse);

    // Being in use comes before having no price.
    sim.world_mut().entity_mut(rack).insert(Reserved);
    refused(&mut sim, rack, PlacementRefusal::InUse);
    sim.world_mut().entity_mut(rack).remove::<Reserved>();
    refused(&mut sim, rack, PlacementRefusal::NotForSale);

    // An order naming another object, and a walk to another, stop nothing.
    sim.world_mut()
        .entity_mut(sim_entity)
        .insert(IntentQueue::from_intents(vec![Intent {
            object: rack,
            interaction: 0,
        }]));
    sim.world_mut().entity_mut(sim_entity).insert(Target {
        object: rack,
        interaction: 0,
    });
    sell(&mut sim, fridge);
    assert_eq!(last(&sim).unwrap().reason, None);
}

/// [SL-despawn]: a sold index is retired, never handed to a later spawn,
/// however many spawns and drains follow.
#[test]
fn a_sold_index_is_never_handed_out_again() {
    let (mut sim, fridge, _) = house(0);
    sell(&mut sim, fridge);
    assert_eq!(
        sim.world().resource::<RetiredIndices>().as_slice(),
        [fridge.index_u32()]
    );
    for _ in 0..32 {
        let spawned = sim
            .world_mut()
            .spawn(SmartObject(terri_data::ObjectDefId(0)))
            .id();
        assert_ne!(spawned.index_u32(), fridge.index_u32());
        sim.flush_commands();
    }
}

/// The two highest-indexed objects the shipped house would sell right now.
fn two_sellable(sim: &Sim) -> [Entity; 2] {
    let world = sim.world();
    let mut query = world.try_query::<(Entity, &SmartObject)>().unwrap();
    let mut objects: Vec<Entity> = query
        .iter(world)
        .map(|(entity, _)| entity)
        .filter(|&entity| validate_sale(world, entity.index_u32()).is_ok())
        .collect();
    objects.sort_by_key(|entity| std::cmp::Reverse(entity.index_u32()));
    [objects[0], objects[1]]
}

/// A chair bought on the first tile the shipped house accepts one.
fn buy_a_chair(sim: &mut Sim) -> Option<u32> {
    use crate::placement::purchase::{validate_purchase, Purchase};
    let pack = terri_data::pack();
    let definition = pack.find("chair").unwrap().0;
    let facing = pack.objects[definition as usize].base_facing;
    let (width, height) = {
        let grid = sim.world().resource::<TileGrid>();
        (grid.width() as u32, grid.height() as u32)
    };
    let purchase = (0..height)
        .flat_map(|y| (0..width).map(move |x| (x, y)))
        .map(|(x, y)| Purchase {
            definition,
            x,
            y,
            facing,
        })
        .find(|&purchase| validate_purchase(sim.world(), purchase).is_ok())?;
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::BuyObject {
            definition: purchase.definition,
            x: purchase.x,
            y: purchase.y,
            facing: purchase.facing,
        });
    sim.flush_commands();
    sim.world()
        .resource::<LotEditState>()
        .last_purchase_result
        .and_then(|result| result.object)
}

/// [SL-save], the hazard [BM-sell] named: two sales highest index first, a
/// Save and a Load, then a purchase. The loaded world hands the purchase the
/// same index as the world that played on, never a sold one, and the two
/// hash alike before, after and forty ticks on.
#[test]
fn after_two_sales_a_save_and_a_load_the_next_purchase_matches_continuous_play() {
    let mut playing = Sim::new_from_shipped_lot();
    let sold = two_sellable(&playing);
    for object in sold {
        sell(&mut playing, object);
        assert_eq!(last(&playing).unwrap().reason, None);
    }
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v4(playing.save_snapshot_v4()).unwrap();
    assert_eq!(loaded.world_hash(), playing.world_hash());
    assert_eq!(
        loaded.world().resource::<RetiredIndices>(),
        playing.world().resource::<RetiredIndices>()
    );

    let bought = buy_a_chair(&mut playing).expect("the house takes a chair");
    assert_eq!(buy_a_chair(&mut loaded), Some(bought));
    assert!(sold.iter().all(|entity| entity.index_u32() != bought));
    assert_eq!(loaded.world_hash(), playing.world_hash());
    for _ in 0..40 {
        playing.tick();
        loaded.tick();
    }
    assert_eq!(loaded.world_hash(), playing.world_hash());
}

/// A staged sale is saved and restored like the other lot edits, and the
/// hash sees it.
#[test]
fn a_staged_sale_survives_save_and_load_and_the_hash_sees_it() {
    let (mut sim, fridge, rack) = house(0);
    let unstaged = sim.world_hash();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SellObject {
            object: fridge.index_u32(),
        });
    let staged = sim.world_hash();
    assert_ne!(staged, unstaged);
    let mut other = house(0).0;
    other
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SellObject {
            object: rack.index_u32(),
        });
    assert_ne!(other.world_hash(), staged, "the hash sees which object");

    let saved = sim.save_snapshot_v4();
    let mut loaded = house(0).0;
    loaded.load_snapshot_v4(saved).unwrap();
    assert_eq!(loaded.world_hash(), staged);
    loaded.flush_commands();
    assert_eq!(last(&loaded).unwrap().reason, None);
    assert!(loaded.world().get_entity(fridge).is_err());
}

/// The hash tells apart two worlds that differ only in a retired index.
#[test]
fn the_world_hash_sees_the_retired_indices() {
    let (mut sim, fridge, _) = house(0);
    let before = sim.world_hash();
    sim.world_mut()
        .insert_resource(RetiredIndices::from_sorted(vec![fridge.index_u32() + 40]));
    assert_ne!(sim.world_hash(), before);
    let one = sim.world_hash();
    sim.world_mut()
        .insert_resource(RetiredIndices::from_sorted(vec![
            fridge.index_u32() + 40,
            fridge.index_u32() + 41,
        ]));
    assert_ne!(sim.world_hash(), one);
}

/// [SL-save]: a V4 save whose retired indices are out of order, repeated, or
/// held by a saved entity is refused, and the running world is untouched.
#[test]
fn a_v4_save_with_bad_retired_indices_is_refused() {
    let (mut sim, fridge, _) = house(0);
    sell(&mut sim, fridge);
    let good = sim.save_snapshot_v4();
    let held = good.world.entities[0].index;
    // An index at the entity cap, or one near the top of u32, must be refused
    // before the loader spawns placeholders up to it; the cap itself is the
    // first index refused. So must a list longer than the cap, which only
    // an index at or above the cap could make.
    for retired in [
        vec![9, 8],
        vec![8, 8],
        vec![held],
        vec![100_000],
        vec![u32::MAX],
        (0..100_001).collect(),
    ] {
        let mut bad = good.clone();
        bad.retired_indices = retired.clone();
        let mut target = house(0).0;
        let before = target.world_hash();
        assert!(
            target.load_snapshot_v4(bad).is_err(),
            "{:?}",
            &retired[..retired.len().min(3)]
        );
        assert_eq!(target.world_hash(), before);
    }
    // Just under the cap loads.
    let mut edge = good.clone();
    edge.retired_indices = vec![99_999];
    assert!(house(0).0.load_snapshot_v4(edge).is_ok());
    let mut target = house(0).0;
    target.load_snapshot_v4(good).unwrap();
    assert_eq!(target.world_hash(), sim.world_hash());
}

/// [SL-render]: a sale and a purchase in one drain keep the row count while
/// shifting rows, so the rack moves into the fridge's row. Its previous
/// position must be its own, not the fridge's, or it would be drawn sliding
/// across the lot from the corner.
#[test]
fn a_sale_and_a_purchase_in_one_drain_reseed_the_rows_they_shift() {
    let (mut sim, fridge, _) = house(1_000);
    sim.sync_render_buffer();
    sim.sync_render_buffer();
    let before = sim.render_buffer().count;
    let chair = terri_data::pack().find("chair").unwrap().0;
    let facing = terri_data::pack().objects[chair as usize].base_facing;
    {
        let mut queue = sim.world_mut().resource_mut::<CommandQueue>();
        queue.push(SimCommand::SellObject {
            object: fridge.index_u32(),
        });
        queue.push(SimCommand::BuyObject {
            definition: chair,
            x: 5,
            y: 5,
            facing,
        });
    }
    sim.flush_commands();
    sim.sync_render_buffer();
    let render = sim.render_buffer();
    assert_eq!(render.count, before, "one object out, one in");
    assert_eq!(&render.positions[..2], [3.0, 3.0], "the rack is first now");
    assert_eq!(render.prev_positions, render.positions);
}

/// [SL-save]: a sold object whose index is above every entity the save holds
/// stays retired after a Load. The loader must reach that index to keep it out
/// of use; otherwise the loaded world would hand it to the next spawn.
#[test]
fn a_sold_object_above_every_saved_index_stays_retired_after_a_load() {
    let (mut playing, _, _) = house(1_000);
    let bought = buy_a_chair(&mut playing).expect("the house takes a chair");
    let chair = playing
        .world()
        .entities()
        .resolve_from_index(bevy_ecs::entity::EntityIndex::from_raw_u32(bought).unwrap());
    sell(&mut playing, chair);
    assert_eq!(last(&playing).unwrap().reason, None);
    let saved = playing.save_snapshot_v4();
    assert!(
        saved
            .world
            .entities
            .iter()
            .all(|entity| entity.index < bought),
        "the sold chair is above every saved index"
    );
    let mut loaded = house(0).0;
    loaded.load_snapshot_v4(saved).unwrap();
    assert_eq!(loaded.world_hash(), playing.world_hash());
    let next = buy_a_chair(&mut playing).unwrap();
    assert_eq!(buy_a_chair(&mut loaded), Some(next));
    assert_ne!(next, bought, "a retired index is never handed out again");
}

/// Every placed object whose definition has `id`, in index order.
fn placed(sim: &Sim, id: &str) -> Vec<Entity> {
    let world = sim.world();
    let wanted = terri_data::pack().find(id).unwrap();
    let mut query = world.try_query::<(Entity, &SmartObject)>().unwrap();
    let mut found: Vec<Entity> = query
        .iter(world)
        .filter(|(_, object)| object.0 == wanted)
        .map(|(entity, _)| entity)
        .collect();
    found.sort_by_key(|entity| entity.index_u32());
    found
}

/// [SL-rules] step 6: the last object that can fill a role a chain needs is
/// not sold, or a sim part way through that chain waits for a station that
/// no longer exists. In the shipped house the stove
/// is the only hob; the counters and the kitchen sink are all prep surfaces,
/// so the counters sell and then the sink is the last.
#[test]
fn the_last_object_a_chain_needs_is_not_sold() {
    let mut sim = Sim::new_from_shipped_lot();
    let stoves = placed(&sim, "stove");
    assert_eq!(stoves.len(), 1, "the shipped house has one hob");
    refused(&mut sim, stoves[0], PlacementRefusal::LastForAChain);
    let sinks = placed(&sim, "kitchen_sink");
    assert_eq!(sinks.len(), 1);
    let counters = placed(&sim, "counter");
    assert!(!counters.is_empty());
    for counter in counters {
        sell(&mut sim, counter);
        assert_eq!(
            last(&sim).unwrap().reason,
            None,
            "the sink is a prep surface too"
        );
    }
    refused(&mut sim, sinks[0], PlacementRefusal::LastForAChain);

    // In the test house the second fridge lets the first go, and then the
    // last one stays. An object in use is refused as in use first.
    let (mut house, fridge, _) = house(0);
    sell(&mut house, fridge);
    assert_eq!(last(&house).unwrap().reason, None);
    let world = house.world();
    let mut query = world.try_query::<(Entity, &SmartObject)>().unwrap();
    let spare = query
        .iter(world)
        .find(|(entity, _)| world.get::<Position>(*entity) == Some(&Position { x: 6.0, y: 6.0 }))
        .map(|(entity, _)| entity)
        .unwrap();
    house.world_mut().entity_mut(spare).insert(Reserved);
    refused(&mut house, spare, PlacementRefusal::InUse);
    house.world_mut().entity_mut(spare).remove::<Reserved>();
    refused(&mut house, spare, PlacementRefusal::LastForAChain);
}

/// [SL-rules] step 6 guards only roles a chain needs. The only object with a
/// role no chain uses still sells, or every object given a role for a future
/// chain would be stuck in the house.
#[test]
fn the_only_object_with_a_role_no_chain_uses_sells() {
    let (mut sim, _, rack) = house_with(0, |pack| {
        pack.roles.push("coat_hook".to_owned());
        let role = u32::try_from(pack.roles.len() - 1).unwrap();
        assert!(pack
            .chains
            .iter()
            .all(|chain| chain.steps.iter().all(|step| step.role != role)));
        let rack = pack.find("coat_rack").unwrap().0 as usize;
        pack.objects[rack].roles = vec![role];
        pack.objects[rack].price = Some(35);
    });
    sell(&mut sim, rack);
    assert_eq!(
        last(&sim),
        Some(SaleResult {
            object: rack.index_u32(),
            payout: Some(17),
            reason: None
        })
    );
}
