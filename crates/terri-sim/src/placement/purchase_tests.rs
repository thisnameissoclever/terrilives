//! Tests for buying furniture - [BM-buy] in `docs/specs/2026-09-21-buy-mode.md`.

use super::*;
use crate::placement::{validate_placement, PlacementRefusal::*};
use crate::Sim;
use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
use terri_core::{Agent, CommandQueue, ObjectFacing, SimCommand};
use terri_data::ContentPack;

/// A 7 by 7 house with the given walls, a fridge in the corner at (0, 0), the
/// front door on the east side at (6, 3) with its landing at (5, 3), and
/// `funds` in the bank.
fn house(funds: i64, edges: Vec<WallEdge>) -> Sim {
    house_with(funds, edges, |_| {})
}

/// `house`, with its pack changed by `edit` before the house is built.
fn house_with(funds: i64, edges: Vec<WallEdge>, edit: impl FnOnce(&mut ContentPack)) -> Sim {
    let mut pack = terri_data::pack().clone();
    pack.lot.width = 7;
    pack.lot.height = 7;
    pack.lot.wall_edges.clear();
    pack.lot.walls.clear();
    pack.lot.placements.clear();
    pack.lot.front_door = Some((6, 3));
    pack.portals[0].position = (6, 3);
    pack.portals[0].inward = (5, 3);
    // One object kept out of the catalogue, so the refusal for an unpriced
    // object has something to refuse.
    let unpriced = pack.find("coat_rack").unwrap().0 as usize;
    pack.objects[unpriced].price = None;
    edit(&mut pack);
    let pack: &'static ContentPack = Box::leak(Box::new(pack));
    let mut sim = Sim::new_from_lot(&pack.lot, &pack.objects);
    sim.world_mut().insert_resource(Content(pack));
    sim.spawn_object(Position { x: 0.0, y: 0.0 }, pack.find("fridge").unwrap());
    let mut grid = TileGrid::new(7, 7);
    grid.set_blocked(0, 0, true);
    for edge in &edges {
        let [a, b] = edge.cells();
        grid.set_edge_blocked(a, b, !edge.doorway);
    }
    sim.world_mut().insert_resource(grid);
    sim.world_mut()
        .insert_resource(SavedLayout::EdgeWallsV1 { edges });
    sim.world_mut().insert_resource(Funds(funds));
    sim
}

/// The shipped pack. Every house here keeps its object order, so an index
/// read from it names the same object in each of them.
fn pack() -> &'static ContentPack {
    terri_data::pack()
}

fn index(id: &str) -> u32 {
    pack().find(id).unwrap().0
}

fn price(id: &str) -> i64 {
    i64::from(pack().object(pack().find(id).unwrap()).price.unwrap())
}

/// A chair at `(x, y)` in its base direction.
fn chair(x: u32, y: u32) -> Purchase {
    let definition = index("chair");
    Purchase {
        definition,
        x,
        y,
        facing: pack().objects[definition as usize].base_facing,
    }
}

/// A direction `definition` supports other than its base one.
fn turned(definition: u32) -> terri_core::Facing {
    let object = &pack().objects[definition as usize];
    terri_core::Facing::ALL
        .into_iter()
        .find(|&f| object.supports(f) && f != object.base_facing)
        .expect("the object turns")
}

fn command(purchase: Purchase) -> SimCommand {
    SimCommand::BuyObject {
        definition: purchase.definition,
        x: purchase.x,
        y: purchase.y,
        facing: purchase.facing,
    }
}

fn stage(sim: &mut Sim, purchase: Purchase) {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(command(purchase));
    sim.flush_commands();
}

fn funds(sim: &Sim) -> i64 {
    sim.world().resource::<Funds>().0
}

fn revision(sim: &Sim) -> u64 {
    sim.world().resource::<LotEditState>().revision
}

fn last(sim: &Sim) -> Option<PurchaseResult> {
    sim.world().resource::<LotEditState>().last_purchase_result
}

fn objects(sim: &mut Sim) -> usize {
    sim.world_mut()
        .query::<&SmartObject>()
        .iter(sim.world())
        .count()
}

