//! Simulation systems and scheduling. No web dependencies, ever.

mod mood;
pub mod render_buffer;
mod save;
pub mod systems;
#[cfg(test)]
pub mod test_content;

use bevy_ecs::prelude::*;
use bevy_ecs::schedule::ExecutorKind;
use terri_core::SimClock;

pub use mood::{MoodSnapshot, Moodlet};
pub use save::SaveError;

/// The content pack, as a resource so systems can resolve object ids and
/// decay rates. Holds a `&'static` because the pack is embedded at build
/// time and deserialised once.
///
/// Systems read this rather than calling `terri_data::pack()` directly,
/// which is what lets a test point a world at a pack of its own.
#[derive(Resource, Debug, Clone, Copy)]
pub struct Content(pub &'static terri_data::ContentPack);

/// Owns the ECS world and the tick schedule.
pub struct Sim {
    world: World,
    schedule: Schedule,
    command_schedule: Schedule,
    render: render_buffer::RenderBuffer,
}

#[derive(Debug)]
struct RenderRow {
    index: u32,
    x: f32,
    y: f32,
    kind: u32,
    sprite: u32,
    activity: u32,
    visual_action: u32,
    facing: u32,
    carrying: u32,
}

/// Chooses the dominant lot axis from `source` toward `anchor`.
///
/// A diagonal tie chooses x. Coincident participants cannot supply a
/// direction geometrically, so entity order supplies a stable one: the lower
/// index faces positive x and the higher index faces negative x. This keeps
/// the pair opposite without consulting row order or wall time.
fn facing_toward(
    source_entity: Entity,
    source: &terri_core::Position,
    anchor_entity: Entity,
    anchor: &terri_core::Position,
) -> u32 {
    use render_buffer::facing;

    let dx = anchor.x - source.x;
    let dy = anchor.y - source.y;
    if dx == 0.0 && dy == 0.0 {
        return if source_entity.index_u32() < anchor_entity.index_u32() {
            facing::POSITIVE_X
        } else {
            facing::NEGATIVE_X
        };
    }
    if dx.abs() >= dy.abs() {
        if dx > 0.0 {
            facing::POSITIVE_X
        } else {
            facing::NEGATIVE_X
        }
    } else if dy > 0.0 {
        facing::POSITIVE_Y
    } else {
        facing::NEGATIVE_Y
    }
}

fn opposite_facing(value: u32) -> u32 {
    use render_buffer::facing;

    match value {
        facing::POSITIVE_X => facing::NEGATIVE_X,
        facing::NEGATIVE_X => facing::POSITIVE_X,
        facing::POSITIVE_Y => facing::NEGATIVE_Y,
        facing::NEGATIVE_Y => facing::POSITIVE_Y,
        _ => facing::NONE,
    }
}

fn is_authored_talk_visual(interaction: &terri_data::CompiledInteraction) -> bool {
    let Some(visual) = interaction.visual.as_ref() else {
        return false;
    };
    matches!(
        (&visual.action, &visual.anchor, &visual.facing,),
        (
            terri_data::CompiledVisualAction::Talk,
            terri_data::CompiledVisualAnchor::Partner,
            terri_data::CompiledVisualFacing::TowardAnchor,
        )
    )
}

impl Sim {
    /// Captures every world resource, entity component, entity reference,
    /// and staged player command needed to resume this simulation exactly.
    pub fn save_snapshot(&self) -> terri_core::SaveSnapshotV1 {
        save::capture(self)
    }

    /// Transactionally replaces this simulation from a validated snapshot.
    /// On any error `self` is untouched.
    pub fn load_snapshot(&mut self, snapshot: terri_core::SaveSnapshotV1) -> Result<(), SaveError> {
        let content = self.world.resource::<Content>().0;
        let restored = save::restore(snapshot, content)?;
        *self = restored;
        Ok(())
    }

    /// Creates a sim with a **1x1 placeholder lot**, so only tile (0, 0)
    /// is walkable.
    ///
    /// Only suitable for worlds that never path: need decay, clock, and
    /// component-level tests. Any world built with `Sim::new` or
    /// `Sim::default` that contains a smart object will have every
    /// `find_path` return `None` on every tick, so agents silently never
    /// go anywhere - no panic, no log, and the sim looks alive because
    /// needs still decay. Use [`Sim::new_with_lot`] whenever agents are
    /// expected to move, or [`Sim::new_from_lot`] to load an authored
    /// lot with its walls and objects.
    pub fn new() -> Self {
        let mut world = World::new();
        world.insert_resource(SimClock::default());
        // A placeholder lot so Res<TileGrid> never panics. Callers that
        // care about the lot use new_with_lot, which replaces this.
        world.insert_resource(terri_core::TileGrid::new(1, 1));
        world.insert_resource(Content(terri_data::pack()));
        // The simulation PRNG, as a world resource per [D-3]. Randomness
        // must not mean nondeterminism: the golden hashes, replay, the
        // save-file command log and the planned multiplayer all rest on
        // the simulation being bit-reproducible, so every draw comes from
        // here and the seed is content rather than a wall clock.
        //
        // Seeded from the pack, which means from `content/tuning.toml`.
        // A test that installs its own pack must reseed to match - see
        // `test_content::sim_with`, which does.
        world.insert_resource(terri_core::SimRng::from_seed(
            terri_data::pack().tuning.rng_seed,
        ));
        // The staging area for player input - [D-2]. It has to exist from
        // construction rather than on first use, because `drain_commands`
        // takes it as `ResMut` and a missing resource is a panic on the
        // first tick rather than a command that quietly does nothing.
        world.insert_resource(terri_core::CommandQueue::default());

        // Register components eagerly. This is NOT optional bookkeeping:
        // World::try_query returns None if ANY component in the query is
        // unregistered, including one behind Option<&T>. Task 7's
        // world_hash uses try_query, so without this a world that never
        // spawned a Needs would hash zero rows and the determinism test
        // would pass by comparing two empty hashes - green while testing
        // nothing. Later tasks must add their components here too.
        world.register_component::<terri_core::Position>();
        world.register_component::<terri_core::Agent>();
        world.register_component::<terri_core::Needs>();
        world.register_component::<terri_core::SmartObject>();
        world.register_component::<terri_core::Reserved>();
        world.register_component::<terri_core::Path>();
        world.register_component::<terri_core::Target>();
        world.register_component::<terri_core::Eating>();
        world.register_component::<terri_core::Restless>();
        world.register_component::<terri_core::Wander>();
        // M1b Task 4's two. Neither is in `world_hash`'s query today, so
        // an unregistered one would not silently empty the digest the way
        // [L3] describes - but `try_query` is what every determinism test
        // in this file reaches for, and a component missing from this
        // list turns those into panics for a reason that has nothing to
        // do with what they test.
        // `the_components_m1b_added_are_registered_before_any_system_runs`
        // is what fails if either line goes.
        world.register_component::<terri_core::Selected>();
        world.register_component::<terri_core::IntentQueue>();
        // Habituation, and this one IS in `world_hash`'s query, so [L3] bites
        // directly: unregistered, `try_query` returns None and the digest goes
        // empty rather than wrong, which compares equal to another empty digest
        // and passes every determinism test while testing nothing.
        world.register_component::<terri_core::Habituation>();
        // M2c's three. `Personality` sits behind `Option<&Personality>` in
        // three systems' queries, and `try_query` returns None for an
        // unregistered component even behind an Option, so this line is
        // what keeps every determinism test in this file from panicking
        // for an unrelated reason.
        world.register_component::<terri_core::SimId>();
        world.register_component::<terri_core::SimName>();
        world.register_component::<terri_core::Personality>();
        // M2d's two. `Relationships` is in `world_hash`'s query, so [L3]
        // bites the way it does for Habituation: unregistered, the digest
        // goes EMPTY rather than wrong, and empty compares equal to
        // empty. `Socialising` is not in the digest, but `select_action`
        // filters on it and `try_query` panics tests for unregistered
        // components even behind filters.
        world.register_component::<terri_core::Relationships>();
        world.register_component::<terri_core::Socialising>();
        // M2e's two. `Satisfaction` is in `world_hash`'s query, so [L3]
        // bites exactly as it does for Habituation and Relationships:
        // unregistered, the digest goes EMPTY rather than wrong.
        // `Hobbies` stays out of the digest (spawn-time content,
        // derivable from the pack - the Personality precedent, with the
        // same expiry the day something mutates one), but tests reach
        // it through `try_query`.
        world.register_component::<terri_core::Satisfaction>();
        world.register_component::<terri_core::Hobbies>();
        // M2e PR 2's two. `Traits` is in `world_hash`'s query - [L3]'s
        // empty-digest trap, the standing reason. `Fumbled` is not (the
        // same transient-action class as Eating), but tests reach it
        // through `try_query`.
        world.register_component::<terri_core::Traits>();
        world.register_component::<terri_core::Fumbled>();
        // A-11's facing carrier. In `sync_render_buffer`'s query (a
        // plain `World::query`, which self-registers) rather than the
        // digest's `try_query`, so this line is for the determinism
        // tests' benefit, like Selected and IntentQueue above.
        world.register_component::<terri_core::SpriteVariant>();
        // M2e PR 3's three. `AtWork` is in `world_hash`'s query - [L3]'s
        // empty-digest trap, the standing reason. `Career` and
        // `Commuting` are not (spawn-time content and transient action
        // state respectively), but tests reach both through `try_query`.
        world.register_component::<terri_core::Career>();
        world.register_component::<terri_core::Commuting>();
        world.register_component::<terri_core::AtWork>();
        // M2f's two. Both in `world_hash`'s query - [L3]'s empty-digest
        // trap, the standing reason: the chain's program counter is
        // the resume state, and the carried item is what the counter
        // is about.
        world.register_component::<terri_core::ChainState>();
        world.register_component::<terri_core::Carrying>();
        // Not hashed (the Eating class), but tests reach it through
        // `try_query`.
        world.register_component::<terri_core::StepWork>();
        // The household's money - [E4]. From construction like the
        // SimId allocator, so a save file can restore it before any
        // shift completes.
        world.insert_resource(terri_core::Funds::default());
        // The identity counter - [H1]. From construction rather than on
        // first spawn, so a save file can restore it before any sim exists.
        world.insert_resource(terri_core::SimIdAllocator::default());

        let mut schedule = Schedule::default();
        // M0 runs single-threaded on purpose. Parallelism is [A9]/[D4]
        // and requires the commutativity rule; keeping it off now makes
        // determinism trivially safe.
        schedule.set_executor_kind(ExecutorKind::SingleThreaded);
        // Order matches the tick pipeline in ARCHITECTURE.md [D5],
        // reduced to the systems M0 needs.
        schedule.add_systems(
            (
                // **First, before anything else in the tick** - [D-2].
                // Player input is asynchronous and lands in a staging
                // queue; this is the full tick's command boundary. The
                // paused schedule below runs the same system alone, which
                // keeps a recorded command log replaying to the same world.
                //
                // Before `serve_intents` specifically, because an intent
                // pushed here has to be servable on the same tick: a
                // click that took a tick to have any effect would leave
                // the sim choosing for itself in the meantime, and at 10
                // ticks a second the player would see the sim start
                // walking somewhere else first.
                // `a_use_object_command_is_served_on_the_tick_it_arrives`
                // is what fails if this line moves.
                systems::command::drain_commands,
                advance_clock,
                systems::needs::decay_needs,
                // A shift start IS a command, issued by the clock - the
                // same preemption a player click gets - so it sits
                // where commands become state: before `serve_intents`
                // and `select_action`, which both skip a commuting or
                // working sim outright. After `advance_clock`, because
                // the day clock it reads must be THIS tick's.
                systems::career::start_shift,
                // Strictly before selection, because a player-issued
                // intent overrides autonomy rather than competing with
                // it - [D-3]. Running it first means the object is
                // already `Reserved` and the agent already has a
                // `Target` by the time `select_action` looks, so no
                // other agent can be handed the thing the player just
                // asked for.
                //
                // It also sees agents that are mid-walk or mid-meal,
                // which `select_action` deliberately does not, because
                // an intent PREEMPTS a running interaction. See that
                // function's docs for why that is the choice.
                systems::action::serve_intents,
                systems::action::select_action,
                // Directly after selection, so a chain chosen this
                // tick (or resumed after an interruption) gets its
                // station walk on the same tick a chosen fridge gets
                // its path - and there is exactly ONE targeting code
                // path for chains, this system ([K4]).
                systems::chain::advance_chains,
                // Strictly after selection and strictly before movement,
                // and both halves matter. After, because it reads the
                // `Restless` marker selection has just written, so a sim
                // that found something worth doing this tick never gets
                // as far as considering a stroll. Before, because a
                // wander path is then walked on the tick it is chosen,
                // exactly like a path to an object - a wander that had
                // to wait a tick would read as a hesitation.
                systems::idle::wander,
                systems::movement::follow_path,
                // Directly after movement, because arrival at the door
                // is a fact `follow_path` establishes (an exhausted
                // target-less path is removed there - the wander shape,
                // reused). Handles clock-in, the countdown, and the
                // paid return.
                systems::career::commute_and_work,
                systems::interact::tick_interactions,
                // Beside tick_interactions because it is the same job
                // for chain steps: run the clock at the station, and
                // pay - whole, terminal-only - when the last one ends.
                systems::chain::tick_chain_steps,
                // Beside `tick_interactions` because it is the same job
                // for conversations: deliver per tick, complete, release
                // the reservation. After `follow_path` so a conversation
                // begins delivering on the tick after arrival, exactly
                // as a meal does.
                systems::social::tick_social,
                // Last two, and their positions are genuinely free - unlike
                // every other line here. Each reads and writes one component
                // per agent, shares no state, and nothing else reads its
                // component on a tick it writes: `select_action` ran earlier
                // and saw the previous tick's values. See `decay_habituation`.
                systems::habituation::decay_habituation,
                systems::social::decay_relationships,
                // Third of the genuinely-free family: reads Needs (which
                // nothing later writes) and writes Satisfaction (which
                // nothing else reads mid-tick). The hobby PAYOUT is not
                // here - completions pay inside tick_interactions and
                // tick_social, where the completion-only rule already
                // lives.
                systems::satisfaction::bleed_neglect,
            )
                .chain(),
        );

        // Pausing stops full simulation ticks, but it must not freeze player
        // input. This schedule applies the same deterministic command drain
        // without advancing the clock, decaying needs, or running autonomy.
        // It is separate from the full schedule because Bevy owns each
        // system instance from initialisation onward.
        let mut command_schedule = Schedule::default();
        command_schedule.set_executor_kind(ExecutorKind::SingleThreaded);
        command_schedule.add_systems(systems::command::drain_commands);

        Self {
            world,
            schedule,
            command_schedule,
            render: render_buffer::RenderBuffer::default(),
        }
    }

    /// Creates a sim with an empty walkable lot of the given size.
    pub fn new_with_lot(width: usize, height: usize) -> Self {
        let mut sim = Self::new();
        sim.world
            .insert_resource(terri_core::TileGrid::new(width, height));
        sim
    }

    /// Creates a sim holding a compiled lot: the grid sized to it, its
    /// walls **and every placed object's footprint** marked unwalkable, and
    /// every placed object spawned.
    ///
    /// This is what makes `content/lot.toml` reach the game. Everything
    /// it reads is post-validation, so nothing here re-checks it:
    /// `terri-data`'s `compile` rejects a wall or a placement outside the
    /// lot, a footprint that leaves it or crosses a wall, two footprints
    /// that overlap, and an object nothing can walk up to; and `build.rs`
    /// runs that validation over the shipped content at build time, so a
    /// pack that exists cannot hold any of them. That is what lets
    /// `set_blocked` be called without a bounds test - it asserts, and an
    /// assertion firing here would mean the content gate had been removed
    /// rather than that this function needs a guard.
    ///
    /// **Footprint tiles are blocked rather than merely used for adjacency**,
    /// which is [F3]. Leaving them walkable would be cheaper and would leave
    /// sims pathing straight through the furniture, which is the defect
    /// footprints exist to fix wearing a different hat; blocking them is
    /// also what makes "two objects cannot overlap" enforceable at all. The
    /// risk it creates - an object in a doorway sealing a room - is what
    /// [F5]'s reachability rule exists to catch, and it catches it at build
    /// time rather than here.
    ///
    /// **`objects` is needed because a footprint is a property of the object
    /// DEFINITION, not of the placement.** A placement carries an
    /// `ObjectDefId`, so the extent has to be looked up; the alternative -
    /// copying each footprint into `CompiledPlacement` - would put the same
    /// fact in the pack twice with nothing to disambiguate the copies.
    ///
    /// Both are passed in rather than read from `terri_data::pack()` so a
    /// test can build them, for the same reason [`Content`] is a resource
    /// rather than a direct call into the content crate.
    pub fn new_from_lot(
        lot: &terri_data::CompiledLot,
        objects: &[terri_data::CompiledObject],
    ) -> Self {
        let mut sim = Self::new();

        let mut grid = terri_core::TileGrid::new(lot.width as usize, lot.height as usize);
        for &(x, y) in &lot.walls {
            grid.set_blocked(x as usize, y as usize, true);
        }

        for placement in &lot.placements {
            // The tile the object stands in is the tile its coordinates fall
            // in, which for a non-negative `f32` is the truncating cast. Same
            // rule `compile_lot` applies when it validates the rectangle, so
            // the tiles blocked here are exactly the tiles it checked.
            let (tile_x, tile_y) = (placement.x as u32, placement.y as u32);
            let footprint = objects[placement.object.0 as usize].footprint;
            for y in tile_y..tile_y + footprint.depth {
                for x in tile_x..tile_x + footprint.width {
                    grid.set_blocked(x as usize, y as usize, true);
                }
            }
        }
        sim.world.insert_resource(grid);

        for placement in &lot.placements {
            let spawned = sim.world.spawn((
                terri_core::Position {
                    x: placement.x,
                    y: placement.y,
                },
                terri_core::SmartObject(placement.object),
            ));
            // A facing is per PLACEMENT, so it cannot live on the object
            // definition; the compile step resolved it to a sprite index
            // and this component is how the index reaches the render
            // buffer. Inserted only when it differs, so every world
            // predating facings - and every test fixture - is untouched.
            let mut spawned = spawned;
            if placement.sprite != objects[placement.object.0 as usize].sprite {
                spawned.insert(terri_core::SpriteVariant(placement.sprite));
            }
        }

        sim
    }

    /// The lot the game ships, compiled from `content/lot.toml`, with the
    /// household from `content/household.toml` living in it.
    ///
    /// A convenience over [`Sim::new_from_lot`] for callers that do not
    /// depend on `terri-data` themselves. `terri-wasm` is the one that
    /// matters: it is the boundary crate, and keeping the content crate
    /// out of its manifest keeps its dependency list as small as the [D1]
    /// purity rule can make it.
    pub fn new_from_shipped_lot() -> Self {
        let pack = terri_data::pack();
        let mut sim = Self::new_from_lot(&pack.lot, &pack.objects);
        sim.spawn_household(&pack.personalities, &pack.household, &pack.traits);
        sim
    }

    /// Spawns the authored household - [H2] - in declaration order, which
    /// is what fixes each member's [`terri_core::SimId`]: the first sim in
    /// the file is SimId 0, for as long as nobody is born or dies before
    /// load finishes.
    ///
    /// Separate from [`Sim::new_from_lot`] rather than folded into it, so
    /// the lot-geometry tests stay statements about geometry and a test
    /// can put ANY household on any lot. Everything read here is
    /// post-validation: `compile` has already rejected a member whose
    /// archetype does not resolve, whose spawn tile is blocked or sealed
    /// off, or whose starting needs leave `[0, 100]` - which is what
    /// makes the `personalities[..]` index below unable to panic on a
    /// pack that exists.
    pub fn spawn_household(
        &mut self,
        personalities: &[terri_data::CompiledPersonality],
        household: &[terri_data::CompiledHouseholdMember],
        traits: &[terri_data::CompiledTrait],
    ) {
        for member in household {
            let sim_id = self
                .world
                .resource_mut::<terri_core::SimIdAllocator>()
                .issue();
            let compiled = &personalities[member.personality as usize];
            let personality = terri_core::Personality::with_dispositions(
                compiled.drain,
                compiled.satisfaction,
                compiled.dispositions.clone(),
            );
            let mut needs = terri_core::Needs::all_at(terri_core::NEED_MAX);
            for id in terri_core::NeedId::ALL {
                needs.set(id, member.needs[id.index()]);
            }
            let mut spawned = self.world.spawn((
                terri_core::Agent,
                terri_core::Position {
                    x: member.x,
                    y: member.y,
                },
                needs,
                sim_id,
                terri_core::SimName(member.name.clone()),
                personality,
                // The second axis starts at zero - a life is judged from
                // move-in day - and the hobbies ride as spawned content
                // ([E1]/[E2]). Household sims carry both; bare test
                // agents carry neither, and every consumer treats the
                // absences as "no hobbies, no ledger", which is what
                // keeps the pre-M2e golden vectors still.
                terri_core::Satisfaction::default(),
                terri_core::Hobbies(member.hobbies.clone()),
                // Worn traits open at their content-defined states: a
                // capability at its start_level, a condition at its
                // start_severity, a disposition stateless at 0 ([E3]).
                terri_core::Traits::from_entries(
                    member
                        .traits
                        .iter()
                        .map(|&index| {
                            let state = match traits[index as usize].kind {
                                terri_data::CompiledTraitKind::Capability {
                                    start_level, ..
                                } => start_level,
                                terri_data::CompiledTraitKind::Condition {
                                    start_severity, ..
                                } => start_severity,
                                terri_data::CompiledTraitKind::Disposition { .. } => 0.0,
                            };
                            (index, state)
                        })
                        .collect(),
                ),
            ));
            // The job rides only on the employed, the SpriteVariant
            // pattern: every jobless sim - and every fixture - has no
            // component rather than a sentinel ([E4]).
            if let Some(career) = member.career {
                spawned.insert(terri_core::Career(career));
            }
        }
    }

    pub fn tick(&mut self) {
        self.schedule.run(&mut self.world);
    }

    /// Applies staged player input without advancing simulation time.
    ///
    /// The browser calls this while paused. Commands still enter through the
    /// same serialized queue and the same drain system as a full tick, so
    /// replay ordering does not acquire a second implementation. Nothing
    /// after command step zero in [D5] runs here.
    pub fn flush_commands(&mut self) {
        self.command_schedule.run(&mut self.world);
    }

    pub fn world(&self) -> &World {
        &self.world
    }

    pub fn world_mut(&mut self) -> &mut World {
        &mut self.world
    }

    /// Copies render-relevant state into the struct-of-arrays buffer that
    /// JavaScript views directly. Called once per tick, before the
    /// renderer reads.
    ///
    /// Entities are sorted by index so an entity keeps its slot between
    /// frames. This is load-bearing rather than tidiness: the renderer
    /// interpolates slot `i` of `prev_positions` towards slot `i` of
    /// `positions` and assumes both belong to the same entity. Query
    /// iteration is archetype order, which shifts every time any entity
    /// gains or loses a component, so without the sort entities would
    /// smear across each other's positions whenever an agent started or
    /// stopped eating. `entity_slots_survive_archetype_churn` pins it;
    /// deleting the sort must fail that test.
    pub fn sync_render_buffer(&mut self) {
        self.sync_render_buffer_inner(true);
    }

    /// Refreshes command-visible render metadata without advancing the two
    /// position samples used for interpolation.
    ///
    /// A paused command can change selection or activity, but no movement
    /// system ran. Swapping position frames here would collapse an in-flight
    /// interpolation into a snap even when the command queue was empty.
    pub fn sync_render_buffer_after_commands(&mut self) {
        self.sync_render_buffer_inner(false);
    }

    fn sync_render_buffer_inner(&mut self, advance_interpolation: bool) {
        use terri_core::{Agent, Position, SmartObject};

        if advance_interpolation {
            std::mem::swap(&mut self.render.prev_positions, &mut self.render.positions);
        }
        self.render.positions.clear();
        self.render.kinds.clear();
        self.render.sprites.clear();
        self.render.ids.clear();
        self.render.activities.clear();
        self.render.visual_actions.clear();
        self.render.facings.clear();
        self.render.carrying.clear();

        // Read before the query, because `Content` is a resource and the
        // query below borrows the world. `ContentPack` is behind a
        // &'static so this is a pointer copy, not a clone.
        let content = self.world.resource::<Content>().0;

        // The receiving side of every conversation, collected first: a
        // partner carries only `Reserved`, so "is being talked TO" is a
        // fact about some OTHER entity's `Socialising` and needs its own
        // pass before the per-row loop can answer it.
        let mut partners: Vec<Entity> = Vec::new();
        let mut conversation_visuals: Vec<(Entity, u32, u32)> = Vec::new();
        {
            let mut talks = self.world.query::<(Entity, &terri_core::Socialising)>();
            for (initiator, talk) in talks.iter(&self.world) {
                partners.push(talk.partner);
                let Some(interaction) = content.social.get(talk.interaction as usize) else {
                    continue;
                };
                if !is_authored_talk_visual(interaction)
                    || self.world.get::<Agent>(initiator).is_none()
                    || self.world.get::<Agent>(talk.partner).is_none()
                {
                    continue;
                }
                let Some(initiator_position) = self.world.get::<Position>(initiator) else {
                    continue;
                };
                let Some(partner_position) = self.world.get::<Position>(talk.partner) else {
                    continue;
                };
                let initiator_facing = facing_toward(
                    initiator,
                    initiator_position,
                    talk.partner,
                    partner_position,
                );
                conversation_visuals.push((
                    initiator,
                    render_buffer::visual_action::TALK,
                    initiator_facing,
                ));
                conversation_visuals.push((
                    talk.partner,
                    render_buffer::visual_action::TALK,
                    opposite_facing(initiator_facing),
                ));
            }
        }

        // World::query (not try_query) registers components on demand and
        // cannot fail, so there is no Option to handle here. It returns an
        // owned QueryState, which ends the &mut borrow immediately and
        // leaves self.render free to write below.
        #[allow(clippy::type_complexity)]
        let mut state = self.world.query::<(
            Entity,
            &Position,
            Has<Agent>,
            Option<&SmartObject>,
            Option<&terri_core::SpriteVariant>,
            Option<&terri_core::Eating>,
            Option<&terri_core::Socialising>,
            Has<terri_core::Path>,
            Has<terri_core::Reserved>,
            Has<terri_core::AtWork>,
            Option<&terri_core::Carrying>,
        )>();
        let mut rows: Vec<RenderRow> = Vec::new();
        for (
            entity,
            pos,
            is_agent,
            object,
            variant,
            eating,
            talking,
            walking,
            reserved,
            at_work,
            carrying,
        ) in state.iter(&self.world)
        {
            let kind = if is_agent { 0 } else { 1 };
            // An entity that is neither an agent nor a smart object has
            // no sprite of its own; the sim's is the only sensible
            // stand-in, and nothing in M1b spawns one. `world_hash`'s
            // bystander fixture is the only thing that ever has.
            //
            // A `SpriteVariant` outranks the definition's sprite: it is
            // the compile-resolved facing this particular placement was
            // authored with.
            let sprite = variant.map_or_else(
                || object.map_or(content.sim_sprite, |placed| content.object(placed.0).sprite),
                |v| v.0,
            );
            // **An object's ROW is centred on its rectangle; its Position
            // component stays on the origin tile.** The renderer anchors
            // every sprite to the projected position it is handed, and
            // it knows nothing about footprints - so a 2x2 bed anchored
            // to its origin tile was drawn one full tile-row north-west
            // of the ground it owns, painting 84% of the spine wall's
            // panel and reading as a bed through a wall, while the
            // dining table never covered its own second tile and its
            // east chair read as orphaned ([A-11]). The rectangle's
            // centre is a fact this crate owns and the shell cannot see,
            // so it is applied here, at the one place rows are written.
            //
            // Display-only by construction: `world_hash` digests the
            // Position COMPONENT, scoring and pathing read the component
            // and the footprint, and none of them read this buffer. The
            // shift also moves the pick box in the shell, which is the
            // point - the drawn sprite and the clickable area move
            // together.
            let (x, y) = match object {
                Some(placed) => {
                    let footprint = content.object(placed.0).footprint;
                    (
                        pos.x + (footprint.width as f32 - 1.0) * 0.5,
                        pos.y + (footprint.depth as f32 - 1.0) * 0.5,
                    )
                }
                None => (pos.x, pos.y),
            };
            // What this row is DOING, for the [A-11] indicator bubbles.
            // Precedence mirrors the trace's motion classifier and for
            // its reasons: a conversation's partner still carries
            // `Reserved`, so talking is tested before waiting; and an
            // eating sim keeps whatever `Wander` marker it had, so
            // interaction states come before movement ones. Sleeping is
            // told apart from eating by the interaction's `sleep` TAG -
            // `systems::circadian::is_asleep`, the same rule `decay_needs`
            // slows the needs by, so a sim wearing a Zzz is exactly a sim
            // whose hunger is slowed.
            //
            // That used to be an inference: whether the biggest positive
            // advert was energy. True of a bed, and equally true of a
            // coffee machine - so the first espresso in the catalogue
            // would have drawn a Zzz. Objects already declare tags, so
            // the answer was authored all along.
            // AT_WORK outranks everything: the row RIDES, flagged, so
            // every later entity keeps its interpolation slot (removing
            // the row would shift the slots after it and smear one
            // frame at every departure and return), and the shell skips
            // drawing it - gone is gone, at the draw call rather than
            // in the buffer ([E4]).
            let activity = if !is_agent {
                render_buffer::activity::NONE
            } else if at_work {
                render_buffer::activity::AT_WORK
            } else if talking.is_some() || partners.contains(&entity) {
                render_buffer::activity::TALKING
            } else if eating.is_some() {
                if systems::circadian::is_asleep(content, eating) {
                    render_buffer::activity::SLEEPING
                } else {
                    render_buffer::activity::EATING
                }
            } else if walking {
                render_buffer::activity::WALKING
            } else if reserved {
                render_buffer::activity::WAITING
            } else {
                render_buffer::activity::NONE
            };
            let (visual_action, facing) = conversation_visuals
                .iter()
                .find_map(|&(participant, action, facing)| {
                    (participant == entity).then_some((action, facing))
                })
                .unwrap_or((
                    render_buffer::visual_action::NONE,
                    render_buffer::facing::NONE,
                ));
            rows.push(RenderRow {
                index: entity.index_u32(),
                x,
                y,
                kind,
                sprite,
                activity,
                visual_action,
                facing,
                carrying: carrying.map_or(render_buffer::NOT_CARRYING, |c| c.0),
            });
        }
        rows.sort_by_key(|row| row.index);

        for row in &rows {
            self.render.positions.push(row.x);
            self.render.positions.push(row.y);
            self.render.kinds.push(row.kind);
            self.render.sprites.push(row.sprite);
            // The row's occupant, carried across so a click on a row can
            // name an entity in a command. See `RenderBuffer::ids` for why
            // the row number will not do.
            self.render.ids.push(row.index);
            self.render.activities.push(row.activity);
            self.render.visual_actions.push(row.visual_action);
            self.render.facings.push(row.facing);
            self.render.carrying.push(row.carrying);
        }
        self.render.count = rows.len();

        // On the first sync there is no previous frame, and a changed
        // row count invalidates the slot mapping wholesale, so seed prev
        // from the current frame to avoid interpolating from garbage or
        // from another entity's coordinates.
        //
        // Read the guard as what it is: a length check, not a membership
        // check. **An unchanged count does not imply an unchanged entity
        // set.** It catches pure additions and pure removals, because
        // those move the length. It does NOT catch one addition and one
        // removal between the same two syncs: `bevy_ecs` reuses freed
        // entity indices, so the new entity can land on the departed
        // one's index, keep its sorted slot, and change only the occupant.
        // Task 12 would then interpolate that slot from the dead entity's
        // last position to the new entity's first one and draw something
        // streaking across the lot in a single frame.
        //
        // Unreachable in M0 - nothing despawns - which is why this is a
        // comment and not a fix. The fix, for whoever first adds a
        // despawn: keep the previous frame's sorted index list alongside
        // `prev_positions` and reseed whenever the new list differs from
        // it, rather than whenever the lengths differ.
        if self.render.prev_positions.len() != self.render.positions.len() {
            self.render.prev_positions = self.render.positions.clone();
        }
    }

    pub fn render_buffer(&self) -> &render_buffer::RenderBuffer {
        &self.render
    }

    /// The seven need levels of the entity carrying `index`, or `None`
    /// if nothing live carries it or what does has no `Needs`.
    ///
    /// # Why this takes a raw index and tolerates a bad one
    ///
    /// The caller is the need-bar panel, which reads this every frame for
    /// whichever entity the shell is showing - and the shell only ever
    /// knows a raw `u32`, because JavaScript cannot construct an
    /// `Entity`. So the same two hazards `drain_commands::resolve`
    /// documents apply: the index may be stale, and it may name something
    /// that is not a sim at all. Both answer `None` here rather than
    /// panicking, which is what lets the boundary return an empty array
    /// and the panel draw nothing.
    ///
    /// A scan rather than a lookup, for the same reason `resolve` is one:
    /// `Entities` could answer liveness but not KIND, and at most one live
    /// entity carries any given index, so the answer does not depend on
    /// iteration order.
    ///
    /// **`Needs` is the filter, and that is the kind check.** A smart
    /// object has no `Needs`, so a click that selected the fridge cannot
    /// reach a level here to show.
    ///
    /// This lives in the simulation crate rather than at the boundary
    /// because it is a query over the world, and `terri-wasm` is
    /// forbidden simulation logic. The boundary's job is the `u32`, not
    /// the walk.
    pub fn needs_of(&self, index: u32) -> Option<[f32; terri_core::NEED_COUNT]> {
        let mut state = self.world.try_query::<(Entity, &terri_core::Needs)>()?;
        state
            .iter(&self.world)
            .find(|(entity, _)| entity.index_u32() == index)
            .map(|(_, needs)| *needs.as_slice())
    }

    /// The stable identity of the sim carrying `index` - the key the
    /// relationships in [`Sim::relationships_of`] point at. `None` for
    /// objects, stale indices, and bare test agents, the same contract
    /// as every scan here.
    pub fn sim_id_of(&self, index: u32) -> Option<u32> {
        let mut state = self.world.try_query::<(Entity, &terri_core::SimId)>()?;
        state
            .iter(&self.world)
            .find(|(entity, _)| entity.index_u32() == index)
            .map(|(_, id)| id.0)
    }

    /// The accumulated satisfaction of the sim carrying `index` - the
    /// [E1] second axis, read by both the debug overlay and the normal HUD.
    /// `None` for objects, stale indices, and bare agents with
    /// no ledger, the same contract as every scan here.
    pub fn satisfaction_of(&self, index: u32) -> Option<f32> {
        let mut state = self
            .world
            .try_query::<(Entity, &terri_core::Satisfaction)>()?;
        state
            .iter(&self.world)
            .find(|(entity, _)| entity.index_u32() == index)
            .map(|(_, ledger)| ledger.value())
    }

    /// The household's money - [E4], read by both the debug overlay and
    /// the normal HUD. One number for the lot, not per sim.
    pub fn funds(&self) -> i64 {
        self.world.resource::<terri_core::Funds>().0
    }

    /// The worn traits of the sim carrying `index`, as (pack trait
    /// index, live state) pairs in key order - the [E3] overlay read.
    /// `None` for objects, stale indices, and bare agents, the same
    /// contract as every scan here; the shell resolves the indices
    /// against the pack's labels, which it reads once.
    pub fn traits_of(&self, index: u32) -> Option<Vec<(u32, f32)>> {
        let mut state = self.world.try_query::<(Entity, &terri_core::Traits)>()?;
        state
            .iter(&self.world)
            .find(|(entity, _)| entity.index_u32() == index)
            .map(|(_, worn)| worn.entries().to_vec())
    }

    /// One label per entry in the pack's trait list, in pack order -
    /// what [`Sim::traits_of`]'s indices resolve against. Here rather
    /// than in `terri-wasm` because the boundary crate is forbidden the
    /// content crate ([D1]); the strings are borrowed from the
    /// `&'static` pack like `interaction_labels`'.
    pub fn trait_labels(&self) -> Vec<&'static str> {
        self.world
            .get_resource::<Content>()
            .map(|content| {
                content
                    .0
                    .traits
                    .iter()
                    .map(|def| def.label.as_str())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The kind of each pack trait - "disposition", "capability" or
    /// "condition" - aligned with [`Sim::trait_labels`], so an overlay
    /// can word a level and a severity differently.
    pub fn trait_kinds(&self) -> Vec<&'static str> {
        self.world
            .get_resource::<Content>()
            .map(|content| {
                content
                    .0
                    .traits
                    .iter()
                    .map(|def| match def.kind {
                        terri_data::CompiledTraitKind::Disposition { .. } => "disposition",
                        terri_data::CompiledTraitKind::Capability { .. } => "capability",
                        terri_data::CompiledTraitKind::Condition { .. } => "condition",
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// One name per entry in the pack's item-kind list, in pack order -
    /// what the render buffer's `carrying` column resolves against.
    pub fn item_kinds(&self) -> Vec<&'static str> {
        self.world
            .get_resource::<Content>()
            .map(|content| content.0.item_kinds.iter().map(String::as_str).collect())
            .unwrap_or_default()
    }

    /// The mid-errand status of the sim carrying `index` - "Cook dinner:
    /// Cook" with the carried kind appended when hands are full - or
    /// `None` when it is not on one. Composed here rather than in the
    /// shell because every word of it is pack content.
    pub fn chain_status_of(&self, index: u32) -> Option<String> {
        let pack = self.world.get_resource::<Content>()?.0;
        let mut state = self.world.try_query::<(
            Entity,
            &terri_core::ChainState,
            Option<&terri_core::Carrying>,
        )>()?;
        state
            .iter(&self.world)
            .find(|(entity, _, _)| entity.index_u32() == index)
            .and_then(|(_, chain_state, carrying)| {
                // Checked lookups, unlike the systems' own indexing: a
                // system reads state it wrote against this pack, while
                // this is a DISPLAY read that a stale component (a
                // future save loaded over changed content) should turn
                // into a blank line, not a panicked overlay.
                let chain = pack.chains.get(chain_state.chain as usize)?;
                let step = chain.steps.get(chain_state.step as usize)?;
                Some(match carrying {
                    Some(item) => {
                        let kind = pack
                            .item_kinds
                            .get(item.0 as usize)
                            .map(String::as_str)
                            .unwrap_or("something unrecognisable");
                        // "Cook dinner - step: Cook", not "Cook
                        // dinner: Cook": the panel prefixes this with a
                        // label of its own, and three colons in one
                        // line reads as nothing at all.
                        format!("{} - step: {} (carrying {})", chain.label, step.label, kind)
                    }
                    None => format!("{} - step: {}", chain.label, step.label),
                })
            })
    }

    /// Why the sim carrying `index` is not acting, or `None` when
    /// nothing is holding it back - the overlay's answer to "she is
    /// starving at the front door and it says idle".
    ///
    /// **Exactly two reasons exist, and they are the two markers
    /// selection writes**: `Blocked` (the best thing it could see is
    /// somebody else's) and `Restless` (nothing it could see cleared
    /// `idle_threshold`). Both can be true at once - it wanted a
    /// contested thing, but not enough to wait for it - which is why
    /// this returns a joined string rather than an enum.
    ///
    /// A pending player order is deliberately NOT in here: an order is
    /// something a sim is about to DO, not a reason it is stuck, and
    /// folding the two together is what made this function's first
    /// name ("standing") mean nothing in particular. See
    /// [`Sim::queued_orders_of`].
    pub fn stall_reason_of(&self, index: u32) -> Option<String> {
        let mut state = self.world.try_query::<(
            Entity,
            Has<terri_core::Blocked>,
            Has<terri_core::Restless>,
            Has<terri_core::Path>,
            Has<terri_core::Target>,
            Has<terri_core::Eating>,
            Has<terri_core::Socialising>,
            Has<terri_core::StepWork>,
            Has<terri_core::AtWork>,
            Has<terri_core::Commuting>,
            Has<terri_core::Reserved>,
        )>()?;
        let (
            _,
            blocked,
            restless,
            walking,
            committed,
            eating,
            talking,
            stepping,
            at_work,
            commuting,
            reserved,
        ) = state
            .iter(&self.world)
            .find(|(entity, ..)| entity.index_u32() == index)?;
        // **A sim that is DOING something is not stalled, whatever its
        // markers still say.** Both markers are written by selection and
        // outlive the moment they described: `Restless` is precisely
        // what SENDS a sim wandering, so a strolling sim carries it for
        // the length of the stroll, and the panel read "doing: walking"
        // over "stalled reason: found nothing worth doing" - two lines
        // contradicting each other about the same sim, which is worse
        // than either alone. Caught by looking at the running game.
        if walking || committed || eating || talking || stepping || at_work || commuting || reserved
        {
            return None;
        }
        let mut parts: Vec<String> = Vec::new();
        if blocked {
            parts.push("waiting on something in use".to_string());
        }
        if restless {
            parts.push("found nothing worth doing".to_string());
        }
        if parts.is_empty() {
            None
        } else {
            Some(parts.join("; "))
        }
    }

    /// How many player-issued orders the sim carrying `index` still has
    /// waiting - a FACT about the queue, reported on its own line
    /// because it is not a stall reason. Zero for a sim with an empty
    /// queue or no queue at all.
    pub fn queued_orders_of(&self, index: u32) -> usize {
        self.world
            .try_query::<(Entity, &terri_core::IntentQueue)>()
            .and_then(|mut state| {
                state
                    .iter(&self.world)
                    .find(|(entity, _)| entity.index_u32() == index)
                    .map(|(_, queue)| queue.len())
            })
            .unwrap_or(0)
    }

    /// The label of the career held by the sim carrying `index`, or
    /// `None` for the unemployed and everything else - [E4]'s overlay
    /// read. The label rather than the index, because the pack lookup
    /// is a query over content this crate owns.
    pub fn career_of(&self, index: u32) -> Option<&'static str> {
        let pack = self.world.get_resource::<Content>()?.0;
        let mut state = self.world.try_query::<(Entity, &terri_core::Career)>()?;
        state
            .iter(&self.world)
            .find(|(entity, _)| entity.index_u32() == index)
            .map(|(_, career)| pack.careers[career.0 as usize].label.as_str())
    }

    /// The authored display name of a smart object, or `None` for sims,
    /// stale indices and anything that is not player-interactable furniture.
    pub fn object_name_of(&self, index: u32) -> Option<&'static str> {
        let pack = self.world.get_resource::<Content>()?.0;
        let mut state = self
            .world
            .try_query::<(Entity, &terri_core::SmartObject)>()?;
        let object = state
            .iter(&self.world)
            .find(|(entity, _)| entity.index_u32() == index)?
            .1;
        pack.objects
            .get((object.0).0 as usize)
            .map(|definition| definition.name.as_str())
    }

    /// The personality multipliers of the sim carrying `index`: `drain`
    /// for all seven needs, then `satisfaction` for all seven - drain
    /// FIRST, pinned by a test with asymmetric halves, because fourteen
    /// floats have no field names once they cross the boundary.
    ///
    /// Read-only debug surface for the [A-11] stats overlay; nothing on
    /// a frame path calls it.
    pub fn personality_of(&self, index: u32) -> Option<[f32; terri_core::NEED_COUNT * 2]> {
        let mut state = self
            .world
            .try_query::<(Entity, &terri_core::Personality)>()?;
        state
            .iter(&self.world)
            .find(|(entity, _)| entity.index_u32() == index)
            .map(|(_, personality)| {
                let mut out = [0.0; terri_core::NEED_COUNT * 2];
                out[..terri_core::NEED_COUNT].copy_from_slice(&personality.drain);
                out[terri_core::NEED_COUNT..].copy_from_slice(&personality.satisfaction);
                out
            })
    }

    /// How the sim carrying `index` feels about everyone it knows, as
    /// interleaved `[sim_id, feeling, sim_id, feeling, ...]` pairs in
    /// the component's own key-sorted order.
    ///
    /// The ids ride as `f32` because wasm-bindgen cannot return a vector
    /// of tuples and two parallel arrays would need an atomicity
    /// contract between two boundary calls. Lossless below 2^24, and
    /// `SimId`s are allocated monotonically from zero in a game whose
    /// household is single digits - the margin is seven orders of
    /// magnitude. Debug surface only, like `personality_of`.
    pub fn relationships_of(&self, index: u32) -> Option<Vec<f32>> {
        let mut state = self
            .world
            .try_query::<(Entity, &terri_core::Relationships)>()?;
        state
            .iter(&self.world)
            .find(|(entity, _)| entity.index_u32() == index)
            .map(|(_, relationships)| {
                let mut out = Vec::with_capacity(relationships.entries().len() * 2);
                for (id, feeling) in relationships.entries() {
                    out.push(id.0 as f32);
                    out.push(*feeling);
                }
                out
            })
    }

    /// The display name of the sim carrying `index`, or `None` when
    /// nothing live carries it or what does has no name - which includes
    /// every object and every bare test agent, so `SimName` is the kind
    /// check the way `Needs` is for [`Sim::needs_of`].
    ///
    /// A scan over a raw index tolerating a stale one, for the reasons
    /// `needs_of` gives; it lives here rather than at the boundary
    /// because it is a query over the world, and `terri-wasm` is
    /// forbidden simulation logic.
    pub fn name_of(&self, index: u32) -> Option<&str> {
        let mut state = self.world.try_query::<(Entity, &terri_core::SimName)>()?;
        state
            .iter(&self.world)
            .find(|(entity, _)| entity.index_u32() == index)
            .map(|(_, name)| name.0.as_str())
    }

    /// The labels of the interactions the smart object carrying `index`
    /// offers, in the order `content/objects.toml` declares them, or
    /// `None` when nothing live carries that index or what does is not a
    /// smart object.
    ///
    /// # Why the shell needs this at all
    ///
    /// The right-click flyout lists one row per interaction, and a row's
    /// POSITION is `Intent::interaction`. So this is not decoration: the
    /// order is the index space, and a list built in TypeScript would be a
    /// second copy of every object's interaction list, kept in sync by
    /// nobody. It would fail the way a mislabelled need bar fails - every
    /// row drawn, every click accepted, and the wording attached to the
    /// wrong verb - which is the coupling [D1] exists to prevent.
    ///
    /// # A scan, a raw index, and a tolerated bad one
    ///
    /// All three for the same reasons [`Sim::needs_of`] gives: the caller
    /// only ever knows a `u32` because JavaScript cannot construct an
    /// `Entity`, the index may be stale, and it may name something that is
    /// not an object. Every one of those answers `None` rather than
    /// panicking, which is what lets the boundary hand back an empty list
    /// and the shell open no menu.
    ///
    /// **`SmartObject` is the filter, and that is the kind check.** A sim
    /// does not carry one, so a right click that landed on a sim cannot
    /// reach a label here - which is what makes "this pick has no
    /// interactions" and "this pick is not an object" the same answer,
    /// deliberately, because the useful response to both is identical.
    ///
    /// It lives here rather than at the boundary because it is a query over
    /// the world and `terri-wasm` is forbidden simulation logic. The
    /// borrowed strings come from the `&'static` pack, so no allocation
    /// happens until the boundary copies them across.
    pub fn interaction_labels(&self, index: u32) -> Option<Vec<&'static str>> {
        let pack = self.world.get_resource::<Content>()?.0;
        let mut state = self
            .world
            .try_query::<(Entity, &terri_core::SmartObject)>()?;
        let (_, object) = state
            .iter(&self.world)
            .find(|(entity, _)| entity.index_u32() == index)?;
        // The object's chains ride AFTER its interactions - [K5]'s row
        // mapping, which is what lets the flyout, this list and
        // serve_intents all agree without the wire changing: row n
        // past the interactions is the object's nth chain.
        Some(
            pack.object(object.0)
                .interactions
                .iter()
                .map(|act| act.label.as_str())
                .chain(
                    pack.chains
                        .iter()
                        .filter(|chain| chain.advertised_by == object.0)
                        .map(|chain| chain.label.as_str()),
                )
                .collect(),
        )
    }

    /// One label per entry in the pack's SOCIAL vocabulary, in index
    /// order - the same order-IS-the-index contract as
    /// [`Sim::interaction_labels`], for the flyout drawn over a fellow
    /// sim. Not per-target: the vocabulary is what a sim advertises,
    /// and per-sim variation enters through relationships, not menus.
    pub fn social_labels(&self) -> Vec<&'static str> {
        self.world
            .get_resource::<Content>()
            .map(|content| {
                content
                    .0
                    .social
                    .iter()
                    .map(|act| act.label.as_str())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The raw index of the selected sim, or `None` when nothing is
    /// selected.
    ///
    /// Selection lives in the simulation rather than in the shell ([D-5]):
    /// it is state a replay has to reproduce, so the DOM renders it back
    /// out rather than owning it. This is the read half of that, and
    /// `SimCommand::Select` is the write half.
    ///
    /// At most one entity carries `Selected` - `drain_commands` is its
    /// only writer and maintains that. `min` is the answer that does not
    /// depend on query order if a future writer ever breaks the
    /// invariant, matching what the drain itself does.
    ///
    /// **`min` is deliberately untested and this says so rather than
    /// hiding it.** Swapping it for `max` was hand-mutated at M1b Task 6
    /// and the whole workspace stayed green, because on a set of at most
    /// one element the two agree - so no legal world can tell them
    /// apart, and the only fixture that could is one that inserts a
    /// second `Selected` behind the drain's back. That would pin an
    /// arbitrary tie-break rather than a behaviour. What IS pinned is
    /// everything above the tie-break: `selected_index_tracks_the_
    /// selection_the_simulation_holds` in `terri-wasm` fails on `None`,
    /// on any constant, and on reporting a sim the command did not name.
    /// The mutation is also outside `cargo mutants`' grammar, which
    /// replaces return values rather than rewriting an iterator method,
    /// so the sweep will not report it either. Whoever gives `Selected`
    /// a second writer owns making this observable.
    pub fn selected_index(&self) -> Option<u32> {
        let mut state = self
            .world
            .try_query_filtered::<Entity, With<terri_core::Selected>>()?;
        state.iter(&self.world).map(|e| e.index_u32()).min()
    }

    /// Hashes all simulation-visible state. Entities are sorted by index
    /// first, because ECS iteration order is an implementation detail and
    /// must not affect the result.
    pub fn world_hash(&self) -> u64 {
        use terri_core::{Habituation, Needs, Position, Relationships, SimId, NEED_COUNT};

        let mut hasher = terri_core::FnvHasher::default();
        hasher.write_u64(self.world.resource::<SimClock>().tick);

        // (entity index, x, y, all seven need levels). Every level is
        // NO_NEEDS for entities carrying no `Needs` at all, which
        // distinguishes "no needs" from "desperate on all of them".
        //
        // All seven are hashed. The shape was fixed while only hunger
        // moved, deliberately: the digest is a published format across
        // the WASM boundary, so settling it once cost one golden-vector
        // update instead of one per need as the others came alive. Task 7
        // made all seven decay and moved the vector's VALUE without
        // touching its shape, which is the payoff.
        const NO_NEEDS: f32 = -1.0;

        // **Habituation is in the digest, and it has to be.** It changes what a
        // sim chooses, so a replay that did not reproduce it would diverge from
        // the run it is replaying - which is the whole thing [D12] exists to
        // prevent. Its entries are a sorted `Vec`, so hashing them in order is
        // reproducible; see `Habituation`'s own note on why that container.
        //
        // **`Relationships` and `SimId` are in the digest, as of M2d.**
        // Relationships change what a sim chooses - the same argument that
        // put habituation in - and they are keyed on `SimId`, so the key
        // space enters with them exactly as the M2c exclusion note
        // promised: a digest carrying "SimId 3 likes SimId 5" without
        // carrying which sim IS SimId 3 would let two differently-labelled
        // worlds hash identically.
        //
        // **`Personality` and `SimName` are deliberately NOT in the
        // digest, each for its own reason.** `SimName` is presentation: a
        // rename must not diverge a replay. `Personality` DOES change what
        // a sim chooses and is excluded anyway because today it is static:
        // derived from content at spawn and never written afterwards, so
        // two replays from one pack cannot disagree about it, and
        // digesting it would only restate the content. That argument
        // EXPIRES the moment anything mutates a personality at runtime -
        // M2e's traits are the scheduled arrival - and whoever writes the
        // first mutation owns adding it to this digest and re-measuring
        // both golden vectors.
        //
        // NO_SIM_ID is in-band the way NO_NEEDS is, and safer: `SimId`
        // wraps a u32 allocated monotonically from 0, so u64::MAX is
        // unreachable by construction rather than merely unclamped.
        // **`Satisfaction` is in the digest, as of M2e.** Not because it
        // changes what a sim chooses - today nothing reads it back into
        // scoring - but because it is the axis the PLAYER is scored on,
        // and a replay that reproduced every footstep while disagreeing
        // about whether the life went well would be a replay of the
        // wrong game. In-band absent like needs: the component clamps at
        // zero, so -1 is unreachable by a real ledger. The FIELD is
        // written for every row, sentinel or not, so adding it moved the
        // golden once as a shape change - the same one-settlement cost
        // the seven-need shape paid at M1a, and paid then for this
        // exact reason.
        // **`Traits` is in the digest, as of M2e PR 2** - capabilities
        // LEARN and conditions are MANAGED, so two replays must agree
        // on both, which is the habituation argument verbatim. Entries
        // ride length-prefixed like every variable-length field here.
        // **`AtWork` is in the digest, as of M2e PR 3** - the countdown
        // ticks, so two replays must agree on it, the Satisfaction
        // argument again. `Career` is NOT (spawn-time content, the
        // Personality/Hobbies precedent, same expiry note) and neither
        // is `Commuting` (transient action state, the Eating class:
        // reproduced by the day clock on any replay). The sentinel is
        // out-of-band by construction: a shift of u64::MAX ticks cannot
        // compile - shift_ticks < day_ticks, a u32.
        // **`ChainState` and `Carrying` are in the digest, as of M2f
        // PR 2** - the chain's program counter is the RESUME state
        // ([K4]) and the carried item is what it is about, so two
        // replays must agree on where every dinner stands. Sentinels
        // out-of-band by construction, like AtWork's: both wrap u32
        // index spaces.
        const NO_SATISFACTION: f32 = -1.0;
        const NO_SIM_ID: u64 = u64::MAX;
        const NOT_AT_WORK: u64 = u64::MAX;
        const NO_CHAIN: u64 = u64::MAX;
        const NOT_CARRYING: u64 = u64::MAX;
        type Row = (
            u32,
            f32,
            f32,
            [f32; NEED_COUNT],
            Vec<(u32, u32, f32)>,
            u64,
            Vec<(u32, f32)>,
            f32,
            Vec<(u32, f32)>,
            u64,
            (u64, u64, f32),
            u64,
        );
        let mut rows: Vec<Row> = Vec::new();
        if let Some(mut state) = self.world.try_query::<(
            Entity,
            &Position,
            Option<&Needs>,
            Option<&Habituation>,
            Option<&SimId>,
            Option<&Relationships>,
            Option<&terri_core::Satisfaction>,
            Option<&terri_core::Traits>,
            Option<&terri_core::AtWork>,
            Option<&terri_core::ChainState>,
            Option<&terri_core::Carrying>,
        )>() {
            for (
                entity,
                pos,
                needs,
                habituation,
                sim_id,
                relationships,
                satisfaction,
                traits,
                at_work,
                chain,
                carrying,
            ) in state.iter(&self.world)
            {
                // The sentinel is in-band, so a real level equal to it
                // would hash as if the component were absent. `Needs`
                // holds a private array and every mutator clamps to
                // NEED_MIN = 0.0, so today the type system prevents it
                // outright - but that is a property of terri-core's
                // implementation, invisible from here, so pin it. If
                // needs ever go negative, this sentinel must move out of
                // band.
                debug_assert!(
                    needs.is_none_or(|n| n.as_slice().iter().all(|&l| l != NO_NEEDS)),
                    "a need level of {NO_NEEDS} aliases world_hash's no-Needs sentinel"
                );
                let levels = needs.map_or([NO_NEEDS; NEED_COUNT], |n| *n.as_slice());
                // Flattened to plain numbers so the digest does not depend on
                // `ObjectDefId`'s representation, and empty for an agent that
                // has never finished an interaction - which is the same value
                // an agent whose entries have all decayed away reads, because
                // `Habituation::decay` drops them. Two sims that will behave
                // identically therefore hash identically.
                let hab: Vec<(u32, u32, f32)> = habituation.map_or_else(Vec::new, |h| {
                    h.entries()
                        .iter()
                        .map(|(object, interaction, value)| (object.0, *interaction, *value))
                        .collect()
                });
                // Flattened for `ObjectDefId`'s reason applied to `SimId`,
                // and empty-for-absent for `Habituation`'s: a sim who has
                // met nobody and a sim whose feelings have all decayed
                // away behave identically, so they hash identically.
                let rel: Vec<(u32, f32)> = relationships.map_or_else(Vec::new, |r| {
                    r.entries()
                        .iter()
                        .map(|(other, feeling)| (other.0, *feeling))
                        .collect()
                });
                // Empty-for-absent like relationships: a sim wearing
                // nothing and a sim with no component behave identically
                // and hash identically.
                let worn: Vec<(u32, f32)> = traits.map_or_else(Vec::new, |t| t.entries().to_vec());
                rows.push((
                    entity.index_u32(),
                    pos.x,
                    pos.y,
                    levels,
                    hab,
                    sim_id.map_or(NO_SIM_ID, |id| id.0 as u64),
                    rel,
                    satisfaction.map_or(NO_SATISFACTION, |s| s.value()),
                    worn,
                    at_work.map_or(NOT_AT_WORK, |w| w.remaining_ticks as u64),
                    chain.map_or((NO_CHAIN, 0, 1.0), |c| {
                        (c.chain as u64, c.step as u64, c.fumble_scale)
                    }),
                    carrying.map_or(NOT_CARRYING, |c| c.0 as u64),
                ));
            }
        }
        // The sort is load-bearing: query iteration is archetype order,
        // not entity order, and archetype order shifts as components are
        // added and removed. `hash_ignores_archetype_layout_and_entity_history`
        // is what pins it; deleting this line must fail that test.
        rows.sort_by_key(|(index, ..)| *index);

        for (
            index,
            x,
            y,
            levels,
            habituation,
            sim_id,
            relationships,
            satisfaction,
            worn,
            at_work,
            (chain, step, fumble),
            carrying,
        ) in rows
        {
            hasher.write_u64(index as u64);
            hasher.write_f32(x);
            hasher.write_f32(y);
            for level in levels {
                hasher.write_f32(level);
            }
            // The COUNT first, then the entries. Without the count, a sim with
            // entries [(0,0,0.5)] and a sim with [(0,0,0.5),(1,0,0.0)] would
            // write the same bytes if the second entry happened to be zeroed -
            // a length-prefix is what keeps a variable-length field from
            // aliasing a shorter one.
            hasher.write_u64(habituation.len() as u64);
            for (object, interaction, value) in habituation {
                hasher.write_u64(object as u64);
                hasher.write_u64(interaction as u64);
                hasher.write_f32(value);
            }
            hasher.write_u64(sim_id);
            // Length-prefixed for the same aliasing reason as habituation.
            hasher.write_u64(relationships.len() as u64);
            for (other, feeling) in relationships {
                hasher.write_u64(other as u64);
                hasher.write_f32(feeling);
            }
            hasher.write_f32(satisfaction);
            // Length-prefixed for habituation's aliasing reason.
            hasher.write_u64(worn.len() as u64);
            for (trait_index, state) in worn {
                hasher.write_u64(trait_index as u64);
                hasher.write_f32(state);
            }
            hasher.write_u64(at_work);
            // Last in the row because they arrived last. The step is
            // written even under the sentinel, per the published-shape
            // rule the seven need columns set.
            hasher.write_u64(chain);
            hasher.write_u64(step);
            hasher.write_f32(fumble);
            hasher.write_u64(carrying);
        }

        // The household's money, after the rows the way the clock sits
        // before them: world-level state, one value, in the digest
        // because a shift's pay is what the player was promised.
        hasher.write_u64(self.world.resource::<terri_core::Funds>().0 as u64);

        hasher.finish()
    }
}

impl Default for Sim {
    fn default() -> Self {
        Self::new()
    }
}

fn advance_clock(mut clock: ResMut<SimClock>) {
    clock.advance();
}

#[cfg(test)]
mod lot_tests {
    //! `Sim::new_from_lot` is a three-part mapping - grid size, wall
    //! tiles, placed objects - and each part is checked separately, per
    //! [L7] rule 3. The fixture is deliberately asymmetric everywhere it
    //! can be: a non-square lot, walls whose transposes are not walls,
    //! and placements whose object ids differ from their own positions in
    //! the list. [L26] is the recorded instance of a tidy fixture hiding
    //! an index-to-slot bug one layer down, and [L29] is the one where a
    //! fixture whose candidates agreed on the field being read made the
    //! read untestable.

    use super::*;
    use terri_core::{Footprint, Position, SmartObject, TileGrid};
    use terri_data::{CompiledLot, CompiledObject, CompiledPlacement, ObjectDefId};

    /// The definitions the fixture lots' placements point at, with
    /// `footprints[i]` belonging to `ObjectDefId(i)`.
    ///
    /// Three, because the fixtures place `ObjectDefId(2)` and a two-entry
    /// list would make that index a panic rather than a lookup. Index 1 is
    /// placed by nothing and is deliberately given an absurd rectangle by
    /// the callers below, so an implementation that looked a footprint up by
    /// the placement's POSITION in the list rather than by the id it names
    /// blocks a visibly wrong region instead of coincidentally the right one.
    fn object_defs(footprints: [Footprint; 3]) -> Vec<CompiledObject> {
        footprints
            .iter()
            .enumerate()
            .map(|(index, footprint)| CompiledObject {
                id: format!("object_{index}"),
                name: format!("Object {index}"),
                sprite: 0,
                interactions: Vec::new(),
                footprint: *footprint,
                roles: Vec::new(),
            })
            .collect()
    }

    /// Every object one tile, which is what the three mapping tests below
    /// were written against and what all but one shipped object still is.
    fn one_tile_defs() -> Vec<CompiledObject> {
        object_defs([Footprint::SINGLE; 3])
    }

    /// A 6x4 lot: wider than it is tall, so a transposed `TileGrid::new`
    /// is visible; walls whose transposes and cross products are free, so
    /// a single-coordinate or swapped `set_blocked` is visible; and two
    /// placements at distinct positions carrying distinct definitions, so
    /// a definition collapsed to zero or a coordinate pair swapped is
    /// visible.
    fn a_lot() -> CompiledLot {
        CompiledLot {
            width: 6,
            height: 4,
            front_door: None,
            walls: vec![(3, 2), (1, 0)],
            placements: vec![
                CompiledPlacement {
                    object: ObjectDefId(2),
                    x: 2.5,
                    y: 1.25,
                    sprite: 2,
                },
                CompiledPlacement {
                    object: ObjectDefId(0),
                    x: 4.0,
                    y: 3.5,
                    sprite: 0,
                },
            ],
        }
    }

    /// Every (position, definition) pair in the world, sorted by entity
    /// index so the assertion can be exact.
    fn placed_objects(sim: &Sim) -> Vec<(f32, f32, ObjectDefId)> {
        let mut state = sim
            .world()
            .try_query::<(Entity, &Position, &SmartObject)>()
            .expect("Position and SmartObject are registered eagerly in Sim::new");
        let mut rows: Vec<(u32, f32, f32, ObjectDefId)> = state
            .iter(sim.world())
            .map(|(entity, pos, placed)| (entity.index_u32(), pos.x, pos.y, placed.0))
            .collect();
        rows.sort_by_key(|(index, _, _, _)| *index);
        rows.into_iter().map(|(_, x, y, def)| (x, y, def)).collect()
    }

    /// The facing guard in the spawn loop, exercised through the one
    /// path that decides: a placement whose compiled sprite DIFFERS
    /// from its definition's carries a `SpriteVariant`, and one whose
    /// sprite matches carries nothing. The fixture's two placements are
    /// one of each - sprite 2 against a definition sprite of 0, and
    /// sprite 0 against the same - so flipping the guard's `!=` swaps
    /// both outcomes and both assertions go red. The render-buffer test
    /// for the variant inserts the component directly and cannot see
    /// this decision.
    #[test]
    fn new_from_lot_gives_only_faced_placements_a_sprite_variant() {
        let lot = a_lot();
        let defs = one_tile_defs();
        assert_ne!(
            lot.placements[0].sprite, defs[2].sprite,
            "precondition: the first placement is faced"
        );
        assert_eq!(
            lot.placements[1].sprite, defs[0].sprite,
            "precondition: the second placement is plain"
        );

        let mut sim = Sim::new_from_lot(&lot, &defs);
        let mut variants: Vec<(f32, Option<u32>)> = {
            let world = sim.world_mut();
            let mut state =
                world.query::<(&Position, &SmartObject, Option<&terri_core::SpriteVariant>)>();
            state
                .iter(world)
                .map(|(pos, _, variant)| (pos.x, variant.map(|v| v.0)))
                .collect()
        };
        variants.sort_by(|a, b| a.0.total_cmp(&b.0));

        assert_eq!(
            variants,
            vec![(2.5, Some(2)), (4.0, None)],
            "the faced placement carries its resolved variant and the \
             plain one carries nothing - a flipped guard swaps both"
        );
    }

    #[test]
    fn new_from_lot_sizes_the_grid_to_the_lot_rather_than_transposing_it() {
        let sim = Sim::new_from_lot(&a_lot(), &one_tile_defs());
        let grid = sim.world().resource::<TileGrid>();

        assert_eq!(grid.width(), 6);
        assert_eq!(grid.height(), 4);
        // The same claim through behaviour, so the two accessors above
        // cannot both be satisfied by a grid that is actually 4 by 6.
        assert!(grid.is_walkable(5, 3), "(5, 3) is the far corner of 6x4");
        assert!(!grid.is_walkable(3, 5), "(3, 5) is outside a 6x4 lot");
    }

    /// Renamed from `..._and_only_those` when footprints arrived: walls are
    /// no longer the only blocked tiles, since [F3] blocks every footprint
    /// tile as well. The four tiles asserted walkable below are chosen clear
    /// of both objects, so the mutation this kills is unchanged - a
    /// transposed or single-coordinate `set_blocked`.
    #[test]
    fn new_from_lot_blocks_every_declared_wall_and_not_its_transpose() {
        let lot = a_lot();
        let sim = Sim::new_from_lot(&lot, &one_tile_defs());
        let grid = sim.world().resource::<TileGrid>();

        assert!(!lot.walls.is_empty(), "a lot with no walls blocks nothing");
        for &(x, y) in &lot.walls {
            assert!(
                !grid.is_walkable(x as i32, y as i32),
                "the declared wall at ({x}, {y}) must be unwalkable"
            );
        }
        // The transposes and the cross products of the two declared
        // walls, none of which is a wall. Without these, blocking
        // `(y, x)` or blocking a whole row or column would pass.
        for (x, y, why) in [
            (2, 3, "(2, 3) is (3, 2) transposed"),
            (0, 1, "(0, 1) is (1, 0) transposed"),
            (3, 0, "x alone must not block a tile"),
            (1, 2, "y alone must not block a tile"),
        ] {
            assert!(grid.is_walkable(x, y), "{why}");
        }
    }

    /// The one-tile half of [F3]: a placement's own tile is impassable, so a
    /// sim paths round the furniture rather than through it.
    #[test]
    fn new_from_lot_blocks_the_tile_every_object_stands_on() {
        let sim = Sim::new_from_lot(&a_lot(), &one_tile_defs());
        let grid = sim.world().resource::<TileGrid>();

        // The two placements are at (2.5, 1.25) and (4.0, 3.5), so their
        // tiles are (2, 1) and (4, 3) - fractional on purpose, so a tile
        // taken from the raw coordinate rather than its floor is visible.
        assert!(
            !grid.is_walkable(2, 1),
            "the object at (2.5, 1.25) sits on (2, 1)"
        );
        assert!(
            !grid.is_walkable(4, 3),
            "the object at (4.0, 3.5) sits on (4, 3)"
        );
        // And their transposes, so a swapped pair is visible here too.
        assert!(grid.is_walkable(1, 2), "(1, 2) is (2, 1) transposed");
        assert!(
            grid.is_walkable(3, 0),
            "(3, 0) is a wall's cross product, not an object"
        );
    }

    /// A 7x5 lot holding ONE object at the fractional coordinates
    /// `(2.5, 1.25)`, so its origin tile is `(2, 1)`, plus one wall well
    /// clear of it at `(6, 0)` so walls and footprints are seen to coexist.
    ///
    /// Purpose-built rather than `a_lot` widened, because every tile around
    /// the rectangle has to be free for the test below to assert it walkable,
    /// and in `a_lot` the tile below the second column is a wall - which
    /// would make "a 2x1 is one tile deep" pass for the wrong reason.
    fn a_wide_lot() -> CompiledLot {
        CompiledLot {
            width: 7,
            height: 5,
            front_door: None,
            walls: vec![(6, 0)],
            placements: vec![CompiledPlacement {
                object: ObjectDefId(2),
                x: 2.5,
                y: 1.25,
                sprite: 2,
            }],
        }
    }

    /// **A 2x1 footprint blocks BOTH of its tiles**, and every other
    /// assertion in this module is satisfied by an implementation that blocks
    /// only the origin - which is exactly why this test exists rather than an
    /// extra line on the one above.
    ///
    /// Four things are pinned, and each names a different way to get the
    /// rectangle wrong:
    ///
    /// - `(3, 1)` is blocked. **The only assertion here that a
    ///   block-the-origin-only mapping fails.**
    /// - `(4, 1)` is walkable, so "blocks two tiles" is distinguishable from
    ///   "blocks the rest of the row".
    /// - `(2, 2)` and `(3, 2)` are walkable, so a 2x1 read as 1x2 or as 2x2 -
    ///   a transposed or squared rectangle - is visible.
    /// - `(1, 1)` is walkable, so a rectangle extending -x from the origin
    ///   instead of +x is visible. [F2] fixes the direction and nothing else
    ///   in the codebase would notice it reversed.
    ///
    /// The definitions give `ObjectDefId(1)` a 4x4 rectangle that nothing
    /// places, so a lookup by the placement's position in the list rather
    /// than by the id it names blocks `(2..6, 1..5)` and fails three of the
    /// assertions rather than passing by luck.
    #[test]
    fn new_from_lot_blocks_every_tile_of_a_multi_tile_footprint_and_nothing_past_it() {
        let defs = object_defs([
            Footprint::SINGLE,
            Footprint { width: 4, depth: 4 },
            Footprint { width: 2, depth: 1 },
        ]);
        let sim = Sim::new_from_lot(&a_wide_lot(), &defs);
        let grid = sim.world().resource::<TileGrid>();

        assert!(
            !grid.is_walkable(2, 1),
            "the origin tile must be blocked; every 1x1 test already says so"
        );
        assert!(
            !grid.is_walkable(3, 1),
            "a 2x1 footprint must block its SECOND tile too, and this is the \
             one assertion here that an origin-only mapping fails"
        );
        assert!(
            grid.is_walkable(4, 1),
            "(4, 1) is one past the rectangle and must stay walkable, or the \
             mapping is blocking the row rather than the footprint"
        );
        assert!(
            grid.is_walkable(2, 2),
            "a 2x1 footprint is one tile DEEP; blocking (2, 2) means width and \
             depth are transposed or the rectangle is square"
        );
        assert!(
            grid.is_walkable(3, 2),
            "and that holds under the second column as well"
        );
        assert!(
            grid.is_walkable(1, 1),
            "the rectangle runs +x from the origin, not -x - [F2]"
        );
        // The wall still blocks, so footprints did not replace walls.
        assert!(
            !grid.is_walkable(6, 0),
            "the declared wall must still block"
        );
    }

    #[test]
    fn new_from_lot_spawns_each_placement_at_its_own_position_and_definition() {
        assert_eq!(
            placed_objects(&Sim::new_from_lot(&a_lot(), &one_tile_defs())),
            vec![(2.5, 1.25, ObjectDefId(2)), (4.0, 3.5, ObjectDefId(0))],
            "each placement must reach the world with its own coordinates \
             and its own definition; a shared definition means the id is \
             not being carried, and swapped coordinates mean x and y are \
             transposed on the way in"
        );
    }

    #[test]
    fn the_shipped_lot_loads_its_walls_its_doorway_and_all_of_its_objects() {
        // The synthetic fixture above pins the mapping; this pins that
        // the mapping is applied to the content the game actually ships,
        // which is the whole reason this function exists. It reads the
        // lot rather than restating it, so it stays true when the lot is
        // re-authored - but the counts and the doorway are asserted
        // against numbers, because a lot that compiled to nothing would
        // satisfy any purely self-referential check.
        //
        // It goes through `new_from_shipped_lot`, which is the entry
        // point `terri-wasm` calls, so that thin wrapper is constrained
        // by something rather than being an untested public function.
        let lot = &terri_data::pack().lot;
        let sim = Sim::new_from_shipped_lot();
        let grid = sim.world().resource::<TileGrid>();

        assert_eq!(
            (grid.width(), grid.height()),
            (lot.width as usize, lot.height as usize)
        );
        assert_eq!(
            placed_objects(&sim).len(),
            lot.placements.len(),
            "every placement in the shipped lot must be spawned"
        );
        assert!(
            placed_objects(&sim).len() >= 25,
            "goal item 8 calls for a home worth living in, written down as 25 \
             or more placed objects; got {}",
            placed_objects(&sim).len()
        );

        // **The five-room house's doorways, one per wall run.** A doorway is
        // a GAP in a run rather than an entry of its own, so each is asserted
        // as the open tile between two solid ones - which is the shape a
        // missing gap actually breaks. Sealing a room is a silent behaviour
        // change rather than a visible one ([L17]): the sim simply stops
        // choosing anything in there, and nothing reports it.
        //
        // These coordinates are deliberately literal rather than derived from
        // the content, so that re-authoring the lot fails this test and forces
        // someone to look at whether the rooms still connect. It has already
        // done that job twice, when the lot shrank from 24x18 to 14x10 and
        // again when it grew to 16x12.
        for (open, solid_before, solid_after, what) in [
            ((7, 2), (7, 1), (7, 3), "kitchen to living room"),
            ((3, 5), (2, 5), (4, 5), "kitchen to bedroom"),
            ((13, 5), (12, 5), (14, 5), "living room to bathroom"),
            ((5, 9), (5, 8), (5, 10), "bedroom to study"),
            ((11, 8), (11, 7), (11, 9), "study to bathroom"),
        ] {
            assert!(
                grid.is_walkable(open.0, open.1),
                "the {what} doorway at {open:?} must be open"
            );
            assert!(
                !grid.is_walkable(solid_before.0, solid_before.1)
                    && !grid.is_walkable(solid_after.0, solid_after.1),
                "the {what} wall must be solid either side of {open:?}, or \
                 the gap is not a doorway and this asserts nothing"
            );
        }

        // **The circulation is a RING, and this is what says so.**
        //
        // Plain reachability is already guaranteed by `compile`'s rule 3, so
        // asserting it again would say nothing. The ring is a stronger and
        // separate property: there are TWO routes between any pair of rooms,
        // so BLOCKING ANY ONE DOORWAY still leaves the whole house connected.
        // That is a fact about this floor plan rather than about the
        // validator, it is the reason the plan was drawn this way rather than
        // around a corridor, and losing it would be silent - the house would
        // still work, only worse.
        //
        // Written as "seal each doorway in turn and re-check", because that
        // is the claim. Two paths that merely both succeed would not be: on a
        // tree they would both succeed too, by sharing the one corridor.
        //
        // The counterfactual is the second half and it is what stops this
        // being vacuous. Sealing TWO doorways of the same room must cut that
        // room off - otherwise "sealing one is survivable" would be equally
        // true of a house with no walls in it at all.
        let ring = [(7, 2), (3, 5), (13, 5), (5, 9), (11, 8)];
        let probes = [
            (1, 1),  // kitchen
            (9, 2),  // living room
            (3, 8),  // bedroom
            (8, 8),  // study
            (13, 7), // bathroom
        ];
        for sealed in ring {
            let mut cut = grid.clone();
            cut.set_blocked(sealed.0 as usize, sealed.1 as usize, true);
            for probe in probes {
                // No `|| probe == probes[0]` escape: `find_path` returns
                // `Some(empty)` when from == to, so the kitchen probe against
                // itself is already satisfied by the real call. A guard there
                // would be dead code that looked like a special case.
                assert!(
                    cut.find_path(probes[0], probe).is_some(),
                    "with the doorway at {sealed:?} sealed, {probe:?} is cut \
                     off from the kitchen; the circulation is a tree rather \
                     than a ring and one blocked door strands a room"
                );
            }
        }
        // The bedroom's two doorways are (3, 5) and (5, 9). Seal both and it
        // has to become unreachable, or the ring test above is measuring a
        // house whose walls do nothing.
        let mut sealed_bedroom = grid.clone();
        sealed_bedroom.set_blocked(3, 5, true);
        sealed_bedroom.set_blocked(5, 9, true);
        assert!(
            sealed_bedroom.find_path((1, 1), (3, 8)).is_none(),
            "with both of the bedroom's doorways sealed it must be cut off; \
             still reachable means there is a third way in and the ring above \
             is not the structure being tested"
        );

        // And the bathroom is genuinely approachable, stated as a path to a
        // tile beside the shower rather than as a hole in a wall.
        //
        // `find_path_adjacent_to_tile` rather than `find_path`, and the change
        // is the point rather than a workaround: since [F3] the shower's own
        // tile is impassable, so `find_path` to it returns `None` for a reason
        // that has nothing to do with the doorway. What a sim actually needs
        // is a tile BESIDE the shower, which is what selection asks for. The
        // shower is 1x1, hence the one-tile form.
        assert!(
            !grid.is_walkable(14, 6),
            "the shower's own tile must be solid, or the adjacency below is \
             not testing what it claims"
        );
        assert!(
            grid.find_path_adjacent_to_tile((1, 1), (14, 6)).is_some(),
            "the shower must be approachable from the far corner of the kitchen"
        );

        // **The double bed is the 2x2 object, and all four of its tiles are
        // solid.** Literal coordinates for the same reason as the doorways
        // above. The depth axis matters as much as the width: a rule that
        // walked `width` twice would leave (0, 7) and (1, 7) walkable and a
        // sim would path straight through the bed, which is the transposition
        // trap in [L34] wearing a footprint.
        for tile in [(0, 6), (1, 6), (0, 7), (1, 7)] {
            assert!(
                !grid.is_walkable(tile.0, tile.1),
                "the double bed covers {tile:?} and it must be solid"
            );
        }
        assert!(
            grid.is_walkable(2, 7),
            "(2, 7) is beside the bed and is where a sim sleeps from"
        );
    }
}

#[cfg(test)]
mod household_tests {
    //! `spawn_household` is a mapping from compiled content to components,
    //! and every field is load-bearing for a different consumer: `SimId`
    //! for relationships and the save file, `SimName` for the needs
    //! panel, `Personality` for three systems, the needs array for the
    //! opening minute.

    use super::*;
    use terri_core::{Agent, NeedId, Needs, Personality, Position, SimId, SimName};

    fn people() -> (
        Vec<terri_data::CompiledPersonality>,
        Vec<terri_data::CompiledHouseholdMember>,
    ) {
        // Two archetypes and two sims wearing them CROSSED - each sim
        // wears the OTHER one's index - so a spawn that handed member N
        // personality N is visible ([L34]). Every multiplier and level is
        // pairwise distinct for the same reason.
        let personalities = vec![
            terri_data::CompiledPersonality {
                id: "a".into(),
                drain: [1.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
                satisfaction: [1.0, 0.75, 1.0, 1.0, 1.0, 1.0, 1.0],
                dispositions: vec![(terri_core::ObjectDefId(3), 1, 0.25)],
                chronotype_offset_ticks: 0,
            },
            terri_data::CompiledPersonality {
                id: "b".into(),
                drain: [1.0, 1.0, 2.25, 1.0, 1.0, 1.0, 1.0],
                satisfaction: [1.0, 1.0, 1.0, 1.125, 1.0, 1.0, 1.0],
                dispositions: vec![],
                chronotype_offset_ticks: 0,
            },
        ];
        let household = vec![
            terri_data::CompiledHouseholdMember {
                name: "Terri".into(),
                personality: 1,
                x: 3.5,
                y: 2.25,
                needs: [62.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0],
                // Distinct lists, one of them empty, so the hobby test
                // below can tell "copied per member" from "one list
                // stamped on everybody" ([L34]).
                hobbies: vec!["whittling".to_string()],
                traits: vec![],
                career: None,
            },
            terri_data::CompiledHouseholdMember {
                name: "Doug".into(),
                personality: 0,
                x: 5.0,
                y: 6.0,
                needs: [100.0, 83.0, 100.0, 100.0, 100.0, 100.0, 55.0],
                hobbies: vec![],
                traits: vec![],
                career: None,
            },
        ];
        (personalities, household)
    }

    #[test]
    fn spawn_household_maps_every_field_and_issues_ids_in_declaration_order() {
        let (personalities, household) = people();
        let mut sim = Sim::new_with_lot(8, 8);
        sim.spawn_household(&personalities, &household, &[]);

        let world = sim.world_mut();
        let mut state = world
            .try_query::<(&SimId, &SimName, &Position, &Needs, &Personality)>()
            .expect("all five components are registered eagerly in Sim::new");
        let mut rows: Vec<_> = state
            .iter(world)
            .map(|(id, name, pos, needs, personality)| {
                (
                    id.0,
                    name.0.clone(),
                    (pos.x, pos.y),
                    *needs,
                    personality.clone(),
                )
            })
            .collect();
        rows.sort_by_key(|(id, ..)| *id);

        assert_eq!(rows.len(), 2, "one spawn per member, no extras");

        let (id, name, pos, needs, personality) = &rows[0];
        assert_eq!(
            (*id, name.as_str()),
            (0, "Terri"),
            "declaration order fixes SimId 0"
        );
        assert_eq!(*pos, (3.5, 2.25), "coordinates land verbatim, not snapped");
        assert_eq!(needs.get(NeedId::Hunger), 62.0);
        assert_eq!(needs.get(NeedId::Comfort), 100.0);
        // The CROSS: Terri wears archetype "b", so a spawn that used the
        // member's own index would hand her "a" and fail here.
        assert_eq!(personality.drain[NeedId::Hygiene.index()], 2.25);
        assert_eq!(personality.satisfaction[NeedId::Bladder.index()], 1.125);

        let (id, name, _, needs, personality) = &rows[1];
        assert_eq!((*id, name.as_str()), (1, "Doug"));
        assert_eq!(needs.get(NeedId::Comfort), 55.0);
        assert_eq!(personality.drain[NeedId::Hunger.index()], 1.5);
        assert_eq!(
            personality.disposition(terri_core::ObjectDefId(3), 1),
            0.25,
            "the disposition list must arrive on the sim wearing archetype a"
        );

        let mut agents = world
            .try_query_filtered::<&SimId, With<Agent>>()
            .expect("Agent is registered");
        assert_eq!(agents.iter(world).count(), 2, "each member is an Agent");

        // The M2e pair rides per member: Terri's whittling against
        // Doug's empty list is what tells "copied per member" from "one
        // list stamped on everybody" ([L34]), and both ledgers open at
        // zero because a life is judged from move-in day.
        let mut m2e = world
            .try_query::<(&SimId, &terri_core::Hobbies, &terri_core::Satisfaction)>()
            .expect("both registered eagerly in Sim::new");
        let mut pairs: Vec<(u32, Vec<String>, f32)> = m2e
            .iter(world)
            .map(|(id, hobbies, ledger)| (id.0, hobbies.0.clone(), ledger.value()))
            .collect();
        pairs.sort_by_key(|(id, ..)| *id);
        assert_eq!(
            pairs,
            vec![(0, vec!["whittling".to_string()], 0.0), (1, vec![], 0.0),],
            "hobbies are the member's own and every ledger opens empty"
        );
    }

    #[test]
    fn spawn_household_supports_the_full_six_member_roster_in_order() {
        let (personalities, seed) = people();
        let household: Vec<_> = (0..terri_data::MAX_HOUSEHOLD_SIZE)
            .map(|index| {
                let mut member = seed[index % seed.len()].clone();
                member.name = format!("Person {}", index + 1);
                member
            })
            .collect();
        let mut sim = Sim::new_with_lot(8, 8);
        sim.spawn_household(&personalities, &household, &[]);

        let world = sim.world_mut();
        let mut state = world
            .try_query::<(&SimId, &SimName)>()
            .expect("registered eagerly");
        let mut rows: Vec<_> = state
            .iter(world)
            .map(|(id, name)| (id.0, name.0.clone()))
            .collect();
        rows.sort_by_key(|(id, _)| *id);

        assert_eq!(
            rows,
            vec![
                (0, "Person 1".into()),
                (1, "Person 2".into()),
                (2, "Person 3".into()),
                (3, "Person 4".into()),
                (4, "Person 5".into()),
                (5, "Person 6".into()),
            ],
            "stable ids follow declaration order through the full supported capacity"
        );
    }

    #[test]
    fn the_shipped_lot_spawns_the_shipped_household() {
        // Through `new_from_shipped_lot`, which is the entry point the page
        // uses, so what is pinned is the wiring from pack to world rather
        // than the helper alone. Names are read from the pack rather than
        // restated, so re-authoring the household is not a test edit HERE;
        // the roster itself is pinned in terri-data.
        let mut sim = Sim::new_from_shipped_lot();
        let pack = terri_data::pack();
        assert!(
            pack.household.len() >= 3,
            "the shipped household is the fixture; an empty one proves nothing"
        );

        let world = sim.world_mut();
        let mut state = world
            .try_query::<(&SimId, &SimName)>()
            .expect("registered eagerly");
        let mut rows: Vec<(u32, String)> = state
            .iter(world)
            .map(|(id, name)| (id.0, name.0.clone()))
            .collect();
        rows.sort_by_key(|(id, _)| *id);

        let expected: Vec<(u32, String)> = pack
            .household
            .iter()
            .enumerate()
            .map(|(i, member)| (i as u32, member.name.clone()))
            .collect();
        assert_eq!(rows, expected);
    }
}

#[cfg(test)]
#[cfg(test)]
mod overlay_read_tests {
    //! The `?debug=1` overlay's own accessors. Nothing in the
    //! simulation reads them back, so a stub returning a constant is
    //! invisible to every behavioural test - which is exactly what the
    //! CI sweep found. Each one is pinned here against a fixture where
    //! two sims hold DIFFERENT states, so an accessor that ignores the
    //! index it was handed (the `==`-to-`!=` mutant) is visible too.

    use super::*;
    use terri_core::{Agent, Blocked, Intent, IntentQueue, Position, Restless};

    /// Two sims: one stalled both ways with two orders queued, one
    /// perfectly free with none. Returns their raw indices in that
    /// order.
    fn two_sims() -> (Sim, u32, u32) {
        let mut sim = Sim::new_with_lot(8, 8);
        let mut queue = IntentQueue::default();
        let fridge = sim.world_mut().spawn(()).id();
        queue.push(Intent {
            object: fridge,
            interaction: 0,
        });
        queue.push(Intent {
            object: fridge,
            interaction: 1,
        });
        let stuck = sim
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, Blocked, Restless, queue))
            .id()
            .index_u32();
        let free = sim
            .world_mut()
            .spawn((Agent, Position { x: 5.0, y: 5.0 }, IntentQueue::default()))
            .id()
            .index_u32();
        (sim, stuck, free)
    }

    /// A sim in MOTION has no stall reason, whatever markers it still
    /// carries - `Restless` is what sent it wandering, so it rides
    /// along for the whole stroll and would otherwise contradict the
    /// panel's own "doing: walking" one line above.
    #[test]
    fn a_sim_that_is_doing_something_reports_no_stall_reason() {
        let mut sim = Sim::new_with_lot(8, 8);
        let strolling = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 1.0 },
                Restless,
                terri_core::Path {
                    steps: vec![(2, 1)],
                    cursor: 0,
                },
            ))
            .id()
            .index_u32();
        assert_eq!(
            sim.stall_reason_of(strolling),
            None,
            "a wanderer is not stalled - the marker is why it LEFT"
        );

        // Every other busy shape, one at a time, so a check that
        // covered only walking is visible. Each spawns with a stall
        // marker deliberately set, which is exactly the stale state
        // the running game showed.
        let eating = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 2.0 },
                Blocked,
                terri_core::Eating {
                    object: terri_core::ObjectDefId(0),
                    interaction: 0,
                    remaining_ticks: 5,
                },
            ))
            .id()
            .index_u32();
        let at_work = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 3.0, y: 3.0 },
                Restless,
                terri_core::AtWork {
                    remaining_ticks: 40,
                },
            ))
            .id()
            .index_u32();
        let reserved = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 4.0, y: 4.0 },
                Restless,
                terri_core::Reserved,
            ))
            .id()
            .index_u32();
        // The remaining four, so that EVERY term of the busy check has
        // a sim whose only busy state is that one. Without all eight,
        // an `||` flipped to `&&` between two untested neighbours
        // survives - which is exactly what the sweep found when this
        // test covered four.
        let target_of = sim.world_mut().spawn(()).id();
        let committed = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 5.0, y: 5.0 },
                Restless,
                terri_core::Target {
                    object: target_of,
                    interaction: 0,
                },
            ))
            .id()
            .index_u32();
        let talking = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 6.0, y: 6.0 },
                Restless,
                terri_core::Socialising {
                    interaction: 0,
                    partner: target_of,
                    remaining_ticks: 10,
                },
            ))
            .id()
            .index_u32();
        let stepping = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 7.0, y: 7.0 },
                Restless,
                terri_core::StepWork {
                    remaining_ticks: 12,
                },
            ))
            .id()
            .index_u32();
        let commuting = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 7.0 },
                Restless,
                terri_core::Commuting,
            ))
            .id()
            .index_u32();
        for (index, what) in [
            (eating, "eating"),
            (at_work, "at work"),
            (reserved, "reserved for a talk"),
            (committed, "committed to a target"),
            (talking, "in a conversation"),
            (stepping, "working a chain step"),
            (commuting, "commuting to work"),
        ] {
            assert_eq!(
                sim.stall_reason_of(index),
                None,
                "a sim {what} is not stalled"
            );
        }
    }

    #[test]
    fn the_stall_reason_names_both_markers_and_only_for_the_sim_asked() {
        let (sim, stuck, free) = two_sims();
        assert_eq!(
            sim.stall_reason_of(stuck).as_deref(),
            Some("waiting on something in use; found nothing worth doing"),
            "both markers, joined, in that order"
        );
        assert_eq!(
            sim.stall_reason_of(free),
            None,
            "a sim nothing holds back reads as no reason at all"
        );
        assert_eq!(sim.stall_reason_of(9999), None, "and a stale index too");
    }

    /// Each marker alone, because the joined string above is satisfied
    /// by an implementation that always writes both.
    #[test]
    fn each_marker_produces_only_its_own_phrase() {
        let mut sim = Sim::new_with_lot(8, 8);
        let blocked = sim
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, Blocked))
            .id()
            .index_u32();
        let restless = sim
            .world_mut()
            .spawn((Agent, Position { x: 2.0, y: 2.0 }, Restless))
            .id()
            .index_u32();
        assert_eq!(
            sim.stall_reason_of(blocked).as_deref(),
            Some("waiting on something in use")
        );
        assert_eq!(
            sim.stall_reason_of(restless).as_deref(),
            Some("found nothing worth doing")
        );
    }

    /// TWO orders rather than one, so a constant 1 is visible, and a
    /// queueless sim rather than only an empty queue, so the absent
    /// component's zero is exercised as well.
    #[test]
    fn queued_orders_counts_this_sims_own_queue() {
        let (sim, stuck, free) = two_sims();
        assert_eq!(sim.queued_orders_of(stuck), 2);
        assert_eq!(sim.queued_orders_of(free), 0, "an empty queue is none");
        assert_eq!(sim.queued_orders_of(9999), 0, "and a stale index is none");

        let mut bare = Sim::new_with_lot(4, 4);
        let queueless = bare
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }))
            .id()
            .index_u32();
        assert_eq!(
            bare.queued_orders_of(queueless),
            0,
            "no component at all is none, not a panic"
        );
    }
}

