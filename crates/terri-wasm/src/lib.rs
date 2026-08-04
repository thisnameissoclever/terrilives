//! The ONLY crate that knows JavaScript exists.
//! Nothing in here may contain simulation logic.

use terri_core::{
    Agent, CommandQueue, NeedId, Needs, Position, SimCommand, SmartObject, TileGrid, NEED_MAX,
    NEED_MIN, SAVE_MAGIC, SAVE_SCHEMA_VERSION,
};
use terri_sim::{Content, Sim};
use wasm_bindgen::prelude::*;

/// The level a non-finite hunger argument is replaced with. Either end of
/// the range would do; what matters is that it is finite and in range.
/// `NEED_MAX` is chosen because it is the value the sim itself produces
/// for a fully fed agent, so nothing downstream sees a level it could not
/// have reached on its own.
const HUNGER_FOR_NON_FINITE: f32 = NEED_MAX;

/// The coordinate a non-finite position argument is replaced with. Tile
/// (0, 0) exists in every lot `Sim::new_with_lot` builds.
const COORD_FOR_NON_FINITE: f32 = 0.0;

/// Hostile or corrupt browser storage is bounded before postcard can allocate
/// vectors named by the payload. Far above the alpha's real save size.
const MAX_SAVE_BYTES: usize = 16_777_216;
const SAVE_HEADER_BYTES: usize = SAVE_MAGIC.len() + std::mem::size_of::<u16>();

fn save_length_is_allowed(length: usize) -> bool {
    (SAVE_HEADER_BYTES..=MAX_SAVE_BYTES).contains(&length)
}

fn encode_save(snapshot: &terri_core::SaveSnapshotV1) -> Vec<u8> {
    let payload = postcard::to_allocvec(snapshot).expect("SaveSnapshotV1 serialises");
    let mut bytes = Vec::with_capacity(SAVE_HEADER_BYTES + payload.len());
    bytes.extend_from_slice(&SAVE_MAGIC);
    bytes.extend_from_slice(&SAVE_SCHEMA_VERSION.to_le_bytes());
    bytes.extend(payload);
    bytes
}

/// Forces a caller-supplied hunger into `NEED_MIN..=NEED_MAX`.
///
/// This is a **trust boundary**, and it is the only one in the workspace.
/// `terri-core` and `terri-sim` are entitled to assume their inputs are
/// valid; JavaScript is not a caller that can be asked to guarantee that,
/// since every `f32` here arrives as an unconstrained JS number narrowed
/// on the way in. Two specific values are why this function exists:
///
/// 1. `-1.0` is `world_hash`'s in-band "this entity has no `Needs`"
///    sentinel. A level equal to it digests identically to a `Needs`-less
///    entity at the same position, so a JS caller could silently collapse
///    a real distinction the determinism hash depends on. `terri-sim`
///    guards that with a `debug_assert!`, which is **compiled out of the
///    release build** - and `wasm-pack build` produces a release build,
///    so on the only target that ships, the guard is not there.
///
///    **Since the `Hunger` to `Needs` migration this half is redundant**:
///    `Needs` holds a private array and `Needs::set` clamps, so a
///    negative level is no longer constructible at all. Kept because the
///    boundary should not depend on a callee's internals for a guarantee
///    it states itself, but note that removing the clamp here would no
///    longer be observable - see reason 2 for the half that would be.
/// 2. `f32::NAN` does not self-heal, and **nothing downstream catches
///    it**: `f32::clamp` propagates NaN rather than replacing it, so
///    `Needs::set` stores a NaN faithfully. `advertise.rs` documents
///    where it ends up: NaN loses every comparison, so the agent would
///    simply never choose to do anything, forever, with no panic and no
///    log. This branch is the only thing standing in the way.
fn sanitize_hunger(hunger: f32) -> f32 {
    if hunger.is_nan() {
        HUNGER_FOR_NON_FINITE
    } else {
        // Finite or infinite; clamp handles the infinities correctly and
        // only NaN needed the branch above.
        hunger.clamp(NEED_MIN, NEED_MAX)
    }
}

/// Replaces a non-finite caller-supplied coordinate with a finite one.
///
/// A NaN or infinite `Position` is not a value the sim can recover from:
/// pathfinding floors it into a tile index, the movement step arithmetic
/// keeps it non-finite forever, and `world_hash` faithfully reports a
/// digest for a world that can no longer do anything. Finite but
/// out-of-lot coordinates are deliberately left alone - they are a
/// legitimate thing to ask for and the sim already handles them.
fn sanitize_coord(value: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        COORD_FOR_NON_FINITE
    }
}

#[wasm_bindgen]
pub struct SimHandle {
    sim: Sim,
}

#[wasm_bindgen]
impl SimHandle {
    #[wasm_bindgen(constructor)]
    pub fn new(width: usize, height: usize) -> SimHandle {
        SimHandle {
            sim: Sim::new_with_lot(width, height),
        }
    }

    /// The shipped lot from `content/lot.toml`: sized, walled, and with
    /// every authored object already standing on it.
    ///
    /// This is how the game starts. The constructor above builds an empty
    /// room of a caller-chosen size and stays for tests and for anything
    /// that wants a blank lot; it is **not** what the page should use,
    /// because a hand-typed size and a hand-typed object list are a
    /// second copy of content that nothing keeps in sync ([L17] is what
    /// that costs to diagnose).
    ///
    /// No arguments, so nothing to sanitise: the lot comes from the
    /// compiled pack, which `build.rs` validated at build time.
    ///
    /// It syncs the render buffer, so the objects are visible to
    /// JavaScript before the first `tick`.
    pub fn from_lot() -> SimHandle {
        let mut handle = SimHandle {
            sim: Sim::new_from_shipped_lot(),
        };
        handle.sim.sync_render_buffer();
        handle
    }

    /// The lot's width in tiles. The page needs it to place the camera
    /// and to scale depth, and reading it back from the simulation is
    /// what stops those from being a second hand-maintained copy of the
    /// lot's dimensions.
    pub fn lot_width(&self) -> usize {
        self.sim.world().resource::<TileGrid>().width()
    }

    /// The lot's height in tiles. See [`SimHandle::lot_width`].
    pub fn lot_height(&self) -> usize {
        self.sim.world().resource::<TileGrid>().height()
    }

    /// Current fixed-step simulation tick. The shell uses this for day-based
    /// autosave scheduling; it is simulation time, never wall-clock time.
    pub fn sim_tick(&self) -> u64 {
        self.sim.world().resource::<terri_core::SimClock>().tick
    }

    /// Authored fixed-step ticks in one simulated day. Kept beside
    /// `sim_tick` so the shell never hardcodes the content calendar.
    pub fn day_ticks(&self) -> u32 {
        self.sim.world().resource::<Content>().0.tuning.day_ticks
    }

    /// Every impassable tile inside the lot, interleaved `[x0, y0, x1,
    /// y1, ...]`, so the renderer can draw the walls the sim paths
    /// around.
    ///
    /// **Read off the authored wall list, NOT off the `TileGrid`, and that
    /// reverses an earlier decision for a reason worth recording.**
    ///
    /// It used to read the grid, on the argument that the grid is what
    /// `find_path` consults - so what got drawn was what the simulation
    /// treats as solid, and the two could not drift into a sim detouring
    /// around nothing.
    ///
    /// Object footprints broke that argument by putting a second KIND of
    /// impassable tile in the grid. Furniture is now blocked there too, and
    /// furniture draws its own sprite. Measured on the shipped lot the
    /// moment footprints landed: this returned **17 tiles instead of 8**,
    /// and the renderer would have painted a 98 px wall sprite on top of
    /// every one of the nine object tiles.
    ///
    /// So the question this answers had to narrow, from "what is solid" to
    /// "what is a wall". The original concern is still real and is now
    /// covered by a test rather than by the implementation:
    /// `every_reported_wall_is_actually_impassable` asserts the drawn walls
    /// are a subset of the blocked tiles, so a wall that content declares
    /// and pathing ignores still fails.
    ///
    /// It copies, unlike the render pointers, because it is called once
    /// at load and the caller keeps the result for the session. A zero-
    /// copy view would have to survive every later `Vec` reallocation
    /// for no benefit at all.
    ///
    /// The lot BOUNDARY is not in here and cannot be: `is_walkable`
    /// treats everything off the grid as blocked without any tile
    /// existing to report. The renderer draws that separately, from the
    /// lot's dimensions.
    pub fn wall_tiles(&self) -> Vec<u32> {
        let lot = &self.sim.world().resource::<Content>().0.lot;
        let mut tiles = Vec::with_capacity(lot.walls.len() * 2);
        for &(x, y) in &lot.walls {
            tiles.push(x);
            tiles.push(y);
        }
        tiles
    }

    /// Advances one fixed tick and refreshes the render buffer.
    pub fn tick(&mut self) {
        self.sim.tick();
        self.sim.sync_render_buffer();
    }

    /// Applies staged player commands while the fixed-step driver is paused.
    /// This refreshes the render buffer but deliberately does not advance the
    /// simulation clock or run needs, autonomy, movement, or interactions.
    pub fn flush_commands(&mut self) {
        self.sim.flush_commands();
        self.sim.sync_render_buffer_after_commands();
    }

    /// Arguments are sanitised here rather than trusted. See
    /// [`sanitize_hunger`] and [`sanitize_coord`] for what that means and
    /// why the sim crates are not the place to do it.
    pub fn spawn_agent(&mut self, x: f32, y: f32, hunger: f32) {
        let x = sanitize_coord(x);
        let y = sanitize_coord(y);
        let hunger = sanitize_hunger(hunger);
        // Hunger is the only need JavaScript can set, because it is the
        // only one anything advertises against. The other six start
        // satisfied, which is what keeps a spawned agent's behaviour
        // identical to the single-need version.
        self.sim.world_mut().spawn((
            Agent,
            Position { x, y },
            Needs::with(NeedId::Hunger, hunger),
        ));
        self.sim.sync_render_buffer();
    }

    /// Places the object `content_id` names. Returns `false`, having
    /// spawned nothing, when the content pack declares no such id.
    ///
    /// Coordinates are sanitised here rather than trusted; see
    /// [`sanitize_coord`]. The id is untrusted for the same reason and
    /// is handled differently, because the two failures are not alike:
    /// a non-finite coordinate has a sensible substitute, whereas
    /// guessing which object an unrecognised name meant would put an
    /// object the caller never asked for into the world. So the
    /// coordinate is repaired and the id is rejected.
    ///
    /// **Rejecting rather than panicking is the point of this
    /// signature.** A panic inside a `#[wasm_bindgen]` export unwinds
    /// into a JS exception and leaves the module trapped for the rest
    /// of the page's life, so one mistyped id would freeze the whole
    /// game instead of failing one call. The `expect` this replaced was
    /// safe only while the id was a literal in this file; the moment it
    /// became an argument from JavaScript it became a way for the
    /// caller to halt the simulation. That is the [L12] mistake pointed
    /// the other way: `debug_assert!` is a check that does not ship,
    /// and `expect` on caller input is a check that ships and overreacts.
    ///
    /// The pack is read through the sim's own `Content` resource rather
    /// than by calling `terri_data::pack()`, so the id resolves against
    /// the pack the running simulation will actually use.
    pub fn spawn_object(&mut self, x: f32, y: f32, content_id: &str) -> bool {
        let x = sanitize_coord(x);
        let y = sanitize_coord(y);
        // `ObjectDefId` is `Copy`, so the immutable borrow of the world
        // ends with this statement and `world_mut` below is free.
        let Some(def) = self.sim.world().resource::<Content>().0.find(content_id) else {
            return false;
        };
        self.sim
            .world_mut()
            .spawn((Position { x, y }, SmartObject(def)));
        self.sim.sync_render_buffer();
        true
    }

    pub fn entity_count(&self) -> usize {
        self.sim.render_buffer().count
    }

    /// Pointer into WASM linear memory. **Never cache it.**
    ///
    /// The rarer hazard is memory growth, which reallocates the `Vec` and
    /// moves it; see the detachment warning in web/src/bridge.ts. The
    /// constant one is a full `sync_render_buffer`, which begins with a
    /// `std::mem::swap` of `positions` and `prev_positions`. A swap
    /// exchanges the two `Vec`s' pointer/length/capacity triples, so
    /// **`positions_ptr()` and `prev_positions_ptr()` trade values on
    /// every full sync**, with no reallocation and no growth involved.
    /// Since `tick`, `spawn_agent` and every accepted `spawn_object` each
    /// perform a full sync, a pointer read before any of them is already
    /// stale afterwards and will be pointing at the other frame's data.
    /// `flush_commands` refreshes metadata while preserving both position
    /// samples, and a `spawn_object` that rejects its id does not sync,
    /// but treating that as a reason to keep a pointer would be relying
    /// on a failure path.
    ///
    /// Re-read both pointers on every access.
    pub fn positions_ptr(&self) -> *const f32 {
        self.sim.render_buffer().positions.as_ptr()
    }

    pub fn prev_positions_ptr(&self) -> *const f32 {
        self.sim.render_buffer().prev_positions.as_ptr()
    }

    pub fn kinds_ptr(&self) -> *const u32 {
        self.sim.render_buffer().kinds.as_ptr()
    }

    /// Atlas sprite index per row. Same caching hazard as every other
    /// pointer here; re-read it on every access.
    pub fn sprites_ptr(&self) -> *const u32 {
        self.sim.render_buffer().sprites.as_ptr()
    }

    /// What each row is doing, as `render_buffer::activity` codes -
    /// the [A-11] indicator column. Same caching hazard as every other
    /// pointer here; re-read it on every access.
    pub fn activities_ptr(&self) -> *const u32 {
        self.sim.render_buffer().activities.as_ptr()
    }

    /// The raw entity index occupying each row - the number a `Select` or
    /// `UseObject` command has to carry.
    ///
    /// Exported because **a row number is not an entity index**: rows are
    /// sorted by index, so a row is a rank. See `RenderBuffer::ids` for the
    /// full argument and for the despawn that ends the coincidence. Picking
    /// resolves a click to a row and then reads the entity out of here
    /// rather than assuming the two agree.
    ///
    /// Same caching hazard as every other pointer here; re-read it on every
    /// access.
    /// The carrying column - what each row holds, as an item-kind
    /// index or the u32::MAX empty-hands sentinel. Zero-copy per frame
    /// like every other view; resolves against `item_kinds()`.
    pub fn carrying_ptr(&self) -> *const u32 {
        self.sim.render_buffer().carrying.as_ptr()
    }

