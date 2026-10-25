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

/// Physical occupancy requested by an action. Exclusive preserves legacy claims.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SeatUse {
    #[default]
    Exclusive,
    One,
    All,
}

impl SeatUse {
    /// People a seat action admits, derived from the furniture's physical
    /// seats; `None` for an exclusive action, whose authored `slots` stands.
    /// Seat actions take no authored count, so content cannot disagree with
    /// the furniture. The compiler refuses seat counts beyond `u8::MAX`.
    pub fn capacity(self, seats: usize) -> Option<u8> {
        match self {
            Self::Exclusive => None,
            Self::One => Some(u8::try_from(seats).unwrap_or(u8::MAX)),
            Self::All => Some(1),
        }
    }
}

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
    SinkWater,
}

/// One-shot presentation category emitted only by actual completion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CompiledCompletionSound {
    ToiletFlush,
}

/// Authored activity identity for a bubble and its text label. Presentation
/// only: it neither changes gameplay tags nor selects body animation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CompiledActivity {
    Eating,
    Sleeping,
    Reading,
    Exercising,
    WatchingFish,
    Sitting,
    Showering,
    UsingToilet,
    WatchingTv,
    Lounging,
    WashingHands,
    WashingDishes,
    ListeningRadio,
    Correspondence,
    Bathing,
    GettingIngredients,
    PreparingFood,
    Cooking,
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
    Prepare,
    Cook,
    Wash,
    UseToilet,
    Bathe,
    /// Opening a storage appliance, reaching inside and closing it again.
    /// Appended last: postcard writes the variant ordinal.
    Fetch,
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

/// Gameplay media eligibility is independent of activity labels and animation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaBehavior {
    Television,
    Radio,
}

/// One resolved action's work schedule over a shared recipe.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecipeBinding {
    pub recipe: String,
    pub selected_step: u32,
    pub steps: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecipeDef {
    pub id: String,
    pub selected_step: u32,
}

/// These shared procedures hand their final meal-table stage to dining admission.
pub fn communal_recipe_step(recipe: &str, step: u32, steps: usize) -> bool {
    matches!(recipe, "cook_dinner" | "eat_shared_meal") && step as usize + 1 == steps
}

pub(crate) fn binding_stage_error(
    recipe: &str,
    step: u32,
    steps: usize,
    role: &str,
) -> Option<&'static str> {
    if recipe == "eat_shared_meal" {
        Some("shared-meal recipes require an invitation and cannot be public bindings")
    } else if recipe == "clean_dishes" && step == 0 {
        Some("cleanup collection repeats at dish sources; select the washing stage")
    } else if communal_recipe_step(recipe, step, steps) && role == "meal_table" {
        Some("communal dining selects its own meal table; select an appliance work stage")
    } else {
        None
    }
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
    /// Activity metadata was appended after this field.
    pub sound_action: Option<CompiledSoundAction>,
    pub shared_activity: Option<String>,
    /// Optional authored activity indicator; excluded from save compatibility.
    /// Appended after sound to preserve the preceding interaction fields.
    /// The embedded pack has no cross-build decoding contract.
    pub activity: Option<CompiledActivity>,
    /// One-shot presentation metadata, excluded from save compatibility.
    /// Appended after activity to preserve preceding compiled fields.
    pub completion_sound: Option<CompiledCompletionSound>,
    /// Owned-book requirement, independent of labels and presentation.
    pub book_reading: bool,
    pub seat_use: SeatUse,
    pub media: Option<MediaBehavior>,
    pub recipe: Option<RecipeBinding>,
    /// Use kinds charged once when this action starts its physical work, as
    /// indices into [`BillsTuning::uses`] ([WB-usage] in
    /// `docs/specs/2026-10-18-wages-and-bills.md`). Ascending, none
    /// repeated, usually empty. Kept apart from `tags`, so traits, hobbies,
    /// skills and habituation cannot notice it, and outside the content
    /// fingerprint. Appended last.
    pub bill_uses: Vec<u16>,
}

#[cfg(test)]
#[test]
fn shipped_need_rewards_have_a_physical_or_entertaining_cause() {
    let pack = crate::pack();
    let delta = |object: &str, need: terri_core::NeedId| {
        pack.object(pack.find(object).unwrap()).interactions[0]
            .advertises
            .iter()
            .find(|(n, _)| *n as usize == need.index())
            .map_or(0., |(_, d)| *d)
    };
    use terri_core::NeedId;
    assert_eq!(delta("kitchen_sink", NeedId::Comfort), 0.);
    assert_eq!(delta("sink", NeedId::Comfort), 0.);
    assert_eq!(delta("bed", NeedId::Comfort), 5.);
    assert_eq!(delta("double_bed", NeedId::Comfort), 10.);
    assert_eq!(delta("sofa", NeedId::Fun), 0.);
    assert_eq!(delta("long_sofa", NeedId::Fun), 0.);
    for chain in &pack.chains {
        if chain.id == "cook_dinner" || chain.id == "eat_shared_meal" {
            assert!(!chain
                .advertises
                .iter()
                .any(|(n, d)| *n as usize == NeedId::Comfort.index() && *d > 0.));
        }
    }
}

#[cfg(test)]
#[test]
fn contextual_balance_values_do_not_change_the_save_contract() {
    let mut pack = crate::pack().clone();
    let before = crate::content_fingerprint(&pack);
    let chair = pack.find("chair").unwrap();
    let rate = pack.object(chair).seat_comfort_rate();
    pack.objects[chair.0 as usize].seat_comfort_per_tick = 0.25;
    pack.tuning.need_interactions.handwashing_hygiene_ceiling = 30.;
    pack.tuning.need_interactions.shared_social_per_tick = 0.07;
    assert_ne!(pack.object(chair).seat_comfort_rate(), rate);
    assert_eq!(crate::content_fingerprint(&pack), before);
}

#[cfg(test)]
#[test]
fn shipped_shared_activity_metadata_covers_parallel_reading_and_exercise() {
    let pack = crate::pack();
    for (object, group) in [
        ("bookshelf", "reading"),
        ("reading_chair", "reading"),
        ("reference_shelf", "aquarium"),
        ("moving_box", "exercise"),
    ] {
        let act = &pack.object(pack.find(object).unwrap()).interactions[0];
        assert_eq!(act.shared_activity.as_deref(), Some(group), "{object}");
    }
    assert_eq!(
        pack.object(pack.find("television").unwrap()).interactions[0].shared_activity,
        None
    );
}

/// Optional object identity copy. It never changes saved simulation state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ObjectPresentation {
    pub object_type: String,
    pub description: String,
}

/// Store classification. Rooms do not grant actions or constrain placement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelMetadata {
    pub category_id: String,
    pub category_label: String,
    pub type_id: String,
    pub type_label: String,
    pub rooms: Vec<String>,
}

/// One physical place shared by all seated activities on an object.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PhysicalSeat {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub facing: CompiledSocketFacing,
    pub approaches: Vec<(i32, i32)>,
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
    /// What the Buy tool charges, or `None` for an object not in the
    /// catalogue - [BM-price]. Appended after `base_facing`. Not in the save
    /// compatibility digest: a save stores Funds, never prices.
    pub price: Option<u32>,
    /// Appended presentation data; absent retains the existing name-only display.
    pub presentation: Option<ObjectPresentation>,
    /// Ordered physical sleeping places. Saved ordinals follow this order.
    pub sleep_places: Vec<SleepPlaceAccess>,
    /// Appended classification and future shared-seat geometry.
    pub metadata: Option<ModelMetadata>,
    pub seats: Vec<PhysicalSeat>,
    pub shelf_capacity: u16,
    pub shelf_access: Vec<(i32, i32)>,
    pub cooking_front: Option<(i32, i32)>,
    pub seat_comfort_per_tick: f32,
    /// The interaction a left click starts. Content names it by action id;
    /// the first interaction when unnamed.
    pub default_interaction: u32,
    /// Daily usage kinds, as indices into [`BillsTuning::daily`]: each placed
    /// object of this definition adds one of each to the month's bills
    /// every day ([WB-usage]). Ascending, none repeated. Appended after
    /// `default_interaction`.
    pub bill_daily: Vec<u16>,
    /// Whether every tile of the object must be inside an enclosed room when
    /// it is bought or moved ([WB-beds]). Appended last.
    pub indoor_only: bool,
}

/// Navigation offsets from the base-facing footprint, independent of art sockets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SleepPlaceAccess {
    pub id: String,
    pub approaches: Vec<(i32, i32)>,
}

impl CompiledObject {
    /// Use the seat's own Comfort rate, without borrowing Fun or Energy.
    pub fn seat_comfort_rate(&self) -> f32 {
        self.interactions
            .iter()
            .filter(|action| !action.book_reading)
            .flat_map(|a| {
                a.advertises.iter().filter_map(|(n, d)| {
                    (*n as usize == terri_core::NeedId::Comfort.index() && *d > 0.)
                        .then_some(*d / a.duration_ticks as f32)
                })
            })
            .fold(self.seat_comfort_per_tick, f32::max)
    }
    /// Alternate sleep interactions share physical capacity rather than adding it.
    pub fn sleep_capacity(&self, sleep_tag: &str) -> u8 {
        if sleep_tag.is_empty() {
            return 0;
        }
        self.interactions
            .iter()
            .filter(|interaction| interaction.tags.iter().any(|tag| tag == sleep_tag))
            .map(|interaction| interaction.slots)
            .max()
            .unwrap_or(0)
    }

    /// Rotated perimeter offsets. An unauthored single place uses legacy adjacency.
    pub fn sleep_approaches_at(&self, ordinal: u8, facing: Facing) -> Option<Vec<(i32, i32)>> {
        let place = self.sleep_places.get(ordinal as usize)?;
        let width = self.footprint.width as i32;
        let depth = self.footprint.depth as i32;
        let turn = self.relative_turn(facing);
        Some(
            place
                .approaches
                .iter()
                .map(|&(x, y)| match turn {
                    Facing::SouthEast => (x, y),
                    Facing::SouthWest => (depth - 1 - y, x),
                    Facing::NorthWest => (width - 1 - x, depth - 1 - y),
                    Facing::NorthEast => (y, width - 1 - x),
                })
                .collect(),
        )
    }

    /// Authored shelf contacts rotate from the base-facing footprint.
    pub fn shelf_approaches_at(&self, facing: Facing) -> Vec<(i32, i32)> {
        let (width, depth) = (self.footprint.width as i32, self.footprint.depth as i32);
        self.shelf_access
            .iter()
            .map(|&(x, y)| match self.relative_turn(facing) {
                Facing::SouthEast => (x, y),
                Facing::SouthWest => (depth - 1 - y, x),
                Facing::NorthWest => (width - 1 - x, depth - 1 - y),
                Facing::NorthEast => (y, width - 1 - x),
            })
            .collect()
    }

    /// Physical seats use the same centre and relative rotation as action sockets.
    pub fn seat_at(
        &self,
        ordinal: usize,
        origin_x: f32,
        origin_y: f32,
        facing: Facing,
    ) -> Option<CompiledPlacementSocket> {
        let seat = self.seats.get(ordinal)?;
        let footprint = self.footprint_at(facing);
        let turn = self.relative_turn(facing);
        let (x, y) = turn.rotate_offset(seat.x, seat.y);
        Some(CompiledPlacementSocket {
            x: origin_x + (footprint.width - 1) as f32 / 2. + x,
            y: origin_y + (footprint.depth - 1) as f32 / 2. + y,
            facing: seat.facing.turned_with(turn),
        })
    }

    pub fn seat_approaches_at(&self, ordinal: usize, facing: Facing) -> Option<Vec<(i32, i32)>> {
        let seat = self.seats.get(ordinal)?;
        let (width, depth) = (self.footprint.width as i32, self.footprint.depth as i32);
        Some(
            seat.approaches
                .iter()
                .map(|&(x, y)| match self.relative_turn(facing) {
                    Facing::SouthEast => (x, y),
                    Facing::SouthWest => (depth - 1 - y, x),
                    Facing::NorthWest => (width - 1 - x, depth - 1 - y),
                    Facing::NorthEast => (y, width - 1 - x),
                })
                .collect(),
        )
    }