#[cfg(test)]
mod determinism_tests {
    use super::*;
    use crate::test_content::shipped_fridge;
    use terri_core::{Agent, Eating, NeedId, Needs, Position};

    fn build_scenario() -> Sim {
        let mut sim = Sim::new_with_lot(24, 24);
        // The shipped fridge, deliberately: the golden vector below is
        // only a statement about the game if the scenario is built out of
        // the content the game ships.
        sim.world_mut()
            .spawn((Position { x: 18.0, y: 14.0 }, shipped_fridge()));
        for i in 0..8 {
            sim.world_mut().spawn((
                Agent,
                Position {
                    x: 1.0 + i as f32,
                    y: 1.0,
                },
                Needs::with(NeedId::Hunger, 30.0 + i as f32 * 5.0),
            ));
        }
        sim
    }

    /// The entity indices `world_hash`'s query yields in raw ECS order,
    /// with no sorting applied. This is precisely the order the hash must
    /// NOT be sensitive to, so comparing it between two worlds is how the
    /// layout test below proves it is exercising a real ordering
    /// difference rather than passing decoratively.
    fn raw_iteration_order(sim: &Sim) -> Vec<u32> {
        let mut state = sim
            .world()
            .try_query::<(Entity, &Position, Option<&Needs>)>()
            .expect("every component in the hash query must be registered");
        state
            .iter(sim.world())
            .map(|(entity, _, _)| entity.index_u32())
            .collect()
    }

