use crate::ids::ObjectDefId;
use crate::needs::NEED_COUNT;
use bevy_ecs::prelude::{Component, Entity, Resource};

/// World-space position in tiles. Not screen space; the renderer
/// applies the isometric projection.
#[derive(Component, Debug, Clone, Copy, PartialEq)]
pub struct Position {
    pub x: f32,
    pub y: f32,
}

/// Marks an entity as a simulated person.
#[derive(Component, Debug, Clone, Copy)]
pub struct Agent;

/// A placed object. See [D6] and [D-1]. The advertised interactions live
/// in the content pack, not here, which is what lets an advert be a
/// variable-length list of need deltas rather than one named field.
///
/// The id indexes the pack the simulation was built with. Nothing
/// persists one - it is not stable across content edits - so a save file
/// must store the object's string id and resolve it with
/// `ContentPack::find` on load.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct SmartObject(pub ObjectDefId);

/// Marks a smart object as claimed. Reservation is serialized and
/// ordered by entity id so two agents never claim one slot.
#[derive(Component, Debug, Clone, Copy)]
pub struct Reserved;

/// A tile path being followed. `steps` excludes the origin tile.
#[derive(Component, Debug, Clone)]
pub struct Path {
    pub steps: Vec<(i32, i32)>,
    pub cursor: usize,
}

impl Path {
    /// The tile to walk to next, or `None` once the path is exhausted.
    ///
    /// There is deliberately no `is_complete`. `follow_path` asks the same
    /// question as `next_step().is_none()`, and two ways to ask one
    /// question is a future divergence: an off-by-one fixed in one and not
    /// the other would leave an agent that both has a step to take and is
    /// finished. The `None` case is the completion signal.
    pub fn next_step(&self) -> Option<(i32, i32)> {
        self.steps.get(self.cursor).copied()
    }
}

/// The smart object this agent is currently travelling to, and which of
/// that object's advertised interactions it chose.
///
/// The interaction index is carried rather than re-derived on arrival.
/// Selection scores every (object, interaction) pair against the agent's
/// deficits at the moment of choosing; by the time the agent has walked
/// there those deficits have moved, so re-deriving the choice could pick
/// a different interaction than the one that actually won.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Target {
    pub object: Entity,
    /// Index into the target object's `interactions` in the content pack.
    pub interaction: u32,
}

/// Marks an agent for which **nothing at all is worth doing** - every
/// candidate it can reach scored at or below `idle_threshold`.
///
/// It is not the same as "took no action". An agent whose best option
/// scores between `idle_threshold` and `action_threshold` also takes no
/// action, and it deliberately does NOT get this marker: something is
/// mildly worth doing, so the sim stays put rather than strolling away
/// from it. That band is the whole reason the two knobs are separate,
/// per [D-5], and collapsing them would delete it.
///
/// `select_action` is the only writer, because it is the only system
/// that scores. `idle::wander` is the only reader. Keeping the marker
/// rather than re-scoring in the wander system is what stops the same
/// A*-per-candidate sweep running twice a tick, and what stops the two
/// copies of the scoring rule drifting apart.
#[derive(Component, Debug, Clone, Copy)]
pub struct Restless;

/// Marks an agent whose **best option is held by somebody else** - the
/// highest-scoring thing it could see is reserved by another agent, or
/// was claimed by one earlier on the same tick.
///
/// # It is not the opposite of `Restless`, and the two co-occur
///
/// [`Restless`] asks "was anything worth doing at all"; this asks "was
/// the best thing available". An agent can carry both, and that pair is
/// informative rather than contradictory: **it wanted a contested thing,
/// but not enough to wait for it.** A contested object's score is
/// attenuated by `contested_score_multiplier`, so an agent that only
/// mildly wanted the thing falls under `idle_threshold` and strolls off,
/// while one that wanted it badly stays put. That knob is the dial
/// between the two, and before it existed every outbid sim waited.
///
/// # Two writers, deliberately, unlike `Restless`
///
/// `select_action` sets it for an agent choosing for itself.
/// `serve_intents` sets it for an agent the player has directed at an
/// object somebody else is using, which is the case this name most
/// obviously describes.
///
/// That is a departure from `Restless`'s single writer, and it is cheap
/// for a reason that does not apply there. `Restless` has one writer to
/// stop the A*-per-candidate scoring sweep running twice a tick, and to
/// stop two copies of the scoring rule drifting apart. `serve_intents`
/// needs no scoring at all to know the object it was told to use is
/// reserved, so there is no rule here to duplicate - only a fact. The two
/// cannot disagree about one agent on one tick either, because
/// `select_action` filters directed agents out before it scores anything.
///
/// # Its reader explains state; it does not drive the simulation
///
/// [L41] says a mechanism nothing depends on is dead code and should be
/// deleted rather than tested. **That rule is about a GUARD** - a second
/// line enforcing a rule an earlier line already enforces, where defence
/// in depth and untested code are indistinguishable from inside the
/// suite. This is not a guard. The sim projects it through
/// `stall_reason_of`, and the normal selected-person HUD uses that projection
/// to explain why somebody is standing still. No decision depends on the
/// marker, so it still cannot silently change simulation behavior.
///
/// The selection UI reader is shipped. A future local-wander behavior could
/// also consume the marker, but that would be a separate design change rather
/// than the reason this diagnostic fact exists.
#[derive(Component, Debug, Clone, Copy)]
pub struct Blocked;

