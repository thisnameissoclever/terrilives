//! Serde mirrors of the authored TOML content files.
//!
//! These types describe the *shape* content must have; they say nothing
//! about whether it is valid. Serde cannot express "every `NeedId`
//! appears exactly once" or "this need name is one rustc knows about",
//! so those checks live in the compile step and report `ContentError`.

use serde::Deserialize;
use std::collections::BTreeMap;
use terri_core::Footprint;

/// Mirrors `content/tuning.toml`, the single home for every value that
/// governs the **system** rather than describing one piece of content.
///
/// The split is a standing project rule rather than this file's private
/// convention, and the TOML states it too: a fridge's hunger delta is
/// content and belongs in `objects.toml`; the temperature governing how
/// randomly any sim chooses is tuning and belongs here. **A new knob
/// goes in that file rather than into a Rust `const`**, because the
/// person tuning game feel is iterating and wants one file to open, and
/// a constant buried in a system is a knob they will never find.
///
/// **Nothing here defaults.** Every other rule in this module is a
/// compile-step check reporting a `ContentError`; presence is the one
/// serde can express on its own, and it expresses it by making the field
/// required. A defaulted knob is the silent-nothing case [D9] exists to
/// prevent: a `duration_variance` quietly defaulting to zero is a
/// simulation that is merely metronomic rather than one that fails.
#[derive(Debug, Deserialize)]
pub struct TuningFile {
    /// Below this score, an option is not worth doing at all.
    pub action_threshold: f32,
    /// Softmax temperature for choosing among candidates. Must be
    /// strictly positive: selection divides by it.
    pub choice_temperature: f32,
    /// Below this, nothing is urgent enough to act on and the sim
    /// wanders. Must not exceed `action_threshold`.
    pub idle_threshold: f32,
    /// Ticks a sim pauses between wanders.
    pub wander_pause_ticks: u32,
    /// How many random tiles a wandering sim tries before giving up for
    /// the tick. At least 1; it is what bounds the re-roll.
    pub wander_attempts: u32,
    /// Fraction either side of an interaction's content duration that
    /// the real duration is sampled within. In `[0, 1)`.
    pub duration_variance: f32,
    /// Hard floor on any interaction, in ticks. At least 1.
    pub min_interaction_ticks: u32,
    /// How much of its score an object somebody else is using keeps.
    /// In `[0, 1]`.
    pub contested_score_multiplier: f32,
    /// How much one completed interaction raises this sim's habituation to
    /// it, in `0.0..=1.0`. Zero disables the mechanic.
    pub habituation_per_use: f32,
    /// How much every habituation entry decays each tick. Strictly
    /// positive, or habituation would be a one-way ratchet.
    pub habituation_decay_per_tick: f32,
    /// The multiplier a fully habituated interaction's benefit is reduced
    /// to. In `(0, 1]`; 1 disables the effect, and 0 is rejected because
    /// it would make an interaction permanently worthless.
    pub habituation_floor: f32,
    /// Seed for the simulation PRNG.
    pub rng_seed: u64,
    /// The most player-issued intents one sim may hold at once. At least
    /// 1; it is what bounds a click.
    pub max_queued_intents: u32,
    /// The most commands the boundary will hold between two drains. At
    /// least 1; it is what bounds the QUEUE rather than one sim's share
    /// of it.
    pub max_queued_commands: u32,
    /// How often the shell re-reads a selected sim's needs for the need
    /// bars, in real milliseconds. Zero means every frame and is legal.
    pub need_bar_refresh_ms: u32,
    /// How much one completed social interaction raises EACH participant's
    /// relationship toward the other, in `0.0..=1.0`. Zero disables the
    /// mechanic, exactly as `habituation_per_use` does for habituation.
    pub relationship_gain_per_talk: f32,
    /// How much every relationship drifts toward zero each tick. Strictly
    /// positive, or a friendship would be a one-way ratchet - the same
    /// rule `habituation_decay_per_tick` carries and for the same reason.
    pub relationship_decay_per_tick: f32,
    /// How strongly a relationship scales a social interaction's
    /// advertised benefit: the multiplier is `1 + relationship * scale`,
    /// so with relationship in `-1..=1` this must be in `0.0..=1.0` to
    /// keep the multiplier non-negative. Zero disables the effect.
    pub relationship_delta_scale: f32,
    /// What a loved activity's completion satisfaction is multiplied by
    /// ([E2]). At least 1; exactly 1 disables hobbies.
    pub hobby_multiplier: f32,
    /// The need level below which a need is neglected and bleeds
    /// satisfaction ([E1]). In `[0, 100]`; 0 disables neglect.
    pub neglect_floor: f32,
    /// Satisfaction lost per neglected need per tick. Non-negative;
    /// 0 disables the bleed.
    pub neglect_bleed_per_tick: f32,
    /// Ticks in one simulated day - the clock careers schedule against
    /// ([E4]). At least 1; the shipped value makes a day a number a
    /// designer chose rather than a constant buried in a system.
    pub day_ticks: u32,
    /// Need name to how much of that need drains per tick.
    ///
    /// A decay rate is a system-wide balance knob rather than part of a
    /// need's identity, so it lives here and not in `needs.toml`, which
    /// declares only which needs exist. The compile step checks that this
    /// table covers exactly the needs that file declares.
    ///
    /// `BTreeMap` rather than `HashMap` for the same reason
    /// [`InteractionDef::advertises`] is one: the compiled pack feeds a
    /// determinism hash, and nothing on the way there may depend on hash
    /// iteration order. A map rather than a list also makes a repeated
    /// need a TOML parse error rather than something the compile step has
    /// to catch.
    pub decay_per_tick: BTreeMap<String, f32>,
}

/// Mirrors `content/needs.toml`, which declares which needs exist and
/// nothing else. Every `NeedId` variant must appear exactly once; that is
/// checked in the compile step, not here, because serde cannot express
/// it.
#[derive(Debug, Deserialize)]
pub struct NeedsFile {
    pub need: Vec<NeedDef>,
}

#[derive(Debug, Deserialize)]
pub struct NeedDef {
    /// Matches `NeedId::as_str`. An unknown name is a content error, not
    /// a parse error, so this stays a `String` here.
    pub id: String,
}

