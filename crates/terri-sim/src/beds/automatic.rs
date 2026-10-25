//! Stable automatic ownership, separate from temporary sleeping occupancy.
use super::{navigation::Access, Admission, BedAssignments, BedPlace, Preference};
use bevy_ecs::prelude::*;
use std::collections::{HashMap, HashSet};
use terri_core::{Agent, Position, SimId, SmartObject, TileGrid};

pub(crate) fn assign(world: &mut World) {
    let pack = world.resource::<crate::Content>().0;
    if pack.sleep_tag.is_empty() {
        return;
    }
    let mut query = world.query_filtered::<(Entity, &SimId, &Position), With<Agent>>();
    let known = world.resource::<BedAssignments>();
    let mut people: Vec<_> = query
        .iter(world)
        .filter(|(_, id, _)| known.assigned_to(**id).is_none())
        .map(|(e, id, p)| (e, *id, *p))
        .collect();
    if people.is_empty() {
        return;
    }
    people.sort_unstable_by_key(|(e, id, _)| (id.0, e.index_u32()));
    let mut assignments = world.resource::<BedAssignments>().clone();
    let mut claimed: HashSet<_> = assignments
        .iter()
        .map(|(_, p)| (p.bed, p.ordinal))
        .collect();
    let beds: Vec<_> = world
        .query::<(
            Entity,
            &SmartObject,
            &Position,
            Option<&terri_core::ObjectFacing>,
        )>()
        .iter(world)
        .filter_map(|(e, o, p, f)| {
            let definition = pack.objects.get(o.0 .0 as usize)?;
            (0..super::capacity(pack, definition))
                .any(|ordinal| !claimed.contains(&(e, ordinal)))
                .then_some((e, definition, *p, f.map_or(definition.base_facing, |f| f.0)))
        })
        .collect();
    let grid = world.resource::<TileGrid>();
    let mut fields = HashMap::new();
    for (_, person, position) in people {
        if assignments.assigned_to(person).is_some() {
            continue;
        }
        if !beds.iter().any(|(bed, definition, _, _)| {
            (0..super::capacity(pack, definition))
                .any(|ordinal| !claimed.contains(&(*bed, ordinal)))
        }) {
            break;
        }
        let from = (position.x.round() as i32, position.y.round() as i32);
        let Some(field) = fields
            .entry(from)
            .or_insert_with(|| grid.distance_field(from))
            .as_ref()
        else {
            continue;
        };
        let mut best = None;
        for &(bed, definition, origin, facing) in &beds {
            let access = Access::new(
                definition,
                &pack.sleep_tag,
                facing,
                (origin.x.round() as i32, origin.y.round() as i32),
                field,
            );
            for ordinal in 0..super::capacity(pack, definition) {
                let place = BedPlace { bed, ordinal };
                if claimed.contains(&(bed, ordinal)) {
                    continue;
                }
                if let Some(route) = access.for_admission(Admission::Sleep {
                    ordinal,
                    preference: Preference::Unassigned,
                }) {
                    let key = (route.distance, bed.index_u32(), ordinal);
                    if best.is_none_or(|(old, _)| key < old) {
                        best = Some((key, place));
                    }
                }
            }
        }
        if let Some((_, place)) = best {
            claimed.insert((place.bed, place.ordinal));
            assignments.set(person, Some(place));
        }
    }
    world.insert_resource(assignments);
}
