# Lessons Learned

Gotchas and hard-won context. Read this before starting work; it is cheaper
than rediscovering any of it.

Entries are append-only and numbered. Do not renumber.

---

## [L1] Bare `cargo` does not link on this machine - RESOLVED 2026-07-27

**Status: fixed.** Adding the "Desktop development with C++" workload to VS
Community 2026 installed the desktop x64 CRT across all three toolsets
(14.44.35207, 14.51.36231, 14.52.36520). `cargo test --workspace` now passes
unwrapped. **The vcvars workaround below is no longer needed**; it is retained
because the diagnosis is what matters if this recurs.

**Watch item:** toolset 14.52.36520 appears to be the Preview build tools, and
`rustc` selects the newest toolset, so that is the one now in use. It is
complete today. Preview toolsets ship incomplete more often than releases, so
if this breaks again after a VS update, check this first.

**What happened:** Every cargo command failed at link time with `LNK1104: cannot
open file 'msvcrt.lib'`. It was rediscovered independently twice, costing
time both times.

**Root cause:** `rustc` auto-selects the **newest** Visual Studio install it
finds, with no check that the toolset is complete. Visual Studio Community 2026
(18.8) at `C:\Program Files\Microsoft Visual Studio\18\Community` shipped
toolset 14.51.36231 with only `lib\onecore`, no `lib\x64`, so the desktop x64
CRT is absent. A complete VS 2022 BuildTools install exists but is older, so
rustc ignores it.

**Workaround** (until [T21] in TIM-TODO.md is done): run cargo through the VS
2022 build environment. From PowerShell:

```
cmd /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" && cargo test --workspace'
```

The Bash tool mangles that quoted path; from Bash, write a small batch wrapper
in the scratchpad and invoke it via PowerShell instead. `vcvars64.bat` also
prints `'vswhere.exe' is not recognized` on this machine. Linking still
succeeds, but any tool that resolves components through vswhere will fail here
first.

**Permanent fix:** Visual Studio Installer, Modify on VS Community 2026,
Workloads tab, tick "Desktop development with C++". Note there is no "MSVC
v145" - VS 2026 renamed it to **"MSVC Build Tools for x64/x86 (Latest)"**, and
`v143`/`v142`/`v141` are legacy toolsets. Also **untick "MSVC Build Tools for
x64/x86 (Preview)"**, because a preview toolset alongside the release one
recreates exactly the "newest but incomplete" condition that caused this.

**How to verify:** in a new terminal,
`Get-ChildItem "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\*\lib\x64\msvcrt.lib"`
should print a path, and `cargo test -p terri-core` should pass unwrapped.

**Prevention rule:** CI runs on Linux and will never catch this class of
problem. Local toolchain breakage must be recorded here, not in a subagent's
transcript where the next agent cannot see it.

---

## [L2] A test file Rust never compiles is a false green, not a red

**What happened:** The M0 plan's Task 2 created `clock.rs` containing a test
module in one step, then added `pub mod clock;` to `lib.rs` in a later step.
The intervening "run the test and verify it fails" checkpoint would have
reported success with `0 filtered out`, because **Rust does not compile a `.rs`
file that no `mod` declaration references.** The checkpoint would have looked
red-then-green while never having compiled the test at all.

**Root cause:** TDD plans written top-down naturally introduce the file before
wiring it into the module tree, but Rust's module system makes wiring a
precondition for the file existing at all.

**Prevention rule:** in Rust, **declare `pub mod foo;` in the same step that
creates `foo.rs`**, never later. When verifying a red checkpoint, read the test
*count*, not just the exit status: `0 passed; 0 failed` is not a red, it is a
test that never ran.

**How to verify:** a genuine red for a missing symbol reports a compile error
such as `E0433: failed to resolve: use of undeclared type`. If you instead see
`0 filtered out` with no compile error, the test is not wired in.

---

## [L3] `bevy_ecs::World::try_query` returns `None` on unregistered components

**What happened:** Found during Task 1 API verification, before it could cause
damage. The M0 determinism test hashes world state and compares two runs. Had
it used `try_query` without eagerly registering components, a world that never
spawned a `Hunger` would have produced **zero rows**, and the test would have
passed by comparing two identical empty hashes - permanently green while
testing nothing.

**Root cause:** `try_query` returns `None` if **any** component in the query is
unregistered, including one behind `Option<&T>`. Registration normally happens
lazily on first spawn, so the failure only appears in worlds that never spawned
that component - exactly the edge cases a determinism test should cover.

**Prevention rule:** call `world.register_component::<T>()` in `Sim::new()` for
every component any query touches. `World::query` (requiring `&mut World`)
self-registers and does not have this problem; only `try_query` (taking
`&World`) does. **Any test that can pass on empty input needs an assertion that
the input was not empty.**

**How to verify:** spawn nothing, run the determinism test, and confirm it
still exercises rows rather than trivially comparing two empty hashes.

---

## [L5] A determinism test that runs twice in one process tests nothing

**What happened:** Three separate times, a test named for determinism could not
observe the mechanism it existed to protect. Each was caught in review, not by
running the suite, because each was permanently green.

1. `pathfinding_is_deterministic` compared two `find_path` calls. `find_path` is
   pure and takes `&self`, so the two **cannot** disagree by construction.
   Deleting the A* f-score tie-break left every test passing.
2. The world-hash determinism test compared two runs' hashes. Two empty hashes
   compare equal, so it would have passed if the hash saw zero rows.
3. `select_action`'s agent sort, score tie-break, and in-tick double-claim guard
   all had zero coverage. Deleting any of the three left all 27 tests green.

**Root cause:** within one process, iteration order is deterministic for a fixed
archetype and spawn order. So a two-run comparison compares **two identical
wrong answers**. The failure modes these tests target are cross-*version*,
cross-*target*, and cross-*history*, none of which a same-process A/B can see.

**Prevention rule: pin determinism with a golden assertion, never with a
self-comparison.** Assert the one specific output - the exact path, the exact
winning entity - for an input where the mechanism actually fires. That is
stable only if the mechanism exists, so deleting it fails the test.

**The ECS-specific trap, which is subtle:** a test that spawns N entities
sequentially puts them all in one archetype, where table order already equals
index order. Such a test passes with the sort deleted. **You must induce
archetype churn to make the two orders differ** - insert then remove a component
on one entity, which swap-removes it from its table and re-appends it at the
back. Two lines reproduce what a few minutes of gameplay does naturally, since
agents change archetype every time `Target`, `Path`, or `Eating` is added or
removed. Without the sort, who wins a contended object becomes a function of
interaction history.