/// The preview refuses with `expected`, and so does the commit, and neither
/// writes anything: not the save, not the Funds, not the lot revision.
fn refused(sim: &mut Sim, purchase: Purchase, expected: PlacementRefusal) {
    let before = sim.save_snapshot_v3();
    let revision_before = revision(sim);
    assert_eq!(
        validate_purchase(sim.world(), purchase).unwrap_err(),
        expected,
        "preview of {purchase:?}"
    );
    assert_eq!(sim.save_snapshot_v3(), before, "preview wrote state");
    stage(sim, purchase);
    assert_eq!(
        last(sim),
        Some(PurchaseResult {
            purchase,
            object: None,
            reason: Some(expected)
        })
    );
    assert_eq!(
        sim.save_snapshot_v3(),
        before,
        "a refused purchase wrote state"
    );
    assert_eq!(
        revision(sim),
        revision_before,
        "a refused purchase moved the revision"
    );
}

/// Bought, with nothing refused. Returns the new object's entity.
fn bought(sim: &mut Sim, purchase: Purchase) -> Entity {
    assert!(
        validate_purchase(sim.world(), purchase).is_ok(),
        "preview of {purchase:?}"
    );
    stage(sim, purchase);
    let result = last(sim).unwrap();
    assert_eq!((result.purchase, result.reason), (purchase, None));
    let index = result.object.expect("a bought object is reported");
    sim.world_mut()
        .query_filtered::<Entity, With<SmartObject>>()
        .iter(sim.world())
        .find(|e| e.index_u32() == index)
        .unwrap()
}

#[test]
fn a_purchase_stands_the_object_blocks_its_tiles_and_takes_the_price() {
    let mut sim = house(1_000, vec![]);
    let definition = index("dining_table");
    let facing = turned(definition);
    let footprint = pack().objects[definition as usize].footprint_at(facing);
    let revision_before = revision(&sim);
    let objects_before = objects(&mut sim);

    let table = bought(
        &mut sim,
        Purchase {
            definition,
            x: 2,
            y: 2,
            facing,
        },
    );

    assert_eq!(funds(&sim), 1_000 - price("dining_table"));
    assert_eq!(revision(&sim), revision_before + 1);
    assert_eq!(objects(&mut sim), objects_before + 1);
    assert_eq!(
        sim.world().get::<SmartObject>(table).unwrap().0 .0,
        definition
    );
    assert_eq!(
        *sim.world().get::<Position>(table).unwrap(),
        Position { x: 2.0, y: 2.0 }
    );
    assert_eq!(sim.world().get::<ObjectFacing>(table).unwrap().0, facing);
    let grid = sim.world().resource::<TileGrid>();
    for y in 0..7 {
        for x in 0..7 {
            let inside =
                (2..2 + footprint.width).contains(&x) && (2..2 + footprint.depth).contains(&y);
            let fridge = (x, y) == (0, 0);
            assert_eq!(
                grid.is_walkable(x as i32, y as i32),
                !inside && !fridge,
                "tile ({x}, {y})"
            );
        }
    }
}

#[test]
fn exactly_the_price_is_enough_and_one_less_is_not() {
    let mut sim = house(0, vec![]);
    let cost = price("chair");
    sim.world_mut().insert_resource(Funds(cost - 1));
    refused(&mut sim, chair(3, 3), CannotAfford);
    sim.world_mut().insert_resource(Funds(cost));
    bought(&mut sim, chair(3, 3));
    assert_eq!(funds(&sim), 0);
}

