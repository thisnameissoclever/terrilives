use bevy_ecs::prelude::*;
use terri_core::{
    Agent, Eating, Habituation, IntentQueue, NeedId, Needs, Path, Personality, Position, Reserved,
    Restless, SimRng, SmartObject, Target, TileGrid,
};

use super::advertise::{benefit_scale, scaled_delta, score_advertisement};
use crate::Content;

/// Picks one candidate at random, weighted by `exp(score / temperature)`
/// - the softmax of [D-2].
///
/// **Low temperature approaches argmax; high temperature approaches
/// uniform.** That is the whole knob: a designer slides
/// `choice_temperature` from "always the most urgent thing" to "barely
/// cares" without a rebuild. What it buys is that urgency raises the
/// PROBABILITY a need is served next without making it certain, which is
/// the difference between a sim and a robot working down a priority list.
///
/// # Three properties that are correctness rather than style
///
/// **The maximum score is subtracted before exponentiating.** `exp` of a
/// large score overflows to infinity, infinity divided by infinity is
/// `NaN`, and `NaN` loses every comparison - so an affected sim would
/// stop choosing anything forever, with no panic and no log. Subtracting
/// the maximum is mathematically identity: every weight is scaled by the
/// same `exp(-max/T)`, which cancels in the normalisation. It is what
/// `a_large_score_does_not_overflow_to_nan` pins, and that test is not
/// decoration - it fails on the unshifted version.
///
/// **The caller's order is the bucket order.** Weights are laid end to
/// end and a single draw picks the interval it lands in, so which
/// candidate sits in `[0, p_0)` and which in `[p_0, p_0 + p_1)` is
/// decided entirely by the order of `scores`. Two runs that disagree
/// about that order disagree about the outcome for the same draw. Every
/// caller therefore has to hand candidates over in an order that is a
/// function of the world's state and not of its archetype layout; see
/// the object sort in [`select_action`].
///
/// **Softmax is scale-sensitive**, unlike proportionate selection.
/// Because urgency is cubed, scores span orders of magnitude, so `T` has
/// to be tuned against the real range rather than picked as a round
/// number. `content/tuning.toml` carries the observed range.
///
/// `temperature` is strictly positive by content validation, so this does
/// not re-check it; a pack holding a zero or negative temperature cannot
/// be built.
///
/// # `exp` is the one platform call in the simulation's causal chain
///
/// Everything else the sim computes is IEEE-exact and therefore
/// bit-identical on every target - `score_advertisement` cubes urgency by
/// repeated multiplication rather than `powf` for exactly that reason,
/// and `SimRng` is in-repo rather than taken from `rand` for it too.
/// `f32::exp` is not: it lowers to a platform libm call whose last bit is
/// not guaranteed to agree between the MSVC CRT that `cargo test` uses,
/// glibc on CI, and the wasm32 build that actually ships.
///
/// **A last-bit difference changes the outcome only when the draw falls
/// within one ulp of a bucket boundary**, which is about one decision in
/// 2^24 and only on targets that disagree at all. So this is a small
/// residual risk rather than a broken guarantee - but it is a real one
/// for replay and for the planned multiplayer, and it is unavoidable
/// while [D-2] specifies a softmax. Softmax needs an exponential.
///
/// It is written down rather than fixed because the fix - an in-repo
/// `exp` approximation, the same move the PRNG made - is a decision about
/// how much determinism this project is buying, not an implementation
/// detail to slip in. The tests that cover weighted selection are all
/// robust to a last-bit difference by construction: the tie tests weigh
/// candidates at `exp(0.0)`, which is exactly 1.0 everywhere, the
/// decisive-temperature fixtures underflow the loser to exactly 0.0, and
/// the distribution test is statistical over 500 seeds. Both golden world
/// hashes are over one-candidate scenarios and so never depend on an
/// `exp` result at all.
pub fn sample_softmax(scores: &[f32], temperature: f32, rng: &mut SimRng) -> usize {
    assert!(
        !scores.is_empty(),
        "sample_softmax has no candidate to choose between"
    );

    // `fold` with `f32::max` rather than `max_by`, because `f32` is not
    // `Ord` and the fold states the identity element explicitly.
    let max = scores.iter().copied().fold(f32::NEG_INFINITY, f32::max);

    let mut weights = Vec::with_capacity(scores.len());
    let mut total = 0.0;
    for score in scores {
        let weight = ((score - max) / temperature).exp();
        total += weight;
        weights.push(weight);
    }

    // `total` is at least 1.0, because the maximum scores `exp(0.0)`, so
    // the draw cannot land past the end of the last bucket except
    // through rounding in the multiply below - and the running index
    // handles that case by falling out of the loop on the last
    // candidate, which is the answer the comparison would have given for
    // a draw one ulp lower.
    //
    // Written as a running index rather than as an early `return` with a
    // trailing `scores.len() - 1` deliberately. That trailing expression
    // is unreachable by construction, and **unreachable arithmetic is
    // exactly what a mutation sweep cannot judge**: `- 1` becoming
    // `+ 1`, `* 1`, `/ 1` or `% 1` there would survive every test, and
    // four survivors that mean nothing are how a baseline turns into
    // wallpaper. This shape has no arithmetic to mutate.
    let draw = rng.next_f32() * total;
    let mut cumulative = 0.0;
    let mut chosen = 0;
    for (index, weight) in weights.iter().enumerate() {
        chosen = index;
        cumulative += weight;
        if draw < cumulative {
            break;
        }
    }
    chosen
}

#[cfg(test)]
mod sampler_tests {
    //! `sample_softmax` is the piece with real maths in it, so it is
    //! tested standalone before anything about the ECS is involved.
    //! Nothing here builds a world; every input is a slice of scores.

    use super::sample_softmax;
    use terri_core::SimRng;

    /// The fraction of draws that pick index 0, which every caller below
    /// arranges to be the highest-scoring candidate.
    ///
    /// Ten thousand samples from one seeded generator: the point is the
    /// SHAPE of the distribution, so the sample has to be large enough
    /// that the shape is what the number reports.
    fn share_of_best(scores: &[f32], temperature: f32) -> f32 {
        const SAMPLES: u32 = 10_000;
        assert!(
            scores.iter().skip(1).all(|s| *s < scores[0]),
            "index 0 must be the single best score, or 'share of best' \
             names the wrong thing: {scores:?}"
        );

        let mut rng = SimRng::from_seed(17);
        let mut best = 0u32;
        for _ in 0..SAMPLES {
            if sample_softmax(scores, temperature, &mut rng) == 0 {
                best += 1;
            }
        }
        best as f32 / SAMPLES as f32
    }

    #[test]
    fn a_much_better_option_wins_most_of_the_time_but_not_always() {
        // Both halves matter. The first distinguishes this from uniform
        // random; the second is the entire point of the milestone and is
        // what distinguishes it from argmax.
        //
        // 0.15 is a FIXTURE temperature and deliberately not the shipped
        // 0.06. A gap of 0.75 at 0.06 is a weight ratio of exp(12.5),
        // which is argmax to within four parts in a million, so the
        // second assertion below would fail at the shipped value - not
        // because the sampler is wrong but because these two scores are
        // nowhere near each other on the scale the game runs at. The
        // shipped temperature is exercised by
        // `a_higher_scoring_object_is_chosen_more_often_and_a_lower_one_still_sometimes`,
        // whose fixture sits at a realistic gap.
        let scores = [1.0, 0.25];
        let mut rng = SimRng::from_seed(3);
        let mut wins = [0u32; 2];
        for _ in 0..10_000 {
            wins[sample_softmax(&scores, 0.15, &mut rng)] += 1;
        }
        assert_eq!(
            wins[0] + wins[1],
            10_000,
            "every draw must land on a candidate: {wins:?}"
        );
        assert!(
            wins[0] > wins[1] * 3,
            "the better option must dominate: {wins:?}"
        );
        assert!(
            wins[1] > 0,
            "the worse option must still happen sometimes: {wins:?}"
        );
    }

    #[test]
    fn temperature_moves_the_distribution_between_argmax_and_uniform() {
        let scores = [1.0, 0.8];
        let cold = share_of_best(&scores, 0.01);
        let warm = share_of_best(&scores, 10.0);
        assert!(
            cold > 0.95,
            "low temperature must approach argmax, got {cold}"
        );
        assert!(
            (warm - 0.5).abs() < 0.1,
            "high temperature must approach uniform, got {warm}"
        );
    }

    #[test]
    fn a_large_score_does_not_overflow_to_nan() {
        // `exp` of a large score is infinity, and infinity over infinity
        // is NaN. NaN loses every comparison, so a sim would stop
        // choosing anything forever with no panic and no log. The fix is
        // to subtract the max before exponentiating, which is
        // mathematically identity.
        //
        // Mutation-verified: without the shift this returns index 1 -
        // both weights become `inf`, the running total becomes `inf`,
        // and `draw` becomes `NaN`, so `draw < cumulative` is false at
        // every bucket and the loop falls through to its last-resort
        // return. Green with the shift, red without.
        //
        // 1000.0 is not a contrived magnitude at the tuned temperature:
        // it is divided by `choice_temperature`, so the 0.15 used here
        // turns any score above about 88 into an infinite weight, and
        // the shipped 0.06 lowers that to about 35. Retuning the
        // temperature DOWN makes this failure easier to reach, not
        // harder, which is why the guard is a shift rather than a range
        // check on the input.
        let scores = [1000.0, 1.0];
        let mut rng = SimRng::from_seed(5);
        let picked = sample_softmax(&scores, 0.15, &mut rng);
        assert_eq!(picked, 0);
    }

    #[test]
    fn a_single_candidate_is_always_chosen() {
        let mut rng = SimRng::from_seed(9);
        assert_eq!(sample_softmax(&[0.3], 0.15, &mut rng), 0);
    }

    /// A candidate whose weight underflows to exactly zero must be
    /// unreachable, including on a draw of exactly `0.0`.
    ///
    /// This is what `assert_decisive` in the system tests below relies
    /// on, and it is the one place the `<` in the bucket walk is
    /// distinguishable from `<=`. `next_f32` can return exactly 0.0 -
    /// one draw in 2^24 - and under `<=` that draw would pick a
    /// zero-probability candidate sitting in front, which is precisely
    /// the "impossible outcome happens once in a blue moon" bug that is
    /// unreproducible by the time anybody notices.
    ///
    /// The zero-weight candidate is deliberately FIRST, because that is
    /// the only position from which it could be picked.
    ///
    /// The seed is not arbitrary and is not a magic number: it is the
    /// smallest one whose FIRST draw is exactly `0.0`, found by search,
    /// because a draw of zero is the only input on which `<` and `<=`
    /// disagree here and it arrives once in 2^24 draws. Ten thousand
    /// random samples would miss it about 99.94% of the time, which is
    /// the difference between a test and a coincidence. The precondition
    /// below asserts the seed still has that property, so a change to
    /// `SimRng` fails here loudly instead of quietly making this a test
    /// of an ordinary draw.
    #[test]
    fn a_zero_weight_candidate_is_never_picked_even_on_a_draw_of_zero() {
        const ZERO_DRAW_SEED: u64 = 55_392_234;
        let scores: [f32; 2] = [0.0, 1.0];
        let temperature: f32 = 0.001;

        let weight = ((scores[0] - scores[1]) / temperature).exp();
        assert_eq!(
            weight, 0.0,
            "the fixture must genuinely underflow, or this test is about \
             a small weight rather than a zero one; got {weight}"
        );
        let first = SimRng::from_seed(ZERO_DRAW_SEED).next_f32();
        assert_eq!(
            first, 0.0,
            "the seed must draw exactly zero first, or this test cannot \
             tell `<` from `<=`; got {first}"
        );

        let mut rng = SimRng::from_seed(ZERO_DRAW_SEED);
        assert_eq!(
            sample_softmax(&scores, temperature, &mut rng),
            1,
            "a candidate whose probability is exactly zero was picked; \
             the bucket walk must reject a draw that merely REACHES the \
             running total rather than exceeding it"
        );
    }
}

/// Turns each directed agent's front intent into a `Target`, taking
/// precedence over whatever the sim had decided for itself - [D-3].
///
/// # A player intent PREEMPTS a running interaction; it does not queue
/// behind one
///
/// This is the milestone's central feel decision and it goes the other
/// way from the obvious reading of "queue". The alpha feel pass measured
/// a 24-second sleep, and a walk plus a sleep leaving a sim unreachable
/// for over half a minute (`docs/alpha-feel-notes.md`). A click that
/// waited for that to finish would produce no visible response for the
/// whole time, and the player would conclude the click was lost - which
/// is precisely the failure [D-3] exists to prevent, arriving through a
/// different door than the one it was written for. **In-progress
/// autonomy is still autonomy.**
///
/// So this system deliberately sees agents that already hold a `Target`
/// or an `Eating`, which is exactly why it cannot live inside
/// [`select_action`]: that query filters both out, and widening it would
/// make an agent that is mid-meal a candidate for autonomous selection
/// as well.
///
/// Preempting means releasing the old reservation, dropping `Eating`,
/// and pathing afresh. The interaction is abandoned, not suspended.
/// Resuming would need to remember how much of it was left and is a
/// decision about what an interruption *means*, not an implementation
/// detail; nothing in M1b needs it.
///
/// # What happens to an intent that cannot be served
///
/// Three outcomes, and the split is what stops the two failure modes
/// this system could have. An intent that can never be served must not
/// suppress autonomy forever - a sim would stand still while its needs
/// drained, which looks exactly like [L17]'s frozen agent. An intent
/// that could be served in a moment must not be thrown away, or a click
/// on a busy object is silently ignored.
///
/// - **Serve it**, when the object exists, is free, and can be walked
///   to.
/// - **Drop it**, when the object has been despawned, is not a smart
///   object, names an interaction its definition does not have, or has
///   no path to it. None of those can resolve on their own.
/// - **Wait**, when the object is reserved by another agent. That does
///   resolve on its own, because interactions end. The agent stands
///   still, keeps the intent, and [`select_action`] leaves it alone -
///   which is the main situation in which that system's empty-queue
///   check is the only thing keeping the sim on task, and the one its
///   test is built on.
///
/// A dropped intent is dropped SILENTLY, which is a real limitation
/// rather than a decision: there is no channel back to the shell yet, so
/// a player who clicks a sealed-off object sees the sim ignore them. The
/// feedback belongs with the selection UI in Task 7.
///
/// **Exactly one intent is considered per agent per tick.** Dropping an
/// unservable front intent therefore costs a tick before the next one is
/// looked at, which is invisible at 10 ticks a second and keeps this a
/// straight line rather than a loop whose exit conditions are one more
/// thing to get right. The consequence is a transient state - a
/// non-empty queue with no target - that [`select_action`]'s empty-queue
/// filter is what covers.
///
/// # The order is load-bearing, for the same reason as everywhere else
///
/// Reservation is contended state and two agents can intend the same
/// object on the same tick, so agents are visited in entity-index order
/// rather than in query order. Query iteration is archetype order, which
/// is allocation history rather than simulation state. `claimed` covers
/// the same tick, because `Commands` are deferred and the `Has<Reserved>`
/// read below cannot see an insert this system has just queued. Same
/// rule and same reason as the sorts in [`select_action`], `follow_path`
/// and `wander`; see [D-3] and [L5].
///
/// The type_complexity allow is for the same reason it is on
/// [`select_action`]: the query tuple is what pushes past clippy's
/// threshold, and a type alias would only move it somewhere less
/// readable.
#[allow(clippy::type_complexity)]
pub fn serve_intents(
    mut commands: Commands,
    grid: Res<TileGrid>,
    content: Res<Content>,
    mut agents: Query<(Entity, &Position, &mut IntentQueue, Option<&Target>), With<Agent>>,
    objects: Query<(&Position, &SmartObject, Has<Reserved>)>,
) {
    let mut directed: Vec<Entity> = agents
        .iter()
        .filter(|(_, _, queue, _)| !queue.is_empty())
        .map(|(entity, _, _, _)| entity)
        .collect();
    directed.sort_by_key(|entity| entity.index());

    let mut claimed: Vec<Entity> = Vec::new();

    for agent in directed {
        // Infallible: the list was just collected from this query and
        // nothing between here and there removes a component.
        let Ok((_, agent_pos, mut queue, target)) = agents.get_mut(agent) else {
            continue;
        };
        let Some(intent) = queue.front() else {
            continue;
        };

        // **An agent the player has directed is not an agent with
        // nothing to do.** `select_action` is the only writer of
        // `Restless` and it skips directed agents entirely, so a marker
        // set on the tick before the intent arrived would otherwise sit
        // there and send a sim that is waiting its turn off for a
        // stroll. Removing a component an entity does not have is a
        // no-op and does not move it between archetypes.
        commands.entity(agent).remove::<Restless>();

        // Already serving this exact intent, so there is nothing to do
        // and re-pathing would be actively wrong: `find_path` starts
        // from the agent's ROUNDED tile, and an agent a quarter of the
        // way into the next tile would be sent back to the one behind
        // it, every tick, for ever. The sim would shuffle on the spot
        // instead of arriving.
        if target.is_some_and(|t| t.object == intent.object && t.interaction == intent.interaction)
        {
            continue;
        }

        // Whether the reservation on the intended object, if there is
        // one, is this agent's own. Re-targeting the same object with a
        // different interaction is a legitimate move and must not be
        // mistaken for contention with somebody else.
        let held_here = target.is_some_and(|t| t.object == intent.object);

        let Ok((object_pos, placed, reserved)) = objects.get(intent.object) else {
            queue.pop();
            continue;
        };
        // Out of range means the pack changed under a saved command log,
        // since a live click cannot name an interaction that is not
        // there. Dropping it is what keeps the indexing in `follow_path`
        // and `tick_interactions` safe by construction rather than by
        // hope - those two index straight into `interactions` with this
        // number.
        if intent.interaction as usize >= content.0.object(placed.0).interactions.len() {
            queue.pop();
            continue;
        }
        if (reserved && !held_here) || claimed.contains(&intent.object) {
            continue;
        }
        let from = (agent_pos.x.round() as i32, agent_pos.y.round() as i32);
        let to = (object_pos.x.round() as i32, object_pos.y.round() as i32);
        // **Beside it, not on it.** See `TileGrid::find_path_adjacent` for
        // the four separate problems standing on the furniture caused. `None`
        // still means unreachable and still drops the intent, which is the
        // same handling as before - it now also covers an object whose every
        // neighbour is walled off.
        //
        // **Beside the whole RECTANGLE**, not beside the origin tile - [F4].
        // The footprint comes from the object's definition rather than from
        // its placement, so a click on the east end of a 2x1 bed sends the sim
        // to the tile beside that end rather than round to the origin. A
        // 1x1 default here would be the bug footprints exist to remove, which
        // is why the argument is required rather than optional.
        let footprint = content.0.object(placed.0).footprint;
        let Some(steps) = grid.find_path_adjacent(from, to, footprint) else {
            queue.pop();
            continue;
        };

        // Release whatever the agent was holding before, unless it is
        // the same object - re-targeting one object's other interaction
        // must not hand it to somebody else in between.
        if let Some(target) = target {
            if target.object != intent.object {
                // try_remove for the same reason `tick_interactions`
                // uses it: `Commands::entity` does not validate, so a
                // stale `Target` would otherwise route a removal to the
                // command error handler.
                commands.entity(target.object).try_remove::<Reserved>();
            }
        }
        claimed.push(intent.object);
        commands.entity(intent.object).insert(Reserved);
        commands.entity(agent).remove::<Eating>().insert((
            Target {
                object: intent.object,
                interaction: intent.interaction,
            },
            Path { steps, cursor: 0 },
        ));
    }
}

