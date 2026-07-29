use bevy_ecs::prelude::*;
use terri_core::{Eating, Path, Position, SimRng, SmartObject, Target};

use super::advertise::TILES_PER_TICK;
use super::interact::sample_duration;
use crate::Content;

/// Tiles travelled per tick. Imported rather than redeclared so the
/// scoring function's travel estimate cannot silently drift out of step
/// with actual movement.
const SPEED: f32 = TILES_PER_TICK;

/// Advances agents along their path. On arrival, converts the target
/// into an in-progress interaction.
pub fn follow_path(
    mut commands: Commands,
    content: Res<Content>,
    mut rng: ResMut<SimRng>,
    mut agents: Query<(Entity, &mut Position, &mut Path, &Target)>,
    objects: Query<&SmartObject>,
) {
    for (entity, mut pos, mut path, target) in &mut agents {
        let Some((tx, ty)) = path.next_step() else {
            // Path exhausted: begin the interaction.
            let Ok(placed) = objects.get(target.object) else {
                commands.entity(entity).remove::<Path>().remove::<Target>();
                continue;
            };
            // Both indices are in range by construction: `select_action`
            // read them out of this same pack when it scored the advert,
            // and the pack is fixed at build time.
            let act = &content.0.object(placed.0).interactions[target.interaction as usize];
            // The content duration is a CENTRE, per [D-4]. This is the
            // one place the actual length of an interaction is decided,
            // so it is the one place that draws for it - and it draws
            // from the world's seeded generator like every other
            // decision, which is what keeps a replay a replay.
            //
            // The draw happens here rather than at selection on purpose.
            // Scoring weighs an interaction by its content duration
            // because that is what an advert can honestly promise; the
            // sim only finds out how long this particular meal took by
            // sitting through it.
            let tuning = &content.0.tuning;
            let remaining_ticks = sample_duration(
                act.duration_ticks,
                tuning.duration_variance,
                tuning.min_interaction_ticks,
                &mut rng,
            );
            commands.entity(entity).remove::<Path>().insert(Eating {
                object: placed.0,
                interaction: target.interaction,
                remaining_ticks,
            });
            continue;
        };

        let dx = tx as f32 - pos.x;
        let dy = ty as f32 - pos.y;
        let dist = (dx * dx + dy * dy).sqrt();

        if dist <= SPEED {
            pos.x = tx as f32;
            pos.y = ty as f32;
            path.cursor += 1;
        } else {
            pos.x += dx / dist * SPEED;
            pos.y += dy / dist * SPEED;
        }
    }
}
