use bevy_ecs::prelude::*;
use terri_core::{
    Agent, Eating, NeedId, Needs, Path, Position, Reserved, SmartObject, Target, TileGrid,
};

use super::advertise::score_advertisement;

/// Below this score nothing is worth doing, so the agent stays idle.
const ACTION_THRESHOLD: f32 = 0.05;

/// Idle agents scan advertisements, pick the best, reserve it, and path
/// to it. Serialized on purpose: reservation is contended state, so it
/// runs in deterministic entity order per [D4].
///
/// The type_complexity allow is unavoidable: the filter tuple that keeps
/// busy agents out of selection is exactly what pushes the query type
/// past clippy's threshold, and a type alias would only move the same
/// type somewhere less readable.
#[allow(clippy::type_complexity)]
pub fn select_action(
    mut commands: Commands,
    grid: Res<TileGrid>,
    agents: Query<(Entity, &Position, &Needs), (With<Agent>, Without<Target>, Without<Eating>)>,
    objects: Query<(Entity, &Position, &SmartObject), Without<Reserved>>,
) {
    // Collect and sort so iteration order cannot vary between runs.
    //
    // Only the hunger deficit is read, because `SmartObject` still
    // advertises a single hardcoded need. Once an advert is a list of
    // (NeedId, delta) pairs from the content pack, scoring sums over the
    // pairs and this becomes the whole `Needs` component.
    let mut idle: Vec<(Entity, Position, f32)> = agents
        .iter()
        .map(|(e, pos, needs)| (e, *pos, needs.deficit(NeedId::Hunger)))
        .collect();
    idle.sort_by_key(|(e, _, _)| e.index());

    let mut claimed: Vec<Entity> = Vec::new();

    for (agent, agent_pos, deficit) in idle {
        let mut best: Option<(Entity, Position, f32)> = None;

        for (object, object_pos, advert) in &objects {
            if claimed.contains(&object) {
                continue;
            }
            // Euclidean straight-line distance, deliberately, not A*
            // path length. Scoring runs against every candidate object
            // every tick, so pathing each one first would be far too
            // expensive. The cost is that an object one tile away
            // through a wall scores as near and is then walked around.
            // Acceptable in M0's single open room; revisit when [D7]'s
            // room and portal graph lands and walls become common.
            let dx = object_pos.x - agent_pos.x;
            let dy = object_pos.y - agent_pos.y;
            let distance = (dx * dx + dy * dy).sqrt();
            let score = score_advertisement(
                deficit,
                advert.hunger_delta,
                advert.duration_ticks,
                distance,
            );
            let better = match best {
                // Tiebreak on entity index so equal scores resolve
                // identically every run.
                Some((best_e, _, best_score)) => {
                    score > best_score || (score == best_score && object.index() < best_e.index())
                }
                None => true,
            };
            if score > ACTION_THRESHOLD && better {
                best = Some((object, *object_pos, score));
            }
        }

        let Some((object, object_pos, _)) = best else {
            continue;
        };

        let from = (agent_pos.x.round() as i32, agent_pos.y.round() as i32);
        let to = (object_pos.x.round() as i32, object_pos.y.round() as i32);
        let Some(steps) = grid.find_path(from, to) else {
            continue;
        };

        claimed.push(object);
        commands.entity(object).insert(Reserved);
        commands
            .entity(agent)
            .insert((Target(object), Path { steps, cursor: 0 }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::systems::needs::HUNGER_DECAY_PER_TICK;
    use crate::Sim;

    /// The advert used wherever two candidates must be indistinguishable
    /// apart from where they stand, so the only thing that can decide
    /// between them is the distance term.
    const IDENTICAL_ADVERT: SmartObject = SmartObject {
        hunger_delta: 40.0,
        duration_ticks: 15,
        slots: 1,
    };

    fn spawn_object(sim: &mut Sim, x: f32, y: f32, advert: SmartObject) -> Entity {
        sim.world_mut().spawn((Position { x, y }, advert)).id()
    }

    fn spawn_agent(sim: &mut Sim, x: f32, y: f32, hunger: f32) -> Entity {
        sim.world_mut()
            .spawn((
                Agent,
                Position { x, y },
                Needs::with(NeedId::Hunger, hunger),
            ))
            .id()
    }

    /// The deficit `select_action` scored with, read back after the tick.
    ///
    /// `decay_needs` runs immediately before `select_action` and nothing
    /// else touches hunger on a tick where the agent only starts walking,
    /// so the post-tick level is exactly the one scoring saw. The agent's
    /// POSITION is not, because `follow_path` runs after selection and
    /// has already moved it, which is why every helper below takes the
    /// spawn coordinates as arguments instead of reading them back.
    fn deficit_after_tick(sim: &Sim, agent: Entity) -> f32 {
        sim.world()
            .get::<Needs>(agent)
            .expect("the agent must still have Needs")
            .deficit(NeedId::Hunger)
    }

    /// An independent restatement of the straight-line distance
    /// `select_action` computes, used only to assert preconditions.
    ///
    /// Restating it here rather than calling into the system is the whole
    /// point: a mutation of the production arithmetic does not follow the
    /// helper, so the preconditions keep holding and the golden
    /// winner assertion is what fails. If this ever calls production code
    /// the tests below stop being able to see the bug they exist for.
    fn straight_line(agent_at: (f32, f32), object_at: (f32, f32)) -> f32 {
        let dx = object_at.0 - agent_at.0;
        let dy = object_at.1 - agent_at.1;
        (dx * dx + dy * dy).sqrt()
    }

    fn score_of(
        deficit: f32,
        agent_at: (f32, f32),
        object_at: (f32, f32),
        advert: SmartObject,
    ) -> f32 {
        score_advertisement(
            deficit,
            advert.hunger_delta,
            advert.duration_ticks,
            straight_line(agent_at, object_at),
        )
    }

    /// Asserts the single object `agent` chose, with the non-emptiness
    /// guard [L3] requires: "the right one won" must not be satisfiable
    /// by "nothing won at all".
    fn assert_chose(sim: &Sim, agent: Entity, winner: Entity, loser: Entity, why: &str) {
        let target = sim
            .world()
            .get::<Target>(agent)
            .unwrap_or_else(|| panic!("the agent must have chosen an object; {why}"));
        assert_eq!(target.0, winner, "{why}");
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
    fn distance_uses_the_x_offset_between_agent_and_object() {
        // Two objects advertising exactly the same interaction, both on
        // the agent's own row so the y term is zero for each. The only
        // thing that can separate them is `object_pos.x - agent_pos.x`.
        //
        // GOLDEN assertion, for the reason spelled out in the tie and
        // contention tests below: do NOT rewrite it as a comparison of
        // two scores or two runs.
        //
        // The geometry is chosen, not arbitrary. The far object sits at a
        // SMALLER x than the agent and the near one at a LARGER x, which
        // is what makes the two arithmetic mutations of that subtraction
        // visible:
        //   `x + x` gives far 1+8 = 9 against near 11+8 = 19,
        //   `x / x` gives far 1/8 = 0.125 against near 11/8 = 1.375,
        // so both flip the winner. Placing both objects on the same side
        // of the agent would leave the division order-preserving and the
        // test would pass with it in place.
        //
        // The far object is also spawned FIRST, so it holds the lower
        // entity index. Any mutation that collapses the two distances
        // into a tie - `dx * dx` to `dx / dx`, or `+ dy * dy` to
        // `* dy * dy`, both of which make the distance identical for
        // every object - then hands the win to the far one via the index
        // tiebreak, and this test fails rather than passing on a tie it
        // never meant to create.
        let mut sim = Sim::new_with_lot(16, 16);
        let far = spawn_object(&mut sim, 1.0, 8.0, IDENTICAL_ADVERT);
        let near = spawn_object(&mut sim, 11.0, 8.0, IDENTICAL_ADVERT);
        let agent = spawn_agent(&mut sim, 8.0, 8.0, 20.0);

        sim.tick();

        let deficit = deficit_after_tick(&sim, agent);
        let (near_score, far_score) = (
            score_of(deficit, (8.0, 8.0), (11.0, 8.0), IDENTICAL_ADVERT),
            score_of(deficit, (8.0, 8.0), (1.0, 8.0), IDENTICAL_ADVERT),
        );
        // Preconditions. Both candidates must be genuinely selectable, or
        // "the near one won" could be satisfied by the far one being
        // ineligible for some unrelated reason.
        assert_eq!(straight_line((8.0, 8.0), (11.0, 8.0)), 3.0);
        assert_eq!(straight_line((8.0, 8.0), (1.0, 8.0)), 7.0);
        assert!(
            far_score > ACTION_THRESHOLD,
            "the losing object must still clear the threshold, or this \
             test proves nothing about choosing between them; got {far_score}"
        );
        assert!(
            near_score > far_score,
            "identical adverts must score the nearer object higher; \
             {near_score} vs {far_score}"
        );

        assert_chose(
            &sim,
            agent,
            near,
            far,
            "the nearer of two identical objects must win; a different \
             winner means the x offset no longer reaches the score",
        );
    }

    #[test]
    fn distance_uses_the_y_offset_between_agent_and_object() {
        // The mirror of the test above, rotated onto the y axis so the x
        // term is zero for both candidates. It is a separate test rather
        // than a second case in the same one because it pins a different
        // line: with dx zero for both objects, only
        // `object_pos.y - agent_pos.y` can separate them.
        //
        // Rotating also changes which mutations of line 49 it sees.
        // `dx * dx + dy * dy` becoming `dx * dx - dy * dy` takes the
        // square root of a negative number here, so both candidates score
        // NaN, fall to zero through the scoring guard, and the agent
        // chooses nothing at all - which the non-emptiness assertion in
        // `assert_chose` catches. The x-axis version above cannot see
        // that mutation, because subtracting a zero y term changes
        // nothing.
        let mut sim = Sim::new_with_lot(16, 16);
        let far = spawn_object(&mut sim, 8.0, 1.0, IDENTICAL_ADVERT);
        let near = spawn_object(&mut sim, 8.0, 11.0, IDENTICAL_ADVERT);
        let agent = spawn_agent(&mut sim, 8.0, 8.0, 20.0);

        sim.tick();

        let deficit = deficit_after_tick(&sim, agent);
        let (near_score, far_score) = (
            score_of(deficit, (8.0, 8.0), (8.0, 11.0), IDENTICAL_ADVERT),
            score_of(deficit, (8.0, 8.0), (8.0, 1.0), IDENTICAL_ADVERT),
        );
        assert_eq!(straight_line((8.0, 8.0), (8.0, 11.0)), 3.0);
        assert_eq!(straight_line((8.0, 8.0), (8.0, 1.0)), 7.0);
        assert!(
            far_score > ACTION_THRESHOLD,
            "the losing object must still clear the threshold; got {far_score}"
        );
        assert!(
            near_score > far_score,
            "identical adverts must score the nearer object higher; \
             {near_score} vs {far_score}"
        );

        assert_chose(
            &sim,
            agent,
            near,
            far,
            "the nearer of two identical objects must win; a different \
             winner means the y offset no longer reaches the score",
        );
    }

    #[test]
    fn distance_is_weighed_against_benefit_rather_than_merely_consulted() {
        // "Nearer wins" is satisfied by any monotonic use of distance,
        // including ones that get the magnitude badly wrong. This test
        // pins the trade: a big enough benefit must be able to outrank a
        // shorter walk.
        //
        // The near object is worth 10 hunger at 5 tiles, the far one 60
        // at sqrt(104) ~= 10.2 tiles, both taking 15 ticks. Scoring
        // divides benefit by 4*distance + duration + 1, so the far object
        // wins 60/56.8 against 10/36, a factor of about 3.8. Distance is
        // still doing real work: it costs the far object a third of its
        // score.
        //
        // GOLDEN assertion. The near object is spawned first and so holds
        // the lower index, which means any mutation that flattens the two
        // distances into a tie also fails this test through the index
        // tiebreak.
        //
        // The offsets are picked so `dy * dy` becoming `dy + dy` is
        // visible: the far object's radicand is then 2*2 + 2*(-10) = -16,
        // its distance NaN and its score zero, so the near object wins
        // and this test fails. Neither axis-aligned test above can see
        // that mutation, because doubling a zero y offset changes
        // nothing.
        const NEAR_ADVERT: SmartObject = SmartObject {
            hunger_delta: 10.0,
            duration_ticks: 15,
            slots: 1,
        };
        const FAR_ADVERT: SmartObject = SmartObject {
            hunger_delta: 60.0,
            duration_ticks: 15,
            slots: 1,
        };
        const AGENT_AT: (f32, f32) = (10.0, 14.0);
        const NEAR_AT: (f32, f32) = (13.0, 18.0);
        const FAR_AT: (f32, f32) = (12.0, 4.0);

        let mut sim = Sim::new_with_lot(24, 24);
        let near = spawn_object(&mut sim, NEAR_AT.0, NEAR_AT.1, NEAR_ADVERT);
        let far = spawn_object(&mut sim, FAR_AT.0, FAR_AT.1, FAR_ADVERT);
        let agent = spawn_agent(&mut sim, AGENT_AT.0, AGENT_AT.1, 20.0);

        sim.tick();

        let deficit = deficit_after_tick(&sim, agent);
        let near_score = score_of(deficit, AGENT_AT, NEAR_AT, NEAR_ADVERT);
        let far_score = score_of(deficit, AGENT_AT, FAR_AT, FAR_ADVERT);
        // Preconditions: the near object really is nearer, really is a
        // live candidate, and really does lose anyway.
        assert_eq!(straight_line(AGENT_AT, NEAR_AT), 5.0);
        assert!(
            straight_line(AGENT_AT, FAR_AT) > straight_line(AGENT_AT, NEAR_AT),
            "the high-benefit object must be the farther one or this test \
             is not a trade-off at all"
        );
        assert!(
            near_score > ACTION_THRESHOLD,
            "the near object must be selectable on its own; got {near_score}"
        );
        assert!(
            far_score > near_score,
            "the far object's benefit must outweigh its extra travel; \
             {far_score} vs {near_score}"
        );

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

    #[test]
    fn a_score_exactly_at_the_action_threshold_selects_nothing() {
        // The threshold comparison is `score > ACTION_THRESHOLD`. The
        // only input that can tell `>` from `>=` is a score that lands
        // exactly on the constant, so this test constructs one bit
        // exactly rather than approaching it.
        //
        // Every term is chosen to be exact in binary32: hunger decays to
        // exactly 50.0 on the first tick, giving deficit 0.5 and urgency
        // 0.125; two tiles of travel at 0.25 tiles per tick is 8 ticks,
        // plus 7 ticks of interaction plus 1 is a denominator of exactly
        // 16. 6.4, 0.8 and 0.05 share a mantissa, so 0.125 * 6.4 / 16 is
        // 0.05f32 with no rounding anywhere.
        //
        // The other six needs spawn satisfied and never decay, so they
        // contribute nothing to the score and cannot perturb the
        // arithmetic away from the constant.
        //
        // The above and below cases are not decoration: without them
        // "selects nothing" would also be satisfied by a world that can
        // never select anything.
        const EXACT_DELTA: f32 = 6.4;
        const ABOVE_DELTA: f32 = 6.5;
        const BELOW_DELTA: f32 = 6.3;
        const AGENT_AT: (f32, f32) = (5.0, 5.0);
        const OBJECT_AT: (f32, f32) = (7.0, 5.0);
        const DURATION: u32 = 7;

        /// Builds a one-object world, ticks once, and reports whether the
        /// agent selected anything.
        fn selects(delta: f32) -> bool {
            let mut sim = Sim::new_with_lot(16, 16);
            let object = spawn_object(
                &mut sim,
                OBJECT_AT.0,
                OBJECT_AT.1,
                SmartObject {
                    hunger_delta: delta,
                    duration_ticks: DURATION,
                    slots: 1,
                },
            );
            // Decay runs before selection, so start one tick's worth
            // above the level the arithmetic below assumes.
            let agent = spawn_agent(
                &mut sim,
                AGENT_AT.0,
                AGENT_AT.1,
                50.0 + HUNGER_DECAY_PER_TICK,
            );

            sim.tick();

            assert_eq!(
                deficit_after_tick(&sim, agent),
                0.5,
                "the deficit scoring saw must be exactly 0.5 or the \
                 boundary arithmetic below does not land on the constant"
            );
            match sim.world().get::<Target>(agent) {
                Some(target) => {
                    assert_eq!(
                        target.0, object,
                        "the only object in the world must be the one selected"
                    );
                    true
                }
                None => false,
            }
        }

        // Precondition: the middle case really is the boundary, bitwise.
        let exact = score_advertisement(
            0.5,
            EXACT_DELTA,
            DURATION,
            straight_line(AGENT_AT, OBJECT_AT),
        );
        assert_eq!(
            exact.to_bits(),
            ACTION_THRESHOLD.to_bits(),
            "the boundary case must score bit-identically to the \
             threshold or it tests an ordinary inequality; got {exact}"
        );

        assert!(
            selects(ABOVE_DELTA),
            "a score above the threshold must be acted on"
        );
        assert!(
            !selects(EXACT_DELTA),
            "the threshold is strict: a score exactly equal to \
             ACTION_THRESHOLD is not worth doing"
        );
        assert!(
            !selects(BELOW_DELTA),
            "a score below the threshold must be ignored"
        );
    }

    #[test]
    fn a_tied_object_with_a_higher_index_cannot_displace_the_incumbent() {
        // The companion to the `tied_scores_resolve_by_object_index...`
        // test below, and it exists because that test only covers one of
        // the two iteration orders a tie can arrive in.
        //
        // There, the lower-index object iterates LAST, so it has to
        // actively displace the incumbent and the tiebreak clause is what
        // lets it. Here there is no archetype churn, so the lower-index
        // object iterates FIRST and must be left alone. That is the case
        // that pins the comparison being STRICT:
        //
        //   `score > best_score` relaxed to `score >= best_score` lets
        //   the tied later object take over, and `&&` in the tiebreak
        //   relaxed to `||` does the same. Both leave the churned test
        //   green, because there the later object is the one that ought
        //   to win anyway.
        //
        // GOLDEN assertion, and for the same reason as its companion: a
        // two-run comparison in one process shares an archetype layout
        // and would agree with itself while being wrong.
        let mut sim = Sim::new_with_lot(16, 16);
        // Mirrored about the agent, so both are exactly 3 tiles away and
        // score bit-identically. Spawned before the agent so object index
        // ascends with spawn order.
        let incumbent = spawn_object(&mut sim, 5.0, 8.0, IDENTICAL_ADVERT);
        let challenger = spawn_object(&mut sim, 11.0, 8.0, IDENTICAL_ADVERT);
        let agent = spawn_agent(&mut sim, 8.0, 8.0, 20.0);

        sim.tick();

        // The precondition the whole test rests on: the two scores must
        // be BIT-identical, not merely close, or `score > best_score`
        // settles the winner and the tiebreak never fires.
        let deficit = deficit_after_tick(&sim, agent);
        let incumbent_score = score_of(deficit, (8.0, 8.0), (5.0, 8.0), IDENTICAL_ADVERT);
        let challenger_score = score_of(deficit, (8.0, 8.0), (11.0, 8.0), IDENTICAL_ADVERT);
        assert_eq!(
            incumbent_score.to_bits(),
            challenger_score.to_bits(),
            "the two objects must score bitwise identically or this test \
             pins nothing; got {incumbent_score} and {challenger_score}"
        );
        assert!(
            incumbent_score > ACTION_THRESHOLD,
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
            "a tied object with a higher index must not displace the \
             object already held as best; if it does, the score \
             comparison is no longer strict",
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
        let mut sim = Sim::new_with_lot(16, 16);

        // Spawn agents first so entity index ascends with spawn order.
        let agents: Vec<Entity> = (0..3)
            .map(|_| {
                sim.world_mut()
                    .spawn((
                        Agent,
                        Position { x: 1.0, y: 1.0 },
                        Needs::with(NeedId::Hunger, 20.0),
                    ))
                    .id()
            })
            .collect();
        let fridge = sim
            .world_mut()
            .spawn((
                Position { x: 5.0, y: 5.0 },
                SmartObject {
                    hunger_delta: 40.0,
                    duration_ticks: 15,
                    slots: 1,
                },
            ))
            .id();

        // Archetype churn. Moves the lowest-index agent to the back of
        // the table, so iteration order and index order now disagree.
        sim.world_mut().entity_mut(agents[0]).insert(Eating {
            remaining_ticks: 1,
            delta_per_tick: 0.0,
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
            sim.world().get::<Target>(holders[0]).unwrap().0,
            fridge,
            "the winner must target the fridge"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_some(),
            "the winner must have reserved the fridge"
        );
    }

    #[test]
    fn tied_scores_resolve_by_object_index_not_archetype_order() {
        // One agent, two objects whose scores are exactly equal. Which
        // one wins is decided entirely by the second half of the `better`
        // expression in `select_action`:
        //
        //     score == best_score && object.index() < best_e.index()
        //
        // That clause is what makes the argmax unique. The `objects`
        // query iterates UNSORTED, which is only safe because this
        // tiebreak leaves no room for iteration order to matter. Delete
        // the clause and the winner becomes whichever tied object the
        // archetype happened to yield first, and archetype order shifts
        // as objects gain and lose `Reserved`.
        //
        // GOLDEN assertion, for the same reason as the contention test
        // above: do NOT rewrite this as a two-run comparison. Two runs in
        // one process share one archetype layout, so they would agree
        // with each other while both being wrong.
        let mut sim = Sim::new_with_lot(16, 16);

        let advert = SmartObject {
            hunger_delta: 40.0,
            duration_ticks: 15,
            slots: 1,
        };
        // Mirrored about the agent at x = 8, so both are exactly 3 tiles
        // away. Spawned before the agent so object index ascends with
        // spawn order.
        let left = sim
            .world_mut()
            .spawn((Position { x: 5.0, y: 8.0 }, advert))
            .id();
        let right = sim
            .world_mut()
            .spawn((Position { x: 11.0, y: 8.0 }, advert))
            .id();
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 8.0, y: 8.0 },
                Needs::with(NeedId::Hunger, 20.0),
            ))
            .id();

        // Archetype churn on the objects, which is how it happens for
        // real: an object leaves and re-enters the unreserved archetype
        // every time it is claimed and released. Leaving swap-removes it
        // from its table and re-entering appends it at the end, so the
        // lower-index object now iterates LAST.
        sim.world_mut().entity_mut(left).insert(Reserved);
        sim.world_mut().entity_mut(left).remove::<Reserved>();

        sim.tick();

        // The precondition this whole test rests on: the two scores must
        // be BIT-identical, not merely close. If they differed in the
        // last bit, `score > best_score` would settle the winner and the
        // tiebreak would never fire, leaving the test decorative.
        // `decay_needs` runs before `select_action` within a tick and
        // nothing else touches hunger on a tick where the agent only
        // starts walking, so the post-tick level is exactly the one
        // scoring saw.
        let deficit = sim
            .world()
            .get::<Needs>(agent)
            .unwrap()
            .deficit(NeedId::Hunger);
        let distance = |ox: f32| {
            let dx = ox - 8.0;
            let dy = 8.0f32 - 8.0;
            (dx * dx + dy * dy).sqrt()
        };
        let score_left = score_advertisement(deficit, 40.0, 15, distance(5.0));
        let score_right = score_advertisement(deficit, 40.0, 15, distance(11.0));
        assert_eq!(
            score_left.to_bits(),
            score_right.to_bits(),
            "the two objects must score bitwise identically or this test \
             pins nothing; got {score_left} and {score_right}"
        );
        assert!(
            score_left > ACTION_THRESHOLD,
            "the tied score must clear the action threshold; got {score_left}"
        );

        let target = sim
            .world()
            .get::<Target>(agent)
            .expect("the agent must have chosen one of the tied objects");
        assert_eq!(
            target.0, left,
            "the lower object index must win a tied score regardless of \
             archetype order; a different winner means the score tiebreak \
             is gone"
        );
        assert!(
            sim.world().get::<Reserved>(left).is_some(),
            "the winning object must be reserved"
        );
        assert!(
            sim.world().get::<Reserved>(right).is_none(),
            "the losing object must stay free"
        );
    }
}
