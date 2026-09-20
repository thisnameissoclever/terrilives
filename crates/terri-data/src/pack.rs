//! The compiled content pack: what validation produces and what the
//! simulation reads.
//!
//! Everything here is post-validation. The types deliberately cannot
//! express the states `compile` rejects - a need name is an index rather
//! than a string, so an unknown need has no representation once a pack
//! exists. That is the point of [D9]: a broken pack must not be
//! constructible, so it can never reach runtime.

use serde::{Deserialize, Serialize};
use terri_core::NEED_COUNT;

/// Defined in `terri-core`, re-exported here so content consumers have
/// one import path. It lives there because `SmartObject` holds one and
/// `terri-core` must not depend on the content crate.
pub use terri_core::ObjectDefId;

/// Also defined in `terri-core` and re-exported for the same reason:
/// `TileGrid::find_path_adjacent` takes one, so it has to live below the
/// content crate rather than inside it.
pub use terri_core::Footprint;

/// Also defined in `terri-core`: the simulation's `ObjectFacing` component
/// and the save file both carry one, so it lives below the content crate.
pub use terri_core::Facing;

/// One optional atlas index per direction, in [`Facing::ALL`] code order.
/// The base-direction slot holds the definition's sprite; missing imports
/// remain `None`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct FacingSprites(pub [Option<u32>; 4]);

impl FacingSprites {
    /// No facing drawn at all: an object with no foreground layer.
    pub const NONE: Self = Self([None; 4]);

    /// Only the south-east render exists, as in most test fixtures.
    pub fn south_east_only(sprite: u32) -> Self {
        Self([Some(sprite), None, None, None])
    }

    /// The atlas index drawn at `facing`, if that render exists.
    pub fn get(&self, facing: Facing) -> Option<u32> {
        self.0[facing.code() as usize]
    }
}

/// Closed object-audio vocabulary resolved from authored `sound_action`.
///
/// This is presentation metadata. Gameplay tags, broad activities, and object
/// names cannot be used as substitutes because each answers a different
/// question.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CompiledSoundAction {
    ShowerWater,
    StoveCooking,
}

/// Body-pose category resolved from an authored `visual` table.
/// Presentation has its own vocabulary rather than reusing gameplay tags or
/// broad activity-indicator codes, which answer different questions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CompiledVisualAction {
    Talk,
    Eat,
    Read,
    Exercise,
    Watch,
    Sit,
    Sleep,
}

/// The entity that gives an action pose its spatial meaning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CompiledVisualAnchor {
    Partner,
    Object,
    Station,
    ObjectSocket,
}

/// How a body chooses a lot-axis facing from its resolved anchor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CompiledVisualFacing {
    TowardAnchor,
    Socket,
}

/// Fully validated presentation metadata. Unknown and partial authored
/// values have no representation after compilation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompiledVisual {
    pub action: CompiledVisualAction,
    pub anchor: CompiledVisualAnchor,
    pub facing: CompiledVisualFacing,
    /// Index into the owning object's action sockets. `None` for every visual
    /// contract anchored anywhere else. Appended for postcard stability.
    pub socket: Option<u32>,
}

/// Facing resolved to the lot axes used by the presentation bridge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CompiledSocketFacing {
    PositiveX,
    NegativeX,
    PositiveY,
    NegativeY,
}

/// A validated object-local action socket.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledActionSocket {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub facing: CompiledSocketFacing,
}

impl CompiledSocketFacing {
    /// The unit lot axis this facing points along.
    fn axis(self) -> (i32, i32) {
        match self {
            Self::PositiveX => (1, 0),
            Self::NegativeX => (-1, 0),
            Self::PositiveY => (0, 1),
            Self::NegativeY => (0, -1),
        }
    }

    /// Rotate this socket axis by a relative turn from the definition's base.
    /// `SouthEast` represents zero quarter turns and returns it unchanged.
    pub fn turned_with(self, object_facing: Facing) -> Self {
        let (x, y) = self.axis();
        match object_facing.rotate_axis(x, y) {
            (1, 0) => Self::PositiveX,
            (-1, 0) => Self::NegativeX,
            (0, 1) => Self::PositiveY,
            (0, -1) => Self::NegativeY,
            _ => unreachable!("rotating a unit axis by quarter turns produces a unit axis"),
        }
    }
}