/// How long an idle agent waits before strolling somewhere new.
///
/// Counted down only while the agent is standing still, since the wander
/// system skips anything that still has a `Path`. So the value is the
/// gap BETWEEN wanders rather than a cooldown that expires mid-walk,
/// which is what stops a sim pacing every single tick.
///
/// Owned entirely by `idle::wander`. It persists across an interruption,
/// so a sim that gets hungry mid-pause keeps its remaining count, which
/// costs nothing and avoids a second component whose only job would be to
/// forget.
#[derive(Component, Debug, Clone, Copy)]
pub struct Wander {
    pub pause_ticks: u32,
}

/// Marks the one agent the player has selected.
///
/// **Selection lives in the simulation rather than in the shell**, per
/// [D-5], and that is a determinism decision rather than a tidiness one:
/// a replay has to reproduce it, and the only state a replay reproduces
/// is state the simulation owns. The DOM holds an entity index and reads
/// everything else back through the bridge each frame.
///
/// A marker rather than a resource holding an `Entity`, because "which
/// entities carry this component" is a question the ECS already answers
/// and an `Entity` in a resource can outlive the entity it names.
/// Uniqueness - at most one agent selected - is the command drain's
/// invariant, not this type's.
#[derive(Component, Debug, Clone, Copy)]
pub struct Selected;

/// One player-issued instruction: use this object, this way.
///
/// The interaction is a `u32` rather than the `usize` the milestone plan
/// sketched, so that it is the same width as [`Target::interaction`] and
/// [`Eating::interaction`] - the two fields it is copied into. A `usize`
/// is 64 bits natively and 32 on wasm32, and a platform-width integer
/// inside simulation state is the shape of a determinism bug even when
/// today's values could never reach the difference.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Intent {
    pub object: Entity,
    /// Index into that object's `interactions` in the content pack.
    pub interaction: u32,
}

/// An agent's player-issued intents, front first - [D-3].
///
/// **This is a simulation structure, not UI scaffolding.** A directed
/// action has to beat autonomy or clicking feels ignored, so
/// `select_action` skips any agent whose queue is non-empty and
/// `serve_intents` turns the front intent into a `Target`. The front
/// entry is the sim's current commitment and is popped when the
/// interaction it names completes.
///
/// # `pop` takes from the FRONT
///
/// It pairs with [`IntentQueue::front`], not with `Vec::pop`. A queue
/// whose `pop` returned the back would silently serve the player's
/// instructions in reverse, which is the kind of thing that reads as
/// "the game ignored my click" rather than as an inverted container.
/// `pop_removes_the_front_so_intents_are_served_in_the_order_issued` is
/// what pins it.
///
/// `Vec` rather than `VecDeque` because the depth is a handful of
/// entries: removing from the front is a memmove of at most a few
/// elements, which is cheaper than the extra indirection, and it keeps
/// the type as plain as `CommandQueue`.
#[derive(Component, Debug, Clone, Default, PartialEq, Eq)]
pub struct IntentQueue(Vec<Intent>);

impl IntentQueue {
    /// A queue already holding these intents, front first. For tests and
    /// for whoever restores a save.
    pub fn from_intents(intents: Vec<Intent>) -> Self {
        Self(intents)
    }

    /// Adds an intent at the BACK, so it is served after everything
    /// already queued.
    pub fn push(&mut self, intent: Intent) {
        self.0.push(intent);
    }

    /// The intent being served right now, or `None` when the agent is
    /// back on autonomy.
    pub fn front(&self) -> Option<Intent> {
        self.0.first().copied()
    }

    /// Removes and returns the FRONT intent. See the type's docs.
    pub fn pop(&mut self) -> Option<Intent> {
        if self.0.is_empty() {
            return None;
        }
        Some(self.0.remove(0))
    }