/// Idle agents scan advertisements, sample one weighted by score, reserve
/// it, and path to it. Serialized on purpose: reservation is contended
/// state, so it runs in deterministic entity order per [D4].
///
/// The type_complexity allow is unavoidable: the filter tuple that keeps
/// busy agents out of selection is exactly what pushes the query type
/// past clippy's threshold, and a type alias would only move the same
/// type somewhere less readable.
#[allow(clippy::type_complexity)]
pub fn select_action(
    mut commands: Commands,
    grid: Res<TileGrid>,
    content: Res<Content>,
    mut rng: ResMut<SimRng>,
    agents: Query<
        (
            Entity,
            &Position,
            &Needs,
            Option<&IntentQueue>,
            Option<&Habituation>,
            Option<&Personality>,
        ),
        (With<Agent>, Without<Target>, Without<Eating>),
    >,
    // **Reserved objects are INCLUDED, and `Has<Reserved>` is read per
    // object below instead.**
    //
    // This query used to carry `Without<Reserved>`, which looks like the
    // obvious way to say "you cannot have what somebody else has" and is
    // wrong for one specific reason: an object filtered out here is invisible
    // to `best_seen` as well as to the candidate list, and `best_seen` is
    // what decides whether the agent is told **nothing is worth doing**. A
    // sim waiting for the only fridge in the house was therefore marked
    // `Restless` and sent for a stroll, for the whole of the other sim's walk
    // and meal.
    //
    // The two questions are genuinely different and the filter conflated
    // them: "may I have this?" is answered by the reservation, "is anything
    // here worth wanting?" is not. Availability is now applied at the one
    // place it belongs - whether the object enters `candidates` - and the
    // score still reaches `best_seen` either way. [C3] in
    // docs/alpha-feel-notes.md is the report;
    // `an_agent_waiting_on_an_object_reserved_earlier_waits_rather_than_wandering_off`
    // is what fails if the filter comes back.
    objects: Query<(Entity, &Position, &SmartObject, Has<Reserved>)>,
) {
    // Below this score nothing is worth doing, so the agent stays idle.
    //
    // Read from the pack rather than held in a `const` here, per [D-1]:
    // every value governing the SYSTEM lives in `content/tuning.toml`,
    // so a tuning pass is one file rather than a hunt through Rust. The
    // pack's copy is validated at build time, so nothing here re-checks
    // it.
    let action_threshold = content.0.tuning.action_threshold;
    let temperature = content.0.tuning.choice_temperature;
    // The OTHER threshold, and it is deliberately a second knob rather
    // than a second use of the first - [D-5]. `action_threshold` answers
    // "is anything worth doing"; this one answers "is nothing worth
    // doing enough that I should mill about". Between them sits a band
    // where an agent neither acts nor wanders, which is a sim that has
    // noticed something mildly interesting and is staying near it.
    // Collapsing the two deletes that band and the knob with it.
    let idle_threshold = content.0.tuning.idle_threshold;

    // Collect and sort so iteration order cannot vary between runs.
    //
    // The whole `Needs` component is carried rather than one deficit,
    // because an advert is a sparse list of (need, delta) pairs: which
    // needs get scored is a property of the candidate, not of the agent.
    let mut idle: Vec<(Entity, Position, Needs, Habituation, Personality)> = agents
        .iter()
        // **A directed sim does not choose for itself** - [D-3]. This is
        // the whole autonomy override: a player-issued intent suppresses
        // selection until it completes or is cancelled, because a
        // directed action that autonomy could talk the sim out of would
        // make clicking feel ignored.
        //
        // It is a filter on emptiness rather than a `Without<IntentQueue>`
        // in the query, and the difference matters: the component stays
        // on an agent whose queue has run dry, so "has an IntentQueue"
        // and "is under orders" are different questions. `is_none_or`
        // covers the agents that have never been directed at all and
        // therefore carry no queue.
        //
        // Filtering here rather than skipping inside the loop below also
        // means a directed agent never has `Restless` written for it,
        // which is what leaves `serve_intents` the single writer of that
        // marker for such an agent instead of the two of them fighting.
        //
        // **Most of the time this filter is redundant, and the exceptions
        // are what it is for.** `serve_intents` runs first and normally
        // converts the intent into a `Target`, which this query's
        // `Without<Target>` already excludes - so on almost every tick
        // the suppression is achieved twice over and deleting this line
        // would change nothing. Two windows are left, both of which leave
        // an agent with no target, no interaction and an instruction it
        // still means to carry out:
        //
        //   - it is WAITING for an object somebody else has reserved;
        //   - `serve_intents` dropped an unservable front intent and the
        //     queue still holds the next one, which it considers on the
        //     following tick.
        //
        // `a_sim_waiting_for_a_reserved_object_does_not_fall_back_to_autonomy`
        // covers the first and is the test that fails without this line.
        // See [L41]: a guard normally shadowed by another guard is only
        // observable on the input where the shadow is absent, so that
        // fixture had to be built deliberately rather than found.
        .filter(|(_, _, _, queue, _, _)| queue.is_none_or(|queue| queue.is_empty()))
        // Cloned rather than borrowed because the loop below takes `commands`
        // mutably; both Vecs are single digits long. A sim with no
        // `Personality` gets the neutral one - all multipliers 1.0 - which
        // is what keeps every fixture and golden vector predating M2c
        // behaving exactly as it did.
        .map(|(e, pos, needs, _, hab, personality)| {
            (
                e,
                *pos,
                *needs,
                hab.cloned().unwrap_or_default(),
                personality.cloned().unwrap_or_default(),
            )
        })
        .collect();
    idle.sort_by_key(|(e, _, _, _, _)| e.index());

    // **The objects are sorted for the same reason, and that became
    // load-bearing at M1c rather than being tidiness.**
    //
    // Until selection became probabilistic this query iterated unsorted,
    // and that was safe only because the argmax was unique regardless of
    // order: the score comparison plus its entity-index tiebreak left no
    // room for iteration order to decide anything. Weighted sampling
    // removes that protection. `sample_softmax` lays the candidates'
    // probabilities end to end and takes one draw, so **the order sets
    // the bucket boundaries** and the same draw picks a different object
    // depending on which one came first.
    //
    // Query iteration is archetype order, and an object leaves and
    // re-enters the unreserved archetype every time it is claimed and
    // released - leaving swap-removes it from its table and re-entering
    // appends it at the back. So without this line the outcome of a die
    // roll becomes a function of which objects have been used recently,
    // which is a silent determinism break of exactly the class [D-3] and
    // [L5] are about. `tied_scores_resolve_by_object_index_not_archetype_order`
    // is what pins it; deleting this line must fail that test.
    let mut placed_objects: Vec<(Entity, Position, SmartObject, bool)> = objects
        .iter()
        .map(|(e, pos, object, reserved)| (e, *pos, *object, reserved))
        .collect();
    placed_objects.sort_by_key(|(e, _, _, _)| e.index());

    let mut claimed: Vec<Entity> = Vec::new();

    for (agent, agent_pos, needs, habituation, personality) in idle {
        // One candidate per object, in object-index order. An object
        // offers a LIST of interactions and an agent performs ONE of
        // them, so the interactions are resolved against each other
        // first and the object enters the draw once, carrying whichever
        // of its interactions this agent would pick. Entering every
        // (object, interaction) pair separately would instead give an
        // object weight in proportion to how many ways it can be used.
        let mut candidates: Vec<(Entity, Vec<(i32, i32)>, u32, f32)> = Vec::new();
        let from = (agent_pos.x.round() as i32, agent_pos.y.round() as i32);

        // The best score this agent saw ANYWHERE, whether or not it
        // cleared the action threshold, and the only reason it is
        // tracked separately from `candidates`: a candidate list is
        // filtered at `action_threshold`, so it cannot answer the
        // weaker question `idle_threshold` asks.
        //
        // Negative infinity rather than zero, because a score may be
        // negative - an interaction whose costs outweigh its benefits -
        // and because an agent with no reachable object at all must come
        // out of this loop restless rather than merely uninterested.
        let mut best_seen = f32::NEG_INFINITY;

        for (object, object_pos, placed, reserved) in &placed_objects {
            let object = *object;
            // **Contested, not absent.** An object somebody else already
            // holds is still scored, and its score still reaches `best_seen`;
            // what it does not do is enter `candidates`. See the note on the
            // `objects` query above for why those are two different
            // questions, and [C3] for what conflating them looked like.
            //
            // Two ways to be contested and they cover different spans:
            // `reserved` is a claim made on an earlier tick, which lasts the
            // holder's whole walk and interaction, and `claimed` is a claim
            // made by a lower-indexed agent inside this very tick.
            let contested = *reserved || claimed.contains(&object);
            // **Distance here is WALL-AWARE by contract**, and the
            // contract is the part to preserve; A* is only today's way of
            // honouring it.
            //
            // M0 used Euclidean distance and said to revisit it "when
            // walls become common". They are: M1b's lot has a walled
            // bathroom, and a straight line scores the shower as one tile
            // away through its wall. The agent then walks round to the
            // door, so its ranking disagrees with its own movement -
            // which reads on screen as a sim that wants something and
            // then changes its mind, not as a distance-metric bug.
            //
            // M0's "far too expensive" reasoning was about a thousand
            // agents and a hundred thousand objects. At M1b's scale - one
            // agent, eight objects - this is one A* over a 24x18 grid per
            // candidate per tick, which is nothing.
            //
            // The cost is O(idle agents * ALL placed objects) A* searches per
            // tick - every object, not only the available ones. That changed
            // when the query stopped filtering `Without<Reserved>`: a contested
            // object is still pathed to, because its score still has to reach
            // `best_seen`. Deliberate, and the reason is right above; the point
            // here is that it is the SCALE that will force a change, not the
            // metric, and the scale is now slightly larger than it looks.
            //
            // **Do not "optimise" this back to a straight line.** [D7]
            // plans room and portal graph distance for exactly this
            // problem at scale, and a room-graph length is wall-aware too,
            // so balance tuned against A* length survives that swap.
            // Balance tuned against a straight line would survive
            // neither. The metric is the commitment; the implementation
            // is not.
            let to = (object_pos.x.round() as i32, object_pos.y.round() as i32);
            // An object with no path to it is UNAVAILABLE, not free and
            // not adjacent: skipping it here is what lets the agent fall
            // back to the best object it can actually reach. Scoring it
            // instead would hand the highest score in the world to
            // something the agent then cannot walk to, and the agent
            // would stand still forever while its needs decayed - [L17]'s
            // failure with a wall in place of an out-of-bounds
            // coordinate.
            //
            // This also replaces the second `find_path` that used to run
            // after selection: the winning path is carried out of the
            // loop rather than recomputed.
            // **Beside it, not on it** - `find_path_adjacent`, whose docs carry
            // the reasoning. The distance this yields is therefore the walk to
            // the tile the sim will actually stand on, which is one less than
            // the old metric on an open approach; every balance number
            // measured before that change shifted slightly with it, and
            // `docs/alpha-feel-notes.md` carries the re-measurement.
            //
            // **It does NOT change the [C5] repeat-use effect, and an earlier
            // version of this comment said it did.** `find_path_adjacent`
            // returns an EMPTY path for an agent that is already adjacent, so
            // an agent that has just finished an interaction scores that object
            // at distance 0 - the same maximum score it got when the agent
            // stood on top of it. The distance term did not move, and the
            // measurement agrees: repeat use went 5.8% to 5.6%. See the note on
            // `find_path_adjacent` itself.
            //
            // **Beside the whole RECTANGLE**, not beside the origin tile -
            // [F4]. That makes the distance term the walk to the tile the sim
            // will really stand on for a multi-tile object too: approaching a
            // 2x1 bed from the east used to be scored as a walk all the way
            // round to its origin, so the bed read as further away than it is
            // and the sim's ranking disagreed with its own movement. Same
            // class of error as scoring a walled-off object by straight-line
            // distance, one object-width smaller.
            let footprint = content.0.object(placed.0).footprint;
            let Some(steps) = grid.find_path_adjacent(from, to, footprint) else {
                continue;
            };
            let distance = steps.len() as f32;

            // An object offers a list of interactions and an agent
            // performs one of them, so each is scored separately and the
            // winner is carried forward; see `Target::interaction`.
            let mut best: Option<(u32, f32)> = None;
            for (index, advert) in content.0.object(placed.0).interactions.iter().enumerate() {
                // Summing the per-need scores is a design decision, not
                // an implementation detail. An object that satisfies two
                // needs modestly should be able to beat one that
                // satisfies a single need slightly better, which a max
                // or a first-advert-wins rule would not allow.
                // `an_object_advertising_two_needs_beats_one_advertising_a_bigger_single_delta`
                // is what pins it.
                // **Habituation scales the BENEFIT and never a cost** - [S2].
                //
                // The multiplier runs from 1.0 for something never done to
                // `habituation_floor` for something done to death, and it is
                // applied only to POSITIVE deltas. A fourth shower in a row is
                // less refreshing but it does not become less tiring, and
                // scaling its `energy = -12` toward zero would make a
                // habituated shower cheaper and therefore MORE attractive -
                // the mechanic running backwards.
                //
                // Read from a per-agent component, which is the first thing in
                // scoring that is not a property of the world alone. That is
                // the shape `2026-07-29-satisfaction-and-traits-design.md` [S4]
                // asks for: dispositions and per-sim affinities compose into
                // this same multiplier rather than each getting a mechanism.
                //
                // The two lines of arithmetic live in `advertise.rs` rather
                // than here, and that is not tidiness: inline, they were
                // unconstrained by the whole suite and the M2b sweep found
                // seven survivors across them. See `benefit_scale` for why no
                // existing test could see it.
                // **Personality composes into the same multiplier** - [S4]'s
                // one-mechanism rule, now with its second and third sources.
                // The disposition is per-interaction like habituation; the
                // satisfaction multiplier is per-NEED, so it joins inside
                // the advert loop. All of them scale BENEFITS only, through
                // `scaled_delta`, and for the same reason: a sim that fears
                // the couch is not exempt from the couch's costs, and a sim
                // that gets little from eating still gets tired walking.
                //
                // A disposition of 0 - the authored "fear" - zeroes every
                // benefit and leaves every cost, so the net score cannot
                // clear `action_threshold` and the sim never chooses it on
                // its own. A COMMAND still works: `serve_intents` does not
                // score.
                let hab = habituation.get(placed.0, index as u32);
                let scale = benefit_scale(hab, content.0.tuning.habituation_floor)
                    * personality.disposition(placed.0, index as u32);
                let mut score = 0.0;
                for (need_index, delta) in &advert.advertises {
                    let satisfaction = personality.satisfaction[*need_index as usize];
                    let delta = scaled_delta(*delta, scale * satisfaction);
                    // In range by construction: content validation
                    // rejects an advert naming a need rustc does not
                    // know, so a compiled pack cannot hold a bad index.
                    let id = NeedId::ALL[*need_index as usize];
                    score += score_advertisement(
                        needs.deficit(id),
                        delta,
                        advert.duration_ticks,
                        distance,
                    );
                }
                // Every score is offered to `best_seen`, including ones
                // no candidate list will ever hold. That is the whole
                // point of tracking it: `idle_threshold` asks a weaker
                // question than `action_threshold`, so it has to see the
                // scores the action filter throws away.
                //
                // `f32::max` rather than `if score > best_seen`, and the
                // reason is mutation coverage rather than brevity. That
                // comparison relaxed to `>=` is an EQUIVALENT mutant -
                // reassigning a value equal to the one already held
                // changes nothing - so it would survive every possible
                // test and land in the baseline as permanent noise. A
                // baseline that only ever grows becomes a permission
                // slip, so the better fix is code with no comparison to
                // mutate. Same idiom, and the same reasoning, as the
                // fold in `sample_softmax`; `f32` is not `Ord`, which is
                // why this is a method rather than `std::cmp::max`.
                best_seen = best_seen.max(score);

                // STRICTLY greater, and that is the mechanism rather
                // than a default: two interactions on the same object
                // that score equally must resolve to the EARLIER one, or
                // which interaction an agent performs starts depending on
                // declaration order in content with nothing saying so.
                // Relaxed to `>=` the later one takes over, which is what
                // `a_tied_later_interaction_cannot_displace_an_earlier_one_on_the_same_object`
                // fails on.
                //
                // The entity-index clause that used to sit here settled
                // ties between OBJECTS as well, and that half is gone
                // because the argmax it protected is gone: under weighted
                // sampling two tied objects both enter the draw, and what
                // decides which of them occupies the first probability
                // bucket is the sort above. [D-3] is where that handover
                // is written down.
                let better = match &best {
                    Some((_, best_score)) => score > *best_score,
                    None => true,
                };
                if score > action_threshold && better {
                    best = Some((index as u32, score));
                }
            }

            // **The one place availability is applied.** The score above has
            // already reached `best_seen`, which is the whole point: the agent
            // now knows something here was worth wanting even though it cannot
            // have this one, so it waits instead of being told the house is
            // boring.
            if let Some((interaction, score)) = best {
                if !contested {
                    candidates.push((object, steps, interaction, score));
                }
            }
        }

        // Publish restlessness before returning, whichever way this goes.
        // `idle::wander` is the only reader; this system is the only
        // writer, because it is the only one that scores anything.
        //
        // The condition needs no `candidates.is_empty()` clause and
        // deliberately does not have one: any candidate at all scored
        // above `action_threshold`, and content validation forbids
        // `idle_threshold` from exceeding it, so a non-empty candidate
        // list already implies `best_seen > idle_threshold`. Adding the
        // clause would be a second statement of the same fact, and the
        // two could later disagree.
        if best_seen <= idle_threshold {
            commands.entity(agent).insert(Restless);
        } else {
            // Removed rather than left stale. Nothing depends on that
            // today - `wander`'s filters exclude an agent that has a
            // target - but a marker that means "nothing is worth doing"
            // sitting on a sim walking to the fridge is a lie waiting
            // for its second reader.
            commands.entity(agent).remove::<Restless>();
        }

        if candidates.is_empty() {
            continue;
        }

        // The draw. **Nothing between building `candidates` and this line
        // may reorder it**: its order is the bucket order `sample_softmax`
        // documents, and it is the object-index order the sort above
        // established. The `swap_remove` afterwards does reorder it, which
        // is harmless only because the vector is dropped on the next
        // iteration - move it above the draw and the determinism goes with
        // it.
        let scores: Vec<f32> = candidates.iter().map(|(_, _, _, score)| *score).collect();
        let picked = sample_softmax(&scores, temperature, &mut rng);
        let (object, steps, interaction, _) = candidates.swap_remove(picked);

        claimed.push(object);
        commands.entity(object).insert(Reserved);
        commands.entity(agent).insert((
            Target {
                object,
                interaction,
            },
            Path { steps, cursor: 0 },
        ));
    }
}

#[cfg(test)]
mod intent_tests {
    //! [D-3]'s autonomy override, tested end to end through the running
    //! schedule rather than by calling [`serve_intents`] directly.
    //!
    //! Every fixture here runs at `tests::DECISIVE_TEMPERATURE`
    //! wherever it names an autonomous winner, for the reason that
    //! constant documents: selection is a weighted draw, so "autonomy
    //! would have picked the fridge" is a statement about one roll of the
    //! dice unless the loser's weight underflows to zero. Each such test
    //! asserts that precondition with `assert_decisive` rather than
    //! assuming it, and most also RUN the control - the same world with
    //! no intent queued - so that "the intent won" is measured against
    //! what actually happens without one rather than against a prediction.

    use super::tests::{
        action_threshold, assert_decisive, decisive_pack, def, object_of_width, planned_route,
        spawn_agent, spawn_agent_with, spawn_object, walk_tiles,
    };
    use super::*;
    use crate::test_content;
    use crate::Sim;
    use terri_core::{Intent, IntentQueue, NEED_MAX};
    use terri_data::ContentPack;

    /// The two objects every fixture below chooses between: a fridge on
    /// the agent's right that autonomy wants, and a bed on its left that
    /// it does not.
    ///
    /// They advertise DIFFERENT needs on purpose. An intent that beat a
    /// candidate advertising the same need would only show that the
    /// override outranks a rival for the same appetite; the point of
    /// [D-3] is that it outranks whatever the sim thought was most
    /// urgent, full stop.
    const DELTA: f32 = 40.0;
    const DURATION: u32 = 15;
    const AGENT_AT: (f32, f32) = (8.0, 8.0);
    const FRIDGE_AT: (f32, f32) = (11.0, 8.0);
    const BED_AT: (f32, f32) = (2.0, 8.0);
    /// Hunger and energy levels that survive one tick of decay as
    /// deficits of exactly 0.8 and 0.5. The spawn helper adds one tick's
    /// worth of each need's OWN rate, because the rates differ.
    const HUNGRY: f32 = 20.0;
    const RESTED_ENOUGH: f32 = 50.0;