#[test]
fn a_purchase_is_refused_for_each_reason_in_the_order_the_design_lists() {
    let mut sim = house(1_000, vec![]);
    let chair_index = index("chair");
    let base = pack().objects[chair_index as usize].base_facing;
    // A priced object and a direction its art does not have.
    let (turnless, unsupported) = pack()
        .objects
        .iter()
        .enumerate()
        .filter(|(_, object)| object.price.is_some())
        .find_map(|(index, object)| {
            terri_core::Facing::ALL
                .into_iter()
                .find(|&f| !object.supports(f))
                .map(|f| (index as u32, f))
        })
        .expect("some priced object lacks a direction");
    let buy = |definition: u32, x: u32, y: u32, facing| Purchase {
        definition,
        x,
        y,
        facing,
    };

    // 1. Nothing for sale: past every object, or an object with no price.
    refused(&mut sim, buy(u32::MAX, 3, 3, base), UnknownObject);
    refused(
        &mut sim,
        buy(pack().objects.len() as u32, 3, 3, base),
        UnknownObject,
    );
    let coat_rack = index("coat_rack");
    refused(&mut sim, buy(coat_rack, 3, 3, base), UnknownObject);
    // 2. No art that way, even when the household could not pay either.
    sim.world_mut().insert_resource(Funds(0));
    refused(
        &mut sim,
        buy(turnless, 3, 3, unsupported),
        UnsupportedFacing,
    );
    // 3. Too dear, even off the lot.
    refused(&mut sim, buy(chair_index, 7, 3, base), CannotAfford);
    sim.world_mut().insert_resource(Funds(1_000));
    // 4. Then every placement rule, as for a move.
    refused(&mut sim, buy(chair_index, 7, 3, base), OutOfBounds);
    refused(&mut sim, buy(chair_index, 3, u32::MAX, base), OutOfBounds);
    refused(&mut sim, buy(chair_index, 0, 0, base), FurnitureOverlap);
    refused(&mut sim, buy(chair_index, 6, 3, base), BlockedDoor);
    refused(&mut sim, buy(chair_index, 5, 3, base), BlockedLanding);
    // The fridge in the corner is reached from below or from its right. With
    // a chair below it, a second chair on its right would cut it off.
    bought(&mut sim, buy(chair_index, 0, 1, base));
    refused(
        &mut sim,
        buy(chair_index, 1, 0, base),
        InaccessibleInteraction,
    );
    sim.world_mut().spawn((Agent, Position { x: 3.0, y: 5.0 }));
    refused(&mut sim, buy(chair_index, 3, 5, base), SimOverlap);
}

#[test]
fn a_purchase_cannot_straddle_a_wall_but_can_stand_across_a_doorway() {
    let wall = WallEdge {
        axis: EdgeAxis::Vertical,
        x: 3,
        y: 5,
        doorway: false,
    };
    let mut sim = house(1_000, vec![wall]);
    let table = index("dining_table");
    let facing = pack().objects[table as usize].base_facing;
    let footprint = pack().objects[table as usize].footprint_at(facing);
    assert_eq!((footprint.width, footprint.depth), (2, 1), "a wide table");
    let across = Purchase {
        definition: table,
        x: 2,
        y: 5,
        facing,
    };
    refused(&mut sim, across, WallOverlap);

    let mut sim = house(
        1_000,
        vec![WallEdge {
            doorway: true,
            ..wall
        }],
    );
    bought(&mut sim, across);
}

/// The object being bought needs a way in of its own, as a moved one does.
#[test]
fn a_purchase_is_refused_where_nothing_could_reach_it() {
    // The tile right of the fridge, walled off on its right and below.
    let wall = |axis, x, y| WallEdge {
        axis,
        x,
        y,
        doorway: false,
    };
    let mut sim = house(
        1_000,
        vec![
            wall(EdgeAxis::Vertical, 2, 0),
            wall(EdgeAxis::Horizontal, 1, 1),
        ],
    );
    refused(&mut sim, chair(1, 0), InaccessibleInteraction);
}