    /// Primary identification for controls and accessible labels.
    pub fn display_name(&self) -> &str {
        self.metadata
            .as_ref()
            .map(|meta| meta.type_label.as_str())
            .unwrap_or_else(|| {
                self.presentation
                    .as_ref()
                    .map_or(&self.name, |text| &text.object_type)
            })
    }

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

/// The lot: its size, interior architecture, and what stands on it.
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
    /// rather than re-check. Appended after placements; its encoded position
    /// stays fixed when later fields are added.
    pub front_door: Option<(u32, u32)>,
    /// Interior boundaries in declaration order. Appended for postcard stability.
    pub wall_edges: Vec<terri_core::layout::WallEdge>,
    /// [OS-grow] in `docs/specs/2026-09-22-the-outside.md`: the house's width
    /// and height from the lot's north-west corner; every other tile is yard.
    /// The whole lot when `lot.toml` names no house. Appended.
    pub house: (u32, u32),
    /// [OS-yard]: the hue, strength and lightness a yard tile's floor art is
    /// drawn under, as a colourway's ([RC-shift]). Appended.
    pub yard_look: [f32; 3],
    /// [OS-street]: the same for a street tile. Appended.
    pub street_look: [f32; 3],
}

/// One authored floor covering - [FL-content].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledCovering {
    pub name: String,
    /// Hue, strength and lightness, as a colourway's shift ([RC-shift]).
    pub look: [f32; 3],
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

/// Fight behavior selected by authenticated content, independent of save format.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum FightRules {
    #[default]
    Attributed,
    Published,
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
    /// Maximum waiting player orders per sim; zero means unlimited.
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
    /// What a sale pays back, as a fraction of the object's price, in
    /// `[0, 1]` and finite - [SL-pay] in
    /// `docs/specs/2026-09-22-selling-furniture.md`. A sale pays
    /// `floor(price * resale_fraction)`.
    pub resale_fraction: f32,
    /// The most characters a new housemate's name may have, from 1 to 256 -
    /// [CS-command] in `docs/specs/2026-09-22-create-a-sim.md`.
    pub housemate_name_max_chars: u32,
    /// The most traits a new housemate may wear, at least 1 - [CS-command].
    pub housemate_max_traits: u32,
    /// How much of the day's light a tile the sky cannot reach loses at
    /// noon, in `[0, 1)` - [OS-daylight] in
    /// `docs/specs/2026-09-22-the-outside.md`. Read only by the renderer.
    pub interior_daylight_shade: f32,
    /// Sky exposure lost per tile travelled indoors, in `(0, 1]` -
    /// [OS-daylight]. Mortality fields follow under the appending rule.
    pub daylight_reach_per_tile: f32,
    pub death_after_ticks: u32,
    pub death_warning_ticks: u32,
    pub grief_ticks: u32,
    pub grief_min_score: f32,
    pub grief_max_score: f32,
    pub grief_min_ticks: u32,
    pub grief_hated_affinity: f32,
    pub mood_critical_need_level: f32,
    pub mood_low_need_level: f32,
    pub mood_needs_met_level: f32,
    pub mood_critical_need_penalty: f32,
    pub mood_low_need_penalty: f32,
    pub mood_needs_met_bonus: f32,
    pub mood_condition_penalty: f32,
    pub mood_relationship_strength: f32,
    pub mood_relationship_radius: f32,
    pub mood_relationship_min_affinity: f32,
    pub mood_condition_min_severity: f32,
    pub waiting_mood_min_penalty: f32,
    pub waiting_mood_max_penalty: f32,
    pub satisfaction_mood_neutral_band: f32,
    pub satisfaction_mood_per_tick: f32,
    /// Autonomous choice and self-preservation controls.
    pub choice_comfort_temperature: f32,
    pub choice_exploration: f32,
    pub choice_comfort_exploration: f32,
    pub leisure_appeal: f32,
    pub survival_risk_penalty: f32,
    pub choice_probability_floor: f32,
    pub wander_pause_variance: f32,
    pub self_preservation_curve: [(u8, f32); 6],
    pub social_unmet_need_penalty: f32,
    pub social_critical_need_penalty: f32,
    pub bathroom_privacy_penalty: f32,
    pub social_boundary_avoidance_cost: f32,
    pub shyness_annoyance_strength: f32,
    pub boundary_wander_reconsider_chance: f32,
    pub shyness_wander_reconsider_strength: f32,
    pub relationships: crate::RelationshipTuning,
    /// Domestic systems are disabled in custom packs without this table.
    pub domestic: Option<DomesticTuning>,
    /// The practice level 1 of every skill costs, above 0 - [SK-model] in
    /// `docs/specs/2026-10-05-skills.md`. Appended, per the rule above.
    pub skill_level_cost: f32,
    /// What each later skill level costs, as a multiple of the one before,
    /// at least 1 - [SK-model].
    pub skill_level_growth: f32,
    /// The highest habituation repeated use reaches, above 1 - [OD-model]
    /// in `docs/specs/2026-10-06-overdoing-it.md`. Appended, per the rule
    /// above, with the four knobs after it.
    pub habituation_max: f32,
    /// The habituation above which an activity costs mood, at least 1 and
    /// below `habituation_max` - [OD-content].
    pub overdoing_threshold: f32,
    /// The mood an activity at `habituation_max` costs, not negative.
    pub overdoing_penalty: f32,
    /// The habituation on a food activity at which a person feels sick,
    /// above `overdoing_threshold` and at most `habituation_max`.
    pub sick_threshold: f32,
    /// The mood feeling sick costs, not negative.
    pub sick_penalty: f32,
    /// The weekday of day 0, 0 (Monday) to 6 (Sunday) - [CAL-week] in
    /// `docs/specs/2026-10-06-calendar.md`. Read through
    /// `terri_core::clock::weekday`. Appended, per the rule above.
    pub first_weekday: u8,
    /// The starting value a disposition trait sets for its affinity kind,
    /// in `(0, 1]`: this for a trait that loves the kind, its negative for
    /// one that hates it - [OA-values] in
    /// `docs/specs/2026-10-06-object-affinities.md`. Appended, per the rule
    /// above, with the six knobs after it.
    pub affinity_from_trait: f32,
    /// Below this magnitude an affinity value gives no moodlet, in
    /// `[0, 1)` ([OA-presence]).
    pub affinity_presence_threshold: f32,
    /// The mood one object of a presence kind gives at a value of 1.0, not
    /// negative.
    pub affinity_presence_points: f32,
    /// The mood each further object of the kind adds at 1.0, up to the cap,
    /// not negative.
    pub affinity_presence_extra_points: f32,
    /// How many further objects count. Any value, including 0.
    pub affinity_presence_extra_cap: u32,
    /// The mood each other person using a use kind costs at a value of
    /// -1.0, not negative - [OA-use].
    pub affinity_use_points: f32,
    /// How much a bothered person's feeling toward the user falls per game
    /// hour at -1.0, not negative - [OA-use].
    pub affinity_use_feeling_per_hour: f32,
    /// The score multiplier at or above which a disposition trait loves its
    /// tag, above 1 - [TL-affinity] in
    /// `docs/specs/2026-09-21-trait-library-and-traits-panel.md`. The
    /// compiler also reads it to word each disposition's description; the
    /// simulation reads it at spawn, where a worn trait that loves an
    /// affinity kind's trait tag sets that kind's value ([OA-values]).
    /// Appended, per the rule above.
    pub affinity_loves_from: f32,
    /// The score multiplier at or below which a disposition trait hates its
    /// tag, in `[0, 1)` - [TL-affinity], read at spawn as the line above.
    pub affinity_hates_to: f32,
    /// At or above this an affinity value reads "Loves", at or below its
    /// negative "Hates" - [OA-hud]. In `(affinity_band_likes, 1]`.
    /// Appended, per the rule above, with the two knobs after it.
    pub affinity_band_loves: f32,
    /// At or above this a value reads "Likes", at or below its negative
    /// "Dislikes", strictly between "Indifferent" - [OA-hud]. Above 0.
    pub affinity_band_likes: f32,
    /// The starting value a disposition trait between the verb bands sets:
    /// this for one that likes its kind, its negative for one that dislikes
    /// it - [OA-values]. Above 0 and below `affinity_from_trait`.
    pub affinity_from_mild_trait: f32,
    /// Appended balance values; saves reconstruct these from current content.
    pub need_interactions: crate::NeedInteractionTuning,
    /// Chance per contact minute that a communal activity still warms a
    /// person toward a housemate they hate (communal affinity, issue 257).
    /// Appended after the balance values, per the rule above.
    pub hated_communal_chance: f32,
    /// Chance that a meal burns as it leaves the hob, for a cook with no
    /// cooking practice (burnt meals, issue 243). Appended after the
    /// communal chance, per the rule above, with the three knobs after it.
    pub burn_chance_novice: f32,
    /// The same chance at full cooking mastery; at most the novice chance.
    pub burn_chance_master: f32,
    /// How much a burnt meal lowers mood while its moodlet lasts.
    pub burnt_meal_mood_penalty: f32,
    /// How many ticks the Burnt dinner moodlet lasts.
    pub burnt_meal_mood_ticks: u32,
    /// The feeling at or below which a person may start a fight on their
    /// own (fights, issue 248). Appended after the burnt-meal knobs, per
    /// the rule above, with the four knobs after it.
    pub fight_affinity_threshold: f32,
    /// Chance, per idle tick and per grudge with a reason, that the fight
    /// starts.
    pub fight_chance_per_tick: f32,
    /// How much a finished fight lowers each side's feeling for the other.
    pub fight_relationship_loss: f32,
    /// How much a fight lowers mood while its moodlet lasts.
    pub fight_mood_penalty: f32,
    /// How many ticks the Had a fight moodlet lasts.
    pub fight_mood_ticks: u32,
    /// How deep a strip of bought land is, in tiles (land expansion, issue
    /// 254). Appended after the fight knobs, per the rule above, with the
    /// two prices after it.
    pub land_strip_depth: u32,
    /// The price of a square of land before any was bought, in cents.
    pub land_price_cents: u32,
    /// How much every square already bought adds to the next square's
    /// price, in cents.
    pub land_price_step_cents: u32,
    // Careers (issue 249): appended after the land knobs, in the order
    // `docs/specs/2026-10-17-careers.md` rule 17 lists.
    /// How far a weekly review's draw can move the week's performance either way, in points.
    pub career_review_noise: f32,
    /// A week performing below this is poor.
    pub career_poor_threshold: f32,
    /// A week performing at or above this is good.
    pub career_good_threshold: f32,
    /// The dismissal chance per consecutive poor week beyond the second.
    pub career_fire_base: f32,
    /// The demotion chance at performance 0, scaled down to 0 at the poor threshold.
    pub career_demote_base: f32,
    /// The promotion chance at performance 100, scaled down to 0 at 50.
    pub career_promote_base: f32,
    /// The raise chance at performance 100, scaled down to 0 at 50.
    pub career_raise_base: f32,
    /// The tick of the day an unemployed person looks for work.
    pub career_search_tick: u32,
    /// The chance an unemployed person applies on a working day.
    pub career_search_chance: f32,
    /// Below this fit a person may change path on their own.
    pub career_change_fit: f32,
    /// How much better another path's fit must be for a change.
    pub career_change_gap: f32,
    /// The chance such a change happens at a review with no outcome.
    pub career_change_chance: f32,
    /// How many points job satisfaction moves toward its target per shift.
    pub career_satisfaction_rate: f32,
    /// Below this job satisfaction a person hates the job.
    pub career_job_misery: f32,
    /// Above this job satisfaction a person enjoys the job.
    pub career_job_joy: f32,
    /// Life satisfaction points a hated job costs per completed shift.
    pub career_misery_satisfaction: f32,
    /// How much enjoying the job raises mood.
    pub career_mood_joy: f32,
    /// How much hating the job lowers mood.
    pub career_mood_misery: f32,
    /// How much a warning at work lowers mood.
    pub career_mood_warned: f32,
    /// How much a promotion raises mood while its moodlet lasts.
    pub career_mood_promoted: f32,
    /// How much a raise raises mood while its moodlet lasts.
    pub career_mood_raise: f32,
    /// How much a demotion lowers mood while its moodlet lasts.
    pub career_mood_demoted: f32,
    /// How much a dismissal lowers mood while its moodlet lasts.
    pub career_mood_fired: f32,
    /// How many ticks the Promoted and Got a raise moodlets last.
    pub career_mood_promoted_ticks: u32,
    /// How many ticks the Demoted moodlet lasts.
    pub career_mood_demoted_ticks: u32,
    /// How many ticks the Fired moodlet lasts.
    pub career_mood_fired_ticks: u32,
    /// How many days each season lasts, at least 1 (seasons, issue 251;
    /// [SEA-year] in `docs/specs/2026-10-17-seasons.md`). Read through
    /// `terri_core::clock::season`. Appended after the career knobs, per
    /// the rule above, with the two knobs after it.
    pub days_per_season: u32,
    /// The season of day 0, 0 (Spring) to 3 (Winter) - [SEA-year].
    pub first_season: u8,
    /// The yard grass's `[hue, strength, lightness]` change in each season,
    /// Spring first, composed with `CompiledLot::yard_look` by the shell -
    /// [SEA-yard]. Presentation only; the simulation never reads it.
    pub season_yard_looks: [[f32; 3]; 4],
    /// Optional extension; historical packs retain their existing wire records.
    #[serde(default)]
    pub autonomy: Option<crate::AutonomyTuning>,
    /// Appreciation after a shared portion; appended for issue 275.
    pub meal_appreciation_gain: f32,
    /// Presentation-only extension after the historical tuning fields.
    #[serde(default)]
    pub weather: Option<crate::WeatherTuning>,
    /// Purposeful fight and chore response balance, appended after weather.
    pub fight_grievance_ticks: u32,
    pub fight_history_ticks: u32,
    pub fight_repeat_grievance_ticks: u32,
    pub fight_mood_bad_multiplier: f32,
    pub fight_mood_good_multiplier: f32,
    pub fight_opinion_strength: f32,
    pub fight_severity_reference: f32,
    pub chore_fight_response_base: f32,
    pub chore_fight_response_ticks: u32,
    pub chore_fight_response_cleanliness: f32,
    pub chore_fight_response_responsibility: f32,
    pub chore_fight_response_commitment: f32,
    pub chore_fight_response_preference: f32,
    pub chore_fight_response_affinity: f32,
    pub chore_fight_response_mood: f32,
    pub chore_repair_base: f32,
    pub chore_repair_cleanliness: f32,
    /// Authenticated producer references retain their original fight rules.
    pub fight_rules: FightRules,
    /// Shifts (issue 296, [WS-sleep] in
    /// `docs/specs/2026-10-18-shifts-and-careers.md`): ticks added to a
    /// person's sleep rhythm while they hold a shift of each kind, in
    /// kind order (day, early, late, night). Appended after the
    /// purposeful-fight rules, per the rule above.
    pub shift_sleep_offset_day: i32,
    pub shift_sleep_offset_early: i32,
    pub shift_sleep_offset_late: i32,
    pub shift_sleep_offset_night: i32,
    /// [WS-search]: how far the job search spreads its choice of path over
    /// fit. 0 is the best-fit search with no draw.
    pub career_search_temperature: f32,
    /// How much more a shift of the night kind pays, in percent from 0 to
    /// 100 ([WB-wages] in `docs/specs/2026-10-18-wages-and-bills.md`).
    /// Applied to each night shift's pay when it is registered; the
    /// person's pay and the level's range stay without it. Appended after
    /// the shift knobs, per the rule above.
    pub night_shift_premium_percent: u32,
}