**How to verify: mutation-test it.** Delete the mechanism, confirm the test
fails, restore, confirm the tree is byte-identical. **A test claiming to pin a
mechanism it cannot detect is worse than no test**, because it also removes the
suspicion that would otherwise prompt someone to check.

---

## [L4] `cargo tree` reports an inert web dependency path for `terri-core`

**What happened:** The project's load-bearing rule is that `terri-core` and
`terri-sim` never depend on `wasm-bindgen` or `web-sys`. A naive
`cargo tree | grep` check appears to violate it:

```
terri-core -> bevy_ecs -> bevy_reflect -> bevy_reflect_derive -> uuid -> js-sys -> wasm-bindgen
```

**Root cause:** the path is real in the dependency graph but inert in every
build. `bevy_reflect_derive` is a proc-macro, so it always builds for the
**host**, where `uuid`'s `cfg(all(target_arch = "wasm32", target_os =
"unknown"))` block is inactive. `Cargo.lock` also records unactivated optional
dependencies regardless of feature resolution, so the lockfile names web crates
that never link.

**Prevention rule:** the CI purity check must name **explicit targets**
(`x86_64-unknown-linux-gnu` and `wasm32-unknown-unknown`), never bare
`cargo tree` and never `--target all`. A check that fails spuriously trains
everyone to ignore it, which is worse than no check.

**How to verify:** `cargo tree -p terri-core --target wasm32-unknown-unknown`
and the same for the host target should both be clean of `wasm-bindgen`,
`web-sys`, and `js-sys`.

**Precision correction, measured during Task 7 on cargo 1.94.1:** a *bare*
`cargo tree` is clean. `--target` defaults to the **host** platform, so on both
this Windows box and CI's Linux runner the inert path is already filtered out.
The path only appears under `--target all`. [L4]'s prevention rule is unchanged
and still right - naming explicit targets is what makes the check mean something
rather than accidentally depending on whatever host it runs on - but do not
expect a bare `cargo tree | grep` to be the thing that fails.

---

## [L6] The world-hash sort is pinned by a cross-history test, not by the A/B

**What happened:** Task 7 added `Sim::world_hash` and the determinism test
[D12] calls the highest-value test in the project. Mutation-testing it confirmed
[L5] exactly: **deleting `rows.sort_by_key` in `world_hash` left
`identical_scenarios_produce_identical_world_hashes` green.** Two scenarios
built identically in one process share an archetype layout, so both hash their
rows in the same wrong order and agree. The brief's empty-world guard does not
help here either - the rows are present, just misordered.

**What does catch it:** `hash_ignores_archetype_layout_and_entity_history`.
Two runs reach the same tick count by different histories - run B additionally
spawns a bystander entity, ticks, despawns it, and insert/removes `Eating` on
its lowest-index agent to swap-remove that agent to the back of its table.
Neither touches what the simulation computes (the bystander matches no system's
query, and the insert/remove pair happens between ticks), but both change ECS
iteration order. With the sort deleted, this test fails; with it present, it
passes.

**The part that keeps it honest:** the test asserts its own precondition. Before
comparing hashes it asserts the two worlds' **raw, unsorted iteration orders
still differ** at that moment, and that they hold the same entity set. Without
that assertion the test would silently decay into a second copy of the A/B if
the two layouts ever reconverged over 500 ticks. Measured: they do not
reconverge at 500 ticks, but that is an observation, not a guarantee, which is
why the assertion is there rather than a comment.

**Prevention rule:** for any state-digest function, the test that pins the
canonical ordering must compare **two worlds with different histories**, and
must assert that their underlying iteration orders actually differ. A
same-process A/B pins reproducibility only. Reproducibility is not the property
Layer 2 needs; layout-insensitivity is.

**How to verify:** delete `rows.sort_by_key` in `Sim::world_hash` and run
`cargo test -p terri-sim`. Exactly
`determinism_tests::hash_ignores_archetype_layout_and_entity_history` must fail.
If instead everything is green, the sort is unprotected again. Note this pins
one mechanism out of four; see [L7] for the other three.

**Scope correction, Task 7 review:** the wording above and the test's own
comment both overclaimed. "Two worlds holding the same logical state hash the
same even when they reached it by different histories" is only true when
**entity index allocation also coincides**. `world_hash` keys its rows on
`Entity::index_u32()`, and that index *is* allocation history, so the
motivating scenario named in the comment - a peer that joined late - would
allocate different indices for the same logical entities and hash differently.
Entity generation is unhashed as well, so a despawn/respawn that reuses an
index aliases with the original. What the test actually pins is narrower and
still worth having: **insensitivity to archetype/table layout, given the same
set of entity indices.** Layer 2 will need a stable network id in place of the
raw index before the broader claim becomes true. Both files now say so; do not
let the broad phrasing creep back.

---

## [L7] An untested guard is indistinguishable from no guard

**What happened:** this is the **fifth** recorded instance of the same trap
([L2], [L3], [L5], [L6]), and the new part is where it hid. [L3] said "any test
that can pass on empty input needs an assertion that the input was not empty",
so Task 7 dutifully added one to both hash determinism tests:

```rust
let empty = Sim::new_with_lot(24, 24);
assert_ne!(a.world_hash(), empty.world_hash(), "the hash is seeing no entities");
```

That guard was inert. `world_hash` writes the clock tick **before** the entity
rows, and `empty` was **never ticked**, so it sat at tick 0 while `a` was at
tick 500. The clock term alone made the two digests differ. The guard passed
unconditionally, for a reason that had nothing to do with entities.

Measured consequence, before the fix: **deleting the entire row-collection
block and the emit loop from `world_hash` left all three determinism tests
green.** So did deleting only `write_f32(x)`/`write_f32(y)`, and so did
deleting only `write_f32(hunger)`. Of the four mechanisms in `world_hash` - row
collection, position writes, hunger write, `sort_by_key` - exactly one, the
sort, was actually pinned, and by [L6]'s cross-history test rather than by the
guard. The guard written specifically to catch the other kind of failure caught
nothing.

**Root cause, and this is the generalisable part: a guard is a mechanism like
any other, so an unverified guard carries exactly as much weight as an
unverified test - none.** [L5] already said to mutation-test the *mechanism*.
Nobody mutation-tested the *guard*, because a guard reads like scaffolding
rather than like a claim. It is a claim.

The specific shape of the failure: the guard compared two digests that differed
in **an unrelated term** (the clock). A differential guard is evidence about
the term it names only if **every other term is held constant**. Otherwise it
passes for the wrong reason, and passing for the wrong reason is silent.

**Prevention rule:**

1. **Mutation-test the guard, not just the mechanism.** Delete the thing the
   guard claims to protect and confirm the guard is what fails. If some other
   test fails first, the guard itself still has no evidence behind it.
2. **A differential guard must hold every other input constant.** If the digest
   covers a clock and some rows, either advance the control world to the same
   tick or freeze the clock, and assert that equality as a precondition. Better
   still, write a test that can only move for one reason:
   `hash_observes_entity_state_not_only_the_clock` never ticks at all, mutates
   one field on one entity and restores it, so the row block is the only thing
   that can move the digest.
3. **Count the mechanisms and check them off individually.** "The suite is
   green" says nothing about coverage. `world_hash` has four; write the list
   down and mutate each one separately.

**How to verify:** apply each of these four mutations to `Sim::world_hash`
independently, run `cargo test -p terri-sim`, restore, and confirm the file is
byte-identical (`git hash-object`) before the next one.

| mutation | must fail |
| --- | --- |
| delete the `if let Some(...)` row collection and the emit loop | `identical_scenarios...`, `hash_ignores_archetype_layout...`, `hash_observes_entity_state...` |
| delete `write_f32(x)` and `write_f32(y)` | `hash_observes_entity_state...` |
| delete `write_f32(hunger)` | `hash_observes_entity_state...` |
| delete `rows.sort_by_key` | `hash_ignores_archetype_layout...` |

If a mutation leaves the suite green, say so plainly rather than adjusting the
test until it looks right. A test tuned until it passes is how this entry came
to be written.

**The same failure shape in CI, found in the same review.** The [D1] web-purity
check was written as `if cargo tree ... | grep -E ...`. A pipeline used directly
as an `if` condition is **exempt from `errexit`**, and `pipefail` does not help
because grep's no-match exit 1 is the rightmost status anyway. Reproduced with a
stub `cargo` exiting 101: the old form ran all four iterations and exited **0**,
so a renamed crate, a crate moved out of the workspace, a bad target triple, or
a registry hiccup would have made the check vacuously green - the identical
"passes for the wrong reason" pattern, in YAML instead of Rust. The fix is to
capture first, `tree=$(cargo tree ...)`, which puts the failure back under
`errexit`; the same stub then yields exit 101. **Prevention rule: never put a
command whose failure matters inside an `if` condition or the left side of a
pipe.** How to verify: put a stub `cargo` that exits non-zero first on `PATH`
and confirm the step still fails.

---

## [L8] `git hash-object` proves content, not what cargo will run

**What happened:** A mutation-testing harness restored source files with
`shutil.copy2`, which preserves mtime. Cargo's freshness check is mtime-based,
so the restored file looked **older** than the artifact built from the mutant,
and a plain `cargo test --workspace` afterwards silently ran the **mutated
binary** against unmutated source. The tree was provably correct by
`git hash-object` and the tests were red anyway.

**Root cause:** content identity and build identity are different things. Any
verification that ends at "the bytes match" has checked the wrong invariant if
what happens next is a build.

This instance landed red, which is the safe direction and is why it was caught.
**The symmetric case is a false green:** restore a file, get a stale artifact
that still contains the fix, and conclude a mutation was caught when it was not.
That would silently corrupt every row of a mutation-testing table, which is
precisely the evidence this project now relies on.

**Prevention rule:** any harness that edits source in place and relies on cargo
to rebuild must **touch the file after restoring it**, stamping a fresh mtime.
Applying a mutation is safe by accident, because writing the file stamps it; the
restore is the dangerous half. Assert the suite is green after every restore,
not only that the bytes match.

**How to verify:** after restoring, confirm both that `git status` is clean and
that the suite passes. If the bytes are identical but the tests are red, you are
running a stale artifact, not observing a real failure.

---

## [L9] `git checkout <path>` is not a mutation restore; it is a discard

**What happened:** During Task 8's mutation verification, a second mutation was
applied to `crates/terri-sim/src/lib.rs` with a script and then "restored" with
`git checkout crates/terri-sim/src/lib.rs`. That command restores the file from
the **index**, and the index held the *committed* version, so it did not undo
the mutation - it reverted the entire task's uncommitted work in that file:
the `render_buffer` module declaration, the `render` field, `sync_render_buffer`,
`render_buffer()`, and the new golden-vector test. All of it, silently, exit 0.

The loss was caught because `git hash-object` on the restored file printed a
hash that did not match the pre-mutation one. Without that check the next step
would have been a commit of a half-finished task.

**Root cause:** this project's mandated workflow is to mutation-test on an
**uncommitted** tree ([L5] rule 1, run before the task's own commit). Every git
command that "restores a file" restores it to a committed or staged state, which
on an uncommitted tree is the *start of the task*, not the state one line ago.
The mental model "checkout undoes my last edit" is right only when the last edit
is the only uncommitted change to that file - which during a task is exactly the
condition that does not hold.

**Prevention rule:**

1. **Restore a mutation by inverting the exact edit**, never with `git checkout`,
   `git restore`, `git stash`, or `git reset --hard`. If a harness needs a
   restore mechanism, have it snapshot the file's bytes to the scratchpad
   *before* mutating and write those exact bytes back.
2. **Record `git hash-object <file>` before applying any mutation and assert it
   again after restoring.** This is what caught the loss, and it is cheap. [L8]
   already required the byte check for a different reason; it earns its place
   twice.
3. If a mutation is worth running against a large uncommitted change, consider
   committing the task first and mutating on top, so `git checkout` is a correct
   restore rather than a trap. Amending afterwards is cheaper than reconstructing
   lost work.

**How to verify:** apply a mutation, restore it, and confirm `git hash-object`
matches the value recorded before the mutation. If it instead matches
`git hash-object HEAD:<path>`, the restore reverted the whole task.

---

## [L10] `--target web` has no importable `memory`, and three things detach, not one

**What happened:** Task 9's brief specified
`import { memory } from './wasm/terri_wasm_bg.wasm'`. That cannot resolve.
`wasm-pack --target web` emits a `_bg.wasm` whose import section names
`./terri_wasm_bg.js`, a glue module **only produced for `--target bundler`**.
Under Vitest the failure is
`Cannot find module './terri_wasm_bg.js' imported from src/wasm/terri_wasm_bg.wasm`,
and it would fail the same way under a Vite browser build.

**Root cause:** the two wasm-pack targets ship different module topologies.
`--target web` puts the glue in `terri_wasm.js` and expects you to call
`init()`; the `.wasm` is an asset it fetches, not an ES module a bundler links.
`terri_wasm_bg.wasm.d.ts` still declares `export const memory`, so the import
typechecks and only fails at resolve time - the type declaration describes the
bundler layout regardless of which target was built.

**Prevention rule:** get the `WebAssembly.Memory` from what `init()` resolves
to. It resolves to the instance's export object, so `(await init()).memory` is
the real `WebAssembly.Memory`. `SimBridge` takes it as a constructor argument
rather than reading a module-level global, which also makes it injectable in
tests. If the build ever moves to `--target bundler`, the direct import becomes
available and the constructor argument can go; do not assume it works before
checking which target `wasm-pack` was invoked with.

**The second half, which is the more valuable part.** "Do not cache the view"
undersells the problem. **Three** things must be re-read on every access, and
caching any one of them is the same bug:

| cached | what breaks | which assertion catches it |
| --- | --- | --- |
| `memory.buffer` | old `ArrayBuffer` detaches on growth | `TypeError: Cannot perform Construct on a detached ArrayBuffer` |
| the pointer | the `Vec` reallocates on growth and moves | `pos.some((v) => v !== 0)` |
| the length | spawns change the entity count | `pos.length` |

The `WebAssembly.Memory` object itself **is** stable across growth, which is why
it is safe to hold; its `.buffer` is not. Measured on this build: a 64x64 sim
starts at 1179648 bytes and grows at the **256th** spawned agent, reaching
1507328 bytes by 2000.

The pointer row is the one that nearly slipped. With a stale pointer the view
still has the right **length**, so `expect(pos.length).toBe(4000)` passes; it
points at zeroed static memory, so only `expect(pos.some((v) => v !== 0))`
fails. A growth test that checked length alone would have missed one of the
three mechanisms entirely. Count the mechanisms and mutate each separately,
per [L7].

**How to verify:** in `web/src/bridge.ts`, independently (a) cache the three
views in constructor fields, (b) cache `memory.buffer`, (c) cache the pointers,
(d) cache the count. Run `cd web && npm test` after each and restore by writing
back a byte snapshot, never with `git checkout` ([L9]). Expected: (a), (c), (d)
each fail 5 of 6 tests; (b) fails exactly the two growth tests and leaves the
other four green, which is what proves those two are the growth guard rather
than incidentally-passing duplicates of the others.

---

## [L11] Two samples cannot tell "lags by one" from "frozen at the first"

**What happened:** the **sixth** instance of the family ([L2], [L3], [L5], [L6],
[L7]), and the first one where the test's *shape* was right and only its
*length* was wrong. `prev_positions_lag_by_one_sync` synced twice and asserted
`prev == frame 1` while `positions == frame 2`. A reviewer deleted
`std::mem::swap(&mut self.render.prev_positions, &mut self.render.positions)`
from `sync_render_buffer` and **all 31 `terri-sim` tests stayed green**,
including that one.

**Root cause, and it is arithmetic rather than ECS trivia.** Without the swap,
`prev_positions` is written by one branch only: the reseed that fires when the
row count changes. Sync 1 reseeds (0 != 2) and leaves prev holding frame 1.
Sync 2 finds the lengths equal, writes nothing, and prev *still* holds frame 1 -
which is exactly what the test asserted. **Two observations are consistent with
two different hypotheses**, "prev lags by one frame" and "prev is frozen at the
first frame", and they only diverge on the third. A test cannot discriminate
between hypotheses that agree on every sample it takes.

The consequence would have been total and silent. `prev_positions` would freeze
at the last frame where the entity count changed, so Task 12 would tween every
entity from its spawn position towards its current position, every frame,
forever, with the suite green throughout.

**Why the automated backstop did not help, which is the part worth keeping:**
`cargo mutants` does **not** emit statement-deletion mutants. It rewrites
expressions and return values. So its "0 survivors" on this file was
simultaneously true and no evidence at all about a deleted statement. Rule 2 of
`testing-protocol.md` already says the tool is a backstop and not a replacement
for hand mutation; this is the concrete shape of what it cannot see. **Whole
statements whose only effect is on state - `swap`, `clear`, `sort`, `push`,
`insert` - are outside its mutation grammar and must be deleted by hand.**

**Prevention rule: for any invariant of the form "X lags/leads/differs from Y
by exactly N", the test needs at least N + 2 observations.** N + 1 is where the
relation first becomes expressible; N + 2 is the first point where a *frozen*
or *saturated* alternative predicts something different. State the degenerate
alternative out loud - "what else would produce these same numbers?" - and add
samples until it is excluded.

**How to verify:** delete the `std::mem::swap` line from `sync_render_buffer`
and run `cargo test -p terri-sim`. Exactly
`render_buffer::tests::prev_positions_lag_by_one_sync` must fail, with
`left: 0.0, right: 3.0` - 0.0 being the frozen first frame and 3.0 the correct
lagged one. Restore from a scratchpad byte snapshot, never with `git checkout`
([L9]), and touch the file ([L8]).

---

## [L12] `debug_assert!` is not a boundary check, because the shipped build is release

**What happened:** `Sim::world_hash` encodes "this entity has no `Hunger`" as
the **in-band** value `-1.0`, and guards the collision with a `debug_assert!`.
That was sufficient through Task 7, when nothing outside Rust could construct a
`Hunger`. Task 8 exported `SimHandle::spawn_agent(x, y, hunger)` to JavaScript
and made the value caller-supplied, at which point the guard became inert on
the only target that ships: `wasm-pack build` produces a **release** build, and
`debug_assert!` compiles out of it. Measured before the fix, in `--release`:
an agent spawned with `Hunger(-1.0)` and a Hunger-less entity at the same
position both digested to `0xCA2474BB3E44B36C`.

The same export made `f32::NAN` reachable, and NaN does not self-heal.
`f32::clamp` **propagates** NaN rather than replacing it, so a clamp alone is
not a fix; `advertise.rs` documents where it ends up, since NaN loses every
comparison and the agent "would simply never choose to do anything, forever,
with no panic and no log".

**Root cause:** adding an FFI export silently reclassifies every argument from
"internal, therefore trusted" to "external, therefore hostile", but nothing in
the type system or the build marks the reclassification. The old guard was not
weakened by the change; the change moved the guard to the wrong side of the
boundary and to the wrong build profile.

**Prevention rule:**

1. **Validate at the crate where untrusted input enters, which is
   `terri-wasm`.** `terri-core` and `terri-sim` keep the right to assume their
   inputs are valid; that assumption is what makes them testable. Pushing
   validation down into them would spread boundary concerns through the whole
   simulation.
2. **`debug_assert!` documents an invariant; it does not enforce one.** If a
   value can arrive from outside Rust, the check must survive `--release`.
3. **A NaN check is a separate branch from a range clamp.** `x.clamp(lo, hi)`
   returns NaN for NaN input, so "I clamped it" is not "it is in range".
4. Whenever a new argument is added to a `#[wasm_bindgen]` function, ask which
   `debug_assert!`s downstream of it just became unreachable.

