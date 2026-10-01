//! Observations of the last simulation tick, excluded from behavioral state.
use bevy_ecs::prelude::*;
use terri_core::SimId;

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

#[derive(Resource, Default)]
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
