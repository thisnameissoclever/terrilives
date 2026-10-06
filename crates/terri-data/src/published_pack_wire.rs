//! Frozen published pack wire records used only to expand the immutable byte witness.
use crate::pack::*;
use serde::{Deserialize, Serialize};
use terri_core::NEED_COUNT;

#[derive(Serialize, Deserialize)]
pub struct PublishedCompiledInteraction {
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
    /// are last now, for the appending reason on [`PublishedContentPack::lot`].
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
}

#[derive(Serialize, Deserialize)]
pub struct PublishedCompiledObject {
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
    pub interactions: Vec<PublishedCompiledInteraction>,
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
    /// appending reason on [`PublishedContentPack::lot`]: the pack's byte encoding
    /// grows by appending, so an object's sprite and interaction blocks
    /// keep their offsets and the golden vector in `compile.rs` stays
    /// reviewable against the annotations it already carries. It is
    /// deliberately NOT grouped beside `sprite`, which would also be the
    /// wrong signal: [F1] exists to keep the drawn width and the occupied
    /// width separate facts.
    pub footprint: Footprint,
    /// The station roles this object serves in a chain, as indices
    /// into [`PublishedContentPack::roles`] - [K1]. Sorted, usually empty.
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
}

#[derive(Serialize, Deserialize)]
pub struct PublishedContentPack {
    pub decay_per_tick: [f32; NEED_COUNT],
    pub objects: Vec<PublishedCompiledObject>,
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
    pub social: Vec<PublishedCompiledInteraction>,
    /// The trait definitions household members index into - [E3]. May
    /// be empty in a test pack, like `social`. It was last until the
    /// career arrived.
    pub traits: Vec<CompiledTrait>,
    /// The careers household members index into - [E4], the [D15]
    /// Tier 2 rabbit hole. May be empty in a test pack. It was last
    /// until the chain trio below arrived.
    pub careers: Vec<CompiledCareer>,
    /// The station-role vocabulary, in first-appearance order across
    /// `objects.toml` - what `PublishedCompiledObject::roles` and
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
}

impl From<PublishedCompiledInteraction> for CompiledInteraction {
    fn from(old: PublishedCompiledInteraction) -> Self {
        Self {
            id: old.id,
            advertises: old.advertises,
            duration_ticks: old.duration_ticks,
            slots: old.slots,
            label: old.label,
            tags: old.tags,
            satisfaction: old.satisfaction,
            visual: old.visual,
            sound_action: old.sound_action,
            shared_activity: old.shared_activity,
            activity: old.activity,
            completion_sound: old.completion_sound,
            book_reading: false,
            seat_use: SeatUse::Exclusive,
            media: None,
            recipe: None,
        }
    }
}

impl From<PublishedCompiledObject> for CompiledObject {
    fn from(old: PublishedCompiledObject) -> Self {
        Self {
            id: old.id,
            name: old.name,
            sprite: old.sprite,
            interactions: old.interactions.into_iter().map(Into::into).collect(),
            footprint: old.footprint,
            roles: old.roles,
            action_sockets: old.action_sockets,
            foreground_sprite: old.foreground_sprite,
            facing_sprites: old.facing_sprites,
            facing_foreground_sprites: old.facing_foreground_sprites,
            base_facing: old.base_facing,
            price: old.price,
            presentation: old.presentation,
            sleep_places: old.sleep_places,
            metadata: None,
            seats: Vec::new(),
            shelf_capacity: 0,
            shelf_access: Vec::new(),
            cooking_front: None,
        }
    }
}

impl From<PublishedContentPack> for ContentPack {
    fn from(old: PublishedContentPack) -> Self {
        Self {
            decay_per_tick: old.decay_per_tick,
            objects: old.objects.into_iter().map(Into::into).collect(),
            sim_sprite: old.sim_sprite,
            lot: old.lot,
            tuning: old.tuning,
            personalities: old.personalities,
            household: old.household,
            social: old.social.into_iter().map(Into::into).collect(),
            traits: old.traits,
            careers: old.careers,
            roles: old.roles,
            item_kinds: old.item_kinds,
            chains: old.chains,
            circadian: old.circadian,
            sleep_tag: old.sleep_tag,
            voice_clips: old.voice_clips,
            portals: old.portals,
            colourways: old.colourways,
            coverings: old.coverings,
            skills: old.skills,
            affinities: old.affinities,
            books: Vec::new(),
            reading: None,
        }
    }
}
