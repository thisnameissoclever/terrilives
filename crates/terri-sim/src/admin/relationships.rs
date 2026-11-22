//! The Relationships tab's edits ([AP-e-rel]): feelings and fights. Both
//! people named must be living members of the household, and not the same
//! one ([`AdminRefusal::SamePerson`]).
use super::housemate::person;
use super::AdminRefusal;
use crate::{fights, Content};
use bevy_ecs::prelude::*;
use terri_core::admin::AdminEdit;
use terri_core::{AtWork, CommandQueue, Commuting, Relationships, SimCommand, SimId};

/// Whether the person is off the lot or on the way: a fight order cannot be
/// served until they are home, so the edit is refused ([AP-e-fight]).
fn busy(world: &World, person: Entity) -> bool {
    world.get::<AtWork>(person).is_some() || world.get::<Commuting>(person).is_some()
}

pub(super) fn validate(world: &World, change: &AdminEdit) -> Result<(), AdminRefusal> {
    match *change {
        AdminEdit::SetFeeling { from, to, .. } => {
            person(world, from)?;
            person(world, to)?;
            if from == to {
                return Err(AdminRefusal::SamePerson);
            }
            Ok(())
        }
        AdminEdit::StartFight { from, to } => {
            let actor = person(world, from)?;
            let target = person(world, to)?;
            if from == to {
                return Err(AdminRefusal::SamePerson);
            }
            if busy(world, actor) || busy(world, target) {
                return Err(AdminRefusal::Busy);
            }
            fights::fight_index(world.resource::<Content>().0)
                .ok_or(AdminRefusal::UnknownContent)?;
            // A full order queue would drop the order the edit reports as
            // applied, so it is refused here instead.
            if crate::systems::command::back_order_refused(world, actor) {
                return Err(AdminRefusal::Busy);
            }
            Ok(())
        }
        _ => unreachable!("routed to the relationship edits by `group`"),
    }
}

pub(super) fn apply(world: &mut World, change: &AdminEdit) {
    match *change {
        AdminEdit::SetFeeling { from, to, value } => {
            let entity = person(world, from).expect("validated");
            let mut feelings = world
                .get::<Relationships>(entity)
                .cloned()
                .unwrap_or_default();
            feelings.set(SimId(to), value);
            world.entity_mut(entity).insert(feelings);
        }
        AdminEdit::StartFight { from, to } => {
            let actor = person(world, from).expect("validated");
            let target = person(world, to).expect("validated");
            let fight = fights::fight_index(world.resource::<Content>().0).expect("validated");
            // The same order a player's talk order with the fighting row
            // queues, placed behind what the person already holds. It runs
            // when play resumes, and the topic is drawn when the fight
            // begins, not here ([AP-c-topic]). The person is home, so no
            // work conflict can hold the order for a confirmation.
            world
                .resource_mut::<CommandQueue>()
                .push(SimCommand::TalkTo {
                    agent: actor.index_u32(),
                    target: target.index_u32(),
                    interaction: fight,
                });
            crate::systems::lot_edit::flush_ordinary(world);
        }
        _ => unreachable!("routed to the relationship edits by `group`"),
    }
}