    pub fn ids_ptr(&self) -> *const u32 {
        self.sim.render_buffer().ids.as_ptr()
    }

    /// Stages one player command, given as postcard bytes. Returns
    /// whether it was accepted.
    ///
    /// This is the **only** way the shell affects the simulation, which
    /// is the whole of [D-2]: JavaScript never touches the world, it
    /// enqueues serialisable data that `drain_commands` applies through one
    /// serialized system: first in a full tick, or alone while paused. Split
    /// and batched drains are equivalent for one ordered stream. That keeps a
    /// replay reproducible, gives [D8]'s save-file command log something to
    /// record, and leaves Layer 2 multiplayer possible - what you would send
    /// over a wire is exactly these bytes.
    ///
    /// # Why bytes rather than four typed exports
    ///
    /// A `select(id)` export would work today and would be a second
    /// encoding of the same commands, diverging from the one a save file
    /// replays. Sending the postcard bytes means the format is exercised
    /// on every single click rather than only when somebody saves.
    ///
    /// # Malformed input returns `false`, and that is the point of the
    /// signature
    ///
    /// Every byte here is attacker-controlled in principle and
    /// typo-controlled in practice. **A panic inside a `#[wasm_bindgen]`
    /// export leaves the module trapped for the rest of the page's life**,
    /// so from the player's side one bad frame of input is the entire game
    /// freezing with no recovery short of a reload. `unwrap` on the decode
    /// would compile, ship, and survive `--release`, which is what makes
    /// it worse than the [L12] `debug_assert!` rather than better. Four
    /// shapes of bad input reach this and all four return `false`:
    ///
    /// - **empty** - no variant index at all;
    /// - **an unknown variant index** - a byte past the four `SimCommand`
    ///   declares, which is also what an OLDER shell sending a NEWER
    ///   format looks like;
    /// - **a truncated payload** - a variant index with its fields
    ///   missing, which is what a partial write or a sliced buffer looks
    ///   like;
    /// - **trailing bytes** - a valid command followed by junk, rejected
    ///   rather than silently ignored. That one is a deliberate strictness
    ///   choice: `take_from_bytes` is used rather than `from_bytes` so
    ///   this crate decides the rule instead of inheriting whatever a
    ///   postcard upgrade decides. A buffer holding one command plus
    ///   anything else is not a message this side wrote, and accepting the
    ///   prefix would make the wire format ambiguous the day someone
    ///   concatenates two commands and expects both to run.
    ///
    /// A stale or invented entity index is NOT rejected here, and that is
    /// also deliberate: it is a perfectly well-formed command, and
    /// `drain_commands` already resolves indices against live entities and
    /// ignores the ones that resolve to nothing. Rejecting it here would
    /// mean this crate holding a second, weaker copy of that rule.
    ///
    /// # The cap is the bound on the queue itself
    ///
    /// `max_queued_intents` bounds what one sim can be told to do, and
    /// nothing reaches it except a `UseObject` that resolved to a live
    /// agent. Everything else a player can send - every `Select`, every
    /// `SetSpeed`, every command naming an index that no longer exists -
    /// lands in the staging queue and never touches an intent queue at
    /// all, so a JavaScript loop could grow this without limit. Paused play
    /// drains the queue through `flush_commands`, but the cap still bounds a
    /// burst between frames. `max_queued_commands` in `content/tuning.toml`
    /// carries that burst budget and why overflow refuses the newest rather
    /// than evicting the oldest.
    pub fn enqueue_command(&mut self, bytes: &[u8]) -> bool {
        // `take_from_bytes` rather than `from_bytes`, so the trailing-byte
        // rule is this crate's rather than postcard's; see above.
        let Ok((command, rest)) = postcard::take_from_bytes::<SimCommand>(bytes) else {
            return false;
        };
        if !rest.is_empty() {
            return false;
        }

        // Read before the queue is borrowed mutably. `Tuning` is `Copy`
        // behind a `&'static ContentPack`, so this is a load rather than
        // a clone.
        let cap = self
            .sim
            .world()
            .resource::<Content>()
            .0
            .tuning
            .max_queued_commands as usize;
        let mut queue = self.sim.world_mut().resource_mut::<CommandQueue>();
        if queue.len() >= cap {
            return false;
        }
        queue.push(command);
        true
    }

    /// Serialises the running game for browser-owned persistent storage.
    ///
    /// The magic and little-endian schema version live outside postcard's
    /// payload, so a future version can be rejected before this build tries to
    /// interpret a shape it does not understand.
    pub fn save_bytes(&self) -> Vec<u8> {
        encode_save(&self.sim.save_snapshot())
    }

    /// Transactionally restores browser-provided save bytes.
    ///
    /// Empty, oversized, truncated, corrupt, trailing, incompatible-version,
    /// and invalid-content payloads all return false. The live simulation is
    /// replaced only after the candidate world is fully validated and built.
    pub fn load_bytes(&mut self, bytes: &[u8]) -> bool {
        if !save_length_is_allowed(bytes.len()) {
            return false;
        }
        if bytes[..SAVE_MAGIC.len()] != SAVE_MAGIC {
            return false;
        }
        let version_start = SAVE_MAGIC.len();
        let version = u16::from_le_bytes([bytes[version_start], bytes[version_start + 1]]);
        if version != SAVE_SCHEMA_VERSION {
            return false;
        }

        let Ok((snapshot, rest)) =
            postcard::take_from_bytes::<terri_core::SaveSnapshotV1>(&bytes[SAVE_HEADER_BYTES..])
        else {
            return false;
        };
        if !rest.is_empty() {
            return false;
        }
        self.sim.load_snapshot(snapshot).is_ok()
    }

    /// The seven need levels of the entity carrying `entity_index`, in
    /// `NeedId` index order, or an EMPTY array when nothing live carries
    /// that index or what does has no needs.
    ///
    /// The panel reads this every frame for whichever sim is selected and
    /// holds nothing of its own ([D-5]): the DOM renders simulation state,
    /// it never owns it. An empty array is therefore a normal answer
    /// rather than an error - it is what a deselected panel, a
    /// just-despawned sim and a click that landed on a fridge all look
    /// like, and all three should draw no bars.
    ///
    /// A copy rather than a pointer into linear memory, unlike the render
    /// arrays. Seven floats for one entity at a throttled rate is not
    /// per-frame bulk data, and a view would have to survive every later
    /// reallocation for no benefit at all - the same trade `wall_tiles`
    /// makes.
    pub fn needs_of(&self, entity_index: u32) -> Vec<f32> {
        self.sim
            .needs_of(entity_index)
            .map(|levels| levels.to_vec())
            .unwrap_or_default()
    }

    /// One label per social-vocabulary entry, in the index order the
    /// TalkTo command's `interaction` field uses - the flyout over a
    /// fellow sim, mirroring `interaction_labels` for objects.
    pub fn social_labels(&self) -> Vec<String> {
        self.sim
            .social_labels()
            .into_iter()
            .map(str::to_string)
            .collect()
    }

    /// The sim's stable identity, or `u32::MAX` when the index names
    /// nothing that carries one - in-band the way the digest's sentinel
    /// is, and unreachable by real ids for the same widening reason.
    pub fn sim_id_of(&self, entity_index: u32) -> u32 {
        self.sim.sim_id_of(entity_index).unwrap_or(u32::MAX)
    }

    /// The [E1] satisfaction ledger, or -1 for anything without one -
    /// in-band the way `sim_id_of`'s MAX is, and unreachable by a real
    /// ledger for the same reason the world hash's sentinel is: the
    /// component clamps at zero.
    pub fn satisfaction_of(&self, entity_index: u32) -> f32 {
        self.sim.satisfaction_of(entity_index).unwrap_or(-1.0)
    }

    /// The household's money - [E4]. `f64` rather than the simulation's
    /// `i64` because wasm-bindgen would hand JavaScript a BigInt, and
    /// every display caller would write the same `Number(...)`; a
    /// household that earns past 2^53 has beaten the game.
    pub fn funds(&self) -> f64 {
        self.sim.funds() as f64
    }

    /// Interleaved `[pack trait index, live state, ...]` pairs, or
    /// empty - the [E3] overlay read. Indices as f32 exactly like
    /// `relationships_of`'s ids, and safely: a pack has tens of traits,
    /// not 2^24.
    pub fn traits_of(&self, entity_index: u32) -> Vec<f32> {
        self.sim
            .traits_of(entity_index)
            .map(|worn| {
                worn.into_iter()
                    .flat_map(|(index, state)| [index as f32, state])
                    .collect()
            })
            .unwrap_or_default()
    }

    /// One label per entry in the pack's trait list, in pack order -
    /// what `traits_of`'s indices resolve against. Read once at
    /// startup, like `need_names`; the lookup lives in `terri-sim`
    /// because this crate is forbidden the content crate ([D1]).
    pub fn trait_labels(&self) -> Vec<String> {
        self.sim
            .trait_labels()
            .into_iter()
            .map(str::to_string)
            .collect()
    }

    /// The kind of each pack trait - "disposition", "capability" or
    /// "condition" - aligned with `trait_labels`, so the overlay can
    /// word a level and a severity differently.
    pub fn trait_kinds(&self) -> Vec<String> {
        self.sim
            .trait_kinds()
            .into_iter()
            .map(str::to_string)
            .collect()
    }

    /// The label of the career held by the sim carrying `entity_index`,
    /// or the empty string for the unemployed and everything else -
    /// empty rather than `Option` for `sim_name`'s reason.
    pub fn career_of(&self, entity_index: u32) -> String {
        self.sim
            .career_of(entity_index)
            .map(str::to_string)
            .unwrap_or_default()
    }

    /// Authored furniture name, or the empty string for non-objects and
    /// stale entity indices. Used by the keyboard target picker.
    pub fn object_name_of(&self, entity_index: u32) -> String {
        self.sim
            .object_name_of(entity_index)
            .map(str::to_string)
            .unwrap_or_default()
    }

    /// One name per pack item kind, in pack order - what the carrying
    /// column resolves against, and the `carried_<kind>` atlas
    /// convention's input. Read once at startup, like `need_names`.
    pub fn item_kinds(&self) -> Vec<String> {
        self.sim
            .item_kinds()
            .into_iter()
            .map(str::to_string)
            .collect()
    }

    /// The sim's mid-errand status line - "Cook dinner: Cook (carrying
    /// ingredients)" - or the empty string when it is not on one,
    /// sim_name's contract. Composed sim-side: every word is pack
    /// content.
    pub fn chain_status_of(&self, entity_index: u32) -> String {
        self.sim.chain_status_of(entity_index).unwrap_or_default()
    }

    /// Why the sim is not acting - `Blocked`, `Restless` or both - or
    /// the empty string when nothing holds it back, sim_name's in-band
    /// contract.
    pub fn stall_reason_of(&self, entity_index: u32) -> String {
        self.sim.stall_reason_of(entity_index).unwrap_or_default()
    }

    /// How many player orders the sim still has waiting.
    pub fn queued_orders_of(&self, entity_index: u32) -> usize {
        self.sim.queued_orders_of(entity_index)
    }

    /// Fourteen floats - drain then satisfaction, seven each - or empty.
    /// The [A-11] debug overlay's read; see `Sim::personality_of`.
    pub fn personality_of(&self, entity_index: u32) -> Vec<f32> {
        self.sim
            .personality_of(entity_index)
            .map(|values| values.to_vec())
            .unwrap_or_default()
    }

    /// Interleaved `[sim_id, feeling, ...]` pairs, or empty. See
    /// `Sim::relationships_of` for the f32-id bound.
    pub fn relationships_of(&self, entity_index: u32) -> Vec<f32> {
        self.sim.relationships_of(entity_index).unwrap_or_default()
    }