/// A placement's absolute socket after its authored facing is applied.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledPlacementSocket {
    pub x: f32,
    pub y: f32,
    pub facing: CompiledSocketFacing,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledInteraction {
    pub id: String,
    /// (`NeedId` index, delta), sorted by index. Sparse: only advertised
    /// needs appear, and an absent need is not advertised at all, which
    /// is not the same as advertising zero.
    pub advertises: Vec<(u8, f32)>,
    pub duration_ticks: u32,
    pub slots: u8,
    /// What the right-click flyout calls this interaction.
    ///
    /// Never empty and always present: the compile step falls back to the
    /// authored `id` when `content/objects.toml` declares no `label`, and
    /// rejects a label that is blank. So a reader may show this directly
    /// rather than testing it, which is [D9] applied to a string - a menu
    /// entry with no text has no representation once a pack exists.
    ///
    /// It was last in this struct until the M2e pair below arrived; they
    /// are last now, for the appending reason on [`ContentPack::lot`].
    pub label: String,
    /// The activity's identity tags - what hobbies, trait dispositions
    /// and capabilities key on ([E2]/[E3] in the M2e design). Authored
    /// order, non-empty strings by validation, usually empty: most
    /// interactions are chores.
    pub tags: Vec<String>,
    /// Satisfaction paid on COMPLETION, before the hobby multiplier.
    /// Finite and non-negative by validation - content can never write
    /// the second axis downward ([S1]); neglect and conditions own that
    /// direction. It was last until the presentation field below arrived.
    pub satisfaction: f32,
    /// Optional authored body-presentation contract. Presentation-only and
    /// deliberately outside Save V1's compatibility digest.
    /// It was last until the object-audio field below arrived.
    pub visual: Option<CompiledVisual>,
    /// Optional authored object-audio category. Presentation-only and outside
    /// Save V1's compatibility digest.
    /// **Last in this struct on purpose**, per the appending rule.
    pub sound_action: Option<CompiledSoundAction>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledObject {
    pub id: String,
    pub name: String,
    /// Index into `assets/sprites/atlas.toml`'s `[[sprite]]` list, and
    /// therefore into the renderer's `SPRITES` array, which is generated
    /// from the same manifest in the same pass.
    ///
    /// An index rather than the authored name for the same reason a need
    /// is an index: once a pack exists, a sprite the atlas does not hold
    /// has no representation.
    pub sprite: u32,
    pub interactions: Vec<CompiledInteraction>,
    /// The tiles this object occupies, running +x and +y from whatever tile
    /// a placement puts it on. 1x1 unless `content/objects.toml` says
    /// otherwise.
    ///
    /// Post-validation like everything else here: `compile` rejects a zero
    /// dimension, a rectangle that leaves the lot or crosses a wall, two
    /// rectangles that overlap, and an object nothing can walk up to. A
    /// reader may assume all of that rather than re-check it, which is what
    /// lets `Sim::new_from_lot` block these tiles without a bounds test.
    ///
    /// It was last in this struct until `roles` arrived, for the
    /// appending reason on [`ContentPack::lot`]: the pack's byte encoding
    /// grows by appending, so an object's sprite and interaction blocks
    /// keep their offsets and the golden vector in `compile.rs` stays
    /// reviewable against the annotations it already carries. It is
    /// deliberately NOT grouped beside `sprite`, which would also be the
    /// wrong signal: [F1] exists to keep the drawn width and the occupied
    /// width separate facts.
    pub footprint: Footprint,
    /// The station roles this object serves in a chain, as indices
    /// into [`ContentPack::roles`] - [K1]. Sorted, usually empty.
    /// Appended after `footprint` when roles shipped; its encoded position
    /// must not move.
    pub roles: Vec<u32>,
    /// Presentation-only anchors, indexed by `CompiledVisual::socket`.
    /// Appended after `roles` when sockets shipped; its encoded position must
    /// not move.
    pub action_sockets: Vec<CompiledActionSocket>,
    /// Optional atlas layer drawn after bodies occupying this object.
    /// Presentation-only and reconstructed from the current pack on load.
    pub foreground_sprite: Option<u32>,
    /// The atlas index this object is drawn with at each facing. The
    /// base-facing entry is always `sprite`. Appended when objects became
    /// turnable at runtime; its encoded position must not move.
    pub facing_sprites: FacingSprites,
    /// The foreground layer at each facing. All `None` for an object with
    /// no foreground layer; otherwise the base-facing entry is
    /// `foreground_sprite`.
    pub facing_foreground_sprites: FacingSprites,
    /// Authored geometry and default art orientation. Transforms use a relative turn.
    pub base_facing: Facing,
}

impl CompiledObject {
    pub fn footprint_at(&self, facing: Facing) -> Footprint {
        if self.relative_turn(facing).swaps_footprint_sides() {
            Footprint {
                width: self.footprint.depth,
                depth: self.footprint.width,
            }
        } else {
            self.footprint
        }
    }

    fn relative_turn(&self, facing: Facing) -> Facing {
        Facing::ALL[((facing.code() + 4 - self.base_facing.code()) % 4) as usize]
    }
    /// Whether this object can be drawn at `facing`: its sprite exists
    /// for that facing and, when it has a foreground layer, so does the
    /// layer. A body drawn behind a foreground from another facing would
    /// be covered by the wrong pixels, so a missing layer rules the facing
    /// out rather than being skipped.
    pub fn supports(&self, facing: Facing) -> bool {
        self.facing_sprites.get(facing).is_some()
            && (self.foreground_sprite.is_none()
                || self.facing_foreground_sprites.get(facing).is_some())
    }

    /// The next supported facing after `from` in quarter-turn order, or
    /// `None` when `from` is the only facing this object supports.
    pub fn next_supported_facing(&self, from: Facing) -> Option<Facing> {
        let mut candidate = from.turned();
        // Three steps reach every facing other than `from`; the fourth
        // would be `from` itself.
        for _ in 0..3 {
            if self.supports(candidate) {
                return Some(candidate);
            }
            candidate = candidate.turned();
        }
        None
    }

    /// This object's action sockets in lot coordinates, for an object whose
    /// origin tile is `(origin_x, origin_y)` and which faces `facing`.
    ///
    /// A socket is authored as an offset from the footprint's centre for
    /// the definition's base render. Turning the object rotates the offset about
    /// the centre of the ORIENTED rectangle and turns the socket's own
    /// facing with it. The compile step has already checked that every
    /// socket stays inside the rectangle at every supported facing.
    pub fn sockets_at(
        &self,
        origin_x: f32,
        origin_y: f32,
        facing: Facing,
    ) -> Vec<CompiledPlacementSocket> {
        let footprint = self.footprint_at(facing);
        let turn = self.relative_turn(facing);
        let centre_x = origin_x + (footprint.width - 1) as f32 / 2.0;
        let centre_y = origin_y + (footprint.depth - 1) as f32 / 2.0;
        self.action_sockets
            .iter()
            .map(|socket| {
                let (offset_x, offset_y) = turn.rotate_offset(socket.x, socket.y);
                CompiledPlacementSocket {
                    x: centre_x + offset_x,
                    y: centre_y + offset_y,
                    facing: socket.facing.turned_with(turn),
                }
            })
            .collect()
    }
}

/// One object, placed on the lot.
///
/// The object is an `ObjectDefId` rather than the authored string, for
/// the same reason a need is an index: once a pack exists, a placement
/// referring to an object that is not in it has no representation. That
/// is [D9] applied to the lot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledPlacement {
    pub object: ObjectDefId,
    pub x: f32,
    pub y: f32,
    /// The atlas sprite THIS placement is drawn with - the object
    /// definition's sprite unless the placement authored a `facing`,
    /// in which case the directional variant was resolved at compile
    /// time and a variant nobody imported has no representation ([D9]).
    ///
    /// Appended last per the pack's growth rule; note this grows every
    /// PLACEMENT block rather than the pack's tail, so the golden
    /// vector was regenerated rather than extended.
    pub sprite: u32,
    /// Absolute presentation sockets in the owning definition's order.
    /// Appended for postcard stability.
    pub action_sockets: Vec<CompiledPlacementSocket>,
    /// Facing-resolved foreground atlas layer for this placement.
    pub foreground_sprite: Option<u32>,
    /// The authored facing itself, the definition's base when the placement
    /// declares none. `sprite`, `action_sockets` and `foreground_sprite` above are
    /// what this facing resolves to; the simulation keeps the facing so a
    /// player can turn the object afterwards. **Last in this struct on
    /// purpose**, per the appending rule.
    pub facing: Facing,
}

/// The lot: its size, its interior wall tiles, and what stands on it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledLot {
    pub width: u32,
    pub height: u32,
    /// Impassable tiles, in the order `lot.toml` declares them.
    ///
    /// Declaration order is preserved rather than sorted, deliberately.
    /// `CompiledInteraction::advertises` is sorted because its source is
    /// keyed by need NAME while the pack is keyed by need INDEX, so two
    /// orders exist and the pack has to pick one. A wall list has only
    /// ever had one order, the authored one, so sorting would be a
    /// mechanism with nothing to disambiguate - and every mechanism needs
    /// a test that can see it.
    ///
    /// Every entry is in bounds by construction; `compile` rejects a lot
    /// where one is not.
    pub walls: Vec<(u32, u32)>,
    pub placements: Vec<CompiledPlacement>,
    /// The tile a career's commute ends at - where the worker vanishes
    /// and reappears ([E4]). Post-validation: in bounds, walkable and
    /// reachable, and present whenever any household member holds a
    /// career, so the career system may unwrap it for a working sim
    /// rather than re-check. **Appended last** per the pack's growth
    /// rule.
    pub front_door: Option<(u32, u32)>,
}

/// Structural routing and presentation data for one validated lot-boundary portal.
///
/// A portal remains ordinary walkable floor. It is not a smart object and has
/// no Save V1 identity. The current lot has one front door, while the pack
/// stores a list so later lot transitions can reuse this presentation shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledPortal {
    pub position: (u32, u32),
    /// Walkable approach and return landing.
    ///
    /// This may sit beside the door along the boundary. It is not the door's
    /// outward normal; renderers derive that exclusively from `facing`.
    pub inward: (u32, u32),
    pub facing: CompiledSocketFacing,
    pub hinge: CompiledPortalHinge,
    pub frame_sprite: u32,
    pub closed_sprite: u32,
    pub ajar_sprite: u32,
    pub open_sprite: u32,
}

/// Which jamb carries the leaf, relative to the portal's outward facing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CompiledPortalHinge {
    Left,
    Right,
}

impl CompiledLot {
    /// Whether `(x, y)` is one of this lot's wall tiles.
    ///
    /// Linear, because a hand-authored lot has tens of walls rather than
    /// thousands, and because the caller that matters - lot spawning -
    /// walks the list once at startup rather than querying it per tick.
    pub fn is_wall(&self, x: u32, y: u32) -> bool {
        self.walls.contains(&(x, y))
    }
}