**How to verify:** replace `sanitize_hunger` in `crates/terri-wasm/src/lib.rs`
with the identity function and run `cargo test -p terri-wasm --release`. Four
tests must fail, and
`hunger_from_js_cannot_alias_the_world_hash_no_hunger_sentinel` must fail with
`left` and `right` **equal** - that equality is the collision itself. The
`--release` flag is load-bearing: in a debug build `terri-sim`'s
`debug_assert!` panics first, so the test fails for the wrong reason and you
never observe the digest collision the boundary actually has to prevent. Do the
same with `sanitize_coord`; exactly the two coordinate tests must fail.

---

## [L13] The native golden hash vector never crossed the boundary it was written for

**What happened:** `world_hash_matches_its_golden_vector`'s doc claimed it was
"a cross-platform check for free: CI runs on Linux and this machine is
Windows". True, and irrelevant to the risk Task 8 introduced. The platform pair
that now matters is **native versus wasm32**, and that test runs natively on
both sides of its own comparison, so wasm was never in it.

The gap was concrete rather than theoretical. `FnvHasher::write_f32` calls
`f32::round`, which is **round-half-away-from-zero** in Rust and does *not* map
to wasm's `f32.nearest` (**round-half-to-even**), so rustc must emit a
different code path on wasm32. Every position and every hunger level in the
digest passes through that call.

