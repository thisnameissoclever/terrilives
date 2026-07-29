use std::fmt;

/// Every way content can be invalid.
///
/// These messages are read by whoever just broke the build, usually
/// somebody editing TOML rather than Rust, so each one names the
/// offending id and enough surrounding context to find the line. Vague
/// wording here is the difference between a five-second fix and a
/// confused half hour.
#[derive(Debug, PartialEq)]
pub enum ContentError {
    UnknownNeed {
        object: String,
        interaction: String,
        need: String,
    },
    MissingNeedDecay {
        need: String,
    },
    UnknownNeedDecay {
        need: String,
    },
    DuplicateNeedDecay {
        need: String,
    },
    DuplicateObjectId {
        id: String,
    },
    DuplicateInteractionId {
        object: String,
        id: String,
    },
    ZeroDuration {
        object: String,
        interaction: String,
    },
    ZeroSlots {
        object: String,
        interaction: String,
    },
    NonFiniteValue {
        context: String,
    },
    NegativeValue {
        context: String,
    },
    EmptyLot {
        width: u32,
        height: u32,
    },
    WallOutOfBounds {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    },
    /// Coordinates are the authored `f32` pair, not the tile, because
    /// that is what the author has to go and edit. They are always
    /// finite here: a non-finite coordinate is rejected earlier as a
    /// [`ContentError::NonFiniteValue`], which also keeps this variant's
    /// derived `PartialEq` from having to reason about NaN.
    PlacementOutOfBounds {
        object: String,
        x: f32,
        y: f32,
        width: u32,
        height: u32,
    },
    /// Coordinates are the TILE here, not the authored pair, because the
    /// tile is the thing that collides with the wall and it is not
    /// obvious from an `f32` which tile that is.
    PlacementOnWall {
        object: String,
        x: u32,
        y: u32,
    },
    UnknownPlacedObject {
        object: String,
    },
    /// An object names a sprite the atlas manifest does not hold. The
    /// same dangling-reference shape as [`ContentError::UnknownNeed`] and
    /// [`ContentError::UnknownPlacedObject`], across one more file.
    UnknownSprite {
        object: String,
        sprite: String,
    },
    /// The atlas has no sprite for a sim. Nothing in `content/` names it,
    /// so a designer cannot cause this; regenerating the atlas from a
    /// `build-atlas.ps1` that had dropped the sprite can.
    MissingSimSprite {
        sprite: String,
    },
}

impl fmt::Display for ContentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ContentError::UnknownNeed {
                object,
                interaction,
                need,
            } => write!(
                f,
                "object '{object}' interaction '{interaction}' advertises unknown need '{need}'"
            ),
            ContentError::MissingNeedDecay { need } => {
                write!(f, "needs.toml is missing a decay rate for '{need}'")
            }
            ContentError::UnknownNeedDecay { need } => {
                write!(f, "needs.toml declares unknown need '{need}'")
            }
            ContentError::DuplicateNeedDecay { need } => {
                write!(f, "needs.toml declares '{need}' more than once")
            }
            ContentError::DuplicateObjectId { id } => {
                write!(f, "duplicate object id '{id}'")
            }
            ContentError::DuplicateInteractionId { object, id } => {
                write!(
                    f,
                    "object '{object}' declares interaction '{id}' more than once"
                )
            }
            ContentError::ZeroDuration {
                object,
                interaction,
            } => write!(
                f,
                "object '{object}' interaction '{interaction}' has duration_ticks of 0; must be at least 1"
            ),
            ContentError::ZeroSlots {
                object,
                interaction,
            } => write!(
                f,
                "object '{object}' interaction '{interaction}' has slots of 0; must be at least 1"
            ),
            ContentError::NonFiniteValue { context } => {
                write!(f, "{context} is not a finite number")
            }
            ContentError::NegativeValue { context } => {
                write!(f, "{context} is negative")
            }
            ContentError::EmptyLot { width, height } => write!(
                f,
                "lot.toml declares a {width}x{height} lot; both dimensions must be at least 1"
            ),
            ContentError::WallOutOfBounds {
                x,
                y,
                width,
                height,
            } => write!(
                f,
                "lot.toml has a wall at ({x}, {y}), outside the {width}x{height} lot"
            ),
            ContentError::PlacementOutOfBounds {
                object,
                x,
                y,
                width,
                height,
            } => write!(
                f,
                "lot.toml places '{object}' at ({x}, {y}), outside the {width}x{height} lot"
            ),
            ContentError::PlacementOnWall { object, x, y } => {
                write!(f, "lot.toml places '{object}' on the wall tile ({x}, {y})")
            }
            ContentError::UnknownPlacedObject { object } => {
                write!(
                    f,
                    "lot.toml places '{object}', which objects.toml does not declare"
                )
            }
            ContentError::UnknownSprite { object, sprite } => write!(
                f,
                "object '{object}' names sprite '{sprite}', which atlas.toml does not hold"
            ),
            ContentError::MissingSimSprite { sprite } => write!(
                f,
                "atlas.toml has no '{sprite}' sprite, so no sim could be drawn"
            ),
        }
    }
}

impl std::error::Error for ContentError {}