/// The validated system knobs, compiled from `content/tuning.toml`.
///
/// Every value here has been through `compile`, so a reader may assume
/// the ranges rather than re-check them: `choice_temperature` is finite
/// and strictly positive, `duration_variance` is in `[0, 1)`,
/// `min_interaction_ticks` is at least 1, and `idle_threshold` does not
/// exceed `action_threshold`. That is [D9] applied to tuning: a knob
/// that would divide by zero or make a sim wander while something is
/// worth doing has no representation once a pack exists.
///
/// `Copy` because it is a handful of scalars and every system that reads
/// a knob reads it through a `&ContentPack` it does not own.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Tuning {
    /// Below this score, an option is not worth doing at all.
    pub action_threshold: f32,
    /// Softmax temperature for weighted selection. Strictly positive.
    pub choice_temperature: f32,
    /// Below this, nothing is urgent enough to act on and the sim
    /// wanders instead of standing still.
    pub idle_threshold: f32,
    /// Ticks a sim pauses between wanders.
    pub wander_pause_ticks: u32,
    /// How many random tiles a wandering sim tries before giving up for
    /// the tick. At least 1.
    ///
    /// This is what makes the re-roll bounded. A destination is drawn at
    /// random and pathed to, so a tile behind a wall simply has no path
    /// and the roll fails; without a bound, a sim sealed in with nowhere
    /// to walk would spin rather than fail, and a hang is a much weaker
    /// signal than an assertion ([L15]).
    pub wander_attempts: u32,
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
    /// Fraction either side of an interaction's content duration within
    /// which the real duration is sampled. In `[0, 1)`.
    pub duration_variance: f32,
    /// Hard floor on any interaction, in ticks. At least 1.
    pub min_interaction_ticks: u32,
    /// Seed for a new simulation's PRNG. Save V1 persists the complete
    /// live PRNG state, which makes continuation after Load replayable.
    pub rng_seed: u64,
    /// The most player-issued intents one sim may hold at once. At least
    /// 1.
    ///
    /// This is the only thing rate-limiting a click. `drain_commands`
    /// pushes one intent per `UseObject` command and nothing trims the
    /// queue, so without it a JavaScript loop grows one agent's queue
    /// without bound and every entry is a stretch of time that sim is
    /// not choosing for itself. `content/tuning.toml` carries the time
    /// budget the number is derived from and why the overflow drops the
    /// newest intent rather than the oldest.
    ///
    /// The pack's byte encoding grows by appending, so a knob added
    /// here keeps every earlier block's offset and the golden vector in
    /// `compile.rs` stays reviewable against the annotations it already
    /// has. `max_queued_intents` was last until `max_queued_commands`
    /// arrived; that one is last now.
    pub max_queued_intents: u32,
    /// The most commands the WASM boundary will hold between two drains.
    /// At least 1.
    ///
    /// `max_queued_intents` bounds what one sim can be told to do;
    /// this bounds the QUEUE, and the two are different failures.
    /// `SimHandle::enqueue_command` refuses a command that would take
    /// the queue past this, so a JavaScript loop - or a mouse held down
    /// over a sim that no longer exists - cannot grow the staging queue
    /// without limit. Nothing downstream could: an intent cap only ever
    /// sees commands that resolved to a live agent, and `Select`,
    /// `SetSpeed` and every rejected index reach the queue without
    /// touching it.
    pub max_queued_commands: u32,
    /// How often the shell re-reads a selected sim's needs for the need
    /// bars, in real milliseconds. Zero means every frame.
    ///
    /// The only knob here that no simulation system reads. It crosses the
    /// boundary as [`crate::pack`] data anyway, because a value somebody
    /// tuning the game will want to turn belongs in `content/tuning.toml`
    /// rather than in a TypeScript `const`, and that rule does not have
    /// an exception for the shell. `content/tuning.toml` carries why 100
    /// is matched to the tick rate rather than to the display.
    ///
    /// It was last in this struct until the relationship trio arrived;
    /// they are last now, for the appending reason above: the pack's
    /// byte encoding grows by appending, so every earlier block keeps
    /// its offset and the golden vector in `compile.rs` stays
    /// reviewable against the annotations it has.
    pub need_bar_refresh_ms: u32,
    /// How much of its score an object somebody else is using keeps,
    /// in `[0, 1]`.
    ///
    /// Selection scores a contested object so that "nothing is worth
    /// doing" stays a TRUE statement about an agent that has just been
    /// beaten to something - that is [C3] and it is already fixed. This
    /// decides what the agent does about it, and nothing else: a
    /// contested object is never a candidate at any value, so this is a
    /// knob on WAITING alone. A sim waits when the attenuated score
    /// clears `idle_threshold` and strolls off when it does not.
    ///
    /// It ordered itself last until the relationship trio merged in
    /// beside it; the two blocks grew on parallel branches, both
    /// appending after `need_bar_refresh_ms`, and this order - waiting
    /// knob, then the trio - is the merge's, with the golden vector
    /// regenerated to match rather than derived by hand.
    pub contested_score_multiplier: f32,
    /// How much one completed social interaction raises EACH
    /// participant's relationship toward the other, in `0.0..=1.0`.
    /// Zero disables the mechanic - the same contract as
    /// `habituation_per_use`.
    pub relationship_gain_per_talk: f32,
    /// How much every relationship drifts toward zero each tick.
    /// Strictly positive, or a relationship would be a one-way ratchet -
    /// the rule `habituation_decay_per_tick` carries, for the same
    /// reason.
    pub relationship_decay_per_tick: f32,
    /// How strongly a relationship scales a social advert's benefit:
    /// the multiplier is `1 + relationship * scale`. With relationships
    /// clamped to `-1..=1`, a scale in `0.0..=1.0` keeps the multiplier
    /// in `[1 - scale, 1 + scale]` and therefore never negative, which
    /// is what stops a hated sim's talk turning from "worthless" into
    /// "actively repellent benefit-turned-cost" behind nobody's
    /// decision. Zero disables the effect. It ordered itself last until
    /// the M2e satisfaction trio arrived; they are last now, per the
    /// appending rule.
    pub relationship_delta_scale: f32,
    /// What completing a loved activity's satisfaction is multiplied by
    /// ([E2]). At least 1 and finite: below 1 a hobby would pay LESS for
    /// being loved, which inverts the mechanic behind a tuning typo.
    /// Exactly 1 disables hobbies without touching content.
    pub hobby_multiplier: f32,
    /// The need level below which a need counts as neglected, in
    /// `[0, 100]` ([E1] writer 2). Zero disables neglect entirely - no
    /// level is below zero for long enough to matter.
    pub neglect_floor: f32,
    /// What every need's decay rate is multiplied by while a sim is
    /// `AtWork` - [X2] in the alpha acceptance findings. In `[0, 1]`
    /// and finite. Above 1 the office would drain a sim FASTER than
    /// living does, which is a different game; exactly 1 is the legal
    /// way back to the unmitigated void the career shipped with.
    pub at_work_decay_scale: f32,
    /// Satisfaction lost PER NEGLECTED NEED per tick while it stays
    /// below the floor. Non-negative and finite; each need below the
    /// floor bleeds separately, because three crises are worse than
    /// one and a flat rate would say otherwise. It ordered itself last
    /// until the day arrived.
    pub neglect_bleed_per_tick: f32,
    /// Ticks in one simulated day - `tick % day_ticks` is the clock
    /// careers schedule against ([E4]). It held last place until the
    /// sleep scale arrived.
    pub day_ticks: u32,
    /// What every need's decay rate is multiplied by while a sim is
    /// asleep. In `[0, 1]` and finite, validated exactly like
    /// `at_work_decay_scale` above and for the same reasons: above 1 a
    /// bed would drain a sim faster than being awake does, and exactly
    /// 1 is the legal way back to the behaviour before this existed.
    ///
    /// This was last in the struct until `wander_radius_tiles` arrived;
    /// that field is last now, per the appending rule.
    pub asleep_decay_scale: f32,
    /// The maximum Manhattan distance and walked path length of an idle
    /// wander, in tiles. In `1..=i32::MAX`; zero would make every candidate
    /// fail, while the upper bound keeps the square's `2 * radius + 1`
    /// sampling diameter representable on 32-bit WebAssembly and in the
    /// simulation RNG's `u32` range.
    ///
    /// **Last in this struct on purpose**, per the appending rule. This was
    /// added after `asleep_decay_scale`, which remains in place so existing
    /// tuning bytes retain their offsets.
    pub wander_radius_tiles: u32,
}

/// The circadian rhythm - [ML-curve] and [ML-chrono].
///
/// A SIBLING of `Tuning` rather than a field of it, and that is forced
/// rather than chosen: `Tuning` is `Copy` because it is a handful of
/// scalars every system reads through a borrowed pack, and this owns a
/// `String` and a `Vec`. Taking `Copy` away from `Tuning` to fit one
/// optional table here would land on every reader of every knob.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Circadian {
    /// `(tick, multiplier)` control points, sorted, wrapping at the end
    /// of the day. Validated non-empty by the compile step, so the
    /// simulation never has to answer "what if there are no points".
    pub sleep_drive: Vec<(u32, f32)>,
    /// Energy at or below which exhaustion accumulates. In `[0, 100]`.
    pub exhaustion_energy: f32,
    /// Ticks at rock bottom to reach the full bonus. At least 1.
    pub exhaustion_ramp_ticks: u32,
    /// The multiplier a fully exhausted sim's sleep drive reaches. At
    /// least 1, where exactly 1 is the ramp disabled.
    pub exhaustion_bonus: f32,
}