    /// Drops every intent, returning the agent to autonomy. This is what
    /// `SimCommand::CancelIntents` reaches.
    pub fn clear(&mut self) {
        self.0.clear();
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Intents in service order. Save snapshots need the whole queue, not
    /// only its front item, or a reload can silently discard player orders.
    pub fn as_slice(&self) -> &[Intent] {
        &self.0
    }
}

/// How tired of each interaction a sim currently is - [S2].
///
/// **The name is `habituation`**, the psychological term for a diminished
/// response to a repeated stimulus. It applies identically to the same meal,
/// the same television, the same gym and the same person, which is why it is not
/// called satiation: that word imports a food metaphor into a mechanic with
/// nothing to do with food.
///
/// # What it is keyed on, and why not the object
///
/// One value per `(ObjectDefId, interaction index)` - an **interaction**, not a
/// placed entity and not a need.
///
/// Not the entity, because eating at three different tables is one activity
/// while eating three different meals is not, and keying on the entity would
/// make a household with four identical chairs four separate novelties. Not the
/// need, because "tired of reading" and "tired of watching television" are
/// different feelings that both satisfy `fun`.
///
/// # Why a sorted Vec rather than a map
///
/// It is iterated by `world_hash`, and a digest over an unordered container is
/// a digest that depends on insertion history - which is [D12]'s whole problem.
/// `HashMap` iteration order is unspecified; `BTreeMap` would work but costs a
/// dependency-shaped decision for a container that holds one entry per
/// interaction a sim has ever performed, which is single digits.
///
/// So: a `Vec` kept sorted by key, with a binary search to find an entry. The
/// invariant is maintained by [`Self::bump`], which is the only thing that
/// inserts.
#[derive(Component, Debug, Clone, Default, PartialEq)]
pub struct Habituation(Vec<(ObjectDefId, u32, f32)>);

impl Habituation {
    /// How habituated this sim is to one interaction, in `0.0..=1.0`. An
    /// interaction never performed reads 0.
    pub fn get(&self, object: ObjectDefId, interaction: u32) -> f32 {
        match self.find(object, interaction) {
            Ok(i) => self.0[i].2,
            Err(_) => 0.0,
        }
    }
    /// Raises one interaction's habituation by `amount`, capped at 1.
    ///
    /// Inserting at the searched position is what keeps the Vec sorted, and the
    /// sort is what makes `world_hash` reproducible.
    pub fn bump(&mut self, object: ObjectDefId, interaction: u32, amount: f32) {
        match self.find(object, interaction) {
            Ok(i) => self.0[i].2 = (self.0[i].2 + amount).min(1.0),
            Err(i) => self
                .0
                .insert(i, (object, interaction, amount.clamp(0.0, 1.0))),
        }
    }
    /// Decays every entry by `amount`, dropping any that reach zero.
    ///
    /// **Dropping is not just tidiness.** An entry pinned at 0.0 is
    /// indistinguishable in behaviour from an absent one, so keeping it would
    /// let two sims with identical behaviour hold different `Habituation`
    /// values - and therefore hash differently - purely because of what they
    /// had done hours ago. Removing them keeps the digest a function of state
    /// that matters.
    pub fn decay(&mut self, amount: f32) {
        for entry in self.0.iter_mut() {
            entry.2 -= amount;
        }
        self.0.retain(|entry| entry.2 > 0.0);
    }
    /// Every entry, in key order. For `world_hash` and for tests.
    pub fn entries(&self) -> &[(ObjectDefId, u32, f32)] {
        &self.0
    }
    fn find(&self, object: ObjectDefId, interaction: u32) -> Result<usize, usize> {
        self.0
            .binary_search_by(|(o, i, _)| (o.0, *i).cmp(&(object.0, interaction)))
    }
}

/// How this sim feels about each other sim it has ever dealt with -
/// [H5] in `docs/specs/2026-07-30-household-and-relationships-design.md`.
///
/// One `f32` per **ordered** pair, in `-1.0..=1.0`, where 0 is a
/// stranger: A's feeling about B lives on A and B's about A lives on B,
/// so unrequited is a real state and the asymmetry costs nothing. One
/// number rather than a friendship/romance/respect vector, because one
/// is enough to change choice and the extra dimensions should wait for
/// something in the game that distinguishes them.
///
/// Keyed on [`SimId`] rather than `Entity` for exactly the reason
/// `SimId` exists: entity indices are reused after death, and a grudge
/// that silently transfers to whoever is born next is [L47] wearing a
/// different hat.
///
/// A sorted `Vec` with the same shape, the same invariant-holder
/// ([`Self::bump`] is the only inserter) and the same reason as
/// [`Habituation`]: `world_hash` iterates it, and a digest over an
/// unordered container depends on insertion history.
#[derive(Component, Debug, Clone, Default, PartialEq)]
pub struct Relationships(Vec<(SimId, f32)>);

impl Relationships {
    /// How this sim feels about `other`, in `-1.0..=1.0`. A stranger
    /// reads 0.
    pub fn feeling(&self, other: SimId) -> f32 {
        match self.find(other) {
            Ok(i) => self.0[i].1,
            Err(_) => 0.0,
        }
    }
    /// Moves the feeling toward `other` by `amount` - which may be
    /// negative, the day an interaction sours one - clamped to
    /// `-1.0..=1.0`.
    ///
    /// Inserting at the searched position keeps the Vec sorted, and the
    /// sort is what makes `world_hash` reproducible.
    pub fn bump(&mut self, other: SimId, amount: f32) {
        match self.find(other) {
            Ok(i) => self.0[i].1 = (self.0[i].1 + amount).clamp(-1.0, 1.0),
            Err(i) => self.0.insert(i, (other, amount.clamp(-1.0, 1.0))),
        }
    }
    /// Drifts every entry toward ZERO by `amount` - a grudge fades on
    /// the same clock a friendship does - dropping any that arrive.
    ///
    /// Dropping is the same digest argument as [`Habituation::decay`]:
    /// an entry pinned at 0.0 behaves exactly like an absent one, so
    /// keeping it would let two sims with identical behaviour hash
    /// differently because of who they once knew.
    ///
    /// The over-shoot clamp is what makes zero REACHABLE: a feeling
    /// smaller than `amount` snaps to zero rather than oscillating
    /// across it forever at one `amount` per tick.
    pub fn decay(&mut self, amount: f32) {
        for entry in self.0.iter_mut() {
            if entry.1 > 0.0 {
                entry.1 = (entry.1 - amount).max(0.0);
            } else {
                entry.1 = (entry.1 + amount).min(0.0);
            }
        }
        self.0.retain(|entry| entry.1 != 0.0);
    }
    /// Every entry, in key order. For `world_hash` and for tests.
    pub fn entries(&self) -> &[(SimId, f32)] {
        &self.0
    }
    fn find(&self, other: SimId) -> Result<usize, usize> {
        self.0.binary_search_by(|(id, _)| id.cmp(&other))
    }
}

/// How well this sim's LIFE is going - the second axis, [E1] in
/// `docs/specs/2026-08-01-m2e-satisfaction-hobbies-career-design.md`.
///
/// An accumulator, not an eighth need: it never drains on a clock, it
/// has no ceiling, and no object advertises it. Exactly three writers
/// exist by design - hobby completions add, neglect bleeds, and (from
/// PR 2) conditions scale the accrual - and [S1]'s DECIDED rule that
/// needs can only ever COST it is enforced upstream, where the compile
/// step rejects a negative content yield.
///
/// Non-negative: a life cannot owe. [`Self::add`] holds the invariant
/// so `world_hash`, which digests this, never sees a sign a replay
/// could disagree about.
#[derive(Component, Debug, Clone, Copy, Default, PartialEq)]
pub struct Satisfaction(f32);

impl Satisfaction {
    /// The accumulated total, `>= 0`.
    pub fn value(&self) -> f32 {
        self.0
    }
    /// Moves the total by `amount` - negative for the neglect bleed -
    /// clamped at zero from below and unbounded above.
    pub fn add(&mut self, amount: f32) {
        self.0 = (self.0 + amount).max(0.0);
    }
}

/// The activity tags this sim loves - [E2]. Content, copied from the
/// compiled household member at spawn, and NOT hashed: like
/// `Personality`, it is derivable from the pack for as long as nothing
/// mutates it, and the day something does (acquiring a hobby in play)
/// it enters `world_hash` on the same expiry note personality carries.
///
/// A `Vec` of the pack's own strings rather than interned indices: it
/// is read once per COMPLETION, not per tick, and the pack has no tag
/// table to index into - inventing one for this read rate would be
/// mechanism without a customer.
#[derive(Component, Debug, Clone, Default, PartialEq)]
pub struct Hobbies(pub Vec<String>);

impl Hobbies {
    /// Whether any of `tags` is a hobby of this sim - the one question
    /// the payout asks.
    pub fn loves_any(&self, tags: &[String]) -> bool {
        tags.iter().any(|tag| self.0.contains(tag))
    }
}

/// Per-sim trait state - [E3]. Entries are `(index into the pack's
/// trait list, state)`, sorted by index; the state is a capability's
/// LEVEL or a condition's SEVERITY, and 0.0 for a stateless
/// disposition. In the world hash: capabilities learn and conditions
/// are managed, so two replays must agree on both.
///
/// A sorted `Vec` with one inserter, the same shape and reasons as
/// [`Habituation`] and [`Relationships`]: `world_hash` iterates it.
#[derive(Component, Debug, Clone, Default, PartialEq)]
pub struct Traits(Vec<(u32, f32)>);

impl Traits {
    /// Built at spawn from the worn trait indices and each one's
    /// starting state (level, severity, or 0.0 for a disposition).
    ///
    /// Indices must be unique: `set_state`'s binary search would update
    /// one duplicate and leave the other stale. The content gate makes a
    /// duplicate unbuildable (`DuplicateWornTrait` in terri-data), so
    /// the assert documents the contract for any FUTURE caller - trait
    /// acquisition, a save loader - rather than guarding live content.
    pub fn from_entries(mut entries: Vec<(u32, f32)>) -> Self {
        entries.sort_unstable_by_key(|(index, _)| *index);
        debug_assert!(
            entries.windows(2).all(|w| w[0].0 != w[1].0),
            "duplicate trait index in Traits::from_entries - the compile \
             step rejects a trait worn twice, so this caller bypassed it"
        );
        Self(entries)
    }
    /// The state of the worn trait at `index`, or `None` if this sim
    /// does not wear it.
    pub fn state(&self, index: u32) -> Option<f32> {
        self.find(index).ok().map(|i| self.0[i].1)
    }
    /// Sets a WORN trait's state, clamped to `0..=1`; a trait this sim
    /// does not wear is ignored rather than acquired - acquisition is a
    /// future mechanic with its own rules, not a side effect of a
    /// clamp.
    pub fn set_state(&mut self, index: u32, value: f32) {
        if let Ok(i) = self.find(index) {
            self.0[i].1 = value.clamp(0.0, 1.0);
        }
    }
    /// Every entry, in key order. For `world_hash` and for tests.
    pub fn entries(&self) -> &[(u32, f32)] {
        &self.0
    }
    fn find(&self, index: u32) -> Result<usize, usize> {
        self.0.binary_search_by(|(i, _)| i.cmp(&index))
    }
}

/// This attempt is FAILING - a capability roll came up short when the
/// interaction began ([E3]). Carried beside `Eating` for the length of
/// the attempt; `delta_scale` is what the advertised BENEFITS deliver
/// (costs still bite in full, the standing `scaled_delta` rule), and a
/// fumbled completion pays no satisfaction while still teaching.
///
/// A separate component rather than a field on `Eating`, because
/// absence IS the common case (success, scale 1.0) and every fixture
/// that builds a meal by hand should not have to say so. Deliberately
/// NOT in the world hash, like `Eating` itself: transient action state,
/// reproduced by the same PRNG draw on any replay.
#[derive(Component, Debug, Clone, Copy, PartialEq)]
pub struct Fumbled {
    pub delta_scale: f32,
}

/// The job this sim holds - an index into the pack's career list
/// ([E4]). Spawn-time content like [`Hobbies`], and NOT hashed for the
/// Personality reason: derivable from the pack, immutable in M2e.
/// **That exclusion expires the moment anything mutates one** - a quit
/// or choose-career command - at which point this joins the hash the
/// way `Traits` did.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Career(pub u32);

/// This sim is walking to the front door to start a shift - [E4].
/// Transient action state of the same class as `Eating` and `Fumbled`,
/// deliberately NOT hashed: reproduced by the day clock on any replay.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Commuting;

/// This sim is off the lot, working - the rabbit hole ([E4]). Counts
/// down to the return. IN the world hash: it ticks, so two replays
/// must agree on it, exactly the `Satisfaction` argument.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct AtWork {
    pub remaining_ticks: u32,
}