    fn directed_content() -> &'static ContentPack {
        decisive_pack(vec![
            test_content::object("fridge", &[(NeedId::Hunger, DELTA)], DURATION),
            test_content::object("bed", &[(NeedId::Energy, DELTA)], DURATION),
        ])
    }

    /// Needs leaving the agent hungrier than it is tired, so autonomy has
    /// an unambiguous preference for the fridge.
    fn hungry_and_tired() -> Needs {
        let mut needs = Needs::all_at(NEED_MAX);
        needs.set(
            NeedId::Hunger,
            HUNGRY + test_content::decay_per_tick(NeedId::Hunger),
        );
        needs.set(
            NeedId::Energy,
            RESTED_ENOUGH + test_content::decay_per_tick(NeedId::Energy),
        );
        needs
    }

    /// The world both halves of the core test share: a bed the agent
    /// walks past and a fridge it wants.
    ///
    /// **The bed is spawned FIRST**, so it holds the lower entity index
    /// and therefore the first probability bucket. Any mutation that
    /// flattens the two scores into a tie hands the bed the autonomous
    /// win, which fails the control run rather than passing on a tie the
    /// fixture never meant to create.
    fn two_object_scenario() -> (Sim, Entity, Entity, Entity) {
        let content = directed_content();
        let mut sim = test_content::sim_with(16, 16, content);
        let bed = spawn_object(&mut sim, BED_AT.0, BED_AT.1, def(content, "bed"));
        let fridge = spawn_object(&mut sim, FRIDGE_AT.0, FRIDGE_AT.1, def(content, "fridge"));
        let agent = spawn_agent_with(&mut sim, AGENT_AT.0, AGENT_AT.1, hungry_and_tired());
        (sim, bed, fridge, agent)
    }

    /// Puts one intent at the back of `agent`'s queue, giving it a queue
    /// if it has never been directed before.
    ///
    /// This is what `drain_commands` will do in Task 5. An agent does not
    /// carry an `IntentQueue` until something directs it, so the absent
    /// case is the normal one rather than an edge case.
    fn queue_intent(sim: &mut Sim, agent: Entity, object: Entity, interaction: u32) {
        let intent = Intent {
            object,
            interaction,
        };
        let mut entity = sim.world_mut().entity_mut(agent);
        if let Some(mut queue) = entity.get_mut::<IntentQueue>() {
            queue.push(intent);
            return;
        }
        entity.insert(IntentQueue::from_intents(vec![intent]));
    }

    fn queue_of(sim: &Sim, agent: Entity) -> &IntentQueue {
        sim.world()
            .get::<IntentQueue>(agent)
            .expect("the agent must have been directed at least once")
    }

    fn target_of(sim: &Sim, agent: Entity) -> Option<Target> {
        sim.world().get::<Target>(agent).copied()
    }

    /// **The footprint reaches `serve_intents` too**, which is a *separate*
    /// call to `find_path_adjacent` in a separate system: a player clicking a
    /// wide object must get the same arrival tile autonomy would have chosen,
    /// and a footprint dropped from one of the two call sites leaves the other
    /// one green. `selection_paths_beside_a_wide_objects_far_edge_rather_than_round_to_its_origin`
    /// in `tests` is the other half, and carries the geometry.
    ///
    /// The agent is spawned SATISFIED, so autonomy scores the object below
    /// `action_threshold` and would never target it. The control run measures
    /// that rather than predicting it: no intent, no `Target`. It checks the
    /// `Target` rather than the path because `wander` does hand a restless
    /// agent a `Path` - a wander is a path from nowhere in particular, and
    /// only `serve_intents` and `select_action` write a `Target`.
    #[test]
    fn a_directed_sim_paths_beside_a_wide_objects_far_edge_as_well() {
        let content = decisive_pack(vec![object_of_width(2)]);

        let mut control = test_content::sim_with(16, 16, content);
        spawn_object(&mut control, 4.0, 8.0, def(content, "wide"));
        let idle = spawn_agent(&mut control, 10.0, 8.0, NEED_MAX);
        control.tick();
        assert!(
            target_of(&control, idle).is_none(),
            "a satisfied agent must not target the object on its own, or the \
             route below could be autonomy's rather than the player's"
        );

        let mut sim = test_content::sim_with(16, 16, content);
        let object = spawn_object(&mut sim, 4.0, 8.0, def(content, "wide"));
        let agent = spawn_agent(&mut sim, 10.0, 8.0, NEED_MAX);
        queue_intent(&mut sim, agent, object, 0);
        sim.tick();

        assert_eq!(
            target_of(&sim, agent).map(|t| t.object),
            Some(object),
            "the intent must have been served"
        );
        let route = planned_route(&sim, agent);
        assert_eq!(
            *route.last().unwrap(),
            (6, 8),
            "a directed sim must stop beside the object's FAR tile too; a \
             1x1 footprint here sends it to (5, 8), onto the object. Got \
             {route:?}"
        );
        assert_eq!(route.len(), 4, "which is four tiles, not five");
    }

    /// Ticks until the agent is mid-interaction, or fails loudly.
    fn tick_until_eating(sim: &mut Sim, agent: Entity) -> Eating {
        for _ in 0..400 {
            sim.tick();
            if let Some(eating) = sim.world().get::<Eating>(agent) {
                return *eating;
            }
        }
        panic!("the agent must reach its object and begin interacting");
    }

    /// The scores autonomy computes for the two objects at the deficits
    /// the fixture produces, restated here rather than read out of the
    /// system so that a mutation of the metric does not follow them.
    fn fridge_and_bed_scores(sim: &Sim, agent: Entity) -> (f32, f32) {
        let needs = sim
            .world()
            .get::<Needs>(agent)
            .expect("the agent must still have Needs");
        (
            score_advertisement(
                needs.deficit(NeedId::Hunger),
                DELTA,
                DURATION,
                walk_tiles(AGENT_AT, FRIDGE_AT),
            ),
            score_advertisement(
                needs.deficit(NeedId::Energy),
                DELTA,
                DURATION,
                walk_tiles(AGENT_AT, BED_AT),
            ),
        )
    }

    /// Asserts the fixture really does give autonomy an unambiguous
    /// preference for the fridge, at the numbers the run just produced.
    ///
    /// Without this the milestone's headline test would be satisfiable by
    /// a world in which the bed was the autonomous choice anyway, which
    /// is [L34] in the shape this milestone can most easily produce:
    /// selection is probabilistic now, so "autonomy would have picked the
    /// fridge" is a claim about a distribution unless the fixture makes
    /// it a certainty.
    fn assert_autonomy_prefers_the_fridge(sim: &Sim, agent: Entity) {
        let (fridge_score, bed_score) = fridge_and_bed_scores(sim, agent);
        assert!(
            bed_score > action_threshold(),
            "the BED must be worth doing on its own, or the intent below \
             beats an option autonomy had already excluded and this proves \
             nothing about overriding a choice; got {bed_score}"
        );
        assert!(
            fridge_score > bed_score,
            "autonomy must prefer the fridge, or there is nothing for the \
             intent to override; {fridge_score} vs {bed_score}"
        );
        assert_decisive(fridge_score, bed_score);
    }

    #[test]
    fn a_queued_intent_suppresses_autonomy() {
        // **The test the task exists for.** Directing a sim must beat
        // autonomy or clicking feels ignored, so `select_action` runs only
        // for agents whose queue is empty and `serve_intents` turns the
        // front intent into the target instead.
        //
        // The control run is not decoration. Selection is a weighted draw
        // since M1c, so "autonomy alone would have picked the fridge" is a
        // statement about probability rather than about this world - and a
        // fixture in which the bed won anyway would make the assertion
        // below true for entirely the wrong reason. The control run is the
        // same world with the same seed and one difference, which is
        // docs/testing-protocol.md rule 4 applied to a whole system.
        let (mut control, _, control_fridge, control_agent) = two_object_scenario();
        control.tick();
        assert_autonomy_prefers_the_fridge(&control, control_agent);
        assert_eq!(
            target_of(&control, control_agent).map(|t| t.object),
            Some(control_fridge),
            "with no intent queued the sim must go to the fridge, or the \
             fixture is not one in which an intent has anything to override"
        );

        let (mut sim, bed, fridge, agent) = two_object_scenario();
        queue_intent(&mut sim, agent, bed, 0);

        sim.tick();

        assert_autonomy_prefers_the_fridge(&sim, agent);
        let target = target_of(&sim, agent).expect("a target was chosen");
        assert_eq!(
            target.object, bed,
            "the queued intent must win over autonomy; the fridge winning \
             means selection still ran for a directed agent"
        );
        assert_eq!(target.interaction, 0);
        assert!(
            sim.world().get::<Reserved>(bed).is_some(),
            "the directed object must be reserved, or another agent could \
             be sent to the same slot"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_none(),
            "the object autonomy wanted must be left free"
        );
        assert!(
            sim.world().get::<Path>(agent).is_some(),
            "the sim must actually set off for the bed"
        );
    }

    #[test]
    fn a_sim_waiting_for_a_reserved_object_does_not_fall_back_to_autonomy() {
        // **The only test that can see `select_action`'s empty-queue
        // filter**, and it exists because every other test in this module
        // would stay green with that filter deleted.
        //
        // The reason is worth stating rather than discovering later.
        // `serve_intents` runs first and normally converts the intent into
        // a `Target`, and `select_action`'s query already excludes an
        // agent that has one - so the suppression is achieved twice over
        // and the explicit filter never decides anything. The exception is
        // an intent that could not be served THIS tick: the object is
        // reserved by somebody else, so the sim waits, and for that one
        // tick it has no target, no interaction, and an instruction it
        // still means to carry out. Delete the filter and it wanders off
        // to the fridge instead.
        //
        // Both halves are asserted. Waiting is not the same as doing
        // nothing at all, so the control run below shows the sim would
        // have acted.
        let content = directed_content();

        let build = || {
            let mut sim = test_content::sim_with(16, 16, content);
            let bed = spawn_object(&mut sim, BED_AT.0, BED_AT.1, def(content, "bed"));
            let fridge = spawn_object(&mut sim, FRIDGE_AT.0, FRIDGE_AT.1, def(content, "fridge"));
            let agent = spawn_agent_with(&mut sim, AGENT_AT.0, AGENT_AT.1, hungry_and_tired());
            // Somebody else is using the bed. One sim ships in M1b, so
            // the reservation is placed directly rather than by spawning
            // a second agent to make it - what matters to `serve_intents`
            // is that the marker is there and is not this agent's.
            sim.world_mut().entity_mut(bed).insert(Reserved);
            (sim, bed, fridge, agent)
        };

        let (mut control, _, control_fridge, control_agent) = build();
        control.tick();
        assert_eq!(
            target_of(&control, control_agent).map(|t| t.object),
            Some(control_fridge),
            "with no intent queued the sim must take the fridge, or \
             'it did not fall back to autonomy' is satisfied by a world \
             where autonomy had nothing to offer"
        );

        let (mut sim, bed, fridge, agent) = build();
        queue_intent(&mut sim, agent, bed, 0);

        sim.tick();

        assert_eq!(
            target_of(&sim, agent),
            None,
            "a sim waiting its turn must not be handed a different object; \
             autonomy ran for an agent that is under orders"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_none(),
            "the fridge must be left free, since nothing chose it"
        );
        assert!(
            sim.world().get::<Path>(agent).is_none(),
            "the sim must stand and wait rather than set off somewhere"
        );
        assert!(
            sim.world().get::<Restless>(agent).is_none(),
            "a sim under orders is not a sim with nothing to do; a \
             `Restless` marker here would send it wandering while it waits"
        );
        assert_eq!(
            queue_of(&sim, agent).front(),
            Some(Intent {
                object: bed,
                interaction: 0,
            }),
            "the intent must be KEPT: a reservation ends on its own, so \
             discarding it would silently ignore a click on a busy object"
        );
    }

    #[test]
    fn a_queued_intent_preempts_an_interaction_already_under_way() {
        // **The feel decision this task had to make.** The alpha pass
        // measured a 24-second sleep, so an intent that queued behind a
        // running interaction would leave a click with no visible
        // response for half a minute - which is the failure [D-3] exists
        // to prevent, arriving by a different route. An in-progress
        // autonomous action is still autonomy, so the intent takes over.
        //
        // The agent is spawned ON the fridge so it is mid-meal after one
        // tick, and the remaining duration is asserted before the intent
        // is queued: without that, "the interaction ended" would be
        // satisfied by it simply having run out.
        let content = directed_content();
        let mut sim = test_content::sim_with(16, 16, content);
        let bed = spawn_object(&mut sim, BED_AT.0, BED_AT.1, def(content, "bed"));
        let fridge = spawn_object(&mut sim, FRIDGE_AT.0, FRIDGE_AT.1, def(content, "fridge"));
        let agent = spawn_agent_with(&mut sim, FRIDGE_AT.0, FRIDGE_AT.1, hungry_and_tired());

        let eating = tick_until_eating(&mut sim, agent);
        assert_eq!(
            target_of(&sim, agent).map(|t| t.object),
            Some(fridge),
            "the sim must have chosen the fridge for itself"
        );
        assert!(
            eating.remaining_ticks > 1,
            "the interaction must have real time left on it, or 'it \
             stopped' is satisfied by it finishing on its own; got {}",
            eating.remaining_ticks
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_some(),
            "the fridge must be reserved before the intent arrives, or the \
             release below is unobservable"
        );

        queue_intent(&mut sim, agent, bed, 0);
        sim.tick();

        assert!(
            sim.world().get::<Eating>(agent).is_none(),
            "the interaction under way must be abandoned; a sim that \
             finishes its meal first leaves the player's click looking lost"
        );
        assert_eq!(
            target_of(&sim, agent).map(|t| t.object),
            Some(bed),
            "the intent must become the new target"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_none(),
            "the abandoned object's reservation must be released, or the \
             fridge is claimed for ever by a sim that walked away from it"
        );
        assert!(
            sim.world().get::<Reserved>(bed).is_some(),
            "the newly directed object must be reserved"
        );
    }

    #[test]
    fn a_queued_intent_preempts_a_wander() {
        // A wandering sim is not idle in the old sense: it holds a `Path`
        // and it is `Restless`, and neither of those clears itself while
        // it walks. So "the intent beats autonomy" has to be shown
        // against a stroll as well as against a meal - [D-5] made this a
        // live state on almost every free tick, and the two are reached by
        // different branches of `serve_intents`.
        //
        // A sated sim has nothing worth doing, which is exactly the
        // condition `wander` waits for.
        let content = directed_content();
        let mut sim = test_content::sim_with(16, 16, content);
        let bed = spawn_object(&mut sim, BED_AT.0, BED_AT.1, def(content, "bed"));
        let _fridge = spawn_object(&mut sim, FRIDGE_AT.0, FRIDGE_AT.1, def(content, "fridge"));
        let agent = spawn_agent_with(&mut sim, AGENT_AT.0, AGENT_AT.1, Needs::all_at(NEED_MAX));

        // Tick until the sim is genuinely mid-stroll rather than assuming
        // it is: a path with no target is what a wander looks like from
        // outside.
        let mut wandering = false;
        for _ in 0..40 {
            sim.tick();
            if sim.world().get::<Path>(agent).is_some() && target_of(&sim, agent).is_none() {
                wandering = true;
                break;
            }
        }
        assert!(
            wandering,
            "the sated sim must be wandering before the intent arrives, or \
             this test is a second copy of the suppression one"
        );
        assert!(
            sim.world().get::<Restless>(agent).is_some(),
            "a wandering sim carries `Restless`, and that marker is what \
             the intent has to clear"
        );

        queue_intent(&mut sim, agent, bed, 0);
        sim.tick();

        assert_eq!(
            target_of(&sim, agent).map(|t| t.object),
            Some(bed),
            "the intent must interrupt the stroll on the very next tick"
        );
        assert!(
            sim.world().get::<Restless>(agent).is_none(),
            "a directed sim is not a sim with nothing to do; leaving \
             `Restless` set means it would be sent for another stroll the \
             moment the walk ends"
        );

        // And it actually gets there, which is what rules out a target
        // that is overwritten by a fresh wander a few ticks later.
        let eating = tick_until_eating(&mut sim, agent);
        assert_eq!(
            eating.object,
            def(content, "bed"),
            "the sim must arrive at the object the player picked"
        );
    }

    #[test]
    fn completing_a_directed_interaction_pops_the_intent_and_returns_the_sim_to_autonomy() {
        // The other end of the intent's life. [D-3] says an intent
        // suppresses autonomy "until it completes or is cancelled", so the
        // front entry has to survive the whole walk and the whole
        // interaction and then go.
        //
        // Two failures this rules out, and they are opposite. Popping too
        // early - on arrival, say - would let autonomy re-decide mid-meal.
        // Never popping would make one click a loop: the sim would finish,
        // be re-served the same intent, and use the bed for ever while the
        // player wondered why it was ignoring a fridge three tiles away.
        let (mut sim, bed, fridge, agent) = two_object_scenario();
        queue_intent(&mut sim, agent, bed, 0);

        sim.tick();
        assert_eq!(
            queue_of(&sim, agent).len(),
            1,
            "the intent must survive being served; it is the sim's \
             standing commitment, not a one-tick trigger"
        );

        let eating = tick_until_eating(&mut sim, agent);
        assert_eq!(eating.object, def(content_of(&sim), "bed"));
        assert_eq!(
            queue_of(&sim, agent).len(),
            1,
            "the intent must still be held while the interaction runs"
        );

        // Run the interaction out. The bound is a runaway detector rather
        // than an assertion about duration, which [D-4] made a sampled
        // value.
        let mut finished = false;
        for _ in 0..1024 {
            sim.tick();
            if sim.world().get::<Eating>(agent).is_none() {
                finished = true;
                break;
            }
        }
        assert!(finished, "the directed interaction must terminate");
        assert!(
            queue_of(&sim, agent).is_empty(),
            "completing the interaction must pop the intent, or one click \
             becomes a loop"
        );

        // Autonomy resumes, and it resumes on the thing it wanted all
        // along. Hunger has only grown while the sim slept.
        let mut chose_the_fridge = false;
        for _ in 0..200 {
            sim.tick();
            if target_of(&sim, agent).map(|t| t.object) == Some(fridge) {
                chose_the_fridge = true;
                break;
            }
        }
        assert!(
            chose_the_fridge,
            "the sim must choose for itself again once the intent is done; \
             still being pinned to the bed means the queue never emptied"
        );
        assert!(
            sim.world().get::<Reserved>(bed).is_none(),
            "the finished object must be released"
        );
    }

    /// The pack a running sim is reading, for tests that need to resolve a
    /// definition id after the world is built.
    fn content_of(sim: &Sim) -> &'static ContentPack {
        sim.world().resource::<Content>().0
    }

    #[test]
    fn an_intent_to_an_unreachable_object_is_dropped_so_the_sim_does_not_stall() {
        // An intent that can never be served must not suppress autonomy
        // for ever. The sim would stand still while its needs drained,
        // with no panic and no log - [L17]'s frozen agent, reached by a
        // click instead of by a bad distance metric.
        //
        // Dropping it in the same tick is what lets autonomy pick up
        // immediately, which is the observable half: "the queue is empty"
        // alone would also be satisfied by a queue that never took the
        // intent at all.
        const AGENT_AT: (f32, f32) = (5.0, 3.0);
        const SEALED_AT: (f32, f32) = (9.0, 3.0);
        const REACHABLE_AT: (f32, f32) = (2.0, 3.0);

        let content = test_content::pack(vec![test_content::object(
            "identical",
            &[(NeedId::Hunger, DELTA)],
            DURATION,
        )]);
        let mut sim = test_content::sim_with(11, 7, content);
        {
            let mut grid = sim
                .world_mut()
                .get_resource_mut::<TileGrid>()
                .expect("Sim::new inserts a TileGrid");
            for y in 0..7 {
                grid.set_blocked(8, y, true);
            }
        }
        let identical = def(content, "identical");
        let sealed = spawn_object(&mut sim, SEALED_AT.0, SEALED_AT.1, identical);
        let reachable = spawn_object(&mut sim, REACHABLE_AT.0, REACHABLE_AT.1, identical);
        let agent = spawn_agent(&mut sim, AGENT_AT.0, AGENT_AT.1, HUNGRY);

        // Precondition: the sealed object really is sealed, and the other
        // really is not.
        let grid = sim.world().resource::<TileGrid>();
        assert_eq!(
            grid.find_path((5, 3), (9, 3)),
            None,
            "the intended object must be genuinely unreachable"
        );
        assert!(grid.find_path((5, 3), (2, 3)).is_some());

        queue_intent(&mut sim, agent, sealed, 0);
        sim.tick();

        assert!(
            queue_of(&sim, agent).is_empty(),
            "an intent nothing can ever serve must be dropped, or the sim \
             stands still for ever while its needs drain"
        );
        assert_eq!(
            target_of(&sim, agent).map(|t| t.object),
            Some(reachable),
            "autonomy must pick up in the same tick the intent is dropped"
        );
    }

    #[test]
    fn an_intent_naming_a_despawned_object_is_dropped_rather_than_panicking() {
        // The index a `UseObject` command carries comes from JavaScript
        // and is resolved to an `Entity` at the boundary, but an entity
        // that was alive when the command was enqueued can be gone by the
        // time the intent reaches the front of the queue. A panic inside
        // the WASM module traps it for the rest of the page's life, so
        // this must be a no-op rather than a crash ([L12], and the same
        // reasoning as `spawn_object`'s rejection path).
        let content = test_content::pack(vec![test_content::object(
            "identical",
            &[(NeedId::Hunger, DELTA)],
            DURATION,
        )]);
        let mut sim = test_content::sim_with(16, 16, content);
        let identical = def(content, "identical");
        let doomed = spawn_object(&mut sim, BED_AT.0, BED_AT.1, identical);
        let survivor = spawn_object(&mut sim, FRIDGE_AT.0, FRIDGE_AT.1, identical);
        let agent = spawn_agent(&mut sim, AGENT_AT.0, AGENT_AT.1, HUNGRY);

        queue_intent(&mut sim, agent, doomed, 0);
        assert!(
            sim.world_mut().despawn(doomed),
            "the object must actually be despawned or this test is about a \
             live entity"
        );

        sim.tick();

        assert!(
            queue_of(&sim, agent).is_empty(),
            "an intent naming an entity that no longer exists must be \
             dropped"
        );
        assert_eq!(
            target_of(&sim, agent).map(|t| t.object),
            Some(survivor),
            "and the sim must go back to choosing for itself"
        );
    }

    #[test]
    fn an_intent_for_another_interaction_on_the_object_in_use_keeps_the_reservation() {
        // The one branch that is neither "serve" nor "wait": the object
        // the player picked is already reserved, and the reservation is
        // this agent's OWN. Without the `held_here` clause the sim would
        // read its own claim as contention and wait for itself for ever,
        // which is a deadlock a player could reach by clicking twice on
        // the thing their sim is already using.
        const OBJECT_AT: (f32, f32) = (11.0, 8.0);
        let content = decisive_pack(vec![test_content::object_offering(
            "larder",
            vec![
                // The stronger interaction is FIRST, so autonomy picks
                // index 0 and the intent below is a genuine change.
                test_content::interaction("feast", &[(NeedId::Hunger, DELTA)], DURATION),
                test_content::interaction("nibble", &[(NeedId::Hunger, DELTA / 2.0)], DURATION),
            ],
        )]);
        let mut sim = test_content::sim_with(16, 16, content);
        let larder = spawn_object(&mut sim, OBJECT_AT.0, OBJECT_AT.1, def(content, "larder"));
        let agent = spawn_agent(&mut sim, OBJECT_AT.0, OBJECT_AT.1, HUNGRY);

        let eating = tick_until_eating(&mut sim, agent);
        assert_eq!(
            eating.interaction, 0,
            "autonomy must have picked the stronger interaction, or the \
             intent below is not a change"
        );
        assert!(sim.world().get::<Reserved>(larder).is_some());

        queue_intent(&mut sim, agent, larder, 1);
        sim.tick();

        let target = target_of(&sim, agent).expect("the sim must still be on the larder");
        assert_eq!(target.object, larder);
        assert_eq!(
            target.interaction, 1,
            "the intent must switch which interaction is performed"
        );
        assert!(
            sim.world().get::<Reserved>(larder).is_some(),
            "the reservation must be kept across the switch, or the object \
             is briefly free for somebody else to take out from under a sim \
             standing on it"
        );
        assert_eq!(
            sim.world().get::<Eating>(agent).map(|e| e.interaction),
            Some(1),
            "the sim is already standing on the object, so the new \
             interaction begins on the same tick"
        );
    }

    #[test]
    fn an_intent_naming_an_interaction_the_object_does_not_have_is_dropped() {
        // `follow_path` and `tick_interactions` both index straight into
        // `interactions` with this number, so an out-of-range index would
        // be a panic two systems away from where it entered. It cannot
        // come from a live click, but a command log recorded against an
        // older pack is exactly [D8]'s save model.
        let content = test_content::pack(vec![test_content::object(
            "identical",
            &[(NeedId::Hunger, DELTA)],
            DURATION,
        )]);
        let mut sim = test_content::sim_with(16, 16, content);
        let identical = def(content, "identical");
        let object = spawn_object(&mut sim, FRIDGE_AT.0, FRIDGE_AT.1, identical);
        let agent = spawn_agent(&mut sim, AGENT_AT.0, AGENT_AT.1, HUNGRY);
        assert_eq!(
            content.object(identical).interactions.len(),
            1,
            "index 1 must be out of range for this fixture"
        );

        queue_intent(&mut sim, agent, object, 1);
        sim.tick();

        assert!(
            queue_of(&sim, agent).is_empty(),
            "an intent naming an interaction that does not exist must be \
             dropped rather than carried into a panic"
        );
        assert_eq!(
            target_of(&sim, agent).map(|t| t.interaction),
            Some(0),
            "and the sim must choose an interaction that does exist"
        );
    }

    /// The order `serve_intents`'s query yields directed agents in, with
    /// no sorting applied - precisely the order the winner must NOT
    /// depend on.
    ///
    /// The fetch and filter match that system's query, so this reports the
    /// order it would see rather than a different query's order that
    /// happens to agree today. Modelled on `raw_object_order`.
    #[allow(clippy::type_complexity)]
    fn raw_directed_order(sim: &Sim) -> Vec<u32> {
        let mut state = sim
            .world()
            .try_query_filtered::<(Entity, &Position, &IntentQueue, Option<&Target>), With<Agent>>()
            .expect("every component in the intent query is registered in Sim::new");
        state
            .iter(sim.world())
            .map(|(entity, _, _, _)| entity.index_u32())
            .collect()
    }

    #[test]
    fn two_sims_intending_one_object_resolve_by_entity_order_not_archetype_order() {
        // `serve_intents` writes contended state - a reservation - so the
        // order it visits agents in decides who gets the object, and query
        // iteration is archetype order rather than simulation state. Same
        // rule and same reason as the sorts in `select_action`,
        // `follow_path` and `wander`; see [D-3] and [L5].
        //
        // `cargo mutants` cannot see a `sort_by_key` at all - a statement
        // whose only effect is on state is outside its grammar - so this
        // test is the only thing standing between that line and someone
        // deleting it as tidiness. docs/testing-protocol.md rule 2.
        //
        // It pins the `claimed` list too, and that half is separable: the
        // reservation the first agent takes is queued through `Commands`,
        // so the `Has<Reserved>` read cannot see it within the same tick.
        // Without `claimed` both agents would be sent to the same slot.
        let content = test_content::pack(vec![test_content::object(
            "identical",
            &[(NeedId::Hunger, DELTA)],
            DURATION,
        )]);
        let mut sim = test_content::sim_with(16, 16, content);
        let object = spawn_object(&mut sim, 5.0, 5.0, def(content, "identical"));
        let first = spawn_agent(&mut sim, 1.0, 1.0, HUNGRY);
        let second = spawn_agent(&mut sim, 2.0, 1.0, HUNGRY);
        assert!(
            first.index() < second.index(),
            "spawn order sets the indices"
        );

        queue_intent(&mut sim, first, object, 0);
        queue_intent(&mut sim, second, object, 0);

        // Archetype churn, which is how it happens for real: an agent
        // leaves and re-enters its table every time it starts or stops
        // eating, and leaving swap-removes it while re-entering appends
        // it at the back. So the lower-indexed agent now iterates LAST.
        sim.world_mut().entity_mut(first).insert(Eating {
            object: def(content, "identical"),
            interaction: 0,
            remaining_ticks: 1,
        });
        sim.world_mut().entity_mut(first).remove::<Eating>();

        // The precondition that makes the churn real. Without it this
        // test would pass with the sort deleted, per [L5].
        let iteration_order = raw_directed_order(&sim);
        let mut index_order = iteration_order.clone();
        index_order.sort_unstable();
        assert_ne!(
            iteration_order, index_order,
            "the query must yield the directed agents in an order that is \
             NOT index order, or the sort has nothing to do; got \
             {iteration_order:?}"
        );

        sim.tick();

        assert_eq!(
            target_of(&sim, first).map(|t| t.object),
            Some(object),
            "the lowest entity index must win the contended object \
             regardless of table order; the other agent winning means the \
             deterministic sort is gone"
        );
        assert_eq!(
            target_of(&sim, second),
            None,
            "exactly one agent may claim a single-slot object, and the \
             loser must not be handed it as well; a target here means the \
             same-tick claim list is gone"
        );
        assert_eq!(
            queue_of(&sim, second).len(),
            1,
            "the agent that lost the race must keep its intent and wait"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_content;
    use crate::Sim;
    use terri_core::ObjectDefId;
    use terri_data::{CompiledObject, ContentPack, Tuning};

    /// The advert used wherever two candidates must be indistinguishable
    /// apart from where they stand, so the only thing that can decide
    /// between them is the distance term. These are the shipped fridge's
    /// numbers, so the tests below score the magnitudes the game
    /// actually produces.
    const IDENTICAL_DELTA: f32 = 40.0;
    const IDENTICAL_DURATION: u32 = 15;

    /// The temperature every GOLDEN-winner fixture in this module runs
    /// at, and the reason those tests did not have to change shape when
    /// selection stopped being an argmax.
    ///
    /// Selection is a WEIGHTED DRAW now. At the shipped temperature a
    /// better candidate merely wins *more often*, so "the near object
    /// won" would be an assertion about one roll of the dice - true for
    /// this seed, false for the next, and green either way for reasons
    /// that have nothing to do with what the test is about. Those tests
    /// are about SCORING, so they hold the draw constant and vary the
    /// scores, which is docs/testing-protocol.md rule 4 applied to a
    /// knob rather than to a guard.
    ///
    /// Low rather than zero because zero is not valid content:
    /// `compile_tuning` rejects a non-positive temperature, since
    /// selection divides by it. [`assert_decisive`] is what checks that
    /// this particular value is low enough for a given pair of scores,
    /// rather than leaving "low enough" as a hope.
    ///
    /// **The distribution tests deliberately do NOT use it.** They run at
    /// the shipped temperature, because a fixture that makes the choice
    /// certain is a fixture that cannot see the milestone's whole point.
    pub(super) const DECISIVE_TEMPERATURE: f32 = 0.0001;

    /// The shipped knobs with the temperature turned down.
    ///
    /// Spread from [`test_content::tuning`] rather than written out, so
    /// `action_threshold` and everything else stay exactly what the game
    /// runs on and only the one knob under test moves.
    fn decisive_tuning() -> Tuning {
        Tuning {
            choice_temperature: DECISIVE_TEMPERATURE,
            ..test_content::tuning()
        }
    }

    pub(super) fn decisive_pack(objects: Vec<CompiledObject>) -> &'static ContentPack {
        test_content::pack_tuned(objects, decisive_tuning())
    }

    /// Asserts the fixture makes the draw a formality, so a golden winner
    /// assertion below is a statement about scoring rather than about one
    /// roll of the dice.
    ///
    /// The criterion is exact rather than probabilistic: the loser's
    /// softmax weight has to UNDERFLOW to zero in `f32`, which happens
    /// once `(winner - loser) / T` exceeds about 104. The winner's bucket
    /// then covers the entire `[0, total)` interval, so every draw
    /// `next_f32` can produce picks it - there is no tail to be unlucky
    /// in. A merely small weight would leave one.
    ///
    /// This is also what stops `DECISIVE_TEMPERATURE` from silently
    /// becoming too high for some future fixture whose two candidates sit
    /// closer together: that fixture fails here, naming the numbers,
    /// rather than becoming intermittently wrong.
    pub(super) fn assert_decisive(winner_score: f32, loser_score: f32) {
        assert!(
            winner_score > loser_score,
            "the intended winner must actually score higher; \
             {winner_score} vs {loser_score}"
        );
        let weight = ((loser_score - winner_score) / DECISIVE_TEMPERATURE).exp();
        assert_eq!(
            weight, 0.0,
            "at temperature {DECISIVE_TEMPERATURE} the losing candidate \
             still carries weight {weight}, so the winner below is a draw \
             rather than a conclusion; scores were {winner_score} and \
             {loser_score}"
        );
    }

    /// One definition with that advert. Two placed entities can share a
    /// single definition, which is precisely what "two objects with
    /// identical adverts" means once the advert lives in the pack.
    ///
    /// At the SHIPPED temperature, for the tie and contention tests. Two
    /// bit-identical scores weigh the same at every temperature, so
    /// turning it down would change nothing for them and would only hide
    /// that they run on the knob the game runs on.
    fn identical_advert_content() -> &'static ContentPack {
        test_content::pack(vec![identical_object()])
    }

    /// The same content at [`DECISIVE_TEMPERATURE`], for the tests whose
    /// two candidates score DIFFERENTLY and which name a winner.
    fn decisive_identical_advert_content() -> &'static ContentPack {
        decisive_pack(vec![identical_object()])
    }

    fn identical_object() -> CompiledObject {
        test_content::object(
            "identical",
            &[(NeedId::Hunger, IDENTICAL_DELTA)],
            IDENTICAL_DURATION,
        )
    }

    /// The threshold `select_action` actually compares against.
    ///
    /// Read from content rather than restated as `0.05`, because the
    /// threshold is TUNING now: it lives in `content/tuning.toml` per
    /// [D-1], and `test_content::pack` copies the shipped knobs into
    /// every fixture in this module, so this is the same number the
    /// system used on the tick each test just ran. A literal here would
    /// leave every precondition below green while silently no longer
    /// testing the real threshold, from the first time anybody tunes it.
    pub(super) fn action_threshold() -> f32 {
        test_content::tuning().action_threshold
    }

    pub(super) fn def(content: &ContentPack, id: &str) -> ObjectDefId {
        content
            .find(id)
            .unwrap_or_else(|| panic!("the fixture must declare '{id}'"))
    }

    pub(super) fn spawn_object(sim: &mut Sim, x: f32, y: f32, def: ObjectDefId) -> Entity {
        sim.world_mut()
            .spawn((Position { x, y }, SmartObject(def)))
            .id()
    }

    pub(super) fn spawn_agent_with(sim: &mut Sim, x: f32, y: f32, needs: Needs) -> Entity {
        sim.world_mut()
            .spawn((Agent, Position { x, y }, needs))
            .id()
    }

    pub(super) fn spawn_agent(sim: &mut Sim, x: f32, y: f32, hunger: f32) -> Entity {
        spawn_agent_with(sim, x, y, Needs::with(NeedId::Hunger, hunger))
    }

    /// The deficit `select_action` scored with, read back after the tick.
    ///
    /// `decay_needs` runs immediately before `select_action` and nothing
    /// else touches hunger on a tick where the agent only starts walking,
    /// so the post-tick level is exactly the one scoring saw. The agent's
    /// POSITION is not, because `follow_path` runs after selection and
    /// has already moved it, which is why every helper below takes the
    /// spawn coordinates as arguments instead of reading them back.
    fn deficit_after_tick(sim: &Sim, agent: Entity, need: NeedId) -> f32 {
        sim.world()
            .get::<Needs>(agent)
            .expect("the agent must still have Needs")
            .deficit(need)
    }

    /// An independent restatement of the distance `select_action`
    /// measures: the number of tiles the agent actually walks.
    ///
    /// Restating it here rather than calling into the system is the whole
    /// point: a mutation of the production metric does not follow the
    /// helper, so the preconditions keep holding and the golden winner
    /// assertion is what fails. If this ever calls production code the
    /// tests below stop being able to see the bug they exist for.
    ///
    /// **Manhattan distance is the A* path length only on an OPEN grid**,
    /// where the heuristic is exact - `the_heuristic_equals_the_true_cost_on_an_open_grid`
    /// in terri-core's `grid.rs` is what pins that. Every fixture in this
    /// module is an open room except the two walled tests, which state
    /// their path lengths explicitly rather than using this helper.
    ///
    /// The coordinates are rounded first because `select_action` rounds
    /// them to tile indices before pathing.
    /// **One less than the Manhattan distance, because the agent stops
    /// beside the object rather than on it.**
    ///
    /// Selection paths with `find_path_adjacent`, so the walk ends on a
    /// neighbour of the object's tile: on an open grid that is exactly one
    /// step fewer than reaching the tile itself. This helper restates the
    /// metric independently, so it has to restate *that* metric - and the
    /// subtraction is the part a reader will want to query, which is why it is
    /// the first line of this comment rather than a footnote.
    ///
    /// An agent standing **on** the object walks 1, not 0 or -1: it steps off.
    /// That case is the reason for the `max`, and it is reachable - it was the
    /// normal resting state before objects stopped being stood on.
    pub(super) fn walk_tiles(agent_at: (f32, f32), object_at: (f32, f32)) -> f32 {
        let dx = object_at.0.round() - agent_at.0.round();
        let dy = object_at.1.round() - agent_at.1.round();
        (dx.abs() + dy.abs() - 1.0).max(1.0)
    }

    /// An independent restatement of the straight-line distance
    /// `select_action` **used to** measure, kept solely as the
    /// counterfactual the walled tests below assert against.
    ///
    /// Nothing in production computes this any more. Its job is to let a
    /// test say "a Euclidean implementation would have picked the other
    /// one", which is what stops those tests passing for an
    /// implementation that happens to get the right answer.
    fn straight_line(agent_at: (f32, f32), object_at: (f32, f32)) -> f32 {
        let dx = object_at.0 - agent_at.0;
        let dy = object_at.1 - agent_at.1;
        (dx * dx + dy * dy).sqrt()
    }

    /// The score one advertised need contributes, restated for the same
    /// reason as `walk_tiles`.
    fn score_of(
        deficit: f32,
        agent_at: (f32, f32),
        object_at: (f32, f32),
        delta: f32,
        duration_ticks: u32,
    ) -> f32 {
        score_advertisement(
            deficit,
            delta,
            duration_ticks,
            walk_tiles(agent_at, object_at),
        )
    }

    /// The entity indices `select_action`'s object query yields in raw
    /// ECS order, with no sorting applied.
    ///
    /// This is precisely the order the candidate list must NOT be built
    /// in, so comparing it against index order is how the two tie tests
    /// prove they are exercising a real ordering difference - or a real
    /// absence of one - rather than passing decoratively. Modelled on
    /// `raw_iteration_order` in `lib.rs`, which does the same job for the
    /// world hash.
    ///
    /// The fetch and filter match `select_action`'s query exactly, so
    /// this reports the order that system would see rather than a
    /// different query's order that happens to agree today.
    #[allow(clippy::type_complexity)]
    fn raw_object_order(sim: &Sim) -> Vec<u32> {
        let mut state = sim
            .world()
            .try_query_filtered::<(Entity, &Position, &SmartObject), Without<Reserved>>()
            .expect("every component in the object query is registered in Sim::new");
        state
            .iter(sim.world())
            .map(|(entity, _, _)| entity.index_u32())
            .collect()
    }

    /// Asserts that the first draw of `content`'s seeded PRNG lands in
    /// the FIRST of two equal buckets.
    ///
    /// Two bit-identical scores split the interval exactly in half, so
    /// "the lower-index object wins" is only the claim those tests intend
    /// while the draw is below one half. Stating that here turns the
    /// seed from an invisible dependency into a checked precondition: if
    /// `rng_seed` is ever retuned past the halfway point, this fails and
    /// names the reason instead of the two tests silently inverting.
    ///
    /// It is the FIRST draw because selection is the only consumer of the
    /// PRNG so far, and each of those tests has exactly one agent that
    /// chooses on exactly one tick.
    fn assert_first_draw_takes_the_first_of_two_tied_buckets(content: &ContentPack) {
        let draw = SimRng::from_seed(content.tuning.rng_seed).next_f32();
        assert!(
            draw < 0.5,
            "the seeded first draw is {draw}, which lands in the SECOND \
             of two equal buckets, so the golden winner below would be \
             the higher-index object rather than the lower one"
        );
    }

    /// Asserts the single object `agent` chose, with the non-emptiness
    /// guard [L3] requires: "the right one won" must not be satisfiable
    /// by "nothing won at all".
    fn assert_chose(sim: &Sim, agent: Entity, winner: Entity, loser: Entity, why: &str) {
        let target = sim
            .world()
            .get::<Target>(agent)
            .unwrap_or_else(|| panic!("the agent must have chosen an object; {why}"));
        assert_eq!(target.object, winner, "{why}");
        assert!(
            sim.world().get::<Reserved>(winner).is_some(),
            "the winning object must be reserved; {why}"
        );
        assert!(
            sim.world().get::<Reserved>(loser).is_none(),
            "the losing object must stay free; {why}"
        );
    }

    #[test]
    fn distance_counts_the_x_axis_steps_between_agent_and_object() {
        // Two objects advertising exactly the same interaction, both on
        // the agent's own row, three tiles east and seven tiles west. On
        // an open grid the walked path is the Manhattan distance, so the
        // only thing that can separate them here is the number of steps
        // along x.
        //
        // GOLDEN assertion, for the reason spelled out in the tie and
        // contention tests below: do NOT rewrite it as a comparison of
        // two scores or two runs.
        //
        // The mutations this sees, now that the metric is `steps.len()`
        // rather than a subtraction:
        //   - a constant distance, or dropping the distance term from the
        //     score entirely, ties the two candidates;
        //   - measuring only the y axis ties them as well, since both sit
        //     on the agent's row.
        // The far object is spawned FIRST, so it holds the lower entity
        // index and therefore the first probability bucket: a mutation
        // that ties the two scores hands it the win, which turns each of
        // those into a FAILURE here rather than a pass on a tie this test
        // never meant to create.
        let content = decisive_identical_advert_content();
        let mut sim = test_content::sim_with(16, 16, content);
        let identical = def(content, "identical");
        let far = spawn_object(&mut sim, 1.0, 8.0, identical);
        let near = spawn_object(&mut sim, 11.0, 8.0, identical);
        let agent = spawn_agent(&mut sim, 8.0, 8.0, 20.0);

        sim.tick();

        let deficit = deficit_after_tick(&sim, agent, NeedId::Hunger);
        let (near_score, far_score) = (
            score_of(
                deficit,
                (8.0, 8.0),
                (11.0, 8.0),
                IDENTICAL_DELTA,
                IDENTICAL_DURATION,
            ),
            score_of(
                deficit,
                (8.0, 8.0),
                (1.0, 8.0),
                IDENTICAL_DELTA,
                IDENTICAL_DURATION,
            ),
        );
        // Preconditions. Both candidates must be genuinely selectable, or
        // "the near one won" could be satisfied by the far one being
        // ineligible for some unrelated reason.
        // Placed 3 and 7 tiles out; WALKED 2 and 6, because the agent stops
        // beside the object rather than on it.
        assert_eq!(walk_tiles((8.0, 8.0), (11.0, 8.0)), 2.0);
        assert_eq!(walk_tiles((8.0, 8.0), (1.0, 8.0)), 6.0);
        assert!(
            far_score > action_threshold(),
            "the losing object must still clear the threshold, or this \
             test proves nothing about choosing between them; got {far_score}"
        );
        assert!(
            near_score > far_score,
            "identical adverts must score the nearer object higher; \
             {near_score} vs {far_score}"
        );
        assert_decisive(near_score, far_score);

        assert_chose(
            &sim,
            agent,
            near,
            far,
            "the nearer of two identical objects must win; a different \
             winner means the walked distance along x no longer reaches \
             the score",
        );
    }

    #[test]
    fn distance_counts_the_y_axis_steps_between_agent_and_object() {
        // The mirror of the test above, rotated onto the y axis. It is a
        // separate test rather than a second case in the same one because
        // it covers the other half of the same claim: with both
        // candidates on the agent's own COLUMN, only steps along y can
        // separate them.
        //
        // That pairing is what pins the metric being a genuine path
        // length rather than a cheaper one-axis approximation. Measuring
        // `|dx|` alone passes the x-axis test above and ties this one;
        // measuring `|dy|` alone does the reverse. Neither test can see
        // its own blind spot, which is why both exist.
        let content = decisive_identical_advert_content();
        let mut sim = test_content::sim_with(16, 16, content);
        let identical = def(content, "identical");
        let far = spawn_object(&mut sim, 8.0, 1.0, identical);
        let near = spawn_object(&mut sim, 8.0, 11.0, identical);
        let agent = spawn_agent(&mut sim, 8.0, 8.0, 20.0);

        sim.tick();

        let deficit = deficit_after_tick(&sim, agent, NeedId::Hunger);
        let (near_score, far_score) = (
            score_of(
                deficit,
                (8.0, 8.0),
                (8.0, 11.0),
                IDENTICAL_DELTA,
                IDENTICAL_DURATION,
            ),
            score_of(
                deficit,
                (8.0, 8.0),
                (8.0, 1.0),
                IDENTICAL_DELTA,
                IDENTICAL_DURATION,
            ),
        );
        // Placed 3 and 7 tiles out; WALKED 2 and 6, because the agent stops
        // beside the object rather than on it.
        assert_eq!(walk_tiles((8.0, 8.0), (8.0, 11.0)), 2.0);
        assert_eq!(walk_tiles((8.0, 8.0), (8.0, 1.0)), 6.0);
        assert!(
            far_score > action_threshold(),
            "the losing object must still clear the threshold; got {far_score}"
        );
        assert!(
            near_score > far_score,
            "identical adverts must score the nearer object higher; \
             {near_score} vs {far_score}"
        );
        assert_decisive(near_score, far_score);

        assert_chose(
            &sim,
            agent,
            near,
            far,
            "the nearer of two identical objects must win; a different \
             winner means the walked distance along y no longer reaches \
             the score",
        );
    }

    /// A lot with exactly one thing worth doing and two agents that both
    /// want it, plus the tuning that makes the outcome a formality.
    ///
    /// The object is placed so both agents can reach it and the agents are
    /// spawned in a known index order, because which of them wins is
    /// entity-index order by [D4] and the *loser* is what these tests are
    /// about.
    /// The object an agent is currently committed to, if any.
    ///
    /// A local rather than a reach into `intent_tests`, which has its own
    /// copy: two private test modules sharing three lines would couple them
    /// more than it saves, and the same reasoning is already recorded for
    /// `DECISIVE_TEMPERATURE`.
    fn target_object(sim: &Sim, agent: Entity) -> Option<Entity> {
        sim.world().get::<Target>(agent).map(|t| t.object)
    }

    fn one_object_two_agents() -> (Sim, Entity, Entity, Entity) {
        const OBJECT_AT: (f32, f32) = (8.0, 8.0);
        let content = decisive_pack(vec![test_content::object(
            "fridge",
            &[(NeedId::Hunger, 40.0)],
            15,
        )]);
        let mut sim = test_content::sim_with(16, 16, content);
        let fridge = spawn_object(&mut sim, OBJECT_AT.0, OBJECT_AT.1, def(content, "fridge"));
        // Both starving, both three tiles out on opposite sides, so neither
        // has a distance advantage and both score identically.
        let winner = spawn_agent(&mut sim, 5.0, 8.0, 5.0);
        let loser = spawn_agent(&mut sim, 11.0, 8.0, 5.0);
        (sim, fridge, winner, loser)
    }

    /// **An agent outbid WITHIN a tick must not be told nothing is worth
    /// doing.**
    ///
    /// `Restless` means "nothing this agent can reach scored above
    /// `idle_threshold`", and `idle::wander` reads it as permission to send
    /// the sim for a stroll. An agent that wanted the fridge and lost it to
    /// a lower-indexed agent this tick has a false claim written about it,
    /// and the visible result is a sim walking away from the thing it
    /// wanted rather than waiting near it.
    ///
    /// The cause is ordering inside the candidate loop: a `claimed` object
    /// was skipped by `continue` *before* its score could be folded into
    /// `best_seen`, so the loser came out with `best_seen` still at
    /// negative infinity - the value that means "no reachable object at
    /// all".
    ///
    /// Recorded as [C3] in `docs/alpha-feel-notes.md`, and noted there as
    /// unobservable on the shipped page because it has one sim. This test
    /// is the two-sim world that observes it.
    #[test]
    fn an_agent_outbid_within_a_tick_waits_rather_than_wandering_off() {
        let (mut sim, fridge, winner, loser) = one_object_two_agents();

        sim.tick();

        // Preconditions. Without these, "the loser is not restless" is
        // satisfied by a world where the loser simply won.
        assert_eq!(
            target_object(&sim, winner),
            Some(fridge),
            "the lower-indexed agent must take the fridge, or nobody was \
             outbid and this test is about nothing"
        );
        assert_eq!(
            target_object(&sim, loser),
            None,
            "the higher-indexed agent must have been denied the fridge; if \
             it also got a target then the object was not contended"
        );

        assert!(
            sim.world().get::<Restless>(loser).is_none(),
            "an agent beaten to the only worthwhile object must not be \
             marked Restless - it wanted something, it simply could not \
             have it this tick, and Restless sends it wandering away from \
             the thing it is waiting for"
        );
    }

    /// **The same falsehood by the other route, and this one lasts far
    /// longer.**
    ///
    /// `claimed` only covers agents contending on the *same* tick. An
    /// object reserved on an earlier tick carries `Reserved`, and the
    /// object query used to filter those out entirely - so a waiting agent
    /// never saw the object at all, scored nothing, and was marked
    /// `Restless` for the whole of the other sim's walk *and* meal. On the
    /// shipped lot that is tens of ticks rather than one, which makes this
    /// the more visible half of [C3] even though the notes describe the
    /// within-tick case.
    ///
    /// Two ticks, because the reservation has to already exist when the
    /// second one runs: on tick one the winner claims the fridge and both
    /// agents are inside the same `claimed` list, which is the case the
    /// test above covers.
    #[test]
    fn an_agent_waiting_on_an_object_reserved_earlier_waits_rather_than_wandering_off() {
        let (mut sim, fridge, winner, loser) = one_object_two_agents();

        sim.tick();
        sim.tick();

        assert!(
            sim.world().get::<Reserved>(fridge).is_some(),
            "the fridge must still be reserved on the second tick, or the \
             loser is not waiting on anything"
        );
        assert_eq!(
            target_object(&sim, winner),
            Some(fridge),
            "the winner must still hold it"
        );
        assert_eq!(
            target_object(&sim, loser),
            None,
            "the loser must still be without a target"
        );

        assert!(
            sim.world().get::<Restless>(loser).is_none(),
            "an agent waiting on an object somebody else reserved on an \
             EARLIER tick must not be marked Restless either; this is the \
             long-lived half of the bug and it lasts as long as the other \
             sim's walk and interaction combined"
        );
    }

    /// The guard against the obvious over-correction: an agent with genuinely
    /// nothing to do **must** still be marked `Restless`, or the fix above
    /// deletes wandering entirely.
    ///
    /// This is the assertion that stops "never mark Restless" from passing
    /// the two tests above. It is the same world with the object removed, so
    /// the only difference from the fixture is whether anything worth doing
    /// exists at all.
    #[test]
    fn an_agent_with_nothing_reachable_is_still_marked_restless() {
        let content = decisive_pack(vec![test_content::object(
            "fridge",
            &[(NeedId::Hunger, 40.0)],
            15,
        )]);
        let mut sim = test_content::sim_with(16, 16, content);
        // No object spawned at all, so there is nothing to score.
        let agent = spawn_agent(&mut sim, 5.0, 8.0, 5.0);

        sim.tick();

        assert!(
            sim.world().get::<Restless>(agent).is_some(),
            "an agent in an empty room has nothing worth doing and must be \
             Restless; without this, the contested-object fix could suppress \
             the marker unconditionally and delete idle wandering"
        );
    }

    #[test]
    fn distance_is_weighed_against_benefit_rather_than_merely_consulted() {
        // "Nearer wins" is satisfied by any monotonic use of distance,
        // including ones that get the magnitude badly wrong. This test
        // pins the trade: a big enough benefit must be able to outrank a
        // shorter walk.
        //
        // The near object is worth 10 hunger at 7 walked tiles, the far
        // one 60 at 12, both taking 15 ticks. Scoring divides benefit by
        // 4*distance + duration + 1, so the far object wins 60/64 against
        // 10/44, a factor of about 4.1. Distance is still doing real
        // work: it costs the far object nearly a third of its score.
        //
        // GOLDEN assertion. The near object is spawned first and so holds
        // the lower index, which means any mutation that flattens the two
        // distances into a tie also fails this test through the index
        // tiebreak.
        //
        // Both offsets are off-axis in BOTH coordinates, deliberately:
        // this is the only distance test whose candidates a one-axis
        // metric would rank differently from a real path length, and the
        // two axis-aligned tests above cannot see that on their own.
        const NEAR_DELTA: f32 = 10.0;
        const FAR_DELTA: f32 = 60.0;
        const DURATION: u32 = 15;
        const AGENT_AT: (f32, f32) = (10.0, 14.0);
        const NEAR_AT: (f32, f32) = (13.0, 18.0);
        const FAR_AT: (f32, f32) = (12.0, 4.0);

        let content = decisive_pack(vec![
            test_content::object("near", &[(NeedId::Hunger, NEAR_DELTA)], DURATION),
            test_content::object("far", &[(NeedId::Hunger, FAR_DELTA)], DURATION),
        ]);
        let mut sim = test_content::sim_with(24, 24, content);
        let near = spawn_object(&mut sim, NEAR_AT.0, NEAR_AT.1, def(content, "near"));
        let far = spawn_object(&mut sim, FAR_AT.0, FAR_AT.1, def(content, "far"));
        let agent = spawn_agent(&mut sim, AGENT_AT.0, AGENT_AT.1, 20.0);

        sim.tick();

        let deficit = deficit_after_tick(&sim, agent, NeedId::Hunger);
        let near_score = score_of(deficit, AGENT_AT, NEAR_AT, NEAR_DELTA, DURATION);
        let far_score = score_of(deficit, AGENT_AT, FAR_AT, FAR_DELTA, DURATION);
        // Preconditions: the near object really is nearer, really is a
        // live candidate, and really does lose anyway.
        // Placed 7 tiles out, walked 6: the agent stops beside it.
        assert_eq!(walk_tiles(AGENT_AT, NEAR_AT), 6.0);
        assert!(
            walk_tiles(AGENT_AT, FAR_AT) > walk_tiles(AGENT_AT, NEAR_AT),
            "the high-benefit object must be the farther one or this test \
             is not a trade-off at all"
        );
        assert!(
            near_score > action_threshold(),
            "the near object must be selectable on its own; got {near_score}"
        );
        assert!(
            far_score > near_score,
            "the far object's benefit must outweigh its extra travel; \
             {far_score} vs {near_score}"
        );
        assert_decisive(far_score, near_score);

        assert_chose(
            &sim,
            agent,
            far,
            near,
            "a large enough benefit must outrank a shorter walk; picking \
             the near object means distance dominates instead of being \
             weighed",
        );
    }

    // ---- Footprints ----------------------------------------------------

    /// The one-tile and two-tile versions of the same object, with the same
    /// advert every distance test in this module uses, so the score
    /// arithmetic is unchanged and the rectangle is the only new thing.
    pub(super) fn object_of_width(width: u32) -> CompiledObject {
        test_content::object_sized(
            "wide",
            vec![test_content::interaction(
                "use_it",
                &[(NeedId::Hunger, IDENTICAL_DELTA)],
                IDENTICAL_DURATION,
            )],
            terri_core::Footprint { width, depth: 1 },
        )
    }

    /// The plan selection or `serve_intents` wrote, before `follow_path`
    /// consumed any of it. `steps` is the whole route, so `last()` is the tile
    /// the agent is heading for.
    pub(super) fn planned_route(sim: &Sim, agent: Entity) -> Vec<(i32, i32)> {
        sim.world()
            .get::<Path>(agent)
            .expect("the agent must have been given a path")
            .steps
            .clone()
    }

    /// A 16x16 room holding one object of the given width at `(4, 8)`, and an
    /// agent to its EAST at `(10, 8)`.
    ///
    /// East is the one direction where the two widths disagree: approaching a
    /// wide object from its origin side is the same walk whatever its width,
    /// which is why every existing distance test in this module is blind to
    /// the difference.
    fn agent_east_of_an_object_of_width(width: u32) -> (Sim, Entity, Entity) {
        let content = decisive_pack(vec![object_of_width(width)]);
        let mut sim = test_content::sim_with(16, 16, content);
        let object = spawn_object(&mut sim, 4.0, 8.0, def(content, "wide"));
        let agent = spawn_agent(&mut sim, 10.0, 8.0, 20.0);
        (sim, object, agent)
    }

    /// **Selection paths to the RECTANGLE, not to the origin tile** - [F4] in
    /// the system rather than in `TileGrid`.
    ///
    /// A 2x1 object at `(4, 8)` owns `(4, 8)` and `(5, 8)`, so an agent
    /// arriving from the east should stop at `(6, 8)`, four tiles away. If
    /// `select_action` passes `Footprint::SINGLE` - or reads the footprint off
    /// some other object - the goal set is the four neighbours of `(4, 8)`
    /// alone, the nearest of those is `(5, 8)`, and the agent walks five tiles
    /// to stand on a tile the object occupies.
    ///
    /// **The fixture leaves the object's tiles walkable**, and that is
    /// deliberate: on a real lot they are impassable, so the wrong answer
    /// would be `None` and the agent would visibly do nothing. Here it is a
    /// wrong DESTINATION reached by a perfectly valid path, which is the
    /// version of this bug that no other assertion in the module can see.
    ///
    /// The counterfactual is RUN rather than described. Holding the fixture
    /// constant and varying only `width` is what makes this a causal
    /// assertion rather than a pair of numbers that happen to be right;
    /// without it, an implementation measuring to a hardcoded rectangle would
    /// satisfy every line above.
    #[test]
    fn selection_paths_beside_a_wide_objects_far_edge_rather_than_round_to_its_origin() {
        let (mut sim, _, agent) = agent_east_of_an_object_of_width(2);
        sim.tick();
        let wide = planned_route(&sim, agent);

        assert_eq!(
            *wide.last().unwrap(),
            (6, 8),
            "the agent must stop beside the object's FAR tile; got {wide:?}"
        );
        assert_eq!(wide.len(), 4, "which is four tiles, not five");
        assert!(
            !wide.contains(&(5, 8)),
            "and it must never step onto the tile the footprint adds; got {wide:?}"
        );

        let (mut narrow_sim, _, narrow_agent) = agent_east_of_an_object_of_width(1);
        narrow_sim.tick();
        let narrow = planned_route(&narrow_sim, narrow_agent);
        assert_eq!(
            *narrow.last().unwrap(),
            (5, 8),
            "the same object one tile narrower must send the agent to (5, 8), \
             or width is not what decided the route above; got {narrow:?}"
        );
        assert_eq!(narrow.len(), 5);
    }

    #[test]
    fn an_object_advertising_two_needs_beats_one_advertising_a_bigger_single_delta() {
        // Scoring SUMS the per-need scores across an interaction's
        // advertised deltas. That is a design decision rather than a
        // mechanical consequence of moving adverts into content, so it is
        // pinned here rather than left implicit: an object that satisfies
        // two needs modestly must be able to beat one that satisfies a
        // single need slightly better.
        //
        // The arithmetic, with both deficits at 0.5 (urgency 0.125), both
        // objects 3 tiles away and both taking 15 ticks, so the
        // denominator is 12 + 15 + 1 = 28 throughout:
        //
        //   one_need   0.125 * 30 / 28              = 0.1339
        //   two_need   0.125 * 20 / 28  twice       = 0.1786
        //   two_need's HUNGER TERM ALONE            = 0.0893
        //
        // The third line is what makes this a test of the sum rather than
        // of the numbers. Replace `score +=` with `score =` and the
        // two-need object keeps only its last term; take just the first
        // advert and it keeps only 0.0893. Either way it drops BELOW the
        // one-need object and the golden winner flips. It is asserted as
        // a precondition rather than described, so a later edit to the
        // deltas cannot quietly destroy the property.
        //
        // GOLDEN assertion, and the one-need object is spawned FIRST so
        // it holds the lower index: any mutation that flattens the two
        // scores into a tie also hands it the win through the index
        // tiebreak, and this test fails rather than passing on a tie.
        const ONE_NEED_DELTA: f32 = 30.0;
        const TWO_NEED_DELTA: f32 = 20.0;
        const DURATION: u32 = 15;
        const AGENT_AT: (f32, f32) = (8.0, 8.0);
        const ONE_NEED_AT: (f32, f32) = (5.0, 8.0);
        const TWO_NEED_AT: (f32, f32) = (11.0, 8.0);

        let content = decisive_pack(vec![
            test_content::object("one_need", &[(NeedId::Hunger, ONE_NEED_DELTA)], DURATION),
            test_content::object(
                "two_need",
                &[
                    (NeedId::Hunger, TWO_NEED_DELTA),
                    (NeedId::Energy, TWO_NEED_DELTA),
                ],
                DURATION,
            ),
        ]);
        let mut sim = test_content::sim_with(16, 16, content);
        let one_need = spawn_object(
            &mut sim,
            ONE_NEED_AT.0,
            ONE_NEED_AT.1,
            def(content, "one_need"),
        );
        let two_need = spawn_object(
            &mut sim,
            TWO_NEED_AT.0,
            TWO_NEED_AT.1,
            def(content, "two_need"),
        );

        // Both needs decay before selection, at DIFFERENT rates, so each
        // is spawned one tick's worth of its OWN rate higher; both are at
        // 50.0 by the time anything is scored. Offsetting both by the
        // same number would leave them 0.035 apart, which is what this
        // test measured when Task 7 widened decay from hunger alone to
        // all seven. The equality is asserted below rather than assumed,
        // because it is what makes this a comparison of adverts rather
        // than of deficits.
        let mut needs = Needs::all_at(terri_core::NEED_MAX);
        needs.set(
            NeedId::Hunger,
            50.0 + test_content::decay_per_tick(NeedId::Hunger),
        );
        needs.set(
            NeedId::Energy,
            50.0 + test_content::decay_per_tick(NeedId::Energy),
        );
        let agent = spawn_agent_with(&mut sim, AGENT_AT.0, AGENT_AT.1, needs);

        sim.tick();

        let hunger_deficit = deficit_after_tick(&sim, agent, NeedId::Hunger);
        let energy_deficit = deficit_after_tick(&sim, agent, NeedId::Energy);
        assert_eq!(
            hunger_deficit, energy_deficit,
            "the two needs must be felt equally, or the winner could be \
             explained by the deficits rather than by the adverts"
        );
        assert!(
            hunger_deficit > 0.0,
            "both needs must actually be felt; got {hunger_deficit}"
        );
        assert_eq!(
            walk_tiles(AGENT_AT, ONE_NEED_AT),
            walk_tiles(AGENT_AT, TWO_NEED_AT),
            "the two objects must be equally far away, or distance could \
             explain the winner"
        );

        let one_need_score = score_of(
            hunger_deficit,
            AGENT_AT,
            ONE_NEED_AT,
            ONE_NEED_DELTA,
            DURATION,
        );
        let two_need_hunger_term = score_of(
            hunger_deficit,
            AGENT_AT,
            TWO_NEED_AT,
            TWO_NEED_DELTA,
            DURATION,
        );
        let two_need_energy_term = score_of(
            energy_deficit,
            AGENT_AT,
            TWO_NEED_AT,
            TWO_NEED_DELTA,
            DURATION,
        );
        assert!(
            one_need_score > action_threshold(),
            "the losing object must still clear the threshold; got {one_need_score}"
        );
        assert!(
            two_need_hunger_term < one_need_score,
            "either single advert of the two-need object must LOSE to the \
             one-need object, or summing is not what decides this test; \
             {two_need_hunger_term} vs {one_need_score}"
        );
        assert!(
            two_need_hunger_term + two_need_energy_term > one_need_score,
            "the two adverts together must beat the single bigger one; \
             {two_need_hunger_term} + {two_need_energy_term} vs {one_need_score}"
        );
        assert_decisive(two_need_hunger_term + two_need_energy_term, one_need_score);

        assert_chose(
            &sim,
            agent,
            two_need,
            one_need,
            "an object satisfying two needs modestly must beat one \
             satisfying a single need slightly better; picking the \
             one-need object means scoring stopped summing across the \
             advertised deltas",
        );
    }

    /// The other half of "scoring sums across advertised deltas": a
    /// delta may be NEGATIVE, and the sum has to be able to go down.
    ///
    /// `an_object_advertising_two_needs_beats_one_advertising_a_bigger_single_delta`
    /// above pins that two benefits add. Every advert in it is positive,
    /// so `score += x` and `score += x.abs()` are indistinguishable to
    /// it, and so are `score += x` and `score += x.max(0.0)`. This is the
    /// input domain that separates them ([L34]).
    ///
    /// The shape is deliberately a FLIP rather than a comparison. The two
    /// objects, their adverts, their distances and the agent's hygiene
    /// are byte-identical between the two runs; the only thing that
    /// differs is how much energy the agent has, which is a need the
    /// cheap object does not mention at all. Nothing but the cost term
    /// can account for the winner changing.
    #[test]
    fn a_negative_delta_can_flip_which_object_an_agent_chooses() {
        // Denominator is 12 + 15 + 1 = 28 for both objects throughout.
        // With hygiene deficit 0.5 (urgency 0.125):
        //
        //   cheap                    0.125 * 30 / 28           = 0.1339
        //   costly, hygiene term     0.125 * 50 / 28           = 0.2232
        //   costly, energy term at deficit 0.10   0.001 * -40 / 28 = -0.0014
        //   costly, energy term at deficit 0.90   0.729 * -40 / 28 = -1.0414
        //
        // so costly wins outright when the agent is rested and scores
        // NEGATIVE when it is exhausted. Both are asserted below as
        // preconditions rather than described.
        const CHEAP_DELTA: f32 = 30.0;
        const COSTLY_DELTA: f32 = 50.0;
        const ENERGY_COST: f32 = -40.0;
        const DURATION: u32 = 15;
        const AGENT_AT: (f32, f32) = (8.0, 8.0);
        const CHEAP_AT: (f32, f32) = (5.0, 8.0);
        const COSTLY_AT: (f32, f32) = (11.0, 8.0);

        /// Builds the scenario with the agent's energy set so that its
        /// deficit is exactly `energy_deficit` once decay has run, and
        /// returns the sim plus the two object entities and the agent.
        fn scenario(energy_deficit: f32) -> (Sim, Entity, Entity, Entity) {
            let content = decisive_pack(vec![
                test_content::object("cheap", &[(NeedId::Hygiene, CHEAP_DELTA)], DURATION),
                test_content::object(
                    "costly",
                    &[
                        (NeedId::Hygiene, COSTLY_DELTA),
                        (NeedId::Energy, ENERGY_COST),
                    ],
                    DURATION,
                ),
            ]);
            let mut sim = test_content::sim_with(16, 16, content);
            // cheap is spawned FIRST, so it holds the lower entity index
            // and wins any tie. A mutation that flattens the two scores
            // together therefore fails the rested case rather than
            // passing it.
            let cheap = spawn_object(&mut sim, CHEAP_AT.0, CHEAP_AT.1, def(content, "cheap"));
            let costly = spawn_object(&mut sim, COSTLY_AT.0, COSTLY_AT.1, def(content, "costly"));

            // Decay runs immediately before selection, so each level is
            // spawned one tick's worth of its OWN rate high; the rates
            // differ per need, so a shared offset would leave the
            // deficits slightly off the intended numbers.
            let mut needs = Needs::all_at(terri_core::NEED_MAX);
            needs.set(
                NeedId::Hygiene,
                terri_core::NEED_MAX * 0.5 + test_content::decay_per_tick(NeedId::Hygiene),
            );
            needs.set(
                NeedId::Energy,
                terri_core::NEED_MAX * (1.0 - energy_deficit)
                    + test_content::decay_per_tick(NeedId::Energy),
            );
            let agent = spawn_agent_with(&mut sim, AGENT_AT.0, AGENT_AT.1, needs);

            sim.tick();
            (sim, cheap, costly, agent)
        }

        for (energy_deficit, winner_is_costly) in [(0.10, true), (0.90, false)] {
            let (sim, cheap, costly, agent) = scenario(energy_deficit);

            let hygiene = deficit_after_tick(&sim, agent, NeedId::Hygiene);
            let energy = deficit_after_tick(&sim, agent, NeedId::Energy);
            assert!(
                (hygiene - 0.5).abs() < 1e-6,
                "hygiene must be the same in both runs; got {hygiene}"
            );
            assert!(
                (energy - energy_deficit).abs() < 1e-6,
                "energy deficit must be {energy_deficit}; got {energy}"
            );
            assert_eq!(
                walk_tiles(AGENT_AT, CHEAP_AT),
                walk_tiles(AGENT_AT, COSTLY_AT),
                "the two objects must be equally far away, or distance \
                 could explain the winner"
            );

            let cheap_score = score_of(hygiene, AGENT_AT, CHEAP_AT, CHEAP_DELTA, DURATION);
            let costly_benefit = score_of(hygiene, AGENT_AT, COSTLY_AT, COSTLY_DELTA, DURATION);
            let costly_cost = score_of(energy, AGENT_AT, COSTLY_AT, ENERGY_COST, DURATION);
            let costly_score = costly_benefit + costly_cost;

            assert!(
                cheap_score > action_threshold(),
                "the cheap object must always be selectable, or the \
                 exhausted case proves nothing; got {cheap_score}"
            );
            assert!(
                costly_benefit > cheap_score,
                "ignoring the cost entirely must make the costly object \
                 win BOTH runs, or this test cannot see the cost; \
                 {costly_benefit} vs {cheap_score}"
            );
            assert!(
                costly_cost < 0.0,
                "the energy term must be a genuine cost; got {costly_cost}"
            );

            let (winner, loser, why) = if winner_is_costly {
                assert!(
                    costly_score > cheap_score,
                    "a rested agent must still prefer the costly object; \
                     {costly_score} vs {cheap_score}"
                );
                // Only the rested run is a choice between two candidates.
                // In the exhausted run the costly object scores below the
                // action threshold, so it never enters the draw at all -
                // which the `costly_score < 0.0` assertion below states.
                assert_decisive(costly_score, cheap_score);
                (
                    costly,
                    cheap,
                    "a rested agent must take the bigger benefit despite \
                     its energy cost",
                )
            } else {
                assert!(
                    costly_score < 0.0,
                    "an exhausted agent's cost must take the whole sum \
                     below zero; got {costly_score}"
                );
                (
                    cheap,
                    costly,
                    "an exhausted agent must refuse the energy cost and \
                     take the cheaper object; choosing the costly one \
                     means the negative delta is being ignored or \
                     absolute-valued rather than summed",
                )
            };
            assert_chose(&sim, agent, winner, loser, why);
        }
    }

    #[test]
    fn selection_scores_every_interaction_and_records_the_one_that_won() {
        // An object offers a LIST of interactions and an agent performs
        // one of them, so selection has to compare them and carry the
        // winner forward. Two mutations this pins, neither of which any
        // other test can see because every other fixture offers exactly
        // one interaction:
        //
        //   - scoring only `interactions[0]` and ignoring the rest,
        //   - scoring all of them but recording a constant index.
        //
        // The strong interaction is deliberately SECOND, and the weak one
        // is deliberately below the action threshold on its own, so
        // "scores the first and stops" produces no selection at all
        // rather than a wrong one.
        const WEAK_DELTA: f32 = 0.5;
        const STRONG_DELTA: f32 = 40.0;
        const DURATION: u32 = 15;
        const AGENT_AT: (f32, f32) = (8.0, 8.0);
        const OBJECT_AT: (f32, f32) = (11.0, 8.0);

        let content = test_content::pack(vec![test_content::object_offering(
            "cupboard",
            vec![
                test_content::interaction("nibble", &[(NeedId::Hunger, WEAK_DELTA)], DURATION),
                test_content::interaction("feast", &[(NeedId::Hunger, STRONG_DELTA)], DURATION),
            ],
        )]);
        let mut sim = test_content::sim_with(16, 16, content);
        let cupboard = spawn_object(&mut sim, OBJECT_AT.0, OBJECT_AT.1, def(content, "cupboard"));
        let agent = spawn_agent(&mut sim, AGENT_AT.0, AGENT_AT.1, 20.0);

        sim.tick();

        let deficit = deficit_after_tick(&sim, agent, NeedId::Hunger);
        let weak = score_of(deficit, AGENT_AT, OBJECT_AT, WEAK_DELTA, DURATION);
        let strong = score_of(deficit, AGENT_AT, OBJECT_AT, STRONG_DELTA, DURATION);
        assert!(
            weak < action_threshold(),
            "the first interaction must be too weak to select on its own, \
             or this test cannot tell 'scored both' from 'scored the \
             first'; got {weak}"
        );
        assert!(
            strong > action_threshold(),
            "the second interaction must be worth doing; got {strong}"
        );

        let target = sim
            .world()
            .get::<Target>(agent)
            .expect("the agent must have chosen the object's second interaction");
        assert_eq!(target.object, cupboard);
        assert_eq!(
            target.interaction, 1,
            "the interaction that won selection must be the one recorded; \
             index 0 here means the choice is not carried forward and the \
             agent would perform whichever interaction happens to be first"
        );
    }

    /// Two interactions on one object, both worth doing, and the BETTER
    /// one has to win.
    ///
    /// **Found by `cargo mutants`, and it is [L34] in a new costume.**
    /// `selection_scores_every_interaction_and_records_the_one_that_won`
    /// above deliberately puts the weak interaction BELOW the action
    /// threshold, so that "scored the first and stopped" produces no
    /// selection rather than a wrong one. That is the right fixture for
    /// what it tests and it has a blind spot: the weak interaction is
    /// never accepted, so `best` is still `None` when the strong one is
    /// scored, and the comparison between two incumbents never runs.
    /// `a_tied_later_interaction_cannot_displace_an_earlier_one_on_the_same_object`
    /// below does run it, but only on EQUAL scores, where `>` and `<`
    /// agree.
    ///
    /// So the whole suite could not tell "keep the best interaction" from
    /// "keep the WORST one": `score > *best_score` mutated to `score <
    /// *best_score` survived. Two interactions that both clear the
    /// threshold and differ is the input domain that separates them, and
    /// it is a domain every other fixture in this module happens to lack.
    ///
    /// The weaker interaction is declared FIRST, so "keep the first",
    /// "keep the last" and "keep the worst" all produce index 0 and fail.
    #[test]
    fn the_better_of_two_worthwhile_interactions_on_one_object_is_the_one_recorded() {
        const SNACK_DELTA: f32 = 20.0;
        const FEAST_DELTA: f32 = 40.0;
        const DURATION: u32 = 15;
        const AGENT_AT: (f32, f32) = (8.0, 8.0);
        const OBJECT_AT: (f32, f32) = (11.0, 8.0);

        let content = test_content::pack(vec![test_content::object_offering(
            "larder",
            vec![
                test_content::interaction("snack", &[(NeedId::Hunger, SNACK_DELTA)], DURATION),
                test_content::interaction("feast", &[(NeedId::Hunger, FEAST_DELTA)], DURATION),
            ],
        )]);
        let mut sim = test_content::sim_with(16, 16, content);
        let larder = spawn_object(&mut sim, OBJECT_AT.0, OBJECT_AT.1, def(content, "larder"));
        let agent = spawn_agent(&mut sim, AGENT_AT.0, AGENT_AT.1, 20.0);

        sim.tick();

        // Preconditions. **Both** must clear the threshold - that is the
        // whole difference between this test and the one above - and they
        // must differ, or `>` and `<` agree and this proves nothing.
        let deficit = deficit_after_tick(&sim, agent, NeedId::Hunger);
        let snack = score_of(deficit, AGENT_AT, OBJECT_AT, SNACK_DELTA, DURATION);
        let feast = score_of(deficit, AGENT_AT, OBJECT_AT, FEAST_DELTA, DURATION);
        assert!(
            snack > action_threshold(),
            "the WEAKER interaction must also be worth doing on its own, \
             or `best` is never set before the stronger one is scored and \
             the comparison never runs; got {snack}"
        );
        assert!(
            feast > snack,
            "the two interactions must score differently; {feast} vs {snack}"
        );

        let target = sim
            .world()
            .get::<Target>(agent)
            .expect("the agent must have chosen one of the two interactions");
        assert_eq!(target.object, larder);
        assert_eq!(
            target.interaction, 1,
            "the BETTER of two worthwhile interactions must be the one \
             recorded; index 0 here means selection keeps the first, the \
             last, or the worst rather than the best"
        );
    }

    #[test]
    fn a_tied_later_interaction_cannot_displace_an_earlier_one_on_the_same_object() {
        // `object.index() < best_e.index()` does two jobs now that an
        // object offers a list of interactions, and only one of them was
        // tested.
        //
        // Between two OBJECTS it is the argmax tiebreak, which
        // `tied_scores_resolve_by_object_index_not_archetype_order` and
        // `a_tied_object_with_a_higher_index_cannot_displace_the_incumbent`
        // pin. Neither of them can see this case: distinct entities never
        // hold equal indices, so `<` and `<=` agree for every pair of
        // objects. That is exactly why `replace < with <= in
        // select_action` has survived every mutation sweep since M0 - it
        // was an equivalent mutant while an object had one advert.
        //
        // Within ONE object it stopped being equivalent. Both candidates
        // carry the same entity index, so `idx < idx` is false and the
        // incumbent stands. Relaxed to `<=`, the later interaction takes
        // over, and which interaction an agent performs starts depending
        // on declaration order in content with nothing saying so.
        const DELTA: f32 = 40.0;
        const DURATION: u32 = 15;
        const AGENT_AT: (f32, f32) = (8.0, 8.0);
        const OBJECT_AT: (f32, f32) = (11.0, 8.0);

        // Identical adverts, so the two scores are computed from
        // identical inputs and are bit-identical by construction rather
        // than by a fixture that happens to balance.
        let content = test_content::pack(vec![test_content::object_offering(
            "twin",
            vec![
                test_content::interaction("first", &[(NeedId::Hunger, DELTA)], DURATION),
                test_content::interaction("second", &[(NeedId::Hunger, DELTA)], DURATION),
            ],
        )]);
        let twin = def(content, "twin");
        let mut sim = test_content::sim_with(16, 16, content);
        let object = spawn_object(&mut sim, OBJECT_AT.0, OBJECT_AT.1, twin);
        let agent = spawn_agent(&mut sim, AGENT_AT.0, AGENT_AT.1, 20.0);

        sim.tick();

        // Preconditions: there really are two candidates, and the score
        // they tie on really is worth acting on, so the tiebreak is what
        // decides rather than one of them being ineligible.
        assert_eq!(
            content.object(twin).interactions.len(),
            2,
            "the object must offer two interactions or there is no tie to break"
        );
        let deficit = deficit_after_tick(&sim, agent, NeedId::Hunger);
        let score = score_of(deficit, AGENT_AT, OBJECT_AT, DELTA, DURATION);
        assert!(
            score > action_threshold(),
            "the tied score must clear the action threshold; got {score}"
        );

        let target = sim
            .world()
            .get::<Target>(agent)
            .expect("the agent must have chosen one of the tied interactions");
        assert_eq!(target.object, object);
        assert_eq!(
            target.interaction, 0,
            "the FIRST of two equally good interactions must win; a later \
             one taking over means the index comparison is no longer strict"
        );
    }

    #[test]
    fn a_score_exactly_at_the_action_threshold_selects_nothing() {
        // The threshold comparison is `score > action_threshold`. The
        // only input that can tell `>` from `>=` is a score that lands
        // exactly on the tuned value, so this test constructs one bit
        // exactly rather than approaching it.
        //
        // Every term is chosen to be exact in binary32: hunger decays to
        // exactly 50.0 on the first tick, giving deficit 0.5 and urgency
        // 0.125; two tiles of travel at 0.25 tiles per tick is 8 ticks,
        // plus 7 ticks of interaction plus 1 is a denominator of exactly
        // 16. 6.4, 0.8 and 0.05 share a mantissa, so 0.125 * 6.4 / 16 is
        // 0.05f32 with no rounding anywhere.
        //
        // **The object sits THREE tiles away and the agent walks two**,
        // because selection paths to a neighbour of the object rather than
        // onto it. That is the one term the adjacency change moved: it was
        // placed two tiles out and walked two, and re-deriving meant pushing
        // the placement out by one so the walk - which is what the score
        // divides by - stays at two and the denominator stays at exactly 16.
        // Re-derived rather than relaxed, exactly as the note below demands.
        //
        // **The deltas below stay literal, and 0.05 stays the authored
        // `action_threshold`.** This is the one test in the module whose
        // fixture is arithmetic rather than an inequality, so it is also
        // the one that cannot follow a tuned value: a threshold that is
        // not exactly representable, or that no product of these terms
        // lands on, breaks the construction rather than shifting it. The
        // bit-equality precondition below is what says so out loud, and
        // it is deliberately an equality of BIT PATTERNS rather than an
        // ordinary inequality - the moment it relaxes, this test stops
        // being able to tell `>` from `>=` at all. If a tuning pass ever
        // fails it, re-derive the fixture against the new value; do not
        // weaken the assertion.
        //
        // **Summing across needs does not move this arithmetic**, and
        // that is a property of the fixture rather than luck: the
        // boundary object advertises exactly ONE need, so the sum in
        // `select_action` has a single term. The agent's other six needs
        // are not advertised by it at all - which is not the same as
        // being advertised at zero - so they cannot perturb the total
        // however they decay. The bit-equality precondition below is what
        // would catch it if that ever stopped being true.
        //
        // Task 7 tested that claim by making all seven needs decay, and
        // this test stayed green: the other six now fall every tick and
        // the score is unchanged, because none of them is advertised.
        // Only hunger's own rate can move this arithmetic, and it did not
        // change.
        //
        // The above and below cases are not decoration: without them
        // "selects nothing" would also be satisfied by a world that can
        // never select anything.
        const EXACT_DELTA: f32 = 6.4;
        const ABOVE_DELTA: f32 = 6.5;
        const BELOW_DELTA: f32 = 6.3;
        const AGENT_AT: (f32, f32) = (5.0, 5.0);
        const OBJECT_AT: (f32, f32) = (8.0, 5.0);
        const DURATION: u32 = 7;

        /// Builds a one-object world, ticks once, and reports whether the
        /// agent selected anything.
        fn selects(delta: f32) -> bool {
            let content = test_content::pack(vec![test_content::object(
                "boundary",
                &[(NeedId::Hunger, delta)],
                DURATION,
            )]);
            let mut sim = test_content::sim_with(16, 16, content);
            let object = spawn_object(&mut sim, OBJECT_AT.0, OBJECT_AT.1, def(content, "boundary"));
            // Decay runs before selection, so start one tick's worth
            // above the level the arithmetic below assumes.
            let agent = spawn_agent(
                &mut sim,
                AGENT_AT.0,
                AGENT_AT.1,
                50.0 + test_content::decay_per_tick(NeedId::Hunger),
            );

            sim.tick();

            assert_eq!(
                deficit_after_tick(&sim, agent, NeedId::Hunger),
                0.5,
                "the deficit scoring saw must be exactly 0.5 or the \
                 boundary arithmetic below does not land on the constant"
            );
            match sim.world().get::<Target>(agent) {
                Some(target) => {
                    assert_eq!(
                        target.object, object,
                        "the only object in the world must be the one selected"
                    );
                    true
                }
                None => false,
            }
        }

        // Precondition: the middle case really is the boundary, bitwise.
        // Against the TUNED threshold, not against a second copy of
        // 0.05 - the fixture is derived from the authored value, and
        // this is what fails loudly if that value ever moves.
        let exact =
            score_advertisement(0.5, EXACT_DELTA, DURATION, walk_tiles(AGENT_AT, OBJECT_AT));
        assert_eq!(
            exact.to_bits(),
            action_threshold().to_bits(),
            "the boundary case must score bit-identically to the tuned \
             action_threshold or it tests an ordinary inequality; got \
             {exact} against {}",
            action_threshold()
        );

        assert!(
            selects(ABOVE_DELTA),
            "a score above the threshold must be acted on"
        );
        assert!(
            !selects(EXACT_DELTA),
            "the threshold is strict: a score exactly equal to \
             action_threshold is not worth doing"
        );
        assert!(
            !selects(BELOW_DELTA),
            "a score below the threshold must be ignored"
        );
    }

    #[test]
    fn a_tied_object_with_a_higher_index_stays_in_the_later_probability_bucket() {
        // The companion to the `tied_scores_resolve_by_object_index...`
        // test below, and it exists because that test only covers one of
        // the two iteration orders a tie can arrive in.
        //
        // Two bit-identical scores weigh the same, so `sample_softmax`
        // gives them one bucket each of exactly half the interval and the
        // ORDER of the candidate list is the whole answer. There, the
        // lower-index object iterates LAST and the sort has to move it to
        // the front. Here there is no archetype churn, so the two orders
        // already agree - which is what makes this the case that pins the
        // sort's DIRECTION rather than its presence:
        //
        //   ascending to descending flips the winner here and in the
        //   churned test both, whereas deleting the sort outright is
        //   invisible here and fails there. Neither test sees the other's
        //   mutation, which is why both exist.
        //
        // GOLDEN assertion, and for the same reason as its companion: a
        // two-run comparison in one process shares an archetype layout
        // and would agree with itself while being wrong.
        let content = identical_advert_content();
        let mut sim = test_content::sim_with(16, 16, content);
        let identical = def(content, "identical");
        // Mirrored about the agent, so both are exactly 3 tiles away and
        // score bit-identically. Spawned before the agent so object index
        // ascends with spawn order.
        let incumbent = spawn_object(&mut sim, 5.0, 8.0, identical);
        let challenger = spawn_object(&mut sim, 11.0, 8.0, identical);
        let agent = spawn_agent(&mut sim, 8.0, 8.0, 20.0);

        // Read BEFORE the tick, because the winner gains `Reserved` and
        // leaves the queried archetype. Here it must AGREE with index
        // order: that is the half of the pair this test covers.
        let iteration_order = raw_object_order(&sim);
        let mut index_order = iteration_order.clone();
        index_order.sort_unstable();
        assert_eq!(
            iteration_order, index_order,
            "this test is the unchurned half of the pair, so the query \
             must already yield the objects in index order"
        );
        assert_first_draw_takes_the_first_of_two_tied_buckets(content);

        sim.tick();

        // The precondition the whole test rests on: the two scores must
        // be BIT-identical, not merely close, or `score > best_score`
        // settles the winner and the tiebreak never fires.
        let deficit = deficit_after_tick(&sim, agent, NeedId::Hunger);
        let incumbent_score = score_of(
            deficit,
            (8.0, 8.0),
            (5.0, 8.0),
            IDENTICAL_DELTA,
            IDENTICAL_DURATION,
        );
        let challenger_score = score_of(
            deficit,
            (8.0, 8.0),
            (11.0, 8.0),
            IDENTICAL_DELTA,
            IDENTICAL_DURATION,
        );
        assert_eq!(
            incumbent_score.to_bits(),
            challenger_score.to_bits(),
            "the two objects must score bitwise identically or this test \
             pins nothing; got {incumbent_score} and {challenger_score}"
        );
        assert!(
            incumbent_score > action_threshold(),
            "the tied score must clear the action threshold; got {incumbent_score}"
        );
        assert!(
            incumbent.index() < challenger.index(),
            "the incumbent must hold the lower index or this test asserts \
             the opposite of what it claims"
        );

        assert_chose(
            &sim,
            agent,
            incumbent,
            challenger,
            "the lower object index must occupy the first probability \
             bucket, so the draw below one half must pick it; the other \
             object winning means the candidates are ordered by something \
             other than an ascending entity index",
        );
    }

    /// Blocks tiles in the sim's grid, so a fixture can have walls.
    ///
    /// Every other fixture in this module is an open room, which is
    /// exactly the input domain in which a straight line and a walked
    /// path are the same number ([L34]). These are the tests that leave
    /// it.
    fn block(sim: &mut Sim, tiles: &[(usize, usize)]) {
        let mut grid = sim
            .world_mut()
            .get_resource_mut::<TileGrid>()
            .expect("Sim::new inserts a TileGrid");
        for &(x, y) in tiles {
            grid.set_blocked(x, y, true);
        }
    }

    /// The A* path length in tiles between two spawn coordinates, read
    /// from the sim's own grid.
    ///
    /// This one DOES call production code, unlike `walk_tiles` and
    /// `straight_line`, and that is the right trade here: it is used to
    /// state facts about the GRID - "this object is reachable, in
    /// fourteen steps" - rather than facts about `select_action`. A
    /// mutation of the metric in `select_action` does not follow it, so
    /// the preconditions keep holding and the golden winner assertion is
    /// still what fails. A mutation of `find_path` itself would follow
    /// it, and that function is pinned by its own golden tests in
    /// terri-core's `grid.rs`.
    fn path_tiles(sim: &Sim, from: (f32, f32), to: (f32, f32)) -> Option<usize> {
        sim.world()
            .resource::<TileGrid>()
            .find_path(
                (from.0.round() as i32, from.1.round() as i32),
                (to.0.round() as i32, to.1.round() as i32),
            )
            .map(|steps| steps.len())
    }

    /// The test the wall-aware metric exists for.
    ///
    /// One object is nearer in a straight line but stands behind a wall;
    /// the other is farther in a straight line and directly reachable.
    /// The reachable one must win, because that is the one the agent will
    /// actually reach sooner - and because a ranking that disagrees with
    /// the agent's own pathing reads on screen as a sim that wants
    /// something and then changes its mind.
    ///
    /// **The straight-line ordering is asserted to be the opposite**, as
    /// a precondition. Without it this test would pass for an
    /// implementation that got the right answer for the wrong reason, and
    /// it would go on passing if the metric were reverted.
    ///
    /// It is deliberately about DISTANCE rather than availability: the
    /// walled-off object is genuinely reachable, and its path length is
    /// asserted, so "it lost because it was unreachable" is excluded.
    /// `an_unreachable_object_is_unavailable_rather_than_free...` below
    /// covers that case separately.
    #[test]
    fn an_object_behind_a_wall_loses_to_a_further_one_the_agent_can_walk_to() {
        // An 11x9 room with a wall running north-south at x = 6 from the
        // north edge down to y = 6, so the only way past it is round the
        // southern end at y = 7.
        //
        //   behind_wall is 2 tiles away in a straight line and 14 by path
        //   reachable   is 4 tiles away by both measures
        //
        // With the shipped fridge's advert on both, the denominators are
        // 14/0.25 + 15 + 1 = 72 against 4/0.25 + 16 = 32 by path, and
        // 2/0.25 + 16 = 24 against 32 by straight line. The two metrics
        // therefore name DIFFERENT winners, which is the whole point.
        const AGENT_AT: (f32, f32) = (5.0, 1.0);
        const BEHIND_WALL_AT: (f32, f32) = (7.0, 1.0);
        const REACHABLE_AT: (f32, f32) = (1.0, 1.0);

        let content = decisive_identical_advert_content();
        let mut sim = test_content::sim_with(11, 9, content);
        let identical = def(content, "identical");
        block(
            &mut sim,
            &[(6, 0), (6, 1), (6, 2), (6, 3), (6, 4), (6, 5), (6, 6)],
        );
        // behind_wall is spawned FIRST, so it holds the lower entity
        // index and wins any tie. A mutation that flattens the two
        // distances together - a constant metric, or one that ignores the
        // grid - therefore fails this test through the index tiebreak
        // rather than passing on a tie it never meant to create.
        let behind_wall = spawn_object(&mut sim, BEHIND_WALL_AT.0, BEHIND_WALL_AT.1, identical);
        let reachable = spawn_object(&mut sim, REACHABLE_AT.0, REACHABLE_AT.1, identical);
        let agent = spawn_agent(&mut sim, AGENT_AT.0, AGENT_AT.1, 20.0);

        sim.tick();

        // Preconditions about the GRID: both objects are reachable, and
        // the one behind the wall is much farther to walk to. Asserting
        // the exact lengths is what stops this test quietly becoming a
        // test about an unreachable object if the wall ever grows.
        assert_eq!(
            path_tiles(&sim, AGENT_AT, BEHIND_WALL_AT),
            Some(14),
            "the walled-off object must be REACHABLE, just farther; if it \
             is unreachable this test is about availability instead"
        );
        assert_eq!(path_tiles(&sim, AGENT_AT, REACHABLE_AT), Some(4));

        let deficit = deficit_after_tick(&sim, agent, NeedId::Hunger);
        // Explicit path lengths rather than `score_of`: its `walk_tiles`
        // helper is Manhattan distance, which is the walked distance only
        // on an open grid, and this fixture is precisely the one that is
        // not.
        let by_path = |tiles: usize| {
            score_advertisement(deficit, IDENTICAL_DELTA, IDENTICAL_DURATION, tiles as f32)
        };
        let by_straight_line = |at: (f32, f32)| {
            score_advertisement(
                deficit,
                IDENTICAL_DELTA,
                IDENTICAL_DURATION,
                straight_line(AGENT_AT, at),
            )
        };

        // The precondition that makes this test mean anything: measured
        // in a straight line, the object behind the wall is the NEARER
        // one and scores HIGHER, so a Euclidean implementation picks it.
        assert!(
            straight_line(AGENT_AT, BEHIND_WALL_AT) < straight_line(AGENT_AT, REACHABLE_AT),
            "the walled-off object must be nearer in a straight line, or \
             this test would pass with the metric reverted"
        );
        assert!(
            by_straight_line(BEHIND_WALL_AT) > by_straight_line(REACHABLE_AT),
            "a straight-line metric must rank the walled-off object FIRST, \
             or reverting to one would leave this test green; {} vs {}",
            by_straight_line(BEHIND_WALL_AT),
            by_straight_line(REACHABLE_AT)
        );
        // Both are live candidates on the real metric, so the winner is
        // decided by the comparison rather than by one of them being
        // ineligible.
        assert!(
            by_path(14) > action_threshold(),
            "the losing object must still clear the threshold, or this \
             test proves nothing about choosing between them; got {}",
            by_path(14)
        );
        assert!(
            by_path(4) > by_path(14),
            "walked distance must rank the reachable object higher; {} vs {}",
            by_path(4),
            by_path(14)
        );
        assert_decisive(by_path(4), by_path(14));

        assert_chose(
            &sim,
            agent,
            reachable,
            behind_wall,
            "an object one tile away through a wall must lose to a farther \
             one the agent can walk straight to; picking the walled-off \
             object means scoring measures a straight line while movement \
             measures a path",
        );
    }

    /// An object the agent cannot reach at all must score as
    /// **unavailable**, not as free and not as zero-distance, and the
    /// agent must fall back to the best object it can reach.
    ///
    /// Both halves matter and they fail differently. Scoring an
    /// unreachable object as though it were adjacent hands it the highest
    /// score in the world, so it wins every tick; the agent then has
    /// nowhere to walk and does nothing at all, forever, with the sim
    /// looking alive because needs keep decaying. That is [L17]'s failure
    /// with a wall in place of an out-of-bounds coordinate, and a lot with
    /// walls is the first configuration where it can actually happen.
    #[test]
    fn an_unreachable_object_is_unavailable_rather_than_free_and_a_runner_up_wins() {
        // An 11x7 room cut in two by a full-height wall at x = 8. The
        // eastern strip is sealed: nothing can path into it.
        const AGENT_AT: (f32, f32) = (5.0, 3.0);
        const SEALED_AT: (f32, f32) = (9.0, 3.0);
        const RUNNER_UP_AT: (f32, f32) = (2.0, 3.0);
        const SEALED_DELTA: f32 = 200.0;
        const RUNNER_UP_DELTA: f32 = 40.0;
        const DURATION: u32 = 15;

        // The SHIPPED temperature, unlike the golden-winner tests above,
        // and that is a property of this fixture rather than an
        // oversight: the sealed object is unreachable, so it never
        // becomes a candidate and the runner up is the only thing in the
        // draw. A one-candidate draw returns that candidate at every
        // temperature. Making it decisive would only obscure that the
        // thing under test here is availability, not weighting.
        let content = test_content::pack(vec![
            test_content::object("sealed", &[(NeedId::Hunger, SEALED_DELTA)], DURATION),
            test_content::object("runner_up", &[(NeedId::Hunger, RUNNER_UP_DELTA)], DURATION),
        ]);
        let mut sim = test_content::sim_with(11, 7, content);
        block(
            &mut sim,
            &[(8, 0), (8, 1), (8, 2), (8, 3), (8, 4), (8, 5), (8, 6)],
        );
        // Sealed first, so it holds the lower entity index and wins any
        // tie: a metric that collapses to a constant fails here too.
        let sealed = spawn_object(&mut sim, SEALED_AT.0, SEALED_AT.1, def(content, "sealed"));
        let runner_up = spawn_object(
            &mut sim,
            RUNNER_UP_AT.0,
            RUNNER_UP_AT.1,
            def(content, "runner_up"),
        );
        let agent = spawn_agent(&mut sim, AGENT_AT.0, AGENT_AT.1, 20.0);

        sim.tick();

        assert_eq!(
            path_tiles(&sim, AGENT_AT, SEALED_AT),
            None,
            "the sealed object must be genuinely unreachable or this test \
             is a second copy of the walled-distance one"
        );
        assert_eq!(path_tiles(&sim, AGENT_AT, RUNNER_UP_AT), Some(3));

        let deficit = deficit_after_tick(&sim, agent, NeedId::Hunger);
        let runner_up_score = score_of(deficit, AGENT_AT, RUNNER_UP_AT, RUNNER_UP_DELTA, DURATION);
        // The two wrong answers this test exists to exclude, asserted
        // rather than described. Scoring the sealed object as free, or at
        // its straight-line distance, both hand it the win.
        assert!(
            score_advertisement(deficit, SEALED_DELTA, DURATION, 0.0) > runner_up_score,
            "an unreachable object scored as FREE must outrank the runner \
             up, or this test cannot see that mistake"
        );
        assert!(
            score_advertisement(
                deficit,
                SEALED_DELTA,
                DURATION,
                straight_line(AGENT_AT, SEALED_AT)
            ) > runner_up_score,
            "an unreachable object scored at its straight-line distance \
             must outrank the runner up, or this test cannot see that one \
             either"
        );
        assert!(
            runner_up_score > action_threshold(),
            "the runner up must be worth doing on its own; got {runner_up_score}"
        );

        assert_chose(
            &sim,
            agent,
            runner_up,
            sealed,
            "an unreachable object must be unavailable rather than free, \
             and the agent must take the best object it can actually \
             reach; no target at all means the unreachable one won \
             selection and then failed to path",
        );
    }

    /// **The test the milestone exists for**, at the level a player would
    /// see it: a hungrier option is served more often without being
    /// served always.
    ///
    /// Both halves matter and they exclude different things.
    ///
    /// - The better object winning most of the runs is what separates
    ///   this from UNIFORM randomness, which would split them evenly.
    /// - The worse object winning some of the runs is what separates it
    ///   from ARGMAX, which would never pick it at all. **A test
    ///   asserting only the first would have passed before this task
    ///   changed anything.**
    ///
    /// Runs are separated by SEED rather than by ticking one world,
    /// because an agent chooses once and is then busy. Each run rebuilds
    /// the same world and reseeds the PRNG, so the seed is the only thing
    /// that differs between them - which is also what makes this a test
    /// of the sampling rather than of anything the world remembers.
    ///
    /// The worse object is spawned FIRST, so it holds the lower index and
    /// therefore the first probability bucket. That kills the two
    /// degenerate samplers a middling assertion would otherwise admit:
    /// "always take the first bucket" hands every run to the worse object
    /// and fails the dominance assertion; "always take the last" hands
    /// every run to the better one and fails the never-zero assertion.
    #[test]
    fn a_higher_scoring_object_is_chosen_more_often_and_a_lower_one_still_sometimes() {
        // 500 runs, and the arithmetic behind the assertion windows.
        // Both objects are 3 tiles away and take 15 ticks, so the
        // denominator is 12 + 15 + 1 = 28 for both. The agent spawns at
        // hunger 20 and decays to 19.896, a deficit of 0.80104 and an
        // urgency of 0.5140:
        //
        //   better  0.5140 * 39 / 28 = 0.7159
        //   worse   0.5140 * 30 / 28 = 0.5507
        //
        // A gap of 0.1652 at the shipped temperature of 0.06 is a weight
        // ratio of exp(2.753) = 15.7, so the better object should take
        // about 94% of the runs. Measured: 471 to 29. Uniform would be
        // 250 to 250 and argmax 500 to 0, and the windows below are wide
        // enough that neither is a near miss.
        //
        // **The 29 is the load-bearing number and it is not large.** The
        // alpha feel pass took the temperature from 0.15 to 0.06 and
        // this count fell from 129 to 29; a further cut to 0.03 would
        // put it near 2, at which point `wins.1 > 0` becomes a coin toss
        // over the seed range rather than an assertion. Anyone tuning
        // the temperature lower must widen the fixture's gap - move the
        // two deltas closer together - rather than accept a test that
        // passes by luck.
        const RUNS: u64 = 500;
        const BETTER_DELTA: f32 = 39.0;
        const WORSE_DELTA: f32 = 30.0;
        const DURATION: u32 = 15;
        const AGENT_AT: (f32, f32) = (8.0, 8.0);
        const WORSE_AT: (f32, f32) = (5.0, 8.0);
        const BETTER_AT: (f32, f32) = (11.0, 8.0);

        // The SHIPPED temperature, deliberately. A fixture that turned it
        // down would make the choice certain, which is exactly the thing
        // this test exists to show it is not.
        let content = test_content::pack(vec![
            test_content::object("worse", &[(NeedId::Hunger, WORSE_DELTA)], DURATION),
            test_content::object("better", &[(NeedId::Hunger, BETTER_DELTA)], DURATION),
        ]);

        let mut wins = (0u32, 0u32);
        let mut deficit = 0.0;
        for seed in 0..RUNS {
            let mut sim = test_content::sim_with(16, 16, content);
            let worse = spawn_object(&mut sim, WORSE_AT.0, WORSE_AT.1, def(content, "worse"));
            let better = spawn_object(&mut sim, BETTER_AT.0, BETTER_AT.1, def(content, "better"));
            let agent = spawn_agent(&mut sim, AGENT_AT.0, AGENT_AT.1, 20.0);
            assert!(
                worse.index() < better.index(),
                "the worse object must hold the lower index, or 'always \
                 pick the first bucket' would satisfy this test"
            );
            // Every run is the same world drawing from a different
            // stream. `sim_with` seeds from the pack, which is one shared
            // seed, so this is what makes the runs independent.
            sim.world_mut().insert_resource(SimRng::from_seed(seed));

            sim.tick();

            deficit = deficit_after_tick(&sim, agent, NeedId::Hunger);
            let target = sim
                .world()
                .get::<Target>(agent)
                .expect("the agent must choose one of the two objects");
            if target.object == better {
                wins.0 += 1;
            } else {
                assert_eq!(target.object, worse, "an unexpected object won");
                wins.1 += 1;
            }
        }

        // Preconditions: both candidates really are live, and the better
        // one really is better, at the numbers the runs above produced.
        let better_score = score_of(deficit, AGENT_AT, BETTER_AT, BETTER_DELTA, DURATION);
        let worse_score = score_of(deficit, AGENT_AT, WORSE_AT, WORSE_DELTA, DURATION);
        assert_eq!(
            walk_tiles(AGENT_AT, WORSE_AT),
            walk_tiles(AGENT_AT, BETTER_AT),
            "the two objects must be equally far away, or distance could \
             explain the split"
        );
        assert!(
            worse_score > action_threshold(),
            "the worse object must be worth doing on its own, or it is \
             excluded rather than merely unlikely; got {worse_score}"
        );
        assert!(
            better_score > worse_score,
            "the better object must score higher; {better_score} vs {worse_score}"
        );
        assert_eq!(
            u64::from(wins.0 + wins.1),
            RUNS,
            "every run must have produced a choice: {wins:?}"
        );

        assert!(
            wins.0 > wins.1 * 2,
            "the higher-scoring object must win most of the runs, or \
             selection is no better than a coin toss: {wins:?}"
        );
        assert!(
            wins.1 > 0,
            "the lower-scoring object must still be chosen sometimes, or \
             this is argmax with extra steps and the milestone changed \
             nothing: {wins:?}"
        );
    }

    #[test]
    fn contention_resolves_by_entity_order_not_iteration_order() {
        // Three identical agents contend for one single-slot fridge.
        // Exactly one may win, and which one must not depend on
        // interaction history.
        //
        // This is a GOLDEN assertion: it names the winning entity. That
        // is deliberate. Do NOT "simplify" it into a two-run comparison.
        // Running the sim twice in one process compares two identical
        // answers, because bevy's iteration is deterministic for a fixed
        // archetype layout and spawn order, so a broken tiebreak would
        // simply be broken the same way twice. The same trap is
        // documented at terri-core's
        // `tie_breaking_pins_one_specific_path_among_equals`.
        //
        // The churn below is what makes `idle.sort_by_key` load-bearing.
        // An agent changes archetype every time `Target`, `Path` or
        // `Eating` is added or removed, and leaving an archetype
        // swap-removes the agent from its table while re-entering
        // appends it at the end. So after a few meals `agents.iter()`
        // yields agents in an order set by who ate last rather than by
        // spawn order. Adding and removing one component reproduces in
        // two lines what a handful of meals does naturally. Without the
        // sort, who wins a contended object becomes a function of
        // interaction history.
        let content = identical_advert_content();
        let mut sim = test_content::sim_with(16, 16, content);
        let identical = def(content, "identical");

        // Spawn agents first so entity index ascends with spawn order.
        let agents: Vec<Entity> = (0..3)
            .map(|_| spawn_agent(&mut sim, 1.0, 1.0, 20.0))
            .collect();
        let fridge = spawn_object(&mut sim, 5.0, 5.0, identical);

        // Archetype churn. Moves the lowest-index agent to the back of
        // the table, so iteration order and index order now disagree.
        sim.world_mut().entity_mut(agents[0]).insert(Eating {
            object: identical,
            interaction: 0,
            remaining_ticks: 1,
        });
        sim.world_mut().entity_mut(agents[0]).remove::<Eating>();

        sim.tick();

        let holders: Vec<Entity> = agents
            .iter()
            .copied()
            .filter(|e| sim.world().get::<Target>(*e).is_some())
            .collect();

        // Assert non-emptiness explicitly, per lessons-learned [L3]:
        // "exactly one" must not be satisfiable by "none at all".
        assert_eq!(
            holders.len(),
            1,
            "exactly one agent may claim a single-slot object; got {holders:?}"
        );
        assert_eq!(
            holders[0], agents[0],
            "the lowest entity index must win regardless of table order; \
             a different winner means the deterministic sort is gone"
        );
        assert_eq!(
            sim.world().get::<Target>(holders[0]).unwrap().object,
            fridge,
            "the winner must target the fridge"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_some(),
            "the winner must have reserved the fridge"
        );
    }

    /// The seed reaches selection from the CONTENT PACK, not from a
    /// constant and not from whatever `Sim::new` happened to install.
    ///
    /// Causal rather than comparative, per docs/testing-protocol.md rule
    /// 3: the two runs below differ in exactly one authored value, and
    /// the winner changes. Nothing else in the fixture moves - same
    /// objects, same positions, same adverts, same agent - so only the
    /// seed can account for it.
    ///
    /// This is what `test_content::sim_with`'s reseed line is for, and
    /// until this existed that line was invisible: every fixture carried
    /// the shipped `rng_seed`, so deleting the reseed changed nothing and
    /// the first fixture to want its own seed would have been silently
    /// ignored.
    ///
    /// Two tied objects make the seed's effect maximal and readable: the
    /// buckets are exactly half each, so the winner is simply which half
    /// the first draw lands in.
    #[test]
    fn the_seed_selection_draws_from_is_the_one_the_content_pack_carries() {
        /// Builds the tied two-object world on a pack seeded with `seed`,
        /// ticks once, and reports which object won.
        fn winner(seed: u64) -> (Entity, Entity, Option<Entity>) {
            let content = test_content::pack_tuned(
                vec![identical_object()],
                Tuning {
                    rng_seed: seed,
                    ..test_content::tuning()
                },
            );
            let mut sim = test_content::sim_with(16, 16, content);
            let identical = def(content, "identical");
            let low = spawn_object(&mut sim, 5.0, 8.0, identical);
            let high = spawn_object(&mut sim, 11.0, 8.0, identical);
            let agent = spawn_agent(&mut sim, 8.0, 8.0, 20.0);
            sim.tick();
            let chosen = sim.world().get::<Target>(agent).map(|t| t.object);
            (low, high, chosen)
        }

        // Preconditions: the two seeds must land on opposite sides of the
        // halfway point, or the runs below cannot disagree for the reason
        // this test claims. The first is the shipped seed, so the second
        // run is the one that can only be right if the fixture's seed is
        // the one selection used.
        let shipped = test_content::tuning().rng_seed;
        const OTHER_SEED: u64 = 9;
        let shipped_draw = SimRng::from_seed(shipped).next_f32();
        let other_draw = SimRng::from_seed(OTHER_SEED).next_f32();
        assert!(
            shipped_draw < 0.5,
            "the shipped seed must draw into the first bucket; got {shipped_draw}"
        );
        assert!(
            other_draw >= 0.5,
            "the other seed must draw into the SECOND bucket, or both runs \
             agree and this test proves nothing; got {other_draw}"
        );

        let (low, high, chosen) = winner(shipped);
        assert!(low.index() < high.index(), "spawn order sets the indices");
        assert_eq!(
            chosen,
            Some(low),
            "the shipped seed draws below one half, so the lower-index \
             object must win"
        );

        let (low, high, chosen) = winner(OTHER_SEED);
        assert!(low.index() < high.index(), "spawn order sets the indices");
        assert_eq!(
            chosen,
            Some(high),
            "a fixture that sets its own rng_seed must actually be the \
             seed selection draws from; the lower-index object winning \
             here means the shipped seed was used instead"
        );
    }

    #[test]
    fn tied_scores_resolve_by_object_index_not_archetype_order() {
        // **The test the object sort exists for.**
        //
        // One agent, two objects whose scores are exactly equal. Equal
        // scores weigh equally, so `sample_softmax` hands each of them a
        // bucket of exactly half the interval and the ORDER of the
        // candidate list decides which half a given draw lands in. There
        // is no argmax left to be unique, and no tiebreak clause to make
        // it one: `placed_objects.sort_by_key` in `select_action` is the
        // entire mechanism, and this is the test that fails without it.
        //
        // Until M1c the `objects` query iterated UNSORTED, and that was
        // safe because the score comparison plus an entity-index tiebreak
        // named one winner regardless of order. Weighted sampling removed
        // that protection - see [D-3] - and this test moved with it.
        //
        // GOLDEN assertion, for the same reason as the contention test
        // above: do NOT rewrite this as a two-run comparison. Two runs in
        // one process share one archetype layout, so they would agree
        // with each other while both being wrong.
        let content = identical_advert_content();
        let mut sim = test_content::sim_with(16, 16, content);
        let identical = def(content, "identical");

        // Mirrored about the agent at x = 8, so both are exactly 3 tiles
        // away. Spawned before the agent so object index ascends with
        // spawn order.
        let left = spawn_object(&mut sim, 5.0, 8.0, identical);
        let right = spawn_object(&mut sim, 11.0, 8.0, identical);
        let agent = spawn_agent(&mut sim, 8.0, 8.0, 20.0);

        // Archetype churn on the objects, which is how it happens for
        // real: an object leaves and re-enters the unreserved archetype
        // every time it is claimed and released. Leaving swap-removes it
        // from its table and re-entering appends it at the end, so the
        // lower-index object now iterates LAST.
        //
        // **Without this the test would pass with the sort deleted**, per
        // [L5]: a plain sequence of spawns puts every object in one
        // archetype, where table order already equals index order, so the
        // sorted and unsorted candidate lists are the same list.
        sim.world_mut().entity_mut(left).insert(Reserved);
        sim.world_mut().entity_mut(left).remove::<Reserved>();

        // The precondition that makes the churn real, read BEFORE the
        // tick because the winner gains `Reserved` and leaves the queried
        // archetype. Without it this test would silently degrade into a
        // copy of its unchurned companion above.
        let iteration_order = raw_object_order(&sim);
        let mut index_order = iteration_order.clone();
        index_order.sort_unstable();
        assert_ne!(
            iteration_order, index_order,
            "the query must yield the objects in an order that is NOT \
             index order, or the sort has nothing to do and deleting it \
             would leave this test green; got {iteration_order:?}"
        );
        assert_first_draw_takes_the_first_of_two_tied_buckets(content);

        sim.tick();

        // The precondition this whole test rests on: the two scores must
        // be BIT-identical, not merely close. If they differed in the
        // last bit, `score > best_score` would settle the winner and the
        // tiebreak would never fire, leaving the test decorative.
        // `decay_needs` runs before `select_action` within a tick and
        // nothing else touches hunger on a tick where the agent only
        // starts walking, so the post-tick level is exactly the one
        // scoring saw.
        let deficit = deficit_after_tick(&sim, agent, NeedId::Hunger);
        let score_left = score_of(
            deficit,
            (8.0, 8.0),
            (5.0, 8.0),
            IDENTICAL_DELTA,
            IDENTICAL_DURATION,
        );
        let score_right = score_of(
            deficit,
            (8.0, 8.0),
            (11.0, 8.0),
            IDENTICAL_DELTA,
            IDENTICAL_DURATION,
        );
        assert_eq!(
            score_left.to_bits(),
            score_right.to_bits(),
            "the two objects must score bitwise identically or this test \
             pins nothing; got {score_left} and {score_right}"
        );
        assert!(
            score_left > action_threshold(),
            "the tied score must clear the action threshold; got {score_left}"
        );

        assert_chose(
            &sim,
            agent,
            left,
            right,
            "the lower object index must win a tied score regardless of \
             archetype order; the other object winning means the \
             candidates reached the draw in table order, so which object \
             a die roll picks depends on which objects were used recently",
        );
    }
}

