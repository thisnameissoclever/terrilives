//! Directional opinion changes and observations of the last simulation tick.
//! Diagnostics are excluded from behavioral state.
use bevy_ecs::prelude::*;
use terri_core::{Relationships, SimClock, SimId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RelationshipCause {
    Conversation,
    LowNeedInterruption,
    CriticalNeedInterruption,
    PrivacyEntry,
    PrivacyStart,
    Proximity,
    SharedActivity,
    Incompatibility,
    Decay,
    HouseholdMess,
    ChoreFulfilled,
    ChoreNeglected,
    /// Another person using something the affected person hates - [OA-use].
    Nuisance,
    /// A finished fight, felt by both sides (fights, issue 248).
    Fight,
    /// A completed portion of another person's cooked meal.
    MealShared,
}

#[derive(Debug, Clone, Copy)]
pub struct RelationshipEffect {
    pub tick: u64,
    /// One privacy action shares this number across all its victims.
    pub event: u32,
    pub cause: RelationshipCause,
    pub responsible: SimId,
    pub affected: SimId,
    pub requested: f32,
    pub actual: f32,
    pub emergency: bool,
    pub directed: bool,
}

#[derive(Resource, Default, Clone)]
#[doc(hidden)]
pub struct RelationshipDiagnostics {
    pub(crate) effects: Vec<RelationshipEffect>,
    pub(crate) contacts: Vec<(SimId, SimId)>,
    pub(crate) waits: Vec<(SimId, bool, u64)>,
}

impl crate::Sim {
    /// Actor, whether private use is waiting to start, and elapsed blocked minutes.
    pub fn privacy_waits(&self) -> &[(SimId, bool, u64)] {
        &self.world().resource::<RelationshipDiagnostics>().waits
    }

    pub fn compatibility(&self, subject: SimId, other: SimId) -> Option<f32> {
        let world = self.world();
        let mut q = world.try_query::<(Entity, &SimId)>()?;
        let a = q.iter(world).find(|(_, id)| **id == subject)?.0;
        let b = q.iter(world).find(|(_, id)| **id == other)?.0;
        let profile = |e| {
            crate::compatibility::preferences(
                world.resource::<crate::Content>().0,
                world.get::<terri_core::Personality>(e),
                world.get::<terri_core::Traits>(e),
                world.get::<terri_core::Hobbies>(e),
            )
        };
        Some(crate::compatibility::between(&profile(a), &profile(b)))
    }
    pub fn relationship_effects(&self) -> &[RelationshipEffect] {
        &self.world().resource::<RelationshipDiagnostics>().effects
    }

    pub fn relationship_contacts(&self) -> &[(SimId, SimId)] {
        &self.world().resource::<RelationshipDiagnostics>().contacts
    }
}

pub(crate) fn reset(world: &mut World) {
    let mut diagnostics = world.resource_mut::<RelationshipDiagnostics>();
    diagnostics.effects.clear();
    diagnostics.contacts.clear();
    diagnostics.waits.clear();
}

/// Family and partners strengthen support and soften interpersonal harm.
/// Neutral drift and explicit saved or edited values retain their own rules.
pub(crate) fn opinion_delta(
    family: Option<&terri_core::layout::FamilyTies>,
    affected: SimId,
    responsible: SimId,
    cause: RelationshipCause,
    delta: f32,
) -> f32 {
    if cause == RelationshipCause::Decay
        || family.is_none_or(|ties| ties.relation(affected.0, responsible.0).is_none())
    {
        return delta;
    }
    delta * if delta > 0. { 1.5 } else { 0.5 }
}

pub(crate) fn scaled_opinion_delta(
    world: &World,
    affected: SimId,
    responsible: SimId,
    cause: RelationshipCause,
    delta: f32,
) -> f32 {
    opinion_delta(
        world.get_resource::<terri_core::layout::FamilyTies>(),
        affected,
        responsible,
        cause,
        delta,
    )
}

/// Apply one directional opinion change and record its clamped result.
pub(crate) fn record_opinion_change(
    world: &mut World,
    responsible: u32,
    affected: Entity,
    delta: f32,
    cause: RelationshipCause,
) {
    let Some(subject) = world.get::<SimId>(affected).copied() else {
        return;
    };
    if subject.0 == responsible {
        return;
    }
    let delta = scaled_opinion_delta(world, subject, SimId(responsible), cause, delta);
    if world.get::<Relationships>(affected).is_none() {
        world.entity_mut(affected).insert(Relationships::default());
    }
    let before = world
        .get::<Relationships>(affected)
        .unwrap()
        .feeling(SimId(responsible));
    world
        .get_mut::<Relationships>(affected)
        .unwrap()
        .bump(SimId(responsible), delta);
    let after = world
        .get::<Relationships>(affected)
        .unwrap()
        .feeling(SimId(responsible));
    let tick = world.resource::<SimClock>().tick;
    world
        .resource_mut::<RelationshipDiagnostics>()
        .effects
        .push(RelationshipEffect {
            tick,
            event: 0,
            cause,
            responsible: SimId(responsible),
            affected: subject,
            requested: delta,
            actual: after - before,
            emergency: false,
            directed: false,
        });
}