**Measured outcome: they agree.** Rebuilding the identical scenario through the
JavaScript API - `new SimHandle(24, 24)`, `spawn_object(18, 14)`, eight
`spawn_agent(1 + i, 1, 30 + 5 * i)`, 100 `tick()` - yields
`0xEF601D504790_5825`, the same constant the native test asserts. This is a
reassuring result, not a vacuous one: it was verified by mutation, and it means
the quantizer's `round` call is not currently landing on a half-way value where
the two rounding modes differ. It is **not** a proof that they never will. The
quantizer multiplies by 10 000 before rounding, and a coordinate that lands
exactly on `n + 0.5` after that scaling would diverge.

**Prevention rule:** a golden vector pins the boundary it is *evaluated*
across, not the boundary it *mentions*. If two build targets consume the same
constant, assert it from both, and say in each place that the other exists -
otherwise the next person to legitimately move the constant updates one copy
and the pair silently stops being a comparison.

**How to verify:** the constant now appears twice, in
`crates/terri-sim/src/lib.rs` and `web/tests/bridge.test.ts`, each pointing at
the other. To confirm the web side is real rather than decorative, delete
`hasher.write_f32(y)` from `world_hash`, run
`wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`,
then `cd web && npm test`: exactly the boundary test fails, with
`expected 14804735595947770788n to be 17248818803464230949n`. Restore, rebuild,
re-run. Skipping the rebuild is the [L8] trap wearing a different hat, since
`npm test` reads the previously emitted `.wasm` and has no idea the Rust source
moved.

