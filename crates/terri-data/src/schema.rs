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
/// The circadian rhythm: `[circadian]` in `content/tuning.toml`.
///
/// [ML-curve] and [ML-tag] in
/// `docs/specs/2026-08-03-muted-line-implementation.md`. Authored rather
/// than hardcoded for the same reason every other tuning number is: the
/// SHAPE of a day is a design question that wants iterating against
/// measured runs, not a recompile.
///
/// Optional, so a pack without one behaves exactly as it did before this
/// existed. That is what lets the feature land without every existing
/// test's tuning fixture having to grow a table it does not care about.
#[derive(Debug, Deserialize)]
pub struct CircadianFile {
    /// `(tick, multiplier)` control points over one day, interpolated
    /// linearly and wrapping from the last back to the first.
    ///
    /// Two forces, deliberately separate from the need system: this makes
    /// a bed more attractive at 23:00 than at 14:00 AT THE SAME ENERGY
    /// LEVEL, which is what makes sims go to bed rather than merely
    /// collapse when energy runs out.
    pub sleep_drive: Vec<(u32, f32)>,
    /// The energy level at or below which exhaustion starts accumulating.
    ///
    /// In the need range `[0, 100]`. A sim above it is merely tired and
    /// the curve alone decides when it sleeps.
    pub exhaustion_energy: f32,
    /// How many ticks at or below `exhaustion_energy` it takes to reach
    /// the full `exhaustion_bonus`.
    ///
    /// At least 1: the ramp divides by it.
    pub exhaustion_ramp_ticks: u32,
    /// How much the sleep drive is multiplied by, at most, once a sim has
    /// spent `exhaustion_ramp_ticks` at rock bottom.
    ///
    /// **This is what lets the curve be strong.** Without it the trough
    /// has to stay shallow enough that an exhausted sim will still go to
    /// bed at noon, which caps how much the rhythm can say. With it, the
    /// curve can refuse a mid-morning nap outright and still guarantee
    /// that a sim who has been on empty for long enough goes anyway.
    ///
    /// At least 1. Exactly 1 disables the ramp, which is the honest way
    /// back to a rhythm that is the clock and nothing else.
    pub exhaustion_bonus: f32,
}

#[derive(Debug, Deserialize)]
pub struct TuningFile {
    #[serde(default)]
    pub reading: Option<crate::books::ReadingTuning>,
    #[serde(default)]
    pub domestic: Option<crate::pack::DomesticTuning>,
    /// The circadian rhythm, optional so every existing tuning fixture
    /// still parses. See `CircadianFile`.
    #[serde(default)]
    pub circadian: Option<CircadianFile>,
    /// The activity tag that means SLEEPING. Objects already declare
    /// tags, so a bed needs no new field and one entry covers every
    /// bed-shaped route to sleeping.
    ///
    /// **Not inside `[circadian]`, and that is the point.** It started
    /// there and had to move: the rhythm ships switched off, so anything
    /// reading the tag through it would be dead in the shipped game.
    /// Three separate things now ask "is this sim asleep" - the drive
    /// that makes a bed attractive at night, the decay scale that slows
    /// the other needs, and the Zzz bubble - and a tag that means sleep
    /// is a fact about the vocabulary rather than a property of any one
    /// of them.
    pub sleep_tag: String,
    /// How fast needs decay while a sim is asleep, as a fraction of the
    /// usual rate. In `[0, 1]`; 1 restores the behaviour before this
    /// existed.
    ///
    /// The same shape and the same reasoning as `at_work_decay_scale`
    /// beside it. A sleeping sim is not eating, washing or using the
    /// bathroom, and draining it at the full rate makes eight hours in
    /// bed the most expensive thing it can do - so it wakes starving,
    /// filthy and desperate, having done the one thing the day was
    /// pushing it toward.
    pub asleep_decay_scale: f32,
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
    /// The highest habituation one use can reach - [OD-model] in
    /// `docs/specs/2026-10-06-overdoing-it.md`. Finite and above 1; the part
    /// above 1 is overdoing.
    pub habituation_max: f32,
    /// The habituation above which a repeated activity costs mood. Finite,
    /// at least 1 and below `habituation_max` - [OD-content].
    pub overdoing_threshold: f32,
    /// The mood an activity at `habituation_max` costs. Finite and not
    /// negative - [OD-content].
    pub overdoing_penalty: f32,
    /// The habituation on a food activity at which a person feels sick.
    /// Finite, above `overdoing_threshold` and at most `habituation_max` -
    /// [OD-content].
    pub sick_threshold: f32,
    /// The mood feeling sick costs. Finite and not negative - [OD-content].
    pub sick_penalty: f32,
    /// Seed for the simulation PRNG.
    pub rng_seed: u64,
    /// Maximum waiting player orders per sim; zero means unlimited.
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
    /// What every need's decay rate is multiplied by while a sim is
    /// `AtWork` ([X2]). In `[0, 1]`; 1 restores the void the career
    /// shipped with.
    pub at_work_decay_scale: f32,
    /// Satisfaction lost per neglected need per tick. Non-negative;
    /// 0 disables the bleed.
    pub neglect_bleed_per_tick: f32,
    /// Ticks in one simulated day - the clock careers schedule against
    /// ([E4]). At least 1; the shipped value makes a day a number a
    /// designer chose rather than a constant buried in a system.
    pub day_ticks: u32,
    /// The weekday of the first day, 0 (Monday) to 6 (Sunday) - [CAL-week]
    /// in `docs/specs/2026-10-06-calendar.md`.
    pub first_weekday: u8,
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
    /// The maximum Manhattan distance and walked path length of an idle
    /// wander, in tiles. In `1..=i32::MAX`; zero would reject every
    /// destination, while the upper bound keeps `2 * radius + 1`
    /// representable on 32-bit WebAssembly and in the simulation RNG's
    /// `u32` range.
    ///
    /// The authored TOML is key-addressed, but keeping new schema fields
    /// appended mirrors the compiled tuning record's wire-format discipline
    /// and makes reviews less error-prone.
    pub wander_radius_tiles: u32,
    /// What a sale pays back, as a fraction of the object's price, in
    /// `[0, 1]` - [SL-pay] in `docs/specs/2026-09-22-selling-furniture.md`.
    pub resale_fraction: f32,
    /// The two lines that choose a disposition trait's verb - [TL-affinity]
    /// in `docs/specs/2026-09-21-trait-library-and-traits-panel.md`. A
    /// multiplier at or above `affinity_loves_from` reads "Loves", above 1
    /// "Likes", below 1 "Dislikes", and at or below `affinity_hates_to`
    /// "Hates". The compiler holds each description to its verb. The
    /// simulation never reads either line, so neither is copied into the
    /// compiled pack.
    pub affinity_loves_from: f32,
    pub affinity_hates_to: f32,
    /// The most characters a new housemate's name may have - [CS-command] in
    /// `docs/specs/2026-09-22-create-a-sim.md`. From 1 to 256, so a name
    /// always fits the loader's limit on saved text.
    pub housemate_name_max_chars: u32,
    /// The most traits a new housemate may wear - [CS-command]. At least 1.
    pub housemate_max_traits: u32,
    /// How much of the day's light a tile the sky cannot reach loses at
    /// noon, in `[0, 1)` - [OS-daylight] in
    /// `docs/specs/2026-09-22-the-outside.md`.
    pub interior_daylight_shade: f32,
    /// How much sky exposure is lost for each tile the sky travels indoors,
    /// in `(0, 1]` - [OS-daylight]. Mortality fields follow, per the
    /// appending rule.
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
    /// The practice level 1 of every skill costs, finite and above 0 -
    /// [SK-model] in `docs/specs/2026-10-05-skills.md`.
    pub skill_level_cost: f32,
    /// What each later level costs, as a multiple of the one before; finite
    /// and at least 1, so a later level never costs less - [SK-model].
    pub skill_level_growth: f32,
    /// The starting value a disposition trait sets for its affinity kind, in
    /// `(0, 1]`: this for a trait that loves the kind, its negative for one
    /// that hates it - [OA-values] in
    /// `docs/specs/2026-10-06-object-affinities.md`.
    pub affinity_from_trait: f32,
    /// Below this magnitude an affinity value gives no moodlet, in `[0, 1)` -
    /// [OA-presence].
    pub affinity_presence_threshold: f32,
    /// The mood one object of a presence kind gives at a value of 1.0.
    /// Finite and not negative - [OA-presence].
    pub affinity_presence_points: f32,
    /// The mood each further object of the kind adds at 1.0, up to
    /// `affinity_presence_extra_cap`. Finite and not negative.
    pub affinity_presence_extra_points: f32,
    /// How many further objects count. Any value is legal, including 0.
    pub affinity_presence_extra_cap: u32,
    /// The mood each other person using a use kind costs at a value of -1.0.
    /// Finite and not negative - [OA-use].
    pub affinity_use_points: f32,
    /// How much a bothered person's feeling toward the user falls per game
    /// hour at -1.0. Finite and not negative - [OA-use].
    pub affinity_use_feeling_per_hour: f32,
    /// At or above this a value reads "Loves", at or below its negative
    /// "Hates" - [OA-hud]. Above `affinity_band_likes`, at most 1.
    pub affinity_band_loves: f32,
    /// At or above this a value reads "Likes", at or below its negative
    /// "Dislikes", and strictly between the two "Indifferent" - [OA-hud].
    /// Above 0.
    pub affinity_band_likes: f32,
    /// The starting value a disposition trait between the verb bands sets
    /// for its affinity kind: this for a trait that likes the kind, its
    /// negative for one that dislikes it - [OA-values]. Finite, above 0 and
    /// below `affinity_from_trait`.
    pub affinity_from_mild_trait: f32,
    #[serde(default)]
    pub relationships: crate::RelationshipTuning,
    #[serde(default)]
    pub need_interactions: crate::NeedInteractionTuning,
    /// Chance per contact minute that a communal activity pays its communal
    /// rate to a person toward a housemate they hate, at or below
    /// `grief_hated_affinity`; a refused minute pays the ordinary proximity
    /// rate with friction still suspended (communal affinity, issue 257).
    /// Finite, from 0 to 1. Required, like every other root knob.
    pub hated_communal_chance: f32,
    /// Chance that a meal burns as it leaves the hob, for a cook with no
    /// cooking practice (burnt meals, issue 243). Finite, from 0 to 1.
    pub burn_chance_novice: f32,
    /// The same chance at full cooking mastery. Finite, from 0 to
    /// `burn_chance_novice`.
    pub burn_chance_master: f32,
    /// How much a burnt meal lowers mood while its moodlet lasts. Finite and
    /// not negative.
    pub burnt_meal_mood_penalty: f32,
    /// How many ticks the Burnt dinner moodlet lasts. From 1 to a week.
    pub burnt_meal_mood_ticks: u32,
    /// The feeling at or below which a person may start a fight on their
    /// own (fights, issue 248). Finite, from -1 to 1.
    pub fight_affinity_threshold: f32,
    /// Chance, per idle tick and per grudge with a reason, that the fight
    /// starts. Finite, from 0 to 1.
    pub fight_chance_per_tick: f32,
    /// How much a finished fight lowers each side's feeling for the other.
    /// Finite, from 0 to 2.
    pub fight_relationship_loss: f32,
    /// How much a fight lowers mood while its moodlet lasts. Finite and
    /// not negative.
    pub fight_mood_penalty: f32,
    /// How many ticks the Had a fight moodlet lasts. From 1 to a week.
    pub fight_mood_ticks: u32,
    /// How deep a strip of bought land is, in tiles (land expansion, issue
    /// 254). From 1 to 100.
    pub land_strip_depth: u32,
    /// The price of a square of land before any was bought, in cents. At
    /// most a thousand million.
    pub land_price_cents: u32,
    /// How much every square already bought adds to the price of the next,
    /// in cents. At most a thousand million.
    pub land_price_step_cents: u32,
    // Careers (issue 249, `docs/specs/2026-10-17-careers.md` rule 17),
    // appended after the land knobs in this order.
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
    // Shifts (issue 296, `docs/specs/2026-10-18-shifts-and-careers.md`,
    // [WS-sleep] and [WS-search]), appended after the career knobs in this
    // order.
    /// Ticks added to the sleep rhythm while holding a day shift, -720 to 720.
    pub shift_sleep_offset_day: i32,
    /// Ticks added to the sleep rhythm while holding an early shift.
    pub shift_sleep_offset_early: i32,
    /// Ticks added to the sleep rhythm while holding a late shift.
    pub shift_sleep_offset_late: i32,
    /// Ticks added to the sleep rhythm while holding a night shift.
    pub shift_sleep_offset_night: i32,
    /// How far the job search spreads its choice of path over fit, 0 to 2;
    /// 0 is the best-fit search with no draw.
    pub career_search_temperature: f32,
    /// Optional extension; historical packs retain their existing wire records.
    #[serde(default)]
    pub autonomy: Option<crate::AutonomyTuning>,
    /// Opinion gain toward the cook after eating a shared portion, from 0 to 1.
    pub meal_appreciation_gain: f32,
    /// How many days each season lasts, at least 1 - [SEA-year] in
    /// `docs/specs/2026-10-17-seasons.md`.
    pub days_per_season: u32,
    /// The season of the first day, 0 (Spring) to 3 (Winter) - [SEA-year].
    pub first_season: u8,
    /// The yard grass's `[hue, strength, lightness]` change in each season,
    /// Spring first - [SEA-yard]. Authored as one table per season, named
    /// by [`SEASON_KEYS`], each with the three keys of [`SEASON_LOOK_KEYS`],
    /// and read by [`read_season_yard_looks`], which refuses a malformed
    /// table by name. The compile step holds each row to a lot look's
    /// ranges.
    #[serde(deserialize_with = "read_season_yard_looks")]
    pub season_yard_looks: [[f32; 3]; 4],
    /// Absent from historical content sources, which have no weather effects.
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
    /// How much more a shift of the night kind pays, in percent from 0 to
    /// 100 - [WB-wages] in `docs/specs/2026-10-18-wages-and-bills.md`.
    pub night_shift_premium_percent: u32,
    /// The household's monthly bills - [WB-tuning].
    pub bills: BillsTuningDef,
}