#[cfg(test)]
mod personality_choice_tests {
    //! The personality multipliers as CHOICES a fixture can watch, which
    //! is what [L55] says a multiplier alone cannot provide and a
    //! behavioural test alone cannot pin. The factor arithmetic is pinned
    //! by golden values in `advertise.rs` and `terri-core`; these are the
    //! composition reaching a real decision, built so the wrong-direction
    //! mutant - `*` to `/` on the composition - lands on the other
    //! object. The key-lookup halves are NOT pinned here: both fixture
    //! objects offer one interaction at index 0, so a lookup ignoring the
    //! interaction index reads the same weight, and
    //! `a_disposition_reads_back_by_its_own_key_and_unlisted_reads_neutral`
    //! in terri-core is what covers both halves of the key.

    use crate::test_content;
    use terri_core::{
        Agent, NeedId, Needs, ObjectDefId, Personality, Position, SmartObject, Target, NEED_COUNT,
        NEED_MAX,
    };

    /// Two objects with IDENTICAL adverts and durations, equidistant. An
    /// EXACT tie is not broken by any rule: `select_action` deleted its
    /// entity-index tiebreak when selection became a weighted draw, and
    /// two equal scores get equal softmax weight at every temperature -
    /// `exp(0) = 1` for both - so the winner is one draw on the seeded
    /// stream, a coin flip whose outcome is fixed by `rng_seed`. On the
    /// shipped seed it lands on `a`, and THAT measured fact - not a rule -
    /// is the baseline the personality cases below must overturn; it is
    /// asserted first because without it "the disposition won" cannot be
    /// told from "the coin landed there".
    fn chosen(personality: Option<Personality>) -> u32 {
        let content = test_content::pack_tuned(
            vec![
                test_content::object("fridge_a", &[(NeedId::Hunger, 40.0)], 15),
                test_content::object("fridge_b", &[(NeedId::Hunger, 40.0)], 15),
            ],
            terri_data::Tuning {
                choice_temperature: 0.0001,
                duration_variance: 0.0,
                ..test_content::tuning()
            },
        );
        let mut sim = test_content::sim_with(16, 16, content);
        let a = sim
            .world_mut()
            .spawn((Position { x: 5.0, y: 8.0 }, SmartObject(ObjectDefId(0))))
            .id();
        let b = sim
            .world_mut()
            .spawn((Position { x: 11.0, y: 8.0 }, SmartObject(ObjectDefId(1))))
            .id();
        let mut needs = Needs::all_at(NEED_MAX);
        needs.set(NeedId::Hunger, 20.0);
        let agent = match personality {
            Some(p) => sim
                .world_mut()
                .spawn((Agent, Position { x: 8.0, y: 8.0 }, needs, p))
                .id(),
            None => sim
                .world_mut()
                .spawn((Agent, Position { x: 8.0, y: 8.0 }, needs))
                .id(),
        };
        for _ in 0..40 {
            sim.tick();
            if let Some(target) = sim.world().get::<Target>(agent) {
                if target.object == a {
                    return 0;
                }
                if target.object == b {
                    return 1;
                }
            }
        }
        panic!("the hungry sim never chose either fridge");
    }