impl Tuning {
    /// What a pack published before `hated_communal_chance` existed
    /// reconstructs for it: the shipped `content/tuning.toml` value, which
    /// the authentic published-pack test pins against current content.
    pub const SHIPPED_HATED_COMMUNAL_CHANCE: f32 = 0.35;
    /// The shipped burnt-meal knobs, reconstructed the same way for packs
    /// published before they existed.
    pub const SHIPPED_BURN_CHANCE_NOVICE: f32 = 0.12;
    pub const SHIPPED_BURN_CHANCE_MASTER: f32 = 0.002;
    pub const SHIPPED_BURNT_MEAL_MOOD_PENALTY: f32 = 10.0;
    pub const SHIPPED_BURNT_MEAL_MOOD_TICKS: u32 = 240;
    /// The shipped fight knobs, reconstructed the same way for packs
    /// published before they existed.
    pub const SHIPPED_FIGHT_AFFINITY_THRESHOLD: f32 = -0.9;
    pub const SHIPPED_FIGHT_CHANCE_PER_TICK: f32 = 0.01;
    pub const SHIPPED_FIGHT_RELATIONSHIP_LOSS: f32 = 0.1;
    pub const SHIPPED_FIGHT_MOOD_PENALTY: f32 = 12.0;
    pub const SHIPPED_FIGHT_MOOD_TICKS: u32 = 480;
    /// The shipped land knobs, reconstructed the same way for packs
    /// published before they existed.
    pub const SHIPPED_LAND_STRIP_DEPTH: u32 = 10;
    pub const SHIPPED_LAND_PRICE_CENTS: u32 = 15_000;
    pub const SHIPPED_LAND_PRICE_STEP_CENTS: u32 = 15;
    /// The shipped career knobs, reconstructed the same way for packs
    /// published before they existed.
    pub const SHIPPED_CAREER_REVIEW_NOISE: f32 = 10.0;
    pub const SHIPPED_CAREER_POOR_THRESHOLD: f32 = 40.0;
    pub const SHIPPED_CAREER_GOOD_THRESHOLD: f32 = 65.0;
    pub const SHIPPED_CAREER_FIRE_BASE: f32 = 0.08;
    pub const SHIPPED_CAREER_DEMOTE_BASE: f32 = 0.15;
    pub const SHIPPED_CAREER_PROMOTE_BASE: f32 = 0.22;
    pub const SHIPPED_CAREER_RAISE_BASE: f32 = 0.18;
    pub const SHIPPED_CAREER_SEARCH_TICK: u32 = 540;
    pub const SHIPPED_CAREER_SEARCH_CHANCE: f32 = 0.5;
    pub const SHIPPED_CAREER_CHANGE_FIT: f32 = -0.3;
    pub const SHIPPED_CAREER_CHANGE_GAP: f32 = 0.5;
    pub const SHIPPED_CAREER_CHANGE_CHANCE: f32 = 0.25;
    pub const SHIPPED_CAREER_SATISFACTION_RATE: f32 = 4.0;
    pub const SHIPPED_CAREER_JOB_MISERY: f32 = 35.0;
    pub const SHIPPED_CAREER_JOB_JOY: f32 = 65.0;
    pub const SHIPPED_CAREER_MISERY_SATISFACTION: f32 = 0.5;
    pub const SHIPPED_CAREER_MOOD_JOY: f32 = 6.0;
    pub const SHIPPED_CAREER_MOOD_MISERY: f32 = 8.0;
    pub const SHIPPED_CAREER_MOOD_WARNED: f32 = 6.0;
    pub const SHIPPED_CAREER_MOOD_PROMOTED: f32 = 12.0;
    pub const SHIPPED_CAREER_MOOD_RAISE: f32 = 8.0;
    pub const SHIPPED_CAREER_MOOD_DEMOTED: f32 = 12.0;
    pub const SHIPPED_CAREER_MOOD_FIRED: f32 = 16.0;
    pub const SHIPPED_CAREER_MOOD_PROMOTED_TICKS: u32 = 1440;
    pub const SHIPPED_CAREER_MOOD_DEMOTED_TICKS: u32 = 2880;
    pub const SHIPPED_CAREER_MOOD_FIRED_TICKS: u32 = 5760;
    /// The shipped shift knobs (issue 296), reconstructed the same way for
    /// packs published before they existed. The offsets matter only for a
    /// held shift of a non-day kind, which no published pack has.
    pub const SHIPPED_SHIFT_SLEEP_OFFSET_DAY: i32 = 0;
    pub const SHIPPED_SHIFT_SLEEP_OFFSET_EARLY: i32 = -60;
    pub const SHIPPED_SHIFT_SLEEP_OFFSET_LATE: i32 = 120;
    pub const SHIPPED_SHIFT_SLEEP_OFFSET_NIGHT: i32 = 660;
    /// The search temperature a pack published before issue 296 rebuilds
    /// with: 0, the best-fit search those packs ran, so their worlds keep
    /// choosing a path exactly as they did.
    pub const PRE_SHIFT_CAREER_SEARCH_TEMPERATURE: f32 = 0.0;
    /// The shipped night premium (issue 298), reconstructed the same way for
    /// packs published before it existed. It matters only for a held shift
    /// of the night kind, which no published pack has.
    pub const SHIPPED_NIGHT_SHIFT_PREMIUM_PERCENT: u32 = 15;

    /// The pay of one shift of `kind` for a person paid `pay` whole dollars
    /// per shift, in cents ([WB-wages]): `pay * 100` with the night premium
    /// added for a night shift, rounded down to the cent.
    pub fn shift_pay_cents(&self, pay: u32, kind: u8) -> i64 {
        let cents = i64::from(pay) * 100;
        if kind == SHIFT_NIGHT {
            cents * (100 + i64::from(self.night_shift_premium_percent)) / 100
        } else {
            cents
        }
    }
    /// The shipped season knobs, reconstructed the same way for packs
    /// published before they existed.
    pub const SHIPPED_DAYS_PER_SEASON: u32 = 7;
    pub const SHIPPED_FIRST_SEASON: u8 = 0;
    pub const SHIPPED_SEASON_YARD_LOOKS: [[f32; 3]; 4] = [
        [0.0, 1.0, 0.0],
        [-20.0, 0.85, 0.04],
        [-45.0, 0.9, -0.05],
        [12.0, 0.3, 0.14],
    ];
}

/// The household's monthly bills, compiled from `[bills]` in
/// `content/tuning.toml` - [WB-tuning] in
/// `docs/specs/2026-10-18-wages-and-bills.md`.
///
/// A sibling of [`Tuning`] on the pack rather than a field of it, for the
/// reason [`Circadian`] is: `Tuning` is `Copy`, and the kind lists own
/// their labels. Every value has been through the compiler: the month is
/// 1 to 365 days, the grace is shorter than the month, the percentages are
/// 0 to 100, the mood is finite and not negative, and every cent amount is
/// 0 to 1,000,000.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BillsTuning {
    pub days_per_month: u32,
    pub grace_days: u32,
    pub late_fee_percent: u32,
    pub late_fee_cap_percent: u32,
    pub overdue_mood: f32,
    pub rent_base_cents: i64,
    pub rent_indoor_tile_cents: i64,
    pub rent_outdoor_tile_cents: i64,
    pub electricity_base_cents: i64,
    pub water_base_cents: i64,
    pub transportation_base_cents: i64,
    pub commute_cents: i64,
    /// The money a new household starts with ([WB-rulings] ruling 18).
    pub starting_funds_cents: i64,
    /// Charged once each time an action or chain step carrying the kind
    /// starts its physical work, in id order. Compiled actions and steps
    /// hold indices into this list.
    pub uses: Vec<BillKind>,
    /// Charged once a day for each placed object carrying the kind, in id
    /// order. Compiled objects hold indices into this list.
    pub daily: Vec<BillKind>,
}

/// One usage kind of [`BillsTuning`]: its id, the label the Bills panel
/// shows, and what one use or one object-day adds to each utility bill.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BillKind {
    pub id: String,
    pub label: String,
    pub water_cents: i64,
    pub electricity_cents: i64,
}

