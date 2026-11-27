//! The accumulated mood effect of empty and nearly full needs.

use bevy_ecs::prelude::*;
use terri_core::{save_v17::SavedOrderActor, Agent, FnvHasher, Needs, NEED_MIN};

use crate::Content;

const UNITS_PER_POINT: i32 = 6000;
pub const MAX_UNITS: i32 = 100 * UNITS_PER_POINT;

/// One Sim's need mood in fixed units. A missing component means zero.
#[derive(Component, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[component(storage = "SparseSet")]
pub struct NeedMood(pub i32);

impl NeedMood {
    pub(crate) fn points(self) -> f32 {
        self.0 as f32 / UNITS_PER_POINT as f32
    }
}

pub(crate) fn accrue(
    mut commands: Commands,
    content: Res<Content>,
    mut people: Query<(Entity, &Needs, Option<&mut NeedMood>), With<Agent>>,
) {
    let tuning = content.0.need_mood;
    for (person, needs, current) in &mut people {
        let mut delta = 0;
        for &level in needs.as_slice() {
            if level == NEED_MIN {
                delta -= tuning.empty_loss_units;
            } else if level >= tuning.high_level {
                delta += tuning.high_gain_units;
            }
        }
        if delta == 0 {
            continue;
        }
        if let Some(mut current) = current {
            current.0 = (current.0 + delta).clamp(-MAX_UNITS, MAX_UNITS);
        } else {
            commands
                .entity(person)
                .insert(NeedMood(delta.clamp(-MAX_UNITS, MAX_UNITS)));
        }
    }
}

pub(crate) fn rows(world: &World) -> Vec<(SavedOrderActor, i32)> {
    let Some(mut query) =
        world.try_query_filtered::<(Entity, &NeedMood), (With<Agent>, With<Needs>)>()
    else {
        return Vec::new();
    };
    let mut rows: Vec<_> = query
        .iter(world)
        .filter(|(_, mood)| mood.0 != 0)
        .filter_map(|(person, mood)| {
            crate::player_actions::saved_actor(world, person).map(|actor| (actor, mood.0))
        })
        .collect();
    rows.sort_unstable();
    rows
}

pub(crate) fn hash(world: &World, hasher: &mut FnvHasher) {
    let rows = rows(world);
    if rows.is_empty() {
        return;
    }
    hasher.write_bytes(b"need-mood-v1");
    hasher.write_u64(rows.len() as u64);
    for (actor, units) in rows {
        let (kind, id) = match actor {
            SavedOrderActor::Sim(id) => (0, id),
            SavedOrderActor::Entity(index) => (1, index),
        };
        hasher.write_u64(kind);
        hasher.write_u64(u64::from(id));
        hasher.write_bytes(&units.to_le_bytes());
    }
}
