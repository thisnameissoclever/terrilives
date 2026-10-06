//! Retire one historical table command only after restoring its complete source.
use super::{action_refs, v6, SaveError};
use crate::{portals::ActivePortals, Sim};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Mutex, OnceLock},
};
use terri_core::{SaveSnapshotV6, SavedCommand};
use terri_data::ContentPack;

const MODEL: &str = "dining_table";
const ACTION: &str = "sit_properly";

fn compatibility_pack(
    destination: &'static ContentPack,
) -> Result<&'static ContentPack, SaveError> {
    static PACKS: OnceLock<Mutex<BTreeMap<usize, &'static ContentPack>>> = OnceLock::new();
    let mut packs = PACKS
        .get_or_init(Default::default)
        .lock()
        .expect("compatibility cache lock");
    let key = destination as *const ContentPack as usize;
    if let Some(pack) = packs.get(&key) {
        return Ok(pack);
    }
    let old = terri_data::published_pre_books_pack();
    let source = old.object(old.find(MODEL).ok_or(SaveError::InvalidContentReference)?);
    let id = destination
        .find(MODEL)
        .ok_or(SaveError::InvalidContentReference)?;
    let target = destination.object(id);
    let retained_table = target
        .interactions
        .iter()
        .map(|action| action.id.as_str())
        .eq(["sit_properly", "take_prepared_food"]);
    if (!target.interactions.is_empty() && !retained_table)
        || action_refs::object_structure(source, false)
            != action_refs::object_structure(target, false)
        || source
            .roles
            .iter()
            .map(|&r| &old.roles[r as usize])
            .collect::<BTreeSet<_>>()
            != target
                .roles
                .iter()
                .map(|&r| &destination.roles[r as usize])
                .collect::<BTreeSet<_>>()
    {
        return Err(SaveError::IncompatibleContent);
    }
    let mut pack = destination.clone();
    pack.objects[id.0 as usize].interactions = source.interactions.clone();
    // Content holds immutable process-lifetime references. Retain one adapter
    // per destination pack, never per load or per value supplied by a save.
    let pack: &'static ContentPack = Box::leak(Box::new(pack));
    packs.insert(key, pack);
    Ok(pack)
}

pub(super) fn needed(snapshot: &SaveSnapshotV6, content: &ContentPack) -> bool {
    let _ = content;
    snapshot
        .actions
        .objects
        .iter()
        .any(|o| o.model == MODEL && o.interactions == [ACTION])
}

pub(super) fn restore(
    snapshot: SaveSnapshotV6,
    content: &'static ContentPack,
    portals: Option<ActivePortals>,
    migration: bool,
) -> Result<Sim, SaveError> {
    let source = snapshot
        .actions
        .objects
        .iter()
        .find(|o| o.model == MODEL)
        .ok_or(SaveError::InvalidContentReference)?;
    if source.interactions != [ACTION] || !source.advertised_chains.is_empty() {
        return Err(SaveError::InvalidContentReference);
    }
    let compatibility = compatibility_pack(content)?;
    // Restore checks entity ownership, indices, queue identities, books and
    // seat claims before the retired records can erase evidence of corruption.
    let verified = v6::restore_inner(snapshot, compatibility, portals, migration)?;
    let mut retired = verified.save_snapshot_v6();
    retire(&mut retired);
    retired.actions =
        action_refs::capture_origins(&retired.legacy, content, &retired.chain_origins);
    v6::restore_inner(retired, content, portals, false)
}

