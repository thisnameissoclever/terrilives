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
    /// An interaction whose `label` is present but blank, or is nothing but
    /// whitespace.
    ///
    /// The same silent-nothing shape as [`ContentError::ZeroSlots`] carried
    /// into the UI: the right-click flyout builds one row per interaction, so
    /// a blank label is a clickable row of empty space. It still directs the
    /// sim when picked, which makes it worse than a missing row - the player
    /// sees a gap in the menu and the game responds to it.
    ///
    /// Unreachable by omitting the field, because omitting it falls back to
    /// the interaction's `id`. This fires only on an author who typed
    /// `label = ""`.
    EmptyInteractionLabel {
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
    /// A multiplier above 1.0 would make an object somebody else is using
    /// worth MORE than the same object free, which is incoherent rather
    /// than merely extreme; below 0.0 it flips the sign of every
    /// contested score. Both ends of `[0, 1]` are legal and meaningful:
    /// 0.0 is "never wait for a contested object", and 1.0 is "wait for
    /// anything you would have acted on", which is how selection behaved
    /// between the [C3] fix and this knob. Finite by the time this is
    /// reported, as above.
    ContestedScoreMultiplierOutOfRange {
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
    /// Two archetypes with one id: the household resolves by name, so the
    /// second is unreachable and every sim naming it silently gets the
    /// first - two definitions for one fact, resolved by declaration
    /// order nobody chose.
    DuplicateArchetype {
        id: String,
    },
    /// An archetype's `drain` or `satisfaction` map names a need rustc
    /// does not know. Same dangling-reference shape as
    /// [`ContentError::UnknownNeed`], one file over.
    UnknownPersonalityNeed {
        archetype: String,
        map: &'static str,
        need: String,
    },
    /// A satisfaction multiplier of zero makes every positive delta on
    /// that need worth nothing TO THIS SIM - the need becomes dynamically
    /// unsatisfiable for one person, which is [C2] with a face on it, and
    /// `every_declared_need_can_be_satisfied_by_some_interaction` is
    /// static and cannot see it. Drain multipliers may be zero - a need
    /// that never drains is a placid trait, not a trap - which is why the
    /// two maps have different floors.
    NonPositiveSatisfaction {
        archetype: String,
        need: String,
        value: f32,
    },
    /// A disposition names an object `objects.toml` does not declare.
    UnknownDispositionObject {
        archetype: String,
        object: String,
    },
    /// A disposition names an interaction its object does not offer.
    /// Reported separately from the object case because the fixes are
    /// different edits: one is a typo in an object id, the other is
    /// usually an interaction renamed after the archetype was written.
    UnknownDispositionInteraction {
        archetype: String,
        object: String,
        interaction: String,
    },
    /// One archetype declares two weights for one interaction. Ambiguous
    /// rather than merely redundant: nothing says which wins, and the
    /// answer would be declaration order nobody chose.
    DuplicateDisposition {
        archetype: String,
        object: String,
        interaction: String,
    },
    /// A household member names an archetype `personalities.toml` does
    /// not declare.
    UnknownArchetype {
        sim: String,
        archetype: String,
    },
    /// A sim with no name renders a blank needs-panel header and a blank
    /// row in every future UI that lists the household. Same
    /// silent-nothing shape as a blank interaction label.
    ///
    /// Carries the POSITION rather than the name, because the name is
    /// what is missing: every other household error points at its sim by
    /// name, and this is the one mistake where that pointer is blank.
    EmptySimName {
        index: usize,
    },
    /// A household member spawns outside the lot.
    SpawnOutOfBounds {
        sim: String,
        x: f32,
        y: f32,
        width: u32,
        height: u32,
    },
    /// A household member spawns inside a wall or a footprint. Movement
    /// paths FROM the sim's tile, so a sim born in a blocked tile can
    /// never leave it: every neighbour expansion starts from a tile the
    /// grid says nothing can stand on.
    SpawnOnBlockedTile {
        sim: String,
        x: u32,
        y: u32,
    },
    /// A household member spawns on a walkable tile that is cut off from
    /// the rest of the lot - born in a sealed pocket, able to starve and
    /// not to leave. Same flood fill as
    /// [`ContentError::UnreachableApproach`], same root.
    SpawnUnreachable {
        sim: String,
        x: u32,
        y: u32,
        root_x: u32,
        root_y: u32,
    },
    /// A starting need names a need rustc does not know.
    UnknownStartingNeed {
        sim: String,
        need: String,
    },
    /// A starting need outside `[0, 100]`. Clamping silently would hide
    /// an authoring typo - `hunger = 620.0` for `62.0` - behind a sim
    /// that merely behaves oddly for its first sim-day.
    StartingNeedOutOfRange {
        sim: String,
        need: String,
        value: f32,
    },
    /// `relationship_gain_per_talk` outside `[0, 1]`. Same contract as
    /// [`ContentError::HabituationPerUseOutOfRange`]: 0 legally disables
    /// the mechanic, above 1 saturates a friendship in one conversation.
    RelationshipGainOutOfRange {
        value: f32,
    },
    /// A zero or negative relationship decay - the one-way-ratchet rule
    /// [`ContentError::NonPositiveHabituationDecay`] states, applied to
    /// relationships.
    NonPositiveRelationshipDecay {
        value: f32,
    },
    /// `relationship_delta_scale` outside `[0, 1]`. The multiplier is
    /// `1 + relationship * scale` with relationships in `-1..=1`, so a
    /// scale above 1 lets a bad relationship turn a social BENEFIT
    /// negative - a cost nobody authored, of the [S2]-violating kind.
    RelationshipDeltaScaleOutOfRange {
        value: f32,
    },
    /// A placement's `facing` is not one of the kit's four. Caught
    /// before sprite lookup so a typo reads as a typo rather than as a
    /// missing atlas entry.
    UnknownFacing {
        object: String,
        facing: String,
    },
    /// A placement's facing resolves to a sprite the atlas does not
    /// hold - legal facing, unimported art. The atlas imports variants
    /// as the lot needs them rather than all four of everything, so
    /// this is the error that says which import is missing.
    FacingSpriteMissing {
        object: String,
        facing: String,
        sprite: String,
    },
    /// `social.toml` declares the same interaction twice. Own variants
    /// rather than the object family's, so the message points at the
    /// file that actually contains the mistake - the same reason the
    /// household has `SpawnOutOfBounds` instead of reusing
    /// `PlacementOutOfBounds`.
    DuplicateSocialInteraction {
        id: String,
    },
    /// A social interaction with a duration of 0 - the same silent
    /// nothing as [`ContentError::ZeroDuration`], on the social file.
    SocialZeroDuration {
        interaction: String,
    },
    /// A social interaction with 0 slots - reserved space that reserves
    /// nothing, as [`ContentError::ZeroSlots`] explains for objects.
    SocialZeroSlots {
        interaction: String,
    },
    /// A social interaction with a blank label. Nothing renders social
    /// labels yet - the flyout is built from an object's interactions -
    /// but the rule mirrors [`ContentError::EmptyInteractionLabel`] so
    /// that the day a social menu exists, blank rows are already
    /// unrepresentable rather than newly discovered.
    SocialEmptyLabel {
        interaction: String,
    },
    /// A social interaction advertises a need `needs.toml` does not
    /// declare - the same rule as [`ContentError::UnknownNeed`], against
    /// the social file.
    SocialUnknownNeed {
        interaction: String,
        need: String,
    },
    /// A social interaction shorter than the interaction floor allows -
    /// the same three silent lies [`ContentError::ClippedDuration`]
    /// documents, on the social file.
    ClippedSocialDuration {
        interaction: String,
        duration_ticks: u32,
        minimum: u32,
        floor: u32,
        variance: f32,
    },
    /// An interaction tag that is blank once trimmed. A tag exists to be
    /// matched against hobbies and traits, and an empty one can only
    /// match an empty hobby - a pair of typos agreeing with each other,
    /// which is exactly the silent-nothing shape [D9] rejects at build
    /// time. `owner` is the object id, or `social.toml` for the social
    /// vocabulary, so the message names the file that holds the mistake.
    EmptyActivityTag {
        owner: String,
        interaction: String,
    },
    /// An interaction whose completion satisfaction is negative. Content
    /// can never write the second axis DOWNWARD - [S1] routes every
    /// downward write through neglect and conditions, where the player
    /// can see why - so a negative yield here is either a typo or a
    /// mechanic being smuggled in through the wrong door.
    NegativeSatisfaction {
        owner: String,
        interaction: String,
        satisfaction: f32,
    },
    /// A household sim loves a tag no interaction in the pack carries.
    /// The hobby could never pay out: the sim would live its whole life
    /// unable to do the thing it loves, with nothing anywhere saying so.
    /// A dangling reference in [D9]'s exact sense, reported against the
    /// sim so the typo is findable in `household.toml`.
    UnknownHobby {
        sim: String,
        hobby: String,
    },
    /// `hobby_multiplier` below 1. A hobby would then pay LESS for being
    /// loved, which silently inverts the mechanic ([E2]); exactly 1 is
    /// the legal way to disable hobbies without touching content.
    HobbyMultiplierBelowOne {
        value: f32,
    },
    /// `at_work_decay_scale` outside `[0, 1]`. Above 1 the office
    /// drains faster than living does - a knob meant to soften the
    /// rabbit hole silently sharpening it - and below 0 a shift would
    /// REFILL needs, making work the best place in the game to be.
    AtWorkDecayScaleOutOfRange {
        value: f32,
    },
    /// `neglect_floor` outside the need range `[0, 100]`. Above 100
    /// every need is always neglected and satisfaction bleeds from tick
    /// one, which reads as a broken accumulator rather than a tuning
    /// mistake; below 0 is unreachable but explicitly nonsense.
    NeglectFloorOutOfRange {
        value: f32,
    },
    /// A negative `neglect_bleed_per_tick`, which would make starving a
    /// sim EARN satisfaction - [S1]'s "needs never earn it" broken by a
    /// sign error.
    NegativeNeglectBleed {
        value: f32,
    },
    /// `traits.toml` declares the same trait twice - the same rule as
    /// every other id space.
    DuplicateTrait {
        id: String,
    },
    /// A trait with a blank label. Unlike an interaction there is no
    /// id-shaped fallback that reads as anything but a bug in a UI's
    /// trait list, so the label is simply required.
    EmptyTraitLabel {
        id: String,
    },
    /// A trait keyed on a tag no interaction carries: a fear of nothing,
    /// a skill at nothing, a condition managed by nothing - [D9]'s
    /// dangling reference, in the trait file's own words.
    TraitAboutNothing {
        id: String,
        tag: String,
    },
    /// A trait missing a number its kind requires; the simulation would
    /// otherwise answer with a default nobody chose.
    MissingTraitField {
        id: String,
        kind: String,
        field: String,
    },
    /// A trait number outside its documented range.
    TraitFieldOutOfRange {
        id: String,
        field: String,
        value: f32,
    },
    /// A trait declaring a number a DIFFERENT kind reads - a statement
    /// the simulation would silently ignore, which is the exact quiet
    /// failure [D9] converts to a build error.
    TraitFieldForWrongKind {
        id: String,
        kind: String,
        field: String,
    },
    /// A kind that is not disposition, capability or condition.
    UnknownTraitKind {
        id: String,
        kind: String,
    },
    /// A household sim wearing a trait `traits.toml` does not declare.
    UnknownSimTrait {
        sim: String,
        trait_id: String,
    },
    /// A household sim wearing the same trait twice. The `Traits`
    /// component keys state by index with a binary search, so a
    /// duplicate entry would leave one copy stale behind every write.
    DuplicateWornTrait {
        sim: String,
        trait_id: String,
    },
    /// Two careers share an id.
    DuplicateCareer {
        id: String,
    },
    /// A career whose label is empty or whitespace.
    EmptyCareerLabel {
        id: String,
    },
    /// A shift of zero ticks - a job that never happens.
    ZeroShift {
        id: String,
    },
    /// A shift_start at or past day_ticks - the clock never reaches it.
    ShiftStartsPastTheDay {
        id: String,
        shift_start: u32,
        day_ticks: u32,
    },
    /// A shift as long as the day or longer - the sim never lives.
    ShiftLongerThanTheDay {
        id: String,
        shift_ticks: u32,
        day_ticks: u32,
    },
    /// A career energy cost outside the need scale.
    CareerEnergyCostOutOfRange {
        id: String,
        value: f32,
    },
    /// A negative career satisfaction - [E4]'s recorded amendment.
    NegativeCareerSatisfaction {
        id: String,
        value: f32,
    },
    /// A household sim holding a career `careers.toml` does not declare.
    UnknownSimCareer {
        sim: String,
        career: String,
    },
    /// A zero-tick day - `tick % day_ticks` would divide by zero.
    ZeroDayTicks,
    /// A front door off the lot.
    FrontDoorOutOfBounds {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    },
    /// A front door inside a wall or a footprint.
    FrontDoorBlocked {
        x: u32,
        y: u32,
    },
    /// A front door sealed off from the rest of the lot.
    FrontDoorUnreachable {
        x: u32,
        y: u32,
        root_x: u32,
        root_y: u32,
    },
    /// A household with a worker on a lot that declares no front door.
    CareerWithoutFrontDoor {
        sim: String,
    },
    /// An object role that is empty or whitespace.
    EmptyObjectRole {
        object: String,
    },
    /// An object wearing the same role twice.
    DuplicateObjectRole {
        object: String,
        role: String,
    },
    /// Two chains share an id.
    DuplicateChain {
        id: String,
    },
    /// A chain whose label is empty or whitespace.
    EmptyChainLabel {
        id: String,
    },
    /// A chain advertised by an object nobody declared.
    UnknownChainAdvertiser {
        chain: String,
        object: String,
    },
    /// A chain with no steps - a recipe for nothing.
    EmptyChain {
        id: String,
    },
    /// A chain advertising a need that is not a `NeedId` variant.
    UnknownChainNeed {
        chain: String,
        need: String,
    },
    /// A chain step whose label is empty or whitespace.
    EmptyChainStepLabel {
        chain: String,
        step: usize,
    },
    /// A chain step of zero ticks.
    ZeroChainStepDuration {
        chain: String,
        step: usize,
    },
    /// A chain step whose whole sampled band sits at or below the
    /// interaction floor - `ClippedDuration`'s rule, worded for a
    /// step: "object 'cook_dinner' interaction 'Fetch'" would send
    /// the author hunting objects.toml for a chain.
    ClippedChainStepDuration {
        chain: String,
        step: usize,
        duration_ticks: u32,
        /// The smallest duration that escapes the floor.
        minimum: u32,
        floor: u32,
        variance: f32,
    },
    /// A chain step naming a blank item kind - it would mint an empty
    /// vocabulary entry and make every later hands error unreadable.
    EmptyChainItemKind {
        chain: String,
        step: usize,
    },
    /// A chain step carrying an empty tag.
    EmptyChainStepTag {
        chain: String,
        step: usize,
    },
    /// A chain step at a role no object definition wears - a typo.
    UnknownChainRole {
        chain: String,
        step: usize,
        role: String,
    },
    /// A chain step at a role no PLACED object wears - a kitchen with
    /// no stove. The rule that keeps "a lot where eating is
    /// impossible" unbuildable ([M-3]).
    UnstationedChainRole {
        chain: String,
        step: usize,
        role: String,
    },
    /// A step doing something to the sim's hands that its hands cannot
    /// do: yielding into a full hand, transforming or consuming the
    /// wrong item, or doing two of those at once.
    ChainHandsMismatch {
        chain: String,
        step: usize,
        detail: String,
    },
    /// A chain whose last step leaves the sim still carrying - the
    /// terminal step must consume what is in hand.
    ChainEndsCarrying {
        chain: String,
        item: String,
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
            ContentError::EmptyInteractionLabel {
                object,
                interaction,
            } => write!(
                f,
                "object '{object}' interaction '{interaction}' has a blank \
                 label; the right-click menu would draw a clickable row of \
                 empty space that still directs the sim. Omit the field \
                 entirely to fall back to '{interaction}', or write a label"
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
            ContentError::ContestedScoreMultiplierOutOfRange { value } => write!(
                f,
                "tuning.toml has contested_score_multiplier of {value}; must be at least 0 and at most 1"
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
            ContentError::DuplicateArchetype { id } => write!(
                f,
                "personalities.toml declares archetype '{id}' more than once; \
                 the household resolves by name, so the second definition \
                 could never be reached"
            ),
            ContentError::UnknownPersonalityNeed {
                archetype,
                map,
                need,
            } => write!(
                f,
                "archetype '{archetype}' gives a {map} multiplier for unknown need '{need}'"
            ),
            ContentError::NonPositiveSatisfaction {
                archetype,
                need,
                value,
            } => write!(
                f,
                "archetype '{archetype}' has a satisfaction multiplier of \
                 {value} for '{need}'; it must be greater than 0, or that \
                 need becomes unsatisfiable for every sim with this \
                 personality - no interaction could ever refill it. A drain \
                 multiplier of 0 is the legal way to say a need does not \
                 trouble this sim"
            ),
            ContentError::UnknownDispositionObject { archetype, object } => write!(
                f,
                "archetype '{archetype}' has a disposition toward '{object}', \
                 which objects.toml does not declare"
            ),
            ContentError::UnknownDispositionInteraction {
                archetype,
                object,
                interaction,
            } => write!(
                f,
                "archetype '{archetype}' has a disposition toward \
                 '{object}.{interaction}', but '{object}' offers no \
                 interaction with that id"
            ),
            ContentError::DuplicateDisposition {
                archetype,
                object,
                interaction,
            } => write!(
                f,
                "archetype '{archetype}' declares two dispositions toward \
                 '{object}.{interaction}'; nothing says which weight wins"
            ),
            ContentError::UnknownArchetype { sim, archetype } => write!(
                f,
                "household.toml gives '{sim}' the archetype '{archetype}', \
                 which personalities.toml does not declare"
            ),
            ContentError::EmptySimName { index } => write!(
                f,
                "household.toml's sim number {} (counting from 1) has a blank \
                 name; the needs panel and every future household list would \
                 show an empty row",
                index + 1
            ),
            ContentError::SpawnOutOfBounds {
                sim,
                x,
                y,
                width,
                height,
            } => write!(
                f,
                "household.toml spawns '{sim}' at ({x}, {y}), outside the \
                 {width}x{height} lot"
            ),
            ContentError::SpawnOnBlockedTile { sim, x, y } => write!(
                f,
                "household.toml spawns '{sim}' on the blocked tile ({x}, {y}); \
                 movement paths FROM a sim's tile, so a sim born inside a wall \
                 or a footprint can never take a step"
            ),
            ContentError::SpawnUnreachable {
                sim,
                x,
                y,
                root_x,
                root_y,
            } => write!(
                f,
                "household.toml spawns '{sim}' at ({x}, {y}), which is cut off \
                 from ({root_x}, {root_y}): the sim would be born in a sealed \
                 pocket, able to starve and not to leave"
            ),
            ContentError::UnknownStartingNeed { sim, need } => write!(
                f,
                "household.toml gives '{sim}' a starting level for unknown need '{need}'"
            ),
            ContentError::StartingNeedOutOfRange { sim, need, value } => write!(
                f,
                "household.toml starts '{sim}' with {need} at {value}; levels \
                 are 0 to 100, and clamping silently would hide a typo behind \
                 a sim that merely behaves oddly for a day"
            ),
            ContentError::RelationshipGainOutOfRange { value } => write!(
                f,
                "relationship_gain_per_talk is {value}; must be in [0, 1]. \
                 0 disables the mechanic; above 1 saturates a friendship in \
                 a single conversation"
            ),
            ContentError::NonPositiveRelationshipDecay { value } => write!(
                f,
                "relationship_decay_per_tick is {value}; must be strictly \
                 positive, or every relationship is a one-way ratchet that \
                 only ever rises"
            ),
            ContentError::RelationshipDeltaScaleOutOfRange { value } => write!(
                f,
                "relationship_delta_scale is {value}; must be in [0, 1]. \
                 The multiplier is 1 + relationship * scale with \
                 relationships in -1..=1, so a scale above 1 would let a \
                 bad relationship turn an advertised benefit negative"
            ),
            ContentError::UnknownFacing { object, facing } => write!(
                f,
                "lot.toml places '{object}' facing '{facing}'; a facing is                  one of NE, NW, SE, SW"
            ),
            ContentError::FacingSpriteMissing {
                object,
                facing,
                sprite,
            } => write!(
                f,
                "lot.toml places '{object}' facing '{facing}', which needs                  sprite '{sprite}' - the atlas does not hold it. Add the                  variant to assets/sprites/build-atlas.ps1 and regenerate"
            ),
            ContentError::DuplicateSocialInteraction { id } => write!(
                f,
                "social.toml declares interaction '{id}' more than once"
            ),
            ContentError::SocialZeroDuration { interaction } => write!(
                f,
                "social.toml interaction '{interaction}' has duration_ticks \
                 of 0; must be at least 1"
            ),
            ContentError::SocialZeroSlots { interaction } => write!(
                f,
                "social.toml interaction '{interaction}' has slots of 0; \
                 must be at least 1"
            ),
            ContentError::SocialEmptyLabel { interaction } => write!(
                f,
                "social.toml interaction '{interaction}' has a blank label; \
                 any future social menu would draw a clickable row of empty \
                 space. Omit the field entirely to fall back to \
                 '{interaction}', or write a label"
            ),
            ContentError::SocialUnknownNeed { interaction, need } => write!(
                f,
                "social.toml interaction '{interaction}' advertises unknown \
                 need '{need}'"
            ),
            ContentError::ClippedSocialDuration {
                interaction,
                duration_ticks,
                minimum,
                floor,
                variance,
            } => write!(
                f,
                "social.toml interaction '{interaction}' declares \
                 {duration_ticks} ticks, but min_interaction_ticks {floor} \
                 with duration_variance {variance} clips anything under \
                 {minimum}: it would run for the floor every time, deliver \
                 more than it advertises, and never vary"
            ),
            ContentError::EmptyActivityTag { owner, interaction } => write!(
                f,
                "'{owner}' interaction '{interaction}' declares a blank \
                 activity tag; a tag exists to be matched against hobbies \
                 and traits, and an empty one can only match a typo"
            ),
            ContentError::NegativeSatisfaction {
                owner,
                interaction,
                satisfaction,
            } => write!(
                f,
                "'{owner}' interaction '{interaction}' declares satisfaction \
                 {satisfaction}; content can never write the second axis \
                 downward - neglect and conditions own that direction"
            ),
            ContentError::UnknownHobby { sim, hobby } => write!(
                f,
                "household sim '{sim}' loves '{hobby}', but no interaction \
                 in the pack carries that tag; the hobby could never pay out"
            ),
            ContentError::HobbyMultiplierBelowOne { value } => write!(
                f,
                "hobby_multiplier is {value}; below 1 a hobby pays LESS for \
                 being loved, and exactly 1 is the way to disable hobbies"
            ),
            ContentError::AtWorkDecayScaleOutOfRange { value } => write!(
                f,
                "at_work_decay_scale is {value}, outside 0..=1; above 1 the \
                 office drains faster than living does and below 0 it refills"
            ),
            ContentError::NeglectFloorOutOfRange { value } => write!(
                f,
                "neglect_floor is {value}, outside the need range 0..=100"
            ),
            ContentError::NegativeNeglectBleed { value } => write!(
                f,
                "neglect_bleed_per_tick is {value}; a negative bleed would \
                 make starving a sim EARN satisfaction"
            ),
            ContentError::DuplicateTrait { id } => {
                write!(f, "traits.toml declares '{id}' more than once")
            }
            ContentError::EmptyTraitLabel { id } => write!(
                f,
                "trait '{id}' has a blank label; a trait list has no \
                 id-shaped fallback that reads as anything but a bug"
            ),
            ContentError::TraitAboutNothing { id, tag } => write!(
                f,
                "trait '{id}' keys on tag '{tag}', which no interaction in \
                 the pack carries - a fear of nothing, a skill at nothing"
            ),
            ContentError::MissingTraitField { id, kind, field } => write!(
                f,
                "trait '{id}' is a {kind} and must declare '{field}'"
            ),
            ContentError::TraitFieldOutOfRange { id, field, value } => write!(
                f,
                "trait '{id}' declares {field} = {value}, outside its \
                 documented range"
            ),
            ContentError::TraitFieldForWrongKind { id, kind, field } => write!(
                f,
                "trait '{id}' is a {kind} and declares '{field}', which \
                 that kind does not read - the simulation would silently \
                 ignore it"
            ),
            ContentError::UnknownTraitKind { id, kind } => write!(
                f,
                "trait '{id}' declares kind '{kind}'; the kinds are {}",
                crate::schema::TRAIT_KINDS.join(", ")
            ),
            ContentError::UnknownSimTrait { sim, trait_id } => write!(
                f,
                "household sim '{sim}' wears '{trait_id}', which \
                 traits.toml does not declare"
            ),
            ContentError::DuplicateWornTrait { sim, trait_id } => write!(
                f,
                "household sim '{sim}' wears '{trait_id}' twice - a \
                 trait is worn once or not at all"
            ),
            ContentError::DuplicateCareer { id } => {
                write!(f, "duplicate career id '{id}'")
            }
            ContentError::EmptyCareerLabel { id } => {
                write!(f, "career '{id}' has an empty label")
            }
            ContentError::ZeroShift { id } => write!(
                f,
                "career '{id}' has a zero-tick shift - a job that never \
                 happens is not a job"
            ),
            ContentError::ShiftStartsPastTheDay {
                id,
                shift_start,
                day_ticks,
            } => write!(
                f,
                "career '{id}' starts at tick {shift_start} of a \
                 {day_ticks}-tick day - the clock never reaches it"
            ),
            ContentError::ShiftLongerThanTheDay {
                id,
                shift_ticks,
                day_ticks,
            } => write!(
                f,
                "career '{id}' works {shift_ticks} ticks of a \
                 {day_ticks}-tick day - the shift must leave room to live"
            ),
            ContentError::CareerEnergyCostOutOfRange { id, value } => write!(
                f,
                "career '{id}' has energy_cost {value}; the need scale is \
                 0 to {}",
                terri_core::NEED_MAX
            ),
            ContentError::NegativeCareerSatisfaction { id, value } => write!(
                f,
                "career '{id}' has satisfaction {value}; career \
                 satisfaction is non-negative - a job that drains a life \
                 is authored as a condition"
            ),
            ContentError::UnknownSimCareer { sim, career } => write!(
                f,
                "household sim '{sim}' holds career '{career}', which \
                 careers.toml does not declare"
            ),
            ContentError::ZeroDayTicks => write!(
                f,
                "day_ticks must be at least 1 - a zero-tick day divides \
                 by zero the first time a career asks the hour"
            ),
            ContentError::FrontDoorOutOfBounds {
                x,
                y,
                width,
                height,
            } => write!(
                f,
                "the front door at ({x}, {y}) is outside the \
                 {width}x{height} lot"
            ),
            ContentError::FrontDoorBlocked { x, y } => write!(
                f,
                "the front door at ({x}, {y}) stands in a wall or a \
                 footprint - nobody can leave through furniture"
            ),
            ContentError::FrontDoorUnreachable {
                x,
                y,
                root_x,
                root_y,
            } => write!(
                f,
                "the front door at ({x}, {y}) cannot be reached from \
                 ({root_x}, {root_y}) - a worker would path nowhere \
                 forever"
            ),
            ContentError::CareerWithoutFrontDoor { sim } => write!(
                f,
                "household sim '{sim}' holds a career but the lot \
                 declares no front_door - there is nowhere to leave from"
            ),
            ContentError::EmptyObjectRole { object } => write!(
                f,
                "object '{object}' declares an empty role - no chain \
                 step could ever match it"
            ),
            ContentError::DuplicateObjectRole { object, role } => write!(
                f,
                "object '{object}' wears role '{role}' twice - a role \
                 is worn once or not at all"
            ),
            ContentError::DuplicateChain { id } => {
                write!(f, "duplicate chain id '{id}'")
            }
            ContentError::EmptyChainLabel { id } => {
                write!(f, "chain '{id}' has an empty label")
            }
            ContentError::UnknownChainAdvertiser { chain, object } => write!(
                f,
                "chain '{chain}' is advertised_by '{object}', which \
                 objects.toml does not declare"
            ),
            ContentError::EmptyChain { id } => write!(
                f,
                "chain '{id}' has no steps - a recipe for nothing"
            ),
            ContentError::UnknownChainNeed { chain, need } => write!(
                f,
                "chain '{chain}' advertises unknown need '{need}'"
            ),
            ContentError::EmptyChainStepLabel { chain, step } => write!(
                f,
                "chain '{chain}' step {step} has an empty label"
            ),
            ContentError::ZeroChainStepDuration { chain, step } => write!(
                f,
                "chain '{chain}' step {step} takes zero ticks - a step \
                 that never happens is not a step"
            ),
            ContentError::ClippedChainStepDuration {
                chain,
                step,
                duration_ticks,
                minimum,
                floor,
                variance,
            } => write!(
                f,
                "chain '{chain}' step {step} declares {duration_ticks} \
                 ticks, whose whole sampled band (variance {variance}) \
                 sits at or below the {floor}-tick floor; the smallest \
                 honest duration is {minimum}"
            ),
            ContentError::EmptyChainItemKind { chain, step } => write!(
                f,
                "chain '{chain}' step {step} names a blank item kind"
            ),
            ContentError::EmptyChainStepTag { chain, step } => write!(
                f,
                "chain '{chain}' step {step} carries an empty tag"
            ),
            ContentError::UnknownChainRole { chain, step, role } => write!(
                f,
                "chain '{chain}' step {step} happens at role '{role}', \
                 which no object declares - see the roles list in \
                 objects.toml"
            ),
            ContentError::UnstationedChainRole { chain, step, role } => write!(
                f,
                "chain '{chain}' step {step} needs an object wearing \
                 role '{role}' PLACED on the lot, and none is - the \
                 chain would advertise a meal nobody can finish"
            ),
            ContentError::ChainHandsMismatch {
                chain,
                step,
                detail,
            } => write!(f, "chain '{chain}' step {step}: {detail}"),
            ContentError::ChainEndsCarrying { chain, item } => write!(
                f,
                "chain '{chain}' ends with the sim still carrying \
                 '{item}' - the terminal step must consume what is in \
                 hand"
            ),
        }
    }
}

impl std::error::Error for ContentError {}