    /// An entity-free world advanced to `ticks`, for the guards below.
    ///
    /// Ticking it is load-bearing. `world_hash` writes the clock before
    /// the entity rows, so an *unticked* empty world differs from any
    /// ticked world by the clock term alone: the guard would then pass
    /// even if the row block emitted nothing at all, which is the exact
    /// failure it was written to prevent. See lessons-learned [L7].
    fn empty_world_at(ticks: usize) -> Sim {
        let mut sim = Sim::new_with_lot(24, 24);
        for _ in 0..ticks {
            sim.tick();
        }
        sim
    }

    /// Asserts `sim`'s hash is not simply an empty world's, holding
    /// every other term in the digest constant so only the entity rows
    /// can account for the difference. Guards the [L3] trap: if any
    /// queried component were unregistered, `try_query` would yield zero
    /// rows and the equality tests would pass by comparing two identical
    /// empty hashes - permanently green while testing nothing.
    fn assert_hash_sees_entities(sim: &Sim, ticks: usize) {
        let empty = empty_world_at(ticks);
        assert_eq!(
            sim.world().resource::<SimClock>().tick,
            empty.world().resource::<SimClock>().tick,
            "the empty world must sit at the same tick, or the clock term \
             alone makes this guard pass and it checks nothing"
        );
        assert_ne!(
            sim.world_hash(),
            empty.world_hash(),
            "world hash equals an empty world's at the same tick; the hash \
             is seeing no entities"
        );
    }