/// The `[bills]` section of `tuning.toml` - [WB-tuning] in
/// `docs/specs/2026-10-18-wages-and-bills.md`. Every key is required and an
/// unknown key is refused, so a misspelled charge cannot silently cost
/// nothing. Cent amounts are whole cents; a base charge is a whole month's
/// amount.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BillsTuningDef {
    /// Days in a billing month, from 1 to 365 ([WB-calendar]).
    pub days_per_month: u32,
    /// Days a bill may stay unpaid without a fee, counting the due day;
    /// below `days_per_month`.
    pub grace_days: u32,
    /// The daily late fee, in percent of the bill, from 0 to 100.
    pub late_fee_percent: u32,
    /// The most late fees a bill gathers, in percent of the bill, from 0 to
    /// 100.
    pub late_fee_cap_percent: u32,
    /// How much an overdue bill lowers every housemate's mood, finite and
    /// at least 0.
    pub overdue_mood: f32,
    pub rent_base_cents: i64,
    pub rent_indoor_tile_cents: i64,
    pub rent_outdoor_tile_cents: i64,
    pub electricity_base_cents: i64,
    pub water_base_cents: i64,
    pub transportation_base_cents: i64,
    pub commute_cents: i64,
    /// Usage kinds charged each time an action or chain step carrying them
    /// starts its physical work, by id ([WB-usage]).
    pub uses: BTreeMap<String, BillKindDef>,
    /// Usage kinds charged once a day for each placed object carrying them,
    /// by id ([WB-usage]).
    pub daily: BTreeMap<String, BillKindDef>,
}

/// One usage kind's row in `[bills.uses]` or `[bills.daily]`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BillKindDef {
    /// What the Bills panel calls the kind, 1 to 32 characters.
    pub label: String,
    /// Cents added to the water bill per use or per object-day.
    pub water_cents: i64,
    /// Cents added to the electricity bill per use or per object-day.
    pub electricity_cents: i64,
}

/// The seasons as `season_yard_looks` names them in `tuning.toml`, in the
/// order the year runs, which is the order the compiled tuning stores their
/// looks - [SEA-yard] in `docs/specs/2026-10-17-seasons.md`.
pub const SEASON_KEYS: [&str; terri_core::clock::SEASON_COUNT as usize] =
    ["spring", "summer", "autumn", "winter"];

/// The keys of one season's look, in the order the compiled tuning stores
/// its three numbers: a lot look's hue, strength and lightness ([OS-yard]).
pub const SEASON_LOOK_KEYS: [&str; 3] = ["hue", "strength", "lightness"];

/// Reads `season_yard_looks` into the compiled tuning's four rows, Spring
/// first - [SEA-yard].
///
/// Read by hand rather than derived so that every malformed shape is
/// refused with the season and the key named wherever one is at fault: a
/// season missing, a key
/// that is not a season, a season or the whole table written as anything
/// but a table, a look missing a key or carrying one it does not know, a
/// value that is not a number, and a TOML date or time in place of the
/// table, a look or a number. A derived reader names a missing or unknown
/// key but not the season it sits in, and a fixed-size list of rows would
/// drop a fifth row or a fourth number without a word.
/// A key given twice needs no check here: TOML refuses it before any value
/// is read.
fn read_season_yard_looks<'de, D>(deserializer: D) -> Result<[[f32; 3]; 4], D::Error>
where
    D: serde::Deserializer<'de>,
{
    deserializer.deserialize_map(SeasonYardLooks)
}

/// The one key of the map the `toml` crate hands a visitor for a TOML date,
/// time or date-time; the value under it is the date as text. The crate
/// keeps the name private (`toml_datetime`'s `FIELD`), so it is copied here
/// to report a date as a date rather than as a season or a key with this
/// name. The date tests in this module fail if a `toml` upgrade renames it.
const TOML_DATE_KEY: &str = "$__toml_private_datetime";

/// Visits `season_yard_looks`: one look per season, keyed by its name.
struct SeasonYardLooks;

impl<'de> serde::de::Visitor<'de> for SeasonYardLooks {
    type Value = [[f32; 3]; 4];

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str(
            "season_yard_looks as one table for each of spring, summer, autumn and \
             winter, each with a hue, a strength and a lightness",
        )
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: serde::de::MapAccess<'de>,
    {
        let mut looks = [None; 4];
        while let Some(key) = map.next_key::<String>()? {
            if key == TOML_DATE_KEY {
                return Err(serde::de::Error::custom(
                    "season_yard_looks is a date or time; it needs one table for each of \
                     spring, summer, autumn and winter, each with a hue, a strength \
                     and a lightness",
                ));
            }
            let Some(season) = SEASON_KEYS.iter().position(|name| *name == key) else {
                return Err(serde::de::Error::custom(format!(
                    "season_yard_looks has a look for `{key}`, which is not a season; \
                     the seasons are spring, summer, autumn and winter"
                )));
            };
            looks[season] = Some(map.next_value_seed(SeasonLook(SEASON_KEYS[season]))?);
        }
        let mut rows = [[0.0; 3]; 4];
        for ((row, look), season) in rows.iter_mut().zip(looks).zip(SEASON_KEYS) {
            *row = look.ok_or_else(|| {
                serde::de::Error::custom(format!(
                    "season_yard_looks has no look for {season}; it needs one for each \
                     of spring, summer, autumn and winter"
                ))
            })?;
        }
        Ok(rows)
    }
}