/// Mirrors `content/objects.toml`.
#[derive(Debug, Deserialize)]
pub struct ObjectsFile {
    pub object: Vec<ObjectDef>,
}

/// Mirrors `content/social.toml` - the interactions a SIM advertises to
/// other sims, [H4]/[H6].
///
/// The entries reuse [`InteractionDef`] unchanged, because a talk IS an
/// interaction - it merely has a person where the fridge would be. An
/// empty file is legal at compile time (test packs have no social life),
/// and the shipped pack is separately required to carry at least one
/// positively social entry by `the_shipped_pack_gives_sims_a_way_to_talk`.
#[derive(Debug, Deserialize)]
pub struct SocialFile {
    pub interaction: Vec<InteractionDef>,
}

/// The four isometric facings the Kenney kit pre-renders every piece at.
///
/// A string in the schema rather than an enum, because an unknown facing
/// is a CONTENT error the compile step reports with the file and object
/// named - serde's "unknown variant" error names neither.
pub const FACINGS: [&str; 4] = ["NE", "NW", "SE", "SW"];

#[derive(Debug, Deserialize)]
pub struct ObjectDef {
    pub id: String,
    pub name: String,
    /// Which sprite in the atlas draws this object.
    ///
    /// Required rather than defaulted, and it is content rather than a
    /// renderer detail on purpose. The alternative - a switch in
    /// TypeScript mapping object id to sprite - is a second copy of the
    /// object list living in the shell, so every new object would be a
    /// two-file edit and a silently-wrong sprite would be a two-file
    /// bug. That is the coupling [D1] exists to prevent.
    ///
    /// A `String` here and an index in the compiled pack, for the same
    /// reason a need name is: after compilation a sprite that the atlas
    /// does not hold has no representation.
    pub sprite: String,
    /// How many tiles this object occupies, as
    /// `footprint = { width = 2, depth = 1 }`.
    ///
    /// **Defaulted rather than required, which is the one place in this
    /// module that is a deliberate exception** to the "a defaulted zero is
    /// the silent-nothing case" reasoning on [`TuningFile`]. It defaults to
    /// 1x1 - see `Footprint`'s `Default`, which is hand-written for exactly
    /// this - so every object authored before footprints existed keeps the
    /// behaviour it had. [F1] in
    /// `docs/specs/2026-07-30-object-footprints-design.md` records why, and
    /// also why this is content rather than something derived from the
    /// sprite's pixel width: the sprite is presentation and the footprint is
    /// simulation, so a re-skin must not be able to change collision,
    /// pathing, or where a sim stands.
    ///
    /// A partial table is still a parse error, because `Footprint`'s own
    /// fields are required: `footprint = { width = 2 }` names no depth and
    /// serde says so. Only omitting the whole table is defaulting.
    ///
    /// `terri_core::Footprint` directly rather than an authored mirror
    /// alongside a compiled twin, unlike `sprite` or a placement's object
    /// id. Those two are NAMES that compilation resolves to indices, so the
    /// two representations differ; a footprint is the same two integers on
    /// both sides of the pipeline, and a mirror would be a second copy of
    /// one fact with nothing to disambiguate.
    #[serde(default)]
    pub footprint: Footprint,
    /// Absent rather than empty is the common case for scenery, so this
    /// defaults instead of being required.
    #[serde(default)]
    pub interaction: Vec<InteractionDef>,
    /// The station roles this object can serve in a chain -
    /// "eating_surface", "hob" ([K1]). A NEW vocabulary, deliberately
    /// not the activity-tag space: "this is a surface you can eat at"
    /// is a fact about furniture, "this is cooking" is a fact about an
    /// activity, and one word meaning both would be [S3]'s vocabulary
    /// collapse one file over. Defaulted: most furniture serves in no
    /// chain.
    #[serde(default)]
    pub roles: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct InteractionDef {
    pub id: String,
    /// What the right-click flyout calls this interaction, as
    /// `label = "Eat standing up"`.
    ///
    /// **Defaulted rather than required, and the default is the `id`** -
    /// the second exception in this module to the "a defaulted value is
    /// the silent-nothing case" reasoning on [`TuningFile`], and it is
    /// safe for the same reason `footprint`'s is. There is no zero-like
    /// fallback available to be quietly wrong: an unlabelled interaction
    /// falls back to a string the author definitely wrote, so the worst
    /// case is a menu entry reading `grab_snack` rather than a menu entry
    /// reading nothing. A required field would instead make every object
    /// authored before the flyout existed a parse error, for a string
    /// that is presentation and not simulation.
    ///
    /// An EMPTY label is a different matter and the compile step rejects
    /// it - see `ContentError::EmptyInteractionLabel`. A blank entry is a
    /// clickable row of nothing, which is exactly the silent-nothing shape
    /// [D9] converts into a build failure, and it is unreachable by the
    /// default because the default is a non-empty id.
    ///
    /// It is content rather than a table in TypeScript for the same reason
    /// `sprite` is: a lookup keyed by interaction id living in the shell
    /// would be a second copy of this list, so adding an interaction would
    /// be a two-file edit and mislabelling one would be a two-file bug.
    #[serde(default)]
    pub label: Option<String>,
    /// Need name to the delta this interaction advertises. Sparse: a
    /// need absent from the map is not advertised at all, which is not
    /// the same as advertising zero.
    ///
    /// `BTreeMap` rather than `HashMap`, and this is load-bearing rather
    /// than stylistic. The compiled pack is serialised in iteration
    /// order and feeds a determinism hash, so `HashMap`'s per-process
    /// ordering would surface as a spurious content diff rather than as
    /// an obvious bug. `advert_iteration_is_sorted_not_hash_ordered`
    /// pins it.
    pub advertises: BTreeMap<String, f32>,
    pub duration_ticks: u32,
    pub slots: u8,
    /// What KIND of activity this is - `tags = ["reading"]` - the hook
    /// hobbies, trait dispositions and capabilities all key on ([E2]/
    /// [E3] in the M2e design). Sparse and defaulted: most interactions
    /// are chores with no identity beyond their need deltas, and a
    /// file that had to tag every toilet visit would bury the tags
    /// that matter. Order is authored order; the compile step keeps it.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Base satisfaction paid on COMPLETION - the [E1] second axis's
    /// only upward path. Defaulted to zero, which here is genuinely
    /// the silent-nothing case being CORRECT: most activities pay
    /// nothing toward a life well lived, and only a hobby's yield is
    /// worth authoring. Negative is a compile error, not a mechanic -
    /// [S1] routes every downward write through neglect and
    /// conditions, never through content.
    #[serde(default)]
    pub satisfaction: f32,
}

/// Mirrors `content/lot.toml`: the size of the lot, its interior wall
/// tiles, and where each object stands.
///
/// Walls and placements both default, so an empty lot of a given size is
/// expressible without writing two empty arrays. A lot with no size is
/// not: `width` and `height` are required, because a defaulted zero is
/// exactly the silent-nothing case [D9] exists to prevent.
#[derive(Debug, Deserialize)]
pub struct LotFile {
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub wall: Vec<WallDef>,
    #[serde(default)]
    pub place: Vec<PlacementDef>,
    /// The tile a sim leaves the lot through - where a career's commute
    /// ends and the worker vanishes ([E4]). Optional, because a lot
    /// with nobody employed needs no exit; the compile step requires it
    /// the moment any household member holds a career, and validates it
    /// like a spawn tile (in bounds, walkable, reachable). NOT a door
    /// in [B7]'s sense - the tile is ordinary floor, and this merely
    /// names it.
    #[serde(default)]
    pub front_door: Option<FrontDoorDef>,
}

/// The front door tile. `i32` for the same reporting reason as
/// [`WallDef`]: a negative coordinate should reach the validator and be
/// named, not die as a serde type error.
#[derive(Debug, Deserialize)]
pub struct FrontDoorDef {
    pub x: i32,
    pub y: i32,
}

/// One impassable tile.
///
/// `i32` rather than `u32`, and that is a decision rather than a default.
/// `i32` is the tile coordinate type everywhere else - `TileGrid::
/// is_walkable` and `find_path` both take `(i32, i32)` - and it lets a
/// negative coordinate reach the validator, which reports it against the
/// lot it is outside of. A `u32` would make `x = -1` a serde type error
/// naming neither the lot nor the wall.
#[derive(Debug, Deserialize)]
pub struct WallDef {
    pub x: i32,
    pub y: i32,
}

/// Mirrors `content/personalities.toml`: the archetypes a household
/// member can be, each a bundle of multipliers - [H3] in
/// `docs/specs/2026-07-30-household-and-relationships-design.md`.
#[derive(Debug, Deserialize)]
pub struct PersonalitiesFile {
    /// Defaulted so a project with no archetypes yet parses; a household
    /// member naming one that does not exist is the compile step's error,
    /// not serde's.
    #[serde(default)]
    pub archetype: Vec<ArchetypeDef>,
}

#[derive(Debug, Deserialize)]
pub struct ArchetypeDef {
    pub id: String,
    /// Need name to a multiplier on how fast that need DRAINS for this
    /// sim. Sparse, and an absent need multiplies by 1.0: most archetypes
    /// are ordinary about most needs, and a file that had to restate
    /// seven 1.0s per archetype would bury the two numbers that make it a
    /// personality.
    ///
    /// `BTreeMap` for the reason every map in this module is one: the
    /// compiled pack feeds a determinism hash, and nothing on the way
    /// there may depend on hash iteration order.
    #[serde(default)]
    pub drain: BTreeMap<String, f32>,
    /// Need name to a multiplier on how much a positive delta RESTORES
    /// for this sim - and, through selection, how attractive it looks.
    /// Sparse like `drain`, absent is 1.0.
    ///
    /// The two maps are deliberately separate fields rather than one map
    /// of pairs, because the request that started this was explicit: an
    /// introvert's social should drain slowly AND refill generously, and
    /// those are different numbers read by different systems.
    #[serde(default)]
    pub satisfaction: BTreeMap<String, f32>,
    /// Per-interaction weights - "loves reading", "fears the couch". A
    /// weight of 0 is legal and IS the fear: the interaction scores as
    /// nothing, so the sim never chooses it on its own.
    #[serde(default)]
    pub disposition: Vec<DispositionDef>,
}

/// One archetype's feeling about one interaction, by name. The compile
/// step resolves both names to indices, so a dangling reference has no
/// representation once a pack exists.
#[derive(Debug, Deserialize)]
pub struct DispositionDef {
    pub object: String,
    pub interaction: String,
    pub weight: f32,
}

/// Mirrors `content/traits.toml`: the three trait mechanisms - [E3] in
/// `docs/specs/2026-08-01-m2e-satisfaction-hobbies-career-design.md`.
///
/// One file, three kinds, because the examples that motivated traits
/// look like one feature and are not ([S4]): a DISPOSITION weighs a
/// choice, a CAPABILITY gates one as may-attempt-may-fail, and a
/// CONDITION acts on the satisfaction axis itself. The kind is a
/// string here rather than an enum for the same reason a facing is:
/// an unknown kind is a CONTENT error the compile step reports with
/// the trait named, and serde's "unknown variant" error names nothing.
#[derive(Debug, Deserialize)]
pub struct TraitsFile {
    /// Defaulted so a project with no traits parses; a household member
    /// naming one that does not exist is the compile step's error.
    #[serde(default)]
    pub trait_def: Vec<TraitDef>,
}

/// One trait. Which numbers mean anything depends on `kind`; the
/// compile step rejects a trait that declares numbers its kind does not
/// read, because a `score_multiplier` on a condition is a statement the
/// simulation will silently ignore - the [D9] shape.
#[derive(Debug, Deserialize)]
pub struct TraitDef {
    pub id: String,
    /// What the UI calls it. Required and non-blank: unlike an
    /// interaction label there is no id-shaped fallback that reads as
    /// anything but a bug in a trait list.
    pub label: String,
    /// `disposition`, `capability` or `condition`. See [`TRAIT_KINDS`].
    pub kind: String,
    /// The activity tag this trait keys on - the same tag space hobbies
    /// use, resolved against the pack's interactions at compile time so
    /// a trait about nothing has no representation.
    pub tag: String,
    /// disposition only: what a tagged candidate's score is multiplied
    /// by. Zero is legal and IS the fear ([S4]); above 1 is a love.
    #[serde(default)]
    pub score_multiplier: Option<f32>,
    /// capability only: the level in `0..=1` the sim STARTS at.
    #[serde(default)]
    pub start_level: Option<f32>,
    /// capability only: what a FAILED attempt delivers of the activity's
    /// advertised benefit, usually 0.
    #[serde(default)]
    pub fail_delta_scale: Option<f32>,
    /// capability only: how much every attempt (pass or fail) raises the
    /// level, toward 1.
    #[serde(default)]
    pub learn_per_attempt: Option<f32>,
    /// condition only: what the satisfaction ACCRUAL is multiplied by at
    /// full severity; the effective scale interpolates toward 1 as
    /// severity falls.
    #[serde(default)]
    pub accrual_scale: Option<f32>,
    /// condition only: how much every completed activity carrying the
    /// trait's tag reduces the severity - the resolving loop.
    #[serde(default)]
    pub manage_per_completion: Option<f32>,
    /// condition only: the severity in `0..=1` the sim STARTS at.
    #[serde(default)]
    pub start_severity: Option<f32>,
}

/// The three legal trait kinds, in the order the design names them.
pub const TRAIT_KINDS: [&str; 3] = ["disposition", "capability", "condition"];

/// Mirrors `content/careers.toml` - the rabbit-hole jobs of [E4] and
/// [D15] Tier 2: the sim leaves the lot and returns with an outcome.
/// Mirrors `content/chains.toml` - the multi-step interactions, [K1]
/// in docs/specs/2026-08-01-m2f-multi-step-working-design.md.
#[derive(Debug, Deserialize)]
pub struct ChainsFile {
    /// Defaulted so a project with no chains parses; an advertiser
    /// naming an object that does not exist is the compile step's
    /// error.
    #[serde(default)]
    pub chain: Vec<ChainDef>,
}

/// One chain: a sequence of steps across station ROLES, with the whole
/// payoff at the last step's completion and nowhere else ([M-1]).
#[derive(Debug, Deserialize)]
pub struct ChainDef {
    pub id: String,
    /// What the flyout calls it. Required and non-blank, like a
    /// trait's label - there is no id-shaped fallback that reads as
    /// anything but a bug in a menu.
    pub label: String,
    /// The object DEFINITION whose flyout and adverts carry this
    /// chain - the fridge, for the shipped one. A string id resolved
    /// at compile time, the standing rule for every reference.
    pub advertised_by: String,
    /// Need name to delta, delivered whole at the terminal step's
    /// completion. The same map shape as an interaction's, validated
    /// by the same rules.
    pub advertises: BTreeMap<String, f32>,
    /// Satisfaction paid at the terminal completion, before the hobby
    /// multiplier. Finite and non-negative, like an interaction's.
    #[serde(default)]
    pub satisfaction: f32,
    /// The steps, in order. At least one; the LAST is implicitly
    /// terminal.
    pub step: Vec<ChainStepDef>,
}

/// One step of a chain: where it happens (a role, not an object -
/// "a surface you can eat at", resolved against the lot at run time),
/// what it is called, and how long it takes.
#[derive(Debug, Deserialize)]
pub struct ChainStepDef {
    /// The station role this step happens at. Must be worn by at
    /// least one object on the shipped lot; see `ObjectDef::roles`.
    pub role: String,
    /// What the activity indicator and any future UI call this step.
    /// Required and non-blank.
    pub label: String,
    pub duration_ticks: u32,
    /// The activity tags THIS STEP carries - the same tag space
    /// hobbies and traits key on, so a capability's roll fires at the
    /// tagged step and a hobby pays on the chain that contains one.
    #[serde(default)]
    pub tags: Vec<String>,
    /// The item kind this step puts in the sim's hands, by name -
    /// "ingredients". At most one of `yields`/`transforms` per step.
    #[serde(default)]
    pub yields: Option<String>,
    /// Rewrites the carried item: `{ from = "...", to = "..." }`.
    #[serde(default)]
    pub transforms: Option<TransformDef>,
    /// The item kind the step consumes; the compile step requires the
    /// TERMINAL step to consume whatever is still carried, so a chain
    /// cannot end with a full hand.
    #[serde(default)]
    pub consumes: Option<String>,
}

/// A `transforms` entry: what the carried item was, and what it
/// becomes.
#[derive(Debug, Deserialize)]
pub struct TransformDef {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Deserialize)]
pub struct CareersFile {
    /// Defaulted so a project with no careers parses; a household
    /// member naming one that does not exist is the compile step's
    /// error.
    #[serde(default)]
    pub career: Vec<CareerDef>,
}