    fn lowest_indexed_agent(sim: &Sim) -> Entity {
        let mut state = sim
            .world()
            .try_query_filtered::<Entity, With<Agent>>()
            .expect("Agent must be registered");
        state
            .iter(sim.world())
            .min_by_key(|entity| entity.index_u32())
            .expect("the scenario spawns agents")
    }

    /// The world's PRNG exists and is seeded from `content/tuning.toml`,
    /// which is the [D-3] claim that "randomness must not mean
    /// nondeterminism" rests on. A generator seeded from a wall clock, or
    /// from a constant somebody typed, would satisfy every other test in
    /// this module.
    ///
    /// Read through `Sim::new_with_lot` rather than by reaching into
    /// `Sim::new`, because that is what every caller uses.
    ///
    /// The `assert_ne` is the vacuity guard: comparing against the tuned
    /// seed alone would also be satisfied by a generator seeded from
    /// literally anything, if the comparison were computed the same wrong
    /// way twice. A second seed that must NOT match is what excludes it.
    #[test]
    fn the_worlds_prng_is_seeded_from_the_tuned_rng_seed() {
        use terri_core::SimRng;

        let sim = Sim::new_with_lot(8, 8);
        let mut world_rng = sim.world().resource::<SimRng>().clone();
        let seed = terri_data::pack().tuning.rng_seed;

        let mut tuned = SimRng::from_seed(seed);
        let mut other = SimRng::from_seed(seed.wrapping_add(1));
        let from_world: Vec<u32> = (0..4).map(|_| world_rng.next_u32()).collect();

        assert_ne!(
            from_world[0], from_world[1],
            "a frozen generator would satisfy the rest of this test"
        );
        assert_ne!(
            from_world,
            (0..4).map(|_| other.next_u32()).collect::<Vec<_>>(),
            "the world's generator must not agree with a DIFFERENT seed, \
             or this test cannot tell the tuned value from any other"
        );
        assert_eq!(
            from_world,
            (0..4).map(|_| tuned.next_u32()).collect::<Vec<_>>(),
            "the world's generator must be the one content/tuning.toml's \
             rng_seed produces, and must not have been advanced before any \
             system ran"
        );
    }