/// The household's money - [E4]. One number for the whole lot rather
/// than per sim, because the household is the economic unit build mode
/// will spend from. `i64` so a future bill can take it negative
/// without a wrap. In the world hash.
#[derive(Resource, Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Funds(pub i64);

/// The chain this sim is partway through - [K4]'s program counter.
/// `chain` indexes the pack's chain list, `step` the next (or current)
/// step to run. IN the world hash: it is the resume state, and two
/// replays must agree on where every dinner stands.
///
/// Survives every preemption on purpose - a player click, a career
/// shift - and is removed by exactly two things: the terminal step's
/// completion, and an explicit `CancelIntents` (stop means stop).
///
/// `fumble_scale` is the chain's own fumble record, IN here rather
/// than on the transient `Fumbled` deliberately: a ruined dinner must
/// stay ruined through a preemption, and `Fumbled` is cleared by
/// every preemption path on purpose. 1.0 is a clean run; a tagged
/// step's failed roll writes its `fail_delta_scale` here and the
/// terminal delivery reads it.
#[derive(Component, Debug, Clone, Copy, PartialEq)]
pub struct ChainState {
    pub chain: u32,
    pub step: u32,
    pub fumble_scale: f32,
}

impl ChainState {
    /// A fresh chain at its first step, unfumbled.
    pub fn begin(chain: u32) -> Self {
        Self {
            chain,
            step: 0,
            fumble_scale: 1.0,
        }
    }
    /// Whether any step's capability roll failed so far.
    pub fn fumbled(&self) -> bool {
        self.fumble_scale < 1.0
    }
}

