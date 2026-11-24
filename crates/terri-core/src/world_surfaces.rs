use bevy_ecs::prelude::Resource;
use serde::{Deserialize, Serialize};

/// Row-major base surface: 0 is interior floor, 1 grass, 2 street.
/// Player floor coverings remain in SavedFloors and override this base.
#[derive(Resource, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldSurfaces {
    pub width: u32,
    pub height: u32,
    pub tiles: Vec<u8>,
}