/// One personality archetype, compiled - [H3].
///
/// Dense arrays where the authored TOML was sparse: the compile step
/// fills absences with 1.0, so every read site is an index rather than a
/// lookup-with-default each caller could write differently. Multipliers
/// are validated - finite, drains non-negative, satisfactions strictly
/// positive - so a reader may assume the ranges rather than re-check.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledPersonality {
    pub id: String,
    pub drain: [f32; NEED_COUNT],
    pub satisfaction: [f32; NEED_COUNT],
    /// (object, interaction index, weight), sorted by key because it is
    /// copied verbatim into a component whose iteration order must be
    /// deterministic - `Personality::disposition` binary-searches it, and
    /// it is what `world_hash` would iterate if personality ever enters
    /// the digest (it does not today; `Sim::world_hash` carries the
    /// exclusion note). The names are resolved: a disposition toward an
    /// interaction that does not exist has no representation once a pack
    /// exists.
    pub dispositions: Vec<(ObjectDefId, u32, f32)>,
    /// Where on the circadian curve this archetype samples, in ticks -
    /// [ML-chrono]. 0 is "sleeps when everyone else does", which is the
    /// default and is what every archetype had before this existed.
    pub chronotype_offset_ticks: i32,
}

/// One trait, compiled - [E3]. The kind-specific numbers live in an
/// enum so a disposition carrying a severity has no representation,
/// which is [D9] applied to the three-mechanisms split itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CompiledTraitKind {
    /// Weighs tagged candidates in scoring. Stateless.
    Disposition { score_multiplier: f32 },
    /// Gates tagged completions as may-attempt-may-fail, with a level
    /// that learning raises toward 1.
    Capability {
        start_level: f32,
        fail_delta_scale: f32,
        learn_per_attempt: f32,
    },
    /// Scales satisfaction accrual, with a severity that management
    /// lowers toward 0.
    Condition {
        accrual_scale: f32,
        manage_per_completion: f32,
        start_severity: f32,
    },
}

/// See [`CompiledTraitKind`]. `tag` stays a string because the runtime
/// compares it against `CompiledInteraction::tags`, which are strings;
/// an interned index would need a tag table nothing else wants.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledTrait {
    pub id: String,
    pub label: String,
    pub tag: String,
    pub kind: CompiledTraitKind,
}

/// One member of the authored household - [H2].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledHouseholdMember {
    pub name: String,
    /// Index into [`ContentPack::personalities`]. An index rather than
    /// the authored string for the standing reason: once a pack exists, a
    /// sim with a personality nobody declared has no representation.
    pub personality: u32,
    pub x: f32,
    pub y: f32,
    /// Starting need levels, dense by need index, absences filled with
    /// `NEED_MAX`. Validated into `[0, 100]`.
    pub needs: [f32; NEED_COUNT],
    /// The activity tags this sim loves ([E2]). Every entry names a tag
    /// some interaction in the pack carries - a hobby with nothing to do
    /// has no representation once a pack exists ([D9]). It was last in
    /// this struct until `traits` arrived.
    pub hobbies: Vec<String>,
    /// Indices into [`ContentPack::traits`] - an index rather than the
    /// authored id for the standing reason. It was last until the
    /// career arrived.
    pub traits: Vec<u32>,
    /// Index into [`ContentPack::careers`], or `None` for the
    /// unemployed. **Last in this struct on purpose**, per the
    /// appending rule on [`ContentPack::lot`].
    pub career: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContentPack {
    pub decay_per_tick: [f32; NEED_COUNT],
    pub objects: Vec<CompiledObject>,
    /// The atlas index of the sprite every sim is drawn with.
    ///
    /// A sim is not authored content - nothing in `content/` declares
    /// one - so unlike an object's sprite this resolves a name fixed in
    /// `compile.rs` rather than one a designer typed. It lives in the
    /// pack anyway so that the render buffer can fill a sprite index for
    /// every row without the simulation or the shell knowing what a sim
    /// looks like.
    pub sim_sprite: u32,
    /// The pack's byte encoding grows by APPENDING: a new field goes
    /// after the existing ones, so every earlier block keeps its offset.
    /// The golden vector in `compile.rs` annotates those blocks, and
    /// keeping them where they are is what makes it reviewable. `lot`
    /// was last until tuning arrived, `tuning` until the household did;
    /// `household` is last now.
    pub lot: CompiledLot,
    pub tuning: Tuning,
    pub personalities: Vec<CompiledPersonality>,
    /// Spawned in declaration order by `Sim::spawn_household` - which
    /// `Sim::new_from_shipped_lot` calls after placing the furniture - and
    /// the order is what fixes each member's `SimId`: the first sim in the
    /// file is SimId 0 for as long as nobody is born or dies before load
    /// finishes. It was last in this struct until `social` arrived.
    pub household: Vec<CompiledHouseholdMember>,
    /// The interactions every sim advertises to other sims - [H4]/[H6].
    ///
    /// The same compiled shape as an object's interactions, indexed the
    /// same way (`Target::interaction` is an index into this list when
    /// the target is a sim), because a talk IS an interaction with a
    /// person where the fridge would be. Selection scales its benefits
    /// by the initiator's relationship toward the target; nothing here
    /// is per-sim, and per-sim variation enters through personality and
    /// relationships rather than through the vocabulary.
    ///
    /// May be empty in a test pack; the shipped pack is required to
    /// carry at least one positively social entry by
    /// `the_shipped_pack_gives_sims_a_way_to_talk`. It was last in this
    /// struct until `traits` arrived.
    pub social: Vec<CompiledInteraction>,
    /// The trait definitions household members index into - [E3]. May
    /// be empty in a test pack, like `social`. It was last until the
    /// career arrived.
    pub traits: Vec<CompiledTrait>,
    /// The careers household members index into - [E4], the [D15]
    /// Tier 2 rabbit hole. May be empty in a test pack. It was last
    /// until the chain trio below arrived.
    pub careers: Vec<CompiledCareer>,
    /// The station-role vocabulary, in first-appearance order across
    /// `objects.toml` - what `CompiledObject::roles` and
    /// `CompiledChainStep::role` index into ([K1]).
    pub roles: Vec<String>,
    /// The carried-item kinds, in first-appearance order across
    /// `chains.toml` - what a sim's `Carrying` component indexes into
    /// ([K3]).
    pub item_kinds: Vec<String>,
    /// The multi-step chains - [K1]. May be empty in a test pack. It was
    /// last until the circadian rhythm arrived.
    pub chains: Vec<CompiledChain>,
    /// The circadian rhythm, if `tuning.toml` authored one - [ML-curve].
    ///
    /// `None` means a flat sleep drive of 1.0, which is exactly the
    /// behaviour every pack had before this existed. That is what lets
    /// the feature land without every test fixture growing a table it
    /// does not care about.
    ///
    /// Appended at its introduction, per the pack's compatibility rule.
    /// Later fields follow it rather than being inserted ahead of it.
    pub circadian: Option<Circadian>,
    /// The activity tag that means sleeping, from `[tuning]`.
    ///
    /// A sibling of `Tuning` for the same forced reason `Circadian` is:
    /// `Tuning` is `Copy` and this owns a `String`.
    ///
    /// NOT under `circadian`, which is where it started. The rhythm is
    /// optional and ships off; the tag is read by three things that are
    /// not, so hanging it off an absent table made two of them dead in
    /// the shipped game.
    pub sleep_tag: String,
    /// The nonverbal voice clips a conversation is built out of.
    ///
    /// Fewer than two means the pack has no voice and a conversation takes
    /// an ordinary sampled duration, which is what every test fixture does.
    /// With two or more, the simulation draws a pair and the conversation
    /// lasts exactly as long as those two clips together.
    ///
    /// It was the pack tail until portal presentation arrived. New fields
    /// continue to append after it rather than moving this block.
    pub voice_clips: Vec<CompiledVoiceClip>,
    /// Validated lot-boundary portal rows.
    ///
    /// Appended at the complete pack tail so every established block retains
    /// its byte offset. The existing `lot.front_door` remains the career-route
    /// identity. Portal coordinates affect routing and the save-content
    /// fingerprint; facing, hinge and sprites remain presentation metadata.
    pub portals: Vec<CompiledPortal>,
}