/// The item in this sim's hands, as an index into the pack's item
/// kinds - [K3]. IN the world hash. A COMPONENT rather than an entity
/// this milestone, deliberately: no shipped step puts anything down as
/// a world object, and the entity upgrade (with the project's first
/// despawn, [L47]'s minefield) lands with whatever first drops an
/// item. The working design names the trap.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Carrying(pub u32);

/// A chain step in progress at its station - the chain's `Eating`.
/// Transient action state, deliberately NOT hashed (the Eating class:
/// reproduced by the same PRNG draw on any replay); [`ChainState`] is
/// the durable half. Which step is running is the counter's business,
/// so this carries only the clock.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct StepWork {
    pub remaining_ticks: u32,
}

/// The atlas sprite this entity is drawn with, when it differs from its
/// object definition's - [A-11]'s facing mechanism.
///
/// A placement may say `facing = "SW"`, and the compile step resolves
/// that to a concrete sprite index at build time; this component is how
/// the resolved index rides on the spawned entity so the render buffer
/// can read it. Presentation only: nothing in scoring, pathing or the
/// world hash reads it, exactly like `SimName`.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpriteVariant(pub u32);

/// A sim's stable identity - [H1] in
/// `docs/specs/2026-07-30-household-and-relationships-design.md`.
///
/// **This is deliberately not the entity index**, and the difference has a
/// scheduled arrival date rather than being theoretical. `bevy_ecs` reuses a
/// despawned entity's index for the next spawn, so anything keyed on the
/// index silently transfers to the new occupant - [L47] records the render
/// buffer learning this, and `drain_commands::resolve` documents living with
/// it at the wire boundary because JavaScript cannot carry a generation.
/// Three things need a name for a sim that survives all of that:
/// relationships (per-pair state pointing at *that* one), the save file
/// (an `Entity` is meaningless outside the `World` that minted it), and
/// eventually death, which is what makes index reuse reachable at all.
///
/// Allocated by [`SimIdAllocator`], monotonically, never reused.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct SimId(pub u32);

/// The counter [`SimId`]s come from. A world resource rather than a static,
/// so two `Sim`s in one process - every test file - cannot interleave their
/// sequences, and so a save file can restore it and keep the guarantee.
#[derive(Resource, Debug, Default)]
pub struct SimIdAllocator(u32);

impl SimIdAllocator {
    /// Issues the next identity. Every call returns a fresh one; nothing
    /// hands them back. Named `issue` rather than `next` so it cannot be
    /// confused with `Iterator::next`, which clippy rightly flags: an
    /// allocator is not an iterator, and `for id in allocator` should not
    /// come close to compiling by accident.
    pub fn issue(&mut self) -> SimId {
        let id = SimId(self.0);
        self.0 += 1;
        id
    }
    /// How many have been issued, for the save file and for tests.
    pub fn issued(&self) -> u32 {
        self.0
    }
}

/// A sim's display name.
///
/// Presentation, not simulation: nothing scores it, `world_hash` must not
/// read it (a rename should not diverge a replay), and it is deliberately
/// NOT an identity - two sims may share a name, which is one of the reasons
/// [H1] rejected keying relationships on it.
#[derive(Component, Debug, Clone, PartialEq, Eq)]
pub struct SimName(pub String);