/// Reads one season's look, a table of hue, strength and lightness, naming
/// the season in every refusal.
struct SeasonLook(&'static str);

impl<'de> serde::de::DeserializeSeed<'de> for SeasonLook {
    type Value = [f32; 3];

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_map(self)
    }
}

impl<'de> serde::de::Visitor<'de> for SeasonLook {
    type Value = [f32; 3];

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(
            f,
            "season_yard_looks.{} as a table with a hue, a strength and a lightness",
            self.0
        )
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: serde::de::MapAccess<'de>,
    {
        let season = self.0;
        let mut look = [None; 3];
        while let Some(key) = map.next_key::<String>()? {
            if key == TOML_DATE_KEY {
                return Err(serde::de::Error::custom(format!(
                    "season_yard_looks.{season} is a date or time; a season's look is a table \
                     of hue, strength and lightness"
                )));
            }
            let Some(index) = SEASON_LOOK_KEYS.iter().position(|name| *name == key) else {
                return Err(serde::de::Error::custom(format!(
                    "season_yard_looks.{season} has an unknown key `{key}`; a season's \
                     look takes hue, strength and lightness"
                )));
            };
            look[index] = Some(map.next_value_seed(LookNumber {
                season,
                key: SEASON_LOOK_KEYS[index],
            })?);
        }
        let mut values = [0.0; 3];
        for ((value, given), key) in values.iter_mut().zip(look).zip(SEASON_LOOK_KEYS) {
            *value = given.ok_or_else(|| {
                serde::de::Error::custom(format!(
                    "season_yard_looks.{season} has no {key}; a season's look takes \
                     hue, strength and lightness"
                ))
            })?;
        }
        Ok(values)
    }
}

/// Reads one number of a season's look, naming the season and the key when
/// the value is not a number.
struct LookNumber {
    season: &'static str,
    key: &'static str,
}

impl<'de> serde::de::DeserializeSeed<'de> for LookNumber {
    type Value = f32;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_f32(self)
    }
}

impl<'de> serde::de::Visitor<'de> for LookNumber {
    type Value = f32;

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(
            f,
            "a number for season_yard_looks.{}.{}",
            self.season, self.key
        )
    }

    // The conversions serde's own `f32` reader makes: a TOML float narrows
    // to the nearest f32, and a whole number converts, so `hue = -20` reads
    // as -20.0 like every other look in the content.
    fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E> {
        Ok(value as f32)
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
        Ok(value as f32)
    }

    // A TOML date, time or date-time reaches a number as a one-key map; any
    // other table here is refused as the wrong type, as serde would.
    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: serde::de::MapAccess<'de>,
    {
        if map.next_key::<String>()?.as_deref() == Some(TOML_DATE_KEY) {
            return Err(serde::de::Error::custom(format!(
                "season_yard_looks.{}.{} is a date or time, not a number",
                self.season, self.key
            )));
        }
        Err(serde::de::Error::invalid_type(
            serde::de::Unexpected::Map,
            &self,
        ))
    }
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
    #[serde(default)]
    pub object: Vec<ObjectDef>,
    #[serde(default)]
    pub category: Vec<crate::hierarchy::CategoryDef>,
    #[serde(default)]
    pub object_type: Vec<crate::hierarchy::ObjectTypeDef>,
    #[serde(default)]
    pub action_template: Vec<crate::hierarchy::ActionTemplate>,
    #[serde(default)]
    pub model: Vec<crate::hierarchy::ModelDef>,
    /// The colourways any placed object can be drawn in - [RC-content] in
    /// `docs/specs/2026-09-22-colourways.md`. Absent means none.
    #[serde(default)]
    pub colourway: Vec<ColourwayDef>,
    /// The kinds of thing a person can love or hate, in file order -
    /// [OA-kinds] in `docs/specs/2026-10-06-object-affinities.md`. Absent
    /// means none.
    #[serde(default)]
    pub affinity: Vec<AffinityKindDef>,
}

/// One affinity kind: a name a player reads and the objects it covers -
/// [OA-kinds]. An object no kind lists carries no affinity.
#[derive(Debug, Clone, Deserialize)]
pub struct AffinityKindDef {
    /// What a save records for the kind.
    pub id: String,
    /// What a player reads, in lower case so it fits inside a sentence.
    pub label: String,
    /// `presence` (the objects in the room move mood) or `use` (somebody
    /// else using one bothers a person who hates the kind).
    pub reach: String,
    /// The object ids the kind covers: at least one, each covered by no
    /// other kind.
    pub objects: Vec<String>,
    /// The activity tag whose disposition traits set a strong starting
    /// value, if any.
    #[serde(default)]
    pub trait_tag: Option<String>,
}

/// One colourway: a colour shift the shader applies to an object's art.
#[derive(Debug, Clone, Deserialize)]
pub struct ColourwayDef {
    pub id: String,
    /// What the Colour list shows.
    pub name: String,
    /// Degrees the art's hues turn, from -180 to 180.
    pub hue: f32,
    /// How strongly the art's colours show, as a factor from 0 to 2.
    pub strength: f32,
    /// A shift in lightness, from -0.25 to 0.25.
    pub lightness: f32,
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
#[serde(deny_unknown_fields)]
pub struct ObjectDef {
    #[serde(default)]
    pub cooking_front: Option<(i32, i32)>,
    #[serde(default)]
    pub shelf_capacity: u16,
    #[serde(default)]
    pub shelf_access: Vec<(i32, i32)>,
    /// Filled by the hierarchy resolver; authored metadata is rejected.
    #[serde(skip)]
    pub metadata: Option<crate::pack::ModelMetadata>,
    #[serde(default)]
    pub seat: Vec<SeatDef>,
    /// The action a left click starts; the first action when absent.
    #[serde(default)]
    pub default_action: Option<String>,
    pub id: String,
    pub name: String,
    /// Type and flavor text, with `name` identifying the model when present.
    #[serde(default)]
    pub presentation: Option<crate::pack::ObjectPresentation>,
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
    /// Direction already represented by the definition's footprint, sockets and sprite.
    #[serde(default)]
    pub base_facing: Option<String>,
    /// Optional atlas layer drawn in front of bodies using this object.
    /// Resolved alongside `sprite`; absent preserves every existing object.
    #[serde(default)]
    pub foreground_sprite: Option<String>,
    /// What the Buy tool charges for one, in Funds - [BM-price]. Absent keeps
    /// the object out of the catalogue. Zero is refused: a free object is a
    /// statement nobody made on purpose.
    #[serde(default)]
    pub price: Option<u32>,
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
    /// Object-local presentation anchors. Most objects have none.
    /// Appended so existing authored objects remain valid unchanged.
    #[serde(default)]
    pub action_socket: Vec<ActionSocketDef>,
    /// Ordered sleeping-place access, in base-facing footprint coordinates.
    #[serde(default)]
    pub sleep_place: Vec<crate::pack::SleepPlaceAccess>,
    /// Comfort per occupied minute for seats without a standalone sitting action.
    #[serde(default)]
    pub seat_comfort_per_tick: f32,
    /// Daily usage kinds by id from `[bills.daily]` in `tuning.toml`: each
    /// placed object adds one of each to its month's bills every day
    /// ([WB-usage] in `docs/specs/2026-10-18-wages-and-bills.md`).
    #[serde(default)]
    pub bill_daily: Vec<String>,
    /// Whether every tile of the object must be inside an enclosed room
    /// when it is bought or moved ([WB-beds]).
    #[serde(default)]
    pub indoor_only: bool,
}

/// A named presentation point in object-local lot coordinates.
#[derive(Debug, Clone, Deserialize)]
pub struct ActionSocketDef {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub facing: String,
}

/// Physical occupancy and access, authored in base-facing coordinates.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SeatDef {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub facing: String,
    pub approaches: Vec<(i32, i32)>,
}

#[derive(Debug, Deserialize)]
pub struct InteractionDef {
    #[serde(default)]
    pub media: Option<crate::pack::MediaBehavior>,
    #[serde(default)]
    pub recipe: Option<crate::pack::RecipeDef>,
    #[serde(default)]
    pub book_reading: bool,
    #[serde(default)]
    pub seat_use: crate::pack::SeatUse,
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
    /// Optional authored body-presentation contract for this interaction.
    ///
    /// The three fields stay separate even though the first shipped
    /// vocabulary has one value for each. A later fight can share the
    /// partner anchor and facing rule without pretending its pose is talk,
    /// while object and chain-step actions use their own anchor vocabularies.
    /// Missing members remain visible to the compile step so it can report
    /// the exact incomplete contract instead of letting serde stop at a
    /// context-free missing-field error.
    #[serde(default)]
    pub visual: Option<VisualDef>,
    /// Optional authored object-audio category for this interaction.
    ///
    /// Strings remain at the authoring boundary so the compiler can name an
    /// unknown value beside the object and interaction that declared it.
    /// Social interactions share this schema type but may not declare this
    /// field because they have no SmartObject sound source.
    #[serde(default)]
    pub sound_action: Option<String>,
    #[serde(default)]
    pub shared_activity: Option<String>,
    /// Optional activity bubble identity, independent of body art and tags.
    /// Unknown values are reported with the owning content row by the compiler.
    #[serde(default)]
    pub activity: Option<String>,
    #[serde(default)]
    pub completion_sound: Option<String>,
    /// Use kinds by id from `[bills.uses]` in `tuning.toml`, each charged
    /// once when this action starts its physical work ([WB-usage]).
    #[serde(default)]
    pub bill_uses: Vec<String>,
}