    /// Overall mood score followed by each active moodlet score, or empty
    /// when the raw index does not name a live sim. This is a copy because
    /// mood is a small derived UI read, not frame-path bulk data.
    pub fn mood_snapshot_of(&self, entity_index: u32) -> Vec<f32> {
        self.sim
            .mood_of(entity_index)
            .map(|snapshot| {
                std::iter::once(snapshot.overall_score)
                    .chain(snapshot.moodlets.into_iter().map(|moodlet| moodlet.score))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Overall mood label followed by each active moodlet label, aligned
    /// with [`SimHandle::mood_snapshot_of`]. Empty has the same absent,
    /// stale or non-sim meaning as the numeric projection.
    pub fn mood_summary_of(&self, entity_index: u32) -> Vec<String> {
        self.sim
            .mood_of(entity_index)
            .map(|snapshot| {
                std::iter::once(snapshot.overall_label.to_string())
                    .chain(snapshot.moodlets.into_iter().map(|moodlet| moodlet.label))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// What the right-click flyout should list for the object carrying
    /// `entity_index`: one label per interaction, in the order
    /// `content/objects.toml` declares them, or an EMPTY array when that
    /// index names nothing live or names something that is not a smart
    /// object.
    ///
    /// An empty array is a normal answer rather than an error, exactly as
    /// it is for [`SimHandle::needs_of`]: a right click on a sim, on a sim
    /// that despawned between the frame and the handler, and on an object
    /// with no interactions authored all arrive here the same way, and all
    /// three should open no interaction rows. The shell does not have to
    /// tell them apart because the useful response is identical.
    ///
    /// **The array's ORDER is the interaction index.** Row `n` is
    /// `Intent::interaction` `n`, which is the whole reason the flyout is
    /// worth building before any object has a second verb - see [I4] in
    /// `docs/specs/2026-07-30-selection-and-input-design.md`. A shell that
    /// sorted or filtered this list would be renumbering an index the
    /// simulation owns.
    ///
    /// A copy rather than a pointer into linear memory, like `wall_tiles`
    /// and `need_names` and unlike the render arrays: it is read on a right
    /// click rather than per frame, so [D11] has nothing to say about it,
    /// and a view would have to survive every later reallocation for no
    /// benefit.
    pub fn interaction_labels(&self, entity_index: u32) -> Vec<String> {
        self.sim
            .interaction_labels(entity_index)
            .map(|labels| labels.into_iter().map(str::to_string).collect())
            .unwrap_or_default()
    }

    /// The display name of the sim carrying `entity_index`, or the empty
    /// string when nothing live carries it or what does is not a named
    /// sim - an object, or a stress-mode filler agent. Empty rather than
    /// an `Option` because wasm-bindgen turns `Option<String>` into
    /// `string | undefined` and every caller would write the same
    /// `?? ''`; the needs panel treats an empty name as "hide the line".
    ///
    /// Read on selection change rather than per frame, so the copy across
    /// the boundary is outside [D11]'s concern, like `interaction_labels`.
    pub fn sim_name(&self, entity_index: u32) -> String {
        self.sim
            .name_of(entity_index)
            .map(str::to_string)
            .unwrap_or_default()
    }

    /// The raw index of the selected sim, or `None` when nothing is
    /// selected.
    ///
    /// Selection is simulation state, not shell state ([D-5]). The shell
    /// asks for a change with `SimCommand::Select` and reads the result
    /// back here, so a replay reproduces what the player had selected
    /// rather than depending on what the DOM happened to remember.
    pub fn selected_index(&self) -> Option<u32> {
        self.sim.selected_index()
    }

    /// The seven need names in `NeedId` index order, which is the order
    /// [`SimHandle::needs_of`] returns levels in.
    ///
    /// The need-bar panel labels its bars from this rather than from a
    /// list of its own. Seven strings in a TypeScript array would be a
    /// second copy of the need list, kept in sync by nobody, and the way
    /// it would fail is the worst available: every bar still drawn, every
    /// number still right, and the labels shifted by one against them.
    /// The panel would then be actively misleading rather than broken,
    /// and reading a decision against the bars - which is the entire
    /// reason the panel exists - would give the wrong answer. That is the
    /// coupling [D1] exists to prevent, in the same shape as an object's
    /// sprite.
    ///
    /// Called once at load and it allocates seven `String`s, so it is not
    /// on the throttled read path and has nothing to do with [D11].
    ///
    /// `&self` is unused: the names come from `NeedId`, which is a
    /// compile-time list rather than simulation state. It stays a method
    /// so that the shell reaches it through the same handle as everything
    /// else, rather than the shell needing to know that this one fact
    /// about the simulation is free-standing.
    pub fn need_names(&self) -> Vec<String> {
        NeedId::ALL
            .iter()
            .map(|id| id.as_str().to_string())
            .collect()
    }

    /// The level a fully satisfied need sits at, which is what a need bar
    /// draws as full.
    ///
    /// Read across the boundary rather than written as `100` in the
    /// panel, for the same reason the labels are: a hardcoded ceiling is
    /// the shell owning a piece of the need model. If `NEED_MAX` ever
    /// moved, a panel with its own copy would draw every bar at the wrong
    /// scale while every number behind it stayed correct - and a bar at
    /// half its true height is a decision misread rather than a visible
    /// fault.
    pub fn need_max(&self) -> f32 {
        NEED_MAX
    }

    /// How often the shell should re-read a selected sim's needs, in real
    /// milliseconds, from `content/tuning.toml`.
    ///
    /// The one knob in the pack that no simulation system reads. It
    /// crosses here because the standing rule is that a value somebody
    /// tuning the game will want to turn lives in `content/tuning.toml`
    /// and not in a `const` buried in TypeScript - a rule with no
    /// exception for the shell. The file carries why 100 is matched to
    /// the tick rate rather than to the display refresh rate.
    ///
    /// It is a display rate and nothing else: it cannot change what the
    /// simulation does, only how often the panel asks what it did.
    pub fn need_bar_refresh_ms(&self) -> u32 {
        self.sim
            .world()
            .resource::<Content>()
            .0
            .tuning
            .need_bar_refresh_ms
    }

    pub fn world_hash(&self) -> u64 {
        self.sim.world_hash()
    }
}

#[cfg(test)]
mod boundary_tests {
    //! Everything JavaScript can hand this crate that Rust could not.
    //!
    //! These run natively, but the behaviour they pin only matters in the
    //! `--release` wasm build that `wasm-pack` ships, because the guard
    //! they replace (`debug_assert!` in `terri_sim::Sim::world_hash`) is
    //! compiled out there. Asserting on the sanitiser's return value would
    //! only test the sanitiser; every test below reads the component back
    //! out of the world it was spawned into.

    use super::*;
    use terri_core::{Relationships, SimClock, SimId, SimName, Traits, NEED_COUNT};

    /// Hunger levels as the ECS actually stored them.
    fn stored_hungers(handle: &SimHandle) -> Vec<f32> {
        let world = handle.sim.world();
        let mut state = world
            .try_query::<&Needs>()
            .expect("Needs is registered eagerly in Sim::new");
        state
            .iter(world)
            .map(|needs| needs.get(NeedId::Hunger))
            .collect()
    }

    /// Positions as the ECS actually stored them.
    fn stored_positions(handle: &SimHandle) -> Vec<(f32, f32)> {
        let world = handle.sim.world();
        let mut state = world
            .try_query::<&Position>()
            .expect("Position is registered eagerly in Sim::new");
        state.iter(world).map(|pos| (pos.x, pos.y)).collect()
    }

    #[test]
    fn clock_accessors_report_the_tick_and_authored_day_length() {
        let mut handle = SimHandle::from_lot();
        assert_eq!(handle.sim_tick(), 0);
        assert_eq!(
            handle.day_ticks(),
            handle.sim.world().resource::<Content>().0.tuning.day_ticks
        );
        assert!(
            handle.day_ticks() > 0,
            "content validation forbids a zero day"
        );
        handle.tick();
        handle.tick();
        assert_eq!(handle.sim_tick(), 2);
    }

    #[test]
    fn save_encoding_is_pinned_by_a_golden_byte_vector() {
        // A round trip is self-consistent under any field order ([L33]).
        // This independent vector is what forces an incompatible shape or RNG
        // encoding change to become an explicit save-version decision.
        let snapshot = terri_core::SaveSnapshotV1 {
            content_fingerprint: 1,
            tick: 2,
            rng: terri_core::SimRng::from_seed(3),
            funds: -4,
            issued_sim_ids: 5,
            grid_width: 2,
            grid_height: 1,
            blocked_tiles: vec![false, true],
            entities: Vec::new(),
            queued_commands: Vec::new(),
        };
        assert_eq!(
            encode_save(&snapshot),
            vec![
                84, 69, 82, 82, 73, 83, 65, 86, 1, 0, 1, 2, 201, 239, 219, 238, 207, 184, 226, 153,
                115, 7, 7, 5, 2, 1, 2, 0, 1, 0, 0,
            ]
        );
    }

    #[test]
    fn save_length_limits_include_both_boundaries_and_exclude_their_neighbours() {
        assert!(!save_length_is_allowed(SAVE_HEADER_BYTES - 1));
        assert!(save_length_is_allowed(SAVE_HEADER_BYTES));
        assert!(save_length_is_allowed(MAX_SAVE_BYTES));
        assert!(!save_length_is_allowed(MAX_SAVE_BYTES + 1));
    }

    #[test]
    fn save_bytes_round_trip_and_continue_the_running_sim() {
        let mut uninterrupted = SimHandle::from_lot();
        for _ in 0..173 {
            uninterrupted.tick();
        }

        let bytes = uninterrupted.save_bytes();
        assert_eq!(&bytes[..SAVE_MAGIC.len()], &SAVE_MAGIC);
        assert_eq!(
            u16::from_le_bytes([bytes[SAVE_MAGIC.len()], bytes[SAVE_MAGIC.len() + 1]]),
            SAVE_SCHEMA_VERSION
        );

        let mut resumed = SimHandle::from_lot();
        assert!(resumed.load_bytes(&bytes));
        assert_eq!(
            resumed.sim.save_snapshot(),
            uninterrupted.sim.save_snapshot()
        );
        for tick_after_load in 1..=300 {
            uninterrupted.tick();
            resumed.tick();
            assert_eq!(
                resumed.world_hash(),
                uninterrupted.world_hash(),
                "WASM handles diverged {tick_after_load} ticks after load"
            );
        }
        assert_eq!(
            resumed.sim.save_snapshot(),
            uninterrupted.sim.save_snapshot()
        );
    }

    #[test]
    fn bad_save_bytes_are_rejected_without_mutating_the_running_handle() {
        let valid = SimHandle::from_lot().save_bytes();
        let mut bad_magic = valid.clone();
        bad_magic[0] ^= 1;
        let mut bad_version = valid.clone();
        bad_version[SAVE_MAGIC.len()..SAVE_HEADER_BYTES]
            .copy_from_slice(&(SAVE_SCHEMA_VERSION + 1).to_le_bytes());
        let mut truncated = valid.clone();
        truncated.truncate(truncated.len() / 2);
        let mut trailing = valid.clone();
        trailing.push(0);
        let mut corrupt = Vec::from(SAVE_MAGIC);
        corrupt.extend_from_slice(&SAVE_SCHEMA_VERSION.to_le_bytes());
        corrupt.extend([0xff; 16]);
        let oversized = vec![0; MAX_SAVE_BYTES + 1];

        for invalid in [
            Vec::new(),
            vec![0],
            bad_magic,
            bad_version,
            truncated,
            trailing,
            corrupt,
            oversized,
        ] {
            let mut live = SimHandle::from_lot();
            for _ in 0..31 {
                live.tick();
            }
            let before = live.sim.save_snapshot();
            assert!(!live.load_bytes(&invalid));
            assert_eq!(
                live.sim.save_snapshot(),
                before,
                "rejected bytes changed the running game"
            );
        }
    }

    #[test]
    fn an_incompatible_content_fingerprint_is_rejected_at_the_wasm_boundary() {
        let source = SimHandle::from_lot();
        let mut snapshot = source.sim.save_snapshot();
        snapshot.content_fingerprint ^= 1;
        let payload = postcard::to_allocvec(&snapshot).expect("snapshot serialises");
        let mut incompatible = Vec::from(SAVE_MAGIC);
        incompatible.extend_from_slice(&SAVE_SCHEMA_VERSION.to_le_bytes());
        incompatible.extend(payload);

        let mut live = SimHandle::from_lot();
        let before = live.sim.save_snapshot();
        assert!(!live.load_bytes(&incompatible));
        assert_eq!(live.sim.save_snapshot(), before);
    }

    /// The two clamp tests below assert an **end-to-end property** - a
    /// level arriving from JavaScript is stored in range - which is now
    /// enforced twice over: by `sanitize_hunger` here and by
    /// `Needs::set`'s own clamp in terri-core. Deleting either one alone
    /// therefore leaves them green.
    ///
    /// That is stated rather than hidden, because a test that cannot
    /// detect the mechanism it appears to name is the failure mode
    /// docs/testing-protocol.md exists to prevent. They are kept because
    /// the property is worth pinning and because defence in depth at a
    /// trust boundary is deliberate, not because they still isolate
    /// `sanitize_hunger`. The half of that function nothing else covers
    /// is NaN, and `spawn_agent_replaces_non_finite_hunger_with_a_finite_level`
    /// is the test that isolates it.
    #[test]
    fn spawn_agent_clamps_hunger_up_to_the_need_floor() {
        let mut handle = SimHandle::new(8, 8);
        handle.spawn_agent(1.0, 1.0, -50.0);
        assert_eq!(stored_hungers(&handle), vec![NEED_MIN]);
    }

    #[test]
    fn spawn_agent_clamps_hunger_down_to_the_need_ceiling() {
        let mut handle = SimHandle::new(8, 8);
        handle.spawn_agent(1.0, 1.0, 1_000.0);
        assert_eq!(stored_hungers(&handle), vec![NEED_MAX]);
    }

    #[test]
    fn spawn_agent_leaves_an_in_range_hunger_untouched() {
        // The other clamp tests would all pass if the sanitiser returned a
        // constant. This is what stops that.
        let mut handle = SimHandle::new(8, 8);
        handle.spawn_agent(1.0, 1.0, 37.5);
        assert_eq!(stored_hungers(&handle), vec![37.5]);
    }

    #[test]
    fn spawn_agent_replaces_non_finite_hunger_with_a_finite_level() {
        // f32::clamp PROPAGATES NaN rather than replacing it, so the
        // clamp alone does not cover this case and a test that only
        // asserted "in range" would pass on NaN as well: every comparison
        // against NaN is false, including the range assertions a careless
        // test would write. Assert finiteness explicitly.
        //
        // The NaN case is what still isolates `sanitize_hunger`, and it
        // is the only one that does. `Needs::set` clamps, so it handles
        // the two infinities on its own; it propagates NaN, so this
        // branch here is the only thing between a JS `NaN` and an agent
        // that never chooses to do anything again.
        for poison in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut handle = SimHandle::new(8, 8);
            handle.spawn_agent(1.0, 1.0, poison);
            let stored = stored_hungers(&handle);
            assert_eq!(stored.len(), 1, "the agent must have been spawned");
            assert!(
                stored[0].is_finite(),
                "spawn_agent({poison}) stored a non-finite hunger: {}; a NaN \
                 need loses every comparison, so the agent would never \
                 choose to do anything again, with no panic and no log",
                stored[0]
            );
            assert!(
                (NEED_MIN..=NEED_MAX).contains(&stored[0]),
                "spawn_agent({poison}) stored {} outside {NEED_MIN}..={NEED_MAX}",
                stored[0]
            );
        }
    }

    #[test]
    fn spawn_agent_replaces_non_finite_coordinates_with_finite_ones() {
        for poison in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut handle = SimHandle::new(8, 8);
            handle.spawn_agent(poison, poison, 50.0);
            let stored = stored_positions(&handle);
            assert_eq!(stored.len(), 1, "the agent must have been spawned");
            assert!(
                stored[0].0.is_finite() && stored[0].1.is_finite(),
                "spawn_agent stored a non-finite position from {poison}: {:?}",
                stored[0]
            );
        }
    }

    #[test]
    fn spawn_object_replaces_non_finite_coordinates_with_finite_ones() {
        for poison in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut handle = SimHandle::new(8, 8);
            assert!(handle.spawn_object(poison, poison, "fridge"));
            let stored = stored_positions(&handle);
            assert_eq!(stored.len(), 1, "the object must have been spawned");
            assert!(
                stored[0].0.is_finite() && stored[0].1.is_finite(),
                "spawn_object stored a non-finite position from {poison}: {:?}",
                stored[0]
            );
        }
    }

    #[test]
    fn spawn_leaves_finite_coordinates_untouched() {
        // Same role as the in-range hunger test: without it, a sanitiser
        // that returned 0.0 unconditionally would satisfy every assertion
        // above.
        let mut handle = SimHandle::new(8, 8);
        assert!(handle.spawn_object(3.5, 6.25, "fridge"));
        assert_eq!(stored_positions(&handle), vec![(3.5, 6.25)]);
    }

    #[test]
    fn spawning_an_unknown_content_id_is_rejected_rather_than_panicking() {
        // The mutation this is written against: resolve the id with
        // `expect` (or `unwrap`) instead of returning `false`. That
        // compiles, ships, and survives `--release` - which is exactly
        // what makes it worse than the [L12] `debug_assert!`, not
        // better. A panic in a `#[wasm_bindgen]` export leaves the
        // module trapped for the life of the page, so a single bad id
        // from JavaScript freezes the game rather than failing one call.
        let mut sim = SimHandle::new(16, 16);
        assert!(sim.spawn_object(4.0, 5.0, "fridge"));
        assert!(!sim.spawn_object(4.0, 6.0, "no_such_object"));
        assert_eq!(sim.entity_count(), 1);

        // `entity_count` reads the render buffer, which only refreshes
        // on a successful spawn, so on its own it cannot tell "nothing
        // was spawned" from "something was spawned and never synced".
        // Reading the ECS directly is what distinguishes them, and the
        // position pins that the entity present is the accepted one.
        assert_eq!(
            stored_positions(&sim),
            vec![(4.0, 5.0)],
            "the rejected spawn must leave nothing behind in the world"
        );

        // A rejection must not poison the handle either: the boundary's
        // job is to fail one call, not to end the session.
        assert!(sim.spawn_object(7.0, 8.0, "fridge"));
        assert_eq!(sim.entity_count(), 2);
    }

    #[test]
    fn a_need_level_from_js_cannot_alias_the_world_hash_no_needs_sentinel() {
        // The finding this whole boundary exists for, in its causal form.
        // `world_hash` encodes "this entity has no `Needs`" as the in-band
        // value -1.0 in every slot, so a component actually holding -1.0
        // hashed exactly like a `Needs`-less entity at the same position.
        // Measured before the fix, back when the component was
        // `Hunger(pub f32)`: both worlds below digested to
        // 0x06ef64bc902dd05f.
        //
        // **What now enforces it has changed, and saying so is the point.**
        // `Needs` holds a private array and every mutator clamps at
        // NEED_MIN = 0.0, so -1.0 is no longer constructible however this
        // crate behaves. `sanitize_hunger` is therefore no longer the
        // mechanism this test isolates; the type is. Kept as a regression
        // pin on `world_hash`'s sentinel encoding, which it does still
        // detect: drop the need levels from the digest and the two worlds
        // below collapse to the same value again.
        //
        // Everything except the need term is held constant, per [L7]:
        // both handles are built by the same constructor, both spawn
        // exactly one entity as their first spawn (so the entity indices
        // match), neither ticks (so the clock term matches), and both sit
        // at the same position. `world_hash` reads only the clock, the
        // entity index, the position and the seven levels, so the levels
        // are the only thing that can move the digest.
        let mut agent_at_sentinel_level = SimHandle::new(8, 8);
        agent_at_sentinel_level.spawn_agent(1.0, 2.0, -1.0);

        let mut entity_with_no_needs = SimHandle::new(8, 8);
        assert!(entity_with_no_needs.spawn_object(1.0, 2.0, "fridge"));

        assert_ne!(
            agent_at_sentinel_level.world_hash(),
            entity_with_no_needs.world_hash(),
            "a need level of -1.0 arriving from JavaScript hashed \
             identically to an entity with no Needs at all; world_hash's \
             in-band sentinel is reachable across the boundary and \
             terri-sim's debug_assert guard is compiled out of the release \
             wasm build that ships"
        );
    }

    // The rest of this module exists because `cargo mutants` reported
    // these four exports as the only survivors in this crate: `tick`
    // replaced with `()`, and each pointer accessor replaced with
    // `Default::default()`, which for a raw pointer is null. Raised in
    // review on #4, where the crate was also added to the CI sweep.
    //
    // A survivor is behaviour nothing constrains, and every one of these
    // is on the path JavaScript drives every frame. The `()` mutant is
    // the one that matters: a boundary tick that does nothing renders a
    // frozen world with no panic, no log, and a green suite.

    /// The clock term, read from the world rather than from the buffer.
    fn clock_tick(handle: &SimHandle) -> u64 {
        handle.sim.world().resource::<SimClock>().tick
    }

    /// The `len` elements an exported pointer addresses.
    ///
    /// Null is checked **before** the read. `from_raw_parts` requires a
    /// non-null aligned pointer even at zero length, and null is exactly
    /// what the mutants these tests kill return, so reading first would
    /// trade a named assertion for undefined behaviour. Every call site
    /// derives `len` from `entity_count`.
    fn addressed<T: Copy>(ptr: *const T, len: usize, what: &str) -> Vec<T> {
        assert!(
            !ptr.is_null(),
            "{what} handed JavaScript a null pointer; the view built on it \
             would read from address zero"
        );
        // SAFETY: non-null is asserted above, `handle` owns the buffer and
        // outlives this call, and `len` is the row count that same buffer
        // was built with.
        unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec()
    }

    #[test]
    fn from_lot_hands_javascript_the_shipped_objects_without_a_tick_first() {
        // Two mechanisms, and they fail differently.
        //
        // The SPAWN half is `Sim::new_from_lot`, pinned in terri-sim. The
        // half that only exists here is the `sync_render_buffer` call: the
        // render buffer is the only thing JavaScript can see, and without
        // that call `entity_count` reads zero and the first frame draws an
        // empty lot. The page would then look exactly like a lot that
        // failed to load, which is [L17]'s diagnosis cost again.
        //
        // Nothing ticks, so the sync under test is the one `from_lot`
        // does rather than the one `tick` does.
        let handle = SimHandle::from_lot();

        let placed = stored_positions(&handle);
        assert!(
            placed.len() >= 8,
            "[D-6] calls for roughly eight authored objects; got {}",
            placed.len()
        );
        assert_eq!(
            handle.entity_count(),
            placed.len(),
            "every object in the world must be in the render buffer before \
             the first tick; a count of 0 means from_lot never synced and \
             the page would draw an empty lot"
        );
        assert_eq!(
            addressed(
                handle.positions_ptr(),
                handle.entity_count() * 2,
                "positions_ptr"
            )
            .len(),
            placed.len() * 2,
            "the exported pointer must address the same rows entity_count \
             promises"
        );
    }

    #[test]
    fn lot_width_and_lot_height_report_the_lot_in_that_order() {
        // The shipped lot is NOT square, which is what makes a transposed
        // pair of accessors visible here at all. Asserted rather than
        // assumed, because a future lot that happens to be square would
        // silently turn this test into a tautology - the [L34] shape,
        // where the input domain rather than the assertion is what fails.
        let handle = SimHandle::from_lot();
        let (width, height) = (handle.lot_width(), handle.lot_height());

        assert_ne!(
            width, height,
            "the lot must not be square or these two accessors are \
             interchangeable and this test proves nothing"
        );
        // The page derives its camera and its depth scale from these, so
        // they have to be the lot's own numbers rather than a default.
        //
        // There was a `width >= 16 && height >= 8` bound here. It was a
        // magic number that said nothing about correctness and broke the
        // moment the lot was legitimately resized from 24x18 to 14x10.
        // Asserting against `terri_data` instead would mean giving this
        // crate a dependency it does not otherwise need, to strengthen a
        // sanity check that was never where the teeth are: transposition
        // is caught by `assert_ne!` above, and whether these are the
        // LOT's numbers rather than some other grid's is established
        // behaviourally by `moves_from` below, which drops an agent on a
        // tile and watches whether it can walk.
        assert!(width > 1 && height > 1, "got {width}x{height}");

        /// Whether a hungry agent dropped on `tile` of the SHIPPED lot
        /// moves at all in ten ticks.
        ///
        /// An agent standing outside the lot is a silent no-op:
        /// `find_path` refuses an unwalkable origin, so it never gets a
        /// target and stands still forever with nothing logged ([L17]).
        /// Nothing else in the world moves, so the whole position array
        /// is a sound thing to compare.
        ///
        /// The world comes from `from_lot`, NOT from a lot rebuilt out of
        /// the two numbers under test. That is the load-bearing part: a
        /// helper that constructed its own lot from `width` and `height`
        /// would be self-consistent under a swap of the pair and could
        /// not see it.
        ///
        /// **Only the probe agent's own position is compared.** It used to
        /// compare every stored position, which was equivalent while the
        /// probe was the lot's only agent - and stopped being so when
        /// `from_lot` began spawning the household, whose three sims start
        /// moving immediately and would make ANY probe read as mobile.
        ///
        /// The probe is found by HIGHEST ENTITY INDEX, not by row: it is
        /// the newest spawn and nothing despawns during the run, so the
        /// index is unambiguous, while query rows come out in archetype
        /// order and the probe - which carries no `SimId` - sits in a
        /// different archetype from the household ([L47]'s row-is-not-an-id
        /// lesson, met in a test helper).
        fn moves_from(tile: (f32, f32)) -> bool {
            fn probe_position(handle: &SimHandle) -> (f32, f32) {
                use terri_core::Entity;
                let world = handle.sim.world();
                let mut state = world
                    .try_query::<(Entity, &Position)>()
                    .expect("Position is registered eagerly in Sim::new");
                state
                    .iter(world)
                    .max_by_key(|(entity, _): &(Entity, &Position)| entity.index())
                    .map(|(_, pos)| (pos.x, pos.y))
                    .expect("the probe agent was just spawned")
            }

            let mut handle = SimHandle::from_lot();
            handle.spawn_agent(tile.0, tile.1, 20.0);
            let start = probe_position(&handle);
            for _ in 0..10 {
                handle.tick();
            }
            probe_position(&handle) != start
        }

        // The claim through behaviour, so the pair cannot both be
        // satisfied by a lot that is really height by width. On a
        // non-square lot the far corner is inside and its transpose is
        // outside, and only the correct orientation makes these two runs
        // disagree.
        let far_corner = ((width - 1) as f32, (height - 1) as f32);
        let transposed = ((height - 1) as f32, (width - 1) as f32);
        assert!(
            moves_from(far_corner),
            "{far_corner:?} must be inside the lot, so a hungry sim \
             standing there can path somewhere"
        );
        assert!(
            !moves_from(transposed),
            "{transposed:?} must be OUTSIDE a {width}x{height} lot; a sim \
             that walks from there too means lot_width and lot_height are \
             swapped"
        );
    }

    #[test]
    fn tick_advances_the_world_clock() {
        // Isolates the `self.sim.tick()` half of `SimHandle::tick`.
        let mut handle = SimHandle::new(8, 8);
        handle.spawn_agent(1.0, 1.0, 80.0);
        assert_eq!(
            clock_tick(&handle),
            0,
            "spawning must not advance the clock, or the assertion below \
             cannot attribute the movement to the tick"
        );

        handle.tick();

        assert_eq!(
            clock_tick(&handle),
            1,
            "the boundary tick did not advance the simulation; JavaScript \
             would drive a frozen world and have nothing to show for it"
        );
    }

    #[test]
    fn tick_refreshes_the_render_buffer() {
        // Isolates the `self.sim.sync_render_buffer()` half. Spawning
        // through the ECS directly rather than through `spawn_agent` is
        // what makes the two halves separable: `spawn_agent` syncs on its
        // own, so an entity added behind its back reaches the renderer
        // only if `tick` is what syncs.
        let mut handle = SimHandle::new(8, 8);
        handle.spawn_agent(1.0, 1.0, 80.0);
        assert_eq!(handle.entity_count(), 1);

        handle.sim.world_mut().spawn((
            Agent,
            Position { x: 2.0, y: 3.0 },
            Needs::with(NeedId::Hunger, 50.0),
        ));
        assert_eq!(
            handle.entity_count(),
            1,
            "the direct spawn must not be visible before a sync, or this \
             test cannot tell a refreshed buffer from a stale one"
        );

        handle.tick();

        assert_eq!(
            handle.entity_count(),
            2,
            "the boundary tick advanced the world without refreshing the \
             render buffer; JavaScript would redraw the previous frame \
             forever while the simulation ran on without it"
        );
    }

    #[test]
    fn positions_ptr_addresses_the_current_frame_coordinates() {
        let mut handle = SimHandle::new(16, 16);
        handle.spawn_agent(3.5, 6.25, 50.0);

        assert_eq!(
            addressed(
                handle.positions_ptr(),
                handle.entity_count() * 2,
                "positions_ptr"
            ),
            vec![3.5, 6.25],
            "positions_ptr must address the interleaved x, y pairs of the \
             current frame"
        );
    }

    #[test]
    fn kinds_ptr_addresses_the_entity_kind_tags() {
        // One of each kind, because an all-agent lot tags every row 0 and
        // could not distinguish the real array from a zeroed one.
        let mut handle = SimHandle::new(16, 16);
        assert!(handle.spawn_object(1.0, 1.0, "fridge"));
        handle.spawn_agent(2.0, 2.0, 50.0);

        assert_eq!(
            addressed(handle.kinds_ptr(), handle.entity_count(), "kinds_ptr"),
            vec![1, 0],
            "kinds_ptr must address the 0 = agent, 1 = smart object tags, \
             sorted by entity index, so the object spawned first comes first"
        );
    }

    #[test]
    fn activities_ptr_addresses_the_activity_column() {
        // The [A-11] indicator bubbles' whole input. Same
        // null-pointer-from-`Default::default()` hazard as `ids_ptr`
        // below: nothing else on the Rust side reads through it, and a
        // null crossed into a `Uint32Array` view fails only in the page.
        //
        // The agent is hungry with the fridge across the lot, so after
        // two ticks it is mid-walk and its row reads WALKING while the
        // object's reads NONE - two different values, which is what
        // rules out a zeroed sibling column as well as a null.
        let mut handle = SimHandle::new(16, 16);
        assert!(handle.spawn_object(2.0, 2.0, "fridge"));
        handle.spawn_agent(12.0, 2.0, 20.0);
        handle.tick();
        handle.tick();

        assert_eq!(
            addressed(
                handle.activities_ptr(),
                handle.entity_count(),
                "activities_ptr"
            ),
            vec![
                terri_sim::render_buffer::activity::NONE,
                terri_sim::render_buffer::activity::WALKING
            ],
            "activities_ptr must address the per-row activity tags: the \
             object does nothing and the hungry agent is walking to eat"
        );
    }

    #[test]
    fn carrying_ptr_addresses_the_carrying_column() {
        // Same null-pointer-from-Default hazard as activities_ptr
        // above, found the same way: the sweep stubbed it and nothing
        // native noticed, because only the page reads through it. Two
        // rows with two different values - one full hand, one empty
        // sentinel - rule out a zeroed sibling as well as a null.
        let mut handle = SimHandle::new(16, 16);
        assert!(handle.spawn_object(2.0, 2.0, "fridge"));
        handle.spawn_agent(12.0, 2.0, 20.0);
        let carrier = {
            let world = handle.sim.world_mut();
            let mut state = world.query::<(terri_core::Entity, &terri_core::Needs)>();
            state
                .iter(world)
                .map(|(entity, _)| entity)
                .next()
                .expect("the agent was just spawned")
        };
        handle
            .sim
            .world_mut()
            .entity_mut(carrier)
            .insert(terri_core::Carrying(1));
        handle.tick();

        assert_eq!(
            addressed(handle.carrying_ptr(), handle.entity_count(), "carrying_ptr"),
            vec![u32::MAX, 1],
            "carrying_ptr must address the per-row item kinds: the \
             object's hands read the sentinel and the agent carries \
             kind 1"
        );
    }

    #[test]
    fn social_labels_reports_the_shipped_vocabulary_in_index_order() {
        // The rows of the flyout drawn over a fellow sim, and the index
        // space `TalkTo::interaction` lives in - the same order-IS-the-
        // index contract `interaction_labels` carries for objects. The
        // expectation is the shipped `content/social.toml`; when the
        // vocabulary grows, this list grows with it, and that edit is
        // exactly the review this test wants a human to make.
        let handle = SimHandle::new(8, 8);
        assert_eq!(
            handle.social_labels(),
            vec!["Chat"],
            "one label per social interaction, in pack order"
        );
    }

    /// `ids_ptr` must hand JavaScript a live view of the **id** column.
    ///
    /// Found by the mutation sweep rather than by hand: replacing this
    /// accessor with `Default::default()` - a null pointer straight into a
    /// `Uint32Array` constructor - survived every other test in this crate,
    /// because nothing on the Rust side read through it at all.
    ///
    /// **What this test covers and what it does not.** The three `u32`
    /// columns - `ids`, `kinds` and `sprites` - are the same type and the
    /// same length, so returning the wrong one compiles and type-checks.
    /// The fixture is one object plus one agent precisely so that all three
    /// hold *different* values, which is what lets this distinguish them;
    /// the assertions below therefore catch a null pointer and catch
    /// `ids_ptr` addressing either sibling array.
    ///
    /// It does **not** distinguish an entity index from a row number, because
    /// the two are equal on any world this crate can build - creating a hole
    /// in the index space needs a despawn, and that needs `bevy_ecs`, which
    /// `terri-wasm` deliberately does not depend on. That distinction is
    /// pinned one layer down instead, by
    /// `a_row_is_not_its_entity_index_once_an_index_is_freed` in
    /// `terri-sim`'s `render_buffer` tests, which can despawn. See [L47].
    #[test]
    fn ids_ptr_addresses_the_id_column_and_not_a_sibling_u32_column() {
        let mut handle = SimHandle::new(16, 16);
        assert!(handle.spawn_object(1.0, 1.0, "sofa"));
        handle.spawn_agent(2.0, 2.0, 50.0);

        let rows = handle.entity_count();
        let ids = addressed(handle.ids_ptr(), rows, "ids_ptr");
        let kinds = addressed(handle.kinds_ptr(), rows, "kinds_ptr");
        let sprites = addressed(handle.sprites_ptr(), rows, "sprites_ptr");

        assert_ne!(
            ids, kinds,
            "the fixture must make the id and kind columns differ, or \
             returning the kinds array here is invisible"
        );
        assert_ne!(
            ids, sprites,
            "the fixture must make the id and sprite columns differ, or \
             returning the sprites array here is invisible"
        );
        assert_eq!(
            ids,
            vec![0, 1],
            "ids_ptr must address the entity index of each row, ascending, \
             so the object spawned first comes first - this is the number a \
             click becomes in a Select or UseObject command, and a wrong one \
             directs a different sim"
        );
    }

    #[test]
    fn sprites_ptr_addresses_the_content_resolved_atlas_indices() {
        // One object and one agent, because an all-object lot would tag
        // every row the same and could not distinguish the real array
        // from a constant. The expectations are read out of the pack so
        // a re-skin does not break this, and asserted to differ so that
        // reading them out cannot make the comparison vacuous.
        let mut handle = SimHandle::new(16, 16);
        assert!(handle.spawn_object(1.0, 1.0, "sofa"));
        handle.spawn_agent(2.0, 2.0, 50.0);

        // Through the sim's own `Content` resource rather than by
        // depending on `terri-data`. This crate deliberately does not
        // name that crate in its manifest, and it does not have to:
        // inherent methods on `ContentPack` are callable without naming
        // the type.
        let pack = handle.sim.world().resource::<Content>().0;
        let sofa = pack.object(pack.find("sofa").expect("shipped content has a sofa"));
        assert_ne!(
            sofa.sprite, pack.sim_sprite,
            "the sofa and the sim must draw differently or this proves nothing"
        );

        assert_eq!(
            addressed(handle.sprites_ptr(), handle.entity_count(), "sprites_ptr"),
            vec![sofa.sprite, pack.sim_sprite],
            "sprites_ptr must address the atlas index per row, sorted by \
             entity index, so the object spawned first comes first"
        );
    }

    /// **Every reported wall is genuinely impassable**, which is the half of
    /// the old contract worth keeping.
    ///
    /// `wall_tiles` used to be read straight off the `TileGrid`, so this was
    /// true by construction and needed no test. It now reads the authored wall
    /// list, which can drift from the grid - and the drift would look like a sim
    /// detouring around nothing, or walking through a wall it can see. So the
    /// property moves from the implementation into an assertion.
    ///
    /// Subset, not equality: the grid is deliberately a superset now, because
    /// object footprints are impassable too and draw their own sprites.
    #[test]
    fn every_reported_wall_is_actually_impassable() {
        let handle = SimHandle::from_lot();
        let tiles = handle.wall_tiles();
        assert!(!tiles.is_empty(), "an empty list would assert nothing");

        let grid = handle.sim.world().resource::<TileGrid>();
        for pair in tiles.chunks_exact(2) {
            let (x, y) = (pair[0] as i32, pair[1] as i32);
            assert!(
                !grid.is_walkable(x, y),
                "({x}, {y}) is drawn as a wall but the simulation would let a \
                 sim walk through it"
            );
        }
    }

    /// **No object tile is reported as a wall**, which is the half that broke.
    ///
    /// The moment footprints made furniture impassable, reading walls off the
    /// grid returned 17 tiles for the shipped lot instead of 8 - the 8 authored
    /// walls plus all 9 tiles covered by the 8 objects, one of which is the
    /// bed's second tile. The renderer would have drawn a 98 px wall sprite on
    /// top of every piece of furniture in the house.
    ///
    /// Nothing else could see it: the Rust and web tests both compared the
    /// export against the grid, which is what had changed underneath them.
    #[test]
    fn no_object_footprint_tile_is_reported_as_a_wall() {
        let handle = SimHandle::from_lot();
        let walls: std::collections::BTreeSet<(u32, u32)> = handle
            .wall_tiles()
            .chunks_exact(2)
            .map(|p| (p[0], p[1]))
            .collect();

        let pack = handle.sim.world().resource::<Content>().0;
        let mut covered = 0usize;
        for placement in &pack.lot.placements {
            let object = pack.object(placement.object);
            let footprint = object.footprint;
            for dx in 0..footprint.width {
                for dy in 0..footprint.depth {
                    let tile = (
                        placement.x.round() as u32 + dx,
                        placement.y.round() as u32 + dy,
                    );
                    covered += 1;
                    assert!(
                        !walls.contains(&tile),
                        "{:?} is covered by '{}' but is drawn as a wall",
                        tile,
                        object.id
                    );
                }
            }
        }
        // The precondition: there ARE object tiles, and at least one object is
        // wider than a single tile - otherwise the multi-tile half of this is
        // untested and the whole thing could pass on an empty lot.
        assert!(
            covered > 8,
            "expected more tiles than objects; got {covered}"
        );
    }

    #[test]
    fn wall_tiles_reports_the_blocked_tiles_of_the_shipped_lot_and_only_those() {
        // The shipped lot, because the point of this export is that the
        // page draws the walls the simulation actually paths around.
        let handle = SimHandle::from_lot();
        let tiles = handle.wall_tiles();

        assert_eq!(tiles.len() % 2, 0, "the pairs must be interleaved x, y");
        let pairs: Vec<(u32, u32)> = tiles.chunks_exact(2).map(|c| (c[0], c[1])).collect();
        assert!(
            !pairs.is_empty(),
            "the shipped lot has interior walls; an empty result means the \
             page would draw none of them"
        );

        // **Against the authored wall list, not against the grid, and this
        // assertion was inverted deliberately.**
        //
        // It used to require the export and the grid's blocked set to be
        // EQUAL, which held while walls were the only impassable thing.
        // Footprints made furniture impassable too, and the equality then
        // demanded the renderer draw a wall on every object - which is exactly
        // what it started doing, 17 tiles instead of 8. The subset direction is
        // pinned by `every_reported_wall_is_actually_impassable` and the
        // furniture direction by `no_object_footprint_tile_is_reported_as_a_wall`;
        // between them they say everything the equality used to, minus the part
        // that was wrong.
        let pack = handle.sim.world().resource::<Content>().0;
        let authored: Vec<(u32, u32)> = pack.lot.walls.clone();
        assert_eq!(
            pairs, authored,
            "the export must be exactly the authored wall list, in order"
        );
        assert!(
            !authored.is_empty(),
            "the shipped lot has interior walls; an empty list would make \
             every assertion here vacuous"
        );

        // No tile twice. The old version got this from the grid scan; stated
        // directly now, because the authored list is a `Vec` and nothing
        // upstream forbids a duplicate entry.
        let unique: std::collections::BTreeSet<(u32, u32)> = pairs.iter().copied().collect();
        assert_eq!(
            unique.len(),
            pairs.len(),
            "wall_tiles must not repeat a tile"
        );

        // **There is deliberately no doorway assertion here, and that is a
        // change from what this test used to do.**
        //
        // It used to name `(9, 2)` and require it absent, which the five-room
        // lot broke for a reason this export does not care about. The obvious
        // replacement was to FIND the doorways - tiles absent from the list
        // with entries either side - and require at least five. That was
        // written, and then noticed to be incapable of failing: `pairs` was
        // asserted equal to `pack.lot.walls` twenty lines above, so any
        // property computed from `pairs` is a property of the content, and
        // this test would be reporting on `lot.toml` rather than on the
        // export. It could only ever go red for an edit that
        // `the_shipped_lot_loads_its_walls_its_doorway_and_all_of_its_objects`
        // in terri-sim already catches with literal coordinates and a
        // reachability check.
        //
        // The doorways are load-bearing and they are pinned there. What is
        // pinned HERE is the export, and the equality above is the whole of
        // it.
    }

    /// `sim_name` is the needs panel's header. Three answers matter and
    /// each is a different row of the fixture: a household sim yields its
    /// authored name, an OBJECT yields the empty string (the kind check -
    /// a click that selected the fridge must not caption the panel
    /// "fridge"), and a stale or absurd index yields the empty string
    /// rather than trapping the module, because indices arrive from
    /// JavaScript and are hostile like every other.
    #[test]
    fn sim_name_reports_household_names_and_nothing_for_anything_else() {
        let handle = SimHandle::from_lot();
        // Through the Content resource rather than terri_data::pack():
        // terri-wasm deliberately does not depend on the content crate,
        // and the resource is the same &'static pack either way.
        let pack = handle.sim.world().resource::<Content>().0;
        assert!(
            !pack.household.is_empty(),
            "the shipped household is the fixture; empty proves nothing"
        );

        // The household spawns after the objects, in declaration order,
        // so its indices follow the placements'.
        let objects = pack.lot.placements.len() as u32;
        for (offset, member) in pack.household.iter().enumerate() {
            assert_eq!(
                handle.sim_name(objects + offset as u32),
                member.name,
                "member {offset} must answer with its authored name"
            );
        }

        assert_eq!(
            handle.sim_name(0),
            "",
            "index 0 is a placed object, and an object has no name to show"
        );
        assert_eq!(handle.sim_name(9_999), "");
        assert_eq!(handle.sim_name(u32::MAX), "");
    }

    #[test]
    fn object_name_reports_authored_furniture_names_only() {
        let handle = SimHandle::from_lot();
        let pack = handle.sim.world().resource::<Content>().0;
        let first = &pack.lot.placements[0];
        assert_eq!(
            handle.object_name_of(0),
            pack.objects[first.object.0 as usize].name
        );
        let first_sim = pack.lot.placements.len() as u32;
        assert_eq!(handle.object_name_of(first_sim), "");
        assert_eq!(handle.object_name_of(u32::MAX), "");
    }

    // ---- Player commands ----------------------------------------------
    //
    // Everything below is about `enqueue_command`, which is where the
    // shell stops being a renderer and starts being an input. The bytes
    // are written as LITERALS rather than produced by `postcard::
    // to_allocvec`, and that is the load-bearing part rather than a
    // stylistic one: encoding with the same library that decodes is a
    // round trip, and a round trip is self-consistent under any encoding
    // at all ([L33]). What crosses this boundary in the browser is bytes
    // JavaScript wrote by hand, so bytes written by hand are what these
    // send. They match the golden vector in `terri_core::command`, which
    // is the one place the format is stated.

    /// `SimCommand::Select(Some(index))`: variant 0, `Option` tag 1, then
    /// the index as a varint. Single-byte indices only, which is all any
    /// of these fixtures uses.
    fn select_bytes(index: u32) -> Vec<u8> {
        assert!(index < 128, "the varint below is one byte only");
        vec![0x00, 0x01, index as u8]
    }

    /// `SimCommand::UseObject { agent, object, interaction }`: variant 1,
    /// then three varints, in that order.
    ///
    /// The interaction is a parameter rather than a hardcoded `0x00`
    /// because a fixture that always sends 0 cannot tell "the shell's
    /// chosen interaction crossed the boundary" from "the boundary
    /// substituted 0" - [L34] in the one place the whole field matters.
    fn use_object_bytes(agent: u32, object: u32, interaction: u32) -> Vec<u8> {
        assert!(
            agent < 128 && object < 128 && interaction < 128,
            "one-byte varints only"
        );
        vec![0x01, agent as u8, object as u8, interaction as u8]
    }

    /// `SimCommand::CancelIntents { agent }`: variant 2, then the agent
    /// index as a varint.
    fn cancel_intents_bytes(agent: u32) -> Vec<u8> {
        assert!(agent < 128, "the varint below is one byte only");
        vec![0x02, agent as u8]
    }

    /// The same command with `interaction: u32::MAX`, which one-byte
    /// varints cannot express.
    ///
    /// Five bytes for the index, because a 32-bit value needs five groups
    /// of seven bits and the last carries only four. Copied from the
    /// `u32::MAX` row of `command_encoding_is_pinned_by_a_golden_byte_vector`
    /// rather than computed here, which is the same rule the rest of this
    /// module follows: bytes are written by hand so that they are not a
    /// round trip through the encoder under test, and the golden vector is
    /// the single place that says what they are.
    fn use_object_bytes_saturated_interaction(agent: u32, object: u32) -> Vec<u8> {
        assert!(agent < 128 && object < 128, "one-byte varints only");
        vec![
            0x01,
            agent as u8,
            object as u8,
            0xFF,
            0xFF,
            0xFF,
            0xFF,
            0x0F,
        ]
    }

    /// How many commands are staged and not yet drained.
    fn staged(handle: &SimHandle) -> usize {
        handle.sim.world().resource::<CommandQueue>().len()
    }

    /// The staging cap the boundary actually enforces, read from the same
    /// content it read rather than restated as a literal. A number here
    /// would leave the cap test green while silently no longer testing
    /// the shipped value, from the first time anybody tunes it.
    fn command_cap(handle: &SimHandle) -> usize {
        handle
            .sim
            .world()
            .resource::<Content>()
            .0
            .tuning
            .max_queued_commands as usize
    }

    /// Spawns an agent through the ECS rather than through
    /// `spawn_agent`, because these tests need its raw index and the
    /// export does not return one. Same fixture shape `spawn_agent`
    /// builds: hunger set, the other six satisfied.
    fn spawn_agent_at(handle: &mut SimHandle, x: f32, y: f32, hunger: f32) -> u32 {
        handle
            .sim
            .world_mut()
            .spawn((
                Agent,
                Position { x, y },
                Needs::with(NeedId::Hunger, hunger),
            ))
            .id()
            .index_u32()
    }

    #[test]
    fn a_well_formed_command_reaches_the_simulation() {
        // **The counterfactual for every rejection test below.** Without
        // it, `enqueue_command` returning `false` unconditionally - or
        // staging the command and never letting the drain see it - would
        // satisfy all of them, and the boundary would be closed rather
        // than open. This is the test that says it is open.
        //
        // Selection is what it checks, because selection is the one
        // command whose whole effect is observable through another
        // export: the shell asks with `Select` and reads back with
        // `selected_index`, which is [D-5]'s round trip.
        let mut handle = SimHandle::new(8, 8);
        let agent = spawn_agent_at(&mut handle, 1.0, 1.0, 80.0);
        assert_eq!(
            handle.selected_index(),
            None,
            "nothing is selected until a command says so, or the \
             assertion below cannot attribute the selection to the command"
        );

        assert!(
            handle.enqueue_command(&select_bytes(agent)),
            "a well-formed Select must be accepted"
        );
        assert_eq!(
            staged(&handle),
            1,
            "an accepted command must be STAGED rather than applied; \
             applying it here would be JavaScript mutating the world, \
             which is the one thing [D-2] forbids"
        );
        assert_eq!(
            handle.selected_index(),
            None,
            "and it must not have taken effect before the tick that \
             drains it"
        );

        handle.tick();

        assert_eq!(
            handle.selected_index(),
            Some(agent),
            "the command must reach the simulation on the tick that \
             drains it"
        );
        assert_eq!(staged(&handle), 0, "and the drain must empty the queue");
    }

    #[test]
    fn flush_commands_applies_input_without_advancing_the_world() {
        let mut handle = SimHandle::new(8, 8);
        let agent = spawn_agent_at(&mut handle, 1.0, 1.0, 80.0);
        let before_hunger = stored_hungers(&handle);
        assert!(handle.enqueue_command(&select_bytes(agent)));

        handle.flush_commands();

        assert_eq!(handle.selected_index(), Some(agent));
        assert_eq!(staged(&handle), 0, "the paused drain must empty the queue");
        assert_eq!(handle.sim_tick(), 0, "paused input must not advance time");
        assert_eq!(
            stored_hungers(&handle),
            before_hunger,
            "paused input must not run need decay"
        );
    }

    #[test]
    fn flush_commands_preserves_an_in_flight_interpolation_pair() {
        let mut handle = SimHandle::new(8, 8);
        assert!(handle.spawn_object(4.0, 4.0, "fridge"));
        handle.spawn_agent(1.0, 4.0, 0.0);
        handle.tick();

        let before_previous = handle.sim.render_buffer().prev_positions.clone();
        let before_current = handle.sim.render_buffer().positions.clone();
        assert_ne!(
            before_previous, before_current,
            "the fixture must be between two movement samples before the paused flush"
        );

        handle.flush_commands();

        assert_eq!(handle.sim.render_buffer().prev_positions, before_previous);
        assert_eq!(handle.sim.render_buffer().positions, before_current);
    }

    #[test]
    fn flush_commands_refreshes_activity_metadata_without_a_tick() {
        let mut handle = SimHandle::new(8, 8);
        assert!(handle.spawn_object(4.0, 4.0, "fridge"));
        let agent = spawn_agent_at(&mut handle, 3.0, 4.0, 0.0);
        assert!(handle.enqueue_command(&use_object_bytes(agent, 0, 0)));
        handle.tick();

        let row = handle
            .sim
            .render_buffer()
            .ids
            .iter()
            .position(|&index| index == agent)
            .expect("the agent must have a render row");
        assert_eq!(
            handle.sim.render_buffer().activities[row],
            terri_sim::render_buffer::activity::EATING,
            "the fixture must begin with visible interaction metadata"
        );

        assert!(handle.enqueue_command(&cancel_intents_bytes(agent)));
        handle.flush_commands();

        assert_eq!(handle.sim_tick(), 1, "the cancel must not run a full tick");
        assert_eq!(
            handle.sim.render_buffer().activities[row],
            terri_sim::render_buffer::activity::NONE,
            "command-only refresh must publish the cancelled activity"
        );
    }

    #[test]
    fn malformed_command_bytes_are_rejected_rather_than_trapping_the_module() {
        // **The mutation this is written against: `unwrap` or `expect` on
        // the decode.** That compiles, ships, and survives `--release` -
        // which is what makes it worse than the [L12] `debug_assert!`
        // rather than better. A panic inside a `#[wasm_bindgen]` export
        // unwinds into a JS exception AND leaves the module trapped for
        // the rest of the page's life, so one malformed frame of input is
        // the whole game freezing rather than one click failing.
        //
        // Six shapes, because they fail at different points in the
        // decoder and a guard could plausibly catch some and not others.
        let mut handle = SimHandle::new(8, 8);
        let agent = spawn_agent_at(&mut handle, 1.0, 1.0, 80.0);
        handle.enqueue_command(&select_bytes(agent));
        handle.tick();
        let baseline = handle.world_hash();

        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("empty - no variant index at all", vec![]),
            (
                "variant index 4, one past the four SimCommand declares; \
                 also what an older shell sending a newer format looks like",
                vec![0x04, 0x00],
            ),
            ("variant index 0xFF", vec![0xFF]),
            (
                "Select with its Option tag but no payload - a truncated \
                 write, or a sliced buffer",
                vec![0x00, 0x01],
            ),
            ("UseObject missing its second field", vec![0x01, 0x03]),
            (
                "UseObject with an agent and an object but no interaction, \
                 which is exactly what a shell still writing the old \
                 three-byte form sends; accepting it as interaction 0 \
                 would make the format silently two formats",
                vec![0x01, 0x03, 0x09],
            ),
            (
                "a valid SetSpeed(2) followed by junk; accepting the \
                 prefix would make the format ambiguous",
                vec![0x03, 0x02, 0xAA, 0xBB],
            ),
        ];

        for (what, bytes) in cases {
            assert!(
                !handle.enqueue_command(&bytes),
                "enqueue_command accepted {what}: {bytes:02X?}"
            );
            assert_eq!(
                staged(&handle),
                0,
                "a rejected command must leave nothing staged ({what})"
            );
        }

        assert_eq!(
            handle.world_hash(),
            baseline,
            "a rejected command must change nothing at all"
        );

        // **A rejection must not poison the handle.** On a genuinely
        // trapped module every later call throws rather than returning,
        // so these two are what tell a returned `false` apart from a
        // trap - the same role the follow-up spawn plays in
        // `spawning_an_unknown_content_id_is_rejected_rather_than_panicking`.
        assert!(
            handle.enqueue_command(&select_bytes(agent)),
            "the boundary's job is to fail one call, not to end the session"
        );
        handle.tick();
        assert_eq!(handle.selected_index(), Some(agent));
    }

    #[test]
    fn the_staging_queue_is_capped_at_the_tuned_depth_rather_than_growing_without_bound() {
        // Nothing downstream bounds this queue. `max_queued_intents`
        // bounds one sim's orders and is only ever reached by a
        // `UseObject` that resolved to a live agent; every `Select`,
        // every `SetSpeed` and every command naming an index that no
        // longer exists lands here and touches no intent queue at all.
        // The commands below are deliberately of the kind that could
        // never reach the intent cap, so a test that passed because THAT
        // cap fired would be visible as a failure here.
        //
        // The queue waits until the shell invokes either a full tick or the
        // paused command boundary. This test invokes neither while filling
        // it, so the cap remains directly observable.
        //
        // Three past the cap rather than one, so a cap off by one in
        // either direction is still visible.
        let mut handle = SimHandle::new(8, 8);
        let cap = command_cap(&handle);
        assert!(cap >= 1, "a cap of zero is rejected at build time");

        let mut accepted = 0;
        for _ in 0..cap + 3 {
            if handle.enqueue_command(&select_bytes(9)) {
                accepted += 1;
            }
        }

        assert_eq!(
            accepted,
            cap,
            "exactly the first {cap} commands must be accepted; \
             {} were issued",
            cap + 3
        );
        assert_eq!(
            staged(&handle),
            cap,
            "the queue must stop at the tuned cap rather than growing \
             with every click"
        );

        // And the cap is a bound on the QUEUE rather than a latch on the
        // handle: draining makes room again. Without this, refusing every
        // command after the first burst forever would pass everything
        // above and make the game unplayable after six seconds of
        // clicking.
        handle.tick();
        assert_eq!(staged(&handle), 0, "the tick must have drained it");
        assert!(
            handle.enqueue_command(&select_bytes(9)),
            "a drained queue must accept commands again"
        );
    }

    /// The [A-11] debug trio, at the boundary they actually cross.
    /// Asymmetric personality halves per [L34]: drain heads 1.5 and
    /// satisfaction tails 0.75, so swapped halves fail rather than
    /// agree. The relationship pairs interleave in key order, and the
    /// absent cases flatten to empty exactly like needs_of.
    #[test]
    fn the_debug_trio_reports_identity_personality_and_feelings() {
        use terri_core::{Personality, Relationships, SimId};

        let mut handle = SimHandle::new(16, 16);
        let mut personality = Personality::neutral();
        personality.drain[0] = 1.5;
        personality.satisfaction[NEED_COUNT - 1] = 0.75;
        let mut feelings = Relationships::default();
        feelings.bump(SimId(9), 0.5);
        feelings.bump(SimId(2), -0.25);
        let mut ledger = terri_core::Satisfaction::default();
        ledger.add(6.5);
        let agent = handle
            .sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 1.0, y: 1.0 },
                Needs::all_at(NEED_MAX),
                SimId(4),
                personality,
                feelings,
                ledger,
            ))
            .id()
            .index_u32();
        let bare = handle
            .sim
            .world_mut()
            .spawn((Agent, Position { x: 2.0, y: 2.0 }, Needs::all_at(NEED_MAX)))
            .id()
            .index_u32();

