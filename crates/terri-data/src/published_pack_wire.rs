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
pub struct PublishedTuning {
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
}

impl From<PublishedTuning> for Tuning {
    fn from(old: PublishedTuning) -> Self {
        Self {
            action_threshold: old.action_threshold,
            choice_temperature: old.choice_temperature,
            idle_threshold: old.idle_threshold,
            wander_pause_ticks: old.wander_pause_ticks,
            wander_attempts: old.wander_attempts,
            habituation_per_use: old.habituation_per_use,
            habituation_decay_per_tick: old.habituation_decay_per_tick,
            habituation_floor: old.habituation_floor,
            duration_variance: old.duration_variance,
            min_interaction_ticks: old.min_interaction_ticks,
            rng_seed: old.rng_seed,
            max_queued_intents: old.max_queued_intents,
            max_queued_commands: old.max_queued_commands,
            need_bar_refresh_ms: old.need_bar_refresh_ms,
            contested_score_multiplier: old.contested_score_multiplier,
            relationship_gain_per_talk: old.relationship_gain_per_talk,
            relationship_decay_per_tick: old.relationship_decay_per_tick,
            relationship_delta_scale: old.relationship_delta_scale,
            hobby_multiplier: old.hobby_multiplier,
            neglect_floor: old.neglect_floor,
            at_work_decay_scale: old.at_work_decay_scale,
            neglect_bleed_per_tick: old.neglect_bleed_per_tick,
            day_ticks: old.day_ticks,
            asleep_decay_scale: old.asleep_decay_scale,
            wander_radius_tiles: old.wander_radius_tiles,
            resale_fraction: old.resale_fraction,
            housemate_name_max_chars: old.housemate_name_max_chars,
            housemate_max_traits: old.housemate_max_traits,
            interior_daylight_shade: old.interior_daylight_shade,
            daylight_reach_per_tile: old.daylight_reach_per_tile,
            death_after_ticks: old.death_after_ticks,
            death_warning_ticks: old.death_warning_ticks,
            grief_ticks: old.grief_ticks,
            grief_min_score: old.grief_min_score,
            grief_max_score: old.grief_max_score,
            grief_min_ticks: old.grief_min_ticks,
            grief_hated_affinity: old.grief_hated_affinity,
            mood_critical_need_level: old.mood_critical_need_level,
            mood_low_need_level: old.mood_low_need_level,
            mood_needs_met_level: old.mood_needs_met_level,
            mood_critical_need_penalty: old.mood_critical_need_penalty,
            mood_low_need_penalty: old.mood_low_need_penalty,
            mood_needs_met_bonus: old.mood_needs_met_bonus,
            mood_condition_penalty: old.mood_condition_penalty,
            mood_relationship_strength: old.mood_relationship_strength,
            mood_relationship_radius: old.mood_relationship_radius,
            mood_relationship_min_affinity: old.mood_relationship_min_affinity,
            mood_condition_min_severity: old.mood_condition_min_severity,
            waiting_mood_min_penalty: old.waiting_mood_min_penalty,
            waiting_mood_max_penalty: old.waiting_mood_max_penalty,
            satisfaction_mood_neutral_band: old.satisfaction_mood_neutral_band,
            satisfaction_mood_per_tick: old.satisfaction_mood_per_tick,
            choice_comfort_temperature: old.choice_comfort_temperature,
            choice_exploration: old.choice_exploration,
            choice_comfort_exploration: old.choice_comfort_exploration,
            leisure_appeal: old.leisure_appeal,
            survival_risk_penalty: old.survival_risk_penalty,
            choice_probability_floor: old.choice_probability_floor,
            wander_pause_variance: old.wander_pause_variance,
            self_preservation_curve: old.self_preservation_curve,
            social_unmet_need_penalty: old.social_unmet_need_penalty,
            social_critical_need_penalty: old.social_critical_need_penalty,
            bathroom_privacy_penalty: old.bathroom_privacy_penalty,
            social_boundary_avoidance_cost: old.social_boundary_avoidance_cost,
            shyness_annoyance_strength: old.shyness_annoyance_strength,
            boundary_wander_reconsider_chance: old.boundary_wander_reconsider_chance,
            shyness_wander_reconsider_strength: old.shyness_wander_reconsider_strength,
            relationships: old.relationships,
            domestic: old.domestic,
            skill_level_cost: old.skill_level_cost,
            skill_level_growth: old.skill_level_growth,
            habituation_max: old.habituation_max,
            overdoing_threshold: old.overdoing_threshold,
            overdoing_penalty: old.overdoing_penalty,
            sick_threshold: old.sick_threshold,
            sick_penalty: old.sick_penalty,
            first_weekday: old.first_weekday,
            affinity_from_trait: old.affinity_from_trait,
            affinity_presence_threshold: old.affinity_presence_threshold,
            affinity_presence_points: old.affinity_presence_points,
            affinity_presence_extra_points: old.affinity_presence_extra_points,
            affinity_presence_extra_cap: old.affinity_presence_extra_cap,
            affinity_use_points: old.affinity_use_points,
            affinity_use_feeling_per_hour: old.affinity_use_feeling_per_hour,
            affinity_loves_from: old.affinity_loves_from,
            affinity_hates_to: old.affinity_hates_to,
            affinity_band_loves: old.affinity_band_loves,
            affinity_band_likes: old.affinity_band_likes,
            affinity_from_mild_trait: old.affinity_from_mild_trait,
            need_interactions: crate::NeedInteractionTuning::default(),
        }
    }
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
    pub tuning: PublishedTuning,
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
            seat_comfort_per_tick: 0.,
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
            tuning: old.tuning.into(),
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

#[derive(Serialize, Deserialize)]
pub struct Published2fCompiledObject {
    pub legacy: PublishedCompiledObject,
    pub seat_comfort_per_tick: f32,
}
impl From<Published2fCompiledObject> for CompiledObject {
    fn from(old: Published2fCompiledObject) -> Self {
        let mut value: Self = old.legacy.into();
        value.seat_comfort_per_tick = old.seat_comfort_per_tick;
        value
    }
}
#[derive(Serialize, Deserialize)]
pub struct Published2fTuning {
    pub legacy: PublishedTuning,
    pub need_interactions: crate::NeedInteractionTuning,
}
impl From<Published2fTuning> for Tuning {
    fn from(old: Published2fTuning) -> Self {
        let mut value: Self = old.legacy.into();
        value.need_interactions = old.need_interactions;
        value
    }
}
#[derive(Serialize, Deserialize)]
pub struct Published2fContentPack {
    pub decay_per_tick: [f32; NEED_COUNT],
    pub objects: Vec<Published2fCompiledObject>,
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
    pub tuning: Published2fTuning,
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
    /// `objects.toml` - what `Published2fCompiledObject::roles` and
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
impl From<Published2fContentPack> for ContentPack {
    fn from(old: Published2fContentPack) -> Self {
        Self {
            decay_per_tick: old.decay_per_tick,
            objects: old.objects.into_iter().map(Into::into).collect(),
            sim_sprite: old.sim_sprite,
            lot: old.lot,
            tuning: old.tuning.into(),
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

#[test]
fn authentic_2f_pack_decodes_and_reencodes_exactly() {
    let bytes =
        include_bytes!("../../terri-wasm/tests/fixtures/published-2f319c3b/content-pack.postcard");
    let (wire, rest) = postcard::take_from_bytes::<Published2fContentPack>(bytes)
        .expect("authentic source layout");
    assert!(rest.is_empty());
    assert_eq!(postcard::to_allocvec(&wire).unwrap(), bytes);
    let old: ContentPack = wire.into();
    let compiled = crate::contextual_pre_books_pack();
    assert_eq!(
        postcard::to_allocvec(&old).unwrap(),
        postcard::to_allocvec(compiled).unwrap()
    );
}