#[derive(Debug, Deserialize)]
pub struct CareerDef {
    pub id: String,
    /// What the UI calls it. Required and non-blank, like a trait's.
    pub label: String,
    /// The tick of day the shift begins, in `0..day_ticks`.
    pub shift_start: u32,
    /// How long the sim is gone, in ticks. At least 1.
    pub shift_ticks: u32,
    /// What one shift pays into the household's Funds. Non-negative -
    /// v1 has no fines - and an i64 downstream because money will
    /// eventually be spent below zero of a PAYCHECK but never of the
    /// representable range.
    pub pay: u32,
    /// Energy the shift costs on return, in `0..=100`. The commute and
    /// the work happen off-lot, so the cost lands as one debit.
    pub energy_cost: f32,
    /// Satisfaction the shift pays (or costs nothing - zero is legal
    /// and is most jobs). Non-negative here: a job that actively
    /// drains a LIFE is a condition's business, not a paycheck's,
    /// which keeps [S1]'s writer list honest.
    pub satisfaction: f32,
}

/// Mirrors `content/household.toml`: who lives on the lot - [H2].
///
/// The household is CONTENT, not something the shell spawns. The shell
/// used to call `spawnAgent(8, 6, 25)` with coordinates written in
/// TypeScript, which is the same hardcoded-copy mistake the lot made
/// before M1b Task 3b.
#[derive(Debug, Deserialize)]
pub struct HouseholdFile {
    /// Defaulted: an empty household is a furnished lot with nobody home,
    /// which is a legitimate authoring state and the state every content
    /// fixture predating M2c was written in.
    #[serde(default)]
    pub sim: Vec<HouseholdSimDef>,
}

