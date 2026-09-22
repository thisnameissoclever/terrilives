//! Buying furniture - [BM-buy] in `docs/specs/2026-09-21-buy-mode.md`.
//!
//! A purchase is a placement with no object to lift first: it shares the
//! rectangle rules with a move through `plan_rectangle`, so a bought chair
//! can never stand where a moved one would be refused.

use super::{plan_rectangle, LotEditState, PlacementRefusal};
use crate::{apply_object_placement, Content};
use bevy_ecs::prelude::*;
use terri_core::{Facing, Footprint, Funds, Position, SmartObject, TileGrid};
use terri_data::{CompiledObject, ObjectDefId};

/// One requested purchase: this object, at this tile, facing this way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Purchase {
    /// A pack object index.
    pub definition: u32,
    pub x: u32,
    pub y: u32,
    pub facing: Facing,
}

/// What the drain did with the most recent purchase. `object` is the entity
/// index of what was bought, and `reason` why not when nothing was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PurchaseResult {
    pub purchase: Purchase,
    pub object: Option<u32>,
    pub reason: Option<PlacementRefusal>,
}

/// A validated purchase, owned and ready to write.
#[derive(Debug)]
pub struct PurchasePlan {
    grid: TileGrid,
    pub price: u32,
    pub footprint: Footprint,
    pub sprite: u32,
    pub foreground: Option<u32>,
}

/// The object a pack index names, and its price, when it is for sale.
pub fn for_sale(world: &World, definition: u32) -> Option<(&'static CompiledObject, u32)> {
    let content = world.get_resource::<Content>()?.0;
    let object = content.objects.get(definition as usize)?;
    Some((object, object.price?))
}

/// Produces a complete owned transaction; no mutation and no random draws.
///
/// The checks run in the order [BM-buy] lists, so the reason a player reads
/// is the first thing wrong.
pub fn validate_purchase(
    world: &World,
    purchase: Purchase,
) -> Result<PurchasePlan, PlacementRefusal> {
    use PlacementRefusal::*;
    let (definition, price) = for_sale(world, purchase.definition).ok_or(UnknownObject)?;
    if !definition.supports(purchase.facing) {
        return Err(UnsupportedFacing);
    }
    let funds = world.get_resource::<Funds>().map_or(0, |funds| funds.0);
    if funds < i64::from(price) {
        return Err(CannotAfford);
    }
    let footprint = definition.footprint_at(purchase.facing);
    let grid = plan_rectangle(world, None, footprint, (purchase.x, purchase.y))?;
    Ok(PurchasePlan {
        grid,
        price,
        footprint,
        sprite: definition.facing_sprites.get(purchase.facing).unwrap(),
        foreground: definition.facing_foreground_sprites.get(purchase.facing),
    })
}

/// Revalidation and writes happen in one exclusive command drain: the object
/// appears, its tiles block and the price leaves Funds together or not at all.
pub(crate) fn commit(world: &mut World, purchase: Purchase) {
    let result = validate_purchase(world, purchase);
    let reason = result.as_ref().err().copied();
    let mut object = None;
    if let Ok(plan) = result {
        let (definition, _) = for_sale(world, purchase.definition).unwrap();
        let origin = Position {
            x: purchase.x as f32,
            y: purchase.y as f32,
        };
        world.insert_resource(plan.grid);
        let entity = world
            .spawn((origin, SmartObject(ObjectDefId(purchase.definition))))
            .id();
        apply_object_placement(world, entity, definition, origin, purchase.facing);
        world.resource_mut::<Funds>().0 -= i64::from(plan.price);
        let mut state = world.resource_mut::<LotEditState>();
        state.revision = state.revision.saturating_add(1);
        object = Some(entity.index_u32());
    }
    world.resource_mut::<LotEditState>().last_purchase_result = Some(PurchaseResult {
        purchase,
        object,
        reason,
    });
}

#[cfg(test)]
#[path = "purchase_tests.rs"]
mod tests;