/// One recorded clip, compiled.
///
/// `duration_ticks` is read out of the WAV file by the build script rather
/// than authored, so it cannot disagree with the audio the shell will play.
/// The shell resolves `id` to `audio/voice/<id>.wav` under the served root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompiledVoiceClip {
    pub id: String,
    pub duration_ticks: u32,
}

/// One chain, compiled: steps across station roles, the whole payoff
/// terminal ([M-1]). Every role and item kind is an index, so a step
/// at a station nobody built has no representation ([D9]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledChain {
    pub id: String,
    pub label: String,
    /// The object definition whose flyout and adverts carry this
    /// chain.
    pub advertised_by: ObjectDefId,
    /// (`NeedId` index, delta), sorted by index - the terminal payoff,
    /// the same shape as an interaction's `advertises`.
    pub advertises: Vec<(u8, f32)>,
    /// Paid at the terminal completion, before the hobby multiplier.
    pub satisfaction: f32,
    /// At least one; the last is terminal.
    pub steps: Vec<CompiledChainStep>,
}

/// One step: where (a role index), what it is called, how long, what
/// it does to the sim's hands.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledChainStep {
    /// Index into [`ContentPack::roles`].
    pub role: u32,
    pub label: String,
    pub duration_ticks: u32,
    /// The activity tags this step carries - hobbies and traits key
    /// on these, per step rather than per chain.
    pub tags: Vec<String>,
    /// Item kind this step puts in the sim's hands, as an index into
    /// [`ContentPack::item_kinds`].
    pub yields: Option<u32>,
    /// (from, to) item-kind indices.
    pub transforms: Option<(u32, u32)>,
    /// Item kind this step consumes.
    pub consumes: Option<u32>,
    /// Optional authored body-presentation contract. Presentation-only and
    /// deliberately outside Save V1's compatibility digest.
    /// It was last until the station-audio field below arrived.
    pub visual: Option<CompiledVisual>,
    /// Optional authored station-audio category. Presentation-only and outside
    /// Save V1's compatibility digest.
    /// **Last in this struct on purpose**, per the appending rule.
    pub sound_action: Option<CompiledSoundAction>,
}

/// One career, compiled and validated: the shift fits inside the day,
/// the energy cost fits a need bar, and the satisfaction is
/// non-negative - a job that actively drains a LIFE is a condition's
/// business, not a paycheck's, which keeps [S1]'s writer list honest.
/// (The working design's [E4] floated a negative here; v1 rejects it
/// and the spec carries the amendment - the antagonist quality of a
/// job is the TIME it eats, which is [S1]'s own framing.)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledCareer {
    pub id: String,
    pub label: String,
    pub shift_start: u32,
    pub shift_ticks: u32,
    pub pay: u32,
    pub energy_cost: f32,
    pub satisfaction: f32,
}

impl ContentPack {
    /// Panics on an id from a different pack. `ObjectDefId` is an index
    /// into *this* pack's `objects`, which is why nothing persists one;
    /// save files store the string id and call [`ContentPack::find`].
    pub fn object(&self, id: ObjectDefId) -> &CompiledObject {
        &self.objects[id.0 as usize]
    }