/// A purchase sees what the orders issued before it did, and not those
/// issued after: a sim walking across the tile until a cancel stops it.
#[test]
fn a_purchase_sees_the_orders_issued_before_it_and_not_those_after() {
    for cancel_first in [true, false] {
        let mut sim = house(1_000, vec![]);
        let fridge = sim
            .world_mut()
            .query_filtered::<Entity, With<SmartObject>>()
            .single(sim.world())
            .unwrap();
        let walker = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 3.0, y: 1.0 },
                terri_core::IntentQueue::from_intents(vec![terri_core::Intent {
                    object: fridge,
                    interaction: 0,
                }]),
                terri_core::Target {
                    object: fridge,
                    interaction: 0,
                },
                terri_core::Path {
                    steps: vec![(2, 1), (1, 1), (1, 0)],
                    cursor: 0,
                },
            ))
            .id();
        let cancel = SimCommand::CancelIntents {
            agent: walker.index_u32(),
        };
        let buy = command(chair(2, 1));
        {
            let mut queue = sim.world_mut().resource_mut::<CommandQueue>();
            if cancel_first {
                queue.push(cancel);
                queue.push(buy);
            } else {
                queue.push(buy);
                queue.push(cancel);
            }
        }
        sim.flush_commands();
        assert_eq!(
            last(&sim).unwrap().reason,
            if cancel_first {
                None
            } else {
                Some(BlockedRoute)
            },
            "cancel_first={cancel_first}"
        );
        assert!(
            sim.world().get::<terri_core::Path>(walker).is_none(),
            "the cancel applied"
        );
    }
}

#[test]
fn a_bought_object_is_a_placed_object_a_move_and_the_next_purchase_both_see() {
    let mut sim = house(1_000, vec![]);
    let first = bought(&mut sim, chair(3, 3));
    // The next purchase cannot stand on it.
    refused(&mut sim, chair(3, 3), FurnitureOverlap);
    // And it moves like anything else.
    let facing = sim.world().get::<ObjectFacing>(first).unwrap().0;
    assert!(validate_placement(sim.world(), first.index_u32(), (4, 4), facing).is_ok());
}

#[test]
fn two_purchases_in_one_drain_apply_in_stream_order_and_each_sees_the_one_before() {
    let mut sim = house(0, vec![]);
    let cost = price("chair");
    sim.world_mut().insert_resource(Funds(cost + cost / 2));
    let one = chair(2, 2);
    let two = chair(4, 4);
    {
        let mut queue = sim.world_mut().resource_mut::<CommandQueue>();
        queue.push(command(one));
        queue.push(command(two));
    }
    sim.flush_commands();
    // The first bought; the second could not afford what was left.
    assert_eq!(
        last(&sim),
        Some(PurchaseResult {
            purchase: two,
            object: None,
            reason: Some(CannotAfford)
        })
    );
    assert_eq!(funds(&sim), cost / 2);
    assert!(!sim.world().resource::<TileGrid>().is_walkable(2, 2));
    assert!(sim.world().resource::<TileGrid>().is_walkable(4, 4));
}

#[test]
fn a_bought_object_and_a_staged_purchase_survive_save_and_load() {
    let mut sim = house(1_000, vec![]);
    let table = index("dining_table");
    let facing = turned(table);
    bought(
        &mut sim,
        Purchase {
            definition: table,
            x: 3,
            y: 1,
            facing,
        },
    );
    // Staged and not yet drained when the save is taken.
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(command(chair(3, 5)));
    let saved = sim.save_snapshot_v3();
    assert!(saved
        .world
        .queued_commands
        .contains(&terri_core::SavedCommand::BuyObject {
            definition: Some("chair".to_string()),
            x: 3,
            y: 5,
            facing: chair(3, 5).facing,
        }));

    let mut restored = house(0, vec![]);
    restored
        .load_snapshot_v3(saved.clone())
        .expect("a furnished house loads");
    assert_eq!(restored.save_snapshot_v3(), saved);
    assert_eq!(restored.world_hash(), sim.world_hash());
    restored.flush_commands();
    sim.flush_commands();
    assert_eq!(restored.save_snapshot_v3(), sim.save_snapshot_v3());
    assert_eq!(restored.world_hash(), sim.world_hash());
    assert!(!restored.world().resource::<TileGrid>().is_walkable(3, 5));
}

/// A command naming an index past every object saves without a panic, loads,
/// keeps the digest, and is refused when it drains, as it would have been.
#[test]
fn a_staged_purchase_of_nothing_saves_loads_and_is_still_refused() {
    let mut sim = house(1_000, vec![]);
    let nothing = Purchase {
        definition: 5_000,
        ..chair(3, 3)
    };
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(command(nothing));
    let saved = sim.save_snapshot_v3();
    let mut restored = house(0, vec![]);
    restored.load_snapshot_v3(saved).expect("loads");
    assert_eq!(restored.world_hash(), sim.world_hash());
    restored.flush_commands();
    assert_eq!(last(&restored).unwrap().reason, Some(UnknownObject));
}