    /// The two components M1b Task 4 added are registered by `Sim::new`
    /// itself, before any system has run.
    ///
    /// **This world is deliberately never ticked**, which is the whole
    /// mechanism: running the schedule initialises every system's query
    /// and registers their components as a side effect, so a ticked world
    /// would report success no matter what `Sim::new` did. `try_query` is
    /// the read that cares - it returns `None` on any unregistered
    /// component rather than registering on demand, which is [L3] - and
    /// several fixtures in this crate `expect` it.
    ///
    /// `Selected` has no reader at all until Task 5's command drain, so
    /// this is the only thing constraining its registration line.
    #[test]
    fn the_components_m1b_added_are_registered_before_any_system_runs() {
        use terri_core::{IntentQueue, Selected};

        let sim = Sim::new_with_lot(8, 8);
        assert!(
            sim.world()
                .try_query_filtered::<Entity, With<Selected>>()
                .is_some(),
            "Selected is not registered, so try_query returns None and \
             every fixture that reads it panics for the wrong reason"
        );
        assert!(
            sim.world()
                .try_query_filtered::<Entity, With<IntentQueue>>()
                .is_some(),
            "IntentQueue is not registered"
        );
        // The guard on the guard: a component this world has genuinely
        // never heard of must come back None, or `try_query` is not the
        // discriminating read this test assumes it is and both assertions
        // above would hold for an empty registration list.
        #[derive(Component)]
        struct NeverRegistered;
        assert!(
            sim.world()
                .try_query_filtered::<Entity, With<NeverRegistered>>()
                .is_none(),
            "try_query answered for a component nothing ever registered, \
             so it cannot tell a registered component from an unregistered \
             one and this test proves nothing"
        );
    }