/// Authored action-presentation metadata before validation.
///
/// Strings are deliberate at this boundary. Unknown vocabulary is a content
/// error that must name the owning object interaction, `social.toml`
/// interaction, or chain step; the compiled pack uses enums and cannot
/// represent an unknown value.
#[derive(Debug, Clone, Deserialize)]
pub struct VisualDef {
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub anchor: Option<String>,
    #[serde(default)]
    pub facing: Option<String>,
    /// Object-local socket id. Legal only for an object-socket action.
    #[serde(default)]
    pub socket: Option<String>,
}

/// Mirrors `content/lot.toml`: the size of the lot, its interior architecture,
/// and where each object stands.
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
    /// Interior boundaries, mutually exclusive with legacy wall tiles.
    #[serde(default)]
    pub wall_edge: Vec<WallEdgeDef>,
    /// [OS-grow] in `docs/specs/2026-09-22-the-outside.md`: the house's size,
    /// standing in the lot's north-west corner; every other tile is yard.
    /// Omitted, the house is the whole lot.
    #[serde(default)]
    pub house: Option<HouseDef>,
    /// [OS-yard]: the colour shift a yard tile's floor art is drawn under.
    /// Omitted, a yard tile is drawn as the floor is.
    #[serde(default)]
    pub yard: Option<LookDef>,
    /// [OS-street]: the colour shift a street tile's floor art is drawn under.
    /// Omitted, a street tile is drawn as the floor is.
    #[serde(default)]
    pub street: Option<LookDef>,
    /// [FL-content] in `docs/specs/2026-09-22-floors.md`: the coverings the
    /// Floors tool offers, in order. A covering's id is its place in this
    /// list counted from 1, so the list grows by appending.
    #[serde(default)]
    pub covering: Vec<CoveringDef>,
}

/// One floor covering the player can choose - [FL-content]: a plain name for
/// the tool and the colour shift its tiles are drawn under, with a
/// colourway's three numbers and ranges ([RC-shift]).
#[derive(Debug, Deserialize)]
pub struct CoveringDef {
    pub name: String,
    pub hue: f32,
    pub strength: f32,
    pub lightness: f32,
}

/// The house's size in tiles, from the lot's north-west corner - [OS-grow].
#[derive(Debug, Deserialize)]
pub struct HouseDef {
    pub width: u32,
    pub height: u32,
}

/// How a yard or street tile is drawn - [OS-yard], [OS-street]: a colour
/// shift with a colourway's three numbers and their ranges ([RC-shift]).
#[derive(Debug, Deserialize)]
pub struct LookDef {
    pub hue: f32,
    pub strength: f32,
    pub lightness: f32,
}

/// One interior boundary. Signed coordinates keep invalid negatives available
/// to the compiler's content-specific error reporting.
#[derive(Debug, Deserialize)]
pub struct WallEdgeDef {
    pub axis: terri_core::layout::EdgeAxis,
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub doorway: bool,
}

/// The front door tile. `i32` for the same reporting reason as
/// [`WallDef`]: a negative coordinate should reach the validator and be
/// named, not die as a serde type error.
#[derive(Debug, Deserialize)]
pub struct FrontDoorDef {
    pub x: i32,
    pub y: i32,
    /// Optional contract for an animated boundary portal and its landing.
    /// Coordinate-only doors remain valid for legacy lots and test fixtures.
    #[serde(default)]
    pub visual: Option<FrontDoorVisualDef>,
}

/// Authored boundary behavior and presentation for a front door.
///
/// `facing` uses the established isometric lot vocabulary (`SE`, `NW`, `SW`,
/// `NE`). `hinge` is `left` or `right` relative to that outward facing.
#[derive(Debug, Deserialize)]
pub struct FrontDoorVisualDef {
    pub facing: String,
    pub hinge: String,
    /// Optional cardinally adjacent approach and return landing.
    ///
    /// This coordinate changes routing and therefore participates in the
    /// save-content fingerprint. When omitted, compilation uses the neighbor
    /// opposite the outward facing. A side neighbor lets furnished boundary tiles keep their
    /// existing layout without confusing the landing with the door normal.
    #[serde(default)]
    pub entry: Option<PortalEntryDef>,
    pub frame_sprite: String,
    pub closed_sprite: String,
    pub ajar_sprite: String,
    pub open_sprite: String,
}

/// One walkable tile from which a Sim approaches or finishes crossing a portal.
#[derive(Debug, Deserialize)]
pub struct PortalEntryDef {
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
    #[serde(default = "default_cleanliness")]
    pub cleanliness: f32,
    pub id: String,
    /// Sleep-schedule displacement in ticks: negative is earlier, positive later.
    ///
    /// [ML-chrono], and the highest-value number in the feature. ONE
    /// curve for everyone puts the whole household in bed on the same
    /// tick, which reads as a screensaver rather than as a home. An early
    /// bird at -90 and a night owl at +180 is the difference between a
    /// house and a barracks.
    ///
    /// Defaulted, so an archetype that has no opinion about sleep does
    /// not have to say so.
    #[serde(default)]
    pub chronotype_offset_ticks: i32,
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
    /// What this personality is like, in a sentence or two the New
    /// housemate form prints beside its name - [CS-personality] in
    /// `docs/specs/2026-09-22-create-a-sim.md`. Defaulted so an archetype
    /// parses from its id alone; the compile step refuses it blank, as it
    /// refuses a blank trait description.
    #[serde(default)]
    pub description: String,
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
    /// Initial life-satisfaction bias in points. Combined biases stay within nine.
    #[serde(default)]
    pub starting_satisfaction_offset: f32,
    /// What the UI calls it. Required and non-blank: unlike an
    /// interaction label there is no id-shaped fallback that reads as
    /// anything but a bug in a trait list.
    pub label: String,
    /// One plain sentence saying what the trait does - [TL-description].
    /// Required and non-blank for the label's reason: the Traits panel
    /// prints it, and a blank line there reads as a bug.
    pub description: String,
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

/// Mirrors `content/skills.toml` - [SK-content] in
/// `docs/specs/2026-10-05-skills.md`. Defaulted so a project with no skills
/// parses, as a project with no traits does.
#[derive(Debug, Default, Deserialize)]
pub struct SkillsFile {
    #[serde(default)]
    pub skill: Vec<SkillDef>,
}

/// One skill: practice a person gains by doing tagged activities -
/// [SK-model]. Level and progress are derived from practice through the
/// ladder in `tuning.toml`, so nothing here names a cost.
#[derive(Debug, Deserialize)]
pub struct SkillDef {
    /// What a save names the skill by.
    pub id: String,
    /// What the UI calls it. Required and non-blank.
    pub label: String,
    /// One plain sentence saying what the skill is. Required and non-blank.
    pub description: String,
    /// The activity tag this skill keys on - the same tag space traits and
    /// hobbies use, resolved against the pack's activities at compile time.
    pub tag: String,
    /// How many levels the ladder has, from 1 to 100.
    pub levels: u8,
    /// How much practice one completed tagged attempt adds, pass or fail,
    /// in `(0, 1]`.
    pub practice_per_attempt: f32,
}

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
    /// Optional authored body-presentation contract for this step.
    ///
    /// Chain steps resolve a station at runtime, so their legal anchor
    /// vocabulary is validated separately from ordinary object interactions.
    /// It was last until the object-audio field below arrived.
    #[serde(default)]
    pub visual: Option<VisualDef>,
    /// Optional authored object-audio category for this running step.
    /// The resolved station becomes the exact sound source at runtime.
    #[serde(default)]
    pub sound_action: Option<String>,
    /// Activity shown while this exact station step is actively running.
    #[serde(default)]
    pub activity: Option<String>,
    /// Use kinds by id from `[bills.uses]` in `tuning.toml`, each charged
    /// once when this step starts its physical work ([WB-usage]).
    #[serde(default)]
    pub bill_uses: Vec<String>,
}

/// A `transforms` entry: what the carried item was, and what it
/// becomes.
#[derive(Debug, Deserialize)]
pub struct TransformDef {
    pub from: String,
    pub to: String,
}

/// Mirrors `content/careers.toml` - the rabbit-hole jobs of [E4] and
/// [D15] Tier 2: the sim leaves the lot and returns with an outcome.
#[derive(Debug, Deserialize)]
pub struct CareersFile {
    /// Defaulted so a project with no careers parses; a household
    /// member naming one that does not exist is the compile step's
    /// error.
    #[serde(default)]
    pub career: Vec<CareerDef>,
}

/// One career path: what the work is like and the levels it climbs
/// (`docs/specs/2026-10-17-careers.md`, rule 1).
#[derive(Debug, Deserialize)]
pub struct CareerDef {
    pub id: String,
    /// What the UI calls the path. Required and non-blank, like a trait's.
    pub label: String,
    /// How far the work faces other people, 0 to 1.
    #[serde(default)]
    pub social_demand: f32,
    /// The skill tag the work reads, if any.
    #[serde(default)]
    pub skill: Option<String>,
    /// Trait id to fit weight, -1 to 1: how much wearing the trait suits
    /// the work.
    #[serde(default)]
    pub traits: std::collections::BTreeMap<String, f32>,
    /// The kind of every level's own shift, by name from
    /// [`SHIFT_KIND_NAMES`]. Defaults to `day` ([WS-model] in
    /// `docs/specs/2026-10-18-shifts-and-careers.md`).
    #[serde(default = "default_standard_shift")]
    pub standard_shift: String,
    /// The path's other shifts, which a level offers by naming them in
    /// its `shift_weights`.
    #[serde(default)]
    pub shift: Vec<CareerShiftDef>,
    /// The titled levels, lowest first. At least one.
    #[serde(default)]
    pub level: Vec<CareerLevelDef>,
}