/// An id the pack no longer has can only arrive through a reviewed content
/// bridge. It loads and is refused, rather than refusing the whole save.
#[test]
fn a_staged_purchase_naming_an_object_the_game_dropped_loads_and_is_refused() {
    let sim = house(1_000, vec![]);
    let mut saved = sim.save_snapshot_v3();
    saved
        .world
        .queued_commands
        .push(terri_core::SavedCommand::BuyObject {
            definition: Some("a_retired_object".to_string()),
            x: 3,
            y: 3,
            facing: chair(3, 3).facing,
        });
    let mut restored = house(0, vec![]);
    restored.load_snapshot_v3(saved).expect("loads");
    restored.flush_commands();
    let result = last(&restored).unwrap();
    assert_eq!(
        (result.purchase.definition, result.reason),
        (u32::MAX, Some(UnknownObject))
    );
}

/// The digest sees every field of a staged purchase, and sees the object by
/// what it is: two indices that both name nothing are the same purchase.
#[test]
fn the_world_hash_sees_every_field_of_a_staged_purchase() {
    let staged = |change: &dyn Fn(Purchase) -> Purchase| {
        let mut sim = house(1_000, vec![]);
        let purchase = change(chair(3, 3));
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(command(purchase));
        sim.world_hash()
    };
    let empty = house(1_000, vec![]).world_hash();
    let reference = staged(&|p| p);
    assert_ne!(reference, empty);
    let sofa = index("sofa");
    let turn = |p: Purchase| Purchase {
        facing: turned(p.definition),
        ..p
    };
    for (name, hash) in [
        (
            "definition",
            staged(&|p| Purchase {
                definition: sofa,
                ..p
            }),
        ),
        ("x", staged(&|p| Purchase { x: 4, ..p })),
        ("y", staged(&|p| Purchase { y: 4, ..p })),
        ("facing", staged(&turn)),
    ] {
        assert_ne!(hash, reference, "{name}");
    }
    assert_eq!(
        staged(&|p| Purchase {
            definition: 5_000,
            ..p
        }),
        staged(&|p| Purchase {
            definition: u32::MAX,
            ..p
        })
    );
}

/// Review finding [F1] on PR 96 - [BM-hash]. A radio and a desk chair cost the
/// same, so two households that bought one or the other for the same tile end
/// with the same Funds, the same blocked tile and the same entity index. The
/// digest has to see which object it is.
#[test]
fn the_world_hash_sees_which_object_was_bought() {
    let bought = |id: &str| {
        let mut sim = house(1_000, vec![]);
        let definition = index(id);
        bought(
            &mut sim,
            Purchase {
                definition,
                x: 3,
                y: 3,
                facing: pack().objects[definition as usize].base_facing,
            },
        );
        sim
    };
    assert_eq!(
        price("radio"),
        price("desk_chair"),
        "the case needs equal prices"
    );
    let radio = bought("radio");
    let chair = bought("desk_chair");
    assert_eq!(funds(&radio), funds(&chair));
    assert_ne!(radio.save_snapshot_v3(), chair.save_snapshot_v3());
    assert_ne!(radio.world_hash(), chair.world_hash());
}

#[test]
fn a_stream_with_purchases_drains_the_same_joined_or_split() {
    let stream = || {
        vec![
            command(chair(2, 2)),
            SimCommand::SetSpeed(2),
            command(chair(2, 2)),
            command(chair(4, 4)),
        ]
    };
    let mut joined = house(1_000, vec![]);
    for command in stream() {
        joined
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(command);
    }
    joined.flush_commands();
    let mut split = house(1_000, vec![]);
    for command in stream() {
        split
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(command);
        split.flush_commands();
    }
    assert_eq!(joined.world_hash(), split.world_hash());
    assert_eq!(joined.save_snapshot_v3(), split.save_snapshot_v3());
    assert_eq!(funds(&joined), 1_000 - 2 * price("chair"));
}

