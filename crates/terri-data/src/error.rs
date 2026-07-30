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
    /// `needs.toml` names something that is not a `NeedId` variant.
    UnknownDeclaredNeed {
        need: String,
    },
    /// `needs.toml` declares the same need twice. It is a list rather
    /// than a table, so serde cannot reject this on its own.
    DuplicateDeclaredNeed {
        need: String,
    },
    /// A `NeedId` variant that `needs.toml` does not declare. Without
    /// this the need would exist in Rust, decay at whatever the tuning
    /// table happened to hold for it, and be invisible in content.
    MissingDeclaredNeed {
        need: String,
    },
    /// `tuning.toml`'s `[decay_per_tick]` table has no rate for a need
    /// `needs.toml` declares.
    ///
    /// A missing rate is not a rate of zero: the compile step seeds the
    /// table with `NaN`, and a `NaN` decay rate poisons that need's level
    /// on the first tick with nothing pointing back at the content.
    MissingNeedDecay {
        need: String,
    },
    /// `tuning.toml`'s `[decay_per_tick]` table gives a rate for a name
    /// that is not a `NeedId` variant. There is no duplicate counterpart:
    /// the table is a map, so a repeated key is a TOML parse error before
    /// this module sees it.
    UnknownNeedDecay {
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
    /// An interaction whose whole sampled length sits at or below
    /// `min_interaction_ticks`, so the floor sets its duration instead of its
    /// content, `duration_variance` does nothing for it, and it delivers
    /// `floor / duration_ticks` times what it advertises.
    ///
    /// A **cross-file** rule: it needs `content/objects.toml` and
    /// `content/tuning.toml` together, which is why it is checked after both
    /// have compiled rather than beside the other per-interaction rules.
    ClippedDuration {
        object: String,
        interaction: String,
        duration_ticks: u32,
        /// The smallest `duration_ticks` that escapes the floor, which is
        /// `min_interaction_ticks / (1 - duration_variance)` rounded up.
        minimum: u32,
        floor: u32,
        variance: f32,
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
    /// A `footprint` with a zero dimension. Not in [F5]'s three rules and
    /// added anyway, because it is the same silent-nothing shape as
    /// [`ContentError::EmptyLot`] one layer down: an object occupying no
    /// tiles has an empty adjacency set, so `find_path_adjacent` finds
    /// nowhere to stand, scoring treats the object as unavailable, and the
    /// object simply is furniture nobody ever uses. It is also what makes
    /// the rectangle arithmetic below safe to write without saturating
    /// subtraction.
    ZeroFootprint {
        object: String,
        width: u32,
        depth: u32,
    },
    /// [F5] rule 2, first half: part of an object's footprint is off the lot.
    ///
    /// The tile is the OFFENDING one rather than the placement's origin,
    /// which is the whole reason this is not
    /// [`ContentError::PlacementOutOfBounds`]: an object placed legally at
    /// `(12, 7)` whose 3x1 footprint runs off a 14-wide lot has an origin
    /// that is perfectly in bounds, and reporting that coordinate would send
    /// the author looking at the wrong number. Silent otherwise: the object
    /// draws fine and the tiles outside the lot are simply gone.
    FootprintOutOfBounds {
        object: String,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
    },
    /// [F5] rule 2, second half: part of an object's footprint sits on a
    /// wall tile.
    ///
    /// Distinct from [`ContentError::PlacementOnWall`] for the same reason as
    /// above - that one names the tile the author typed, this one names a
    /// tile the author has to derive - and equally silent: the wall wins, so
    /// the object loses a tile it believes it has.
    FootprintOnWall {
        object: String,
        x: u32,
        y: u32,
    },
    /// [F5] rule 1: two objects' footprints claim the same tile.
    ///
    /// **The rule the whole feature was asked for.** Both objects are named
    /// because either could be the one in the wrong place, and neither is
    /// identifiable from the tile alone. `first` is whichever is declared
    /// earlier in `lot.toml`, so the message is stable rather than depending
    /// on iteration order.
    FootprintsOverlap {
        first: String,
        second: String,
        x: u32,
        y: u32,
    },
    /// [F5] rule 3, first half: an object with no walkable tile beside it.
    ///
    /// The tile is the object's ORIGIN, because with nothing beside it there
    /// is no more specific tile to name. Runtime already handles this -
    /// `find_path_adjacent` returns `None` and scoring treats the object as
    /// unavailable - and that is exactly the problem: the sim looks alive and
    /// simply never uses the thing, for as long as the lot exists.
    NoWalkableApproach {
        object: String,
        x: u32,
        y: u32,
    },
    /// [F5] rule 3, second half, and the rule that pays for [F3]: a tile
    /// beside an object is walkable but **cut off** from the rest of the lot.
    ///
    /// Blocking footprint tiles makes an object placed in a doorway able to
    /// seal a room. The flood fill starts from `root`, the first walkable
    /// tile in the lot, so a failure means the named approach tile and `root`
    /// are in different regions - which is reported as the object's problem
    /// because an object is what the author can move.
    UnreachableApproach {
        object: String,
        x: u32,
        y: u32,
        root_x: u32,
        root_y: u32,
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
    HabituationPerUseOutOfRange {
        value: f32,
    },
    NonPositiveHabituationDecay {
        value: f32,
    },
    HabituationFloorOutOfRange {
        value: f32,
    },
    /// Zero attempts is not "wander less"; it is a sim that can never
    /// roll a destination and therefore never wanders at all, which is
    /// exactly the standing-still behaviour [D-5] exists to remove -
    /// and it would look like the feature had simply not been built.
    ZeroWanderAttempts,
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
    /// A cap of zero is not "no queueing"; it is a game in which clicking
    /// an object never does anything at all, because `drain_commands`
    /// refuses every intent that would take a queue past this. That is
    /// the silent-nothing case [D9] exists to convert into a build
    /// failure - the game would run, the sim would behave, and directing
    /// it would simply have no effect.
    ZeroQueuedIntents,
    /// A cap of zero on the staging queue is a game that accepts no
    /// player input at all: `SimHandle::enqueue_command` refuses every
    /// command that would take the queue past this, so at zero it
    /// refuses the first one. Same silent-nothing shape as
    /// `ZeroQueuedIntents` and the same reason for being a build
    /// failure - the page would load, the sim would behave, and nothing
    /// the player did would reach it.
    ZeroQueuedCommands,
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
            ContentError::UnknownDeclaredNeed { need } => {
                write!(f, "needs.toml declares unknown need '{need}'")
            }
            ContentError::DuplicateDeclaredNeed { need } => {
                write!(f, "needs.toml declares '{need}' more than once")
            }
            ContentError::MissingDeclaredNeed { need } => {
                write!(f, "needs.toml does not declare '{need}'")
            }
            ContentError::MissingNeedDecay { need } => {
                write!(
                    f,
                    "tuning.toml's [decay_per_tick] is missing a rate for '{need}'"
                )
            }
            ContentError::UnknownNeedDecay { need } => {
                write!(
                    f,
                    "tuning.toml's [decay_per_tick] gives a rate for unknown need '{need}'"
                )
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
            ContentError::ClippedDuration {
                object,
                interaction,
                duration_ticks,
                minimum,
                floor,
                variance,
            } => write!(
                f,
                "object '{object}' interaction '{interaction}' has duration_ticks of \
                 {duration_ticks}, whose sampled band bottoms out at \
                 {:.1} ticks - at or below min_interaction_ticks of {floor}. \
                 The floor would set its length on every use, duration_variance \
                 of {variance} would do nothing for it, and it would deliver \
                 {:.2}x its advertised deltas because the refill rate is per \
                 content tick. Raise duration_ticks to at least {minimum}, or \
                 lower min_interaction_ticks in tuning.toml",
                *duration_ticks as f32 * (1.0 - variance),
                *floor as f32 / *duration_ticks as f32,
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
            ContentError::ZeroFootprint {
                object,
                width,
                depth,
            } => write!(
                f,
                "object '{object}' declares a {width}x{depth} footprint; both \
                 dimensions must be at least 1. An object occupying no tiles \
                 has nowhere to stand beside it, so no sim could ever use it"
            ),
            ContentError::FootprintOutOfBounds {
                object,
                x,
                y,
                width,
                height,
            } => write!(
                f,
                "lot.toml places '{object}' so that its footprint covers \
                 ({x}, {y}), outside the {width}x{height} lot. The placement \
                 coordinate is inside the lot; its width or depth is what \
                 runs off the edge"
            ),
            ContentError::FootprintOnWall { object, x, y } => write!(
                f,
                "lot.toml places '{object}' so that its footprint covers the \
                 wall tile ({x}, {y}). The placement coordinate is clear of \
                 the walls; its width or depth is what reaches one"
            ),
            ContentError::FootprintsOverlap {
                first,
                second,
                x,
                y,
            } => write!(
                f,
                "lot.toml places '{first}' and '{second}' so that both \
                 footprints cover the tile ({x}, {y}); move one of them"
            ),
            ContentError::NoWalkableApproach { object, x, y } => write!(
                f,
                "lot.toml places '{object}' at tile ({x}, {y}) with no \
                 walkable tile beside its footprint, so no sim can ever \
                 stand next to it and the object would be scenery"
            ),
            ContentError::UnreachableApproach {
                object,
                x,
                y,
                root_x,
                root_y,
            } => write!(
                f,
                "lot.toml leaves the tile ({x}, {y}) beside '{object}' cut off \
                 from ({root_x}, {root_y}): the lot is split into regions a sim \
                 cannot walk between, so part of the house would never be \
                 used. An object placed in a doorway seals it, because \
                 footprint tiles are impassable"
            ),
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
            ContentError::HabituationPerUseOutOfRange { value } => write!(
                f,
                "habituation_per_use is {value}; must be in [0, 1]. 0 disables                  habituation; above 1 saturates on first use, so an object                  would never be chosen twice"
            ),
            ContentError::NonPositiveHabituationDecay { value } => write!(
                f,
                "habituation_decay_per_tick is {value}; must be strictly                  positive. Zero makes habituation a one-way ratchet, so every                  interaction a sim has performed sinks to the floor and stays                  there and the whole house becomes equally unappealing"
            ),
            ContentError::HabituationFloorOutOfRange { value } => write!(
                f,
                "habituation_floor is {value}; must be in (0, 1]. It is a                  MULTIPLIER, so 1 disables the effect and 0 would make a fully                  habituated interaction permanently worthless"
            ),
            ContentError::ZeroInteractionFloor => write!(
                f,
                "tuning.toml has min_interaction_ticks of 0; must be at least 1"
            ),
            ContentError::ZeroWanderAttempts => write!(
                f,
                "tuning.toml has wander_attempts of 0, so an idle sim could never roll a destination and would never wander; must be at least 1"
            ),
            ContentError::DurationVarianceOutOfRange { value } => write!(
                f,
                "tuning.toml has duration_variance of {value}; must be at least 0 and less than 1"
            ),
            ContentError::IdleThresholdAboveAction { idle, action } => write!(
                f,
                "tuning.toml has idle_threshold {idle} above action_threshold {action}; a sim would wander off while something is worth doing"
            ),
            ContentError::ZeroQueuedIntents => write!(
                f,
                "tuning.toml has max_queued_intents of 0, so directing a sim at an object could never do anything; must be at least 1"
            ),
            ContentError::ZeroQueuedCommands => write!(
                f,
                "tuning.toml has max_queued_commands of 0, so the boundary would refuse every player command and nothing the player did would reach the simulation; must be at least 1"
            ),
        }
    }
}

impl std::error::Error for ContentError {}