impl BillsTuning {
    /// The shipped scalar values, which packs published before bills and
    /// the frozen pre-books sources reconstruct ([L-required-tuning-
    /// historical-expansion]). Their content declares no usage, so the
    /// kind lists are empty.
    pub fn shipped_without_usage() -> Self {
        Self {
            days_per_month: 7,
            grace_days: 5,
            late_fee_percent: 5,
            late_fee_cap_percent: 50,
            overdue_mood: 8.0,
            rent_base_cents: 6000,
            rent_indoor_tile_cents: 90,
            rent_outdoor_tile_cents: 20,
            electricity_base_cents: 3000,
            water_base_cents: 2000,
            transportation_base_cents: 1000,
            commute_cents: 300,
            // Households from before bills started with nothing, and a
            // reconstructed one must too.
            starting_funds_cents: 0,
            uses: Vec::new(),
            daily: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct DomesticTuning {
    pub own_cleanup_min: f32,
    pub own_cleanup_bonus: f32,
    pub visitor_cleanup_fraction: f32,
    pub critical_cleanup_scale: f32,
    pub ready_need_level: f32,
    pub other_need_floor: f32,
    pub other_need_level: f32,
    pub invite_hunger_level: f32,
    pub accept_hunger_level: f32,
    pub friend_affinity: f32,
    pub mood_penalty_min: f32,
    pub mood_penalty_bonus: f32,
    pub mood_units: f32,
    pub mood_max_load: f32,
    pub affinity_penalty_min: f32,
    pub affinity_penalty_bonus: f32,
    pub wash_ticks_per_unit: u32,
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
    pub cleanliness: f32,
    pub id: String,
    pub drain: [f32; NEED_COUNT],
    pub satisfaction: [f32; NEED_COUNT],
    /// (object, interaction index, weight), sorted by key because it is
    /// copied verbatim into a component whose iteration order must be
    /// deterministic - `Personality::disposition` binary-searches it, and
    /// `Sim::world_hash` iterates it in its `personality-effects-v1`
    /// block. The names are resolved: a disposition toward an
    /// interaction that does not exist has no representation once a pack
    /// exists.
    pub dispositions: Vec<(ObjectDefId, u32, f32)>,
    /// Sleep-schedule displacement in ticks: negative is earlier, positive later.
    /// [ML-chrono]. 0 is "sleeps when everyone else does", which is the
    /// default and is what every archetype had before this existed.
    pub chronotype_offset_ticks: i32,
    /// What this personality is like, for the New housemate form -
    /// [CS-personality]. Last, because it was appended. This text is
    /// presentation: no save stores it and the world hash does not read
    /// it, unlike the effects above, which saves store per person and the
    /// world hash covers.
    pub description: String,
}

/// One trait, compiled - [E3]. The kind-specific numbers live in an
/// enum so a disposition carrying a severity has no representation,
/// which is [D9] applied to the three-mechanisms split itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CompiledTraitKind {
    /// Weighs tagged candidates in scoring. Stateless.
    Disposition { score_multiplier: f32 },
    /// Gates tagged completions as may-attempt-may-fail. Practice from an
    /// attempt goes to the skill with the same tag, not to the trait -
    /// [SK-learning] in `docs/specs/2026-10-05-skills.md`.
    Capability {
        start_level: f32,
        fail_delta_scale: f32,
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
    /// One plain sentence for the Traits panel - [TL-description].
    /// It is in no save and not in the
    /// compatibility digest, so rewording it costs nothing.
    pub description: String,
    /// Initial satisfaction bias, applied only when a Sim is created.
    /// Appended for the compiled pack's field order; absent TOML values are zero.
    pub starting_satisfaction_offset: f32,
}

/// One skill, compiled - [SK-model] in `docs/specs/2026-10-05-skills.md`.
/// `tag` stays a string for the reason [`CompiledTrait::tag`] does.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledSkill {
    pub id: String,
    pub label: String,
    /// One plain sentence for the UI. In no save and not in the content
    /// fingerprint.
    pub description: String,
    pub tag: String,
    /// Rungs on the ladder, from 1 to 100.
    pub levels: u8,
    /// Practice one completed tagged attempt adds, in `(0, 1]`.
    pub practice_per_attempt: f32,
}

/// How an affinity kind reaches people - [OA-kinds] in
/// `docs/specs/2026-10-06-object-affinities.md`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AffinityReach {
    /// The kind's objects in the room move mood ([OA-presence]).
    Presence,
    /// Somebody else using one of the kind's objects bothers a person who
    /// hates the kind ([OA-use]).
    Use,
}

/// One kind of thing a person can love or hate, compiled - [OA-kinds]. Its
/// place in [`ContentPack::affinities`] is the place of its value in every
/// person's list; a save names it by `id`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledAffinityKind {
    pub id: String,
    /// What a player reads, in lower case so it fits inside a sentence.
    pub label: String,
    pub reach: AffinityReach,
    /// Indices into `ContentPack::objects`, ascending, none repeated.
    pub objects: Vec<u32>,
    /// The activity tag whose disposition traits set the starting value.
    pub trait_tag: Option<String>,
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
    /// The colourways any placed object can be drawn in, in content order -
    /// [RC-content] in `docs/specs/2026-09-22-colourways.md`. Empty in most
    /// test packs; when present, the first is the art as drawn. Appended at
    /// the pack tail.
    pub colourways: Vec<CompiledColourway>,
    /// The floor coverings the player may choose, in content order -
    /// [FL-content] in `docs/specs/2026-09-22-floors.md`. A covering's id is
    /// its place here counted from 1, and 0 is "no choice", the tile drawn
    /// by where it is ([OS-yard]). Appended at the pack tail, so every
    /// established block keeps its byte offset.
    pub coverings: Vec<CompiledCovering>,
    /// The skills a person practises, in content order - [SK-content] in
    /// `docs/specs/2026-10-05-skills.md`. Empty in most test packs. Saves
    /// name a skill by id, and the content fingerprint does not read this.
    /// It was last until the affinity kinds arrived.
    pub skills: Vec<CompiledSkill>,
    /// The kinds of thing a person can love or hate, in content order -
    /// [OA-kinds] in `docs/specs/2026-10-06-object-affinities.md`. Every
    /// person's affinity values are listed in this order. Empty in most test
    /// packs, and the content fingerprint does not read this. Appended at
    /// the pack tail.
    pub affinities: Vec<CompiledAffinityKind>,
    pub books: Vec<crate::books::BookDefinition>,
    pub reading: Option<crate::books::ReadingTuning>,
    /// The career paths every job belongs to (issue 249). Appended at the
    /// pack tail; a pack from before paths reconstructs one path per job.
    pub career_paths: Vec<CompiledCareerPath>,
    /// The monthly bills (issue 298, [WB-tuning]). Appended after the career
    /// paths, the pack's last field until then.
    pub bills: BillsTuning,
}

/// One colourway, validated. Its index is what a command and the render
/// buffer carry; its id is what a save records.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledColourway {
    pub id: String,
    pub name: String,
    /// Degrees the art's hues turn.
    pub hue: f32,
    /// How strongly the art's colours show, as a factor.
    pub strength: f32,
    /// A shift in lightness.
    pub lightness: f32,
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
    /// Activity metadata was appended after this field.
    pub sound_action: Option<CompiledSoundAction>,
    /// Optional authored activity indicator; excluded from save compatibility.
    pub activity: Option<CompiledActivity>,
    /// Use kinds charged once when this step starts its physical work, as
    /// indices into [`BillsTuning::uses`] ([WB-usage]). Ascending, none
    /// repeated. Appended last.
    pub bill_uses: Vec<u16>,
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
    /// The weekdays the shift runs, as a mask: bit 0 is Monday and bit 6
    /// is Sunday - [CAL-careers]. Never 0, and no bit above 6 is set.
    pub working_days: u8,
    /// Careers (issue 249): the path this job is a level of, as an index
    /// into `ContentPack::career_paths`, and which level it is, from 0.
    /// Appended after `working_days`, per the pack's compatibility rule;
    /// the fields after them follow in order.
    pub path: u32,
    pub level: u32,
    /// The most the job pays per shift after raises; at least `pay`.
    pub pay_max: u32,
    /// How many good weeks in a row a promotion out of this level needs.
    pub advance_weeks: u32,
    /// How far the work faces other people, 0 to 1 (the path's value).
    pub social_demand: f32,
    /// The skill tag the work reads, if any (the path's value).
    pub skill_tag: Option<String>,
    /// Trait index to fit weight, sorted by index (the path's values).
    pub trait_fit: Vec<(u32, f32)>,
    /// Shifts (issue 296, [WS-model] in
    /// `docs/specs/2026-10-18-shifts-and-careers.md`), appended per the
    /// pack's compatibility rule. The kind of this level's own shift, the
    /// standard shift, from 0 to 3, and its weight at this level.
    pub standard_kind: u8,
    pub standard_weight: u32,
    /// The path's other shifts this level names in its weights, including
    /// weight-0 entries, in the path's authored order. Shift index 0 is the
    /// standard shift and index `i` above 0 is `shifts[i - 1]`.
    pub shifts: Vec<CompiledShift>,
}

/// Shift kind numbers, in [`crate::schema::SHIFT_KIND_NAMES`] order.
pub const SHIFT_DAY: u8 = 0;
pub const SHIFT_EARLY: u8 = 1;
pub const SHIFT_LATE: u8 = 2;
pub const SHIFT_NIGHT: u8 = 3;

/// One of a path's other shifts as one level offers it ([WS-model]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledShift {
    pub id: String,
    /// From 0 to 3, per [`SHIFT_DAY`] and the constants after it.
    pub kind: u8,
    pub shift_start: u32,
    pub shift_ticks: u32,
    /// The weekdays the shift runs, as a level's mask is.
    pub working_days: u8,
    /// Its weight at this level, 0 to 1000. 0 is never drawn or offered.
    pub weight: u32,
}

/// One shift of a level, standard or not, read through one shape so a
/// reader of a job's hours never cares which it is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShiftView<'a> {
    /// The shift's index at its level: 0 for the standard shift.
    pub index: usize,
    /// `standard` for the level's own shift.
    pub id: &'a str,
    pub kind: u8,
    pub shift_start: u32,
    pub shift_ticks: u32,
    pub working_days: u8,
    pub weight: u32,
}

impl ShiftView<'_> {
    /// Whether the shift runs on `weekday`, 0 (Monday) to 6 (Sunday), with
    /// the rule of [`CompiledCareer::works_on`].
    pub fn works_on(&self, weekday: u8) -> bool {
        works_on_mask(self.working_days, weekday)
    }
}

fn works_on_mask(mask: u8, weekday: u8) -> bool {
    weekday < terri_core::clock::WEEKDAY_COUNT && mask & (1 << weekday) != 0
}

/// One career path: its levels in order, as indices into `careers`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledCareerPath {
    pub id: String,
    pub label: String,
    pub levels: Vec<u32>,
}

impl CompiledCareer {
    /// Whether the shift runs on `weekday`, 0 (Monday) to 6 (Sunday), as
    /// `terri_core::clock::weekday` returns it. Any larger weekday is no
    /// working day, whatever the mask's spare bit holds; the clock never
    /// returns one.
    pub fn works_on(&self, weekday: u8) -> bool {
        works_on_mask(self.working_days, weekday)
    }

    /// How many shifts this level lists: the standard shift and its others.
    pub fn shift_count(&self) -> usize {
        1 + self.shifts.len()
    }