/// A bought object reaches the render buffer, drawn with the art for the way
/// it was bought facing, before the next tick.
#[test]
fn a_bought_object_is_drawn_after_the_drain() {
    let mut sim = house(1_000, vec![]);
    sim.sync_render_buffer();
    let before = sim.render_buffer().ids.len();
    let table = index("dining_table");
    let facing = pack().objects[table as usize].base_facing;
    let purchase = Purchase {
        definition: table,
        x: 2,
        y: 2,
        facing,
    };
    let plan = validate_purchase(sim.world(), purchase).unwrap();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(command(purchase));
    sim.flush_commands();
    sim.sync_render_buffer_after_commands();
    assert_eq!(sim.render_buffer().ids.len(), before + 1);
    let object = last(&sim).unwrap().object.unwrap();
    let slot = sim
        .render_buffer()
        .ids
        .iter()
        .position(|&id| id == object)
        .expect("the bought object has a render slot");
    assert_eq!(sim.render_buffer().sprites[slot], plan.sprite);
}

/// Every chair the shipped household could buy at two points in its day
/// leaves a save that loads, through a real save and load rather than the
/// loader's grid checks alone: those run on a world without the new chair.
#[test]
fn every_chair_the_shipped_household_can_buy_leaves_a_save_that_loads() {
    for ticks in [180, 620] {
        let mut sim = Sim::new_from_shipped_lot();
        for _ in 0..ticks {
            sim.tick();
        }
        sim.world_mut().insert_resource(Funds(1_000));
        let base = sim.save_snapshot_v3();
        let (width, height) = {
            let grid = sim.world().resource::<TileGrid>();
            (grid.width() as u32, grid.height() as u32)
        };
        let mut accepted = 0;
        for y in 0..height {
            for x in 0..width {
                let purchase = chair(x, y);
                if validate_purchase(sim.world(), purchase).is_err() {
                    continue;
                }
                accepted += 1;
                let mut buyer = Sim::new_from_shipped_lot();
                buyer.load_snapshot_v3(base.clone()).unwrap();
                stage(&mut buyer, purchase);
                assert_eq!(last(&buyer).unwrap().reason, None, "({x}, {y})");
                let mut reader = Sim::new_from_shipped_lot();
                reader
                    .load_snapshot_v3(buyer.save_snapshot_v3())
                    .unwrap_or_else(|error| {
                        panic!("a chair at ({x}, {y}) at tick {ticks}: {error:?}")
                    });
            }
        }
        assert!(accepted > 20, "tick {ticks} accepted only {accepted}");
    }
}

fn in_colourway(purchase: Purchase, colourway: u32) -> SimCommand {
    SimCommand::BuyObjectInColourway {
        definition: purchase.definition,
        x: purchase.x,
        y: purchase.y,
        facing: purchase.facing,
        colourway,
    }
}

fn colourway_of(sim: &Sim, index: u32) -> Option<u32> {
    let world = sim.world();
    let entity = world
        .entities()
        .resolve_from_index(bevy_ecs::entity::EntityIndex::from_raw_u32(index).unwrap());
    world
        .get::<terri_core::Colourway>(entity)
        .map(|colourway| colourway.0)
}

/// [RC-slice-buy] in `docs/specs/2026-09-22-colourways.md`: a purchase in a
/// colourway is one edit that buys the object drawn in it; in the first
/// colourway it is stored as none, like any object as drawn.
#[test]
fn a_purchase_in_a_colourway_is_bought_drawn_in_it() {
    let mut sim = house(1_000, vec![]);
    let before = revision(&sim);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(in_colourway(chair(3, 3), 2));
    sim.flush_commands();
    let bought = last(&sim).unwrap().object.expect("the chair is bought");
    assert_eq!(colourway_of(&sim, bought), Some(2));
    assert_eq!(funds(&sim), 1_000 - price("chair"));
    assert_eq!(revision(&sim), before + 1);

    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(in_colourway(chair(4, 4), 0));
    sim.flush_commands();
    let plain = last(&sim)
        .unwrap()
        .object
        .expect("the second chair is bought");
    assert_eq!(colourway_of(&sim, plain), None);
}