        assert_eq!(handle.sim_id_of(agent), 4);
        assert_eq!(
            handle.sim_id_of(bare),
            u32::MAX,
            "no identity flattens to the in-band absent value"
        );

        // The M2e ledger crosses with the trio: a real value for the
        // sim that carries one, -1 in-band for the bare agent - the
        // same absent contract sim_id_of's MAX carries. 6.5 rather than
        // 0, so a boundary that flattened every ledger to the default
        // is visible ([L34]).
        assert_eq!(handle.satisfaction_of(agent), 6.5);
        assert_eq!(
            handle.satisfaction_of(bare),
            -1.0,
            "no ledger flattens to the in-band absent value"
        );

        let personality = handle.personality_of(agent);
        assert_eq!(personality.len(), NEED_COUNT * 2);
        assert_eq!(personality[0], 1.5, "drain rides FIRST");
        assert_eq!(
            personality[NEED_COUNT * 2 - 1],
            0.75,
            "satisfaction rides second"
        );
        assert!(handle.personality_of(bare).is_empty());

        assert_eq!(
            handle.relationships_of(agent),
            vec![2.0, -0.25, 9.0, 0.5],
            "interleaved pairs in the component's key-sorted order"
        );
        assert!(handle.relationships_of(bare).is_empty());
    }

    /// The overlay's two stall reads across the boundary, in-band
    /// empty for "nothing holds this sim" - and two sims in different
    /// states, so a boundary that ignored its index is visible.
    #[test]
    fn the_stall_reads_cross_the_boundary() {
        let mut handle = SimHandle::new(8, 8);
        let stuck = {
            let world = handle.sim.world_mut();
            let mut queue = terri_core::IntentQueue::default();
            let object = world.spawn(()).id();
            queue.push(terri_core::Intent {
                object,
                interaction: 0,
            });
            queue.push(terri_core::Intent {
                object,
                interaction: 1,
            });
            world
                .spawn((
                    terri_core::Agent,
                    terri_core::Position { x: 1.0, y: 1.0 },
                    terri_core::Blocked,
                    queue,
                ))
                .id()
                .index_u32()
        };
        let free = {
            let world = handle.sim.world_mut();
            world
                .spawn((terri_core::Agent, terri_core::Position { x: 4.0, y: 4.0 }))
                .id()
                .index_u32()
        };

        assert_eq!(handle.stall_reason_of(stuck), "waiting on something in use");
        assert_eq!(
            handle.stall_reason_of(free),
            "",
            "nothing holding it reads as the in-band empty string"
        );
        assert_eq!(handle.queued_orders_of(stuck), 2);
        assert_eq!(handle.queued_orders_of(free), 0);
    }

    /// The M2f PR 3 reads: the kind list crosses in pack order, the
    /// status line composes label, step and carried kind from content,
    /// and empty hands or no errand read as the in-band empty string.
    #[test]
    fn the_chain_status_reads_cross_the_boundary() {
        let mut handle = SimHandle::from_lot();
        let terri = (0..handle.entity_count() as u32)
            .find(|&index| handle.sim_name(index) == "Tim")
            .expect("the shipped lot houses Tim");

        assert_eq!(
            handle.item_kinds(),
            vec!["ingredients".to_string(), "dinner".to_string()],
            "minting order, straight off content/chains.toml"
        );
        assert_eq!(handle.chain_status_of(terri), "", "no errand yet");

        let entity = {
            let world = handle.sim.world_mut();
            let mut state = world.query::<(terri_core::Entity, &terri_core::SimName)>();
            state
                .iter(world)
                .find(|(_, name)| name.0 == "Tim")
                .map(|(e, _)| e)
                .expect("named above")
        };
        handle
            .sim
            .world_mut()
            .entity_mut(entity)
            .insert(terri_core::ChainState {
                chain: 0,
                step: 2,
                fumble_scale: 1.0,
            });
        assert_eq!(handle.chain_status_of(terri), "Cook dinner - step: Cook");

        handle
            .sim
            .world_mut()
            .entity_mut(entity)
            .insert(terri_core::Carrying(0));
        assert_eq!(
            handle.chain_status_of(terri),
            "Cook dinner - step: Cook (carrying ingredients)"
        );
    }

    /// The M2e PR 3 overlay reads, against the SHIPPED lot so the pack
    /// lookups (labels, kinds, career) resolve real content: Tim
    /// wears low spirits and holds the office job, Doug wears the
    /// devotee disposition and holds nothing, and the household opens
    /// broke.
    #[test]
    fn the_career_and_trait_reads_cross_the_boundary() {
        let mut handle = SimHandle::from_lot();
        // Entity indices are dense from zero at spawn, so a bounded
        // scan by name needs no buffer sync.
        let index_of = |name: &str| {
            (0..handle.entity_count() as u32)
                .find(|&index| handle.sim_name(index) == name)
                .unwrap_or_else(|| panic!("the shipped lot houses {name}"))
        };
        let tim = index_of("Tim");
        let bill = index_of("Bill");

        // Zero at move-in AND a nonzero read-through, because a funds()
        // stubbed to 0.0 satisfies the first alone - the sweep found
        // exactly that mutant surviving.
        assert_eq!(handle.funds(), 0.0, "move-in day, before any shift");
        handle.sim.world_mut().resource_mut::<terri_core::Funds>().0 = 260;
        assert_eq!(handle.funds(), 260.0, "the boundary reads the ledger");
        handle.sim.world_mut().resource_mut::<terri_core::Funds>().0 = 0;
        assert_eq!(handle.career_of(tim), "Office clerk");
        assert_eq!(
            handle.career_of(bill),
            "",
            "the unemployed read as the empty string, sim_name's contract"
        );

        let labels = handle.trait_labels();
        let kinds = handle.trait_kinds();
        assert_eq!(
            labels.len(),
            kinds.len(),
            "labels and kinds are two columns of one table"
        );
        let worn = handle.traits_of(tim);
        assert_eq!(worn.len(), 2, "one trait is one (index, state) pair");
        let which = worn[0] as usize;
        assert_eq!(labels[which], "Low spirits");
        assert_eq!(kinds[which], "condition");
        assert_eq!(worn[1], 0.6, "the authored start severity rides as state");
    }

    #[test]
    fn mood_boundary_keeps_scores_and_labels_aligned_in_causal_order() {
        let mut handle = SimHandle::new(12, 12);
        let condition_index = handle
            .sim
            .trait_kinds()
            .iter()
            .position(|kind| *kind == "condition")
            .expect("the shipped pack carries a condition") as u32;
        let mut needs = Needs::all_at(50.0);
        needs.set(NeedId::Hunger, 20.0);
        needs.set(NeedId::Energy, 40.0);
        let subject = handle
            .sim
            .world_mut()
            .spawn((
                Agent,
                SimId(50),
                SimName("Subject".to_string()),
                Position { x: 1.0, y: 1.0 },
                needs,
                Traits::from_entries(vec![(condition_index, 0.6)]),
                Relationships::default(),
            ))
            .id();
        // Spawn id 5 before id 2 so query order and required SimId order
        // disagree. The boundary must preserve the simulation's ordering.
        handle.sim.world_mut().spawn((
            Agent,
            SimId(5),
            SimName("Alice".to_string()),
            Position { x: 1.0, y: 1.0 },
            Needs::all_at(50.0),
        ));
        handle.sim.world_mut().spawn((
            Agent,
            SimId(2),
            SimName("Bob".to_string()),
            Position { x: 3.0, y: 1.0 },
            Needs::all_at(50.0),
        ));
        {
            let mut relationships = handle
                .sim
                .world_mut()
                .get_mut::<Relationships>(subject)
                .expect("subject carries directional feelings");
            relationships.bump(SimId(5), 0.5);
            relationships.bump(SimId(2), -0.8);
        }

        let scores = handle.mood_snapshot_of(subject.index_u32());
        let labels = handle.mood_summary_of(subject.index_u32());
        assert_eq!(
            labels,
            vec![
                "Miserable",
                "Starving",
                "Tired",
                "Low spirits",
                "Uneasy around Bob",
                "Comforted by Alice",
            ]
        );
        assert_eq!(scores.len(), labels.len(), "the boundary columns align");
        let expected = [-53.5, -25.0, -12.0, -18.0, -6.0, 7.5];
        for (index, (actual, expected)) in scores.iter().zip(expected).enumerate() {
            assert!(
                (*actual - expected).abs() < 1e-5,
                "score slot {index} read {actual}, expected {expected}"
            );
        }
    }

    #[test]
    fn mood_boundary_preserves_exact_need_thresholds_and_empty_absence() {
        let mut handle = SimHandle::new(8, 8);
        let subject = handle
            .sim
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, Needs::all_at(50.0)))
            .id();
        let non_sim = handle
            .sim
            .world_mut()
            .spawn((Position { x: 2.0, y: 2.0 }, Needs::all_at(50.0)))
            .id();
        let stale = handle
            .sim
            .world_mut()
            .spawn((Agent, Position { x: 3.0, y: 3.0 }, Needs::all_at(50.0)))
            .id();
        let stale_index = stale.index_u32();
        assert!(handle.sim.world_mut().despawn(stale));

        for (level, label, score) in [
            (20.0, "Starving", -25.0),
            (20.001, "Hungry", -12.0),
            (40.0, "Hungry", -12.0),
        ] {
            let mut needs = Needs::all_at(50.0);
            needs.set(NeedId::Hunger, level);
            handle.sim.world_mut().entity_mut(subject).insert(needs);
            assert_eq!(
                handle.mood_summary_of(subject.index_u32()),
                vec![if score <= -15.0 { "Low" } else { "Okay" }, label,]
            );
            assert_eq!(
                handle.mood_snapshot_of(subject.index_u32()),
                vec![score, score]
            );
        }

        let mut above = Needs::all_at(50.0);
        above.set(NeedId::Hunger, 40.001);
        handle.sim.world_mut().entity_mut(subject).insert(above);
        assert_eq!(handle.mood_summary_of(subject.index_u32()), vec!["Okay"]);
        assert_eq!(handle.mood_snapshot_of(subject.index_u32()), vec![0.0]);
        assert!(handle.mood_summary_of(non_sim.index_u32()).is_empty());
        assert!(handle.mood_snapshot_of(non_sim.index_u32()).is_empty());
        assert!(handle.mood_summary_of(stale_index).is_empty());
        assert!(handle.mood_snapshot_of(stale_index).is_empty());
        assert!(handle.mood_summary_of(u32::MAX).is_empty());
        assert!(handle.mood_snapshot_of(u32::MAX).is_empty());
    }

    #[test]
    fn needs_of_reports_the_seven_levels_of_the_entity_the_index_names() {
        // The need-bar panel's whole input. [D-5] says the DOM renders
        // simulation state and owns none of it, so this is read every
        // frame rather than cached, and it has to be readable for an
        // arbitrary raw index because a raw index is all the shell has.
        //
        // The levels are made pairwise DISTINCT before the read, so an
        // implementation returning a constant array, or one need's level
        // seven times, is visible. A fixture where every level agreed
        // could not tell those apart ([L34]).
        let mut handle = SimHandle::new(16, 16);
        let mut needs = Needs::all_at(NEED_MAX);
        for (offset, id) in NeedId::ALL.into_iter().enumerate() {
            needs.set(id, 10.0 + offset as f32);
        }
        let agent = handle
            .sim
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, needs))
            .id()
            .index_u32();

        let levels = handle.needs_of(agent);
        assert_eq!(
            levels.len(),
            NEED_COUNT,
            "all seven levels must cross, in NeedId index order"
        );
        for (offset, _) in NeedId::ALL.into_iter().enumerate() {
            assert_eq!(
                levels[offset],
                10.0 + offset as f32,
                "slot {offset} must carry the need at that NeedId index; \
                 a transposed or constant array is what this catches"
            );
        }
    }

    #[test]
    fn needs_of_returns_an_empty_array_for_an_index_with_no_needs_to_report() {
        // Three ways an index can have nothing to show, and all three
        // must answer the same harmless way rather than panicking: the
        // panel draws no bars. A stale index is the hostile one - it is
        // what a click on a sim that despawned between the frame and the
        // handler looks like - and an object index is the ordinary one,
        // because a fridge has no needs and the shell cannot tell a
        // fridge from a sim by its number alone.
        //
        // The live agent is asserted non-empty in the same test, so
        // "returns empty" cannot be satisfied by an accessor that returns
        // empty for everything.
        let mut handle = SimHandle::new(16, 16);
        assert!(handle.spawn_object(2.0, 2.0, "fridge"));
        let agent = spawn_agent_at(&mut handle, 1.0, 1.0, 40.0);
        let object = agent - 1;

        assert_eq!(
            handle.needs_of(agent).len(),
            NEED_COUNT,
            "the live sim must report levels, or every assertion below is \
             satisfied by an accessor that reports nothing for anything"
        );
        assert!(
            handle.needs_of(object).is_empty(),
            "a smart object has no needs; the panel must draw nothing \
             rather than seven zeroes, which would read as a desperate sim"
        );
        assert!(
            handle.needs_of(9_999).is_empty(),
            "an index past anything ever allocated must be ignored"
        );
        assert!(
            handle.needs_of(u32::MAX).is_empty(),
            "and so must u32::MAX, which is where a clamp or a wrap would \
             show"
        );
    }

    #[test]
    fn interaction_labels_report_the_named_objects_own_interactions() {
        // **The flyout's entire input.** The menu builds one row per entry
        // and the row's position is `Intent::interaction`, so an export
        // that reported the wrong object's list would label a verb with
        // another object's wording and still accept the click.
        //
        // TWO objects, with DIFFERENT labels, and both are asserted. An
        // export returning "the first object's interactions" satisfies a
        // single-object fixture, and so does one returning a constant;
        // that is [L34] wearing the flyout's costume.
        //
        // The expectations are read out of the pack rather than written as
        // literals, so re-wording a label in content/objects.toml does not
        // break this - and they are asserted to DIFFER, so reading them out
        // cannot make the comparison vacuous.
        let mut handle = SimHandle::new(16, 16);
        assert!(handle.spawn_object(1.0, 1.0, "fridge"));
        assert!(handle.spawn_object(3.0, 1.0, "toilet"));
        let (fridge, toilet) = (0, 1);

        let pack = handle.sim.world().resource::<Content>().0;
        let authored = |id: &str| -> Vec<String> {
            pack.object(pack.find(id).expect("shipped content declares it"))
                .interactions
                .iter()
                .map(|act| act.label.clone())
                .collect()
        };
        assert_ne!(
            authored("fridge"),
            authored("toilet"),
            "the two objects must be labelled differently, or this test \
             cannot see an export that ignores which one was named"
        );
        assert!(
            !authored("fridge").is_empty(),
            "an object with no interactions would make every assertion \
             below satisfied by an export that returns nothing"
        );

        // The fridge's rows are its interactions THEN its chains -
        // [K5]'s mapping, which is what makes row 1 the dinner without
        // the wire changing. The toilet advertises no chain, so its
        // list is its interactions alone.
        let mut fridge_rows = authored("fridge");
        fridge_rows.push("Cook dinner".to_string());
        assert_eq!(handle.interaction_labels(fridge), fridge_rows);
        assert_eq!(handle.interaction_labels(toilet), authored("toilet"));

        // And the labels are the AUTHORED wording rather than the
        // interaction ids they fall back to. Shipped content labels every
        // interaction, so an implementation that reported `act.id` would
        // reach here with `grab_snack` and the menu would show a
        // placeholder for the rest of the game's life.
        assert_ne!(
            handle.interaction_labels(fridge),
            pack.object(pack.find("fridge").expect("shipped"))
                .interactions
                .iter()
                .map(|act| act.id.clone())
                .collect::<Vec<_>>(),
            "shipped content must label its interactions with something \
             other than their ids, or the fallback and the label are \
             indistinguishable here"
        );
    }

    #[test]
    fn interaction_labels_are_empty_for_anything_that_is_not_a_smart_object() {
        // Three ways an index has no interactions to offer, all of which
        // must answer the same harmless way rather than panicking: a sim,
        // which carries no `SmartObject`; an index past anything ever
        // allocated, which is what a right click on a despawned entity
        // looks like; and `u32::MAX`, where a clamp or a wrap would show.
        //
        // The live object is asserted non-empty in the same test, so
        // "returns empty" cannot be satisfied by an export that returns
        // empty for everything - the [L51] rule, one must-be-positive case
        // beside the must-be-negative ones.
        let mut handle = SimHandle::new(16, 16);
        assert!(handle.spawn_object(2.0, 2.0, "fridge"));
        let agent = spawn_agent_at(&mut handle, 1.0, 1.0, 40.0);
        let object = agent - 1;

        assert!(
            !handle.interaction_labels(object).is_empty(),
            "the live object must report its interactions, or every \
             assertion below is satisfied by an export that reports \
             nothing for anything"
        );
        assert!(
            handle.interaction_labels(agent).is_empty(),
            "a sim offers no interactions; the flyout must not draw rows \
             for one, and it cannot tell a sim from an object by index"
        );
        assert!(
            handle.interaction_labels(9_999).is_empty(),
            "an index past anything ever allocated must be ignored"
        );
        assert!(
            handle.interaction_labels(u32::MAX).is_empty(),
            "and so must u32::MAX, which is where a clamp or a wrap would \
             show"
        );
    }

    #[test]
    fn need_names_label_the_slots_needs_of_returns_in_the_same_order() {
        // The two exports are a PAIR, and this is the only place the
        // pairing is checkable: the panel puts name `i` on level `i`, so
        // an ordering that disagreed between them would draw seven
        // correct numbers under seven wrong labels. Nothing renders
        // wrong, nothing errors, and every reading of the panel is off
        // by however far the lists have slipped.
        //
        // So this does not assert a literal list of names. A literal
        // list is a third copy that agrees with `need_names` by
        // construction and says nothing about `needs_of`. It sets each
        // need to a level that identifies its own INDEX and reads the
        // pair back together.
        let mut handle = SimHandle::new(16, 16);
        // A level per slot that no other slot shares, so a `needs_of`
        // returning one need's level seven times, or a constant array,
        // cannot agree with the labels by accident ([L34]).
        let mut needs = Needs::all_at(NEED_MAX);
        for (offset, id) in NeedId::ALL.into_iter().enumerate() {
            needs.set(id, 10.0 + offset as f32);
        }
        let agent = handle
            .sim
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, needs))
            .id()
            .index_u32();

        let names = handle.need_names();
        assert_eq!(
            names.len(),
            NEED_COUNT,
            "one label per need, or a bar goes unlabelled"
        );

        let levels = handle.needs_of(agent);
        assert_eq!(levels.len(), names.len());
        for (offset, id) in NeedId::ALL.into_iter().enumerate() {
            assert_eq!(
                names[offset],
                id.as_str(),
                "slot {offset} must be labelled with the need whose level \
                 needs_of puts there"
            );
            assert_eq!(
                levels[offset],
                10.0 + offset as f32,
                "slot {offset} must carry that need's level, or the two \
                 lists agree with each other and with nothing else"
            );
        }
    }

    #[test]
    fn need_max_is_the_level_a_satisfied_need_actually_reaches() {
        // Not `assert_eq!(handle.need_max(), 100.0)`, which is a second
        // copy of the constant agreeing with the first ([L29] again).
        // What the panel needs is that a need CANNOT exceed this, because
        // it is the denominator every bar is drawn against. So the check
        // is behavioural: fill a need past any plausible ceiling and read
        // back where it landed.
        let handle = SimHandle::new(8, 8);
        let ceiling = handle.need_max();

        let mut needs = Needs::all_at(NEED_MIN);
        needs.fill(NeedId::Hunger, ceiling * 10.0);
        assert_eq!(
            needs.get(NeedId::Hunger),
            ceiling,
            "a need saturates at what need_max reports, or every bar is \
             drawn against the wrong denominator"
        );
        assert!(ceiling > 0.0, "a ceiling of zero divides every bar by zero");
    }

    #[test]
    fn need_bar_refresh_ms_reports_the_authored_knob_rather_than_a_constant() {
        // This knob is read by NOTHING in the workspace - the shell reads
        // it across this boundary - so [L29] applies in full: its only
        // observable is this export. Without this test, a boundary that
        // returned a hardcoded 100 would be indistinguishable from one
        // that read the pack, and the tuning file would have stopped
        // being the knob's home the moment somebody edited it.
        //
        // So it is asserted CAUSALLY rather than by equality against the
        // shipped number. Comparing the export to the pack's own field
        // would pass for a body that returned the literal 100, since the
        // shipped knob IS 100; comparing it to the literal 100 would pass
        // for the same body even more easily. Both are the coincidence
        // docs/testing-protocol.md rule 3 warns about.
        //
        // Instead the world is pointed at a pack with a different value
        // and the export must MOVE. `Content` is a resource rather than a
        // direct call into `terri_data` precisely so a test can do this.
        let mut handle = SimHandle::from_lot();
        let shipped = handle.need_bar_refresh_ms();
        assert_ne!(
            shipped, 0,
            "the shipped value must not be zero, or the panel reads every \
             frame and the throttle this knob exists for does nothing"
        );

        // A value no other knob in the pack holds, so an export reading
        // its neighbour would report the neighbour's unchanged number.
        const RETUNED: u32 = 4_242;
        assert_ne!(shipped, RETUNED);
        let mut retuned = handle.sim.world().resource::<Content>().0.clone();
        retuned.tuning.need_bar_refresh_ms = RETUNED;
        // Leaked because `Content` holds a `&'static` - the shipped pack
        // is embedded and deserialised once. One leak in one test process
        // is the whole cost.
        handle
            .sim
            .world_mut()
            .insert_resource(Content(Box::leak(Box::new(retuned))));

        assert_eq!(
            handle.need_bar_refresh_ms(),
            RETUNED,
            "the boundary must report the pack's knob, not a constant of \
             its own and not a neighbouring field"
        );
    }

    #[test]
    fn selected_index_tracks_the_selection_the_simulation_holds() {
        // [D-5]'s round trip in full: the shell asks with a command and
        // reads the answer back out of the simulation, so a replay
        // reproduces the selection rather than the DOM remembering it.
        //
        // TWO agents, because an accessor returning "the first agent" or
        // "the only agent" would satisfy a single-agent fixture. And the
        // clear is asserted as well, because `Select(None)` is a separate
        // arm from a stale index and the two must not be conflated - one
        // clears, the other leaves the selection alone.
        let mut handle = SimHandle::new(16, 16);
        let first = spawn_agent_at(&mut handle, 1.0, 1.0, 80.0);
        let second = spawn_agent_at(&mut handle, 3.0, 1.0, 80.0);
        assert_ne!(first, second);

        assert!(handle.enqueue_command(&select_bytes(second)));
        handle.tick();
        assert_eq!(
            handle.selected_index(),
            Some(second),
            "the sim the command named must be the one reported, not \
             whichever the query yields first"
        );

        assert!(handle.enqueue_command(&select_bytes(first)));
        handle.tick();
        assert_eq!(
            handle.selected_index(),
            Some(first),
            "and selecting another must move it rather than leaving two \
             marked, which is a state the shell cannot render"
        );

        // `Select(None)`: variant 0, Option tag 0, no payload.
        assert!(handle.enqueue_command(&[0x00, 0x00]));
        handle.tick();
        assert_eq!(
            handle.selected_index(),
            None,
            "Select(None) must clear, or the player cannot deselect at all"
        );
    }

    #[test]
    fn a_directed_sim_overrides_what_it_would_have_chosen_for_itself() {
        // **The end-to-end claim of the whole milestone, measured through
        // the boundary rather than inside the simulation.** [D-3] says a
        // player-issued intent beats autonomy, and the simulation-side
        // test for that lives in `terri_sim::systems::command`. This one
        // exists because that test cannot see the boundary: every
        // assertion it makes would still hold with `enqueue_command`
        // returning `false` for every byte it is given.
        //
        // The sim is HUNGRY and the two objects advertise different
        // needs, so autonomy has an unambiguous preference for the
        // fridge. Directing it at the BED is therefore an instruction it
        // would never have given itself - a script whose commands agree
        // with autonomy proves nothing ([L36]).
        let mut handle = SimHandle::new(16, 16);
        assert!(handle.spawn_object(2.0, 8.0, "bed"));
        assert!(handle.spawn_object(11.0, 8.0, "fridge"));
        let bed = 0;
        let agent = spawn_agent_at(&mut handle, 8.0, 8.0, 20.0);
        assert_eq!(
            (bed, agent),
            (0, 2),
            "the assertions below read the render buffer by row, and rows \
             are sorted by entity index"
        );

        // What the sim does when nothing tells it otherwise, measured
        // rather than assumed. Without this the assertion below could be
        // describing autonomy's own choice.
        let mut autonomous = SimHandle::new(16, 16);
        assert!(autonomous.spawn_object(2.0, 8.0, "bed"));
        assert!(autonomous.spawn_object(11.0, 8.0, "fridge"));
        spawn_agent_at(&mut autonomous, 8.0, 8.0, 20.0);
        autonomous.tick();
        let undirected = autonomous.world_hash();

        assert!(handle.enqueue_command(&use_object_bytes(agent, bed, 0)));
        handle.tick();

        assert_ne!(
            handle.world_hash(),
            undirected,
            "the directed run must reach a different world from the \
             undirected one; equal digests mean the command never reached \
             the simulation and this test would pass with the whole \
             boundary sealed shut"
        );

        // And it walks WEST, towards the bed, rather than east towards
        // the fridge autonomy wanted. The digest inequality above cannot
        // say which way it went; this can.
        for _ in 0..20 {
            handle.tick();
        }
        assert_eq!(handle.entity_count(), 3);
        let rows = addressed(
            handle.positions_ptr(),
            handle.entity_count() * 2,
            "positions_ptr",
        );
        let x = rows[agent as usize * 2];
        assert!(
            x < 8.0,
            "a sim directed at the bed at x=2 must move towards it; it is \
             at x={x}, which is towards the fridge it would have chosen \
             for itself"
        );
    }

    /// Directs `agent` at `object` with `interaction`, runs `ticks` whole
    /// ticks, and returns how far east or west the sim got.
    ///
    /// Shared by the two runs the test below compares so that the only
    /// difference between them is the interaction index. A second
    /// hand-written fixture would be the place a stray extra tick or a
    /// different hunger crept in, and the whole claim is an inequality
    /// between two runs.
    fn directed_x(command: &[u8], agent: u32, ticks: u32) -> f32 {
        let mut handle = SimHandle::new(16, 16);
        assert!(handle.spawn_object(2.0, 8.0, "bed"));
        assert!(handle.spawn_object(11.0, 8.0, "fridge"));
        assert_eq!(
            spawn_agent_at(&mut handle, 8.0, 8.0, 20.0),
            agent,
            "the caller names the agent by literal index"
        );
        assert!(
            handle.enqueue_command(command),
            "the command must be accepted, or the two runs differ in \
             whether anything was sent rather than in the index"
        );
        for _ in 0..ticks {
            handle.tick();
        }
        let rows = addressed(
            handle.positions_ptr(),
            handle.entity_count() * 2,
            "positions_ptr",
        );
        rows[agent as usize * 2]
    }

    #[test]
    fn an_interaction_index_the_object_does_not_have_is_dropped_rather_than_clamped_or_trapping() {
        // **The interaction index is hostile input, exactly like the two
        // entity indices beside it** (docs/testing-protocol.md rule 8).
        // JavaScript writes all three, and `u32::MAX` is what a bug, a
        // stale menu, or someone typing into the console produces. Three
        // separate wrong answers are possible here and this rules out all
        // three:
        //
        //   - **a panic.** Nothing downstream indexes with this number
        //     until `serve_intents` has checked it, but a range check
        //     added here later "for safety" that used `expect` would trap
        //     the module for the rest of the page's life.
        //   - **a rejection at the boundary.** A well-formed command
        //     naming an index the content pack does not have is precisely
        //     what a saved command log replayed against a newer pack looks
        //     like, and `enqueue_command` deliberately leaves that to the
        //     drain rather than keeping a second, weaker copy of the rule -
        //     the same reasoning it applies to a stale entity index.
        //   - **a silent clamp.** This is the dangerous one, because it
        //     looks like it works: `min(interaction, len - 1)` or an
        //     `unwrap_or(0)` anywhere on the path would turn "use the verb
        //     that does not exist" into "use the first verb", so a shell
        //     bug would silently feed the sim instead of doing nothing.
        //
        // The clamp is what the two runs below distinguish, and nothing
        // cheaper can: interaction 0 IS a real interaction on the bed, so
        // a clamped `u32::MAX` and an honest 0 produce the same world.
        // Only comparing them says which happened.
        const TICKS: u32 = 20;
        let agent = 2;

        let honest = directed_x(&use_object_bytes(agent, 0, 0), agent, TICKS);
        assert!(
            honest < 8.0,
            "interaction 0 must send the sim WEST to the bed at x=2, or \
             the comparison below is between two sims that both ignored \
             their orders; it is at x={honest}"
        );

        let saturated = directed_x(
            &use_object_bytes_saturated_interaction(agent, 0),
            agent,
            TICKS,
        );
        assert!(
            saturated > 8.0,
            "an interaction the bed does not have must be DROPPED, leaving \
             the sim free to walk east to the fridge its hunger wanted; at \
             x={saturated} it went to the bed instead, which is the silent \
             clamp"
        );

        // And the module is still alive afterwards. On a genuinely trapped
        // module every later call throws rather than returning, so a test
        // that only measured positions could not tell a dropped intent
        // from a wasm trap that happened after the last tick.
        let mut handle = SimHandle::new(8, 8);
        let live = spawn_agent_at(&mut handle, 1.0, 1.0, 80.0);
        assert!(handle.enqueue_command(&use_object_bytes_saturated_interaction(live, 9)));
        handle.tick();
        assert!(
            handle.enqueue_command(&select_bytes(live)),
            "the boundary's job is to fail one command, not to end the \
             session"
        );
        handle.tick();
        assert_eq!(handle.selected_index(), Some(live));
    }

    #[test]
    fn prev_positions_ptr_addresses_the_frame_before_the_last_sync() {
        // Two frames with DIFFERENT coordinates. On a first sync prev is
        // seeded from the current frame, so a single-frame test would be
        // unable to tell `prev_positions_ptr` from `positions_ptr` - both
        // hypotheses predict the same numbers, per testing-protocol rule 7.
        //
        // The second frame is produced by syncing directly rather than by
        // ticking, which keeps this test about the pointer instead of
        // about what the systems do to an idle agent.
        let mut handle = SimHandle::new(16, 16);
        handle.spawn_agent(1.0, 1.0, 80.0);

        let mut state = handle.sim.world_mut().query::<&mut Position>();
        for mut position in state.iter_mut(handle.sim.world_mut()) {
            position.x = 5.0;
            position.y = 7.0;
        }
        handle.sim.sync_render_buffer();

        let rows = handle.entity_count() * 2;
        assert_eq!(
            addressed(handle.prev_positions_ptr(), rows, "prev_positions_ptr"),
            vec![1.0, 1.0],
            "prev_positions_ptr must address the frame before the last sync; \
             the renderer interpolates from it towards the current frame"
        );
        assert_eq!(
            addressed(handle.positions_ptr(), rows, "positions_ptr"),
            vec![5.0, 7.0],
            "the two pointers must address different buffers; aliasing them \
             would interpolate every entity from itself and freeze motion"
        );
    }
}
