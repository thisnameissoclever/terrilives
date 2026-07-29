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
    /// Weighted selection divides by the temperature, so zero is a
    /// division by zero and a negative one inverts the whole
    /// distribution: the least urgent option would become the most
    /// likely.
    ///
    /// The value is always finite, because `compile_tuning` checks
    /// finiteness before this range, which also keeps this variant's
    /// derived `PartialEq` from having to reason about NaN. Same
    /// reasoning as [`ContentError::PlacementOutOfBounds`].
    NonPositiveTemperature {
        value: f32,
    },
    /// A floor of zero ticks is not a short interaction; it is an
    /// interaction that can complete on the tick it starts, which reads
    /// as a sim teleporting through an action.
    ZeroInteractionFloor,
    /// Variance is a FRACTION either side of the authored duration. At
    /// 1.0 the lower bound reaches zero, so the floor rather than the
    /// content would decide every duration; above 1.0 it goes negative.
    /// Finite by the time this is reported, as above.
    DurationVarianceOutOfRange {
        value: f32,
    },
    /// An idle threshold above the action threshold means a sim wanders
    /// off while something is worth doing. That is incoherent rather
    /// than merely odd: the two knobs answer "is anything worth doing"
    /// and "is nothing worth doing enough that I should mill about", and
    /// in this order the second contradicts the first. Both values are
    /// finite by the time this is reported.
    IdleThresholdAboveAction {
        idle: f32,
        action: f32,
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
            ContentError::NonPositiveTemperature { value } => write!(
                f,
                "tuning.toml has choice_temperature of {value}; it must be greater than 0 because selection divides by it"
            ),
            ContentError::ZeroInteractionFloor => write!(
                f,
                "tuning.toml has min_interaction_ticks of 0; must be at least 1"
            ),
            ContentError::DurationVarianceOutOfRange { value } => write!(
                f,
                "tuning.toml has duration_variance of {value}; must be at least 0 and less than 1"
            ),
            ContentError::IdleThresholdAboveAction { idle, action } => write!(
                f,
                "tuning.toml has idle_threshold {idle} above action_threshold {action}; a sim would wander off while something is worth doing"
            ),
        }
    }
}

impl std::error::Error for ContentError {}
