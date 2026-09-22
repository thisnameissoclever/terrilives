//! Selling furniture - [SL-rules], [SL-pay] and [SL-despawn] in
//! `docs/specs/2026-09-22-selling-furniture.md`.
//!
//! A sale only takes an object away, so it opens tiles and never closes one:
//! it cannot cut anyone off, and the usability proofs a move or a purchase
//! runs are not asked. What it must not do is take away something a sim is
//! using, walking to, or has been told to use.
use super::{
    cells, current_layout, object_definition, CurrentLayout, LotEditState, PlacementRefusal,
};
use crate::Content;
use bevy_ecs::prelude::*;
use terri_core::{Funds, IntentQueue, Reserved, SmartObject, Target, TileGrid};

/// Every entity index a sale has retired, ascending - [SL-despawn]. Saved in
/// the V4 envelope and hashed, because it decides which indices the loader
/// frees for reuse and which it keeps out of use.
#[derive(Resource, Debug, Default, Clone, PartialEq, Eq)]
pub struct RetiredIndices(Vec<u32>);

impl RetiredIndices {
    /// From saved indices, which the loader has checked are ascending.
    pub fn from_sorted(indices: Vec<u32>) -> Self {
        Self(indices)
    }

    pub fn as_slice(&self) -> &[u32] {
        &self.0
    }

    fn retire(&mut self, index: u32) {
        if let Err(at) = self.0.binary_search(&index) {
            self.0.insert(at, index);
        }
    }
}

/// What the drain did with the most recent sale: the entity index it named,
/// what it paid when it sold, and why not when it did not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SaleResult {
    pub object: u32,
    pub payout: Option<u32>,
    pub reason: Option<PlacementRefusal>,
}

/// A validated sale, owned and ready to write.
#[derive(Debug)]
pub struct SalePlan {
    grid: TileGrid,
    entity: Entity,
    pub payout: u32,
}

/// What a sale of something costing `price` pays back - [SL-pay]: the price
/// times the resale fraction, rounded down to a whole number of Funds.
pub fn sale_value(price: u32, resale_fraction: f32) -> u32 {
    (f64::from(price) * f64::from(resale_fraction)).floor() as u32
}

/// Produces a complete owned transaction; no mutation and no random draws.
/// The checks run in the order [SL-rules] lists, so the reason a player reads
/// is the first thing wrong.
pub fn validate_sale(world: &World, object: u32) -> Result<SalePlan, PlacementRefusal> {
    use PlacementRefusal::*;
    let (entity, definition, _) = object_definition(world, object).ok_or(UnknownObject)?;
    let CurrentLayout { walls, rectangles } = current_layout(world)?;
    let mut people = world.try_query::<EntityRef>().ok_or(UnsupportedLayout)?;
    if world.get::<Reserved>(entity).is_some()
        || people.iter(world).any(|person| {
            person.get::<Target>().is_some_and(|t| t.object == entity)
                || person
                    .get::<IntentQueue>()
                    .is_some_and(|queue| queue.names(entity))
        })
    {
        return Err(InUse);
    }
    let price = definition.price.ok_or(NotForSale)?;
    // The last object that can fill a role some chain needs stays: without it
    // a sim part way through that chain would wait for a station that no
    // longer exists, and the chain would still be offered ([SL-rules]).
    let content = world.resource::<Content>().0;
    let fills = |other: Entity, role: u32| {
        world
            .get::<SmartObject>(other)
            .is_some_and(|object| content.object(object.0).roles.contains(&role))
    };
    let last_for_a_chain = definition.roles.iter().any(|&role| {
        content
            .chains
            .iter()
            .any(|chain| chain.steps.iter().any(|step| step.role == role))
            && !rectangles.iter().any(|rect| {
                rect.entity
                    .is_some_and(|other| other != entity && fills(other, role))
            })
    });
    if last_for_a_chain {
        return Err(LastForAChain);
    }
    // The fixed architecture with every other object standing on it: the
    // grid the lot has once this one is gone.
    let mut grid = walls;
    for rect in rectangles.iter().filter(|rect| rect.entity != Some(entity)) {
        for (x, y) in cells(*rect) {
            grid.set_blocked(x as usize, y as usize, true);
        }
    }
    let fraction = content.tuning.resale_fraction;
    Ok(SalePlan {
        grid,
        entity,
        payout: sale_value(price, fraction),
    })
}

/// Revalidation and writes happen in one exclusive command drain: the object
/// goes, its tiles open and the payout reaches Funds together or not at all.
///
/// The object is despawned without freeing its index ([SL-despawn]), and the
/// index is recorded as retired, so no later spawn can take it, in continuous
/// play or after a Load.
pub(crate) fn commit(world: &mut World, object: u32) {
    let result = validate_sale(world, object);
    let reason = result.as_ref().err().copied();
    let mut payout = None;
    if let Ok(plan) = result {
        world.insert_resource(plan.grid);
        world
            .despawn_no_free(plan.entity)
            .expect("a validated sale names a live object");
        world
            .get_resource_or_insert_with(RetiredIndices::default)
            .retire(plan.entity.index_u32());
        world.resource_mut::<Funds>().0 += i64::from(plan.payout);
        let mut state = world.resource_mut::<LotEditState>();
        state.revision = state.revision.saturating_add(1);
        payout = Some(plan.payout);
    }
    world.resource_mut::<LotEditState>().last_sale_result = Some(SaleResult {
        object,
        payout,
        reason,
    });
}

#[cfg(test)]
#[path = "sale_tests.rs"]
mod tests;