#[derive(Debug, Deserialize)]
pub struct HouseholdSimDef {
    pub name: String,
    /// Names an `[[archetype]]` in `content/personalities.toml`.
    pub archetype: String,
    /// Spawn position, `f32` like a placement's because `Position` is an
    /// f32 pair; the tile is the tile the coordinates fall in.
    pub x: f32,
    pub y: f32,
    /// Starting need levels. Sparse: an absent need starts full, because
    /// the interesting authoring statement is "Terri arrives hungry", not
    /// a seven-line restatement of contentment.
    #[serde(default)]
    pub needs: BTreeMap<String, f32>,
    /// The activity TAGS this sim loves - `hobbies = ["reading"]`. A
    /// completed activity carrying one of these pays its satisfaction
    /// multiplied by `hobby_multiplier` ([E2]). Defaulted: a sim with
    /// no hobbies is legal authoring (and a life the satisfaction axis
    /// will quietly indict). A hobby naming a tag no interaction in
    /// the pack carries is a dangling reference and a compile error,
    /// per [D9].
    #[serde(default)]
    pub hobbies: Vec<String>,
    /// The traits this sim spawns with, by id from `content/traits.toml`
    /// ([E3]). Defaulted, and AUTHORED rather than rolled: the household
    /// is authored content, and the SimRng roll [S4] asks for arrives
    /// with procedurally spawned sims (M3) - the design records this
    /// reading. An unknown id is a compile error.
    #[serde(default)]
    pub traits: Vec<String>,
    /// The career this sim holds, by id from `content/careers.toml`, or
    /// absent for the unemployed ([E4]). An unknown id is a compile
    /// error.
    #[serde(default)]
    pub career: Option<String>,
}