    pub fn find(&self, id: &str) -> Option<ObjectDefId> {
        self.objects
            .iter()
            .position(|o| o.id == id)
            .map(|i| ObjectDefId(i as u32))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn interaction(id: &str) -> CompiledInteraction {
        CompiledInteraction {
            id: id.to_string(),
            advertises: vec![(0, 35.0), (6, 5.0)],
            duration_ticks: 15,
            slots: 1,
            // Deliberately not the id and not a substring of it, so the
            // postcard round-trip below can see a label dropped from the
            // encoding or read off the `id` slot ([L34]).
            label: "Use it, then".to_string(),
            // Two tags, neither the id nor the label, and a satisfaction
            // distinct from every advert delta - same [L34] discipline.
            tags: vec!["tinkering".to_string(), "puttering".to_string()],
            satisfaction: 2.25,
            visual: None,
            sound_action: Some(CompiledSoundAction::ShowerWater),
        }
    }

    /// Non-square, with two walls declared out of sorted order and two
    /// placements whose object indices differ from their own positions
    /// in the list. Every one of those asymmetries exists so that a
    /// transposition, a reordering, or an index collapsed to zero is
    /// visible rather than hidden by a tidy fixture.
    fn a_lot() -> CompiledLot {
        CompiledLot {
            width: 6,
            height: 4,
            // Present rather than None, with coordinates distinct from
            // every wall and placement, so a round trip that dropped
            // the option - or wrote a wall into its slot - moves the
            // equality below ([L34]).
            front_door: Some((5, 3)),
            walls: vec![(3, 2), (1, 0)],
            placements: vec![
                // Sprites distinct from each other AND from the ids, so
                // a round trip writing the sprite into the object slot
                // or duplicating one across placements moves an assert.
                CompiledPlacement {
                    object: ObjectDefId(2),
                    x: 2.5,
                    y: 1.25,
                    sprite: 9,
                    action_sockets: vec![],
                    foreground_sprite: None,
                    facing: Facing::NorthWest,
                },
                CompiledPlacement {
                    object: ObjectDefId(0),
                    x: 4.0,
                    y: 3.5,
                    sprite: 6,
                    action_sockets: vec![
                        CompiledPlacementSocket {
                            x: 4.25,
                            y: 3.75,
                            facing: CompiledSocketFacing::PositiveX,
                        },
                        CompiledPlacementSocket {
                            x: 4.75,
                            y: 3.25,
                            facing: CompiledSocketFacing::NegativeY,
                        },
                    ],
                    foreground_sprite: Some(12),
                    // A different facing per placement, neither of them the
                    // default, so a round trip that dropped the field or
                    // stamped one placement's facing on both moves the
                    // equality ([L34]).
                    facing: Facing::SouthWest,
                },
            ],
        }
    }

    /// Scalar knobs, no two of which share a value, so a field that
    /// round-trips into the wrong slot is visible rather than hidden by
    /// a fixture where two of them agree.
    fn a_tuning() -> Tuning {
        Tuning {
            action_threshold: 0.25,
            choice_temperature: 0.5,
            idle_threshold: 0.125,
            wander_pause_ticks: 9,
            wander_attempts: 6,
            duration_variance: 0.75,
            habituation_per_use: 0.3125,
            habituation_decay_per_tick: 0.0025,
            habituation_floor: 0.625,
            min_interaction_ticks: 3,
            contested_score_multiplier: 0.375,
            rng_seed: 300,
            max_queued_intents: 7,
            max_queued_commands: 11,
            need_bar_refresh_ms: 13,
            relationship_gain_per_talk: 0.15,
            relationship_decay_per_tick: 0.00001,
            relationship_delta_scale: 0.5,
            hobby_multiplier: 3.5,
            neglect_floor: 17.0,
            at_work_decay_scale: 0.5,
            asleep_decay_scale: 0.5,
            neglect_bleed_per_tick: 0.0075,
            day_ticks: 23,
            wander_radius_tiles: 29,
        }
    }

    fn three_objects() -> ContentPack {
        ContentPack {
            circadian: None,
            sleep_tag: String::new(),
            decay_per_tick: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
            objects: ["fridge", "bed", "sink"]
                .iter()
                .enumerate()
                // Sprite indices that are not the object's own position,
                // so a field dropped from the encoding or read off the
                // wrong slot moves the round-trip assertion below.
                .map(|(i, id)| {
                    let mut use_it = interaction("use_it");
                    if i == 0 {
                        use_it.visual = Some(CompiledVisual {
                            action: CompiledVisualAction::Read,
                            anchor: CompiledVisualAnchor::ObjectSocket,
                            facing: CompiledVisualFacing::Socket,
                            socket: Some(1),
                        });
                    } else if i == 1 {
                        use_it.visual = Some(CompiledVisual {
                            action: CompiledVisualAction::Read,
                            anchor: CompiledVisualAnchor::Object,
                            facing: CompiledVisualFacing::TowardAnchor,
                            socket: None,
                        });
                    }
                    CompiledObject {
                        id: (*id).to_string(),
                        name: id.to_uppercase(),
                        sprite: (i as u32) + 4,
                        interactions: vec![use_it],
                        // A different rectangle per object, none of them square
                        // and none of them 1x1 twice, so the postcard round-trip
                        // below can see a footprint dropped from the encoding, a
                        // width and depth transposed, or every object handed the
                        // first one's rectangle. This pack is never validated
                        // against a lot, so the tiles need not fit anywhere.
                        footprint: Footprint {
                            width: (i as u32) + 1,
                            depth: (i as u32) + 3,
                        },
                        // A different role list per object - empty, one,
                        // two - so the round trip can see the lists
                        // transposed, dropped, or stamped from one object
                        // onto all ([L34]).
                        roles: (0..i as u32).collect(),
                        action_sockets: if i == 0 {
                            vec![
                                CompiledActionSocket {
                                    id: "back".to_string(),
                                    x: -0.25,
                                    y: 0.25,
                                    facing: CompiledSocketFacing::PositiveX,
                                },
                                CompiledActionSocket {
                                    id: "seat".to_string(),
                                    x: 0.25,
                                    y: -0.25,
                                    facing: CompiledSocketFacing::NegativeY,
                                },
                            ]
                        } else {
                            vec![]
                        },
                        foreground_sprite: (i == 1).then_some(11),
                        base_facing: Facing::SouthEast,
                        // A different table per object, with a hole in a
                        // different place each time, so the round trip can
                        // see the two tables transposed, one dropped, or an
                        // entry moved to another facing's slot ([L34]).
                        facing_sprites: FacingSprites([
                            Some((i as u32) + 4),
                            (i != 0).then_some((i as u32) + 40),
                            (i != 1).then_some((i as u32) + 50),
                            Some((i as u32) + 60),
                        ]),
                        facing_foreground_sprites: if i == 1 {
                            FacingSprites([Some(11), None, Some(71), None])
                        } else {
                            FacingSprites::NONE
                        },
                    }
                })
                .collect(),
            sim_sprite: 1,
            lot: a_lot(),
            tuning: a_tuning(),
            personalities: vec![CompiledPersonality {
                id: "the_settled".to_string(),
                // Pairwise distinct across BOTH arrays, so a round trip
                // that wrote satisfaction into drain's slot - or dropped
                // one array and duplicated the other - moves the equality
                // below ([L34]).
                drain: [1.5, 0.75, 1.0, 1.125, 0.875, 1.25, 0.9375],
                satisfaction: [0.5, 1.75, 2.0, 0.625, 1.375, 0.8125, 1.0625],
                dispositions: vec![(ObjectDefId(1), 0, 1.875), (ObjectDefId(2), 1, 0.25)],
                chronotype_offset_ticks: 0,
            }],
            household: vec![CompiledHouseholdMember {
                name: "Terri".to_string(),
                personality: 0,
                x: 4.5,
                y: 3.25,
                needs: [62.5, 100.0, 87.5, 93.75, 100.0, 81.25, 96.875],
                traits: vec![2],
                // A tag the object interaction does NOT carry, so a round
                // trip that wrote hobbies into an interaction's tag slot
                // (or vice versa) moves the equality below.
                hobbies: vec!["gossip".to_string()],
                // Index 1, NOT the careers list's first entry, so a round
                // trip that collapsed the option to Some(0) - or to None -
                // moves the equality ([L34]).
                career: Some(1),
            }],
            // A different id, duration and slot count from the object
            // interaction above, so the round trip can see the social
            // list written into the objects' slot or vice versa.
            social: vec![CompiledInteraction {
                id: "chat".to_string(),
                advertises: vec![(4, 30.0), (5, 6.0)],
                duration_ticks: 40,
                slots: 2,
                label: "Compare complaints".to_string(),
                tags: vec!["gossip".to_string()],
                satisfaction: 4.5,
                // Present rather than None, so postcard round trips the social
                // visual contract instead of exercising only the option tag.
                visual: Some(CompiledVisual {
                    action: CompiledVisualAction::Talk,
                    anchor: CompiledVisualAnchor::Partner,
                    facing: CompiledVisualFacing::TowardAnchor,
                    socket: None,
                }),
                sound_action: None,
            }],
            // Three traits, one of each kind with pairwise-distinct
            // numbers, so a round trip that transposed two kinds' fields
            // or collapsed the enum to one variant moves the equality
            // ([L34]). The member above wears index 2, which is NOT the
            // list's first entry, pinning that indices ride rather than
            // being re-derived.
            traits: vec![
                CompiledTrait {
                    id: "gossip_hound".to_string(),
                    label: "Gossip hound".to_string(),
                    tag: "gossip".to_string(),
                    kind: CompiledTraitKind::Disposition {
                        score_multiplier: 1.375,
                    },
                },
                CompiledTrait {
                    id: "all_thumbs".to_string(),
                    label: "All thumbs".to_string(),
                    tag: "tinkering".to_string(),
                    kind: CompiledTraitKind::Capability {
                        start_level: 0.1875,
                        fail_delta_scale: 0.0625,
                        learn_per_attempt: 0.03125,
                    },
                },
                CompiledTrait {
                    id: "weary".to_string(),
                    label: "Weary".to_string(),
                    tag: "puttering".to_string(),
                    kind: CompiledTraitKind::Condition {
                        accrual_scale: 0.5625,
                        manage_per_completion: 0.015625,
                        start_severity: 0.6875,
                    },
                },
            ],
            // Two careers so the member's Some(1) above means "the
            // second", with pairwise-distinct values across both entries
            // so a round trip that transposed two fields, or stamped one
            // career on both slots, moves the equality ([L34]).
            careers: vec![
                CompiledCareer {
                    id: "night_watch".to_string(),
                    label: "Night watch".to_string(),
                    shift_start: 3,
                    shift_ticks: 9,
                    pay: 85,
                    energy_cost: 21.5,
                    satisfaction: 1.125,
                },
                CompiledCareer {
                    id: "clerk".to_string(),
                    label: "Clerk".to_string(),
                    shift_start: 6,
                    shift_ticks: 11,
                    pay: 140,
                    energy_cost: 17.25,
                    satisfaction: 0.375,
                },
            ],
            // Two vocabulary entries each, out of alphabetical order,
            // so a round trip that sorted (or dropped) either list is
            // visible.
            roles: vec!["hob".to_string(), "cold_storage".to_string()],
            item_kinds: vec!["dinner".to_string(), "ingredients".to_string()],
            // One chain with every field populated and pairwise
            // distinct: steps at DIFFERENT roles, a yield, a transform
            // (whose halves differ) and a consume, so the encoding
            // cannot transpose or collapse any of them silently
            // ([L34]).
            chains: vec![CompiledChain {
                id: "cook_dinner".to_string(),
                label: "Cook dinner".to_string(),
                advertised_by: ObjectDefId(2),
                advertises: vec![(0, 55.0), (6, 10.5)],
                satisfaction: 3.25,
                steps: vec![
                    CompiledChainStep {
                        role: 1,
                        label: "Get ingredients".to_string(),
                        duration_ticks: 21,
                        tags: vec![],
                        yields: Some(1),
                        transforms: None,
                        consumes: None,
                        visual: None,
                        sound_action: None,
                    },
                    CompiledChainStep {
                        role: 0,
                        label: "Cook".to_string(),
                        duration_ticks: 63,
                        tags: vec!["cooking".to_string()],
                        yields: None,
                        transforms: Some((1, 0)),
                        consumes: None,
                        visual: None,
                        sound_action: Some(CompiledSoundAction::StoveCooking),
                    },
                    CompiledChainStep {
                        role: 1,
                        label: "Eat".to_string(),
                        duration_ticks: 42,
                        tags: vec![],
                        yields: None,
                        transforms: None,
                        consumes: Some(0),
                        visual: Some(CompiledVisual {
                            action: CompiledVisualAction::Eat,
                            anchor: CompiledVisualAnchor::Station,
                            facing: CompiledVisualFacing::TowardAnchor,
                            socket: None,
                        }),
                        sound_action: None,
                    },
                ],
            }],
            // Two clips, with lengths that are neither equal to each other
            // nor to any index, so a duration read off the wrong slot moves
            // the round-trip assertion rather than landing on a value that
            // happens to match.
            voice_clips: vec![
                CompiledVoiceClip {
                    id: "chatter-a".to_string(),
                    duration_ticks: 19,
                },
                CompiledVoiceClip {
                    id: "chatter-b".to_string(),
                    duration_ticks: 27,
                },
            ],
            portals: vec![],
        }
    }

    /// Both halves of the lookup are index arithmetic, and a single
    /// object cannot tell a correct index from a hardcoded zero. Three
    /// objects make `find` returning `Some(ObjectDefId(0))` and `object`
    /// returning `&self.objects[0]` both observable.
    #[test]
    fn find_and_object_round_trip_for_every_declared_object() {
        let pack = three_objects();
        assert_eq!(pack.objects.len(), 3, "the lookup needs something to find");

        for (i, declared) in ["fridge", "bed", "sink"].iter().enumerate() {
            let found = pack.find(declared).expect("declared object must be found");
            assert_eq!(
                found,
                ObjectDefId(i as u32),
                "'{declared}' is at declaration index {i}"
            );
            assert_eq!(
                pack.object(found).id,
                *declared,
                "object() returned a different object than find() named"
            );
        }

        assert_eq!(pack.find("nope"), None);
    }

    /// `is_wall` is a membership test over a list of PAIRS, and the two
    /// ways to get it wrong are to compare only one coordinate and to
    /// compare them transposed. The fixture's walls are `(3, 2)` and
    /// `(1, 0)`, so `(2, 3)` and `(0, 1)` are the transposes and neither
    /// is a wall; `(3, 0)` and `(1, 2)` are the cross products, which
    /// catch a single-coordinate comparison.
    #[test]
    fn is_wall_matches_both_coordinates_of_a_declared_wall() {
        let lot = a_lot();
        assert!(!lot.walls.is_empty(), "an empty lot would match nothing");

        assert!(lot.is_wall(3, 2));
        assert!(lot.is_wall(1, 0));

        assert!(!lot.is_wall(2, 3), "(2, 3) is (3, 2) transposed");
        assert!(!lot.is_wall(0, 1), "(0, 1) is (1, 0) transposed");
        assert!(!lot.is_wall(3, 0), "x alone must not decide a wall");
        assert!(!lot.is_wall(1, 2), "y alone must not decide a wall");
    }

    /// A one-tile object with the given facing tables and no sockets.
    fn turnable(
        foreground_sprite: Option<u32>,
        facing_sprites: FacingSprites,
        facing_foreground_sprites: FacingSprites,
    ) -> CompiledObject {
        CompiledObject {
            id: "thing".to_string(),
            name: "Thing".to_string(),
            sprite: 4,
            interactions: vec![],
            footprint: Footprint::SINGLE,
            roles: vec![],
            action_sockets: vec![],
            foreground_sprite,
            facing_sprites,
            facing_foreground_sprites,
            base_facing: Facing::SouthEast,
        }
    }

    #[test]
    fn a_facing_table_reads_back_the_slot_for_each_facing() {
        let table = FacingSprites([Some(10), Some(11), None, Some(13)]);
        let read: Vec<Option<u32>> = Facing::ALL.into_iter().map(|f| table.get(f)).collect();
        assert_eq!(read, vec![Some(10), Some(11), None, Some(13)]);
        assert_eq!(
            FacingSprites::south_east_only(7),
            FacingSprites([Some(7), None, None, None])
        );
        assert_eq!(FacingSprites::NONE, FacingSprites([None; 4]));
    }

    /// Support needs the sprite, and ALSO the foreground layer when the
    /// object has one. Each object below isolates one half: the first has
    /// no foreground, so only its sprite table decides; the second has
    /// every sprite, so only its foreground table decides.
    #[test]
    fn a_facing_is_supported_only_with_its_sprite_and_its_foreground_layer() {
        let no_foreground = turnable(
            None,
            FacingSprites([Some(4), None, Some(6), None]),
            FacingSprites::NONE,
        );
        let supported: Vec<bool> = Facing::ALL
            .into_iter()
            .map(|f| no_foreground.supports(f))
            .collect();
        assert_eq!(supported, vec![true, false, true, false]);

        let layered = turnable(
            Some(20),
            FacingSprites([Some(4), Some(5), Some(6), Some(7)]),
            FacingSprites([Some(20), Some(21), None, None]),
        );
        let supported: Vec<bool> = Facing::ALL
            .into_iter()
            .map(|f| layered.supports(f))
            .collect();
        assert_eq!(
            supported,
            vec![true, true, false, false],
            "a facing whose foreground layer is missing is not supported, \
             even though the sprite exists"
        );
    }

    #[test]
    fn the_next_supported_facing_skips_facings_with_no_art_and_wraps() {
        // South-east and north-west only: each is the other's next.
        let two = turnable(
            None,
            FacingSprites([Some(4), None, Some(6), None]),
            FacingSprites::NONE,
        );
        assert_eq!(
            two.next_supported_facing(Facing::SouthEast),
            Some(Facing::NorthWest)
        );
        assert_eq!(
            two.next_supported_facing(Facing::NorthWest),
            Some(Facing::SouthEast),
            "the search wraps past north-east back to south-east"
        );

        // All four: the next is simply the next quarter turn.
        let four = turnable(
            None,
            FacingSprites([Some(4), Some(5), Some(6), Some(7)]),
            FacingSprites::NONE,
        );
        let sequence: Vec<Option<Facing>> = Facing::ALL
            .into_iter()
            .map(|f| four.next_supported_facing(f))
            .collect();
        assert_eq!(
            sequence,
            vec![
                Some(Facing::SouthWest),
                Some(Facing::NorthWest),
                Some(Facing::NorthEast),
                Some(Facing::SouthEast),
            ]
        );

        // Only the third step away is supported, which is the last step
        // the search takes before it would arrive back at `from`.
        let far = turnable(
            None,
            FacingSprites([Some(4), None, None, Some(7)]),
            FacingSprites::NONE,
        );
        assert_eq!(
            far.next_supported_facing(Facing::SouthEast),
            Some(Facing::NorthEast)
        );

        // One facing only: there is nowhere to turn to, and the answer is
        // None rather than the facing it already has.
        let fixed = turnable(None, FacingSprites::south_east_only(4), FacingSprites::NONE);
        assert_eq!(fixed.next_supported_facing(Facing::SouthEast), None);
    }

    #[test]
    fn a_socket_facing_turns_with_its_object_for_every_source_and_facing() {
        use CompiledSocketFacing::{NegativeX, NegativeY, PositiveX, PositiveY};

        for (source, expected) in [
            (PositiveX, [PositiveX, PositiveY, NegativeX, NegativeY]),
            (NegativeX, [NegativeX, NegativeY, PositiveX, PositiveY]),
            (PositiveY, [PositiveY, NegativeX, NegativeY, PositiveX]),
            (NegativeY, [NegativeY, PositiveX, PositiveY, NegativeX]),
        ] {
            for (facing, expected) in Facing::ALL.into_iter().zip(expected) {
                assert_eq!(
                    source.turned_with(facing),
                    expected,
                    "source {source:?} on an object facing {facing:?}"
                );
            }
        }
    }

    /// A 3 by 2 object with one off-centre socket, so the centre term, the
    /// offset rotation and the side swap each move the answer on both axes
    /// ([L-exercise-geometry-on-both-axes]). Origin (10, 20): distinct
    /// enough that a transposed origin cannot land on a right answer.
    #[test]
    fn sockets_resolve_about_the_centre_of_the_oriented_rectangle() {
        let mut object = turnable(
            None,
            FacingSprites([Some(4), Some(5), Some(6), Some(7)]),
            FacingSprites::NONE,
        );
        object.footprint = Footprint { width: 3, depth: 2 };
        object.action_sockets = vec![CompiledActionSocket {
            id: "seat".to_string(),
            x: 0.75,
            y: -0.25,
            facing: CompiledSocketFacing::PositiveX,
        }];

        let resolved: Vec<(f32, f32, CompiledSocketFacing)> = Facing::ALL
            .into_iter()
            .map(|facing| {
                let sockets = object.sockets_at(10.0, 20.0, facing);
                assert_eq!(sockets.len(), 1);
                (sockets[0].x, sockets[0].y, sockets[0].facing)
            })
            .collect();
        assert_eq!(
            resolved,
            vec![
                // Centre (11, 20.5), offset (0.75, -0.25).
                (11.75, 20.25, CompiledSocketFacing::PositiveX),
                // Sides swapped: centre (10.5, 21), offset (0.25, 0.75).
                (10.75, 21.75, CompiledSocketFacing::PositiveY),
                // Centre (11, 20.5) again, offset (-0.75, 0.25).
                (10.25, 20.75, CompiledSocketFacing::NegativeX),
                // Centre (10.5, 21), offset (-0.25, -0.75).
                (10.25, 20.25, CompiledSocketFacing::NegativeY),
            ]
        );
    }

    #[test]
    fn a_directional_base_rotates_geometry_only_by_the_relative_turn() {
        let mut object = turnable(
            None,
            FacingSprites([Some(4), Some(5), Some(6), Some(7)]),
            FacingSprites::NONE,
        );
        object.base_facing = Facing::SouthWest;
        object.footprint = Footprint { width: 3, depth: 2 };
        object.action_sockets = vec![CompiledActionSocket {
            id: "seat".into(),
            x: 0.75,
            y: -0.25,
            facing: CompiledSocketFacing::PositiveX,
        }];
        let expected = [
            (2, 3, 10.25, 20.25, CompiledSocketFacing::NegativeY),
            (3, 2, 11.75, 20.25, CompiledSocketFacing::PositiveX),
            (2, 3, 10.75, 21.75, CompiledSocketFacing::PositiveY),
            (3, 2, 10.25, 20.75, CompiledSocketFacing::NegativeX),
        ];
        for (facing, (width, depth, x, y, socket_facing)) in Facing::ALL.into_iter().zip(expected) {
            assert_eq!(object.footprint_at(facing), Footprint { width, depth });
            assert_eq!(
                object.sockets_at(10.0, 20.0, facing),
                vec![CompiledPlacementSocket {
                    x,
                    y,
                    facing: socket_facing
                }]
            );
        }
    }

    /// Task 5's `build.rs` writes the pack with `postcard::to_allocvec`
    /// and the runtime reads it with `postcard::from_bytes`. `postcard`
    /// is declared `default-features = false, features = ["alloc"]`, and
    /// `to_allocvec` is gated on exactly that feature, so this test is
    /// what makes the manifest choice a checked claim rather than an
    /// assumption.
    #[test]
    fn a_pack_round_trips_through_postcard() {
        let pack = three_objects();
        let bytes = postcard::to_allocvec(&pack).expect("pack must serialise");
        assert!(
            !bytes.is_empty(),
            "an empty encoding would round-trip trivially"
        );

        let restored: ContentPack = postcard::from_bytes(&bytes).expect("pack must deserialise");
        assert_eq!(restored, pack);
        assert_eq!(
            restored.objects[0].interactions[0].visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Read,
                anchor: CompiledVisualAnchor::ObjectSocket,
                facing: CompiledVisualFacing::Socket,
                socket: Some(1),
            }),
            "postcard must preserve the object-socket reading variants"
        );
        assert_eq!(
            restored.objects[1].interactions[0].visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Read,
                anchor: CompiledVisualAnchor::Object,
                facing: CompiledVisualFacing::TowardAnchor,
                socket: None,
            }),
            "postcard must preserve the object-anchored reading variants"
        );
        assert_eq!(
            restored.chains[0].steps[2].visual,
            Some(CompiledVisual {
                action: CompiledVisualAction::Eat,
                anchor: CompiledVisualAnchor::Station,
                facing: CompiledVisualFacing::TowardAnchor,
                socket: None,
            }),
            "postcard must preserve the station-eating variants"
        );
    }

    /// A new tuning knob belongs at the end of the serialized `Tuning`
    /// record, even when it is conceptually related to fields near the
    /// beginning. Two one-byte values make the byte that changes unambiguous:
    /// it must be the final byte and every established field must stay put.
    #[test]
    fn wander_radius_occupies_the_appended_tuning_slot() {
        let before = postcard::to_allocvec(&a_tuning()).expect("tuning must serialise");
        let after = postcard::to_allocvec(&Tuning {
            wander_radius_tiles: 31,
            ..a_tuning()
        })
        .expect("tuning must serialise");

        assert_eq!(before.len(), after.len());
        let changed: Vec<usize> = before
            .iter()
            .zip(&after)
            .enumerate()
            .filter_map(|(index, (left, right))| (left != right).then_some(index))
            .collect();
        assert_eq!(changed, vec![before.len() - 1]);
        assert_eq!(before.last(), Some(&29));
        assert_eq!(after.last(), Some(&31));
    }

    /// Pins both the appended chain-step field and the append-only enum
    /// discriminants. A round trip alone would accept a writer and reader that
    /// reordered the same variants together, which would still break an older
    /// compiled pack on disk.
    #[test]
    fn a_chain_step_visual_has_stable_postcard_bytes() {
        let step = CompiledChainStep {
            role: 7,
            label: "Eat".to_string(),
            duration_ticks: 42,
            tags: vec![],
            yields: None,
            transforms: None,
            consumes: Some(4),
            visual: Some(CompiledVisual {
                action: CompiledVisualAction::Eat,
                anchor: CompiledVisualAnchor::Station,
                facing: CompiledVisualFacing::TowardAnchor,
                socket: None,
            }),
            sound_action: Some(CompiledSoundAction::StoveCooking),
        };

        assert_eq!(
            postcard::to_allocvec(&step).expect("chain step must serialise"),
            // Visual socket `None` is followed by Some and enum discriminant
            // 1 for the appended StoveCooking sound action.
            vec![7, 3, 69, 97, 116, 42, 0, 0, 0, 1, 4, 1, 1, 2, 0, 0, 1, 1]
        );
    }

    #[test]
    fn read_visuals_keep_existing_enum_discriminants_and_socket_slot() {
        let seated = CompiledVisual {
            action: CompiledVisualAction::Read,
            anchor: CompiledVisualAnchor::ObjectSocket,
            facing: CompiledVisualFacing::Socket,
            socket: Some(7),
        };
        let standing = CompiledVisual {
            action: CompiledVisualAction::Read,
            anchor: CompiledVisualAnchor::Object,
            facing: CompiledVisualFacing::TowardAnchor,
            socket: None,
        };

        assert_eq!(
            postcard::to_allocvec(&seated).expect("seated read visual must serialise"),
            vec![2, 3, 1, 1, 7],
            "Read, ObjectSocket, and Socket append after the established variants"
        );
        assert_eq!(
            postcard::to_allocvec(&standing).expect("standing read visual must serialise"),
            vec![2, 1, 0, 0],
            "standing read reuses the established Read, Object, and TowardAnchor variants"
        );
    }

    /// The aquarium and exercise-bike actions append to the presentation
    /// vocabulary. Pinning the bytes catches a future variant reorder that a
    /// same-version postcard round trip would happily conceal.
    #[test]
    fn object_action_visuals_append_after_existing_action_discriminants() {
        let exercise = CompiledVisual {
            action: CompiledVisualAction::Exercise,
            anchor: CompiledVisualAnchor::ObjectSocket,
            facing: CompiledVisualFacing::Socket,
            socket: Some(0),
        };
        let watch = CompiledVisual {
            action: CompiledVisualAction::Watch,
            anchor: CompiledVisualAnchor::Object,
            facing: CompiledVisualFacing::TowardAnchor,
            socket: None,
        };
        let sit = CompiledVisual {
            action: CompiledVisualAction::Sit,
            anchor: CompiledVisualAnchor::ObjectSocket,
            facing: CompiledVisualFacing::Socket,
            socket: Some(2),
        };
        let sleep = CompiledVisual {
            action: CompiledVisualAction::Sleep,
            anchor: CompiledVisualAnchor::ObjectSocket,
            facing: CompiledVisualFacing::Socket,
            socket: Some(3),
        };

        assert_eq!(
            postcard::to_allocvec(&exercise).expect("exercise visual must serialise"),
            vec![3, 3, 1, 1, 0],
            "Exercise must append after Read without moving anchor, facing, or socket fields"
        );
        assert_eq!(
            postcard::to_allocvec(&watch).expect("watch visual must serialise"),
            vec![4, 1, 0, 0],
            "Watch must append after Exercise and keep the existing object-facing contract"
        );
        assert_eq!(
            postcard::to_allocvec(&sit).expect("sit visual must serialise"),
            vec![5, 3, 1, 1, 2],
            "Sit must append after Watch without moving the socket contract"
        );
        assert_eq!(
            postcard::to_allocvec(&sleep).expect("sleep visual must serialise"),
            vec![6, 3, 1, 1, 3],
            "Sleep must append after Sit without moving the socket contract"
        );
    }
}