    /// The shift at `index`: 0 is the standard shift, `i` above 0 is
    /// `shifts[i - 1]`, and anything past the list is `None`.
    pub fn shift(&self, index: usize) -> Option<ShiftView<'_>> {
        if index == 0 {
            return Some(ShiftView {
                index,
                id: crate::schema::STANDARD_SHIFT_ID,
                kind: self.standard_kind,
                shift_start: self.shift_start,
                shift_ticks: self.shift_ticks,
                working_days: self.working_days,
                weight: self.standard_weight,
            });
        }
        self.shifts.get(index - 1).map(|shift| ShiftView {
            index,
            id: &shift.id,
            kind: shift.kind,
            shift_start: shift.shift_start,
            shift_ticks: shift.shift_ticks,
            working_days: shift.working_days,
            weight: shift.weight,
        })
    }

    /// The index of the shift named `id` at this level, `standard` being 0.
    pub fn shift_index(&self, id: &str) -> Option<usize> {
        if id == crate::schema::STANDARD_SHIFT_ID {
            return Some(0);
        }
        self.shifts
            .iter()
            .position(|shift| shift.id == id)
            .map(|position| position + 1)
    }

    /// Whether this level offers the shift at `index`: it exists and its
    /// weight is above 0.
    pub fn offers(&self, index: usize) -> bool {
        self.shift(index).is_some_and(|shift| shift.weight > 0)
    }
}

impl ContentPack {
    /// Panics on an id from a different pack. `ObjectDefId` is an index
    /// into *this* pack's `objects`, which is why nothing persists one;
    /// save files store the string id and call [`ContentPack::find`].
    pub fn object(&self, id: ObjectDefId) -> &CompiledObject {
        &self.objects[id.0 as usize]
    }

    /// Every object for sale, in pack order, with its price: the catalogue
    /// the Buy tool lists ([BM-shell]). One filter for every boundary export
    /// that lists it, so their rows cannot drift apart.
    pub fn catalogue(&self) -> impl Iterator<Item = (ObjectDefId, &CompiledObject, u32)> + '_ {
        self.objects
            .iter()
            .enumerate()
            .filter_map(|(index, object)| Some((ObjectDefId(index as u32), object, object.price?)))
    }

    /// The index of the affinity kind covering the object at index `object`
    /// in [`ContentPack::objects`], if any - [OA-kinds]. A linear search over
    /// a list of a handful of kinds; the compiler lets no object belong to
    /// two.
    pub fn affinity_kind_of(&self, object: u32) -> Option<u32> {
        self.affinities
            .iter()
            .position(|kind| kind.objects.contains(&object))
            .map(|kind| kind as u32)
    }

    pub fn find(&self, id: &str) -> Option<ObjectDefId> {
        self.objects
            .iter()
            .position(|o| o.id == id)
            .map(|i| ObjectDefId(i as u32))
    }

    /// The needs an object is good for, bit `i` for need index `i` - [CB-serves]
    /// in `docs/specs/2026-09-22-catalogue-browsing.md`: every need one of its
    /// own interactions advertises with a positive delta, and every need a
    /// chain advertises so, when the object offers the chain or one of the
    /// chain's steps takes a role the object has. The stove feeds nobody by
    /// itself; it serves hunger through Cook dinner.
    pub fn needs_served(&self, object: ObjectDefId) -> u32 {
        self.needs_served_with_role_filter(object, |_, _| true)
    }

    /// Runtime buying facts can exclude authored roles that station admission rejects.
    pub fn needs_served_with_role_filter(
        &self,
        object: ObjectDefId,
        usable_role: impl Fn(&CompiledChain, u32) -> bool,
    ) -> u32 {
        let definition = self.object(object);
        // A list names each need at most once, so its bits are joined with
        // `bitor` rather than `|`: any join of distinct bits gives the same
        // mask, and an operator here would be a mutant no input can kill.
        let served = |advertises: &[(u8, f32)]| {
            advertises
                .iter()
                .filter(|&&(_, delta)| delta > 0.0)
                .map(|&(need, _)| 1 << need)
                .fold(0, std::ops::BitOr::bitor)
        };
        let own = definition.interactions.iter().fold(0, |mask, interaction| {
            mask | served(&interaction.advertises)
                | if interaction.shared_activity.is_some()
                    && self.tuning.need_interactions.shared_social_per_tick > 0.
                {
                    1 << terri_core::NeedId::Social.index()
                } else {
                    0
                }
        });
        let own = own
            | if definition.seat_comfort_per_tick > 0. {
                1 << terri_core::NeedId::Comfort.index()
            } else {
                0
            };
        let chains = self
            .chains
            .iter()
            .filter(|chain| {
                chain.advertised_by == object
                    || chain.steps.iter().any(|step| {
                        definition.roles.contains(&step.role) && usable_role(chain, step.role)
                    })
            })
            .fold(0, |mask, chain| mask | served(&chain.advertises));
        own | chains
    }
}

