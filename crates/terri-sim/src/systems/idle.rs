use bevy_ecs::prelude::*;
use terri_core::{Agent, Eating, Path, Position, Restless, SimRng, Target, TileGrid, Wander};

use crate::Content;

/// A path to a randomly chosen reachable tile, or `None` if `attempts`
/// rolls all failed.
///
/// # Why a roll can fail, and why the count is bounded
///
/// A destination is drawn uniformly over the whole grid and then pathed
/// to, so two kinds of roll come back useless: a tile behind a wall or
/// outside the walkable region, where `find_path` returns `None`, and the
/// agent's own tile, where it returns an EMPTY path. The second is worth
/// rejecting explicitly rather than accepting: an empty path would be
/// inserted, walked in zero steps, and dropped on the next tick, which
/// spends a wander on standing still.
///
/// Re-rolling is the right answer to both - a sim in a small room should
/// keep looking rather than give up because its first guess was a wall.
/// **The bound is what stops that becoming a hang.** A sim sealed in with
/// nowhere to walk has no successful roll available at all, so an
/// unbounded loop would spin forever inside one tick: the simulation
/// would stop, the test would not fail, and CI would report a timeout
/// rather than an assertion. [L15] is the recorded instance of that being
/// a far weaker signal. Bounded, the same sim simply stands still for the
/// tick and tries again on the next one.
///
/// `attempts` is at least 1 by content validation, so a compiled pack
/// cannot describe a sim that never rolls at all.
///
/// Two draws per attempt, x then y, and that order is part of the
/// simulation's PRNG consumption: changing it changes every subsequent
/// draw in the run.
pub fn roll_wander_path(
    grid: &TileGrid,
    from: (i32, i32),
    attempts: u32,
    rng: &mut SimRng,
) -> Option<Vec<(i32, i32)>> {
    for _ in 0..attempts {
        let x = rng.range(grid.width()) as i32;
        let y = rng.range(grid.height()) as i32;
        let Some(steps) = grid.find_path(from, (x, y)) else {
            continue;
        };
        if steps.is_empty() {
            continue;
        }
        return Some(steps);
    }
    None
}