/// Who this sim is, as numbers - [H3].
///
/// Two dense arrays indexed by `NeedId::index`, plus a per-interaction
/// weight list. Two arrays and not one because the request that started
/// this was explicit: an introvert's `social` should drain slowly AND
/// refill generously, and those are different numbers read by different
/// systems - `decay_needs` reads `drain`, `tick_interactions` reads
/// `satisfaction`, and selection reads both `satisfaction` and
/// `dispositions` so what a sim seeks agrees with what delivery gives it.
///
/// Dense `[f32; NEED_COUNT]` here even though the authored TOML is sparse:
/// the compile step fills absences with 1.0, so every read site is an
/// index rather than a lookup-with-default that each caller could write
/// differently.
///
/// **Every multiplier defaults to 1.0 and every consumer treats a missing
/// `Personality` component as all-ones.** That is what keeps the world-hash
/// golden vectors still: their scenarios spawn bare agents, and a bare
/// agent must behave exactly as it did before personalities existed.
///
/// `dispositions` is the same shape as [`Habituation`] - a sorted
/// `Vec<(ObjectDefId, u32, f32)>` keyed per interaction - and that is
/// [S4]'s decision rather than a coincidence: dispositions, habituation
/// and affinities are one mechanism with several sources, and selection
/// multiplies them rather than each growing its own lookup system. A
/// weight of 0 is legal and is the "fear of couches" the design brief
/// asks for: the interaction's benefit scores as nothing, so the sim
/// never chooses it, while a commanded use still works because commands
/// do not consult scoring.
#[derive(Component, Debug, Clone, PartialEq)]
pub struct Personality {
    pub drain: [f32; NEED_COUNT],
    pub satisfaction: [f32; NEED_COUNT],
    dispositions: Vec<(ObjectDefId, u32, f32)>,
    /// Where on the circadian curve this sim samples, in ticks -
    /// [ML-chrono]. Public because selection reads it directly, and 0 -
    /// "sleeps when everyone else does" - is what every sim had before
    /// the rhythm existed.
    ///
    /// This is the line that stops the household going to bed on the same
    /// tick, which reads as a screensaver rather than as a home.
    pub chronotype_offset_ticks: i32,
}

impl Personality {
    /// Multipliers of 1.0 everywhere: the sim personalities were bolted
    /// onto, behaving exactly as before they existed.
    pub fn neutral() -> Self {
        Personality {
            drain: [1.0; NEED_COUNT],
            satisfaction: [1.0; NEED_COUNT],
            dispositions: Vec::new(),
            chronotype_offset_ticks: 0,
        }
    }

    /// A personality with the given dispositions, sorted here so no caller
    /// can construct an unsorted one: `disposition` binary-searches, and
    /// the list's iteration order must be deterministic for anything that
    /// ever walks it - including `world_hash`, IF personality ever enters
    /// it. It does not today; see the exclusion note on `Sim::world_hash`.
    pub fn with_dispositions(
        drain: [f32; NEED_COUNT],
        satisfaction: [f32; NEED_COUNT],
        mut dispositions: Vec<(ObjectDefId, u32, f32)>,
    ) -> Self {
        dispositions.sort_by_key(|(object, interaction, _)| (object.0, *interaction));
        Personality {
            drain,
            satisfaction,
            dispositions,
            chronotype_offset_ticks: 0,
        }
    }

    /// This sim's weight on one interaction. Unlisted reads 1.0 - most
    /// sims feel nothing in particular about most furniture.
    pub fn disposition(&self, object: ObjectDefId, interaction: u32) -> f32 {
        match self
            .dispositions
            .binary_search_by(|(o, i, _)| (o.0, *i).cmp(&(object.0, interaction)))
        {
            Ok(i) => self.dispositions[i].2,
            Err(_) => 1.0,
        }
    }

    /// Every disposition, in key order. For tests today, and for
    /// `world_hash` the day personality becomes mutable and has to enter
    /// it - see the exclusion note on `Sim::world_hash`.
    pub fn dispositions(&self) -> &[(ObjectDefId, u32, f32)] {
        &self.dispositions
    }
}

impl Default for Personality {
    fn default() -> Self {
        Personality::neutral()
    }
}

/// An in-progress ordinary object interaction: a reference into the content
/// pack plus how much of it is left.
///
/// It names the object DEFINITION rather than the object entity, so the
/// deltas being delivered stay resolvable for the whole interaction even
/// if the entity changes underneath it. `Target` is what still names the
/// entity, because releasing the reservation needs one.
///
/// The historical name is narrower than the component's job. Eating, sleep,
/// washing, reading, and every other ordinary object interaction share this
/// state. Player-facing activity must therefore come from the authored
/// interaction, never from this type name.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Eating {
    pub object: ObjectDefId,
    /// Index into that object's `interactions` in the content pack.
    pub interaction: u32,
    pub remaining_ticks: u32,
}

/// An in-progress conversation, carried by the INITIATOR only - [H4].
///
/// The partner carries nothing but `Reserved`, exactly as a fridge in use
/// does: one talk is one interaction with a person where the object would
/// be, and `tick_social` delivers to both participants from this single
/// record. Giving the partner a mirror component would mean two counters
/// that have to agree, and the first interruption would leave one behind.
///
/// A separate component from [`Eating`] rather than a variant inside it,
/// because `Eating` names an [`ObjectDefId`] and a social interaction has
/// no object behind it: `interaction` here indexes the pack's SOCIAL
/// vocabulary. The partner is an `Entity` rather than a `SimId` because
/// releasing the reservation on completion needs the entity, the same
/// reason `Target` holds one; the relationship bump resolves the `SimId`
/// at delivery time.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Socialising {
    /// Index into the content pack's `social` vocabulary.
    pub interaction: u32,
    pub partner: Entity,
    pub remaining_ticks: u32,
}

#[cfg(test)]
mod intent_queue_tests {
    //! `IntentQueue`'s methods are the kind `cargo mutants` is blind to:
    //! `push`, `clear` and `remove` are statements whose only effect is on
    //! state, and the sweep rewrites expressions rather than deleting
    //! statements. Deleting the body of `push` leaves a clean report and
    //! a queue that never holds anything. See docs/testing-protocol.md
    //! rule 2; these tests are the thing standing in for the sweep.