---

## [L14] "The page loaded with no console errors" is not evidence a renderer ran

**What happened:** Task 10's browser check was specified as "load the page,
confirm no console or WebGPU validation errors". That check passed immediately
and meant nothing. The agent-driven Browser pane runs the tab **hidden**, and a
hidden tab is not composited, so `requestAnimationFrame` **never fires**.
`SpriteRenderer.draw` sits inside the rAF callback, so it had not been called
once. Measured: `document.visibilityState === 'hidden'` and **0 rAF callbacks
per second**. The canvas read back as `0,0,0,0` across all 921 600 pixels.

A green "no errors" here is the project's recurring failure shape ([L5], [L6],
[L7], [L11]) in a new costume: **the check passed because the code under test
never executed.** Nothing about the console output distinguishes "the pipeline
is correct" from "the pipeline never ran".

**Second, self-inflicted half.** The first probe called
`canvas.getContext('2d')` to ask "is this a WebGPU canvas?". `getContext`
**permanently binds a canvas to the first context type requested**, so that
probe would have made every later `getContext('webgpu')` return `null` and
broken `initDevice` for the rest of the page's life. A diagnostic that mutates
the thing it measures is worse than no diagnostic. The non-destructive form is
`canvas.getContext('webgpu')`, which is idempotent and returns the existing
context.

**Prevention rule, for every GPU verification in this project:**

1. **Drive the draw yourself; never rely on rAF in an agent-driven browser.**
   Dynamic-import the real modules from the Vite dev server
   (`await import('/src/render/sprites.ts')`), build a canvas, and call `draw`
   directly. This exercises the shipped code path, not a mock.
2. **Wrap GPU work in explicit error scopes** rather than reading the console.
   `device.pushErrorScope('validation')` / `popErrorScope()` returns the error
   object, so "no validation error" becomes an assertion with a value behind it
   instead of an absence of log lines.
3. **Read pixels back and assert on them.** `ctx2d.drawImage(webgpuCanvas, 0, 0)`
   then `getImageData` works, is non-destructive to the source canvas, and turns
   "it rendered" into arithmetic. Await `queue.onSubmittedWorkDone()` and one
   macrotask first, because a WebGPU canvas presents at the end of the task.
4. **Assert a pixel count, not just a colour.** A 24x24 tile must cover exactly
   576 pixels. That catches a collapsed or degenerate triangle, which a
   "some orange is present" check does not.

**How to verify a depth-buffer claim specifically,** since [D10] rests on it:
draw two overlapping quads, hold **draw order constant**, and swap only their
depth values. The winner must flip. If the winner never changes, painter's order
is deciding and the depth buffer is inert. Measured on this pipeline: agent at
depth 0.1 beats object at 0.9, and object at 0.1 beats agent at 0.9, with the
agent written to instance slot 0 both times.