    #[test]
    fn identical_scenarios_produce_identical_world_hashes() {
        const TICKS: usize = 500;

        let mut a = build_scenario();
        let mut b = build_scenario();

        for _ in 0..TICKS {
            a.tick();
            b.tick();
        }

        // Guard against the empty-hash trap before asserting equality.
        // Any test that can pass on empty input needs an assertion that
        // the input was not empty. See lessons-learned [L3] and [L7].
        assert_hash_sees_entities(&a, TICKS);

        assert_eq!(
            a.world_hash(),
            b.world_hash(),
            "simulation diverged; determinism is broken"
        );
    }

    #[test]
    fn hash_observes_relationships_and_sim_ids() {
        use terri_core::{Relationships, SimId};

        // The same frozen-world shape as
        // `hash_observes_entity_state_not_only_the_clock`, for the same
        // reason: nothing ticks, so the only term that can move the
        // digest is the one this test moves.
        let mut sim = build_scenario();
        let baseline = sim.world_hash();
        let agent = lowest_indexed_agent(&sim);

        // A feeling forms: the digest must move. Restoring an EMPTY
        // component must restore it - a sim who has met nobody and a sim
        // carrying no component behave identically, so they must hash
        // identically, or the digest depends on archaeology.
        let mut warm = Relationships::default();
        warm.bump(SimId(7), 0.5);
        sim.world_mut().entity_mut(agent).insert(warm);
        let with_feeling = sim.world_hash();
        assert_ne!(baseline, with_feeling, "world_hash ignores Relationships");
        sim.world_mut()
            .entity_mut(agent)
            .insert(Relationships::default());
        assert_eq!(
            baseline,
            sim.world_hash(),
            "an empty Relationships must hash exactly like no component"
        );

        // WHO the feeling is about is part of the state, not only that
        // one exists - two sims warm toward different people must not
        // collide.
        let mut warm_to_other = Relationships::default();
        warm_to_other.bump(SimId(8), 0.5);
        sim.world_mut().entity_mut(agent).insert(warm_to_other);
        assert_ne!(
            with_feeling,
            sim.world_hash(),
            "world_hash ignores WHO a relationship points at"
        );
        sim.world_mut().entity_mut(agent).remove::<Relationships>();
        assert_eq!(baseline, sim.world_hash());

        // And the key space itself: the same world with a different
        // SimId on one sim is a different world, per the M2c exclusion
        // note's promise that ids enter the digest the day relationships
        // do.
        sim.world_mut().entity_mut(agent).insert(SimId(41));
        let labelled = sim.world_hash();
        assert_ne!(baseline, labelled, "world_hash ignores SimId");
        sim.world_mut().entity_mut(agent).insert(SimId(42));
        assert_ne!(
            labelled,
            sim.world_hash(),
            "world_hash ignores WHICH SimId a sim carries"
        );
    }