    #[test]
    fn a_disposition_steers_a_tie_and_a_zero_one_refuses_outright() {
        // The measured baseline: on the shipped seed, the undecorated
        // coin lands on a. Without this line, "the disposition won" is
        // indistinguishable from "the coin landed on b anyway".
        assert_eq!(
            chosen(None),
            0,
            "the shipped seed's tie coin must land on a; if a seed or rng \
             change moves this, the two personality cases below need a new \
             baseline, not deletion"
        );

        let neutral = Personality::neutral();
        let loves_b = Personality::with_dispositions(
            neutral.drain,
            neutral.satisfaction,
            vec![(ObjectDefId(1), 0, 2.0)],
        );
        assert_eq!(
            chosen(Some(loves_b)),
            1,
            "a 2.0 disposition must win the tie; a `/` in the composition \
             turns it into a penalty and this fails back to a"
        );

        let fears_a = Personality::with_dispositions(
            [1.0; NEED_COUNT],
            [1.0; NEED_COUNT],
            vec![(ObjectDefId(0), 0, 0.0)],
        );
        assert_eq!(
            chosen(Some(fears_a)),
            1,
            "a 0.0 disposition is a refusal; the authored fear must send \
             the sim to the other object even against the tie break"
        );
    }

    /// **The satisfaction multiplier steers choice between different
    /// NEEDS, so what a sim seeks agrees with what delivery will give
    /// it.** Two objects feeding two different needs, both equally short,
    /// symmetric deltas and durations; satisfaction 2.0 on energy must
    /// pull the choice to the bed against the same first-spawned tie
    /// break the test above pins.
    #[test]
    fn a_satisfaction_multiplier_steers_choice_toward_the_need_it_amplifies() {
        let content = test_content::pack_tuned(
            vec![
                test_content::object("fridge", &[(NeedId::Hunger, 40.0)], 15),
                test_content::object("bed", &[(NeedId::Energy, 40.0)], 15),
            ],
            terri_data::Tuning {
                choice_temperature: 0.0001,
                duration_variance: 0.0,
                ..test_content::tuning()
            },
        );

        // Which object does a sim short of BOTH needs pick? Undecorated,
        // the two candidates tie exactly and the winner is one draw on the
        // seeded stream - see the coin-flip note on `chosen` above.
        let picks_bed = |personality: Option<Personality>| -> bool {
            let mut sim = test_content::sim_with(16, 16, content);
            let fridge = sim
                .world_mut()
                .spawn((Position { x: 5.0, y: 8.0 }, SmartObject(ObjectDefId(0))))
                .id();
            let bed = sim
                .world_mut()
                .spawn((Position { x: 11.0, y: 8.0 }, SmartObject(ObjectDefId(1))))
                .id();
            let mut needs = Needs::all_at(NEED_MAX);
            needs.set(NeedId::Hunger, 20.0);
            needs.set(NeedId::Energy, 20.0);
            let agent = match personality {
                Some(p) => sim
                    .world_mut()
                    .spawn((Agent, Position { x: 8.0, y: 8.0 }, needs, p))
                    .id(),
                None => sim
                    .world_mut()
                    .spawn((Agent, Position { x: 8.0, y: 8.0 }, needs))
                    .id(),
            };
            for _ in 0..40 {
                sim.tick();
                if let Some(target) = sim.world().get::<Target>(agent) {
                    if target.object == bed {
                        return true;
                    }
                    if target.object == fridge {
                        return false;
                    }
                }
            }
            panic!("the sim never chose anything");
        };

        // **The measured baseline, and it is what makes the second half
        // mean anything.** On the shipped seed the undecorated coin lands
        // on the FRIDGE, so a mutant that flattened the satisfaction read
        // to a constant - the [L26] failure one slot down - recreates the
        // exact tie and lands here, where this assertion sees it, rather
        // than surviving on whichever way the coin happened to fall.
        assert!(
            !picks_bed(None),
            "the shipped seed's tie coin must land on the fridge; if a seed \
             change moves this, the steering case below needs a new \
             baseline, not deletion"
        );

        let mut personality = Personality::neutral();
        personality.satisfaction[NeedId::Energy.index()] = 2.0;
        assert!(
            picks_bed(Some(personality)),
            "energy is worth double to this sim, so the bed must beat the \
             equidistant, equally-urgent fridge - and beat the tie coin \
             that the baseline above shows falls the other way"
        );
    }
}