    use super::{Intent, IntentQueue};
    use bevy_ecs::prelude::{Entity, World};

    /// Three distinct live entities to point intents at.
    ///
    /// Spawned from a real `World` rather than built from raw indices so
    /// these tests keep compiling against whatever `Entity`'s
    /// construction API is, and so the three are genuinely distinct
    /// rather than distinct by assumption.
    fn three_objects() -> (Entity, Entity, Entity) {
        let mut world = World::new();
        let a = world.spawn_empty().id();
        let b = world.spawn_empty().id();
        let c = world.spawn_empty().id();
        assert!(
            a != b && b != c && a != c,
            "the fixture needs three distinct entities or order is \
             unobservable"
        );
        (a, b, c)
    }

    fn intent(object: Entity, interaction: u32) -> Intent {
        Intent {
            object,
            interaction,
        }
    }

    #[test]
    fn pop_removes_the_front_so_intents_are_served_in_the_order_issued() {
        // **The mutation this exists for:** `pop` taking from the back.
        // `Vec::pop` does exactly that and is one keystroke away, and a
        // queue that served the player's last click first would read as
        // the game ignoring the earlier ones.
        //
        // Three entries rather than two, deliberately. With two, "front
        // first" and "back first" are the only orders and a suite could
        // not tell either from "reverse the whole thing"; with three,
        // front-first is the only order that produces this sequence.
        let (a, b, c) = three_objects();
        let mut queue = IntentQueue::default();
        queue.push(intent(a, 0));
        queue.push(intent(b, 1));
        queue.push(intent(c, 2));

        assert_eq!(
            queue.len(),
            3,
            "push must actually add; a no-op body leaves every assertion \
             below satisfiable by an empty queue"
        );
        assert_eq!(queue.front(), Some(intent(a, 0)), "front is the oldest");

        assert_eq!(queue.pop(), Some(intent(a, 0)));
        assert_eq!(
            queue.front(),
            Some(intent(b, 1)),
            "popping the front must promote the NEXT intent, not the last"
        );
        assert_eq!(queue.pop(), Some(intent(b, 1)));
        assert_eq!(queue.pop(), Some(intent(c, 2)));
        assert_eq!(queue.pop(), None, "an exhausted queue yields nothing");
        assert!(queue.is_empty());
    }

    #[test]
    fn an_empty_queue_pops_nothing_rather_than_panicking() {
        // `Vec::remove(0)` panics on an empty vector, so the guard in
        // `pop` is a real mechanism rather than a formality. Nothing
        // outside this type checks emptiness before popping.
        let mut queue = IntentQueue::default();
        assert!(queue.is_empty(), "a fresh queue holds nothing");
        assert_eq!(queue.front(), None);
        assert_eq!(queue.pop(), None);
        assert_eq!(queue.len(), 0);
    }

    #[test]
    fn clear_empties_a_queue_that_was_not_empty() {
        // Both halves matter. `is_empty` is asserted FALSE first, because
        // that is the only input on which `clear` is observable at all -
        // the same gap `the_queue_drains_in_order_and_empties` had to
        // close for `CommandQueue`.
        let (a, b, _) = three_objects();
        let mut queue = IntentQueue::from_intents(vec![intent(a, 0), intent(b, 0)]);
        assert!(
            !queue.is_empty(),
            "the queue must start non-empty or clear has nothing to do"
        );
        assert_eq!(queue.len(), 2);

        queue.clear();

        assert!(queue.is_empty(), "clear must empty the queue");
        assert_eq!(queue.len(), 0);
        assert_eq!(queue.front(), None);
    }

    #[test]
    fn from_intents_preserves_the_order_it_was_given() {
        // The constructor a save file and every fixture below reach for.
        // Reversing it here would invert the order the sim serves them
        // in, which no other test in this module could see.
        let (a, b, c) = three_objects();
        let mut queue = IntentQueue::from_intents(vec![intent(c, 2), intent(a, 0), intent(b, 1)]);
        assert_eq!(queue.pop(), Some(intent(c, 2)));
        assert_eq!(queue.pop(), Some(intent(a, 0)));
        assert_eq!(queue.pop(), Some(intent(b, 1)));
    }

    #[test]
    fn an_intent_carries_its_own_interaction_index_rather_than_a_shared_one() {
        // Two intents naming the SAME object and different interactions.
        // Without this, an `Intent` that dropped its interaction field -
        // or a `push` that stamped a constant into it - would be
        // invisible: every other fixture here uses interaction 0 on
        // distinct objects, which is the input domain that cannot see it
        // ([L34]).
        let (a, _, _) = three_objects();
        let mut queue = IntentQueue::default();
        queue.push(intent(a, 0));
        queue.push(intent(a, 3));

        assert_eq!(queue.pop(), Some(intent(a, 0)));
        assert_eq!(
            queue.pop(),
            Some(intent(a, 3)),
            "the second intent must keep its own interaction index"
        );
    }
}

#[cfg(test)]
mod identity_tests {
    //! `SimIdAllocator` and `Personality::disposition` are exactly the shape
    //! docs/testing-protocol.md rule 2 warns the sweep is blind to: state
    //! mutation and a lookup whose wrong answer is a plausible default.

    use super::*;

    #[test]
    fn sim_ids_are_issued_in_order_and_never_repeat() {
        // The whole contract: monotonic, no reuse. An `issue` that returned
        // the id BEFORE incrementing and one after differ in every value,
        // so the literal sequence pins which one shipped; `issued` is
        // asserted alongside because the save file restores it, and an
        // off-by-one there re-issues the newest sim's identity to the next
        // one born.
        let mut allocator = SimIdAllocator::default();
        assert_eq!(allocator.issued(), 0, "a fresh allocator has issued none");
        assert_eq!(allocator.issue(), SimId(0));
        assert_eq!(allocator.issue(), SimId(1));
        assert_eq!(allocator.issue(), SimId(2));
        assert_eq!(allocator.issued(), 3);
    }