/// Mirrors `assets/sprites/atlas.toml`, which is **generated** by
/// `assets/sprites/build-atlas.ps1` rather than authored.
///
/// It is read here rather than in the renderer because the check it
/// enables - "every object names a sprite the atlas actually holds" - is
/// a dangling-reference check, and [D9] puts those at build time where
/// they abort the build. The renderer reads the same manifest through
/// its generated `web/src/render/atlas.ts` twin.
///
/// Only the fields the validator needs are declared. `x`, `y`, `w` and
/// `h` are in the file and are deliberately absent here: pixel
/// coordinates are the renderer's business, and a `terri-data` that
/// parsed them would invite something in the simulation to use one.
#[derive(Debug, Deserialize)]
pub struct AtlasFile {
    /// Declaration order is the sprite index. Nothing sorts it.
    pub sprite: Vec<AtlasSpriteDef>,
}

#[derive(Debug, Deserialize)]
pub struct AtlasSpriteDef {
    pub name: String,
}

/// One object, placed. `object` is the string id of an entry in
/// `objects.toml`; the compile step resolves it to an `ObjectDefId`, so
/// a dangling reference has no representation once a pack exists.
///
/// Coordinates are `f32` rather than tile indices because `Position` is
/// an f32 pair: an object may stand anywhere, and the tile it occupies
/// is the tile its coordinates fall in.
#[derive(Debug, Deserialize)]
pub struct PlacementDef {
    pub object: String,
    pub x: f32,
    pub y: f32,
    /// Which of the kit's four pre-rendered facings this placement is
    /// drawn with - `"SW"` and friends, see [`FACINGS`]. Absent means
    /// the object definition's own sprite, which is the `_SE` facing by
    /// this project's import convention. Presentation only: the
    /// simulation neither knows nor cares which way a counter faces.
    #[serde(default)]
    pub facing: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The fourteen scalar knobs, with pairwise distinct values so that a
    /// field read off the wrong key is visible. Two knobs sharing a value
    /// would make a transposed pair of fields parse identically, which
    /// is [L34] in the tuning file's costume.
    ///
    /// The six `u32`s and the `u64` are deliberately different numbers
    /// for the same reason, and every float is exact in binary32 so the
    /// assertions can be equalities rather than tolerances.
    const TUNING_LINES: [(&str, &str); 22] = [
        ("action_threshold", "0.25"),
        ("choice_temperature", "0.5"),
        ("idle_threshold", "0.125"),
        ("wander_pause_ticks", "9"),
        ("wander_attempts", "6"),
        ("duration_variance", "0.75"),
        ("habituation_per_use", "0.3125"),
        ("habituation_decay_per_tick", "0.0625"),
        ("habituation_floor", "0.625"),
        ("min_interaction_ticks", "3"),
        ("rng_seed", "300"),
        ("max_queued_intents", "7"),
        ("max_queued_commands", "11"),
        ("need_bar_refresh_ms", "13"),
        ("contested_score_multiplier", "0.375"),
        ("relationship_gain_per_talk", "0.4375"),
        ("relationship_decay_per_tick", "0.001953125"),
        ("relationship_delta_scale", "0.875"),
        ("hobby_multiplier", "2.5"),
        ("neglect_floor", "21.0"),
        ("neglect_bleed_per_tick", "0.0009765625"),
        ("day_ticks", "17"),
    ];

    /// The decay table, which is the twelfth knob and the only one that is
    /// not a scalar. Its key is named separately because a TOML table has
    /// to be emitted after every top-level key rather than in line with
    /// them.
    const DECAY_KEY: &str = "decay_per_tick";

    /// Three needs rather than seven: this module tests SHAPE, and
    /// "exactly the seven `NeedId` variants" is a compile-step rule.
    /// Distinct rates, again so a value read off the wrong key is visible,
    /// and declared out of alphabetical order so a map that preserved
    /// insertion order would be distinguishable from a sorted one.
    const DECAY_LINES: [(&str, &str); 3] = [
        ("social", "0.0625"),
        ("hunger", "0.03125"),
        ("energy", "0.015625"),
    ];