impl CompiledInteraction {
    pub fn is_handwashing(&self) -> bool {
        self.activity == Some(CompiledActivity::WashingHands)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The needs mask with a bit for each named need.
    fn needs(names: &[&str]) -> u32 {
        names.iter().fold(0, |mask, name| {
            mask | 1 << terri_core::NeedId::from_name(name).unwrap().index()
        })
    }

    /// [CB-serves] in `docs/specs/2026-09-22-catalogue-browsing.md`.
    #[test]
    fn an_object_serves_its_own_needs_and_those_of_every_chain_it_stands_in() {
        let pack = crate::pack();
        let serves = |id: &str| pack.needs_served(pack.find(id).unwrap());
        assert_eq!(serves("bed"), needs(&["energy", "comfort"]));
        assert_eq!(serves("television"), needs(&["fun", "social"]));
        // Cook dinner advertises hunger and conditional company Social, and takes a fridge, a
        // prep surface, a hob and an eating surface.
        assert_eq!(serves("stove"), needs(&["hunger", "social"]));
        assert_eq!(serves("counter"), needs(&["hunger", "social"]));
        assert_eq!(serves("fridge"), needs(&["hunger", "social"]));
        // Chair-backed table sitting supplies comfort and social; prepared meals supply hunger.
        assert_eq!(
            serves("dining_table"),
            needs(&["hunger", "comfort", "social"])
        );
        // Sitting supplies comfort and reading supplies fun; dining eligibility is a separate role.
        assert_eq!(serves("chair"), needs(&["comfort", "fun", "social"]));
    }

    /// Only a positive delta serves a need: a zero or a cost does not, and a
    /// need two sources serve is still served.
    #[test]
    fn a_need_is_served_only_by_a_positive_delta_from_any_source() {
        let mut pack = crate::pack().clone();
        let bed = pack.find("bed").unwrap();
        let hygiene = terri_core::NeedId::from_name("hygiene").unwrap().index() as u8;
        let fun = terri_core::NeedId::from_name("fun").unwrap().index() as u8;
        let interaction = &mut pack.objects[bed.0 as usize].interactions[0];
        interaction.advertises.push((hygiene, 0.0));
        interaction.advertises.push((fun, -4.0));
        assert_eq!(pack.needs_served(bed), needs(&["energy", "comfort"]));
        // Two interactions on one object, and two chains, serving the same
        // needs.
        let second = pack.objects[bed.0 as usize].interactions[0].clone();
        pack.objects[bed.0 as usize].interactions.push(second);
        assert_eq!(pack.needs_served(bed), needs(&["energy", "comfort"]));
        pack.chains.push(pack.chains[0].clone());
        let stove = pack.find("stove").unwrap();
        assert_eq!(pack.needs_served(stove), needs(&["hunger", "social"]));
    }

    /// Review finding [H4] on the catalogue branch: an object that offers a
    /// chain serves its needs even when it takes none of the chain's steps,
    /// as the simulation counts the chain as something its advertiser offers.
    #[test]
    fn an_object_serves_the_needs_of_a_chain_it_offers() {
        let mut pack = crate::pack().clone();
        let bed = pack.find("bed").unwrap();
        assert!(pack.object(bed).roles.is_empty(), "the bed takes no step");
        let mut offered = pack.chains[0].clone();
        offered.advertised_by = bed;
        pack.chains.push(offered);
        assert_eq!(
            pack.needs_served(bed),
            needs(&["hunger", "energy", "comfort", "social"])
        );
    }

    fn interaction(id: &str) -> CompiledInteraction {
        CompiledInteraction {
            bill_uses: Vec::new(),
            media: None,
            recipe: None,
            book_reading: false,
            seat_use: Default::default(),
            completion_sound: None,
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
            shared_activity: None,
            activity: None,
        }
    }

    /// Non-square, with two walls declared out of sorted order and two
    /// placements whose object indices differ from their own positions
    /// in the list. Every one of those asymmetries exists so that a
    /// transposition, a reordering, or an index collapsed to zero is
    /// visible rather than hidden by a tidy fixture.
    fn a_lot() -> CompiledLot {
        CompiledLot {
            wall_edges: vec![],
            // Neither the lot's size nor the as-drawn look, so a round trip
            // that dropped either moves the equality below.
            house: (4, 3),
            yard_look: [70.0, 1.5, -0.05],
            street_look: [0.0, 0.2, -0.2],
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
            choice_comfort_temperature: 1.0,
            choice_exploration: 0.005,
            choice_comfort_exploration: 0.20,
            leisure_appeal: 0.12,
            survival_risk_penalty: 5.0,
            choice_probability_floor: 0.000000001,
            wander_pause_variance: 0.4,
            self_preservation_curve: [
                (0, 0.02),
                (5, 0.10),
                (30, 0.75),
                (50, 1.0),
                (70, 1.4),
                (100, 2.0),
            ],

            domestic: None,
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
            resale_fraction: 0.40625,
            housemate_name_max_chars: 23,
            housemate_max_traits: 5,
            interior_daylight_shade: 0.15625,
            daylight_reach_per_tile: 0.21875,
            death_after_ticks: 3600,
            death_warning_ticks: 600,
            grief_ticks: 12000,
            grief_min_score: 5.0,
            grief_max_score: 30.0,
            grief_min_ticks: 600,
            grief_hated_affinity: -0.5,
            mood_critical_need_level: 20.0,
            mood_low_need_level: 40.0,
            mood_needs_met_level: 70.0,
            mood_critical_need_penalty: 25.0,
            mood_low_need_penalty: 12.0,
            mood_needs_met_bonus: 20.0,
            mood_condition_penalty: 30.0,
            mood_relationship_strength: 15.0,
            mood_relationship_radius: 4.0,
            mood_relationship_min_affinity: 0.1,
            mood_condition_min_severity: 0.05,
            waiting_mood_min_penalty: 2.0,
            waiting_mood_max_penalty: 30.0,
            satisfaction_mood_neutral_band: 15.0,
            satisfaction_mood_per_tick: 0.025,
            social_unmet_need_penalty: 0.20,
            social_critical_need_penalty: 0.35,
            bathroom_privacy_penalty: 0.45,
            social_boundary_avoidance_cost: 0.01,
            shyness_annoyance_strength: 0.25,
            boundary_wander_reconsider_chance: 0.10,
            shyness_wander_reconsider_strength: 0.15,
            relationships: crate::RelationshipTuning::default(),
            skill_level_cost: 0.0859375,
            skill_level_growth: 1.34375,
            habituation_max: 3.25,
            overdoing_threshold: 1.125,
            overdoing_penalty: 17.5,
            sick_threshold: 2.75,
            sick_penalty: 22.5,
            first_weekday: 4,
            affinity_from_trait: 0.6875,
            affinity_presence_threshold: 0.296875,
            affinity_presence_points: 10.5,
            affinity_presence_extra_points: 3.125,
            affinity_presence_extra_cap: 27,
            affinity_use_points: 14.5,
            affinity_use_feeling_per_hour: 0.0234375,
            affinity_loves_from: 1.46875,
            affinity_hates_to: 0.28125,
            affinity_band_loves: 0.5625,
            affinity_band_likes: 0.1875,
            affinity_from_mild_trait: 0.34375,
            need_interactions: crate::NeedInteractionTuning::default(),
            hated_communal_chance: 0.359375,
            burn_chance_novice: 0.09375,
            burn_chance_master: 0.00390625,
            burnt_meal_mood_penalty: 9.5,
            burnt_meal_mood_ticks: 300,
            fight_affinity_threshold: -0.875,
            fight_chance_per_tick: 0.015625,
            fight_relationship_loss: 0.125,
            fight_mood_penalty: 11.5,
            fight_mood_ticks: 500,
            land_strip_depth: 7,
            land_price_cents: 12_345,
            land_price_step_cents: 21,
            career_review_noise: 8.5,
            career_poor_threshold: 38.0,
            career_good_threshold: 66.0,
            career_fire_base: 0.0625,
            career_demote_base: 0.125,
            career_promote_base: 0.25,
            career_raise_base: 0.1875,
            career_search_tick: 11,
            career_search_chance: 0.5,
            career_change_fit: -0.25,
            career_change_gap: 0.625,
            career_change_chance: 0.3125,
            career_satisfaction_rate: 3.5,
            career_job_misery: 34.0,
            career_job_joy: 67.0,
            career_misery_satisfaction: 0.75,
            career_mood_joy: 5.5,
            career_mood_misery: 7.5,
            career_mood_warned: 6.25,
            career_mood_promoted: 11.0,
            career_mood_raise: 7.75,
            career_mood_demoted: 12.25,
            career_mood_fired: 15.5,
            career_mood_promoted_ticks: 1500,
            career_mood_demoted_ticks: 2900,
            career_mood_fired_ticks: 5800,
            autonomy: None,
            weather: None,
            fight_grievance_ticks: 360,
            fight_history_ticks: 10080,
            fight_repeat_grievance_ticks: 1440,
            fight_mood_bad_multiplier: 2.0,
            fight_mood_good_multiplier: 0.25,
            fight_opinion_strength: 0.5,
            fight_severity_reference: 0.25,
            chore_fight_response_base: 0.80,
            chore_fight_response_ticks: 240,
            chore_fight_response_cleanliness: 0.20,
            chore_fight_response_responsibility: 0.10,
            chore_fight_response_commitment: 0.05,
            chore_fight_response_preference: 0.05,
            chore_fight_response_affinity: 0.05,
            chore_fight_response_mood: 0.05,
            chore_repair_base: 0.08,
            chore_repair_cleanliness: 0.04,
            fight_rules: FightRules::Attributed,
            meal_appreciation_gain: 0.0,
            shift_sleep_offset_day: 3,
            shift_sleep_offset_early: -61,
            shift_sleep_offset_late: 125,
            shift_sleep_offset_night: 655,
            career_search_temperature: 0.3125,
            night_shift_premium_percent: 17,
            days_per_season: 5,
            first_season: 2,
            season_yard_looks: [
                [0.5, 1.25, 0.03125],
                [-7.5, 0.875, 0.0625],
                [-40.5, 0.8125, -0.046875],
                [11.5, 0.375, 0.125],
            ],
        }
    }

    fn three_objects() -> ContentPack {
        ContentPack {
            books: Vec::new(),
            reading: None,
            career_paths: Vec::new(),
            bills: BillsTuning::shipped_without_usage(),
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
                        bill_daily: Vec::new(),
                        indoor_only: false,
                        default_interaction: 0,
                        cooking_front: None,
                        shelf_capacity: 0,
                        shelf_access: vec![],
                        metadata: None,
                        seats: vec![],
                        sleep_places: Vec::new(),
                        seat_comfort_per_tick: 0.,
                        id: (*id).to_string(),
                        name: id.to_uppercase(),
                        presentation: None,
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
                        price: None,
                    }
                })
                .collect(),
            sim_sprite: 1,
            lot: a_lot(),
            tuning: a_tuning(),
            personalities: vec![CompiledPersonality {
                cleanliness: 0.5,
                id: "the_settled".to_string(),
                // Pairwise distinct across BOTH arrays, so a round trip
                // that wrote satisfaction into drain's slot - or dropped
                // one array and duplicated the other - moves the equality
                // below ([L34]).
                drain: [1.5, 0.75, 1.0, 1.125, 0.875, 1.25, 0.9375],
                satisfaction: [0.5, 1.75, 2.0, 0.625, 1.375, 0.8125, 1.0625],
                dispositions: vec![(ObjectDefId(1), 0, 1.875), (ObjectDefId(2), 1, 0.25)],
                chronotype_offset_ticks: 0,
                description: "Sits down and stays down.".to_string(),
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
                bill_uses: Vec::new(),
                media: None,
                recipe: None,
                book_reading: false,
                seat_use: Default::default(),
                completion_sound: None,
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
                shared_activity: None,
                activity: None,
            }],
            // Three traits, one of each kind with pairwise-distinct
            // numbers, so a round trip that transposed two kinds' fields
            // or collapsed the enum to one variant moves the equality
            // ([L34]). The member above wears index 2, which is NOT the
            // list's first entry, pinning that indices ride rather than
            // being re-derived.
            traits: vec![
                CompiledTrait {
                    starting_satisfaction_offset: 0.0,
                    id: "gossip_hound".to_string(),
                    label: "Gossip hound".to_string(),
                    tag: "gossip".to_string(),
                    kind: CompiledTraitKind::Disposition {
                        score_multiplier: 1.375,
                    },
                    description: String::new(),
                },
                CompiledTrait {
                    starting_satisfaction_offset: 0.0,
                    id: "all_thumbs".to_string(),
                    label: "All thumbs".to_string(),
                    tag: "tinkering".to_string(),
                    kind: CompiledTraitKind::Capability {
                        start_level: 0.1875,
                        fail_delta_scale: 0.0625,
                    },
                    description: String::new(),
                },
                CompiledTrait {
                    starting_satisfaction_offset: 0.0,
                    id: "weary".to_string(),
                    label: "Weary".to_string(),
                    tag: "puttering".to_string(),
                    kind: CompiledTraitKind::Condition {
                        accrual_scale: 0.5625,
                        manage_per_completion: 0.015625,
                        start_severity: 0.6875,
                    },
                    description: String::new(),
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
                    working_days: 0b1100000,
                    path: 0,
                    level: 0,
                    pay_max: 95,
                    advance_weeks: 1,
                    social_demand: 0.0,
                    skill_tag: None,
                    trait_fit: vec![],
                    standard_kind: SHIFT_NIGHT,
                    standard_weight: 1,
                    shifts: Vec::new(),
                },
                CompiledCareer {
                    id: "clerk".to_string(),
                    label: "Clerk".to_string(),
                    shift_start: 6,
                    shift_ticks: 11,
                    pay: 140,
                    energy_cost: 17.25,
                    satisfaction: 0.375,
                    working_days: 0b0011111,
                    path: 1,
                    level: 0,
                    pay_max: 160,
                    advance_weeks: 3,
                    social_demand: 0.75,
                    skill_tag: Some("reading".to_string()),
                    trait_fit: vec![(0, 0.5), (2, -0.25)],
                    standard_kind: SHIFT_EARLY,
                    standard_weight: 7,
                    shifts: vec![CompiledShift {
                        id: "evenings".to_string(),
                        kind: SHIFT_LATE,
                        shift_start: 12,
                        shift_ticks: 4,
                        working_days: 0b0000110,
                        weight: 2,
                    }],
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
                        bill_uses: Vec::new(),
                        role: 1,
                        label: "Get ingredients".to_string(),
                        duration_ticks: 21,
                        tags: vec![],
                        yields: Some(1),
                        transforms: None,
                        consumes: None,
                        visual: None,
                        sound_action: None,
                        activity: None,
                    },
                    CompiledChainStep {
                        bill_uses: Vec::new(),
                        role: 0,
                        label: "Cook".to_string(),
                        duration_ticks: 63,
                        tags: vec!["cooking".to_string()],
                        yields: None,
                        transforms: Some((1, 0)),
                        consumes: None,
                        visual: None,
                        sound_action: Some(CompiledSoundAction::StoveCooking),
                        activity: None,
                    },
                    CompiledChainStep {
                        bill_uses: Vec::new(),
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
                        activity: None,
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
            colourways: vec![],
            coverings: Vec::new(),
            skills: vec![CompiledSkill {
                id: "tinkering".to_string(),
                label: "Tinkering".to_string(),
                description: "Making a broken thing go again.".to_string(),
                tag: "tinkering".to_string(),
                levels: 7,
                practice_per_attempt: 0.046875,
            }],
            // Both reaches, objects listed out of the fixture's object order
            // across the two kinds, and one trait tag, so a field dropped
            // from the encoding or an enum read as its neighbour fails the
            // round trip.
            affinities: vec![
                CompiledAffinityKind {
                    id: "cold_things".to_string(),
                    label: "cold things".to_string(),
                    reach: AffinityReach::Use,
                    objects: vec![0, 2],
                    trait_tag: Some("chilling".to_string()),
                },
                CompiledAffinityKind {
                    id: "beds".to_string(),
                    label: "beds".to_string(),
                    reach: AffinityReach::Presence,
                    objects: vec![1],
                    trait_tag: None,
                },
            ],
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
            bill_daily: Vec::new(),
            indoor_only: false,
            default_interaction: 0,
            cooking_front: None,
            shelf_capacity: 0,
            shelf_access: vec![],
            metadata: None,
            seats: vec![],
            sleep_places: Vec::new(),
            seat_comfort_per_tick: 0.,
            id: "thing".to_string(),
            name: "Thing".to_string(),
            presentation: None,
            sprite: 4,
            interactions: vec![],
            footprint: Footprint::SINGLE,
            roles: vec![],
            action_sockets: vec![],
            foreground_sprite,
            facing_sprites,
            facing_foreground_sprites,
            base_facing: Facing::SouthEast,
            price: None,
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

    /// [OA-kinds]: an object index maps to the kind that lists it, wherever
    /// in that kind's list it sits, and to nothing when no kind lists it. The
    /// fixture's first kind lists objects 0 and 2 and its second lists 1, so
    /// an answer of "the first kind" or "the object's own index" fails here.
    #[test]
    fn affinity_kind_of_finds_the_kind_listing_an_object() {
        let pack = three_objects();
        assert_eq!(pack.affinity_kind_of(0), Some(0));
        assert_eq!(pack.affinity_kind_of(1), Some(1));
        assert_eq!(pack.affinity_kind_of(2), Some(0));
        assert_eq!(pack.affinity_kind_of(3), None);
        let none = ContentPack {
            affinities: Vec::new(),
            ..three_objects()
        };
        assert_eq!(none.affinity_kind_of(0), None);
    }

    /// [CAL-careers]: `works_on` reads bit `weekday` of the mask, Monday
    /// first. Monday, Wednesday and Sunday are asymmetric under reversal, so
    /// a mask read from the wrong end fails here.
    #[test]
    fn works_on_reads_the_monday_first_mask() {
        let career = CompiledCareer {
            id: "odd_days".to_string(),
            label: "Odd days".to_string(),
            shift_start: 1,
            shift_ticks: 2,
            pay: 3,
            energy_cost: 4.0,
            satisfaction: 5.0,
            working_days: 0b1000101,
            path: 0,
            level: 0,
            pay_max: 3,
            advance_weeks: 1,
            social_demand: 0.0,
            skill_tag: None,
            trait_fit: vec![],
            standard_kind: SHIFT_DAY,
            standard_weight: 1,
            shifts: Vec::new(),
        };
        let worked: Vec<u8> = (0..7).filter(|day| career.works_on(*day)).collect();
        assert_eq!(worked, vec![0, 2, 6]);
    }

    /// A weekday past Sunday is no working day, even for a mask whose
    /// eighth bit is set: weekday 7 would read that bit, and weekday 200
    /// would overflow the shift and panic in a debug build.
    #[test]
    fn works_on_refuses_a_weekday_past_sunday() {
        let career = CompiledCareer {
            id: "every_bit".to_string(),
            label: "Every bit".to_string(),
            shift_start: 1,
            shift_ticks: 2,
            pay: 3,
            energy_cost: 4.0,
            satisfaction: 5.0,
            working_days: 0xFF,
            path: 0,
            level: 0,
            pay_max: 3,
            advance_weeks: 1,
            social_demand: 0.0,
            skill_tag: None,
            trait_fit: vec![],
            standard_kind: SHIFT_DAY,
            standard_weight: 1,
            shifts: Vec::new(),
        };
        assert!(!career.works_on(7));
        assert!(!career.works_on(200));
    }

    /// [WS-model]: index 0 reads the level's own fields as the standard
    /// shift, index `i` reads `shifts[i - 1]`, ids resolve both ways, and a
    /// weight-0 shift is listed but not offered.
    #[test]
    fn shift_index_zero_is_the_level_standard_shift() {
        let shift = |id: &str, kind: u8, start: u32, weight: u32| CompiledShift {
            id: id.to_string(),
            kind,
            shift_start: start,
            shift_ticks: 6,
            working_days: 0b0011000,
            weight,
        };
        let career = CompiledCareer {
            id: "porter".to_string(),
            label: "Porter".to_string(),
            shift_start: 2,
            shift_ticks: 9,
            pay: 3,
            energy_cost: 4.0,
            satisfaction: 5.0,
            working_days: 0b1000101,
            path: 0,
            level: 0,
            pay_max: 3,
            advance_weeks: 1,
            social_demand: 0.0,
            skill_tag: None,
            trait_fit: vec![],
            standard_kind: SHIFT_EARLY,
            standard_weight: 5,
            shifts: vec![
                shift("late", SHIFT_LATE, 11, 3),
                shift("retired", SHIFT_NIGHT, 15, 0),
            ],
        };
        assert_eq!(career.shift_count(), 3);
        assert_eq!(
            career.shift(0),
            Some(ShiftView {
                index: 0,
                id: "standard",
                kind: SHIFT_EARLY,
                shift_start: 2,
                shift_ticks: 9,
                working_days: 0b1000101,
                weight: 5,
            })
        );
        let late = career.shift(1).expect("the first listed shift");
        assert_eq!((late.index, late.id, late.kind), (1, "late", SHIFT_LATE));
        assert_eq!(
            (late.shift_start, late.shift_ticks, late.weight),
            (11, 6, 3)
        );
        assert!(late.works_on(3) && late.works_on(4) && !late.works_on(0));
        assert_eq!(career.shift(2).map(|view| view.id), Some("retired"));
        assert_eq!(career.shift(3), None);
        assert_eq!(career.shift_index("standard"), Some(0));
        assert_eq!(career.shift_index("late"), Some(1));
        assert_eq!(career.shift_index("retired"), Some(2));
        assert_eq!(career.shift_index("nights"), None);
        assert!(career.offers(0) && career.offers(1));
        assert!(!career.offers(2), "a weight-0 shift is held, not offered");
        assert!(!career.offers(3));
    }

    /// A new tuning knob belongs at the end of the serialized `Tuning`
    /// record, even when it is conceptually related to fields near the
    /// beginning. The two housemate limits ([CS-command]) are one-byte
    /// varints; `resale_fraction` ([SL-pay]) is the four bytes before them,
    /// and `wander_radius_tiles` the byte before that; the skill ladder
    /// ([SK-model]) is the eight bytes before the five overdoing knobs
    /// ([OD-content]), which are the twenty before `first_weekday`
    /// ([CAL-week]), the byte before the seven affinity knobs ([OA-values]),
    /// which are the twenty-five before the two trait bands ([TL-affinity]),
    /// the eight before the word bands and the mild trait value
    /// ([OA-hud], [OA-values]), the twelve before the need-interaction
    /// balance values, which precede the four bytes of
    /// `hated_communal_chance`, the fourteen of the burnt-meal knobs, the
    /// eighteen of the fight knobs, the four of the land knobs, the
    /// ninety-five of the career knobs and the fifty of the season knobs,
    /// followed by optional autonomy, the meal-appreciation float, the
    /// optional weather, the purposeful-fight knobs, the ten bytes of
    /// the shift knobs and the one-byte varint of the night premium
    /// ([WB-wages]); every established field stays put.
    #[test]
    fn the_appended_tuning_knobs_keep_their_slots() {
        let before = postcard::to_allocvec(&a_tuning()).expect("tuning must serialise");
        let changed = |after: Tuning| -> Vec<usize> {
            let after = postcard::to_allocvec(&after).expect("tuning must serialise");
            assert_eq!(before.len(), after.len());
            before
                .iter()
                .zip(&after)
                .enumerate()
                .filter_map(|(index, (left, right))| (left != right).then_some(index))
                .collect()
        };
        // Wages (issue 298): the night premium is the last byte, a varint
        // of 17, and moving it moves that byte alone.
        let premium = before.len() - 1;
        assert_eq!(before[premium], 17);
        assert_eq!(
            changed(Tuning {
                night_shift_premium_percent: 18,
                ..a_tuning()
            }),
            vec![premium]
        );
        // Shifts (issue 296): the five shift knobs are the ten bytes before
        // it, after the purposeful-fight knobs:
        // four zigzag varints (3 as 6, -61 as 121, 125 as 250 in two bytes
        // and 655 as 1310 in two bytes), then the search temperature's
        // four bytes.
        let shifts = premium - 10;
        assert_eq!(before[shifts..shifts + 6], [6, 121, 0xFA, 0x01, 0x9E, 0x0A]);
        assert_eq!(before[shifts + 6..premium], 0.3125f32.to_le_bytes());
        for (offset, after) in [
            (
                0,
                Tuning {
                    shift_sleep_offset_day: 4,
                    ..a_tuning()
                },
            ),
            (
                1,
                Tuning {
                    shift_sleep_offset_early: -62,
                    ..a_tuning()
                },
            ),
            (
                2,
                Tuning {
                    shift_sleep_offset_late: 126,
                    ..a_tuning()
                },
            ),
            (
                4,
                Tuning {
                    shift_sleep_offset_night: 656,
                    ..a_tuning()
                },
            ),
        ] {
            assert_eq!(
                changed(after),
                vec![shifts + offset],
                "shift offset {offset}"
            );
        }
        assert!(changed(Tuning {
            career_search_temperature: 0.375,
            ..a_tuning()
        })
        .iter()
        .all(|index| (shifts + 6..premium).contains(index)));
        // Autonomy, appreciation and weather follow the original season fields.
        let mut tail = Vec::new();
        macro_rules! tail_field {
            ($field:ident) => {
                tail.extend(postcard::to_allocvec(&a_tuning().$field).unwrap());
            };
        }
        tail_field!(fight_grievance_ticks);
        tail_field!(fight_history_ticks);
        tail_field!(fight_repeat_grievance_ticks);
        tail_field!(fight_mood_bad_multiplier);
        tail_field!(fight_mood_good_multiplier);
        tail_field!(fight_opinion_strength);
        tail_field!(fight_severity_reference);
        tail_field!(chore_fight_response_base);
        tail_field!(chore_fight_response_ticks);
        tail_field!(chore_fight_response_cleanliness);
        tail_field!(chore_fight_response_responsibility);
        tail_field!(chore_fight_response_commitment);
        tail_field!(chore_fight_response_preference);
        tail_field!(chore_fight_response_affinity);
        tail_field!(chore_fight_response_mood);
        tail_field!(chore_repair_base);
        tail_field!(chore_repair_cleanliness);
        tail_field!(fight_rules);
        let purposeful_start = shifts - tail.len();
        assert_eq!(&before[purposeful_start..shifts], tail);
        let historical_end = purposeful_start - 6;
        assert_eq!(before[purposeful_start - 1], 0);
        assert_eq!(
            &before[purposeful_start - 5..purposeful_start - 1],
            &0.0f32.to_le_bytes()
        );
        assert_eq!(
            changed(Tuning {
                meal_appreciation_gain: 0.1875,
                ..a_tuning()
            }),
            vec![purposeful_start - 3, purposeful_start - 2]
        );
        assert_eq!(before[historical_end], 0);
        // Seasons (issue 251): the three season knobs are the preceding fifty
        // bytes: the season length as a one-byte varint (5), the first
        // season as one raw byte (2), then the four yard looks as twelve
        // floats in season order, with no length prefix because the table
        // has a fixed size.
        let season = historical_end - 50;
        assert_eq!(before[season..season + 2], [5, 2]);
        assert_eq!(
            before[season + 2..historical_end],
            [
                0.5f32, 1.25, 0.03125, -7.5, 0.875, 0.0625, -40.5, 0.8125, -0.046875, 11.5, 0.375,
                0.125
            ]
            .into_iter()
            .flat_map(f32::to_le_bytes)
            .collect::<Vec<_>>()
        );
        assert_eq!(
            changed(Tuning {
                days_per_season: 6,
                ..a_tuning()
            }),
            vec![season],
            "season length"
        );
        assert_eq!(
            changed(Tuning {
                first_season: 3,
                ..a_tuning()
            }),
            vec![season + 1],
            "first season"
        );
        // Winter's lightness, the last float: 0.125 and 0.1875 differ only
        // in their third byte.
        let mut looks = a_tuning().season_yard_looks;
        looks[3][2] = 0.1875;
        assert_eq!(
            changed(Tuning {
                season_yard_looks: looks,
                ..a_tuning()
            }),
            vec![historical_end - 2],
            "winter lightness"
        );
        // Careers (issue 249): the twenty-six career knobs are the
        // ninety-five bytes before them: twenty-two floats, the search
        // tick (one byte at 11) and three tick knobs of two bytes each.
        let career = season - 95;
        assert_eq!(before[career..career + 4], 8.5f32.to_le_bytes());
        assert_eq!(before[season - 2..season], [0xA8, 0x2D]);
        assert_eq!(
            changed(Tuning {
                career_review_noise: 8.75,
                ..a_tuning()
            }),
            vec![career + 2],
            "career noise"
        );
        assert_eq!(
            changed(Tuning {
                career_mood_fired_ticks: 5801,
                autonomy: None,
                weather: None,
                ..a_tuning()
            }),
            vec![season - 2],
            "career fired ticks"
        );
        // Land expansion (issue 254): the three land knobs are the four
        // bytes before them, three varints: 7, then 12345 (0xB9 0x60),
        // then 21.
        let land = career - 4;
        assert_eq!(before[land..career], [7, 0xB9, 0x60, 21]);
        for (offset, after) in [
            (
                0,
                Tuning {
                    land_strip_depth: 8,
                    ..a_tuning()
                },
            ),
            (
                1,
                Tuning {
                    land_price_cents: 12_346,
                    ..a_tuning()
                },
            ),
            (
                3,
                Tuning {
                    land_price_step_cents: 22,
                    ..a_tuning()
                },
            ),
        ] {
            assert_eq!(changed(after), vec![land + offset], "land {offset}");
        }
        // Fights (issue 248): the five fight knobs are the eighteen bytes
        // before them, four floats in declaration order and the moodlet
        // duration as a two-byte varint (500 is 0xF4 0x03). Each changed
        // float differs from the fixture's only in its third byte.
        let fight = land - 18;
        assert_eq!(
            before[fight..fight + 16],
            [-0.875f32, 0.015625, 0.125, 11.5]
                .into_iter()
                .flat_map(f32::to_le_bytes)
                .collect::<Vec<_>>()
        );
        assert_eq!(before[fight + 16..land], [0xF4, 0x03]);
        for (offset, after) in [
            (
                2,
                Tuning {
                    fight_affinity_threshold: -0.8828125,
                    ..a_tuning()
                },
            ),
            (
                6,
                Tuning {
                    fight_chance_per_tick: 0.0234375,
                    ..a_tuning()
                },
            ),
            (
                10,
                Tuning {
                    fight_relationship_loss: 0.1328125,
                    ..a_tuning()
                },
            ),
            (
                14,
                Tuning {
                    fight_mood_penalty: 11.75,
                    ..a_tuning()
                },
            ),
            (
                16,
                Tuning {
                    fight_mood_ticks: 501,
                    ..a_tuning()
                },
            ),
        ] {
            assert_eq!(changed(after), vec![fight + offset], "fight {offset}");
        }
        // Burnt meals (issue 243): the four cooking knobs are the fourteen
        // bytes before them, three floats in declaration order and the
        // moodlet duration as a two-byte varint (300 is 0xAC 0x02). Each
        // changed float differs from the fixture's only in its third byte.
        let burn = fight - 14;
        assert_eq!(
            before[burn..burn + 12],
            [0.09375f32, 0.00390625, 9.5]
                .into_iter()
                .flat_map(f32::to_le_bytes)
                .collect::<Vec<_>>()
        );
        assert_eq!(before[burn + 12..fight], [0xAC, 0x02]);
        for (offset, after) in [
            (
                2,
                Tuning {
                    burn_chance_novice: 0.1015625,
                    ..a_tuning()
                },
            ),
            (
                6,
                Tuning {
                    burn_chance_master: 0.0048828125,
                    ..a_tuning()
                },
            ),
            (
                10,
                Tuning {
                    burnt_meal_mood_penalty: 9.75,
                    ..a_tuning()
                },
            ),
            (
                12,
                Tuning {
                    burnt_meal_mood_ticks: 301,
                    ..a_tuning()
                },
            ),
        ] {
            assert_eq!(changed(after), vec![burn + offset], "burn {offset}");
        }
        // Communal affinity (issue 257): the hated communal chance is the
        // four bytes before them, one float; a change differs from the
        // fixture's only in its third byte.
        let chance = burn - 4;
        assert_eq!(before[chance..burn], 0.359375f32.to_le_bytes());
        assert_eq!(
            changed(Tuning {
                hated_communal_chance: 0.390625,
                ..a_tuning()
            }),
            vec![chance + 2]
        );
        // The need-interaction balance values are the twelve bytes before
        // it, three floats in declaration order; the two word bands and the
        // mild trait value ([OA-hud], [OA-values]) are the twelve before
        // those. Each changed float differs from the fixture's only in its
        // third byte.
        let need_start = chance - 12;
        assert_eq!(
            &before[need_start..chance],
            [40.0f32, 2. / 90., 0.12]
                .into_iter()
                .flat_map(f32::to_le_bytes)
                .collect::<Vec<_>>()
        );
        let words = need_start - 12;
        let expected: Vec<u8> = [0.5625f32, 0.1875, 0.34375]
            .into_iter()
            .flat_map(f32::to_le_bytes)
            .collect();
        assert_eq!(before[words..need_start], expected);
        for (offset, after) in [
            (
                2,
                Tuning {
                    affinity_band_loves: 0.59375,
                    ..a_tuning()
                },
            ),
            (
                6,
                Tuning {
                    affinity_band_likes: 0.203125,
                    ..a_tuning()
                },
            ),
            (
                10,
                Tuning {
                    affinity_from_mild_trait: 0.359375,
                    ..a_tuning()
                },
            ),
        ] {
            assert_eq!(changed(after), vec![words + offset], "word {offset}");
        }
        // [TL-affinity]: the two trait bands are the eight bytes before them,
        // two floats in declaration order. Each changed float differs from
        // the fixture's only in its third byte.
        let bands = words - 8;
        let expected: Vec<u8> = [1.46875f32, 0.28125]
            .into_iter()
            .flat_map(f32::to_le_bytes)
            .collect();
        assert_eq!(before[bands..words], expected);
        for (offset, after) in [
            (
                2,
                Tuning {
                    affinity_loves_from: 1.53125,
                    ..a_tuning()
                },
            ),
            (
                6,
                Tuning {
                    affinity_hates_to: 0.3125,
                    ..a_tuning()
                },
            ),
        ] {
            assert_eq!(changed(after), vec![bands + offset], "band {offset}");
        }
        // [OA-values], [OA-presence], [OA-use]: the seven affinity knobs, in
        // declaration order, are the twenty-five bytes before the bands:
        // four floats, the cap as a one-byte varint, and two more floats.
        // Each changed float differs from the fixture's only in its third
        // byte.
        let affinity = bands - 25;
        let expected: Vec<u8> = [0.6875f32, 0.296875, 10.5, 3.125]
            .into_iter()
            .flat_map(f32::to_le_bytes)
            .chain([27])
            .chain([14.5f32, 0.0234375].into_iter().flat_map(f32::to_le_bytes))
            .collect();
        assert_eq!(before[affinity..bands], expected);
        for (offset, after) in [
            (
                2,
                Tuning {
                    affinity_from_trait: 0.71875,
                    ..a_tuning()
                },
            ),
            (
                6,
                Tuning {
                    affinity_presence_threshold: 0.3125,
                    ..a_tuning()
                },
            ),
            (
                10,
                Tuning {
                    affinity_presence_points: 11.5,
                    ..a_tuning()
                },
            ),
            (
                14,
                Tuning {
                    affinity_presence_extra_points: 3.375,
                    ..a_tuning()
                },
            ),
            (
                16,
                Tuning {
                    affinity_presence_extra_cap: 28,
                    ..a_tuning()
                },
            ),
            (
                19,
                Tuning {
                    affinity_use_points: 15.5,
                    ..a_tuning()
                },
            ),
            (
                23,
                Tuning {
                    affinity_use_feeling_per_hour: 0.02734375,
                    ..a_tuning()
                },
            ),
        ] {
            assert_eq!(changed(after), vec![affinity + offset], "{offset}");
        }
        // [CAL-week]: `first_weekday` is a u8, so it is one raw byte, just
        // before the affinity knobs.
        let weekday = affinity - 1;
        assert_eq!(before[weekday], 4);
        assert_eq!(
            changed(Tuning {
                first_weekday: 6,
                ..a_tuning()
            }),
            vec![weekday]
        );
        // The overdoing knobs, in declaration order. Each changed value
        // differs from the fixture's only in its third byte.
        let overdoing = weekday - 20;
        let expected: Vec<u8> = [3.25f32, 1.125, 17.5, 2.75, 22.5]
            .into_iter()
            .flat_map(f32::to_le_bytes)
            .collect();
        assert_eq!(before[overdoing..weekday], expected);
        for (slot, after) in [
            Tuning {
                habituation_max: 3.75,
                ..a_tuning()
            },
            Tuning {
                overdoing_threshold: 1.25,
                ..a_tuning()
            },
            Tuning {
                overdoing_penalty: 18.5,
                ..a_tuning()
            },
            Tuning {
                sick_threshold: 2.25,
                ..a_tuning()
            },
            Tuning {
                sick_penalty: 23.5,
                ..a_tuning()
            },
        ]
        .into_iter()
        .enumerate()
        {
            assert_eq!(changed(after), vec![overdoing + 4 * slot + 2], "{slot}");
        }
        // 0.0859375 and 0.09375 differ only in their third byte, as do
        // 1.34375 and 1.40625.
        let ladder = overdoing - 8;
        assert_eq!(before[ladder..ladder + 4], 0.0859375f32.to_le_bytes());
        assert_eq!(before[ladder + 4..overdoing], 1.34375f32.to_le_bytes());
        assert_eq!(
            changed(Tuning {
                skill_level_cost: 0.09375,
                ..a_tuning()
            }),
            vec![ladder + 2]
        );
        assert_eq!(
            changed(Tuning {
                skill_level_growth: 1.40625,
                ..a_tuning()
            }),
            vec![ladder + 6]
        );
        let old_end = ladder - 35;
        // [OS-daylight]: the two daylight floats precede mortality; 0.21875
        // and 0.15625 are 0, 0, 96, 62 and 0, 0, 32, 62, and a change of
        // either to 0.28125 or 0.34375 moves only its third byte.
        let mood_bytes: Vec<_> = [
            20.0_f32, 40.0, 70.0, 25.0, 12.0, 20.0, 30.0, 15.0, 4.0, 0.1, 0.05, 2.0, 30.0, 15.0,
            0.025,
        ]
        .into_iter()
        .flat_map(f32::to_le_bytes)
        .collect();
        assert_eq!(&before[old_end - 146..old_end - 86], mood_bytes);
        let penalty_bytes: Vec<_> = [0.20_f32, 0.35, 0.45]
            .into_iter()
            .flat_map(f32::to_le_bytes)
            .collect();
        assert_eq!(&before[old_end - 28..old_end - 16], penalty_bytes);
        let len = old_end - 20 - 60 - 28 - 58;
        assert_eq!(
            before[len..len + 20],
            [144, 28, 216, 4, 224, 93, 0, 0, 160, 64, 0, 0, 240, 65, 216, 4, 0, 0, 0, 191]
        );
        assert_eq!(before[len - 8..len], [0, 0, 32, 62, 0, 0, 96, 62]);
        assert_eq!(
            changed(Tuning {
                daylight_reach_per_tile: 0.34375,
                ..a_tuning()
            }),
            vec![len - 2]
        );
        assert_eq!(
            changed(Tuning {
                interior_daylight_shade: 0.28125,
                ..a_tuning()
            }),
            vec![len - 6]
        );
        let before_daylight = len - 8;
        assert_eq!(
            changed(Tuning {
                housemate_max_traits: 6,
                ..a_tuning()
            }),
            vec![before_daylight - 1]
        );
        assert_eq!(
            changed(Tuning {
                housemate_name_max_chars: 24,
                ..a_tuning()
            }),
            vec![before_daylight - 2]
        );
        assert_eq!(before[before_daylight - 2..before_daylight], [23, 5]);
        let end = before_daylight - 2;
        // 0.40625 and 0.46875 differ only in their top two bytes.
        assert_eq!(
            changed(Tuning {
                resale_fraction: 0.46875,
                ..a_tuning()
            }),
            vec![end - 2]
        );
        assert_eq!(before[end - 4..end], 0.40625f32.to_le_bytes());
        assert_eq!(
            changed(Tuning {
                wander_radius_tiles: 31,
                ..a_tuning()
            }),
            vec![end - 5]
        );
        assert_eq!(before[end - 5], 29);
    }

    /// Pins both the appended chain-step field and the append-only enum
    /// discriminants. A round trip alone would accept a writer and reader that
    /// reordered the same variants together. The compiled pack is embedded by
    /// the same build that decodes it; persisted worlds use separate save DTOs.
    #[test]
    fn a_chain_step_visual_has_stable_postcard_bytes() {
        let step = CompiledChainStep {
            bill_uses: Vec::new(),
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
            activity: None,
        };

        assert_eq!(
            postcard::to_allocvec(&step).expect("chain step must serialise"),
            // Visual socket `None` is followed by Some and enum discriminant
            // 1 for the appended StoveCooking sound action. The next zero is
            // the independently authored activity's None value, and the last
            // is the empty usage list appended for bills (issue 298).
            vec![7, 3, 69, 97, 116, 42, 0, 0, 0, 1, 4, 1, 1, 2, 0, 0, 1, 1, 0, 0]
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
        let toilet = CompiledVisual {
            action: CompiledVisualAction::UseToilet,
            anchor: CompiledVisualAnchor::ObjectSocket,
            facing: CompiledVisualFacing::Socket,
            socket: Some(0),
        };
        assert_eq!(
            postcard::to_allocvec(&toilet).unwrap(),
            vec![10, 3, 1, 1, 0]
        );
        let bath = CompiledVisual {
            action: CompiledVisualAction::Bathe,
            anchor: CompiledVisualAnchor::ObjectSocket,
            facing: CompiledVisualFacing::Socket,
            socket: Some(0),
        };
        assert_eq!(
            postcard::to_allocvec(&bath).unwrap(),
            vec![11, 3, 1, 1, 0],
            "Bathe must append after UseToilet without moving the socket contract"
        );
        let fetch = CompiledVisual {
            action: CompiledVisualAction::Fetch,
            anchor: CompiledVisualAnchor::Station,
            facing: CompiledVisualFacing::TowardAnchor,
            socket: None,
        };
        assert_eq!(
            postcard::to_allocvec(&fetch).unwrap(),
            vec![12, 2, 0, 0],
            "Fetch must append after Bathe without moving the station contract"
        );
    }
}
