//! Release the commitment that ended without freeing another owner's object.

use bevy_ecs::prelude::*;
use terri_core::{Reserved, Target};

/// Defer the ownership check with the state changes it must observe. Earlier
/// releases and claims in this command batch are then visible to this one.
pub(crate) fn release(commands: &mut Commands, owner: Entity, expected: Target) {
    commands.queue(move |world: &mut World| release_now(world, owner, expected));
}

/// Release only the expected commitment's marker. The caller removes its
/// action state. A replacement target on the same object remains an owner,
/// as does every other Sim still travelling or acting.
pub(crate) fn release_now(world: &mut World, owner: Entity, expected: Target) {
    if world
        .get::<Target>(owner)
        .is_none_or(|target| *target == expected)
    {
        if let Ok(mut owner) = world.get_entity_mut(owner) {
            owner.remove::<terri_core::SleepPlace>();
        }
    }
    let occupied = world
        .query::<(Entity, &Target)>()
        .iter(world)
        .any(|(entity, target)| {
            target.object == expected.object && (entity != owner || *target != expected)
        });
    if !occupied {
        if let Ok(mut object) = world.get_entity_mut(expected.object) {
            object.remove::<Reserved>();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy_ecs::world::CommandQueue;

    fn fixture() -> (World, Entity, Entity, Entity, Target) {
        let mut world = World::new();
        let object = world.spawn(Reserved).id();
        let target = Target {
            object,
            interaction: 0,
        };
        let first = world.spawn(target).id();
        let second = world.spawn(target).id();
        (world, object, first, second, target)
    }

    #[test]
    fn one_departure_preserves_the_other_owner_and_last_departure_frees_object() {
        let (mut world, object, first, second, target) = fixture();
        release_now(&mut world, first, target);
        assert_eq!(world.get::<Target>(first), Some(&target));
        assert_eq!(world.get::<Target>(second), Some(&target));
        assert!(world.get::<Reserved>(object).is_some());
        world.entity_mut(first).remove::<Target>();
        release_now(&mut world, second, target);
        assert!(world.get::<Reserved>(object).is_none());
    }

    #[test]
    fn simultaneous_deferred_departures_observe_earlier_target_removal() {
        let (mut world, object, first, second, target) = fixture();
        let mut queue = CommandQueue::default();
        let mut commands = Commands::new(&mut queue, &world);
        release(&mut commands, first, target);
        commands.entity(first).remove::<Target>();
        release(&mut commands, second, target);
        commands.entity(second).remove::<Target>();
        queue.apply(&mut world);
        assert!(world.get::<Target>(first).is_none());
        assert!(world.get::<Target>(second).is_none());
        assert!(world.get::<Reserved>(object).is_none());
    }

    #[test]
    fn stale_release_preserves_replacement_on_the_same_object() {
        let (mut world, object, first, second, target) = fixture();
        world.despawn(second);
        let replacement = Target {
            interaction: 1,
            ..target
        };
        let mut queue = CommandQueue::default();
        let mut commands = Commands::new(&mut queue, &world);
        commands.entity(first).insert(replacement);
        release(&mut commands, first, target);
        queue.apply(&mut world);
        assert_eq!(world.get::<Target>(first), Some(&replacement));
        assert!(world.get::<Reserved>(object).is_some());
    }

    #[test]
    fn later_claim_restores_the_marker_after_last_owner_leaves() {
        let (mut world, object, first, second, target) = fixture();
        world.entity_mut(second).remove::<Target>();
        let mut queue = CommandQueue::default();
        let mut commands = Commands::new(&mut queue, &world);
        release(&mut commands, first, target);
        commands.entity(first).remove::<Target>();
        commands.entity(second).insert(target);
        commands.entity(object).insert(Reserved);
        queue.apply(&mut world);
        assert!(world.get::<Target>(first).is_none());
        assert_eq!(world.get::<Target>(second), Some(&target));
        assert!(world.get::<Reserved>(object).is_some());
    }

    #[test]
    fn earlier_claim_keeps_marker_when_previous_owner_leaves() {
        let (mut world, object, first, second, target) = fixture();
        world.entity_mut(second).remove::<Target>();
        let mut queue = CommandQueue::default();
        let mut commands = Commands::new(&mut queue, &world);
        commands.entity(second).insert(target);
        commands.entity(object).insert(Reserved);
        release(&mut commands, first, target);
        queue.apply(&mut world);
        assert_eq!(world.get::<Target>(second), Some(&target));
        assert!(world.get::<Reserved>(object).is_some());
    }

    #[test]
    fn vanished_owner_and_object_are_safe_to_release() {
        let (mut world, object, first, second, target) = fixture();
        world.despawn(first);
        release_now(&mut world, first, target);
        assert!(world.get::<Reserved>(object).is_some());
        world.despawn(second);
        world.despawn(object);
        release_now(&mut world, first, target);
    }

    #[test]
    fn a_replacement_on_another_object_does_not_hold_the_old_marker() {
        let (mut world, object, first, second, target) = fixture();
        let other = world.spawn(Reserved).id();
        let replacement = Target {
            object: other,
            ..target
        };
        world.entity_mut(first).insert(replacement);
        release_now(&mut world, second, target);
        assert!(world.get::<Reserved>(object).is_none());
        assert!(world.get::<Reserved>(other).is_some());
        assert_eq!(world.get::<Target>(first), Some(&replacement));
    }
}