/// [RC-slice-buy]: every purchase check comes before the colourway, and an
/// unknown colourway is refused before anything is bought, so a refusal
/// writes nothing.
#[test]
fn a_purchase_in_an_unknown_colourway_writes_nothing() {
    let count = pack().colourways.len() as u32;
    let mut poor = house(0, vec![]);
    poor.world_mut()
        .resource_mut::<CommandQueue>()
        .push(in_colourway(chair(3, 3), count));
    poor.flush_commands();
    assert_eq!(
        last(&poor).unwrap().reason,
        Some(PlacementRefusal::CannotAfford)
    );

    let mut sim = house(1_000, vec![]);
    let hash = sim.world_hash();
    let before = objects(&mut sim);
    for colourway in [count, u32::MAX] {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(in_colourway(chair(3, 3), colourway));
        sim.flush_commands();
        let result = last(&sim).unwrap();
        assert_eq!(
            (result.object, result.reason),
            (None, Some(PlacementRefusal::UnknownColourway))
        );
        assert_eq!(sim.world_hash(), hash);
        assert_eq!(objects(&mut sim), before);
        assert_eq!(funds(&sim), 1_000);
    }
}

/// [RC-slice-buy]: a purchase in a colourway staged just before a save is
/// saved by id and replays after the Load as it would have, and one naming no
/// colourway hashes alike on both sides of the Load.
#[test]
fn a_staged_purchase_in_a_colourway_is_saved_and_replayed() {
    let past = pack().colourways.len() as u32;
    for colourway in [3, past, 99] {
        let mut playing = house(1_000, vec![]);
        playing
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(in_colourway(chair(3, 3), colourway));
        let mut loaded = house(0, vec![]);
        loaded.load_snapshot_v5(playing.save_snapshot_v5()).unwrap();
        assert_eq!(loaded.world_hash(), playing.world_hash(), "{colourway}");
        playing.flush_commands();
        loaded.flush_commands();
        assert_eq!(loaded.world_hash(), playing.world_hash(), "{colourway}");
    }
}

/// [RC-slice-buy]: the hash tells purchases in different colourways apart.
#[test]
fn purchases_in_different_colourways_hash_apart() {
    let mut first = house(1_000, vec![]);
    let mut second = house(1_000, vec![]);
    first
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(in_colourway(chair(3, 3), 1));
    second
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(in_colourway(chair(3, 3), 2));
    assert_ne!(first.world_hash(), second.world_hash());
}

/// [RC-slice-buy]: the digest sees every field of a staged purchase in a
/// colourway, and sees the object and the colourway by what they are: two
/// indices that both name nothing hash alike.
#[test]
fn the_world_hash_sees_every_field_of_a_staged_purchase_in_a_colourway() {
    let staged = |change: &dyn Fn(Purchase) -> Purchase, colourway: u32| {
        let mut sim = house(1_000, vec![]);
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(in_colourway(change(chair(3, 3)), colourway));
        sim.world_hash()
    };
    let reference = staged(&|p| p, 1);
    let turn = |p: Purchase| Purchase {
        facing: turned(p.definition),
        ..p
    };
    let sofa = index("sofa");
    for (name, hash) in [
        (
            "definition",
            staged(
                &|p| Purchase {
                    definition: sofa,
                    ..p
                },
                1,
            ),
        ),
        ("x", staged(&|p| Purchase { x: 4, ..p }, 1)),
        ("y", staged(&|p| Purchase { y: 4, ..p }, 1)),
        ("facing", staged(&turn, 1)),
        ("colourway", staged(&|p| p, 2)),
    ] {
        assert_ne!(hash, reference, "{name}");
    }
    let nothing = |definition: u32| staged(&move |p| Purchase { definition, ..p }, 1);
    assert_eq!(nothing(5_000), nothing(u32::MAX));
    let past = pack().colourways.len() as u32;
    assert_eq!(staged(&|p| p, past), staged(&|p| p, u32::MAX));
}