    /// The fixture above as TOML, minus the named knob. Passing a name
    /// no knob has yields the complete file.
    fn tuning_toml_without(omitted: &str) -> String {
        let mut out: String = TUNING_LINES
            .iter()
            .filter(|(key, _)| *key != omitted)
            .map(|(key, value)| format!("{key} = {value}\n"))
            .collect();
        // The table goes last, because everything after a `[table]`
        // header in TOML belongs to that table.
        if omitted != DECAY_KEY {
            out.push_str(&format!("\n[{DECAY_KEY}]\n"));
            for (need, rate) in DECAY_LINES {
                out.push_str(&format!("{need} = {rate}\n"));
            }
        }
        out
    }

    #[test]
    fn parses_a_tuning_file() {
        let parsed: TuningFile =
            toml::from_str(&tuning_toml_without("")).expect("valid tuning toml");

        assert_eq!(parsed.action_threshold, 0.25);
        assert_eq!(parsed.choice_temperature, 0.5);
        assert_eq!(parsed.idle_threshold, 0.125);
        assert_eq!(parsed.wander_pause_ticks, 9);
        assert_eq!(parsed.wander_attempts, 6);
        assert_eq!(parsed.duration_variance, 0.75);
        assert_eq!(parsed.habituation_per_use, 0.3125);
        assert_eq!(parsed.habituation_decay_per_tick, 0.0625);
        assert_eq!(parsed.habituation_floor, 0.625);
        assert_eq!(parsed.min_interaction_ticks, 3);
        assert_eq!(parsed.rng_seed, 300);
        assert_eq!(parsed.max_queued_intents, 7);
        assert_eq!(parsed.max_queued_commands, 11);
        assert_eq!(parsed.need_bar_refresh_ms, 13);
        assert_eq!(parsed.contested_score_multiplier, 0.375);
        assert_eq!(parsed.relationship_gain_per_talk, 0.4375);
        assert_eq!(parsed.relationship_decay_per_tick, 0.001953125);
        assert_eq!(parsed.relationship_delta_scale, 0.875);
        assert_eq!(parsed.hobby_multiplier, 2.5);
        assert_eq!(parsed.neglect_floor, 21.0);
        assert_eq!(parsed.neglect_bleed_per_tick, 0.0009765625);
        assert_eq!(parsed.day_ticks, 17);

        assert_eq!(parsed.decay_per_tick.len(), DECAY_LINES.len());
        for (need, rate) in DECAY_LINES {
            assert_eq!(
                parsed.decay_per_tick.get(need),
                Some(&rate.parse::<f32>().expect("the fixture rates are numbers")),
                "'{need}' did not reach the decay table with its own rate"
            );
        }
    }

    /// The decay table is keyed by need NAME while the compiled pack is
    /// keyed by need INDEX, so two orders exist and something has to pick
    /// one. `BTreeMap` iterates sorted; a `HashMap` would iterate in an
    /// order that varies from process to process, and the compiled pack
    /// feeds a determinism hash. Same mechanism, and the same reasoning,
    /// as `advert_iteration_is_sorted_not_hash_ordered` below.
    #[test]
    fn decay_iteration_is_sorted_not_hash_ordered() {
        let declared: Vec<&str> = DECAY_LINES.iter().map(|(need, _)| *need).collect();
        let mut sorted = declared.clone();
        sorted.sort_unstable();
        assert_ne!(
            declared, sorted,
            "the declared order must differ from sorted order, or this \
             test cannot tell an insertion-ordered map from a sorted one"
        );

        let parsed: TuningFile =
            toml::from_str(&tuning_toml_without("")).expect("valid tuning toml");
        let keys: Vec<&str> = parsed
            .decay_per_tick
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>();
        assert_eq!(keys, sorted, "decay iteration order is not sorted");
    }

    /// The rejecting half, and the reason `TuningFile` has no
    /// `#[serde(default)]` anywhere.
    ///
    /// A knob is not merely nicer to require than to default: an
    /// omitted `choice_temperature` defaulting to zero divides by zero
    /// in selection, and an omitted `duration_variance` defaulting to
    /// zero produces a simulation that runs and is simply metronomic.
    /// Both are the silent-nothing case [D9] exists to convert into a
    /// build failure.
    ///
    /// Every field is tried rather than one, because a `#[serde(default)]`
    /// added to a single knob is exactly the edit a one-field test
    /// cannot see.
    #[test]
    fn every_tuning_knob_is_required_rather_than_defaulted() {
        assert!(
            toml::from_str::<TuningFile>(&tuning_toml_without("")).is_ok(),
            "the complete fixture must parse, or the omissions below \
             prove nothing"
        );

        let omissions = TUNING_LINES
            .iter()
            .map(|(key, _)| *key)
            .chain(std::iter::once(DECAY_KEY));
        for omitted in omissions {
            let err = match toml::from_str::<TuningFile>(&tuning_toml_without(omitted)) {
                Ok(parsed) => {
                    panic!("a tuning file missing '{omitted}' must not parse; got {parsed:?}")
                }
                Err(err) => err,
            };
            assert!(
                err.to_string().contains(omitted),
                "the error must name the missing knob '{omitted}'; got {err}"
            );
        }
    }

    #[test]
    fn parses_a_needs_file() {
        let parsed: NeedsFile = toml::from_str(
            r#"
            [[need]]
            id = "hunger"

            [[need]]
            id = "energy"
            "#,
        )
        .expect("valid needs toml");
        assert_eq!(
            parsed
                .need
                .iter()
                .map(|n| n.id.as_str())
                .collect::<Vec<_>>(),
            vec!["hunger", "energy"],
            "needs.toml declares which needs exist, in declaration order"
        );
    }

    #[test]
    fn parses_an_object_with_a_sparse_advert() {
        let parsed: ObjectsFile = toml::from_str(
            r#"
            [[object]]
            id = "fridge"
            name = "Chill-o-Matic 3000"
            sprite = "kitchenFridgeBuiltIn"

              [[object.interaction]]
              id = "grab_snack"
              advertises = { hunger = 35.0 }
              duration_ticks = 15
              slots = 1
            "#,
        )
        .expect("valid objects toml");
        let obj = &parsed.object[0];
        assert_eq!(obj.id, "fridge");
        assert_eq!(obj.sprite, "kitchenFridgeBuiltIn");
        let act = &obj.interaction[0];
        assert_eq!(act.advertises.get("hunger"), Some(&35.0));
        assert_eq!(act.advertises.len(), 1, "advert must stay sparse");
        assert_eq!(act.duration_ticks, 15);
    }