    #[test]
    fn hash_observes_entity_state_not_only_the_clock() {
        // The other tests all move the clock, and world_hash writes the
        // clock as well as the entity rows, so a digest difference there
        // never isolates which term produced it. This test never ticks:
        // the clock is frozen, the entity set is frozen, and the only
        // thing that changes is one field on one entity. That makes it
        // the only test in the suite that can see the row block at all.
        //
        // Mutation-verified: without this, deleting the whole row
        // collection from world_hash, or just the two position writes,
        // or just the need writes, leaves every other test green.
        //
        // It checks that SOME need reaches the digest.
        // `hash_observes_every_need_not_only_hunger` below is what checks
        // that all seven do.
        let mut sim = build_scenario();
        let baseline = sim.world_hash();
        let agent = lowest_indexed_agent(&sim);

        sim.world_mut().get_mut::<Position>(agent).unwrap().x += 1.0;
        assert_ne!(baseline, sim.world_hash(), "world_hash ignores Position.x");
        sim.world_mut().get_mut::<Position>(agent).unwrap().x -= 1.0;
        assert_eq!(
            baseline,
            sim.world_hash(),
            "restoring state must restore the digest"
        );

        sim.world_mut().get_mut::<Position>(agent).unwrap().y += 1.0;
        assert_ne!(baseline, sim.world_hash(), "world_hash ignores Position.y");
        sim.world_mut().get_mut::<Position>(agent).unwrap().y -= 1.0;
        assert_eq!(
            baseline,
            sim.world_hash(),
            "restoring state must restore the digest"
        );

        let hunger = sim.world().get::<Needs>(agent).unwrap().get(NeedId::Hunger);
        sim.world_mut()
            .get_mut::<Needs>(agent)
            .unwrap()
            .set(NeedId::Hunger, hunger + 1.0);
        assert_ne!(baseline, sim.world_hash(), "world_hash ignores Needs");
    }

    #[test]
    fn hash_observes_every_need_not_only_hunger() {
        // Written when hunger was the only need that decayed, the only
        // one an interaction filled and the only one selection scored, so
        // that every other test in the workspace would have stayed green
        // with the other six levels absent from the digest. Task 7 made
        // all seven decay, so the golden vector would now move if a level
        // went missing - but only for a need whose rate is non-zero, and
        // only in that one scenario. This test still isolates each level
        // one at a time, on a frozen clock, which is the only thing here
        // that can name WHICH one stopped reaching the digest.
        //
        // Causal rather than comparative, per docs/testing-protocol.md
        // rule 3: perturb exactly one level, require the digest to move,
        // restore it, and require the digest to come back. Restoring is
        // what rules out a hash that merely reacts to being touched.
        let mut sim = build_scenario();
        let baseline = sim.world_hash();
        let agent = lowest_indexed_agent(&sim);

        for id in NeedId::ALL {
            let before = sim.world().get::<Needs>(agent).unwrap().get(id);
            // Downwards, so a need already sitting at NEED_MAX moves
            // instead of being clamped back to where it started.
            sim.world_mut()
                .get_mut::<Needs>(agent)
                .unwrap()
                .set(id, before - 1.0);
            assert_ne!(
                baseline,
                sim.world_hash(),
                "world_hash ignores the {} level",
                id.as_str()
            );
            sim.world_mut()
                .get_mut::<Needs>(agent)
                .unwrap()
                .set(id, before);
            assert_eq!(
                baseline,
                sim.world_hash(),
                "restoring the {} level must restore the digest",
                id.as_str()
            );
        }
    }