/// Sends idle sims for a stroll - [D-5].
///
/// A sim with nothing worth doing used to stand perfectly still, which
/// reads as frozen rather than as content. This gives it somewhere to go
/// and a pause between goings.
///
/// # It reuses the intent path rather than moving anything itself
///
/// The whole system does one thing: insert a `Path`. `follow_path` walks
/// it exactly as it walks a path to the fridge, which is what makes a
/// wander overridable - `select_action` overwrites `Path` the moment
/// something becomes worth doing, and a player-issued command will do the
/// same. A wander-specific mover would be a second copy of speed, arrival
/// and interpolation, and the two would drift.
///
/// # Which sims
///
/// `Restless` is the filter, and it is set by `select_action` rather than
/// re-derived here. It means "nothing this agent can reach scored above
/// `idle_threshold`", which is strictly stronger than "took no action":
/// an agent whose best option sits between `idle_threshold` and
/// `action_threshold` stays put instead of strolling away from it. That
/// band is the reason the two knobs are separate at all, and re-deriving
/// the condition here would mean a second copy of the scoring sweep -
/// one A* per candidate, run twice a tick - that could disagree with the
/// first.
///
/// `Without<Path>` is what stops a sim re-rolling its destination every
/// tick mid-stroll, and it is also why the pause counts only while the
/// sim is standing still.
///
/// # The order is load-bearing
///
/// Agents are visited in entity-index order, not query order. This system
/// draws from the shared `SimRng`, and query iteration is archetype
/// order, which shifts whenever any agent gains or loses a component. Two
/// restless sims would otherwise be dealt their destinations according to
/// which of them had most recently eaten. Same rule, same reason, as the
/// sort in `select_action` - see [D-3].
///
/// The type_complexity allow is unavoidable for the same reason it is in
/// `select_action`: the filter tuple that isolates genuinely idle agents
/// is what pushes the query past clippy's threshold.
#[allow(clippy::type_complexity)]
pub fn wander(
    mut commands: Commands,
    grid: Res<TileGrid>,
    content: Res<Content>,
    mut rng: ResMut<SimRng>,
    agents: Query<
        (Entity, &Position, Option<&Wander>),
        (
            With<Agent>,
            With<Restless>,
            Without<Target>,
            Without<Eating>,
            Without<Path>,
            // A sim somebody reserved stands STILL - [H4]. The initiator's
            // path was planned against this sim's tile, and a stroll that
            // moves the tile makes the walk arrive beside nobody. The
            // `Restless` marker can be stale here precisely because
            // `select_action` no longer sees reserved sims to update it.
            Without<terri_core::Reserved>,
        ),
    >,
) {
    let pause_ticks = content.0.tuning.wander_pause_ticks;
    let attempts = content.0.tuning.wander_attempts;

    let mut idle: Vec<(Entity, Position, u32)> = agents
        .iter()
        // Absent means "has never wandered", which is not a pause: a sim
        // that has just run out of things to do should set off rather
        // than stand about for the length of a gap it never had.
        .map(|(entity, pos, wander)| (entity, *pos, wander.map_or(0, |w| w.pause_ticks)))
        .collect();
    idle.sort_by_key(|(entity, _, _)| entity.index());

    for (agent, pos, remaining) in idle {
        if remaining > 0 {
            commands.entity(agent).insert(Wander {
                pause_ticks: remaining - 1,
            });
            continue;
        }

        let from = (pos.x.round() as i32, pos.y.round() as i32);
        // No reachable destination this tick. Stand still and try again
        // on the next one, rather than looping until one turns up.
        let Some(steps) = roll_wander_path(&grid, from, attempts, &mut rng) else {
            continue;
        };

        commands
            .entity(agent)
            .insert((Path { steps, cursor: 0 }, Wander { pause_ticks }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_content;
    use crate::Sim;
    use std::collections::BTreeSet;
    use terri_core::{NeedId, Needs, SimRng, SmartObject, TileGrid, NEED_MAX};
    use terri_data::{ContentPack, Tuning};

    /// A content pack holding one modest hunger object, so the fixtures
    /// below are "a sim with nothing pressing to do in a furnished room"
    /// rather than "a sim in an empty void".
    ///
    /// That distinction is [L34]: an empty lot makes every agent restless
    /// for the trivial reason that there is nothing to score, so a suite
    /// built only on empty lots could not tell "wanders when nothing is
    /// worth doing" from "wanders whenever it has no target".
    fn furnished() -> &'static ContentPack {
        test_content::pack(vec![test_content::object(
            "fridge_ish",
            &[(NeedId::Hunger, 40.0)],
            15,
        )])
    }

    /// The object's tile and the agent's, and the walk between them.
    ///
    /// **Four tiles apart, walked three**, and the gap is load-bearing rather
    /// than arbitrary. Selection paths to a NEIGHBOUR of the object, so an
    /// agent spawned one tile away - which this fixture used to do - is already
    /// where it needs to be: `find_path_adjacent` returns an empty path and
    /// `follow_path` starts the interaction on the very first tick.
    ///
    /// That silently emptied the window in
    /// `a_sim_with_an_urgent_need_does_not_wander`, whose whole subject is
    /// what a sim does *while walking somewhere hungry*. Its own
    /// "the window must contain at least one tick" guard caught it, which is
    /// the only reason it did not become a test of nothing.
    const OBJECT_TILE: (f32, f32) = (10.0, 8.0);
    const AGENT_TILE: (f32, f32) = (6.0, 8.0);
    /// What `select_action` divides by for this fixture: the walk to the tile
    /// BESIDE the object, which is one less than the four tiles between them.
    const WALKED_TILES: f32 = 3.0;

    /// A 16x16 sim with that object a short walk from one agent whose needs
    /// are all at `hunger`, ready to be ticked.
    fn scenario(content: &'static ContentPack, hunger: f32) -> (Sim, Entity) {
        let mut sim = test_content::sim_with(16, 16, content);
        sim.world_mut().spawn((
            Position {
                x: OBJECT_TILE.0,
                y: OBJECT_TILE.1,
            },
            SmartObject(content.find("fridge_ish").expect("the fixture declares it")),
        ));
        let mut needs = Needs::all_at(NEED_MAX);
        needs.set(NeedId::Hunger, hunger);
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position {
                    x: AGENT_TILE.0,
                    y: AGENT_TILE.1,
                },
                needs,
            ))
            .id();
        (sim, agent)
    }

    fn position_of(sim: &Sim, agent: Entity) -> (f32, f32) {
        let pos = sim
            .world()
            .get::<Position>(agent)
            .expect("the agent must still have a Position");
        (pos.x, pos.y)
    }

    /// Every position the agent occupied, one per tick, plus whether it
    /// ever held a `Target` and whether it ever held a target-less
    /// `Path` - which is what a wander looks like from outside.
    struct Walk {
        positions: Vec<(f32, f32)>,
        ever_targeted: bool,
        path_without_target: bool,
    }

    fn observe(sim: &mut Sim, agent: Entity, ticks: usize) -> Walk {
        let mut walk = Walk {
            positions: vec![position_of(sim, agent)],
            ever_targeted: false,
            path_without_target: false,
        };
        for _ in 0..ticks {
            sim.tick();
            walk.positions.push(position_of(sim, agent));
            let targeted = sim.world().get::<Target>(agent).is_some();
            let pathed = sim.world().get::<Path>(agent).is_some();
            walk.ever_targeted |= targeted;
            walk.path_without_target |= pathed && !targeted;
        }
        walk
    }

    fn moved(walk: &Walk) -> bool {
        walk.positions.windows(2).any(|w| w[0] != w[1])
    }

    #[test]
    fn a_sim_with_nothing_worth_doing_walks_somewhere_instead_of_standing_still() {
        // The milestone's visible claim. A sated sim next to a fridge has
        // nothing worth doing, and before [D-5] it stood perfectly still
        // for as long as that lasted, which reads as a frozen game rather
        // than as a contented person.
        //
        // The fridge is present and deliberately not the answer: the
        // assertions below require the sim to move WITHOUT ever acquiring
        // a target, so "it walked" cannot be satisfied by it going for a
        // snack after all.
        let (mut sim, agent) = scenario(furnished(), NEED_MAX);
        let walk = observe(&mut sim, agent, 40);

        assert!(
            !walk.ever_targeted,
            "the sim must have nothing worth doing, or this test is about \
             walking to an object rather than about wandering"
        );
        assert!(
            walk.path_without_target,
            "a wandering sim must hold a Path with no Target; without one \
             it is not wandering at all"
        );
        assert!(
            moved(&walk),
            "the sim never moved from {:?} in 40 ticks; nothing worth \
             doing must not mean standing perfectly still",
            walk.positions[0]
        );
    }

    #[test]
    fn a_wandering_sim_pauses_between_wanders_instead_of_moving_every_tick() {
        // "It moves" is satisfied by a sim that paces without stopping,
        // which reads as agitated rather than as idle. This pins the gap,
        // and pins it against the tuned knob rather than against a
        // number, so a hardcoded pause fails here.
        //
        // The count is `wander_pause_ticks + 1`, and the extra tick is
        // real rather than an off-by-one worth hiding: the first
        // stationary tick is the one on which `follow_path` discovers the
        // path is exhausted and removes it without moving, and the pause
        // proper starts on the tick after, because `wander` only counts
        // down for a sim that has no `Path`.
        let pause = test_content::tuning().wander_pause_ticks;
        assert!(
            pause > 1,
            "the tuned pause must be long enough to distinguish from no \
             pause at all; got {pause}"
        );

        let (mut sim, agent) = scenario(furnished(), NEED_MAX);
        let walk = observe(&mut sim, agent, 260);

        assert!(
            !walk.ever_targeted,
            "the sim must never have had anything worth doing, or a walk \
             to the fridge would be counted as a wander"
        );

        // The first run of consecutive ticks with no movement, taken
        // after the sim has moved at least once so that it is a gap
        // BETWEEN wanders rather than the run-up to the first.
        let mut stalls: Vec<usize> = Vec::new();
        let mut run = 0usize;
        let mut has_moved = false;
        for pair in walk.positions.windows(2) {
            if pair[0] == pair[1] {
                if has_moved {
                    run += 1;
                }
            } else {
                has_moved = true;
                if run > 0 {
                    stalls.push(run);
                }
                run = 0;
            }
        }

        assert!(
            !stalls.is_empty(),
            "the sim moved on every tick for 260 ticks, so it never \
             paused between wanders at all"
        );
        assert!(
            stalls.len() >= 2,
            "at least two completed pauses are needed before 'it pauses \
             BETWEEN wanders' means anything; saw {stalls:?}"
        );
        for observed in &stalls {
            assert_eq!(
                *observed,
                pause as usize + 1,
                "a pause between wanders lasted {observed} ticks rather \
                 than the tuned {pause} (plus the one tick on which the \
                 finished path is removed); every pause seen was {stalls:?}"
            );
        }
    }

    #[test]
    fn a_wandering_sim_only_walks_to_tiles_it_can_actually_reach() {
        // A destination is rolled uniformly over the WHOLE grid, so most
        // rolls in this fixture are unreachable: a full-height wall at
        // x = 4 leaves the sim four columns out of sixteen. Three
        // properties have to hold together, and each rules out a
        // different wrong implementation:
        //
        //   - it never crosses the wall, which a path built without
        //     consulting `find_path` would;
        //   - it moves anyway, which a single-attempt roll would fail to
        //     do most ticks and which is the whole reason the re-roll
        //     exists;
        //   - it visits more than one tile, so "it moved" is not one
        //     lucky roll.
        const WALL_X: i32 = 4;
        let content = furnished();
        let mut sim = Sim::new_with_lot(16, 16);
        sim.world_mut().insert_resource(Content(content));
        sim.world_mut()
            .insert_resource(SimRng::from_seed(content.tuning.rng_seed));
        {
            let mut grid = sim.world_mut().resource_mut::<TileGrid>();
            for y in 0..16 {
                grid.set_blocked(WALL_X as usize, y, true);
            }
        }
        let agent = sim
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 8.0 }, Needs::all_at(NEED_MAX)))
            .id();

        let walk = observe(&mut sim, agent, 200);

        assert!(
            moved(&walk),
            "the sim never moved; a roll that lands beyond the wall must \
             be re-rolled rather than treated as 'nowhere to go'"
        );
        let tiles: BTreeSet<(i32, i32)> = walk
            .positions
            .iter()
            .map(|(x, y)| (x.round() as i32, y.round() as i32))
            .collect();
        assert!(
            tiles.len() > 2,
            "the sim only ever occupied {tiles:?}, which is one wander at \
             most; the re-roll must keep finding it somewhere to go"
        );
        for (x, y) in &tiles {
            assert!(
                *x < WALL_X,
                "the sim reached ({x}, {y}), which is past the wall at \
                 x = {WALL_X}; a wander destination must be one \
                 `find_path` actually returns a route to"
            );
        }
    }

    /// Two restless agents in an empty lot, with `Restless` attached in
    /// the given order so that the archetype it creates lists them that
    /// way. Everything else about the two worlds is identical.
    fn two_restless(late_first: bool) -> (Sim, Entity, Entity) {
        // No objects, deliberately: nothing to score means nothing can
        // consume a draw before `wander` does, so the destinations below
        // are the first two rolls of the seeded generator and a swapped
        // assignment is visible rather than buried under selection.
        let content = test_content::pack(Vec::new());
        let mut sim = test_content::sim_with(16, 16, content);
        let first = sim
            .world_mut()
            .spawn((Agent, Position { x: 2.0, y: 2.0 }, Needs::all_at(NEED_MAX)))
            .id();
        let second = sim
            .world_mut()
            .spawn((Agent, Position { x: 12.0, y: 9.0 }, Needs::all_at(NEED_MAX)))
            .id();

        let mut order = vec![first, second];
        if late_first {
            order.reverse();
        }
        for agent in order {
            sim.world_mut().entity_mut(agent).insert(Restless);
        }

        (sim, first, second)
    }

    fn steps_of(sim: &Sim, agent: Entity) -> Vec<(i32, i32)> {
        sim.world()
            .get::<Path>(agent)
            .expect("a restless agent must have been sent somewhere")
            .steps
            .clone()
    }

    /// The order this system's query yields restless agents in, with no
    /// sorting applied - the order the destinations must NOT depend on.
    #[allow(clippy::type_complexity)]
    fn raw_restless_order(sim: &Sim) -> Vec<u32> {
        let mut state = sim
            .world()
            .try_query_filtered::<(Entity, &Position, Option<&Wander>), (
                With<Agent>,
                With<Restless>,
                Without<Target>,
                Without<Eating>,
                Without<Path>,
            )>()
            .expect("every component in the wander query is registered in Sim::new");
        state
            .iter(sim.world())
            .map(|(entity, _, _)| entity.index_u32())
            .collect()
    }

    #[test]
    fn wander_destinations_follow_entity_order_not_archetype_order() {
        // This system draws from the shared `SimRng`, so **the order it
        // visits agents in decides which agent walks where.** Query
        // iteration is archetype order, which is allocation history
        // rather than simulation state, so without the sort two idle sims
        // would swap destinations depending on which of them had most
        // recently stopped eating. Same rule and same reason as the sorts
        // in `select_action` and `follow_path`; see [D-3] and [L5].
        //
        // `cargo mutants` cannot see this line at all - a `sort_by_key`
        // whose only effect is on state is outside its grammar - so this
        // test is the only thing standing between the sort and someone
        // deleting it as tidiness. See docs/testing-protocol.md rule 2.
        let (mut ordered, first_a, second_a) = two_restless(false);
        let (mut churned, first_b, second_b) = two_restless(true);
        assert_eq!(
            (first_a.index_u32(), second_a.index_u32()),
            (first_b.index_u32(), second_b.index_u32()),
            "the two worlds must allocate the same entity indices"
        );
        assert_ne!(
            raw_restless_order(&ordered),
            raw_restless_order(&churned),
            "the two worlds must iterate their restless agents in \
             different orders, or this test cannot detect an ordering \
             dependency; got {:?}",
            raw_restless_order(&ordered)
        );

        ordered.tick();
        churned.tick();

        assert_ne!(
            steps_of(&ordered, first_a),
            steps_of(&ordered, second_a),
            "the two destinations must differ, or a swapped assignment \
             would be indistinguishable from the correct one"
        );
        assert_eq!(
            steps_of(&ordered, first_a),
            steps_of(&churned, first_b),
            "the lower-indexed sim was sent somewhere else in a world \
             whose only difference is archetype layout; which sim gets \
             which draw must be a function of entity index"
        );
        assert_eq!(
            steps_of(&ordered, second_a),
            steps_of(&churned, second_b),
            "the higher-indexed sim was sent somewhere else in a world \
             whose only difference is archetype layout"
        );
    }

    #[test]
    fn a_sealed_sim_gives_up_after_exactly_the_tuned_number_of_rolls() {
        // The bound, asserted as a RETURN rather than as an absence of a
        // hang. That distinction is the point: an unbounded re-roll in a
        // sealed room does not fail a test, it stops the test from
        // finishing, and a CI job timeout is a much weaker signal than an
        // assertion ([L15]). This test cannot be satisfied by a hang,
        // because it reads the generator afterwards.
        //
        // The grid is 8x8 - both powers of two - deliberately. `range`
        // rejects biased draws, so at a bound that does not divide 2^32
        // the number of `next_u32` calls per roll is not fixed and the
        // draw count below could not be an equality. At a power of two
        // the rejection threshold is zero and every roll is exactly two
        // draws, which is what makes "exactly `2 * attempts`" checkable.
        const SIZE: usize = 8;
        const ATTEMPTS: u32 = 5;
        const SEED: u64 = 909;

        // Every tile blocked except the one the sim stands on, so no roll
        // can succeed: the sim's own tile yields an empty path and is
        // rejected, and every other tile is unwalkable.
        let mut grid = TileGrid::new(SIZE, SIZE);
        for y in 0..SIZE {
            for x in 0..SIZE {
                if (x, y) != (0, 0) {
                    grid.set_blocked(x, y, true);
                }
            }
        }
        assert!(
            grid.find_path((0, 0), (1, 0)).is_none(),
            "the fixture must genuinely be sealed, or this test is about \
             an ordinary roll"
        );

        let mut rng = SimRng::from_seed(SEED);
        assert!(
            roll_wander_path(&grid, (0, 0), ATTEMPTS, &mut rng).is_none(),
            "a sealed sim has nowhere to walk, so the roll must give up \
             rather than return a path"
        );

        // Exactly two draws per attempt and not one more, which is what
        // "bounded by `wander_attempts`" means in the only unit the
        // generator has. A loop that kept rolling would never reach this
        // line at all.
        let mut reference = SimRng::from_seed(SEED);
        for _ in 0..(2 * ATTEMPTS) {
            reference.next_u32();
        }
        assert_eq!(
            rng.next_u32(),
            reference.next_u32(),
            "the sealed roll consumed a different number of draws than \
             {ATTEMPTS} attempts of two, so the loop is not bounded by \
             wander_attempts"
        );
    }

    #[test]
    fn a_sim_with_an_urgent_need_does_not_wander() {
        // The one that stops wandering eating the whole behaviour. A bug
        // that made a sim wander regardless would satisfy every other
        // test in this module, and on screen it would look like a sim
        // that starves while strolling.
        //
        // Two independent statements, because either alone is weak.
        // `Restless` never appearing is the direct claim about the
        // decision; "every Path it held came with a Target" is the
        // observable consequence, and it is what would still fail if the
        // marker were ever set by something other than `select_action`.
        //
        // The window closes when the sim starts eating, and that bound is
        // the point rather than a convenience. A FED sim is supposed to
        // become restless - that is the previous test - so a window that
        // ran past the meal would be asserting the opposite claim a few
        // ticks later and failing for the right behaviour.
        let (mut sim, agent) = scenario(furnished(), 5.0);
        let mut ticks_hungry = 0;
        let mut reached_the_fridge = false;
        for _ in 0..200 {
            sim.tick();
            if sim.world().get::<Eating>(agent).is_some() {
                reached_the_fridge = true;
                break;
            }
            ticks_hungry += 1;
            assert!(
                sim.world().get::<Restless>(agent).is_none(),
                "a starving sim was marked restless after {ticks_hungry} \
                 ticks, so nothing it could reach scored above \
                 idle_threshold - which cannot be true with a fridge one \
                 tile away"
            );
            assert!(
                sim.world().get::<Path>(agent).is_none()
                    || sim.world().get::<Target>(agent).is_some(),
                "the sim held a path with no target after \
                 {ticks_hungry} ticks, which is a wander"
            );
        }

        assert!(
            reached_the_fridge,
            "the sim must actually reach the fridge; without that this \
             test passes on a sim that did nothing at all"
        );
        assert!(
            ticks_hungry > 0,
            "the hungry window must contain at least one tick, or the \
             assertions inside it never ran"
        );
    }

    #[test]
    fn an_option_between_the_two_thresholds_stops_a_sim_wandering_without_making_it_act() {
        // **This is the test that keeps `idle_threshold` a separate knob.**
        // Replace it with `action_threshold` in `select_action` and this
        // is the only thing in the workspace that notices: the sim would
        // become restless and stroll away from something it had just
        // decided was mildly interesting.
        //
        // The fixture opens the band wide - a very low idle threshold and
        // a very high action one - so the target score has somewhere
        // unambiguous to sit, and both bounds are asserted below against
        // the score the simulation actually computes rather than
        // described.
        const IDLE: f32 = 0.001;
        const ACTION: f32 = 1.0;
        const DELTA: f32 = 40.0;
        const DURATION: u32 = 15;
        const HUNGER: f32 = 63.0;
        const TICKS: usize = 30;

        let content = test_content::pack_tuned(
            vec![test_content::object(
                "fridge_ish",
                &[(NeedId::Hunger, DELTA)],
                DURATION,
            )],
            Tuning {
                idle_threshold: IDLE,
                action_threshold: ACTION,
                ..test_content::tuning()
            },
        );
        let (mut sim, agent) = scenario(content, HUNGER);
        let walk = observe(&mut sim, agent, TICKS);

        // The score selection saw, restated here rather than read out of
        // the system, and taken at the END of the run where the deficit
        // is largest: if even the largest score in the window stays
        // inside the band, every earlier one did too.
        let deficit = sim
            .world()
            .get::<Needs>(agent)
            .expect("the agent must still have Needs")
            .deficit(NeedId::Hunger);
        // WALKED_TILES, not the four tiles between the two positions: the
        // agent stops beside the object, and this restatement has to divide by
        // the same distance the system did or the band it checks is not the
        // band the sim saw.
        let score =
            crate::systems::advertise::score_advertisement(deficit, DELTA, DURATION, WALKED_TILES);
        assert!(
            score > IDLE,
            "the option must clear the idle threshold, or the sim is \
             right to wander and this test proves nothing; {score} vs {IDLE}"
        );
        assert!(
            score < ACTION,
            "the option must stay below the action threshold, or the sim \
             is right to act; {score} vs {ACTION}"
        );

        assert!(
            !walk.ever_targeted,
            "the option scored below the action threshold, so the sim \
             must not act on it"
        );
        assert!(
            !walk.path_without_target,
            "the option scored ABOVE the idle threshold, so the sim must \
             not wander away from it; collapsing idle_threshold into \
             action_threshold is what makes this fail"
        );
        assert!(
            !moved(&walk),
            "the sim moved without either acting or wandering, which \
             leaves nothing that could have moved it: {:?}",
            walk.positions
        );
    }
}
