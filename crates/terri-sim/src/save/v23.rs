//! The lingering lift of liked furniture rides schema twenty-two: issue 344
//! (`docs/specs/2026-10-06-object-affinities.md`, [OA-presence]).
use super::SaveError;
use crate::{presence_fade::PresenceFade, Content, Sim};
use terri_core::{save_v23::SavedPresenceFade, SaveSnapshotV23, SimClock, SimId};
use terri_data::{AffinityReach, LONGEST_PRESENCE_FADE_TICKS};

/// Every fade, strictly ascending by person and then kind id, which is how
/// the saved affinity values are ordered too.
fn rows(sim: &Sim) -> Vec<SavedPresenceFade> {
    let pack = sim.world().resource::<Content>().0;
    let mut rows: Vec<SavedPresenceFade> =
        sim.world()
            .get_resource::<PresenceFade>()
            .map_or_else(Vec::new, |fade| {
                fade.entries()
                    .iter()
                    .filter_map(|&(person, kind, end_tick)| {
                        Some(SavedPresenceFade {
                            sim: person.0,
                            kind: pack.affinities.get(kind as usize)?.id.clone(),
                            end_tick,
                        })
                    })
                    .collect()
            });
    rows.sort_by(|a, b| (a.sim, &a.kind).cmp(&(b.sim, &b.kind)));
    rows
}

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV23 {
    SaveSnapshotV23 {
        legacy: super::v22::capture(sim),
        presence_fade: rows(sim),
    }
}

/// Capture a transaction baseline while leaving the live input queue intact.
pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV23 {
    SaveSnapshotV23 {
        legacy: super::v22::capture_without_commands(sim),
        presence_fade: rows(sim),
    }
}

/// Rows must be strictly ascending by person and then kind id, name a
/// living person and a kind with `presence` reach, and end after the saved
/// tick and no more than [`LONGEST_PRESENCE_FADE_TICKS`] later, which is as
/// far ahead as any tuning lets a fade run; anything else refuses the whole
/// save before the live world is touched. An unknown kind id is a content
/// mismatch, like an unknown affinity kind in the values.
pub(crate) fn restore(
    snapshot: SaveSnapshotV23,
    content: &'static terri_data::ContentPack,
    carried: super::Carried,
) -> Result<Sim, SaveError> {
    let rows = snapshot.presence_fade;
    if rows.len() > super::MAX_LIST_ENTRIES
        || rows
            .windows(2)
            .any(|pair| (pair[0].sim, &pair[0].kind) >= (pair[1].sim, &pair[1].kind))
    {
        return Err(SaveError::InvalidValue);
    }
    let mut candidate = super::v22::restore(snapshot.legacy, content, carried)?;
    let now = candidate.world().resource::<SimClock>().tick;
    let last = now.saturating_add(LONGEST_PRESENCE_FADE_TICKS);
    let mut entries = Vec::with_capacity(rows.len());
    for row in rows {
        let kind = content
            .affinities
            .iter()
            .position(|known| known.id == row.kind)
            .ok_or(SaveError::InvalidContentReference)?;
        if content.affinities[kind].reach != AffinityReach::Presence
            || crate::edit::living_entity(candidate.world(), row.sim).is_none()
            || row.end_tick <= now
            || row.end_tick > last
        {
            return Err(SaveError::InvalidValue);
        }
        entries.push((SimId(row.sim), kind as u32, row.end_tick));
    }
    candidate
        .world_mut()
        .insert_resource(PresenceFade::from_entries(entries));
    Ok(candidate)
}

#[cfg(test)]
#[path = "v23_tests.rs"]
mod tests;