    /// The golden vector. Everything else in this module compares two
    /// digests computed by the same binary, which pins reproducibility
    /// but says nothing about the value itself. From Task 8 onward
    /// `world_hash` is exported across the WASM boundary and JavaScript
    /// depends on it, so the digest is a published format: a change to
    /// the hash's encoding, to the field order, to the FNV constants, or
    /// to what the simulation computes over 100 ticks would otherwise be
    /// completely invisible to the suite.
    ///
    /// **If this number changes, that is a finding, not a rebase
    /// artifact.** Update it only when you can name the simulation
    /// behaviour change that moved it, and say so in the commit message.
    /// An unexplained change means the sim is no longer computing what it
    /// computed before, which is exactly the bug this vector exists to
    /// surface.
    ///
    /// It covers **one** platform pair for free: CI runs on Linux and
    /// this machine is Windows, so a divergence in float arithmetic or
    /// iteration order between those two shows up here.
    ///
    /// It does **not** cover the platform pair Task 8 actually created,
    /// which is native versus wasm32. This test runs natively on both
    /// sides of the Linux/Windows comparison, so wasm is not among them.
    /// That gap is concrete rather than theoretical: `write_f32` calls
    /// `f32::round`, which is round-half-away-from-zero in Rust and does
    /// not map to wasm's round-half-to-even `f32.nearest`, so rustc emits
    /// a different code path there - and every position and every one of
    /// the seven need levels in this digest passes through it.
    ///
    /// The boundary is covered by
    /// `reproduces the native golden world hash across the wasm boundary`
    /// in web/tests/bridge.test.ts, which rebuilds this exact scenario
    /// through the JavaScript API and compares against the same constant.
    /// Measured: the two agree. **If you change `GOLDEN` here, change it
    /// there too, or the boundary check silently stops being one.**
    #[test]
    fn world_hash_matches_its_golden_vector() {
        const TICKS: usize = 100;
        // Moved deliberately at Task 7's content-driven decay, and this
        // time it is a SIMULATION change rather than an encoding one.
        // Every need now drains at the rate `content/tuning.toml`
        // declares for it, so the six levels that used to sit pinned at
        // their spawn value for all 100 ticks now fall - six of the seven
        // per-entity f32s in every agent's row move, on every tick. The
        // digest's shape is untouched.
        //
        // Positions and hunger are unchanged: the fridge advertises
        // hunger only, so nothing the other six do can reach scoring, and
        // the same eight agents still eat at the same ticks. Only the
        // levels moved.
        //
        // Previous values: 0x6C37_57F1_8481_75C1 (Task 6, at the
        // Hunger-to-Needs encoding change), 0xEF60_1D50_4790_5825 before
        // that.
        //
        // Measured on wasm32 as well as natively, per [L13], rather than
        // assumed to carry across: the two agree. The boundary copy lives
        // in web/tests/bridge.test.ts.
        //
        // **M1b Task 3b did NOT move it, and that is worth knowing rather
        // than reassuring.** Selection changed from Euclidean distance to
        // A* path length, which is a real behaviour change, and this
        // scenario cannot see it: one object means there is nothing to
        // rank, and the only agent that ever claims it is still walking
        // its 30 tiles at tick 100 - movement always used A*, so its
        // position is identical either way. The metric is pinned by
        // `an_object_behind_a_wall_loses_to_a_further_one_the_agent_can_walk_to`
        // instead. Recorded as [L36]; do not read this vector as covering
        // how candidates are ordered.
        //
        // **M1c Task 3 did not move it either, for the same reason, and
        // that was predicted to be otherwise.** Selection became a
        // softmax-weighted draw rather than an argmax - the milestone's
        // central change - and this scenario still cannot see it. There
        // is one object, so every agent that gets a candidate at all gets
        // exactly one, and a one-candidate draw has one answer at every
        // temperature and every seed. `sample_softmax` even computes the
        // same weight for it, `exp(0.0)`, which is exactly 1.0 on every
        // target.
        //
        // That last sentence is load-bearing rather than trivia: it is
        // why this vector stays safe to compare across native and wasm32
        // now that selection calls `exp`. A scenario with two live
        // candidates would put a libm result inside the digest's causal
        // chain, and `f32::exp` is a platform call with no cross-target
        // bit-identity guarantee - the same hazard `score_advertisement`
        // avoids by refusing `powf`. **Anybody adding a second object to
        // this scenario is changing what this vector is exposed to, not
        // just what it covers.** Weighted selection is pinned by
        // `a_higher_scoring_object_is_chosen_more_often_and_a_lower_one_still_sometimes`
        // and by the two tie tests, all of which are robust to a
        // last-bit difference.
        //
        // **M1c Task 4 did not move it either, and this time for a
        // SECOND, independent reason worth knowing.** [D-4] made every
        // interaction's length a sampled value and put a 25-tick floor
        // under it, which raises the fridge's snack from 15 ticks. This
        // scenario cannot see that because **no agent ever eats in it**:
        // the fridge sits 30 tiles from the nearest agent, movement
        // covers 0.25 tiles a tick, so arrival is at tick ~121 and this
        // vector stops at 100. Measured, not deduced - a probe over the
        // 100 ticks found no `Eating` component at any point and exactly
        // one agent still walking at the end.
        //
        // So the scenario is blind to durations AND to the PRNG draw
        // durations consume, on top of being blind to how candidates are
        // ranked. Read together with the two paragraphs above, that is a
        // statement about this fixture rather than about the milestone:
        // one object 30 tiles away exercises decay, movement and the
        // digest, and nothing else. **Anyone who wants this vector to
        // cover selection or duration has to change the scenario**, and
        // the paragraph above sets out what a second object would cost.
        //
        // **M1c Task 5 DID move it, and this is the first M1c change that
        // this scenario could see.** [D-5] sends a sim with nothing worth
        // doing for a stroll instead of leaving it standing still, and
        // seven of these eight agents have nothing worth doing from tick
        // one: the single fridge is claimed by the lowest-indexed agent
        // and every other agent skips a reserved object, so its best
        // score is nothing at all and it is marked restless. Those seven
        // now wander. Fourteen of the sixteen coordinates in the digest
        // move, on almost every tick.
        //
        // That is a behaviour change and it is the intended one. It also
        // means this vector now covers the seeded PRNG for the first
        // time, because a wander destination is drawn from it - so a
        // change to `SimRng`, to the draw ORDER, or to the wander
        // roll will now surface here rather than only in the unit tests.
        //
        // Previous value: 0x2FC6_69EF_A725_4F2D (Task 7's content-driven
        // decay, unmoved by M1b Task 3b and by M1c Tasks 3 and 4).
        //
        // **The [C2] fix did not move it, and that was predicted rather
        // than discovered.** Giving the television a `social` advert is a
        // content change that alters what the shipped house affords, but
        // this scenario holds ONE object and it is the fridge, so no
        // television advert can reach the digest: the seven need levels
        // still decay at the same rates, the same agent still eats at the
        // same tick, and nothing else was touched. Confirmed on both
        // targets after a wasm rebuild rather than assumed. This is [L36]
        // in its expected form - the vector is silent because the fixture
        // is blind to the change, not because the change did nothing, and
        // the behaviour it DOES have is pinned by the 12 000-tick trace in
        // docs/alpha-feel-notes.md and by
        // `every_declared_need_can_be_satisfied_by_some_interaction` in
        // terri-data.
        //
        // **The [C3] fix DID move it, and that is the whole point.**
        // Previous value: 0x5A49_3BA9_F7FB_F23B.
        //
        // Which of the two causes the assertion below asks about: **the
        // simulation no longer computes what it did**, deliberately. The
        // digest encoding is untouched.
        //
        // This scenario is the exact shape the fix changes, which is why it
        // is the one golden vector that could see it. `build_scenario` holds
        // **eight agents and one object**: agent 0 claims the object and the
        // other seven used to see an empty candidate list - the object was
        // filtered out of their query by `Without<Reserved>` - come out with
        // `best_seen` at negative infinity, and be marked `Restless`. Being
        // `Restless` is what `idle::wander` reads as permission to stroll,
        // and a wander destination is a PRNG draw, so seven spurious strolls
        // per tick were both moving those agents and consuming the seeded
        // random stream.
        //
        // After the fix the seven score the object they cannot have, are not
        // marked `Restless`, and stand and wait. So the vector moves for
        // three compounding reasons: different positions, a different number
        // of draws taken from `SimRng`, and therefore a different alignment
        // of every draw after them.
        //
        // Note the contrast with the [C2] entry this replaces: that fixture
        // was blind to a content change and the vector was correctly silent
        // ([L36]). Here the fixture is maximally sensitive, and a vector that
        // had NOT moved would have been the finding.
        //
        // **The alpha duration pass moved it again**, from
        // 0x822C_A9CD_3813_3321, and again the cause is "the simulation no
        // longer computes what it did" rather than a digest change.
        //
        // This scenario's one object is the fridge, whose `duration_ticks`
        // went from 15 to 30, so the agent that eats in it now eats for twice
        // as long and fills hunger at half the per-tick rate. Both the
        // position and the need levels of that agent differ at tick 100.
        // Unlike the [C2] case, this fixture is directly sensitive: the fridge
        // is the object it holds.
        //
        // **The adjacency change did NOT move it, and that is a blindness
        // rather than a reassurance** - [L36] again, in the form that needs
        // stating. Sims now path to a tile BESIDE an object instead of onto
        // it, which alters where every sim in the game finishes its walk. This
        // vector is silent about it because of arithmetic in the fixture:
        //
        //   the agents start at (1..8, 1) and the fridge is at (18, 14), so
        //   the walk is 17 + 13 = 30 tiles; at TILES_PER_TICK = 0.25 that is
        //   120 ticks, and TICKS is 100.
        //
        // **No agent ever arrives.** The adjacent path differs from the
        // on-tile path only in its last step, so the first 100 ticks of
        // walking are identical tile for tile and the digest cannot see the
        // difference.
        //
        // What that means for whoever changes pathing next: this vector covers
        // route CHOICE - a different heuristic, a different tiebreak, a
        // different neighbour order all move it - and is blind to anything
        // about ARRIVAL. Do not read a green vector as coverage of the end of
        // a path. Raising TICKS above 120 would close it, at the cost of
        // rewriting the constant and every note attached to it.
        //
        // Measured on wasm32 as well as natively, per [L13], rather than
        // assumed to carry across: the two agree. The boundary copy lives
        // in web/tests/bridge.test.ts.
        // **And the needs retune moved it again**, from
        // 0xD993_6100_876C_D55A. Every one of the seven `decay_per_tick`
        // rates was slowed, and this fixture's digest includes need levels, so
        // all eight agents differ at tick 100 by construction. The most
        // directly sensitive change of the four the vector saw today.
        // **Habituation moved it, and this fixture is directly sensitive to it
        // for a reason the earlier notes here did not have to consider: the
        // digest now carries a fifth column.**
        //
        // Two things changed at once and both are real. The digest gained
        // habituation entries per agent, so a sim that has finished an
        // interaction hashes differently from one that has not; and scoring now
        // scales a repeated interaction's benefit, so what the eight agents
        // choose differs from tick to tick. Either alone would have moved it.
        //
        // Previous value: 0xCB2C_8122_2251_D840.
        //
        // Note the fixture is NOT blind to this the way it was blind to the
        // adjacency change: its agents reach nothing in 100 ticks, but the
        // habituation column is written for every agent on every tick whether
        // they arrive or not, and the empty-vector case is length-prefixed
        // rather than absent.
        //
        // **Object footprints did NOT move it, and that is a blindness rather
        // than a reassurance** - [L36] again, and the second time on the same
        // fixture. It was expected to move, because [F3] makes every footprint
        // tile impassable and that changes where sims can walk. Two properties
        // of this fixture, and not one, are what silence it:
        //
        //   - `build_scenario` calls `Sim::new_with_lot`, so no lot is loaded
        //     and nothing blocks any tile. Footprint blocking happens in
        //     `Sim::new_from_lot`, which this scenario never touches.
        //   - Its one object is the shipped FRIDGE, which is 1x1. The bed is
        //     the only wider object in shipped content, and the rectangle
        //     search reduces to the old single-tile search exactly - the
        //     heuristic `rect_distance(n, to, 1x1)` IS `Manhattan(n, to)` - so
        //     even a loaded lot would produce identical arithmetic for it.
        //
        // Either property alone would be enough to hide the change, which is
        // why both are written down: closing one of them does not close the
        // gap. What this vector still covers is unchanged; what it does not
        // cover now includes the whole of footprints. The rectangle search is
        // pinned in `terri-core`'s `grid.rs`, the blocking in `lot_tests`
        // here, and the two production call sites in `action.rs`.
        // **Moved by M2b's balance pass, and it is a SIMULATION change rather
        // than an encoding one.** `content/tuning.toml` raised `comfort`'s decay
        // from 0.021 to 0.032, and this digest includes all seven need levels
        // for every agent - so one of the seven columns in eight agent rows
        // differs at every tick from the first.
        //
        // What did NOT move it, and is worth writing down because it looks like
        // it should have: the five-room lot, the twenty-two new objects, and
        // the five re-tuned interactions. `build_scenario` calls
        // `Sim::new_with_lot`, so it never loads `content/lot.toml` at all, and
        // its one object is the shipped fridge, which this pass did not touch.
        // A vector built on a synthetic scenario is deliberately insensitive
        // to content it does not use; see [L36] for what that insensitivity
        // has already hidden once.
        //
        // **M2d moved it by ENCODING, not behaviour: the digest gained two
        // columns.** Every row now carries a SimId (the in-band
        // `u64::MAX` sentinel here, since `build_scenario` spawns plain
        // agents with no identity) and a length-prefixed relationships
        // list (empty here - nobody has met anybody). Both are written
        // for every entity whether populated or not, which is exactly why
        // the vector moved with zero sims and zero feelings in the
        // fixture: the SHAPE is the published format, per the same
        // decision that fixed all seven need columns while only hunger
        // decayed. Nothing about what the eight agents do changed;
        // `identical_scenarios_produce_identical_world_hashes` and every
        // behavioural test passed untouched across this move.
        //
        // Read off the wasm32 failure after a rebuild per [L13] rather than
        // copied from native - the two agree, which is a measurement each
        // time. Previous values: 0xFB84_8515_2C59_2AD8 (habituation),
        // 0xCB2C_8122_2251_D840 before that.
        //
        // **And `contested_score_multiplier` moved it**, from
        // 0x7E3F_CBE2_7849_036C. This scenario is eight agents and one
        // fridge, so seven are outbid on every tick and the knob decides,
        // for each of them, whether wanting a thing it cannot have is enough
        // to stand still for.
        //
        // Measured at tick 100 across four values, which is what makes "this
        // fixture exercises the knob" a reading rather than a claim:
        //
        //   0.10 -> 7 restless, 7 blocked, 0x9CA3_2684_8584_1091
        //   0.40 -> 3 restless, 7 blocked, 0xEC57_7C0B_CF22_05E0
        //   0.75 -> 1 restless, 7 blocked, 0xEEE5_892C_001E_DD92
        //   1.00 -> 0 restless, 7 blocked, 0x7E3F_CBE2_7849_036C
        //
        // **The last line is the control, and it is exact.** At a multiplier
        // of 1.0 the digest is bit-identical to the value this constant held
        // before the knob existed, which is the arithmetic working out: 1.0
        // attenuates nothing, so every outbid sim waits, which is precisely
        // what the [C3] fix did on its own. The knob is a pure addition and
        // the movement below is caused by it alone.
        //
        // **M2d moved it again, by ENCODING**: every digest row gained a
        // SimId column (the in-band u64::MAX sentinel here - these agents
        // carry no identity) and a length-prefixed relationships list
        // (empty here). Both are written for every entity whether
        // populated or not - the SHAPE is the published format, per the
        // same decision that fixed all seven need columns while only
        // hunger decayed. The two movements merged from parallel
        // branches, so this value was the MERGED measurement, from
        // 0x390E_E443_81C5_4B7A.
        //
        // **M2e moved it once more, by ENCODING alone**: every row gained
        // a trailing satisfaction f32 - the in-band -1.0 sentinel here,
        // since these bare agents carry no ledger - written for every
        // entity per the published-shape rule above. BEHAVIOUR was
        // untouched, from 0x390E_E443_81C5_4B7A.
        //
        // **And M2e PR 2 moved it the same way**: a trailing
        // length-prefixed Traits list per row, empty for these bare
        // agents, so the movement is one zero-length u64 per row and
        // nothing else - capabilities learn and conditions are managed,
        // so worn state is replay state by habituation's own argument.
        // Measured on native and confirmed equal on wasm32 through the
        // rebuilt module, per [L13]. That value was
        // 0xB902_5674_0958_9E88.
        //
        // **M2e PR 3 moved it by ENCODING once more, twice in one
        // settlement**: every row gained a trailing AtWork u64 (the
        // out-of-band u64::MAX sentinel here - nobody in this scenario
        // holds a job, and a real countdown cannot reach u64::MAX
        // because shift_ticks is a u32 below day_ticks), and the digest
        // gained ONE Funds u64 after the rows (zero here - the shift
        // countdown and the money are both replay state, the
        // Satisfaction argument). Behaviour untouched: these agents
        // have no Career, so the career systems never fire. That value
        // was 0x5FEB_C18C_2EFE_AC10.
        //
        // **M2f PR 2 moved it by encoding again**: every row gained a
        // trailing ChainState triple (chain u64 + step u64 + fumble
        // f32 - the out-of-band u64::MAX sentinel plus 0 plus the
        // clean 1.0 here, all written even under the sentinel per the
        // published-shape rule) and a Carrying u64 (u64::MAX here).
        // The program counter is the resume state ([K4]), the fumble
        // rides in it so a ruined dinner survives preemption, and the
        // carried item is what the counter is about - all replay
        // state. Behaviour untouched: nothing inserts a ChainState in
        // this scenario, whose agents own no chain.
        const GOLDEN: u64 = 0x20E2_32DE_F1EB_AFF5;

        let mut sim = build_scenario();
        for _ in 0..TICKS {
            sim.tick();
        }

        assert_hash_sees_entities(&sim, TICKS);
        assert_eq!(
            sim.world_hash(),
            GOLDEN,
            "the world hash of a fixed scenario at tick {TICKS} changed; \
             either the digest encoding moved or the simulation no longer \
             computes what it did. Do not update the constant without \
             naming which"
        );
    }

    #[test]
    fn hash_changes_as_the_world_evolves() {
        let mut sim = build_scenario();
        let before = sim.world_hash();
        for _ in 0..50 {
            sim.tick();
        }
        assert_ne!(before, sim.world_hash());
    }

    #[test]
    fn hash_ignores_archetype_layout_and_entity_history() {
        // The test above runs two identical scenarios in one process, so
        // both share an archetype layout and cannot disagree about
        // ordering by construction - lessons-learned [L5] is three
        // recorded instances of exactly that shape being permanently
        // green. It proves the hash is REPRODUCIBLE. It does not prove
        // the hash is CORRECT.
        //
        // What Layer 2 multiplayer needs is stronger: two worlds holding
        // the same logical state, **and having allocated the same entity
        // indices for it**, must hash the same even when their ECS
        // layouts got there by different routes, because entities that
        // lived and died in a different order leave a different
        // archetype layout behind. This test builds that difference
        // deliberately and asserts the difference exists at the moment
        // the hashes are compared - without that precondition the test
        // would silently degrade into a second copy of the one above.
        //
        // The index clause is a real limit, not pedantry. world_hash
        // keys rows on Entity::index_u32(), which is itself allocation
        // history, so a peer that joined late and allocated different
        // indices for the same logical entities hashes differently. What
        // this test pins is layout-insensitivity, not history- or
        // index-insensitivity. Entity generation is unhashed as well, so
        // a despawn/respawn that reuses an index aliases with the
        // original. Both are known M0 limits; Layer 2 will need a stable
        // network id in place of the raw index.
        const TICKS: usize = 500;

        let mut a = build_scenario();
        let mut b = build_scenario();

        // b reaches the same tick count by a different route. A bystander
        // entity is born, lives one tick and dies, and one agent leaves
        // and re-enters its table. Neither changes what the simulation
        // computes: the bystander carries neither Agent nor SmartObject
        // nor Needs nor Path, so no system's query matches it, and the
        // insert/remove pair is applied between ticks where no system can
        // observe it. Both change the order the ECS yields entities in,
        // because leaving an archetype swap-removes an entity from its
        // table and re-entering appends it at the back.
        let bystander = b.world_mut().spawn(Position { x: 23.0, y: 23.0 }).id();
        let victim = lowest_indexed_agent(&b);
        b.world_mut().entity_mut(victim).insert(Eating {
            object: shipped_fridge().0,
            interaction: 0,
            remaining_ticks: 1,
        });
        b.world_mut().entity_mut(victim).remove::<Eating>();

        a.tick();
        b.tick();
        assert!(
            b.world_mut().despawn(bystander),
            "the bystander must actually be despawned or b holds an extra row"
        );

        for _ in 1..TICKS {
            a.tick();
            b.tick();
        }

        // Preconditions. Without these the test can pass while proving
        // nothing at all.
        let order_a = raw_iteration_order(&a);
        let order_b = raw_iteration_order(&b);
        assert_ne!(
            order_a, order_b,
            "the two worlds must iterate in different orders or this test \
             cannot detect an ordering dependency; got {order_a:?}"
        );
        let mut sorted_a = order_a.clone();
        let mut sorted_b = order_b.clone();
        sorted_a.sort_unstable();
        sorted_b.sort_unstable();
        assert_eq!(
            sorted_a, sorted_b,
            "the two worlds must hold the same entities; only their order \
             may differ"
        );
        assert_eq!(
            a.world().resource::<SimClock>().tick,
            b.world().resource::<SimClock>().tick,
            "both runs must have advanced the same number of ticks"
        );
        assert_hash_sees_entities(&a, TICKS);

        assert_eq!(
            a.world_hash(),
            b.world_hash(),
            "identical state hashed differently because the two worlds got \
             there by different histories; the hash depends on archetype \
             order, which breaks state comparison across peers"
        );
    }
}