**Measured facts worth keeping.** The WGSL in `sprites.wgsl` compiles clean on
Chrome/NVIDIA Ada: a module-scope `const CORNERS = array<vec2<f32>, 6>(...)`
indexed by a runtime `@builtin(vertex_index)` is legal, and the trailing `;`
after a `struct` declaration parses. Preferred canvas format here is
`bgra8unorm`. Clear colour `0.09, 0.09, 0.11` reads back as exactly `23, 23, 28`.

---

## [L15] A mutation that loops forever hangs the harness, because Windows kills only the direct child

**What happened:** Task 10's mutation set included removing the `Math.max`
floor from `growCapacity`, which turns `while (next < needed) next *= 2` into an
infinite loop when capacity is 0. Python's `subprocess.run(timeout=...)` fired,
killed `npm.cmd`, and then **blocked forever** anyway: the `node` grandchild
running vitest survived, held the inherited stdout pipe open, and the reader
threads never saw EOF. The harness had to be killed from outside, leaving the
mutation applied on disk.

Two smaller traps came with it. `subprocess.run(text=True)` decoded vitest's
UTF-8 box-drawing output with the console's **cp1252** codepage and killed both
reader threads with `UnicodeDecodeError`, silently emptying the captured output
so every mutation's evidence was blank. And the machine had ~95 unrelated
`node.exe` processes running, so "kill all node" was never an option.

**Prevention rule for mutation harnesses on this machine:**

1. **Redirect subprocess output to a file and decode it yourself** with
   `errors="replace"`. Do not use `text=True` with vitest or cargo.
2. **Kill the process tree, not the process:** `Popen`, poll against a deadline,
   then `taskkill /F /T /PID <pid>`. `/T` is the load-bearing flag.
3. **Identify your own processes by command line before killing anything.**
   `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*vitest*' }`
   pins the exact PIDs. Never kill by image name on this box.
4. **A mutation whose detection is a hang is still a detection, but say so
   plainly.** Report it as TIMEOUT rather than FAIL. The test never goes green,
   which is what "the mutation was caught" means, but in CI a hang burns the job
   timeout instead of printing an assertion, so it is a weaker signal than a
   failure and should be described as one.

**How to verify:** apply the `let next = current;` mutation to `growCapacity`
in `web/src/render/instances.ts` and run `npm test` under a deadline. Expected:
the suite never terminates. Restore from a scratchpad byte snapshot, never with
`git checkout` ([L9]), and confirm `git hash-object` matches the pre-mutation
value.

**Addendum, M0 close-out: the restore must be in a `finally`, and the
harness must not print.** Rule 1 above says to decode *subprocess* output
with `errors="replace"`. That is not the whole of it - the harness then
**printed** vitest's captured output to a cp1252 console, died with
`UnicodeEncodeError` mid-report, and skipped its own restore, leaving
`depthCompare: 'greater'` on disk. Caught by `git status`, so the cost was
one minute, but the same crash one step earlier in a longer run is how a
mutation gets committed.

Two rules, and the second matters more than the first:

1. **Write the report to a UTF-8 file and read it afterwards. Never
   `print()` captured tool output on this machine.** Both directions of
   the console codepage are hostile, not just the decode side.
2. **Put the restore in a `finally`, so reporting cannot precede it.** The
   restore is the invariant; the report is a side effect. Any harness
   where a formatting bug can skip the restore is one exception away from
   the [L9] failure it was written to avoid.

---

## [L16] The Task 11 brief shipped an inverted depth mapping and a test that pinned it

**What happened:** the M0 plan's Task 11 section (`worldDepth` in
`docs/plans/2026-07-26-m0-walking-skeleton.md`, and the brief cut from it)
specified `return (wx + wy) / maxSum`, with a doc comment reading "Tiles farther
from the camera (lower x + y) get smaller values and therefore draw behind,
since the pipeline compares with 'less'." That sentence is self-refuting.
`sprites.ts` sets `depthCompare: 'less'` against `depthClearValue: 1.0`, so the
**smaller** depth wins the pixel; [L14] and [V3] in
`docs/gpu-verification.md` measured exactly that. Smaller
values draw **in front**, not behind. The prose states the correct intent and
the code does the opposite of it.

The projection settles which end is which, so this is not a matter of taste.
`worldToScreen` returns `(wx + wy) * TILE_HALF_HEIGHT`, `sprites.wgsl` flips Y
(`1.0 - screen.y / u.viewport.y * 2.0`), and `main.ts` puts `originY` at 80, near
the top. So screen y grows downward, a larger x + y draws lower on the screen,
and lower on the screen is nearer the camera. Near must take the smaller depth.
Shipped as written, every entity would have been occluded by whatever was
**behind** it: a sim standing in front of the fridge would be drawn inside it.