    #[test]
    fn a_disposition_reads_back_by_its_own_key_and_unlisted_reads_neutral() {
        // Three entries inserted UNSORTED with pairwise distinct weights,
        // so a lookup that returned the wrong entry - the classic
        // binary-search-over-unsorted failure - is visible in the value
        // rather than only in principle ([L34]). `with_dispositions` owns
        // the sort; this is what fails if it stops doing so.
        let personality = Personality::with_dispositions(
            [1.0; NEED_COUNT],
            [1.0; NEED_COUNT],
            vec![
                (ObjectDefId(7), 1, 0.25),
                (ObjectDefId(2), 0, 1.75),
                (ObjectDefId(7), 0, 0.5),
            ],
        );

        assert_eq!(personality.disposition(ObjectDefId(2), 0), 1.75);
        assert_eq!(personality.disposition(ObjectDefId(7), 0), 0.5);
        assert_eq!(personality.disposition(ObjectDefId(7), 1), 0.25);
        // Unlisted is neutral, not zero: most sims feel nothing about most
        // furniture, and a default of 0 would make every sim refuse every
        // interaction nobody wrote a feeling for.
        assert_eq!(personality.disposition(ObjectDefId(9), 0), 1.0);
        // Same object, unlisted interaction - the half of the key a lookup
        // matching on object alone would get wrong.
        assert_eq!(personality.disposition(ObjectDefId(2), 1), 1.0);

        // And the stored order is sorted whatever order authoring used,
        // because `world_hash` iterates it.
        let keys: Vec<(u32, u32)> = personality
            .dispositions()
            .iter()
            .map(|(o, i, _)| (o.0, *i))
            .collect();
        assert_eq!(keys, vec![(2, 0), (7, 0), (7, 1)]);
    }

    #[test]
    fn a_neutral_personality_is_all_ones_everywhere() {
        // The default every consumer leans on: a sim with no Personality
        // component must behave as before personalities existed, which is
        // what keeps the world-hash golden vectors still. All ones, not
        // all zeros - zeros would freeze decay and nullify every benefit.
        let neutral = Personality::neutral();
        for i in 0..NEED_COUNT {
            assert_eq!(neutral.drain[i], 1.0);
            assert_eq!(neutral.satisfaction[i], 1.0);
        }
        assert!(neutral.dispositions().is_empty());
        assert_eq!(neutral.disposition(ObjectDefId(0), 0), 1.0);
    }

    #[test]
    fn a_stranger_reads_zero_and_bumps_clamp_at_both_ends() {
        let mut r = Relationships::default();
        assert_eq!(r.feeling(SimId(3)), 0.0);

        // Clamped at +1 however warm it gets, and at -1 however sour: a
        // feeling past either end has no representation, which is what
        // lets `relationship_scale`'s bound arithmetic assume the range.
        r.bump(SimId(3), 0.75);
        r.bump(SimId(3), 0.75);
        assert_eq!(r.feeling(SimId(3)), 1.0);
        r.bump(SimId(3), -3.5);
        assert_eq!(r.feeling(SimId(3)), -1.0);

        // And a first impression is clamped too, not just an update: one
        // bump of 7.0 must land at 1.0 rather than storing the raw amount.
        r.bump(SimId(9), 7.0);
        assert_eq!(r.feeling(SimId(9)), 1.0);
    }

    /// The digest argument: entry order must be a function of the KEYS,
    /// never of the order feelings formed - two sims who met the same
    /// people in a different order must hash identically.
    #[test]
    fn relationship_entries_are_key_sorted_regardless_of_meeting_order() {
        let mut met_low_first = Relationships::default();
        met_low_first.bump(SimId(1), 0.25);
        met_low_first.bump(SimId(8), 0.5);

        let mut met_high_first = Relationships::default();
        met_high_first.bump(SimId(8), 0.5);
        met_high_first.bump(SimId(1), 0.25);

        assert_eq!(met_low_first, met_high_first);
        let keys: Vec<u32> = met_low_first.entries().iter().map(|(id, _)| id.0).collect();
        assert_eq!(keys, vec![1, 8]);
    }

    /// Decay drifts TOWARD ZERO from both signs - a grudge fades on the
    /// same clock a friendship does - and an entry that arrives is
    /// dropped, for `Habituation::decay`'s digest reason.
    #[test]
    fn relationships_decay_toward_zero_from_both_sides_and_spent_entries_drop() {
        let mut r = Relationships::default();
        r.bump(SimId(1), 0.5);
        r.bump(SimId(2), -0.5);
        r.decay(0.125);
        assert_eq!(r.feeling(SimId(1)), 0.375, "warm cools toward zero");
        assert_eq!(r.feeling(SimId(2)), -0.375, "sour sweetens toward zero");

        // A feeling smaller than the step must SNAP to zero and drop,
        // not overshoot and oscillate across it forever.
        let mut faint = Relationships::default();
        faint.bump(SimId(1), 0.1);
        faint.bump(SimId(2), -0.1);
        faint.decay(0.25);
        assert!(
            faint.entries().is_empty(),
            "entries that reach zero must drop, or two sims with identical \
             behaviour hash differently because of who they once knew; got \
             {:?}",
            faint.entries()
        );
    }
}