/// [RC-slice-buy]: a staged purchase in a colourway naming no object saves,
/// loads with the same digest, and is refused as it would have been.
#[test]
fn a_staged_purchase_in_a_colourway_of_nothing_saves_loads_and_is_refused() {
    let mut sim = house(1_000, vec![]);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(in_colourway(
            Purchase {
                definition: 5_000,
                ..chair(3, 3)
            },
            1,
        ));
    let mut restored = house(0, vec![]);
    restored.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
    assert_eq!(restored.world_hash(), sim.world_hash());
    restored.flush_commands();
    assert_eq!(last(&restored).unwrap().reason, Some(UnknownObject));
}

/// [RC-slice-buy]: ids the pack no longer has load rather than refusing the
/// save. A retired object is refused as unknown; a retired colourway refuses
/// the purchase too, as a staged colour change naming it is, so a colour the
/// game can no longer draw is never bought.
#[test]
fn a_staged_purchase_in_a_colourway_naming_what_the_game_dropped_loads_and_is_refused() {
    for (definition, colourway, reason) in [
        (Some("a_retired_object"), Some("colour_2"), UnknownObject),
        (None, Some("a_retired_colourway"), UnknownColourway),
    ] {
        let sim = house(1_000, vec![]);
        let mut saved = sim.save_snapshot_v5();
        saved
            .world
            .queued_commands
            .push(terri_core::SavedCommand::BuyObjectInColourway {
                definition: Some(definition.unwrap_or("chair").to_string()),
                x: 3,
                y: 3,
                facing: chair(3, 3).facing,
                colourway: colourway.map(str::to_string),
            });
        let mut restored = house(0, vec![]);
        restored.load_snapshot_v5(saved).expect("loads");
        restored.flush_commands();
        let result = last(&restored).unwrap();
        assert_eq!((result.object, result.reason), (None, Some(reason)));
        if definition.is_some() {
            assert_eq!(result.purchase.definition, u32::MAX);
        }
    }
}

/// [RC-slice-buy]: both purchase commands hash a staged object by its id, not
/// its index, so a save loaded by a build whose content lists the objects in
/// another order hashes as it did before the Load.
#[test]
fn the_world_hash_names_a_staged_purchase_by_its_object_id() {
    let hash = |renamed: bool, staged: Option<SimCommand>| {
        let mut sim = house_with(1_000, vec![], |pack| {
            if renamed {
                let chair = pack.find("chair").unwrap().0 as usize;
                pack.objects[chair].id = "a_renamed_chair".to_string();
            }
        });
        if let Some(command) = staged {
            sim.world_mut().resource_mut::<CommandQueue>().push(command);
        }
        sim.world_hash()
    };
    // Renaming an object nobody placed changes nothing else the digest sees.
    assert_eq!(hash(false, None), hash(true, None));
    for staged in [command(chair(3, 3)), in_colourway(chair(3, 3), 2)] {
        assert_ne!(
            hash(false, Some(staged.clone())),
            hash(true, Some(staged)),
            "the same index under another id"
        );
    }
}

/// [OS-door], review findings [Y7] and [Y13]: the yard tile beyond the front
/// door stays open floor, so furniture bought onto it is refused as blocking
/// the door; the tile beside it takes furniture as any yard tile does. A
/// second doorway into the yard first, so the furniture's own approaches are
/// reachable and only this rule refuses it.
#[test]
fn nothing_is_bought_onto_the_tile_beyond_the_front_door() {
    let buy = |x: u32, y: u32| {
        let mut sim = Sim::new_from_shipped_lot();
        sim.world_mut().insert_resource(Funds(1_000));
        let mut queue = sim.world_mut().resource_mut::<CommandQueue>();
        queue.push(SimCommand::SetWallEdge {
            axis: terri_core::layout::EdgeAxis::Vertical,
            x: 16,
            y: 5,
            state: terri_core::layout::WallState::Doorway,
        });
        queue.push(command(chair(x, y)));
        sim.flush_commands();
        let wall = sim.world().resource::<LotEditState>().last_wall_result;
        assert_eq!(
            wall.map(|wall| wall.reason),
            Some(None),
            "the second doorway"
        );
        last(&sim).unwrap().reason
    };
    assert_eq!(buy(16, 2), Some(BlockedDoor));
    assert_eq!(buy(17, 2), None);
}