**The part that makes this another instance of [L5], [L6], [L7], [L11]:** the
brief's own test was `expect(worldDepth(0, 0, 64)).toBeLessThan(worldDepth(10,
10, 64))` under the name *"gives farther tiles smaller depth so they draw
behind"*. It would have passed. It names the invariant correctly, asserts its
negation, and goes green - so it would have converted the bug from a visible
mistake into a pinned requirement, and the next person to fix the rendering
would have had to delete a test to do it. The brief's other five tests were all
compatible with the inversion too: three of them (`clamps out-of-grid...`,
`keeps depth finite...`) did not exist, and "keeps depth inside the clip range"
passes for either sense because both are in [0, 1].

**Root cause:** the sense of a depth value is not a property of the depth
function. It is a joint property of four things in four different files - the
compare op and clear value in `sprites.ts`, the Y flip in `sprites.wgsl`, the
sign of the y term in `iso.ts`, and the choice of `originY` in `main.ts`. Nobody
reviewing `worldDepth` alone can tell whether it is inverted, and the type
system connects none of them. `number` in [0, 1] is `number` in [0, 1].

**Prevention rule:**

1. **For any value whose meaning is fixed elsewhere - depth, winding order,
   handedness, a sort key read by a comparator you did not write - state the
   external convention in the test, then derive the assertion from it.** The
   test name here is `orders the far corner behind the near corner for a
   less-than test`: it carries `less` in the name, so a reader can check the
   claim against `sprites.ts` without re-deriving the whole chain.
2. **A doc comment that contradicts the code next to it is a defect report, not
   a typo.** Two independent statements of intent disagreed here and the
   disagreement was visible in six lines of adjacent text. Read the comment
   against the code before trusting either.
3. **A brief is an input, not an authority.** Where a brief's code and its stated
   requirement disagree, the hardware behaviour that Task 10 measured settles it.
   Implement the requirement and report the deviation loudly.

**How to verify:** invert `worldDepth` in `web/src/render/iso.ts` back to the
brief's `Math.min(1, Math.max(0, nearness))` and run `cd web && npm test`. Four
tests must fail, the first with
`AssertionError: expected 0 to be greater than 0.15873015873015872`. Restore
from a scratchpad byte snapshot, never with `git checkout` ([L9]).

---

## [L17] A spawn outside the lot is a silent no-op, and it looks like a render bug

**What happened:** Task 12's brief set `GRID = 16` and then spawned the fridge
at `(24, 20)`, eight tiles outside the lot it had just declared. The
coordinates were correct for the `GRID = 32` the plan used before [L16]'s
sibling correction shrank the lot to fit the canvas; nothing re-checked them
when the constant moved.

**Measured, in the browser, on the shipped wasm build:** a sim with the fridge
at (24, 20) leaves the agent at (2, 3) after **40 ticks**, exactly where it
spawned. With the fridge at (12, 10) the same agent reaches (12, 3) over the
same 40 ticks. No panic, no log, no validation error, and nothing in the render
buffer looks wrong - both entities are present and drawn in the right places.

**Root cause:** `TileGrid::is_walkable` is false out of bounds, so `find_path`
returns `None` on its destination check, so `select_action` hits its
`let ... else { continue }` and the agent never gets a `Target`. The agent then
stands still forever while its hunger decays. This is deliberate at every
individual step, and the composite behaviour is indistinguishable, on screen,
from "interpolation is broken" or "the sim is not ticking" - which are the two
things Task 12 actually changed, so it would have been diagnosed there.

`sanitize_coord` does not catch it and should not: [L12] settled that the
boundary replaces **non-finite** coordinates only, because a finite out-of-lot
coordinate is a legitimate request that the sim handles by not pathing to it.
Clamping would silently relocate an object the caller asked for. The cost of
that correct policy is that lot size and spawn coordinates are a joint
constraint that nothing checks.

**Prevention rule:** when the lot size changes, re-check every hardcoded spawn
coordinate against it in the same edit. More generally, treat "the agent never
moves" as a **pathing** symptom before a rendering one: the render path cannot
make an entity hold still, since it only draws what the render buffer says.

**How to verify:** set `sim.spawnObject(24, 20)` in `web/src/main.ts` with
`GRID` at 16, tick 40 times, and read `positions()`. Slot 1 stays at its spawn
coordinates. Restore to (12, 10) and it moves.

---

## [L18] The instance array is f32, so an f64 expectation is not equal to it

**What happened:** three `frame.test.ts` assertions failed on their first
otherwise-green run with `expected 0.800000011920929 to be 0.8`. `worldDepth`
computes in JavaScript's f64 and the instance array is a `Float32Array`, so
storing the value rounds it.

**Root cause, and the reason it is worth an entry:** the obvious fix is
`toBeCloseTo`, and it is the wrong one. It would have made the tests pass and
would also have accepted a depth wrong by far more than a rounding step, on the
one value whose entire job is deciding what covers what. That is the project's
recurring shape again - a test loosened until it passes stops being able to
fail.

**Prevention rule:** compare against `Math.fround(expected)`. The assertion
stays exact, and it states the real contract, which is what the GPU reads
rather than what JavaScript computed. `frame.test.ts` wraps this as `stored()`
with the reasoning next to it.

**How to verify:** replace `stored(...)` with its argument in any of the three
depth assertions in `web/tests/frame.test.ts`; the test fails on the f32
rounding rather than on anything about the code under test.

---

## [L19] A perf harness running faster than reality hides every periodic cost

**What happened:** Task 13's first measurement of the M0 exit criterion drove
the frame body flat out from a hidden tab, per [L14]'s rule that you must drive
the draw yourself rather than trust `requestAnimationFrame`. It produced
141,767 frames in 20 seconds - **7,088 fps** - and reported p95 0.255 ms
against a 16.6 ms budget. Every number was real, the draw call really ran, and
the conclusion was still not supported.

**Root cause, and it is arithmetic rather than tooling.** The simulation ticks
at a fixed 10 Hz, and `FixedStepDriver` decides how many ticks a frame owes
from **elapsed wall time**. So the tick rate is 10 per second no matter how
fast frames are produced, and the *proportion of frames that pay for a tick* is
`10 / fps`:

| drive rate | frames that tick | is a tick frame inside p95? |
| --- | --- | --- |
| 60 fps | 1 in 6, 16.7% | yes, comfortably |
| 120 fps | 1 in 12, 8.3% | yes, p95 sits inside the slowest 8.3% |
| 7,088 fps | 1 in 709, 0.14% | **no** - not until about p99.9 |

At 7,088 fps the 95th percentile lands entirely among frames that did nothing
but interpolate and draw. The single most expensive thing a frame can do had
been sampled out of the statistic. Driving *harder* made the test *weaker*,
which is the opposite of the intuition that a stress harness should run flat
out. Re-measured at a realistic cadence, p95 moved from 0.255 ms to 1.335 ms -
a 5x difference that changed no code. **Tick inclusion is not the whole of
that 5x; see the magnitude correction below, which the project's own final
numbers force.**

This is the same family as [L5], [L6], [L7], [L11] and [L14]: the measurement
was green because the expensive path was not in the sample. It is a new costume
because nothing was broken, mocked, or skipped - the harness simply chose a
frame rate, and the frame rate silently chose which costs the percentile could
see.

**Prevention rule:**

1. **A frame-time percentile is only meaningful at the frame rate it will ship
   at.** Before trusting one, compute `10 / fps` (more generally, the duty
   cycle of every periodic cost) and check that the percentile you are quoting
   is above it. If p95 sits below the tick duty cycle, it is measuring the
   cheap frames only.
2. **Say the achieved frame rate next to every frame-time number.** A p95
   without an fps is uninterpretable, for exactly this reason.
3. **Prefer a real, visible browser for the final number.** Driving frames by
   hand is the right *diagnostic* and [L14] still stands, but a genuine
   vsync-paced `requestAnimationFrame` run gets the duty cycle right for free
   and needs no reasoning about pacing at all.

**How to verify:** with the preview server up, load `?stress=1000` and drive
`globalThis.__terriStress.step()` in a loop with no pacing; p95 reads about
0.25 ms. Pace the same loop to one call per 16.667 ms and p95 reads about
1.3 ms, against an identical build. The measured artefact is the harness, not
the renderer. **Expect that 1.3 ms not to reconcile with the headline 0.33 ms;
the correction below is why, and reproducing the discrepancy is part of the
procedure rather than a sign you did it wrong.**

**Magnitude correction, M0 close-out review.** The entry above attributes the
whole 0.255 -> 1.335 ms shift to tick frames entering the percentile
population. The project's own final measurement rules that out. Over 7,202
real rAF frames the **worst single frame of any kind was 0.805 ms**, and at
120 fps a tick lands on 1 frame in 12, so tick frames are inside that sample
and are bounded by it. A tick frame on this machine therefore costs **at most
0.805 ms**, which is strictly less than the 1.335 ms the paced hidden-tab run
reported for its p95. At least 0.5 ms of the 1.08 ms gap - **roughly half of
it** - cannot be tick cost.

The remainder is harness and hidden-tab overhead. Two plausible contributors,
neither of which was isolated: a tab that is not composited runs at background
scheduling priority, and 16.7 ms of idle between paced frames lets caches,
branch predictors and clock speed go cold in a way that 0.14 ms of idle does
not. [F6] in the Task 13 report blames the same environment for a single
123.7 ms frame that never once appears under real rAF, so the environment is
already known to inflate this statistic.

**The rule is unchanged and still the valuable part:** compute the duty cycle
of every periodic cost, check the percentile you are quoting sits above it,
and say the achieved frame rate next to every frame-time number. What is
withdrawn is the *number*. "Pacing the harness cost 5x" is not supported;
"pacing the harness changed the statistic by 5x, of which roughly half is the
harness measuring itself" is what the data says.

The deeper form of the mistake is worth naming, because it is the same family
as everything above: **a corrected measurement is still a measurement, and it
needs its own control.** Having found one explanation that predicted the right
direction, I stopped looking, and attributed 100% of an effect to a cause that
could account for at most half of it. Rule 3 of `testing-protocol.md` applies
to explanations too - name the alternative that predicts the same numbers,
then find the observation that separates them. Here the separating
observation already existed in the same report, three sections down.

**Measured facts worth keeping, from the visible-Chrome run.** 1,002 entities,
1280x720, release build: 7,202 rAF frames in 60.02 s (a sustained 120 fps, so
no frames dropped), mean 0.261 ms, p95 0.33 ms, p99 0.405 ms, max 0.805 ms,
**zero frames over 16.6 ms**. One draw call and one queue submit per frame with
`instanceCount = 1002`. The first 240-frame window reports p95 6.21 ms and the
next reports 0.32 ms, so pipeline and JIT warm-up costs roughly one window and
must be discarded rather than averaged in. JS heap oscillated between 1.84 and
2.62 MB with no trend across 12 five-second marks.

---

## [L20] Two ways a browser probe silently measures something other than the page

Both found during the M0 close-out, both in the same hour, both with the
same shape as everything above: the probe ran, returned a number, and the
number was about the wrong thing.

### Half one: an edited module is a *different* module, so patching the class patches nobody

To observe the shipped `requestAnimationFrame` loop without changing
source, `SpriteRenderer.prototype.draw` and `SimBridge.prototype.tick`
were patched from a dynamic import of the real modules - [L14] rule 1,
and what Tasks 10 and 12 relied on. The tick patch worked and produced a
complete 259-tick trace. **The draw patch counted zero, over 26 seconds
in which the page demonstrably drew 3,104 times.**

The cause is Vite's dev-server cache busting. A module the server has
invalidated since start-up is served to importers under a **timestamped
URL**, and a URL is a module's identity:

```
http://localhost:5173/src/render/sprites.ts?t=1785191946008   <- what main.ts got
http://localhost:5173/src/render/sprites.ts                   <- what the probe got
```

Two URLs, two module records, two `SpriteRenderer` classes, two
prototypes. `sprites.ts` had been edited during the session and
`bridge.ts` had not, which is the entire reason one patch worked and the
other did not. The `.js` and `.ts` specifiers are also distinct records
(`sprites === (await import('/src/render/sprites.js'))` is **false**),
so the same trap is reachable without editing anything.

The dangerous direction is not the zero. It is a probe that builds a
"real module" harness, gets a plausible number, and has actually
measured a **second, parallel copy** of the code - possibly a stale one -
while believing it observed the page.

**Prevention rule:**

1. **Count frames with platform globals, not module exports.**
   `GPURenderPassEncoder.prototype.draw` and `GPUQueue.prototype.submit`
   have exactly one identity per page and cannot be duplicated by a
   bundler. They are also closer to the claim: what reached the GPU.
2. **Any module-identity probe must assert its own identity**, by
   observing something only the page's instance can produce. The tick
   patch was self-verifying by accident - it returned the page's real
   agent walking the page's real lot - and the draw patch was not.
3. **Dump `performance.getEntriesByType('resource')` when a probe reads
   zero**, before believing the zero. The two URLs are right there.
4. Restarting the dev server clears the timestamps, which fixes it and
   also hides it. Prefer rule 1.

### Half two: the heap profiler hides exactly the allocations you are hunting

[D11] forbids per-entity allocation on the render path, and the question
was whether `worldToScreen`'s returned tuple survives escape analysis.
The first CDP sampling run reported **0 sampled bytes over 2,395 frames**
of a full web page - which was caught only because a page allocating
literally nothing for twenty seconds is not a plausible reading.

`HeapProfiler.startSampling` takes `includeObjectsCollectedByMajorGC` and
`includeObjectsCollectedByMinorGC`, and **both default to false**. The
default profile is therefore *surviving* allocations only, so a
short-lived per-frame temporary that the scavenger reaps is reported as
zero bytes. That is precisely the "nothing allocates" versus "the
scavenger keeps up" ambiguity the profile exists to settle, and the
default answers it wrong in the reassuring direction.

With both flags true the same page reported 58.54 MB, of which **57.76 MB
was the tuple**. The expectation that escape analysis would eliminate it
was simply false. See [V11] in `docs/gpu-verification.md`.

**Prevention rule:** when a measurement of a *hot* path returns zero,
treat the instrument as the suspect before the code. State the expected
magnitude first - here, 2.4 million calls times a few tens of bytes,
which is tens of megabytes and thousands of samples - so that "zero" is
recognisable as impossible rather than as good news. An instrument
configured to exclude the phenomenon under study is the same failure as a
test that cannot fail.

**How to verify:** revert `buildInstances` to call `worldToScreen` and
re-run the profile on `?stress=1000` with both include flags set;
`buildInstances` reads tens of MB. Drop the flags and it reads 0 with the
identical code. The two configurations disagree about the same program,
and only one of them is answering the question asked.