fn default_standard_shift() -> String {
    SHIFT_KIND_NAMES[0].to_string()
}

/// The four shift kinds, numbered in this order: day 0, early 1, late 2
/// and night 3 ([WS-model]).
pub const SHIFT_KIND_NAMES: [&str; 4] = ["day", "early", "late", "night"];

/// The shift id a level's `shift_weights` uses for the level's own shift.
/// No path shift may take it.
pub const STANDARD_SHIFT_ID: &str = "standard";

/// One of a path's other shifts ([WS-model]): validated as a level's own
/// shift is.
#[derive(Debug, Deserialize)]
pub struct CareerShiftDef {
    /// Unique within the path, never `standard`. A save names a held
    /// shift by this id, so content never deletes a shipped one; it sets
    /// its weight to 0 instead.
    pub id: String,
    /// The kind, by name from [`SHIFT_KIND_NAMES`].
    pub kind: String,
    /// The tick of day the shift begins, in `0..day_ticks`.
    pub shift_start: u32,
    /// How long the sim is gone, in ticks, from 1 to below `day_ticks`.
    pub shift_ticks: u32,
    /// The weekdays the shift runs, by name from [`WEEKDAY_NAMES`].
    pub working_days: Vec<String>,
}

/// One titled level of a path: a job. The shift fields are what a career
/// was before paths existed.
#[derive(Debug, Deserialize)]
pub struct CareerLevelDef {
    pub id: String,
    /// The job title the UI shows. Required and non-blank.
    pub title: String,
    /// The tick of day the shift begins, in `0..day_ticks`.
    pub shift_start: u32,
    /// How long the sim is gone, in ticks. At least 1.
    pub shift_ticks: u32,
    /// What one shift pays into the household's Funds when the job is
    /// taken, in whole dollars. Non-negative - v1 has no fines - and an
    /// i64 downstream because money will eventually be spent below zero
    /// of a PAYCHECK but never of the representable range.
    pub pay: u32,
    /// The most the job pays per shift after raises; at least `pay`.
    pub pay_max: u32,
    /// Energy the shift costs on return, in `0..=100`. The commute and
    /// the work happen off-lot, so the cost lands as one debit.
    pub energy_cost: f32,
    /// Satisfaction the shift pays (or costs nothing - zero is legal
    /// and is most jobs). Non-negative here: a job that actively
    /// drains a LIFE is a condition's business, not a paycheck's,
    /// which keeps [S1]'s writer list honest.
    pub satisfaction: f32,
    /// The weekdays the shift runs, by name from [`WEEKDAY_NAMES`]: at
    /// least one, none repeated - [CAL-careers] in
    /// `docs/specs/2026-10-06-calendar.md`. Required, with no default, so
    /// a career cannot quietly work a week nobody chose.
    pub working_days: Vec<String>,
    /// How many good weeks in a row a promotion out of this level needs;
    /// 1 to 52. Required, so a level cannot quietly promote after one
    /// good week nobody chose.
    pub advance_weeks: u32,
    /// Shift id to weight, 0 to 1000: how likely a hire at this level is
    /// to draw each shift. `standard` names the level's own shift; the
    /// other keys name the path's shifts. Absent means `{ standard = 1 }`.
    /// A weight of 0 is never drawn or offered but can still be held.
    #[serde(default)]
    pub shift_weights: Option<BTreeMap<String, u32>>,
}

/// The weekday names `working_days` accepts, Monday first. A name's index
/// is its weekday number and its bit in a compiled career's mask, and the
/// count is the clock's week.
pub const WEEKDAY_NAMES: [&str; terri_core::clock::WEEKDAY_COUNT as usize] =
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/// The M1 household ceiling. Kept beside the authored schema so content
/// validation, tests and any future household editor share one contract.
pub const MAX_HOUSEHOLD_SIZE: usize = 6;

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
    /// fixture predating M2c was written in. A playable household may hold
    /// at most [`MAX_HOUSEHOLD_SIZE`] members.
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
/// `assets/sprites/gen/build.py` rather than authored.
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

/// Mirrors `content/voice.toml` - the nonverbal clips a conversation is
/// built out of, [A-11].
///
/// Fewer than two entries is legal and means the pack has no voice: a
/// conversation then takes an ordinary sampled duration, which is what every
/// test fixture does and what the game did before the recordings existed.
#[derive(Debug, Deserialize)]
pub struct VoiceFile {
    pub clip: Vec<VoiceClipDef>,
}

/// One recorded clip.
///
/// **There is no duration field, and that is deliberate.** A clip's length
/// already exists, exactly, in the WAV file; writing it here as well would be
/// two copies of one fact, and the copies would drift the first time a clip
/// was re-cut. The build script reads the real length instead, so a clip that
/// does not exist aborts the build and a clip that changed length changes the
/// pack.
#[derive(Debug, Deserialize)]
pub struct VoiceClipDef {
    /// Names `web/public/audio/voice/<id>.wav` - the directory the browser
    /// is served from - and names the clip across the boundary.
    pub id: String,
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
    /// the definition's base direction. Direction controls geometry,
    /// action sockets and matching rendered layers.
    #[serde(default)]
    pub facing: Option<String>,
}