fn stop_table_uses(snapshot: &mut terri_core::SaveSnapshotV5) -> (BTreeSet<u32>, BTreeSet<u32>) {
    let tables: BTreeSet<_> = snapshot
        .world
        .entities
        .iter()
        .filter(|e| e.smart_object.as_deref() == Some(MODEL))
        .map(|e| e.index)
        .collect();
    let retired = |object: u32, row: u32| tables.contains(&object) && row == 0;
    let mut stopped = BTreeSet::new();
    let mut released = BTreeSet::new();
    let mut removed_waiters = BTreeSet::new();
    for entity in &mut snapshot.world.entities {
        if entity
            .target
            .is_some_and(|t| retired(t.object, t.interaction))
            || entity
                .eating
                .as_ref()
                .is_some_and(|e| e.object == MODEL && e.interaction == 0)
        {
            stopped.insert(entity.index);
            if let Some(target) = entity.target {
                released.insert(target.object);
            }
            entity.target = None;
            entity.eating = None;
            entity.path = None;
            entity.fumbled_delta_scale = None;
            entity.restless = true;
        }
        if let Some(intents) = &mut entity.intents {
            if intents.iter().any(|i| retired(i.object, i.interaction)) {
                removed_waiters.insert(entity.index);
            }
            intents.retain(|i| !retired(i.object, i.interaction));
        }
        if let Some(memory) = &mut entity.habituation {
            memory.retain(|m| !(m.object == MODEL && m.interaction == 0));
        }
        if let Some(personality) = &mut entity.personality {
            personality
                .dispositions
                .retain(|m| !(m.object == MODEL && m.interaction == 0));
        }
    }
    let claimed: BTreeSet<_> = snapshot
        .world
        .entities
        .iter()
        .filter_map(|e| e.target.map(|t| t.object))
        .collect();
    for entity in &mut snapshot.world.entities {
        if released.contains(&entity.index) && !claimed.contains(&entity.index) {
            entity.reserved = false;
        }
    }
    snapshot.waiting_needs.retain(|(person, target, _)| {
        !(stopped.contains(person) || tables.contains(target) && removed_waiters.contains(person))
    });
    // Ending an action also ends its physical place and published lease.
    // Other diners and media users retain their exact ownership records.
    if let Some(dining) = &mut snapshot.dining {
        dining
            .diners
            .retain(|lease| !stopped.contains(&lease.person));
        dining
            .complaints
            .retain(|(person, _)| !stopped.contains(person));
    }
    snapshot
        .boundaries
        .retain(|b| !b.goal.is_some_and(|(object, row)| retired(object, row)));
    (tables, stopped)
}

pub(super) fn retire_pre_books(snapshot: &mut terri_core::SaveSnapshotV5) {
    let (tables, _) = stop_table_uses(snapshot);
    snapshot.world.queued_commands.retain(|command| !matches!(command,
        SavedCommand::UseObject { object, interaction, .. } | SavedCommand::UseObjectFirst { object, interaction, .. }
        if tables.contains(object) && *interaction == 0));
}

fn retire(snapshot: &mut SaveSnapshotV6) {
    let (tables, stopped) = stop_table_uses(&mut snapshot.legacy);
    snapshot
        .seats
        .retain(|seat| !stopped.contains(&seat.person));
    let retired = |object: u32, row: u32| tables.contains(&object) && row == 0;
    for queue in &mut snapshot.queues {
        queue
            .orders
            .retain(|o| !(tables.contains(&o.target) && o.action == "interaction:sit_properly"));
    }
    let ordinary = std::mem::take(&mut snapshot.legacy.world.queued_commands);
    let mut commands = ordinary.into_iter();
    snapshot.command_order.retain(|row| {
        if row.is_some() { return true; }
        let command = commands.next().expect("validated command order");
        if matches!(&command, SavedCommand::UseObject { object, interaction, .. } | SavedCommand::UseObjectFirst { object, interaction, .. } if retired(*object, *interaction)) { return false; }
        snapshot.legacy.world.queued_commands.push(command);
        true
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn repeated_retirement_loads_reuse_one_pack_per_immutable_destination() {
        let destination = terri_data::pack();
        let first = super::compatibility_pack(destination).unwrap();
        for _ in 0..100 {
            assert!(std::ptr::eq(
                first,
                super::compatibility_pack(destination).unwrap()
            ));
        }
        let other = Box::leak(Box::new(destination.clone()));
        let other_first = super::compatibility_pack(other).unwrap();
        assert!(!std::ptr::eq(first, other_first));
        assert!(std::ptr::eq(
            other_first,
            super::compatibility_pack(other).unwrap()
        ));
    }
}
