use bevy_ecs::prelude::*;
use terri_core::{
    Agent, Eating, NeedId, Needs, Path, Position, Reserved, SmartObject, Target, TileGrid,
};

use super::advertise::score_advertisement;
use crate::Content;

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
    content: Res<Content>,
    agents: Query<(Entity, &Position, &Needs), (With<Agent>, Without<Target>, Without<Eating>)>,
    objects: Query<(Entity, &Position, &SmartObject), Without<Reserved>>,
) {
    // Below this score nothing is worth doing, so the agent stays idle.
    //
    // Read from the pack rather than held in a `const` here, per [D-1]:
    // every value governing the SYSTEM lives in `content/tuning.toml`,
    // so a tuning pass is one file rather than a hunt through Rust. The
    // pack's copy is validated at build time, so nothing here re-checks
    // it.
    let action_threshold = content.0.tuning.action_threshold;

    // Collect and sort so iteration order cannot vary between runs.
    //
    // The whole `Needs` component is carried rather than one deficit,
    // because an advert is a sparse list of (need, delta) pairs: which
    // needs get scored is a property of the candidate, not of the agent.
    let mut idle: Vec<(Entity, Position, Needs)> = agents
        .iter()
        .map(|(e, pos, needs)| (e, *pos, *needs))
        .collect();
    idle.sort_by_key(|(e, _, _)| e.index());

    let mut claimed: Vec<Entity> = Vec::new();

    for (agent, agent_pos, needs) in idle {
        let mut best: Option<(Entity, Vec<(i32, i32)>, u32, f32)> = None;
        let from = (agent_pos.x.round() as i32, agent_pos.y.round() as i32);

        for (object, object_pos, placed) in &objects {
            if claimed.contains(&object) {
                continue;
            }
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
            // candidate per tick, which is nothing. The cost is
            // O(idle agents * unclaimed objects) A* searches per tick and
            // grows with both, so it is the SCALE that will force a
            // change here, not the metric.
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
            let Some(steps) = grid.find_path(from, to) else {
                continue;
            };
            let distance = steps.len() as f32;

            // An object offers a list of interactions and an agent
            // performs one of them, so each is scored separately and the
            // winner is carried forward; see `Target::interaction`.
            for (index, advert) in content.0.object(placed.0).interactions.iter().enumerate() {
                // Summing the per-need scores is a design decision, not
                // an implementation detail. An object that satisfies two
                // needs modestly should be able to beat one that
                // satisfies a single need slightly better, which a max
                // or a first-advert-wins rule would not allow.
                // `an_object_advertising_two_needs_beats_one_advertising_a_bigger_single_delta`
                // is what pins it.
                let mut score = 0.0;
                for (need_index, delta) in &advert.advertises {
                    // In range by construction: content validation
                    // rejects an advert naming a need rustc does not
                    // know, so a compiled pack cannot hold a bad index.
                    let id = NeedId::ALL[*need_index as usize];
                    score += score_advertisement(
                        needs.deficit(id),
                        *delta,
                        advert.duration_ticks,
                        distance,
                    );
                }
                let better = match &best {
                    // Tiebreak on entity index so equal scores resolve
                    // identically every run. Two interactions on the
                    // SAME object compare equal here, so a tied later
                    // interaction cannot displace an earlier one - the
                    // same strictness that settles ties between objects
                    // settles ties within one.
                    Some((best_e, _, _, best_score)) => {
                        score > *best_score
                            || (score == *best_score && object.index() < best_e.index())
                    }
                    None => true,
                };
                if score > action_threshold && better {
                    // The clone is at most a few short paths per agent
                    // per tick, and it buys keeping this comparison
                    // byte-identical to the one three tests pin. Hoisting
                    // the interaction scores into a per-object maximum
                    // first would avoid it and would also move the
                    // within-object tie from the index clause to the
                    // score clause, which is exactly the silent change of
                    // meaning [L30] is about.
                    best = Some((object, steps.clone(), index as u32, score));
                }
            }
        }

        let Some((object, steps, interaction, _)) = best else {
            continue;
        };

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
mod tests {
    use super::*;
    use crate::test_content;
    use crate::Sim;
    use terri_core::ObjectDefId;
    use terri_data::ContentPack;

    /// The advert used wherever two candidates must be indistinguishable
    /// apart from where they stand, so the only thing that can decide
    /// between them is the distance term. These are the shipped fridge's
    /// numbers, so the tests below score the magnitudes the game
    /// actually produces.
    const IDENTICAL_DELTA: f32 = 40.0;
    const IDENTICAL_DURATION: u32 = 15;

    /// One definition with that advert. Two placed entities can share a
    /// single definition, which is precisely what "two objects with
    /// identical adverts" means once the advert lives in the pack.
    fn identical_advert_content() -> &'static ContentPack {
        test_content::pack(vec![test_content::object(
            "identical",
            &[(NeedId::Hunger, IDENTICAL_DELTA)],
            IDENTICAL_DURATION,
        )])
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
    fn action_threshold() -> f32 {
        test_content::tuning().action_threshold
    }

    fn def(content: &ContentPack, id: &str) -> ObjectDefId {
        content
            .find(id)
            .unwrap_or_else(|| panic!("the fixture must declare '{id}'"))
    }

    fn spawn_object(sim: &mut Sim, x: f32, y: f32, def: ObjectDefId) -> Entity {
        sim.world_mut()
            .spawn((Position { x, y }, SmartObject(def)))
            .id()
    }

    fn spawn_agent_with(sim: &mut Sim, x: f32, y: f32, needs: Needs) -> Entity {
        sim.world_mut()
            .spawn((Agent, Position { x, y }, needs))
            .id()
    }

    fn spawn_agent(sim: &mut Sim, x: f32, y: f32, hunger: f32) -> Entity {
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
    fn walk_tiles(agent_at: (f32, f32), object_at: (f32, f32)) -> f32 {
        let dx = object_at.0.round() - agent_at.0.round();
        let dy = object_at.1.round() - agent_at.1.round();
        dx.abs() + dy.abs()
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
        // index and wins any tie through the index tiebreak - which is
        // what turns each of those into a FAILURE here rather than a pass
        // on a tie this test never meant to create.
        let content = identical_advert_content();
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
        assert_eq!(walk_tiles((8.0, 8.0), (11.0, 8.0)), 3.0);
        assert_eq!(walk_tiles((8.0, 8.0), (1.0, 8.0)), 7.0);
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
        let content = identical_advert_content();
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
        assert_eq!(walk_tiles((8.0, 8.0), (8.0, 11.0)), 3.0);
        assert_eq!(walk_tiles((8.0, 8.0), (8.0, 1.0)), 7.0);
        assert!(
            far_score > action_threshold(),
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
             winner means the walked distance along y no longer reaches \
             the score",
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

        let content = test_content::pack(vec![
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
        assert_eq!(walk_tiles(AGENT_AT, NEAR_AT), 7.0);
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

        let content = test_content::pack(vec![
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
            let content = test_content::pack(vec![
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
        const OBJECT_AT: (f32, f32) = (7.0, 5.0);
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
        let content = identical_advert_content();
        let mut sim = test_content::sim_with(16, 16, content);
        let identical = def(content, "identical");
        // Mirrored about the agent, so both are exactly 3 tiles away and
        // score bit-identically. Spawned before the agent so object index
        // ascends with spawn order.
        let incumbent = spawn_object(&mut sim, 5.0, 8.0, identical);
        let challenger = spawn_object(&mut sim, 11.0, 8.0, identical);
        let agent = spawn_agent(&mut sim, 8.0, 8.0, 20.0);

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
            "a tied object with a higher index must not displace the \
             object already held as best; if it does, the score \
             comparison is no longer strict",
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

        let content = identical_advert_content();
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
             archetype order; a different winner means the score tiebreak \
             is gone",
        );
    }
}