fn default_cleanliness() -> f32 {
    0.5
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The scalar knobs, with pairwise distinct values so that a
    /// field read off the wrong key is visible. Two knobs sharing a value
    /// would make a transposed pair of fields parse identically, which
    /// is [L34] in the tuning file's costume.
    ///
    /// The integer knobs are deliberately different numbers for the same
    /// reason, and every float is exact in binary32 so the assertions can be
    /// equalities rather than tolerances.
    const TUNING_LINES: [(&str, &str); 155] = [
        ("choice_comfort_temperature", "1.0"),
        ("choice_exploration", "0.005"),
        ("choice_comfort_exploration", "0.20"),
        ("leisure_appeal", "0.12"),
        ("survival_risk_penalty", "5.0"),
        ("choice_probability_floor", "0.000000001"),
        ("wander_pause_variance", "0.4"),
        (
            "self_preservation_curve",
            "[[0, 0.02], [5, 0.10], [30, 0.75], [50, 1.0], [70, 1.4], [100, 2.0]]",
        ),
        ("action_threshold", "0.25"),
        ("choice_temperature", "0.5"),
        ("idle_threshold", "0.125"),
        ("wander_pause_ticks", "9"),
        ("wander_attempts", "6"),
        ("duration_variance", "0.75"),
        ("habituation_per_use", "0.3125"),
        ("habituation_decay_per_tick", "0.0625"),
        ("habituation_floor", "0.625"),
        ("habituation_max", "3.25"),
        ("overdoing_threshold", "1.125"),
        ("overdoing_penalty", "17.5"),
        ("sick_threshold", "2.75"),
        ("sick_penalty", "22.5"),
        ("min_interaction_ticks", "3"),
        ("rng_seed", "300"),
        ("max_queued_intents", "7"),
        ("max_queued_commands", "11"),
        ("need_bar_refresh_ms", "13"),
        ("contested_score_multiplier", "0.375"),
        ("relationship_gain_per_talk", "0.4375"),
        ("meal_appreciation_gain", "0.01171875"),
        ("relationship_decay_per_tick", "0.001953125"),
        ("relationship_delta_scale", "0.875"),
        ("hated_communal_chance", "0.359375"),
        ("burn_chance_novice", "0.09375"),
        ("burn_chance_master", "0.00390625"),
        ("burnt_meal_mood_penalty", "9.5"),
        ("burnt_meal_mood_ticks", "300"),
        ("fight_affinity_threshold", "-0.875"),
        ("fight_chance_per_tick", "0.015625"),
        ("fight_relationship_loss", "0.125"),
        ("fight_mood_penalty", "11.5"),
        ("fight_mood_ticks", "500"),
        ("fight_grievance_ticks", "360"),
        ("fight_history_ticks", "10080"),
        ("fight_repeat_grievance_ticks", "1440"),
        ("fight_mood_bad_multiplier", "2.0"),
        ("fight_mood_good_multiplier", "0.25"),
        ("fight_opinion_strength", "0.5"),
        ("fight_severity_reference", "0.25"),
        ("chore_fight_response_base", "0.80"),
        ("chore_fight_response_ticks", "240"),
        ("chore_fight_response_cleanliness", "0.20"),
        ("chore_fight_response_responsibility", "0.10"),
        ("chore_fight_response_commitment", "0.05"),
        ("chore_fight_response_preference", "0.05"),
        ("chore_fight_response_affinity", "0.05"),
        ("chore_fight_response_mood", "0.05"),
        ("chore_repair_base", "0.08"),
        ("chore_repair_cleanliness", "0.04"),
        ("land_strip_depth", "7"),
        ("land_price_cents", "12345"),
        ("land_price_step_cents", "21"),
        ("career_review_noise", "9.5"),
        ("career_poor_threshold", "37.5"),
        ("career_good_threshold", "66.5"),
        ("career_fire_base", "0.09375"),
        ("career_demote_base", "0.140625"),
        ("career_promote_base", "0.234375"),
        ("career_raise_base", "0.171875"),
        ("career_search_tick", "12"),
        ("career_search_chance", "0.75"),
        ("career_change_fit", "-0.375"),
        ("career_change_gap", "0.5625"),
        ("career_change_chance", "0.28125"),
        ("career_satisfaction_rate", "4.5"),
        ("career_job_misery", "33.5"),
        ("career_job_joy", "67.5"),
        ("career_misery_satisfaction", "0.625"),
        ("career_mood_joy", "6.5"),
        ("career_mood_misery", "8.5"),
        ("career_mood_warned", "5.75"),
        ("career_mood_promoted", "12.5"),
        ("career_mood_raise", "7.25"),
        ("career_mood_demoted", "11.75"),
        ("career_mood_fired", "16.5"),
        ("career_mood_promoted_ticks", "1400"),
        ("career_mood_demoted_ticks", "2800"),
        ("career_mood_fired_ticks", "5700"),
        ("shift_sleep_offset_day", "-7"),
        ("shift_sleep_offset_early", "-65"),
        ("shift_sleep_offset_late", "115"),
        ("shift_sleep_offset_night", "655"),
        ("career_search_temperature", "0.3125"),
        ("night_shift_premium_percent", "17"),
        ("bills", BILLS),
        ("days_per_season", "9"),
        ("first_season", "3"),
        ("season_yard_looks", SEASON_YARD_LOOKS),
        ("hobby_multiplier", "2.5"),
        ("neglect_floor", "21.0"),
        ("at_work_decay_scale", "0.4"),
        ("neglect_bleed_per_tick", "0.0009765625"),
        ("day_ticks", "17"),
        ("first_weekday", "4"),
        ("asleep_decay_scale", "0.6"),
        ("wander_radius_tiles", "29"),
        ("resale_fraction", "0.40625"),
        ("affinity_loves_from", "1.46875"),
        ("affinity_hates_to", "0.28125"),
        ("housemate_name_max_chars", "23"),
        ("housemate_max_traits", "5"),
        ("interior_daylight_shade", "0.15625"),
        ("daylight_reach_per_tile", "0.21875"),
        ("death_after_ticks", "3600"),
        ("death_warning_ticks", "600"),
        ("grief_ticks", "12000"),
        ("grief_min_score", "5.0"),
        ("grief_max_score", "30.0"),
        ("grief_min_ticks", "600"),
        ("grief_hated_affinity", "-0.5"),
        ("mood_critical_need_level", "20.0"),
        ("mood_low_need_level", "40.0"),
        ("mood_needs_met_level", "70.0"),
        ("mood_critical_need_penalty", "25.0"),
        ("mood_low_need_penalty", "12.0"),
        ("mood_needs_met_bonus", "20.0"),
        ("mood_condition_penalty", "30.0"),
        ("mood_relationship_strength", "15.0"),
        ("mood_relationship_radius", "4.0"),
        ("mood_relationship_min_affinity", "0.1"),
        ("mood_condition_min_severity", "0.05"),
        ("waiting_mood_min_penalty", "2.0"),
        ("waiting_mood_max_penalty", "30.0"),
        ("satisfaction_mood_neutral_band", "15.0"),
        ("satisfaction_mood_per_tick", "0.025"),
        ("social_unmet_need_penalty", "0.20"),
        ("social_critical_need_penalty", "0.35"),
        ("bathroom_privacy_penalty", "0.45"),
        ("social_boundary_avoidance_cost", "0.01"),
        ("shyness_annoyance_strength", "0.25"),
        ("boundary_wander_reconsider_chance", "0.10"),
        ("shyness_wander_reconsider_strength", "0.15"),
        ("skill_level_cost", "0.0859375"),
        ("skill_level_growth", "1.34375"),
        ("affinity_from_trait", "0.6875"),
        ("affinity_presence_threshold", "0.296875"),
        ("affinity_presence_points", "10.5"),
        ("affinity_presence_extra_points", "3.125"),
        ("affinity_presence_extra_cap", "27"),
        ("affinity_use_points", "14.5"),
        ("affinity_use_feeling_per_hour", "0.0234375"),
        ("affinity_band_loves", "0.5625"),
        ("affinity_band_likes", "0.1875"),
        ("affinity_from_mild_trait", "0.34375"),
        // The one knob here that is not a number. Quoted so the emitted
        // TOML is valid, and distinct from every other string in the file
        // for the same reason the numbers are pairwise distinct.
        ("sleep_tag", "\"snooze\""),
    ];

    /// The `[bills]` section as one inline table, every number distinct so a
    /// field read off the wrong key is visible ([WB-tuning]). The kinds are
    /// declared out of id order, so a reader that kept file order rather
    /// than sorting would be visible to the compiler's tests.
    const BILLS: &str = "{ days_per_month = 9, grace_days = 4, late_fee_percent = 6,         late_fee_cap_percent = 45, overdue_mood = 7.5, rent_base_cents = 6100,         rent_indoor_tile_cents = 111, rent_outdoor_tile_cents = 21,         electricity_base_cents = 3100, water_base_cents = 2100,         transportation_base_cents = 1100, commute_cents = 301,         uses = { tub = { label = \"Tubs\", water_cents = 91, electricity_cents = 26 },         drip = { label = \"Drips\", water_cents = 2, electricity_cents = 0 } },         daily = { glow = { label = \"Glows\", water_cents = 0, electricity_cents = 6 } } }";

    /// The four seasonal looks as one inline table, each value distinct and
    /// exact in binary32 like the knobs above. Winter is declared first and
    /// Spring's keys are out of order, so a reader that took seasons or
    /// numbers in file order rather than by name would misplace them.
    const SEASON_YARD_LOOKS: &str = "{ \
        winter = { hue = 11.5, strength = 0.375, lightness = 0.125 }, \
        spring = { lightness = 0.03125, hue = 0.5, strength = 1.25 }, \
        summer = { hue = -7.5, strength = 0.875, lightness = 0.0625 }, \
        autumn = { hue = -40.5, strength = 0.8125, lightness = -0.046875 } }";

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
        assert_eq!(parsed.habituation_max, 3.25);
        assert_eq!(parsed.overdoing_threshold, 1.125);
        assert_eq!(parsed.overdoing_penalty, 17.5);
        assert_eq!(parsed.sick_threshold, 2.75);
        assert_eq!(parsed.sick_penalty, 22.5);
        assert_eq!(parsed.min_interaction_ticks, 3);
        assert_eq!(parsed.rng_seed, 300);
        assert_eq!(parsed.max_queued_intents, 7);
        assert_eq!(parsed.max_queued_commands, 11);
        assert_eq!(parsed.need_bar_refresh_ms, 13);
        assert_eq!(parsed.contested_score_multiplier, 0.375);
        assert_eq!(parsed.relationship_gain_per_talk, 0.4375);
        assert_eq!(parsed.relationship_decay_per_tick, 0.001953125);
        assert_eq!(parsed.relationship_delta_scale, 0.875);
        assert_eq!(parsed.hated_communal_chance, 0.359375);
        assert_eq!(parsed.meal_appreciation_gain, 0.01171875);
        assert_eq!(parsed.burn_chance_novice, 0.09375);
        assert_eq!(parsed.burn_chance_master, 0.00390625);
        assert_eq!(parsed.burnt_meal_mood_penalty, 9.5);
        assert_eq!(parsed.burnt_meal_mood_ticks, 300);
        assert_eq!(parsed.fight_affinity_threshold, -0.875);
        assert_eq!(parsed.fight_chance_per_tick, 0.015625);
        assert_eq!(parsed.fight_relationship_loss, 0.125);
        assert_eq!(parsed.fight_mood_penalty, 11.5);
        assert_eq!(parsed.fight_mood_ticks, 500);
        assert_eq!(parsed.land_strip_depth, 7);
        assert_eq!(parsed.land_price_cents, 12345);
        assert_eq!(parsed.land_price_step_cents, 21);
        assert_eq!(parsed.career_review_noise, 9.5);
        assert_eq!(parsed.career_search_tick, 12);
        assert_eq!(parsed.career_mood_fired_ticks, 5700);
        assert_eq!(parsed.shift_sleep_offset_day, -7);
        assert_eq!(parsed.shift_sleep_offset_early, -65);
        assert_eq!(parsed.shift_sleep_offset_late, 115);
        assert_eq!(parsed.shift_sleep_offset_night, 655);
        assert_eq!(parsed.career_search_temperature, 0.3125);
        assert_eq!(parsed.night_shift_premium_percent, 17);
        let bills = &parsed.bills;
        assert_eq!(
            (
                bills.days_per_month,
                bills.grace_days,
                bills.late_fee_percent,
                bills.late_fee_cap_percent,
                bills.overdue_mood,
            ),
            (9, 4, 6, 45, 7.5)
        );
        assert_eq!(
            [
                bills.rent_base_cents,
                bills.rent_indoor_tile_cents,
                bills.rent_outdoor_tile_cents,
                bills.electricity_base_cents,
                bills.water_base_cents,
                bills.transportation_base_cents,
                bills.commute_cents,
            ],
            [6100, 111, 21, 3100, 2100, 1100, 301]
        );
        assert_eq!(bills.uses["tub"].label, "Tubs");
        assert_eq!(
            (
                bills.uses["tub"].water_cents,
                bills.uses["tub"].electricity_cents
            ),
            (91, 26)
        );
        assert_eq!(bills.uses["drip"].water_cents, 2);
        assert_eq!(bills.daily["glow"].electricity_cents, 6);
        assert_eq!(parsed.days_per_season, 9);
        assert_eq!(parsed.first_season, 3);
        assert_eq!(
            parsed.season_yard_looks,
            [
                [0.5, 1.25, 0.03125],
                [-7.5, 0.875, 0.0625],
                [-40.5, 0.8125, -0.046875],
                [11.5, 0.375, 0.125]
            ]
        );
        assert_eq!(parsed.hobby_multiplier, 2.5);
        assert_eq!(parsed.neglect_floor, 21.0);
        assert_eq!(parsed.at_work_decay_scale, 0.4);
        assert_eq!(parsed.neglect_bleed_per_tick, 0.0009765625);
        assert_eq!(parsed.day_ticks, 17);
        assert_eq!(parsed.first_weekday, 4);
        assert_eq!(parsed.wander_radius_tiles, 29);
        assert_eq!(parsed.resale_fraction, 0.40625);
        assert_eq!(parsed.affinity_loves_from, 1.46875);
        assert_eq!(parsed.affinity_hates_to, 0.28125);
        assert_eq!(parsed.housemate_name_max_chars, 23);
        assert_eq!(parsed.housemate_max_traits, 5);
        assert_eq!(parsed.interior_daylight_shade, 0.15625);
        assert_eq!(parsed.daylight_reach_per_tile, 0.21875);
        assert_eq!(parsed.skill_level_cost, 0.0859375);
        assert_eq!(parsed.skill_level_growth, 1.34375);
        assert_eq!(parsed.affinity_from_trait, 0.6875);
        assert_eq!(parsed.affinity_presence_threshold, 0.296875);
        assert_eq!(parsed.affinity_presence_points, 10.5);
        assert_eq!(parsed.affinity_presence_extra_points, 3.125);
        assert_eq!(parsed.affinity_presence_extra_cap, 27);
        assert_eq!(parsed.affinity_use_points, 14.5);
        assert_eq!(parsed.affinity_band_loves, 0.5625);
        assert_eq!(parsed.affinity_band_likes, 0.1875);
        assert_eq!(parsed.affinity_from_mild_trait, 0.34375);
        assert_eq!(parsed.affinity_use_feeling_per_hour, 0.0234375);

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

    /// [WB-tuning]: every key of `[bills]` and of a kind row is required, and
    /// an unknown key in either is refused by name, so a misspelled charge
    /// cannot quietly cost nothing.
    #[test]
    fn every_bills_key_is_required_and_unknown_keys_are_refused() {
        let with_bills = |bills: &str| {
            tuning_toml_without("bills").replacen(
                &format!("\n[{DECAY_KEY}]"),
                &format!("bills = {bills}\n\n[{DECAY_KEY}]"),
                1,
            )
        };
        assert!(
            toml::from_str::<TuningFile>(&with_bills(BILLS)).is_ok(),
            "the fixture's bills must parse, or the refusals below prove nothing"
        );
        for key in [
            "days_per_month",
            "grace_days",
            "late_fee_percent",
            "late_fee_cap_percent",
            "overdue_mood",
            "rent_base_cents",
            "rent_indoor_tile_cents",
            "rent_outdoor_tile_cents",
            "electricity_base_cents",
            "water_base_cents",
            "transportation_base_cents",
            "commute_cents",
            "uses",
            "daily",
        ] {
            let table: toml::Table = toml::from_str(&format!("b = {BILLS}")).unwrap();
            let mut bills = table["b"].as_table().unwrap().clone();
            assert!(bills.remove(key).is_some(), "{key} is in the fixture");
            let err =
                toml::from_str::<TuningFile>(&with_bills(&toml::Value::Table(bills).to_string()))
                    .expect_err(key)
                    .to_string();
            assert!(err.contains(key), "the error must name '{key}'; got {err}");
        }
        for (bad, named) in [
            (
                BILLS.replacen(
                    "commute_cents = 301",
                    "commute_cents = 301, commuter_cents = 4",
                    1,
                ),
                "commuter_cents",
            ),
            (
                BILLS.replacen("water_cents = 2,", "water_cents = 2, gas_cents = 1,", 1),
                "gas_cents",
            ),
            (BILLS.replacen("label = \"Drips\", ", "", 1), "label"),
            (
                BILLS.replacen(", electricity_cents = 6 }", " }", 1),
                "electricity_cents",
            ),
        ] {
            assert_ne!(bad, BILLS, "the edit for '{named}' must apply");
            let err = toml::from_str::<TuningFile>(&with_bills(&bad))
                .expect_err(named)
                .to_string();
            assert!(
                err.contains(named),
                "the error must name '{named}'; got {err}"
            );
        }
    }

    /// One look per season, in season order, for the refusals below to
    /// take apart. The values are the fixture's.
    const SEASON_LOOKS: [(&str, &str); 4] = [
        (
            "spring",
            "{ hue = 0.5, strength = 1.25, lightness = 0.03125 }",
        ),
        (
            "summer",
            "{ hue = -7.5, strength = 0.875, lightness = 0.0625 }",
        ),
        (
            "autumn",
            "{ hue = -40.5, strength = 0.8125, lightness = -0.046875 }",
        ),
        (
            "winter",
            "{ hue = 11.5, strength = 0.375, lightness = 0.125 }",
        ),
    ];

    /// `season_yard_looks` as an inline table of these seasons and looks.
    fn season_table(entries: &[(&str, &str)]) -> String {
        let body: Vec<String> = entries
            .iter()
            .map(|(season, look)| format!("{season} = {look}"))
            .collect();
        format!("{{ {} }}", body.join(", "))
    }

    /// The shipped four with `season`'s look written as `look`.
    fn season_table_with(season: &str, look: &str) -> String {
        let entries: Vec<(&str, &str)> = SEASON_LOOKS
            .iter()
            .map(|&(name, given)| (name, if name == season { look } else { given }))
            .collect();
        season_table(&entries)
    }

    /// What parsing the fixture with `season_yard_looks = {value}` reports.
    /// It must fail; the season knob goes first, ahead of the decay table.
    fn season_looks_error(value: &str) -> String {
        let source = format!(
            "season_yard_looks = {value}\n{}",
            tuning_toml_without("season_yard_looks")
        );
        match toml::from_str::<TuningFile>(&source) {
            Ok(parsed) => panic!(
                "season_yard_looks = {value} must not parse; got {:?}",
                parsed.season_yard_looks
            ),
            Err(err) => err.to_string(),
        }
    }

    /// [SEA-yard]: the looks are read by season name, in the dotted-key
    /// layout `content/tuning.toml` uses, and a whole number counts as a
    /// number, as it does in a lot look.
    #[test]
    fn season_looks_are_read_by_name_and_take_whole_numbers() {
        let source = format!(
            "season_yard_looks.autumn = {{ hue = -45, strength = 1, lightness = 0 }}\n\
             season_yard_looks.winter = {{ hue = 12.5, strength = 0.25, lightness = 0.1875 }}\n\
             season_yard_looks.spring = {{ hue = 0.75, strength = 2, lightness = -0.25 }}\n\
             season_yard_looks.summer = {{ hue = -20, strength = 0.5, lightness = 0.09375 }}\n{}",
            tuning_toml_without("season_yard_looks")
        );
        let parsed: TuningFile = toml::from_str(&source).expect("dotted season looks parse");
        assert_eq!(
            parsed.season_yard_looks,
            [
                [0.75, 2.0, -0.25],
                [-20.0, 0.5, 0.09375],
                [-45.0, 1.0, 0.0],
                [12.5, 0.25, 0.1875]
            ]
        );
    }

    /// [SEA-yard]: a fifth season, or a season by a name the year does not
    /// have, is refused with that name rather than dropped.
    #[test]
    fn a_season_look_for_no_season_is_refused_by_name() {
        let mut five = SEASON_LOOKS.to_vec();
        five.push(("monsoon", "{ hue = 1.0, strength = 1.0, lightness = 0.0 }"));
        for (value, name) in [
            (season_table(&five), "monsoon"),
            (
                season_table(&[
                    SEASON_LOOKS[0],
                    SEASON_LOOKS[1],
                    ("fall", SEASON_LOOKS[2].1),
                    SEASON_LOOKS[3],
                ]),
                "fall",
            ),
        ] {
            let err = season_looks_error(&value);
            assert!(
                err.contains(&format!(
                    "season_yard_looks has a look for `{name}`, which is not a season"
                )),
                "{err}"
            );
        }
    }

    /// [SEA-yard]: every season needs a look; leaving out any one of the
    /// four is refused with that season named.
    #[test]
    fn a_missing_season_look_is_refused_by_name() {
        for (index, (season, _)) in SEASON_LOOKS.iter().enumerate() {
            let mut three = SEASON_LOOKS.to_vec();
            three.remove(index);
            let err = season_looks_error(&season_table(&three));
            assert!(
                err.contains(&format!("season_yard_looks has no look for {season};")),
                "{err}"
            );
        }
    }

    /// [SEA-yard]: a season's look needs exactly a hue, a strength and a
    /// lightness. Each key left out, a misspelled key and a fourth number
    /// are refused with the season and the key named.
    #[test]
    fn a_season_look_with_a_missing_or_unknown_key_is_refused_by_name() {
        for (season, look, expected) in [
            (
                "spring",
                "{ strength = 1.25, lightness = 0.03125 }",
                "season_yard_looks.spring has no hue;",
            ),
            (
                "autumn",
                "{ hue = -40.5, lightness = -0.046875 }",
                "season_yard_looks.autumn has no strength;",
            ),
            (
                "summer",
                "{ hue = -7.5, strength = 0.875 }",
                "season_yard_looks.summer has no lightness;",
            ),
            (
                "summer",
                "{ hues = -7.5, strength = 0.875, lightness = 0.0625 }",
                "season_yard_looks.summer has an unknown key `hues`;",
            ),
            (
                "winter",
                "{ hue = 11.5, strength = 0.375, lightness = 0.125, saturation = 0.5 }",
                "season_yard_looks.winter has an unknown key `saturation`;",
            ),
        ] {
            let err = season_looks_error(&season_table_with(season, look));
            assert!(err.contains(expected), "{season} = {look}: {err}");
        }
    }

    /// [SEA-yard]: a season written as a list of numbers, three or four,
    /// and the whole table written as a list of rows, five or four, are
    /// refused with the expected shape spelled out. A value that is not a
    /// number names the season and the key.
    #[test]
    fn a_season_look_of_the_wrong_shape_or_type_is_refused_by_name() {
        let summer_shape = "expected season_yard_looks.summer as a table with a hue, \
                            a strength and a lightness";
        let table_shape = "expected season_yard_looks as one table for each of spring, \
                           summer, autumn and winter, each with a hue, a strength and a \
                           lightness";
        for (value, expected) in [
            (
                season_table_with("summer", "[-7.5, 0.875, 0.0625, 0.5]"),
                summer_shape,
            ),
            (
                season_table_with("summer", "[-7.5, 0.875, 0.0625]"),
                summer_shape,
            ),
            (
                "[[0.0, 1.0, 0.0], [-20.0, 0.85, 0.04], [-45.0, 0.9, -0.05], \
                 [12.0, 0.3, 0.14], [9.0, 1.0, 0.0]]"
                    .to_string(),
                table_shape,
            ),
            (
                "[[0.0, 1.0, 0.0], [-20.0, 0.85, 0.04], [-45.0, 0.9, -0.05], [12.0, 0.3, 0.14]]"
                    .to_string(),
                table_shape,
            ),
            (
                season_table_with(
                    "autumn",
                    "{ hue = \"yellow\", strength = 0.8125, lightness = -0.046875 }",
                ),
                "expected a number for season_yard_looks.autumn.hue",
            ),
            (
                season_table_with(
                    "spring",
                    "{ hue = { turn = 0.5 }, strength = 1.25, lightness = 0.03125 }",
                ),
                "invalid type: map, expected a number for season_yard_looks.spring.hue",
            ),
        ] {
            let err = season_looks_error(&value);
            assert!(err.contains(expected), "{value}: {err}");
        }
    }

    /// [SEA-yard]: a TOML date, time or date-time where a season's table or a
    /// look's number belongs, or in place of the whole table, is refused as a
    /// date or time, naming the season and the key wherever one is at fault
    /// (a date in place of the whole table names neither). The `toml` crate hands
    /// a visitor each of them as a map under a private key, which must not
    /// reach the message.
    #[test]
    fn a_date_in_the_season_looks_is_refused_as_a_date_or_time() {
        for (value, expected) in [
            (
                "1979-05-27".to_string(),
                "season_yard_looks is a date or time; it needs one table for each of spring",
            ),
            (
                season_table_with("spring", "1979-05-27T07:32:00Z"),
                "season_yard_looks.spring is a date or time; a season's look is a table of hue",
            ),
            (
                season_table_with("winter", "07:32:00"),
                "season_yard_looks.winter is a date or time;",
            ),
            (
                season_table_with(
                    "spring",
                    "{ hue = 1979-05-27, strength = 1.25, lightness = 0.03125 }",
                ),
                "season_yard_looks.spring.hue is a date or time, not a number",
            ),
            (
                season_table_with(
                    "autumn",
                    "{ hue = -40.5, strength = 0.8125, lightness = 1979-05-27T07:32:00 }",
                ),
                "season_yard_looks.autumn.lightness is a date or time, not a number",
            ),
        ] {
            let err = season_looks_error(&value);
            assert!(err.contains(expected), "{value}: {err}");
            assert!(!err.contains("toml_private"), "{value}: {err}");
        }
    }

    /// The fixture with each season's look written under its own
    /// `[season_yard_looks.{season}]` header, one key per line, after the
    /// decay table. `looks` gives each season's inline table.
    fn header_layout(looks: &[(&str, &str)]) -> String {
        let mut source = tuning_toml_without("season_yard_looks");
        for (season, look) in looks {
            source.push_str(&format!("\n[season_yard_looks.{season}]\n"));
            for pair in look
                .trim_matches(|c| c == '{' || c == '}' || c == ' ')
                .split(", ")
            {
                source.push_str(&format!("{pair}\n"));
            }
        }
        source
    }

    /// [SEA-yard]: the table-header layout reads like the inline one, each
    /// season under its own header, here written Winter first.
    #[test]
    fn season_looks_under_table_headers_parse() {
        let mut looks = SEASON_LOOKS.to_vec();
        looks.reverse();
        let parsed: TuningFile =
            toml::from_str(&header_layout(&looks)).expect("header-layout season looks parse");
        assert_eq!(
            parsed.season_yard_looks,
            [
                [0.5, 1.25, 0.03125],
                [-7.5, 0.875, 0.0625],
                [-40.5, 0.8125, -0.046875],
                [11.5, 0.375, 0.125]
            ]
        );
    }

    /// [SEA-yard]: the refusals name the season in the table-header layout
    /// too, where the offending line does not show it.
    #[test]
    fn a_season_look_under_a_table_header_is_refused_by_name() {
        let looks: Vec<(&str, &str)> = SEASON_LOOKS
            .iter()
            .map(|&(season, look)| {
                let look = if season == "summer" {
                    "{ hue = -7.5, strenght = 0.875, lightness = 0.0625 }"
                } else {
                    look
                };
                (season, look)
            })
            .collect();
        let err = toml::from_str::<TuningFile>(&header_layout(&looks))
            .expect_err("a misspelled key must not parse")
            .to_string();
        assert!(
            err.contains("season_yard_looks.summer has an unknown key `strenght`;"),
            "{err}"
        );
    }

    /// [CAL-careers]: `working_days` is required. A career written before
    /// the week existed must fail to parse rather than default to a mask
    /// nobody chose, and the error names the missing key.
    #[test]
    fn a_career_without_working_days_does_not_parse() {
        let career = r#"
            [[career]]
            id = "office"
            label = "Office"
            [[career.level]]
            id = "office_job"
            title = "Office clerk"
            shift_start = 360
            shift_ticks = 480
            pay = 120
            pay_max = 150
            energy_cost = 15.0
            satisfaction = 1.0
            "#;
        let err = toml::from_str::<CareersFile>(career)
            .expect_err("a career without working_days must not parse");
        assert!(err.to_string().contains("working_days"), "{err}");

        let err =
            toml::from_str::<CareersFile>(&format!("{career}working_days = [\"sun\", \"mon\"]\n"))
                .expect_err("a level without advance_weeks must not parse");
        assert!(err.to_string().contains("advance_weeks"), "{err}");

        let parsed: CareersFile = toml::from_str(&format!(
            "{career}working_days = [\"sun\", \"mon\"]\nadvance_weeks = 3\n"
        ))
        .expect("the same career with working days and advance weeks parses");
        assert_eq!(
            parsed.career[0].level[0].working_days,
            vec!["sun".to_string(), "mon".to_string()],
            "the authored list reaches the schema in declared order"
        );
        assert_eq!(parsed.career[0].level[0].advance_weeks, 3);
        assert_eq!(parsed.career[0].social_demand, 0.0);
        assert!(parsed.career[0].traits.is_empty());
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
        assert!(
            parsed.affinity.is_empty(),
            "a file without [[affinity]] tables declares no kinds"
        );
    }

    /// [OA-kinds]: `[[affinity]]` tables reach the schema in file order, with
    /// their objects in authored order, and `trait_tag` is optional.
    #[test]
    fn parses_affinity_kinds_in_file_order() {
        let parsed: ObjectsFile = toml::from_str(
            r#"
            [[object]]
            id = "radio"
            name = "Radio"
            sprite = "radio"
            interaction = []

            [[affinity]]
            id = "sound"
            label = "sound"
            reach = "use"
            objects = ["radio", "television"]
            trait_tag = "listening"

            [[affinity]]
            id = "greenery"
            label = "greenery"
            reach = "presence"
            objects = ["potted_plant"]
            "#,
        )
        .expect("valid objects toml");
        let [first, second] = parsed.affinity.as_slice() else {
            panic!("two kinds, got {:?}", parsed.affinity);
        };
        assert_eq!(first.id, "sound");
        assert_eq!(first.label, "sound");
        assert_eq!(first.reach, "use");
        assert_eq!(first.objects, ["radio", "television"]);
        assert_eq!(first.trait_tag.as_deref(), Some("listening"));
        assert_eq!(second.id, "greenery");
        assert_eq!(second.reach, "presence");
        assert_eq!(second.objects, ["potted_plant"]);
        assert_eq!(second.trait_tag, None);
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

    #[test]
    fn action_sockets_and_visual_socket_references_parse_without_changing_old_objects() {
        let old: ObjectsFile = toml::from_str(
            r#"
            [[object]]
            id = "old_chair"
            name = "Old chair"
            sprite = "loungeChair"
            "#,
        )
        .expect("an object authored before sockets still parses");
        assert!(old.object[0].action_socket.is_empty());

        let parsed: ObjectsFile = toml::from_str(
            r#"
            [[object]]
            id = "reading_chair"
            name = "Reading chair"
            sprite = "loungeChairRelax"

              [[object.action_socket]]
              id = "seat"
              x = 0.25
              y = -0.5
              facing = "SE"

              [[object.interaction]]
              id = "settle_in"
              advertises = { comfort = 15.0, fun = 19.0 }
              duration_ticks = 46
              slots = 1
              visual = { action = "read", anchor = "object_socket", facing = "socket", socket = "seat" }
            "#,
        )
        .expect("the reading socket contract parses");
        let object = &parsed.object[0];
        assert_eq!(object.action_socket.len(), 1);
        assert_eq!(object.action_socket[0].id, "seat");
        assert_eq!(
            (object.action_socket[0].x, object.action_socket[0].y),
            (0.25, -0.5)
        );
        assert_eq!(object.action_socket[0].facing, "SE");
        assert_eq!(
            object.interaction[0]
                .visual
                .as_ref()
                .and_then(|visual| visual.socket.as_deref()),
            Some("seat")
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