    /// Both halves of `#[serde(default)]` on `label`.
    ///
    /// **Omitting it must leave the field ABSENT rather than empty**, because
    /// absent is what the compile step turns into the interaction's `id`. A
    /// `String` field defaulting to `""` would compile to a blank menu entry,
    /// which is the shape this whole module exists to reject; the `Option` is
    /// what makes "the author said nothing" a state the compile step can see.
    ///
    /// And declaring one must land the author's string rather than the id, so
    /// the fixture's label is deliberately nothing like `grab_snack` - a
    /// default that overwrote a declared label would be invisible against a
    /// label that merely resembled its id ([L34]).
    #[test]
    fn an_interaction_label_defaults_to_absent_and_is_kept_verbatim_when_declared() {
        let interaction = |extra: &str| -> InteractionDef {
            let parsed: ObjectsFile = toml::from_str(&format!(
                r#"
                [[object]]
                id = "fridge"
                name = "Chill-o-Matic 3000"
                sprite = "kitchenFridgeBuiltIn"

                  [[object.interaction]]
                  id = "grab_snack"
                  {extra}
                  advertises = {{ hunger = 35.0 }}
                  duration_ticks = 15
                  slots = 1
                "#
            ))
            .expect("valid objects toml");
            parsed
                .object
                .into_iter()
                .next()
                .expect("one object")
                .interaction
                .into_iter()
                .next()
                .expect("one interaction")
        };

        assert_eq!(
            interaction("").label,
            None,
            "an interaction that says nothing about a label must parse as \
             absent, not as an empty string; the compile step needs to tell \
             the two apart"
        );
        assert_eq!(
            interaction(r#"label = "Eat standing up""#).label.as_deref(),
            Some("Eat standing up"),
            "a declared label must reach the schema verbatim"
        );
    }

    /// The advert map is written into the compiled pack in iteration
    /// order, and that pack feeds a determinism hash, so the ordering is
    /// a mechanism rather than a detail. `BTreeMap` iterates sorted; a
    /// `HashMap` iterates in an order that varies from process to
    /// process, which would surface downstream as a spurious content
    /// diff rather than as an obvious bug.
    ///
    /// Measured: with `advertises` switched to a `HashMap`, the other
    /// three tests in this module all stay green. This is the only one
    /// that moves.
    #[test]
    fn advert_iteration_is_sorted_not_hash_ordered() {
        // Deliberately not alphabetical. If the source order were sorted
        // then an insertion-ordered map would satisfy the assertion at
        // the bottom too, and the test would stop discriminating between
        // the three map behaviours instead of just two.
        const DECLARED: [&str; 7] = [
            "social", "hunger", "comfort", "fun", "bladder", "energy", "hygiene",
        ];
        let mut sorted = DECLARED;
        sorted.sort_unstable();
        assert_ne!(
            DECLARED, sorted,
            "the declared order must differ from sorted order, or this test proves nothing"
        );

        let adverts = DECLARED
            .iter()
            .enumerate()
            .map(|(i, need)| format!("{need} = {}.0", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let parsed: ObjectsFile = toml::from_str(&format!(
            r#"
            [[object]]
            id = "bed"
            name = "Sleepeazy"
            sprite = "bedBunk"

              [[object.interaction]]
              id = "sleep"
              advertises = {{ {adverts} }}
              duration_ticks = 40
              slots = 1
            "#
        ))
        .expect("valid objects toml");

        let keys: Vec<&str> = parsed.object[0].interaction[0]
            .advertises
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, sorted, "advert iteration order is not sorted");
    }

    /// The two halves of `#[serde(default)]` on `footprint`.
    ///
    /// **Omitting it must leave the object 1x1**, because that is what makes
    /// [F1]'s "existing content is unchanged" true: every object authored
    /// before footprints existed says nothing about one. A derived `Default`
    /// on `Footprint` would give 0x0 here and quietly make every such object
    /// unusable, so this is checking a mechanism rather than a formality -
    /// see `the_default_footprint_is_one_tile_rather_than_no_tiles` in
    /// `terri-core`, which pins the other end of the same claim.
    ///
    /// And declaring it must land the two numbers the right way round. The
    /// fixture is 2x3, deliberately not square, so a `width` read off `depth`
    /// moves an assertion.
    #[test]
    fn an_object_footprint_defaults_to_one_tile_and_is_read_unswapped_when_declared() {
        let object = |extra: &str| -> ObjectDef {
            let parsed: ObjectsFile = toml::from_str(&format!(
                r#"
                [[object]]
                id = "bed"
                name = "Sleepeazy"
                sprite = "bedBunk"
                {extra}
                "#
            ))
            .expect("valid objects toml");
            parsed.object.into_iter().next().expect("one object")
        };

        assert_eq!(
            object("").footprint,
            Footprint::SINGLE,
            "an object that says nothing about a footprint occupies one tile"
        );

        let declared = object("footprint = { width = 2, depth = 3 }").footprint;
        assert_eq!(declared.width, 2);
        assert_eq!(declared.depth, 3);
        assert_ne!(
            declared,
            Footprint::SINGLE,
            "the declared case must differ from the default, or the assertion \
             above cannot tell a parsed footprint from a defaulted one"
        );
    }

    /// A HALF-declared footprint is a parse error rather than half a default.
    ///
    /// `#[serde(default)]` applies to the whole table, not to its fields, so
    /// `footprint = { width = 2 }` is a missing `depth` and serde names it.
    /// That is the behaviour worth pinning: the alternative - a `depth` that
    /// quietly fell back to 1 - is the silent-nothing case the rest of this
    /// module exists to prevent, and it would be indistinguishable from a
    /// deliberate 2x1.
    #[test]
    fn a_half_declared_footprint_is_a_parse_error_rather_than_half_a_default() {
        for (partial, missing) in [("width = 2", "depth"), ("depth = 2", "width")] {
            let err = toml::from_str::<ObjectsFile>(&format!(
                r#"
                [[object]]
                id = "bed"
                name = "Sleepeazy"
                sprite = "bedBunk"
                footprint = {{ {partial} }}
                "#
            ))
            .unwrap_err();
            assert!(
                err.to_string().contains(missing),
                "the error must name the missing dimension '{missing}'; got {err}"
            );
        }
    }

    #[test]
    fn an_object_may_declare_no_interactions() {
        let parsed: ObjectsFile = toml::from_str(
            r#"
            [[object]]
            id = "rug"
            name = "Rug"
            sprite = "rugRound"
            "#,
        )
        .expect("objects with no interaction should parse");
        assert!(parsed.object[0].interaction.is_empty());
    }

    /// Both defaults on the two new files, and one full parse each.
    ///
    /// The sparse maps are the load-bearing part: an archetype that says
    /// nothing about a need must parse with that need ABSENT, because the
    /// compile step fills absences with 1.0 and a serde default of 0.0
    /// would freeze decay or nullify benefits silently. The values are
    /// pairwise distinct and exact in binary32 ([L34]).
    #[test]
    fn parses_an_archetype_with_sparse_maps_and_dispositions() {
        let parsed: PersonalitiesFile = toml::from_str(
            r#"
            [[archetype]]
            id = "the_settled"
            drain = { comfort = 1.5, energy = 0.75 }
            satisfaction = { comfort = 1.25 }

              [[archetype.disposition]]
              object = "armchair"
              interaction = "take_the_chair"
              weight = 1.875
            "#,
        )
        .expect("valid personalities toml");

        let archetype = &parsed.archetype[0];
        assert_eq!(archetype.id, "the_settled");
        assert_eq!(archetype.drain.get("comfort"), Some(&1.5));
        assert_eq!(archetype.drain.get("energy"), Some(&0.75));
        assert_eq!(archetype.drain.len(), 2, "the drain map must stay sparse");
        assert_eq!(archetype.satisfaction.get("comfort"), Some(&1.25));
        assert_eq!(archetype.satisfaction.len(), 1);
        assert_eq!(archetype.disposition.len(), 1);
        assert_eq!(archetype.disposition[0].object, "armchair");
        assert_eq!(archetype.disposition[0].interaction, "take_the_chair");
        assert_eq!(archetype.disposition[0].weight, 1.875);
    }

    #[test]
    fn an_archetype_may_say_nothing_beyond_its_id() {
        // All three fields default. An archetype that is ordinary about
        // everything is expressible as one line, which is what makes the
        // interesting numbers in a real file stand out.
        let parsed: PersonalitiesFile = toml::from_str(
            "[[archetype]]
id = \"beige\"
",
        )
        .expect("bare archetype parses");
        let archetype = &parsed.archetype[0];
        assert!(archetype.drain.is_empty());
        assert!(archetype.satisfaction.is_empty());
        assert!(archetype.disposition.is_empty());
    }

    #[test]
    fn parses_a_household_and_an_empty_one() {
        let parsed: HouseholdFile = toml::from_str(
            r#"
            [[sim]]
            name = "Terri"
            archetype = "the_striver"
            x = 9.5
            y = 2.25
            needs = { hunger = 62.5 }
            "#,
        )
        .expect("valid household toml");
        let sim = &parsed.sim[0];
        assert_eq!(sim.name, "Terri");
        assert_eq!(sim.archetype, "the_striver");
        // Fractional on purpose: every coordinate being an integer would
        // make a truncating parse invisible ([L34]).
        assert_eq!((sim.x, sim.y), (9.5, 2.25));
        assert_eq!(sim.needs.get("hunger"), Some(&62.5));
        assert_eq!(sim.needs.len(), 1, "the needs map must stay sparse");

        // Nobody home is a state, not an error; every fixture predating
        // M2c is this state.
        let empty: HouseholdFile = toml::from_str("").expect("an empty household parses");
        assert!(empty.sim.is_empty());
    }
    /// The shipped `lot.toml` uses inline tables inside an array, which
    /// is the only form in which fifteen wall tiles are readable. Serde
    /// accepts both that and `[[wall]]` sections, so this pins the one
    /// the authored file actually uses.
    ///
    /// The fixture is deliberately non-square and its walls are declared
    /// out of sorted order, so a transposed `width`/`height` and a
    /// silently reordered wall list are both visible here.
    #[test]
    fn parses_a_lot_with_walls_and_placements() {
        let parsed: LotFile = toml::from_str(
            r#"
            width = 6
            height = 4

            wall = [
              { x = 3, y = 2 },
              { x = 1, y = 0 },
            ]

            place = [
              { object = "fridge", x = 2.5, y = 1.25 },
            ]
            "#,
        )
        .expect("valid lot toml");

        assert_eq!((parsed.width, parsed.height), (6, 4));
        assert_eq!(
            parsed.wall.iter().map(|w| (w.x, w.y)).collect::<Vec<_>>(),
            vec![(3, 2), (1, 0)],
            "walls must keep the order they were declared in"
        );
        assert_eq!(parsed.place.len(), 1);
        assert_eq!(parsed.place[0].object, "fridge");
        // Fractional on purpose. Every coordinate being an integer would
        // make a truncating parse indistinguishable from a correct one;
        // see [L34].
        assert_eq!((parsed.place[0].x, parsed.place[0].y), (2.5, 1.25));
    }

    /// A lot with nothing in it yet is a legitimate authoring state, and
    /// the `#[serde(default)]` on both lists is what allows it. Without
    /// them, deleting the last object from a lot would turn a size-only
    /// file into a parse error.
    #[test]
    fn a_lot_may_declare_no_walls_and_no_placements() {
        let parsed: LotFile =
            toml::from_str("width = 2\nheight = 3\n").expect("a bare lot size should parse");
        assert!(parsed.wall.is_empty());
        assert!(parsed.place.is_empty());
        assert_eq!((parsed.width, parsed.height), (2, 3));
    }

    /// The size is the one thing that has no sensible default: a lot
    /// silently defaulting to 0x0 has no walkable tile at all, and every
    /// agent in it would simply never move. Serde must reject the file
    /// rather than compile a lot nobody can stand in.
    #[test]
    fn a_lot_without_a_size_is_a_parse_error_rather_than_a_zero_lot() {
        let err = toml::from_str::<LotFile>("wall = []\n").unwrap_err();
        assert!(
            err.to_string().contains("width"),
            "the error must name the missing field; got {err}"
        );
    }
}
