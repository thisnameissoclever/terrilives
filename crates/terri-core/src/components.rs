use crate::ids::ObjectDefId;
use bevy_ecs::prelude::{Component, Entity};

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

/// An in-progress interaction: a reference into the content pack plus how
/// much of it is left.
///
/// It names the object DEFINITION rather than the object entity, so the
/// deltas being delivered stay resolvable for the whole interaction even
/// if the entity changes underneath it. `Target` is what still names the
/// entity, because releasing the reservation needs one.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct Eating {
    pub object: ObjectDefId,
    /// Index into that object's `interactions` in the content pack.
    pub interaction: u32,
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
