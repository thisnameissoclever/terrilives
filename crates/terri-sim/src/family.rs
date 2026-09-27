//! Family ties: who the household are to each other - [FM-tie] in
//! `docs/specs/2026-09-22-family.md`.
//!
//! A tie is a fact about two people and nothing else: it moves nobody, blocks
//! nothing, and costs nothing. What is checked is that both people are sims
//! this world has, and that they are two people rather than one.

use crate::placement::{LotEditState, PlacementRefusal};
use bevy_ecs::prelude::*;
use terri_core::layout::{FamilyTies, Relation};
use terri_core::Agent;

/// What the drain did with the most recent tie. `reason` is `None` when it
/// was applied, including when the tie was already what was asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FamilyTieResult {
    pub who: u32,
    pub to: u32,
    pub relation: Option<Relation>,
    pub reason: Option<PlacementRefusal>,
}

/// Whether this entity index belongs to a sim of this world.
pub fn is_sim(world: &World, index: u32) -> bool {
    bevy_ecs::entity::EntityIndex::from_raw_u32(index)
        .map(|index| world.entities().resolve_from_index(index))
        .and_then(|entity| world.get_entity(entity).ok())
        .is_some_and(|entity| entity.contains::<Agent>())
}

/// The checks, shared by the preview and the commit.
pub fn validate(world: &World, who: u32, to: u32) -> Result<(), PlacementRefusal> {
    if who == to {
        return Err(PlacementRefusal::InvalidInput);
    }
    if !is_sim(world, who) || !is_sim(world, to) {
        return Err(PlacementRefusal::UnknownObject);
    }
    Ok(())
}

/// Revalidation and the write happen in one exclusive command drain.
pub(crate) fn commit(world: &mut World, who: u32, to: u32, relation: Option<Relation>) {
    let reason = validate(world, who, to).err();
    if reason.is_none() {
        let changed = match world.get_resource_mut::<FamilyTies>() {
            Some(mut family) => family.set(who, to, relation),
            None => {
                let mut fresh = FamilyTies::default();
                let changed = fresh.set(who, to, relation);
                world.insert_resource(fresh);
                changed
            }
        };
        if changed {
            let mut state = world.resource_mut::<LotEditState>();
            state.revision = state.revision.saturating_add(1);
        }
    }
    world.resource_mut::<LotEditState>().last_family_result = Some(FamilyTieResult {
        who,
        to,
        relation,
        reason,
    });
}
