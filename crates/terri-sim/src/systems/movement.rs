use bevy_ecs::prelude::*;
use terri_core::{Eating, Path, Position, SmartObject, Target};

use super::advertise::TILES_PER_TICK;

/// Tiles travelled per tick. Imported rather than redeclared so the
/// scoring function's travel estimate cannot silently drift out of step
/// with actual movement.
const SPEED: f32 = TILES_PER_TICK;

/// Advances agents along their path. On arrival, converts the target
/// into an in-progress interaction.
pub fn follow_path(
    mut commands: Commands,
    mut agents: Query<(Entity, &mut Position, &mut Path, &Target)>,
    objects: Query<&SmartObject>,
) {
    for (entity, mut pos, mut path, target) in &mut agents {
        let Some((tx, ty)) = path.next_step() else {
            // Path exhausted: begin the interaction.
            let Ok(advert) = objects.get(target.0) else {
                commands.entity(entity).remove::<Path>().remove::<Target>();
                continue;
            };
            let duration = advert.duration_ticks.max(1);
            commands.entity(entity).remove::<Path>().insert(Eating {
                remaining_ticks: duration,
                delta_per_tick: advert.hunger_delta / duration as f32,
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
