//! Family ties: who the household are to each other - [FM-tie] in
//! `docs/specs/2026-09-22-family.md`.
//!
//! A tie is a fact about two people and nothing else: it moves nobody, blocks
//! nothing, and costs nothing. What is checked is that both people are sims
//! this world has, and that they are two people rather than one.
//!
//! A command names the two people by entity index, as every command does,
//! because that is the handle the page holds for somebody alive now. The
//! drain turns both into SimIds before anything is stored, so a tie never
//! follows an entity slot to whoever occupies it next ([FM-identity]).

use crate::placement::{LotEditState, PlacementRefusal};
use bevy_ecs::prelude::*;
use terri_core::layout::{FamilyTies, Relation};
use terri_core::{Agent, SimId, SimIdAllocator};

/// What the drain did with the most recent tie, with the two people as the
/// command named them. `reason` is `None` when it was applied, including
/// when the tie was already what was asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FamilyTieResult {
    pub who: u32,
    pub to: u32,
    pub relation: Option<Relation>,
    pub reason: Option<PlacementRefusal>,
}

/// The SimId of the sim at this entity index, or `None` when the index is
/// not a sim of this world.
pub fn sim_id_at(world: &World, index: u32) -> Option<u32> {
    let entity = bevy_ecs::entity::EntityIndex::from_raw_u32(index)
        .map(|index| world.entities().resolve_from_index(index))
        .and_then(|entity| world.get_entity(entity).ok())?;
    if !entity.contains::<Agent>() {
        return None;
    }
    entity.get::<SimId>().map(|id| id.0)
}

/// Whether this SimId has ever been issued in this world. A tie may name
/// anybody who has been, which is what lets it outlive them being in the
/// house; an id the allocator never handed out is a corrupt save.
pub fn was_issued(world: &World, id: u32) -> bool {
    world
        .get_resource::<SimIdAllocator>()
        .is_some_and(|allocator| id < allocator.issued())
}

/// The checks, shared by the preview and the commit: the two people's
/// SimIds, in the order the command named them, when the tie can be made.
pub fn validate(world: &World, who: u32, to: u32) -> Result<(u32, u32), PlacementRefusal> {
    if who == to {
        return Err(PlacementRefusal::InvalidInput);
    }
    match (sim_id_at(world, who), sim_id_at(world, to)) {
        (Some(who), Some(to)) => Ok((who, to)),
        _ => Err(PlacementRefusal::UnknownObject),
    }
}

/// A list saved keyed on entity index, as the first build with ties wrote
/// it, turned into SimIds ([FM-identity]).
/// `None` when it is malformed or names somebody who is not a sim of the
/// loaded world. Each tie goes through `FamilyTies::set`, which stores it
/// from whichever of the two SimIds is lower, so a pair whose ids run the
/// other way from their indices is mirrored rather than misread.
pub fn from_index_ties(world: &World, saved: &FamilyTies) -> Option<FamilyTies> {
    let known = |index: u32| sim_id_at(world, index).is_some();
    let saved = FamilyTies::from_saved(saved.ties().to_vec(), &known)?;
    let mut family = FamilyTies::default();
    for &(low, high, code) in saved.ties() {
        family.set(
            sim_id_at(world, low)?,
            sim_id_at(world, high)?,
            Relation::from_code(code),
        );
    }
    Some(family)
}

/// Revalidation and the write happen in one exclusive command drain.
pub(crate) fn commit(world: &mut World, who: u32, to: u32, relation: Option<Relation>) {
    let checked = validate(world, who, to);
    let reason = checked.err();
    if let Ok((who, to)) = checked {
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

#[cfg(test)]
mod tests {
    use super::*;
    use terri_core::layout::Relation;

    /// [FM-identity]: a tie saved on entity indices is read as the two
    /// people's SimIds. Here the lower index holds the higher SimId, so the
    /// stored direction flips and the relation must be mirrored with it:
    /// the parent is still the parent.
    #[test]
    fn index_ties_become_sim_id_ties_mirrored_when_the_order_flips() {
        let mut world = World::new();
        world.insert_resource(SimIdAllocator::resumed(6));
        let parent = world.spawn((Agent, SimId(5))).id().index_u32();
        let child = world.spawn((Agent, SimId(2))).id().index_u32();
        let object = world.spawn_empty().id().index_u32();
        // An identity alone is not a person: it must be an agent too.
        let label = world.spawn(SimId(4)).id().index_u32();
        assert!(parent < child);
        assert_eq!(sim_id_at(&world, label), None);
        assert_eq!(sim_id_at(&world, object), None);
        assert_eq!(sim_id_at(&world, parent), Some(5));

        let mut saved = FamilyTies::default();
        assert!(saved.set(parent, child, Some(Relation::Parent)));
        let family = from_index_ties(&world, &saved).expect("both are sims");
        assert_eq!(family.ties(), [(2, 5, Relation::Child.code())]);
        assert_eq!(family.relation(5, 2), Some(Relation::Parent));

        // A saved index that is not a sim refuses the whole list.
        let mut stray = FamilyTies::default();
        assert!(stray.set(parent, object, Some(Relation::Sibling)));
        assert_eq!(from_index_ties(&world, &stray), None);
    }

    /// An id is known once the allocator has handed it out, and not before.
    #[test]
    fn a_sim_id_is_known_once_issued() {
        let mut world = World::new();
        assert!(!was_issued(&world, 0), "no allocator, nobody issued");
        world.insert_resource(SimIdAllocator::resumed(3));
        assert!(was_issued(&world, 2));
        assert!(!was_issued(&world, 3));
    }
}
