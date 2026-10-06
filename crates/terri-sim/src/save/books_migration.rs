//! Published saves enter the frozen content first, then acquire current book state.

use super::{action_refs, architecture, v6, SaveError};
use crate::{books::BookLibrary, portals::ActivePortals, Content, Sim};
use std::collections::{BTreeMap, BTreeSet};
use terri_core::{
    SaveSnapshotV1, SaveSnapshotV2, SaveSnapshotV3, SaveSnapshotV4, SaveSnapshotV5, SaveSnapshotV6,
    SavedCommand,
};
use terri_data::ContentPack;

pub enum LegacySnapshot {
    V1(SaveSnapshotV1),
    V2(SaveSnapshotV2),
    V3(SaveSnapshotV3),
    V4(SaveSnapshotV4),
    V5(Box<SaveSnapshotV5>),
    V5Source(Box<SaveSnapshotV5>, PreBookSource),
}

#[derive(Clone, Copy, Debug)]
pub enum PreBookSource {
    AffinitiesBeforeChores,
    Latest,
}

/// Domain seed is fixed for migrated households. It consumes no saved RNG state,
/// does not depend on catalogue order/names, and persists in V6 thereafter.
const LEGACY_TASTE_SEED: u64 = 0x626f_6f6b_732d_7631;

pub(crate) fn restore(
    snapshot: LegacySnapshot,
    content: &'static ContentPack,
    portals: Option<ActivePortals>,
) -> Result<Sim, SaveError> {
    let (snapshot, source) = match snapshot {
        LegacySnapshot::V5Source(value, source) => (LegacySnapshot::V5(value), Some(source)),
        value => (value, None),
    };
    let saved_skills = match &snapshot {
        LegacySnapshot::V5(value) => value.skills.clone(),
        _ => None,
    };
    let saved_affinities = match &snapshot {
        LegacySnapshot::V5(value) => value.affinities.clone(),
        _ => None,
    };
    let modern = match &snapshot {
        LegacySnapshot::V5(value) => {
            value.targeted_cleanup.is_some() || value.chores.is_some() || value.grime.is_some()
        }
        _ => false,
    };
    let frozen = match source {
        Some(PreBookSource::Latest) => terri_data::latest_pre_books_pack(),
        Some(PreBookSource::AffinitiesBeforeChores) => terri_data::affinity_pre_books_pack(),
        None if modern => terri_data::latest_pre_books_pack(),
        None if saved_affinities.is_some() => terri_data::affinity_pre_books_pack(),
        None if saved_skills.is_some() => terri_data::published_pre_books_pack(),
        None => Content::pre_books().0,
    };
    let (mut verified, has_sleeping) = match snapshot {
        LegacySnapshot::V1(value) => (super::restore(value, frozen, portals)?, false),
        LegacySnapshot::V2(value) => (architecture::restore(value, frozen, portals)?, false),
        LegacySnapshot::V3(value) => (architecture::restore_v3(value, frozen, portals)?, false),
        LegacySnapshot::V4(value) => (architecture::restore_v4(value, frozen, portals)?, false),
        LegacySnapshot::V5(value) => (architecture::restore_v5(*value, frozen, portals)?, true),
        LegacySnapshot::V5Source(..) => unreachable!("source tag normalized above"),
    };
    crate::seating::validate_exclusive(&verified.world)?;
    if !has_sleeping {
        super::sleeping_places::migrate_legacy(&mut verified.world)?;
    }
    super::yard::grow(&mut verified, frozen);
    super::self_preservation::migrate(&mut verified.world);
    let mut legacy = verified.save_snapshot_v5();
    // Source restoration validates IDs, owners and values. Preserve the input
    // practice so only the destination ladder clamps it; an intermediate
    // historical ladder must not discard competence the new ladder can hold.
    legacy.skills = saved_skills;
    legacy.affinities = saved_affinities;
    end_legacy_reading(&mut legacy, frozen);
    if !terri_data::is_latest_pre_books_pack(frozen) {
        super::table_retirement::retire_pre_books(&mut legacy);
    }
    let actions = action_refs::capture(&legacy, frozen);
    let books = BookLibrary::new(LEGACY_TASTE_SEED).state().clone();
    let mut candidate = v6::restore_migrated(
        SaveSnapshotV6 {
            recipe_orders: Vec::new(),
            chain_origins: crate::recipe_actions::historical(&legacy)?,
            queues: v6::historical_queues(&legacy, &actions),
            command_order: vec![None; legacy.world.queued_commands.len()],
            legacy,
            actions,
            books,
            seats: vec![],
            reading: vec![],
            pending_shifts: vec![],
        },
        content,
        portals,
    )?;
    let mut library = candidate.world.resource::<BookLibrary>().clone();
    v6::with_book_world(&candidate.world, |context| {
        library.grant_migration_starters(context)
    })?;
    candidate.world.insert_resource(library);
    candidate.world.insert_resource(Content(content));
    candidate
        .world
        .insert_resource(crate::books::LegacyBookImportNotice(true));
    Ok(candidate)
}

fn end_legacy_reading(snapshot: &mut SaveSnapshotV5, pack: &ContentPack) {
    let objects: BTreeMap<_, _> = snapshot
        .world
        .entities
        .iter()
        .filter_map(|e| e.smart_object.as_ref().map(|id| (e.index, id.clone())))
        .collect();
    let reading = |model: &str, row: u32| {
        pack.find(model)
            .and_then(|id| pack.object(id).interactions.get(row as usize))
            .is_some_and(|a| a.tags.iter().any(|tag| tag == "reading"))
    };
    let reads_object =
        |object: u32, row: u32| objects.get(&object).is_some_and(|id| reading(id, row));
    let mut stopped = BTreeSet::new();
    let mut released = BTreeSet::new();
    for entity in &mut snapshot.world.entities {
        if entity
            .target
            .is_some_and(|target| reads_object(target.object, target.interaction))
            || entity
                .eating
                .as_ref()
                .is_some_and(|action| reading(&action.object, action.interaction))
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
            intents.retain(|intent| !reads_object(intent.object, intent.interaction));
        }
    }
    let targets: BTreeSet<_> = snapshot
        .world
        .entities
        .iter()
        .filter_map(|e| e.target.map(|t| t.object))
        .collect();
    for entity in &mut snapshot.world.entities {
        if released.contains(&entity.index) && !targets.contains(&entity.index) {
            entity.reserved = false;
        }
    }
    snapshot
        .waiting_needs
        .retain(|(person, _, _)| !stopped.contains(person));
    snapshot.world.queued_commands.retain(|command| !matches!(command,
        SavedCommand::UseObject { object, interaction, .. } | SavedCommand::UseObjectFirst { object, interaction, .. } if reads_object(*object, *interaction)));
    snapshot.boundaries.retain(|boundary| {
        !boundary
            .goal
            .is_some_and(|(object, row)| reads_object(object, row))
    });
}
