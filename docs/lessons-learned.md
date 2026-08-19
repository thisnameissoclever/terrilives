# Lessons Learned

Gotchas and hard-won context. Read this before starting work; it is cheaper
than rediscovering any of it.

Entries are append-only. **Do not renumber, and do not add a numbered one.**

## How to id a new entry

A new lesson's id is a short kebab-case SLUG of what it is about, not a
number:

```
## [L-save-target-union] A validator that models one case of a union ...
```

Pick the slug from the lesson's own subject. Two words is usually
enough. It never needs to be looked up, reserved, or agreed with anyone,
which is the entire point.

**Why the numbers stopped.** `[L1]`-`[L74]` were allocated by taking the
next free integer, so every branch working in parallel read the same
"next" number and wrote there. It collided on 2026-07-29 (two different
`[L41]`s, main's renumbered to `[L49]`), and the workaround recorded
here at the time - claim the number in a tiny commit first - did not
hold: on **2026-08-01 it collided three more times in one afternoon**,
as PRs #26, #28 and #27 each appended what they believed was the next
number. Each collision cost a renumber, a sweep of the cross-references,
and a fresh ~35-minute CI cycle. A counter cannot be shared by branches
that cannot see each other. A slug needs no allocator, so there is
nothing to race for.

**The numeric series is CLOSED at `[L74]`** - no dash, which is how all
74 of them are written here. `docs/alpha-feel-notes.md` writes its
sessions the other way, `[A-24]`, in all 24 of them. Neither is being
changed: each file is internally consistent, ~60 files cite these
exactly as written, and `check-doc-ids.py` normalises the dash away when
it compares two ids so a cross-format duplicate is still caught.

**Every existing id keeps its number for ever** - 60 files across
`crates/`, `web/src/` and `docs/` cite them, and a citation that rots is
worse than an ugly id.
`check-doc-ids.py` fails the build if a number past the close appears, or
if any id is used twice.

**Ids are also nicer this way**, which is a bonus rather than the
reason: `[L-preview-serves-original-root]` says what it is at the
citation site, and `[L67]` says nothing until you go and look. That is
`docs/glossary.md`'s naming rule - a label names the thing - applied to
the labels the docs use on themselves.

Appends to this file are merged with git's `union` strategy (see
`.gitattributes`), so two branches each adding an entry at the end merge
without a conflict at all. The one thing that costs: if two branches
edit the SAME existing lines, union keeps both versions rather than
raising a conflict. This file is append-only precisely so that stays
rare.

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

**Numbers in this entry are stale by design; the procedure is not. Noted at
the M1a close-out, 2026-07-28.** `0xEF601D5047905825` was the vector when this
was written and it has legitimately moved twice since: to
`0x6C3757F1848175C1` when `Hunger` became `Needs` (M1a Task 2), and to
`0x2FC669EFA7254F2D` when all seven needs started decaying (M1a Task 7). Both
moves were re-observed on native and on wasm32 separately rather than assumed
equal, which is the practice this entry exists to establish. The
`expected 14804735595947770788n to be 17248818803464230949n` below is likewise
the failure output of that era. **Read every constant here as an example of
the shape, and take the current value from
`crates/terri-sim/src/lib.rs`.** A golden vector that never moves is a golden
vector nobody is exercising.

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

---

## [L21] A mutation that fails to compile is not evidence about the test

**What happened:** A task brief instructed "remove `NeedId::Comfort` from the
`ALL` array, confirm `all_lists_every_variant_in_index_order` fails." The
mutation did fail the build - but with
`error[E0308]: expected an array with a size of 7, found one with a size of 6`,
because `ALL` is declared `[NeedId; NEED_COUNT]`. **The test never ran.**

Logged naively, that is a "caught" row that is entirely true and says nothing
about whether the test works. The implementer noticed and found the mutation
that actually exercises it: replace `Comfort` with a duplicate of another
variant, which preserves the length and is also the realistic copy-paste slip.
That one failed the test properly, at index 6.

**Root cause:** mutation testing asks "does the test suite notice this change?"
A change the *compiler* rejects never reaches the suite, so it answers a
different question. The stronger the types, the more often this happens - which
means it happens most in exactly the code where you are most tempted to trust a
green mutation report.

**Prevention rule:** a mutation is only evidence if the code **compiles**. When
designing one, ask what the type system already prevents and mutate around it.
For a fixed-size array, change a member rather than the count. For an enum,
substitute a variant rather than removing one. **If a mutation produces a
compile error, that is an inconclusive result, not a pass** - record it as such
and design another.

Note the compile error is still a real guard worth having. The point is only
that it is a *different* guard than the test, and finding one does not verify
the other.

**How to verify:** read the failure output, not the exit code. `error[E0308]`
means the type system caught it; a test-name-and-assertion failure means the
test did.

---

## [L22] Snapshot harnesses must key on the full path, not the filename

**What happened:** A mutation harness stored snapshots keyed on
`parent_dir + filename`. In this workspace `crates/terri-sim/src/lib.rs` and
`crates/terri-wasm/src/lib.rs` both reduce to `src__lib.rs`, so they collided
and one restore wrote the other file's contents.

**Root cause:** Rust workspaces put same-named files in every crate by
construction - `lib.rs`, `mod.rs`, `error.rs`. Any key short of the full
repo-relative path collides, and it collides *silently*, because writing a
valid Rust file over another valid Rust file usually still compiles.

**Why it was caught:** [L9]'s rule of asserting `git hash-object` after every
restore. The hash did not match, the run stopped, and nothing was lost. The
recovery deliberately avoided `git checkout` - the tree held uncommitted work -
and instead replayed the edits from `HEAD`, each asserting a unique match, then
re-verified byte identity plus a golden vector that independently pins the
affected function.

**Prevention rule:** key snapshots on the **full repo-relative path**, with
separators replaced rather than dropped. And keep asserting the hash after every
restore: that assertion is what turned a silent cross-file corruption into a
stopped run.

**How to verify:** snapshot two same-named files from different crates and
confirm the harness produces two distinct keys.

---

## [L23] A crate can compile on a serde feature a *sibling* dependency turned on

**What happened:** `terri-data`'s manifest was written with
`serde = { workspace = true, features = ["std"] }`, deviating from the Task 3
brief's plain `serde = { workspace = true }`. The reasoning was that the
workspace entry is `default-features = false`, so `String`, `Vec` and `BTreeMap`
would have no `Deserialize` impls. Removing the feature to confirm that, per
`testing-protocol.md` rule 1, produced the **opposite** of the expected result:
`cargo build -p terri-data` succeeded anyway.

`cargo tree -p terri-data -e features` says why:

```
terri-data
|-- postcard feature "alloc"
|   +-- serde feature "alloc"
```

`postcard`'s `alloc` feature enables `serde/alloc`, and feature unification hands
it to `terri-data`. The derives compiled because of a dependency that has nothing
to do with them.

**Root cause:** Cargo unifies features across a package's whole dependency graph,
so a crate's declared features describe what it *asked for*, never what it
*gets*. Nothing warns when the two differ. The failure only appears later, when
whoever removes or re-scopes the unrelated dependency gets a compile error in
code they did not touch, naming a trait impl they did not know was conditional.

**The compounding trap:** `cargo test -p terri-data` passes under **both**
configurations, because the `toml` dev-dependency drags in `serde/std` for the
test target. Dev-dependencies are unified into the lib build when building tests
and are absent from `cargo build`, so the test command is systematically more
permissive about features than the build command. Checking a feature question
with `cargo test` answers a different question.

**Prevention rule:** declare every feature your own code needs, even when it
already builds without it, and verify feature questions with `cargo build`
(no dev-dependencies) rather than `cargo test`. When a feature looks redundant,
run `cargo tree -e features` before deleting it; "it compiles without this" is
not evidence the crate does not need it.

**How to verify:** drop `features = ["std"]` from `serde` in
`crates/terri-data/Cargo.toml` and run `cargo build -p terri-data`. It succeeds.
Then also set `default-features = false` on `postcard`'s `alloc` feature, or
remove `postcard` from `[dependencies]`, and it stops succeeding. Two edits are
needed to observe a requirement that one manifest line claims to own.

---

## [L24] A brief's own tests can be blind to the property the same brief calls load-bearing

**What happened:** the **seventh** instance of the family ([L2], [L3], [L5],
[L6], [L7], [L11]), and the new part is where the blind spot originated. Task 3's
instructions stated, in bold, that `InteractionDef::advertises` must be a
`BTreeMap` rather than a `HashMap`, because the compiled pack is serialised in
iteration order and feeds a determinism hash. The same brief supplied three
tests. Swapping in a `HashMap` left **all three green**:

```
test schema::tests::parses_a_needs_file ... ok
test schema::tests::an_object_may_declare_no_interactions ... ok
test schema::tests::parses_an_object_with_a_sparse_advert ... ok

test result: ok. 3 passed; 0 failed
```

The two assertions that touch the map are `advertises.get("hunger")` and
`advertises.len()`, and both behave identically under either map type. The
brief argued for the mechanism carefully and then tested everything about the
map except it.

**Root cause:** a brief that explains *why* a choice matters reads as though it
has covered the choice. Prose justification and test coverage are independent,
and the more convincing the prose, the less likely anybody checks the tests
against it. [L16] recorded a brief whose code contradicted its own stated
requirement; this is the quieter version, where the code is right and nothing
holds it in place.

**Prevention rule:** for every property a brief calls load-bearing, find the test
that would fail if it were violated **before** writing any code. If there is not
one, that is the first thing to add, and it is not scope creep. Expect the
predicted test count in a plan to be a floor rather than a target.

**How to verify:** apply `use std::collections::HashMap as BTreeMap;` to
`crates/terri-data/src/schema.rs` (an alias keeps every use site identical, so
the mutation is a single clean variable) and run `cargo test -p terri-data`.
Exactly `schema::tests::advert_iteration_is_sorted_not_hash_ordered` must fail,
with a `left` showing hash order and a `right` showing sorted order. If the
suite is green, the ordering is unprotected again.

Note the test is probabilistic against a `HashMap`, though not against the
correct code: seven keys have 5040 orderings and one of them is sorted, so it
fails about 99.98% of runs. It is fully deterministic under `BTreeMap`. The
airtight version is a golden vector over a compiled pack, which needs the
compile step to exist first.

---

## [L25] The Bash tool is Git Bash, so PowerShell here-string syntax lands as a literal argument

**What happened:** a commit was made from the Bash tool with
`git commit -m @'...'@`, which is PowerShell here-string syntax. Bash has no such
form, so `@` was passed through as an ordinary character: the commit subject
became a bare `@` and the real subject dropped to line two, silently, with
exit 0.

**Root cause:** this environment exposes a PowerShell tool and a Bash tool side
by side, and the two take different quoting for exactly the operation that most
needs multi-line strings. Neither shell errors on the other's syntax here; both
produce a valid command with the wrong content.

**Prevention rule:** in the Bash tool use a quoted heredoc,
`git commit -F - <<'EOF'`, and in the PowerShell tool use `@'...'@` with the
closing delimiter at column 0. Pick the form from the tool, not from habit. After
any scripted commit, run `git log -1 --format=%s` and read the subject back;
`git commit` reports success for a message that is entirely wrong.

**How to verify:** `git log -1 --format=%B | head -3` after committing. A subject
line consisting of a stray delimiter character is the signature of this mistake.

---

## [L26] A wall of rejection tests says nothing about what the validator builds

**What happened:** Task 4's brief supplied twelve tests for `compile`, and
eleven of them assert that bad content is *rejected*: unknown need, missing
decay, duplicate id, zero duration, zero slots, non-finite, negative. The
coverage of the failure paths is genuinely thorough. Mutating the single line
that maps a validated need onto its slot in the pack -
`decay[id.index()] = def.decay_per_tick` changed to `decay[0] = ...` - left
**all twelve green**.

The mutation is not subtle. It makes six of the seven needs decay at `NaN` and
the seventh at hunger's rate, for every agent, forever. It survived because the
one fixture every test shares gives all seven needs the same decay rate of
`0.1`, so a value written to the wrong slot is indistinguishable from one
written to the right slot.

**Root cause:** a validator has two halves - what it refuses, and what it
produces from what it accepts - and they need separate tests. Rejection tests
are easy to enumerate, because each one is named by an error variant, so a
brief that works down the error enum feels complete when it has covered every
variant. Nothing in that process ever looks at the output. The eighth instance
of the family ([L2], [L3], [L5], [L6], [L7], [L11], [L24]), and the specific
new lesson is that **an error enum is a checklist for half the surface**.

Compounding it: uniform fixtures are the natural thing to write, and they are
exactly what makes a mapping unobservable. `full_needs()` giving every need
`0.1` is the tidier fixture and the blind one.

**Prevention rule:** for any function returning `Result<T, E>`, count the tests
that inspect `T`. Enumerating `E` is not coverage. Where the output is a
mapping - index to value, name to slot, id to position - **the fixture must
make every key distinguishable**, or the test cannot tell the mapping from a
constant. Distinct values per key, and where order matters, a source order that
differs from the expected output order.

**How to verify:** in `crates/terri-data/src/compile.rs`, change
`decay[id.index()]` to `decay[0]` and run `cargo test -p terri-data`. Exactly
`decay_rates_land_at_their_own_need_index` and
`a_compiled_pack_serialises_to_a_stable_golden_vector` fail; the twelve tests
from the brief all pass. Both of those were added for this reason.

---

## [L27] `cargo mutants` only mutates the packages you name

**What happened:** CI's mutation sweep ran
`cargo mutants --package terri-core --package terri-sim`. That list was correct
when it was written and silently stopped being correct when `terri-data` gained
a validator: the new crate held the project's most branch-heavy code, every
branch of it a [D9] guarantee, and the mandated backstop was not looking at it.
Nothing failed. The sweep reported success over the packages it was told about.

Note this is not the same as `--test-workspace true`, which was already set and
which controls *which tests judge* a mutant. That flag was doing its job; the
package list decides *what gets mutated*, and no flag makes it follow the
workspace.

**Root cause:** an explicit allowlist in CI is a snapshot of the crate layout on
the day it was written, and adding a crate is exactly the moment nobody rereads
the CI file. The failure is silent in the worst direction: the gate still passes,
so it reads as evidence.

**Prevention rule:** adding a workspace member is incomplete until the crate is
named in every CI loop that takes a package list - the mutation sweep and the
dependency-purity check both do here. Run the sweep against the new crate before
adding it, so it joins with a measured survivor count rather than an assumed one.

**How to verify:** `cargo mutants --package <new-crate> --test-workspace true`
should report a survivor count you have read. `terri-data` reported 16 mutants,
1 missed on first run - `check_number`'s `value < 0.0` mutated to `<= 0.0`,
meaning nothing in the suite pinned whether zero is legal content. It is: a
decay rate of zero is a need that does not decay. A test now says so, and the
crate joined CI at 13 caught, 3 unviable, 0 missed.

---

## [L28] A build-time validation gate converts caught mutants into unviable ones

**What happened:** M1a Task 5 gave `terri-data` a `build.rs` that includes
`src/compile.rs` via `#[path]` and aborts the build on invalid content. The
sweep was re-run afterwards. No test changed, and neither `compile.rs` nor
`pack.rs` changed:

```
terri-data alone
  Task 4: 16 mutants tested: 13 caught,  3 unviable, 0 missed
  Task 5: 17 mutants tested:  6 caught, 11 unviable, 0 missed

all three packages
  Task 4: 266 mutants: 18 missed, 235 caught, 13 unviable
  Task 5: 267 mutants: 18 missed, 222 caught, 27 unviable
```

**Thirteen** mutants moved from **caught** to **unviable**, matching the
235-to-222 fall exactly. Seven are in `terri-data`, among them
`compile.rs:65:12: delete ! in compile` (the missing-need loop) and
`compile.rs:94:35: replace == with != in compile` (the zero-duration check).

**The other six are in `terri-core`, and that is the part worth remembering.**
`NeedId::index`, `NeedId::as_str` and `NeedId::from_name` were all caught by
`terri-core`'s own tests before this task, and are now unviable:

```
crates/terri-core/src/needs.rs:36:9: replace NeedId::index -> usize with 0
  content is invalid: needs.toml declares 'energy' more than once
crates/terri-core/src/needs.rs:54:9: replace NeedId::from_name -> Option<NeedId> with None
  content is invalid: needs.toml declares unknown need 'hunger'
```

**Root cause:** `compile.rs` is now compiled into two units, the library and the
build script, and the build script also pulls in `terri-core` as a build
dependency. When `cargo mutants` mutates either crate, the mutated code runs
inside `build.rs` against the real `content/*.toml`, rejects it, and the package
never builds. `cargo mutants` classifies any build failure as unviable, so the
mutant never reaches the test suite that used to kill it.

The blast radius is therefore **not confined to the crate that owns the build
script**. It covers everything the build script transitively depends on, which
is exactly the direction nobody looks: the change was made in `terri-data` and
the evidence quietly degraded in `terri-core`.

**Why this is not a regression in safety and is one in evidence.** Every one of
those mutants is still detected, and the build gate detecting them is precisely
the [D9] guarantee the build script exists to provide. But by [L21], an unviable
mutant says nothing about the tests. The sweep can no longer tell you whether
`rejects_a_missing_need_decay` and its siblings still work, and the CI gate
stays green either way, because unviable is neither caught nor missed. That is
this project's recurring shape wearing yet another costume: **the check still
passes, over less.**

**Prevention rule:** when a validator gains a build-time caller that consumes
real data, re-measure the **whole sweep's** caught/unviable split and record
both numbers, not just the missed count and not just the crate you edited. A
fall in *caught* with a matching rise in *unviable* means coverage moved out of
the test suite and into the build. No `cargo mutants` flag converts a build
failure back into a catch; `--help` offers only `-V, --unviable`, which lists
them. Do not delete the tests that used to catch those mutants on the grounds
that the sweep has stopped crediting them: they are still the only thing that
would catch a regression if the build gate were ever relaxed, and the sweep will
not tell you when they rot.

**How to verify:** run the sweep, then

```
grep -lE "content is invalid" mutants.out/log/*.log | wc -l
```

Every hit is a mutant killed by `build.rs` rather than by a test. Measured here:
**13**, which is exactly the fall in *caught* from 235 to 222. If that count and
the fall in caught disagree, something other than the content gate also changed.
Anything unviable for a different reason shows an `error[E...]` instead, which
is the ordinary [L21] case and was already there.

---

## [L29] A field read for exactly one purpose is only observable through that purpose

**What happened:** the **ninth** instance of the family ([L2], [L3], [L5], [L6],
[L7], [L11], [L24], [L26]), found during M1a Task 6 by the mandatory hand sweep
rather than by review or by `cargo mutants`, and found in code written minutes
earlier.

Task 6 made an object offer a *list* of interactions, so `select_action` records
which one won in `Target::interaction` and `follow_path` resolves that index
when it starts the meal. A test was written for exactly that -
`the_interaction_recorded_at_selection_is_the_one_that_fills` - with a fixture
object offering a weak `nibble` and a strong `feast`. It asserted the agent ends
up performing the second one.

Replacing `interactions[target.interaction as usize]` with `interactions[0]` in
`follow_path` left **all 91 workspace tests green**, that one included.

**Root cause, and it is narrower and more useful than "the fixture was weak".**
`follow_path` reads the resolved interaction for **one** value: its
`duration_ticks`. Everything else flows through `Eating`, whose `interaction`
field is copied from `Target` and re-resolved by `tick_interactions`. The
fixture gave both interactions a duration of **15**, so the wrong lookup
returned a different object with the same number in the only field anybody read.
The test asserted `Eating.interaction == 1` and got it, because that field never
passed through the mutated expression at all.

So the test exercised the line, the line returned the wrong value, and the
assertion could not see it. **The reachable-but-unobservable case is not the
same as the untested case, and it does not look different from the outside.**

The generalisable rule: *before writing the fixture, ask which single value the
code under test actually extracts, and make the candidates differ in **that**
value.* Making them differ in something adjacent - here, the advertised delta -
feels like the same thing and is not, because the delta reaches the assertion by
a route that bypasses the mutated line.

**Prevention rule:**

1. For any lookup, indirection or index resolution, **name the field the caller
   reads** and give the fixture's alternatives different values *for that
   field*. A fixture whose candidates agree on the read field cannot test the
   read.
2. `cargo mutants` would not have found this either. It rewrites expressions,
   and `interactions[i]` to `interactions[0]` is a constant substitution inside
   an index expression that is outside its grammar, exactly as statement
   deletion is ([L11]). Hand mutation is what caught it, which is rule 1 of
   `testing-protocol.md` earning its place for the ninth time.
3. When the fix is to make a fixture's values differ, **say in the test comment
   that the difference is load-bearing and that the equal version was measured
   green.** Otherwise the next reader tidies the two durations back to one
   constant and the test silently returns to being decorative.

**How to verify:** in `crates/terri-sim/src/systems/movement.rs`, replace
`interactions[target.interaction as usize]` with `interactions[0]` and run
`cargo test -p terri-sim`. Exactly
`systems::interact::tests::the_interaction_recorded_at_selection_is_the_one_that_fills`
must fail, with
`left: Eating { object: ObjectDefId(0), interaction: 1, remaining_ticks: 4 }`
against `right: ... remaining_ticks: 14`. Then set both fixture interactions to
the same `duration_ticks`, apply the same mutation, and confirm the suite is
green again - that second half is the finding, not the first. Restore from a
scratchpad byte snapshot, never with `git checkout` ([L9]), and touch the file
([L8]).

---

## [L30] An equivalent mutant stops being equivalent when the code around it changes shape

**What happened:** `crates/terri-sim/src/systems/action.rs`'s
`replace < with <= in select_action` had been in `docs/mutants-baseline.txt`
since M0, and correctly so. The clause is

```rust
score == best_score && object.index() < best_e.index()
```

and while an object carried a single advert, the two sides were always
**different entities**. Distinct entity indices are never equal, so `<` and
`<=` agree on every input the program can produce. It was an equivalent
mutant: unkillable, and rightly recorded as accepted debt rather than chased.

M1a Task 6 gave an object a *list* of interactions and made `select_action`
score each one, so the same clause now also compares an object **against
itself**. There `idx < idx` is false and `idx <= idx` is true, and the
difference decides which of two equally good interactions an agent performs -
a real determinism property, silently governed by declaration order in
content. The mutant became killable, and nothing killed it.

Nothing in the sweep said so. It reported the entry as missed, exactly as it
had for five milestones, and the `comm` against the baseline was clean. **A
survivor that was already a survivor produces no signal when its meaning
changes.**

**Root cause:** "equivalent mutant" is a judgement about the code *as it was*,
not a property of the line. A baseline entry records the judgement and not the
argument behind it, so nothing prompts a re-read when the argument expires.
Same family as [L27] and [L28]: the check still passes, over something
different from what it used to cover.

**Prevention rule:** when a change widens what an existing expression compares -
a new caller, a new loop, a new pair of operands - **look up whether that
expression already has a baseline entry, and re-derive the argument for it**.
If the argument no longer holds, the entry is a missing test, not debt.
Practically: grep `docs/mutants-baseline.txt` for the file you are editing
before you start, not after the sweep.

Corollary for `docs/mutation-baseline.md`: an accepted-survivor entry should
record *why* it is unkillable, because that sentence is what a future reader
can check against the new code. "Equivalent" alone cannot expire visibly.

**How to verify:** replace `<` with `<=` in that clause and run
`cargo test -p terri-sim`. Exactly
`systems::action::tests::a_tied_later_interaction_cannot_displace_an_earlier_one_on_the_same_object`
must fail, with `left: 1, right: 0`. Delete that test and the same mutation
leaves the workspace green, which is the state the baseline described.

---

## [L31] Widening a mechanism does not fail the tests that only covered part of it

**What happened:** M1a Task 7 widened `decay_needs` from hunger alone to all
seven needs. The brief predicted, correctly, which tests would go red, and every
one of them did. What no prediction covered was `hunger_never_goes_negative`,
because it stayed **green** - and it stayed green while silently losing six
sevenths of the surface it was written to protect.

That test pinned the floor at zero. Before this task there was exactly one need
that could reach the floor, so covering hunger covered the mechanism. After it
there are seven, and the test still covered one. Measured: make `Needs::drain`
clamp hunger and write the other six straight into the array, and
`no_need_goes_negative` is the **only** failure in the workspace, at
`energy fell past the floor, left: -68.0002`. Read where that lands - the loop
reaches *energy*, so hunger's assertion passed, and hunger's assertion is the
whole of what `hunger_never_goes_negative` checked. The version it replaces was
green under that mutation, and so was everything else, all 93 of them.

The golden vectors cannot help here and it is worth knowing why: their scenario
runs 100 ticks from full, which never drives any need below zero, so a broken
floor is simply not on their path.

**Root cause:** a red test announces that it needs attention. A test that merely
**narrowed** announces nothing, because passing is what it did yesterday too.
Task 6 saw this coming for the tests it could make fail - it deliberately left
`hunger_decays_at_the_rate_content_declares` asserting that the other six needs
do *not* move, so Task 7 would have to update it on purpose ([C2] in that
report). That device works, and it only works for the tests somebody thought to
point at the change.

Same family as [L27], [L28] and [L30] - "the check still passes, over less" -
but the trigger is new. Those were CI package lists and mutation-baseline
entries, artefacts a reader already treats as configuration. This is an ordinary
unit test with a name that still reads as true.

**Prevention rule:** when a change takes a mechanism from operating on one
instance to operating on N, **grep for the tests naming that mechanism and ask
of each whether its fixture still spans the mechanism's whole domain**. Do this
for the tests that stay green; the red ones will find you. A test whose name
carries the single instance - `hunger_never_goes_negative`, `..._for_hunger`,
`..._the_first_...` - is the visible marker, and renaming it to the general
claim is the fix, not a tidy-up.

**How to verify:** in `crates/terri-core/src/needs.rs`, change `drain` to
`if id == NeedId::Hunger { self.set(id, next) } else { self.0[id.index()] = next }`
and run `cargo test --workspace`. Exactly
`systems::needs::tests::no_need_goes_negative` must fail. Note `terri-core`'s
own `needs_clamp_to_range` stays green under it, because it too only drains
hunger. Restore from a scratchpad byte snapshot, never with `git checkout`
([L9]), and touch the file ([L8]).

---

## [L32] Most accepted mutation debt was cheaper to kill than to keep arguing for

**What happened:** the M1a close-out triaged all 16 surviving mutants properly
for the first time, instead of confirming the count had not grown. **Eleven of
the sixteen died to four small tests and no production change at all.** They
had been in `docs/mutants-baseline.txt` for five milestones, each behind a
one-line justification in `docs/mutation-baseline.md` that read as settled:

| Baselined as | Actually |
|---|---|
| "No consumer until M3" (`is_hour_boundary`) | 12 lines of test, and the "tick 0 is a boundary" decision was undocumented in code |
| "Unused accessors" (`width`, `height`) | Reachable all along; a **square** fixture made them interchangeable |
| "Real test gap", pathfinding (4) | Three of the four were one direct assertion on `heuristic` |
| "Hash (2)" | A latent NaN/`i64::MIN` digest collision, one `assert_ne!` away |

None of that required insight. It required someone to ask, per survivor,
"what would kill this?" rather than "is this the same set as last time?"

**Root cause, and it is about the gate rather than about the code.** The CI
gate is *no new survivors*, which is the right gate: a wall of known noise gets
ignored, and that is the failure this whole discipline exists to prevent. But
"no new survivors" makes an existing survivor **free**. Nothing costs anything
until the day the set changes, so an entry written once is never re-read, and
the cheapest possible action at every sweep is to confirm the diff is empty.
The file drifts from a ledger of deliberate decisions into a list of things
nobody has looked at, and it looks identical either way.

The two flavours compound. A **wrong** justification ([L30]: an equivalent
mutant that stopped being equivalent) and a **lazy** one ("unused accessors")
produce the same green diff, so no amount of watching the gate distinguishes
them.

**Prevention rule:**

1. **If the argument for accepting a survivor is shorter to write than the test
   that would kill it, write the test.** That is a genuinely usable threshold,
   and it disqualified eleven of sixteen entries here.
2. **"Nothing uses it" is a reason to test it, not a reason to baseline it.**
   An unused public function is behaviour with *no* constraint on it rather
   than weak constraint, and it will acquire its first caller in a task that is
   busy doing something else.
3. **Re-derive every accepted argument at each milestone close-out, and say in
   the file which ones you actually re-derived and which you carried on
   trust.** [L30] says an argument expires; this says the expiry is invisible
   unless someone schedules the check. The close-out is the schedule.
4. Where the survivor is genuinely equivalent, **write down the condition that
   would end the equivalence** - "`NEIGHBOURS` is closed under negation",
   "`score_advertisement` is a plain product over a clamped urgency" - so the
   next reader can check one sentence instead of re-deriving the proof.

**How to verify:** the eleven closures are listed with their killing tests in
`docs/mutation-baseline.md`. The survivor count went from 16 to 5 with no
production code changed, so `cargo test --workspace` before and after the
tests differs by exactly 4 tests and the world-hash golden vectors do not move.

---

## [L33] A round trip cannot pin a wire format, because it is self-consistent under any encoding

**What happened:** the **tenth** instance of the family ([L2], [L3], [L5], [L6],
[L7], [L11], [L24], [L26], [L29]), and this time the blind test arrived already
carrying a comment stating the property it did not check.

M1b Task 1's brief supplied `commands_round_trip_through_postcard`, whose own
comment reads: "Commands are the wire format for the save-file command log and,
later, for multiplayer. A silent encoding change would break a replay long after
the commit that caused it." The surrounding prose called the test load-bearing
twice.

Swapping the order of `SimCommand::Select` and `SimCommand::UseObject` in the
enum - a two-line edit, and the single most likely way this format changes by
accident - renumbers the postcard variant index of every command. Under that
mutation `Select(Some(7))` encodes as `[1, 1, 7]` instead of `[0, 1, 7]`, so
every previously written command log would replay as different commands. **The
round-trip test passed.** So did the queue test. Nothing in the workspace went
red.

**Root cause:** a round trip asserts that the serialiser and the deserialiser
agree *with each other*. They are generated from the same derive, so they agree
by construction under **any** encoding. The encoding is a free variable that
appears on both sides of the assertion and cancels. This is testing-protocol
rule 3's "relation between two computed values" in its purest form, and it is
unusually convincing because the two computed values genuinely are the thing you
care about - they are just both downstream of the thing that changed.

Note that `cargo mutants` would not have found this either. Reordering the
members of a type declaration is outside its grammar, exactly as
statement-deletion is (protocol rule 2).

**Prevention rule:** for any type whose bytes are **persisted or sent**, a round
trip is necessary and never sufficient. Pin the bytes with a golden vector
beside it:

1. Assert exact `expected` byte slices for at least one value of every variant.
2. Include a value **above 127**, which is what makes the assertion sensitive to
   varint-ness and to integer width. `SetSpeed(200)` is two bytes if the field
   is ever widened from `u8` to `u32`, and one byte otherwise; `SetSpeed(2)`
   cannot tell the two apart.
3. Say in the type's doc comment that variant order and field widths **are** the
   wire format, so the next person to insert a variant in the middle reads it
   before rather than after.

**How to verify:** swap any two variants of `SimCommand` and run
`cargo test -p terri-core command`. `command_encoding_is_pinned_by_a_golden_byte_vector`
fails naming the changed bytes; `commands_round_trip_through_postcard` passes.
Restore from a scratchpad byte snapshot, never with `git checkout` ([L9]), and
touch the file ([L8]).

---

## [L34] A suite whose inputs are all integers cannot detect rounding

**What happened:** `screenToWorld` shipped with three tests, including a
round-trip over six coordinate pairs. Wrapping both results in `Math.round`
left all three green. A fourth test with a fractional input caught it
immediately.

**Root cause:** every input was a point that `worldToScreen` had produced from
**integer** world coordinates, so the correct answer was always an integer and
rounding was a no-op. Adding more coordinate pairs would not have helped - the
suite was not too small, its **input domain was degenerate**. Six points that
all share the property you failed to vary are one point.

This differs from the earlier entries in this file. [L5] and [L7] are about the
shape of the assertion; this one is about the shape of the **inputs**. A test
can assert exactly the right thing, causally, and still be blind because nothing
it feeds in can distinguish the two implementations.

**Why it matters that the mutation was realistic:** the caller wants a tile
index, so "just make `screenToWorld` round to the tile" is the obvious-looking
simplification someone makes later while tidying. The suite would have approved
it, and picking would then be correct at tile centres and wrong everywhere else -
which reads as a rendering problem, not an input one.

**Prevention rule:** for any function over a continuous domain, **ask what
property every input shares**, and add one that breaks it. Integers hide
rounding and truncation. Positive values hide sign errors. Symmetric values hide
transposition. Zero hides almost everything.

**How to verify:** apply the degenerate implementation - round it, take the
absolute value, transpose the arguments - and check the suite fails. If it
passes, the inputs are the problem, not the assertions.

---

## [L35] A hand-designed mutation must be survivable by the shipped content, or the build gate answers instead of the test

**What happened:** M1b Task 3 added lot validation to `terri-data`'s
`compile.rs`, which `build.rs` runs against the real `content/*.toml`. To
verify the new `rejects_a_wall_outside_the_lot` test, the bounds check
`x >= lot.width || y >= lot.height` was transposed to
`x >= lot.height || y >= lot.width`. The shipped lot is 24 wide and 18 tall
with walls out to `x = 23`, so the transposed check rejects real content and
the build aborted:

```
thread 'main' panicked at crates\terri-data\build.rs:67:29:
content is invalid: lot.toml has a wall at (18, 8), outside the 24x18 lot
```

**The test never ran.** Logged naively that is a "caught" row that is
entirely true and says nothing about whether the test works.

**Root cause:** this is [L21]'s shape with the compiler swapped out for the
content gate, and it is worth its own entry because the defence is
different. [L21] says to design a mutation around what the *type system*
prevents, and the fix there is structural: change an array member rather
than its length. Here nothing about the mutation is ill-typed. What blocks
it is a *value* in a data file, so the fix is arithmetic: pick a mutation
whose accept/reject boundary the shipped content sits comfortably inside.

`x >= lot.width` mutated to `x > lot.width` is the version that works. It is
an off-by-one, so the shipped lot (`max x = 23`, width 24) still passes and
the build succeeds, while the test's deliberate `(5, 1)` on a 5x3 lot sits
exactly on the boundary and fails. Same line, same operator, conclusive
instead of inconclusive.

**Prevention rule:** before applying a mutation to code that a build script
runs over shipped content, ask **"does the real content still pass this?"**
If not, the build gate will answer and the test will not. Prefer boundary
mutations (`>=` to `>`, `<` to `<=`) over ones that change meaning wholesale
(transposition, negation), because the shipped content usually sits well
away from the boundary while the test fixture sits on it.

Where the wholesale mutation is the one you actually need to guard against -
a transposition genuinely is the realistic bug here - **put the guard
somewhere the build gate cannot reach.**
`is_wall_matches_both_coordinates_of_a_declared_wall` in `pack.rs` asserts
the transposes and the cross products of its fixture's walls, and `pack.rs`
is not on `build.rs`'s validation path, so that test stays conclusive.

**How to verify:** read the failure output, not the exit code. A panic from
`build.rs` saying "content is invalid" means the gate caught it; a test name
and an assertion means the test did. Only the second is evidence about the
test.

---

## [L36] A golden vector over a one-candidate fixture cannot see a change to how candidates are ranked

**What happened:** M1b Task 3b's brief predicted, in bold, that switching
`select_action` from Euclidean distance to A* path length would move the
world-hash golden vectors, and instructed that both copies be updated
deliberately. **They did not move.** `0x2FC6_69EF_A725_4F2D` before the
change and `0x2FC6_69EF_A725_4F2D` after it, on native and on wasm32, with
the wasm rebuilt first ([L8], [L13]).

The prediction was reasonable and the fixture is what refutes it.
`build_scenario` in `crates/terri-sim/src/lib.rs` is a 24x24 **open** room
holding **one** smart object and eight agents. Three things follow, and all
three have to hold:

1. With one object there is nothing to rank, so the metric can only act
   through the `ACTION_THRESHOLD` comparison. It does change that - agent 4
   clears the threshold at Euclidean 21.4 tiles and fails it at a path
   length of 30 - but only the lowest-index agent that clears it ever gets
   the object, because the rest find it in `claimed` and skip.
2. That agent's walk is **30 tiles at 0.25 tiles per tick = 120 ticks**, and
   the vector is taken at tick 100. It is still walking. Nothing else in the
   scenario ever selects anything.
3. Movement always used A*. So the agent's position at tick 100 is the same
   under both metrics, every other agent is stationary, and the digest is
   bit-identical.

**Root cause:** a golden vector pins *what the simulation computes in that
scenario*, and a scenario with one candidate exercises no comparison between
candidates. This is [L27], [L28], [L30] and [L31] again - "the check still
passes, over less" - but the trigger is new and worse, because the check did
not merely narrow: it never covered the mechanism at all, and its *stability*
was read as reassurance. A vector that does not move is normally evidence
that nothing changed.

**Prevention rule:**

1. **Before predicting that a golden vector will move, name the mechanism and
   check the fixture exercises it.** "Does this scenario contain two things
   the change would order differently?" is a one-line check and it is the
   whole of it.
2. **An unchanged golden vector after a deliberate behaviour change is a
   finding, not a relief.** Work out why before writing it down as a pass.
   The two answers - "the change is inert" and "the fixture is blind" - look
   identical from the outside and mean opposite things.
3. Do not fix this by tuning the fixture until the vector moves. The vector's
   job is a stable reference scenario; the mechanism's job belongs to a test
   named for it. Task 3b's
   `an_object_behind_a_wall_loses_to_a_further_one_the_agent_can_walk_to` is
   that test, and it is what mutation-verifying the metric proved.

**How to verify:** revert `let distance = steps.len() as f32;` in
`crates/terri-sim/src/systems/action.rs` to the Euclidean form and run
`cargo test --workspace`. Exactly one test fails, and it is **not**
`world_hash_matches_its_golden_vector`. Restore from a scratchpad byte
snapshot, never with `git checkout` ([L9]), and touch the file ([L8]).

**It recurred at M1c Task 3, on the same fixture, against the same
prediction, and that is why this entry is worth more than its first
instance.** That brief said in bold that both vectors "will move" when
`select_action` switched from argmax to a softmax-weighted draw - the central
change of a whole milestone. They did not: `0x2FC6_69EF_A725_4F2D` before and
after, native and wasm32, wasm rebuilt first. **One object means every agent
that gets a candidate gets exactly one, and a one-candidate draw has one
answer at every temperature and every seed.** The check in prevention rule 1
would have taken ten seconds and was not run either time.

Two things follow for whoever is next. First, this scenario is now known
*not* to cover candidate ranking or candidate sampling, so stop expecting it
to; ranking is pinned by
`an_object_behind_a_wall_loses_to_a_further_one_the_agent_can_walk_to` and
sampling by
`a_higher_scoring_object_is_chosen_more_often_and_a_lower_one_still_sometimes`.
Second, its blindness became load-bearing in a new way: softmax calls
`f32::exp`, which is a platform libm call with no cross-target bit-identity
guarantee, and this vector is compared across native and wasm32. It stays
safe *because* the fixture has one candidate, whose weight is `exp(0.0)` -
exactly 1.0 on every target. Adding a second object to `build_scenario` would
change what the vector is exposed to, not just what it covers.

**A second, smaller instance from the same task, recorded because the shape
recurs.** A boundary test for `lot_width` and `lot_height` built its own
`SimHandle::new(width, height)` out of the two numbers under test and then
asked whether a corner was inside it. That helper is **self-consistent under
a swap of the pair**: with both accessors transposed it constructs an 18x24
lot, agrees with itself, and passes. Measured. The fix was to ask the
question of `from_lot()`'s real lot instead. **A control that rebuilds its
world from the values it is testing is not a control.**

---

## [L37] A WebGPU canvas read outside a rAF callback is black, and the screenshot is what proves it

**What happened:** Task 3b's browser check read the canvas back with
`drawImage` + `getImageData` from a plain `page.evaluate`, and got
`0,0,0` across all 921,600 pixels - the exact reading [L14] records for a
renderer that never ran. The frame counters in the same probe said 1,114
rAF callbacks, 1,114 `draw` calls and 1,114 `submit` calls, and the
Playwright screenshot taken seconds later plainly showed eight blue
diamonds and an orange sim.

**Root cause:** a WebGPU canvas presents at the **end of the task**, so a
readback issued in an arbitrary task samples a surface with nothing in it.
Task 10's notes already said to await `queue.onSubmittedWorkDone()` and a
macrotask; what they did not say is that the failure is not a *dim* or
*partial* reading, it is the identical all-zero reading that means "the
renderer never ran". The two most different diagnoses in this project
produce the same 921,600 zeroes.

**Prevention rule:**

1. **Do the readback inside a `requestAnimationFrame` callback registered
   during a frame**, so it runs after the page's own callback has drawn.
2. **Never accept an all-zero canvas without a second, independent
   instrument.** A frame counter on a platform global and a screenshot are
   both cheap, and here they disagreed with the readback immediately. This
   is [L20]'s "when a measurement of a hot path returns zero, treat the
   instrument as the suspect" with a different instrument.
3. State the expected magnitude first. Eight 24x24 quads is 4,608 pixels
   and one sim is 576; "zero" is then recognisable as impossible rather
   than as a finding about the page.

**How to verify:** move the `drawImage` out of the rAF callback in the
Task 3b browser script and re-run against a page that is demonstrably
drawing. The colour tally collapses to a single `0,0,0` entry while the
submit counter keeps climbing.

## [L38] A borrowed asset pack's grid is not this project's grid, and the difference reads as a level-design problem

**What happened:** Task 3c scaled Kenney's isometric furniture by their
floor tile, which is the obvious reading: their `floorFull` renders 208 px
across and our tile diamond is 64 px, so the factor is 64/208. Everything
tiled, nothing overlapped, and the rendered lot looked wrong in a way that
had nothing obviously to do with scaling: an enormous empty floor with
doll's-house props scattered on it. The first instinct was that
`content/lot.toml` had authored too big a lot.

**Root cause:** **their tile is about 1.7 m and ours is roughly 1 m.**
`grid.rs` says so about ours; theirs has to be measured, and can be. An
isometric box of footprint w by d renders `(w + d) * halfTile` wide, so
their 0.4 x 0.7 m toilet at 66 px and their 1.0 x 2.0 m bunk bed at 172 px
both put their metre near 118 source pixels rather than 208. Scaling by
their tile therefore drew every object at 58% of its real size. Nothing in
the pipeline could notice: the atlas packed, the manifests agreed, every
test passed, and the only symptom was an aesthetic judgement about a room.

**Prevention rule:**

1. **Scale a borrowed pack by a shared physical unit, not by its grid.**
   Derive the unit from two objects of known real size and check they
   agree; one object cannot distinguish a scale error from an unusual
   model.
2. **Say what the unit is in the file that applies it.** `build-atlas.ps1`
   names 118 px as one metre and shows the arithmetic, so the next person
   changing the scale is changing a measured quantity rather than a magic
   number.
3. **A rendering bug can present as a content bug.** Before re-authoring
   content because the picture looks wrong, check that the picture is
   drawing the content at the right size.

**Also recorded here because it cost a second iteration:** scale both axes
of a borrowed isometric sprite or neither. Their wall panel is 1.8 of our
tile edges wide at the metre scale, so a run of them overlaps; narrowing
only the width to one tile edge looks like the fix and is worse, because
the panel's top and bottom edges are diagonals cut to the tile slope and
scaling x without y re-slopes them. The run then opens into a picket fence
with the floor showing through.

**How to verify:** set `$KENNEY_METRE_PX` in `assets/sprites/build-atlas.ps1`
to 208, regenerate, and look at the page. Every object shrinks to 58% while
the floor, which is generated at exactly 64 x 32, does not move at all.

---

## [L39] A PCG output hides a low-bit state difference for one extra draw

**What happened:** M1c Task 1's `a_resumed_rng_continues_the_same_sequence`
compares a `SimRng` restored from a save against a reference that was never
serialised. It was written with eight draws and a comment predicting that a
save which dropped the `inc` field would agree on the first draw and part
company from the second. Running that mutation - `#[serde(skip)]` on `inc` -
showed the first **two** draws agree, and the third is where it breaks:

```
resumed   [3398805763, 2211399277, 3474744281, 1141141794, ...]
reference [3398805763, 2211399277, 3248241063, 2122662297, ...]
```

The test caught the mutation, so nothing shipped wrong. What was wrong was the
stated reason, and the reason is what a later reader would use to decide how
many draws are enough.

**Root cause:** the output function is
`rotate_right((((old >> 18) ^ old) >> 27) as u32, old >> 59)`, which keeps only
bits 27 and up. After one step the two generators' states differ by exactly
`inc`, which is 2469 for seed 1234, so the difference lives entirely in the
bottom twelve bits of `old` and never reaches bit 27. It only becomes visible
once the `wrapping_mul` carries it upward, one step later.

**Prevention rule:** [L11] and testing-protocol rule 7 say to take N + 2
observations, where N comes from the relation under test. This is the case
where **N is larger than the mechanism suggests, because the function under
test discards part of its input.** Any transform that truncates, shifts,
rounds, quantises or hashes can swallow a real state difference for one or
more steps, so a divergence test sized by reasoning alone will be sized too
small.

Do not derive the sample count. **Apply the mutation, read the index where
divergence actually starts, and take comfortably more than that.** Then write
the measured index into the test, not the predicted one.

Note the shape this shares with [L34]: both are tests whose assertions are
correct and whose *inputs* cannot express the difference. There it was a
degenerate input domain; here it is a domain too short in time.

**How to verify:** put `#[serde(skip)]` on `SimRng::inc` in
`crates/terri-core/src/rng.rs` and run `cargo test -p terri-core --lib`. The
two printed vectors agree at indices 0 and 1 and differ from index 2, so a
one-draw or two-draw version of that test would pass the mutation.

---

## [L40] A threshold picked before the distribution was measured decides everything, and the suite has no opinion

**What happened:** M1c's alpha feel pass (Task 6) measured a 12 000-tick
behaviour trace of the shipped lot for the first time. **Two of the three
knobs it had to retune were wrong in the same way, and the whole test suite
was green throughout both.**

1. `choice_temperature` was 0.15, and `content/tuning.toml` justified it with
   a worked example: "two candidates 0.165 apart go to the better one about
   75% of the time". The arithmetic was correct and the 0.165 was a **guess**.
   Measured, the gap between the top two candidates in real play is 0.0045 at
   the 10th percentile, 0.032 at the median and 0.142 at the 90th - the guess
   sat *above the 90th percentile* of what the game produces. Softmax is
   exponential in the difference, so at the real gaps the sim was choosing
   almost uniformly: one recorded six-way decision spread from p 0.143 to
   p 0.191 across all six options. The mechanism was correct, the temperature
   was tuned against a distribution nobody had looked at, and the result was a
   sim that picked at random while every test asserting "weighted, not argmax"
   passed.
2. `min_interaction_ticks` was 25 because 2.5 real seconds sounded like the
   shortest visible action. Measured, that floor sat above the **entire**
   sampled band of the fridge (9 to 21 ticks), the toilet (7 to 17) and the
   sink (5 to 11), which are the three most-used objects. **31 of 51
   interactions ran for exactly 25 ticks with no variance at all**, so [D-4]
   was inert for 61% of them, and because the refill divides by the *content*
   duration each also delivered `floor / duration_ticks` times its advertised
   benefit - the fridge gave 67 hunger instead of 40.

**Root cause.** Both are the same shape and it is a new one for this file. The
recorded family ([L5] through [L36]) is about tests that cannot observe a
mechanism. Here every mechanism is observable and every test observes it
correctly. What nothing observes is the **distribution of the inputs the
mechanism runs on**, and a threshold's entire meaning is where it falls in that
distribution. A limit with all the real data on one side of it is not a limit;
it is the mechanism. `min_interaction_ticks` stopped being a floor and became
the duration, and no assertion about "the floor clamps short interactions" can
tell those two apart, because both are true.

Note the second one had a *documented rationale* attached, which made it worse
rather than better: [L24] recorded that prose justification and test coverage
are independent, and this is the same trick played on a number. A comment
explaining why 0.15 is right reads exactly like evidence that somebody checked.

**Prevention rule:**

1. **A threshold is a claim about a distribution. Before shipping one, measure
   the distribution and write the percentiles next to the value.** Not the
   range - the range is nearly always wide enough to look fine. The percentiles
   of the quantity the threshold is actually compared against.
2. **Ask which side of the threshold the real data lies on.** If it is all on
   one side, the threshold is not a bound, it is a constant, and everything
   downstream is a function of it rather than of the mechanism it guards.
3. **A worked example in a comment is not a measurement**, and one containing
   an invented input value is a guess wearing a measurement's clothes. Say
   where each number came from.
4. **Keep the guard that refuses to be decorative.** The one test that fired
   correctly here was
   `an_interaction_shorter_than_the_real_time_floor_is_stretched_up_to_it`,
   whose precondition asserts that the fixture's *longest possible* draw is
   still under the floor. Lowering the floor to 12 made that false and the test
   went red with "the clamp is not what decides this test" - which is the
   protocol's rule 4 doing its job on a tuning change rather than on a code
   change. Without it the test would have kept passing while quietly becoming a
   statement about something else.

**How to verify:** run `cargo run -p terri-sim --example trace -- 12000`.

**AMENDED, 2026-07-29.** This rule used to end "the trace harness is not in the
repo, deliberately - a stale committed instrument is worse than none", and the
branch that added `crates/terri-sim/examples/trace.rs` cited *this lesson* as
the reason for committing it. A review caught the contradiction: four comments
pointed at [L40] to justify the opposite of what [L40] said.

The original reasoning was wrong, and the way it was wrong is instructive. A
stale instrument is worse than none only if nobody notices it is stale - and an
instrument in the repo is exactly the thing a reviewer can re-run and catch. It
was re-run on this branch and it *did* disagree with four recorded figures,
which is how those got corrected. A harness that is deleted after every pass
cannot be re-run, so its numbers can never be falsified; that is the worse
failure, not the better one.

So: **keep the harness, and treat disagreement between it and a recorded number
as the number being stale.** Do not defend the number. Reproduce it by building
`Sim::new_from_shipped_lot()`, spawning the agent `web/src/main.ts` spawns, and
ticking 12 000 times while logging, per tick, the best score any candidate
offers. The measured percentiles are recorded in `content/tuning.toml` beside
each value and in `docs/alpha-feel-notes.md`; if a re-measurement disagrees with
them, the content changed and the knobs need re-deriving rather than defending.

---

## [L41] A guard shadowed by a second guard is only testable where the shadow is absent

**What happened:** M1b Task 4 added the autonomy override of [D-3]: a
player-issued intent suppresses `select_action`. Two mechanisms implement it
and they overlap almost completely.

1. `serve_intents` runs first and turns the front intent into a `Target`.
2. `select_action` skips any agent whose `IntentQueue` is non-empty.

`select_action`'s query already carries `Without<Target>`, so on almost every
tick mechanism 1 alone is sufficient and mechanism 2 decides nothing. The
milestone's headline test - `a_queued_intent_suppresses_autonomy`, the one the
task brief specified - passes with the emptiness filter **deleted**, because
the agent it checks has a `Target` by the time selection runs. Written as
specified, the task would have shipped an untested guard behind a test whose
name claims to cover it, which is exactly the failure family
`docs/testing-protocol.md` exists for.

The guard was verified only after asking, deliberately, *on what input is this
line the thing that decides?* The answer turned out to be a state the obvious
fixtures never reach: an agent whose intent names an object another agent has
reserved. It waits, so it has no `Target`, no `Eating` and an instruction it
still means to carry out - and with the filter gone it wanders off to something
else instead.
`a_sim_waiting_for_a_reserved_object_does_not_fall_back_to_autonomy` is that
fixture, and deleting the filter makes it red with the sim holding a target for
the wrong object.

**Root cause:** this is [L34]'s shape - a suite whose inputs all share a
property cannot detect a change that only shows on inputs lacking it - but the
property is invisible in a way [L34]'s was not. There, the shared property was
of the *fixture data* (all integers, all open grids), which a reader can see by
looking at the fixtures. Here it is a property of the *pipeline*: an earlier
system's effect masks a later system's guard, so the shared property is "the
earlier mechanism worked", which every fixture has because the code is correct.
**Defence in depth and untested code are indistinguishable from inside the
suite**, and the more thorough the earlier mechanism, the more completely the
later one is hidden.

**Prevention rule:**

1. When two mechanisms both enforce one rule, do not test the rule - test each
   mechanism. For each one, name the input on which it is **the only thing**
   standing between the code and the wrong answer. If no such input exists, the
   mechanism is dead code and should be deleted rather than tested.
2. That input is usually a *failure* of the other mechanism, not a variation of
   the happy path. Ask what happens when the earlier system cannot do its job:
   here, "the object is busy" was the only state that reached the later guard.
3. Write the answer into the comment beside the guard, naming the test. A
   reader who cannot see why a line matters is one refactor away from deleting
   it as redundant - and they would be right about every tick but one.

**How to verify:** delete the guard and run the whole workspace, not the test
whose name mentions it. If everything stays green, the guard is unprotected
regardless of how many tests appear to be about it.

---

## [L42] A "did the commands do anything" guard can be satisfied by the one command that changes no world state

**What happened:** M1b Task 5's replay test is the milestone's determinism
guarantee: a recorded command script must replay to the same world hash. The
equality on its own is [L5]'s shape - two runs in one process - so it was
surrounded by guards, one of which was meant to be the strong one:

```rust
assert_ne!(a, run_unscripted(TICKS), "the scripted run must differ ...");
```

`run_scripted` returns a tuple: the world hash **and** the selected entity's
index, because `world_hash` does not observe `Selected` and the selection had
to be asserted somewhere. That convenience quietly broke the guard. The script
holds three commands - `Select`, `UseObject`, `CancelIntents` - and only the
first has an effect that reaches the *tuple* without reaching the *hash*.

Measured during the task's hand-mutation pass: with the `UseObject` and
`CancelIntents` arms replaced by no-ops and only `Select` left working, the
tuples still differed and the assertion stayed green. The guard was answering
"did **any** command do anything" when the claim it exists to defend is "did
the commands change the **world**". Two thirds of the drain could have been
deleted with that line reporting success.

It was caught because the mutation pass ran a mutation nobody had predicted a
failure for - "only Select works" - rather than only the ones with a named
victim test, and then read *which assertion* fired rather than being satisfied
that the test went red. The per-command causal guards below it (drop the
`UseObject`, drop the `CancelIntents`, each must change the outcome) are what
actually caught it.

**Root cause:** the return value carried two things at different levels of
consequence - simulation state, and a projection of it that nothing in the
simulation reads - and a single `assert_ne!` over the pair cannot say which one
moved. A disjunction is the weakest assertion shape there is: it is satisfied by
its easiest term, and the easiest term here was the one with no causal power at
all.

**Prevention rule:**

1. **Never assert a difference over a tuple whose fields differ in
   consequence.** Assert on the field that carries the claim. If two fields both
   need asserting, that is two assertions.
2. When a test bundles a value into its result "because it had to be checked
   somewhere", check whether any *other* assertion in that test now ranges over
   the bundle. Adding a field to a return type silently weakens every
   inequality over it.
3. A mutation pass should include at least one mutation with **no predicted
   victim**. The ones with a named test confirm what you already believe; the
   unpredicted one is what finds the guard that was never load-bearing.

**How to verify:** disable every mechanism the test claims to cover except the
cheapest one, and confirm the test still fails. If it passes, the guard is
measuring the cheap mechanism.

---

## [L43] A full mutation sweep stopped early is not a partial answer, it is a clean-looking one

**What happened:** M1b Task 5 found, and killed, a guard whose second clause
nothing constrained: `intent.object == target.object && intent.interaction ==
target.interaction` in `drain_commands`. Its own report and the code comment it
left both noted, correctly, that **`tick_interactions` uses the same
comparison** for the same reason.

The twin was never swept. Task 5's full sweep was stopped at 204 of roughly 420
mutants after 45 minutes, and its report says so honestly - it records that
`advertise.rs` was past the stopping point and reasons about which baseline
entries the prefix could and could not have reached. `interact.rs` was further
past it still and is not mentioned at all.

M1b Task 6 ran the first sweep since to complete, and it reported:

```
crates/terri-sim/src/systems/interact.rs:139:52: replace && with || in tick_interactions
```

Six survivors, five of them the baseline's. The sixth had been sitting in
`main` for two tasks with a green CI gate over it the whole time, because
`missed.txt` from a stopped run contains only what was reached, and the gate
compares set difference against the baseline. **A survivor the sweep never
tested is indistinguishable, in that file, from one it cleared.**

The relaxed form is a real bug and the same one Task 5 fixed: `UseObject`
always names interaction 0 and an autonomously chosen interaction is 0 on every
single-interaction object, so a sim finishing the meal it chose for itself with
a click for a *different* object waiting behind it would have that click
silently discarded. The player's instruction disappears with no error.

**Root cause:** two failures compounding, and the second is the one worth
remembering.

1. A finding of the form "this exact comparison also appears over there" was
   written down and not acted on. It is the single cheapest lead a mutation
   sweep ever produces - the bug's location is already known - and it was left
   as prose.
2. **A stopped sweep's `missed.txt` was compared against a full baseline.** The
   comparison is only sound when the run covers at least what the baseline
   covers. Task 5 knew this and reasoned about it for the *entries in* the
   baseline; the case it could not reason about is the entry that is not in the
   baseline yet, because there is nothing to notice its absence against.

**Prevention rule:**

1. When a sweep or a review finds an unconstrained guard, **grep for the same
   comparison elsewhere in the same commit** and either kill or sweep every
   copy. A twin named in a comment is a to-do, not an observation.
2. A sweep that did not finish may **add** to the baseline argument and must
   never be treated as **clearing** anything. Record the stopping point as a
   list of files not reached, so the next task can sweep those first rather
   than re-deriving what was missed.
3. Prefer a **scoped sweep that finishes** over a full sweep that does not. The
   scoped run over every file a task touched is minutes, not an hour, and it
   answers the question the gate actually asks. Run both; believe the scoped
   one about your own changes and the full one about everything else.

**How to verify:** `cargo mutants --package terri-sim -f
crates/terri-sim/src/systems/interact.rs --test-workspace true --timeout 60`
reports 21 mutants, 21 caught, 0 missed. Before
`a_finished_interaction_pops_only_the_intent_that_named_the_object_it_finished`
it reported one missed, and that test fails on the `||` mutant and on deleting
`queue.pop()`, which is what stops it being a one-sided assertion.

---

## [L44] Scaling elapsed time and shrinking the step are the same arithmetic, so a step count cannot tell them apart

**What happened:** M1b Task 7 added the speed controls, whose one binding
constraint is [D2]: speed multiplies how many simulation steps run, and never
how long a step is. The test written for it asserted both halves - the step
count scales with speed, and `stepDurationMs` does not - and the hand-written
mutation for it was a driver that implements "2x" by halving `stepMs` instead
of doubling the accumulator.

It was killed, and **by the wrong assertion**. The failure was
`expected [10, 20, 29] to deeply equal [10, 20, 30]`: at 3x the mutated
driver's step is `100/3 = 33.333...`, which is not exact in binary64, so a
1,000 ms frame lost one tick to rounding. The count assertion caught a
floating-point artifact, not the violation.

**Root cause, and it is arithmetic rather than an oversight.** For an
accumulator driver, scaling the elapsed time by `k` and dividing the step by
`k` produce *identical* observable behaviour:

```
ticks   = floor(k*d / S)         = floor(d / (S/k))
alpha   = (k*d mod S) / S        = (d mod (S/k)) / (S/k)
```

Both the step count and the interpolation alpha agree at every elapsed time
and under every frame pacing. **The count half of the test is therefore
vacuous with respect to the thing it was written for**, and it only appeared
to work because 100/3 is inexact. Speed 2 - where 100/2 is exact - is the case
that shows it: a mutation confined to 2x produced the *identical* count
`[10, 20, 30]` and was caught only by `expected [100, 50, 100] to deeply equal
[100, 100, 100]`.

This is the [L11] family with a new denominator: two mechanisms that agree on
every sample the obvious instrument can take.

**Prevention rule:**

1. **A driver's step duration must be observable, or [D2] is unpinned.**
   `FixedStepDriver.stepDurationMs` exists for exactly this and for nothing
   else; it is the only assertion that separates the constraint from its
   violation.
2. When a mutation is killed, **check which assertion killed it**, not just
   that the test went red. A pass/fail is not evidence about which line is
   load-bearing, and here the two answers were different.
3. When designing the mutation, **pick the arithmetic where the two candidate
   mechanisms are exactly equal**, not where they merely should be. Inexact
   division hid the equality at 3x and revealed it at 2x.

**How to verify:** confine the dt-violation to speed 2 -
`stepMs = base / 2` when `multiplier === 2`, with the accumulator left
unscaled at that speed - and run
`npm test -- -t "multiplies the number of steps"`. The count assertion on
line 305 passes; the duration assertion on line 309 fails. Delete the
duration assertion and the mutation survives the whole suite.

---

## [L45] Chrome no longer carries CSS property accessors where a probe expects them, and the probe reads zero

**What happened:** Task 7's browser check counted panel writes by wrapping the
`width` setter on `CSSStyleDeclaration.prototype`. It reported **0 bar writes
over 3,743 frames** while the bars were visibly moving on screen and the
screenshot showed all seven of them.

`Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'width')` is
`undefined` in current Chrome, and so is the whole prototype chain above an
element's `style`: the individual CSS property attributes are not own
properties of that object. Nothing threw. The patch simply never installed,
and the counter it initialised stayed at its initial value, which is the
reading that means "the panel never wrote a bar".

**Root cause:** the same shape as [L20] half two and [L37] - an instrument
that cannot observe the phenomenon returns the number that means the
phenomenon did not happen. A patch that silently declines to install is worse
than one that throws, because the zero it leaves behind is a plausible
measurement.

**Prevention rule:**

1. **A monkey-patch must record that it installed**, and the probe must print
   that flag beside the count. `patchedOn: null` next to `widthWrites: 0` is a
   broken instrument; `patchedOn: "CSSStyleDeclaration"` next to
   `widthWrites: 0` is a finding about the page.
2. Prefer an observer over a patch where one exists. A `MutationObserver` with
   `attributeFilter: ['style']` sees what the page actually wrote and does not
   depend on where the engine chooses to define an accessor.
3. Best of all, count the thing at its **source**: the panel calls `needsOf`
   exactly once per read and nothing else on the page calls it, so wrapping
   that is a direct count of reads rather than a proxy for one. Measured that
   way: 97 reads in 10 s over 1,202 frames, one read per 12.4 frames, against
   a 100 ms tuned interval.

**How to verify:** in any current Chrome,
`Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'width')`
returns `undefined`, and walking `Object.getPrototypeOf(document.body.style)`
to the top finds no own `width` descriptor on any link of the chain.

---

## [L46] A harness that supplies its own clock measures nothing, and the frame counter still climbs

**What happened:** M1b Task 8's play session drove the frame loop through
`__terriStress.step()` in a tight loop, 250 times, and reported that every
click was ignored and the sim was frozen at one position. Both conclusions
were false. `step()` called `performance.now()` internally, so successive
calls passed deltas of roughly zero milliseconds, the fixed-step accumulator
never reached one step, and the simulation advanced almost no ticks. The
commands were sitting in the staging queue because nothing was draining it.

**Root cause:** the same family as [L14], with one crucial difference.
[L14] is "the frame callback never fires, so the counter reads zero and the
harness reports a flawless p95 over no data" - a *frozen* instrument, and
`timer.frames` was added specifically so a zero would be visible. Here the
counter climbed to 250. A moving counter reads as a working harness, so the
tell that saved [L14] was absent. The instrument was not stopped; it was
running on a clock that never advanced.

Worth naming precisely: `frame(nowMs)` derives elapsed time from the *gap*
between calls, so a harness that supplies the wall clock and a harness that
supplies nothing are the same thing when the harness is faster than the
wall clock. Real rAF works only because the browser spaces the calls.

**Prevention rule:**

1. **A behaviour harness must own the clock; a timing harness must not.**
   These are opposite requirements and one function cannot default to both.
   `step(nowMs?)` now takes an optional timestamp: omit it to measure what a
   frame costs, pass a monotonic sequence to make the simulation actually
   run.
2. **Never accept a frame count as evidence that a simulation advanced.**
   They are different quantities and this is the case that separates them.
   Assert on something the simulation owns - the tick count, the clock
   resource, or a need level that must have decayed.
3. A harness's first assertion should be that its subject *moved*. This
   session's first run would have failed instantly on "the sim's position
   after N steps differs from its position before".

**How to verify:** call `step()` in a loop with no delay and read a need
level before and after. With the clock defaulted it barely changes; with a
monotonic `nowMs` at 16.67 ms per step it decays at the tuned rate.

---

## [L47] A mapping that is the identity by coincidence is a bug with a scheduled arrival date

**What happened:** picking a clicked entity means finding the render-buffer
row standing on a tile and then naming that entity in a `Select` or
`UseObject` command. The buffer is sorted by entity index and carried no id
column, so the row number was the only thing available - and it is correct,
exactly, for as long as live entity indices run `0..count` with no gaps.
Nothing in the shipped game despawns, so that held on every world a player
could produce. It would have gone in green.

**Root cause:** the coincidence is load-bearing and invisible. Row number and
entity index are both `u32`, both are indices, and they are equal in every
test anyone would naturally write - so no type error, no failing assertion,
and no wrong behaviour until the first despawn leaves a hole. After that,
every click past the hole selects or directs *a different live entity*, which
is the worst available failure: not a crash, not a no-op, but a plausible
wrong answer.

M1d adds death. The expiry date was already on the calendar.

**Prevention rule:**

1. **When two identifier spaces coincide, export the mapping rather than
   relying on the coincidence.** `RenderBuffer::ids` costs one `u32` per
   entity and removes the whole class.
2. **A fixture for a mapping must break the coincidence**, or it cannot see
   the identity mutation. `a_row_is_not_its_entity_index_once_an_index_is_freed`
   despawns the *second* of four entities on purpose: despawning the last
   would leave rows 0..2 still equal to indices 0..2, and the test would pass
   against `push(row_number)`. It asserts `ids != [0, 1, 2]` first, as a
   precondition, so it cannot go quietly green if entity-index reuse ever
   closes the hole. This is [L34] applied before the fact rather than after.
3. Ask of any index crossing a boundary: **whose numbering is this, and what
   makes it survive the other side's edits?**

**How to verify:** replace `ids[row]` with `row` in `pickAt` and the web
suite fails; replace `push(*index)` with a row counter in
`sync_render_buffer` and the Rust test fails.

---

## [L48] Two different states that render identically will be conflated by the measurement as readily as by the player

**What happened:** measuring how fast a click retargets a *busy* sim needed a
way to tell a busy sim from a free one. Position is all the render buffer
exports, and a sim using an object stands on that object's tile - so "busy"
was classified as "standing on an object's tile". The resulting latencies ran
2, 4, 4, 5, 14, 16, 43 and 124 ticks, up to 12.4 real seconds, and supported
a confident and completely wrong conclusion: that clicks on a working sim are
ignored for a very long time.

The sim in those cases was **idle**, standing on a tile it had finished with.
Re-measured against a need actually *rising* - the only externally visible
sign of an interaction - interrupting a genuinely busy sim takes 1 to 18
ticks, and a Rust test now pins that a click preempts on the tick it arrives.

**Root cause:** the two states are one picture. Nothing in the exported state
distinguishes "using the sofa" from "standing on the sofa having finished",
so any classifier built from exported state must conflate them. The error was
not the arithmetic; it was believing an observable existed.

**Prevention rule:**

1. **Before measuring a state, name the observable that distinguishes it from
   its neighbours** - and if there isn't one, that absence is the finding.
   Here it is a real finding: a player cannot tell either, and multi-step
   interactions turn "which step is this sim on" into something the player
   must be able to read.
2. **Prefer a simulation-side test to an outside-in measurement for a
   simulation question.** The preemption question took hours from the outside
   and produced the wrong answer; from inside it is one deterministic test
   with three assertions and no timing at all.
3. Treat a wide spread in a latency measurement as a **classifier** problem
   before treating it as a *subject* problem. A 60x range (2 to 124) across
   supposedly identical conditions means the conditions were not identical.

**How to verify:** `a_click_preempts_an_interaction_already_running` in
`crates/terri-sim/src/systems/command.rs` asserts the retarget, the dropped
`Eating` and the released `Reserved` on the tick the command arrives. Its
`tick_until_interacting` helper is the distinction the outside-in pass
lacked.
## [L49] A need nothing advertises is invisible to the suite for the same reason it is inert

**What happened:** `content/needs.toml` declared `social`, `content/tuning.toml`
gave it a decay rate of 0.035 a tick, and no interaction in
`content/objects.toml` advertised it. It drained to zero at about tick 2 857 -
4.8 minutes at 1x - and stayed pinned there for the rest of every session. It
had done so since the need was declared. 188 tests were green.

**Root cause: the two facts are one fact.** Selection scores an agent's deficit
against what objects advertise, so a need no object advertises contributes
nothing to any score. Having no behavioural effect is exactly what makes it
untestable by any behavioural test - there is no observable difference between
"declared and unsatisfiable" and "not declared", from inside the simulation.
Every test in the suite asks a question about behaviour, so none of them could
have a reason to notice. This is not a coverage gap that more behavioural tests
would close; more of them would all be equally blind.

The general shape: **content that exists and does nothing is invisible to any
test that observes what the game does.** `every_declared_object_is_placed_on_the_lot`
already existed for the same class one layer out - an object nothing places
cannot be chosen - which is the precedent that made the fix obvious once the
class was named.

It was found by a human watching the game for twenty minutes and writing down
what it did, recorded as [C2] in `docs/alpha-feel-notes.md`. That instrument
found three things the suite structurally could not.

**Prevention rule:**

1. **Check declarations against uses, statically, over the compiled pack.** Not
   over behaviour - a static check is the only kind that can see content whose
   defining property is having no behaviour.
   `every_declared_need_can_be_satisfied_by_some_interaction` in
   `crates/terri-data/src/lib.rs` is the instance.
2. **Require the delta to be POSITIVE, not merely present.** A delta may legally
   be negative - the shower's `energy = -12.0` is a cost that scoring weighs - so
   "the need appears in some advert list" is satisfied by a need that can only
   ever be *drained*, which is exactly as unfillable. Energy is separately
   advertised `+100` by the bed, so the weaker rule passes today and would go on
   passing through the content edit that broke it.
3. **When a declaration/use check is added, say in the failure message what both
   ways out are.** This one names the need and offers "advertise it" or "stop
   declaring it", because those were the two coherent fixes and whoever trips it
   next inherits the same choice rather than a bare assertion.

**A second finding, about the tuning rather than the gap.** The delta was first
set to 14 by arithmetic - solve `delta * deficit^3 / time_cost` against the
measured median score - and the measurement said the estimate was in the right
band but the *direction of the knob* was backwards. **A smaller social delta
makes the television MORE dominant, not less:** 8 gave it 30.1% of all
interactions, 14 gave 21.1%, 24 gave 14.4%. Because urgency is cubed, halving
the delta buys back only a cube root of deficit, so the sim holds the need lower
*and* visits more often, since each visit delivers less. Anyone reasoning "keep
the placeholder small so it does not distort behaviour" would have tuned it in
precisely the wrong direction, and no test would have said so. See [L40], which
is the same lesson about a different knob.

**How to verify:** set the television's `watch_tv` advert back to
`{ fun = 30.0 }` and run `cargo test -p terri-data every_declared_need`; it
fails naming `social`. Set it to `{ social = -24.0, fun = 30.0 }` - present in
the advert list, so the weaker "appears at all" rule would pass - and it fails
identically, which is what pins rule 2 above. Restore by inverting the exact
edit and confirm `git hash-object content/objects.toml` matches the value from
before the mutation ([L9]), then touch the file ([L8]).

The trace harness behind the delta table is not in the repo, per [L40]:
rebuild it as `Sim::new_from_shipped_lot()` plus the agent `web/src/main.ts`
spawns, 12 000 ticks. It reproduces [O1]'s 121 interactions exactly on the
no-advert content, which is what makes the four rows comparable.

## [L50] A hanging test suppresses every assertion that already failed in the same run

**What happened:** three `rng.rs` mutants - `next_u32 -> 0`, `next_u32 -> 1` and
`replace >= with < in SimRng::range` - reported TIMEOUT in every sweep from M1c
Task 1 to M1b Task 7, about seven runs. They cost 180s of the mutation job each
time and were invisible to the gate, which compares `missed.txt` while a
timeout lands in `timeout.txt`. `docs/mutation-baseline.md` recorded them
correctly as detections, and concluded: *"An unbounded rejection loop is
inherent to debiased sampling and is not worth capping."*

**That conclusion rested on a misreading of the outcome column.** Measured
properly - each mutant applied alone, each test run alone under an 8s deadline -
**all three fail real assertions.** `next_u32 -> 0` fails 14 tests,
`next_u32 -> 1` fails 15, and the comparison flip fails 2, among them
`a_golden_sequence_pins_the_algorithm` and
`range_is_uniform_at_a_bound_that_divides_badly_into_2_32`. Every one of the
three was already killed by an assertion.

**Root cause: the outcome column describes the worst-behaved test in the run,
not the strength of the detection.** `cargo test` does not exit until every
test finishes, so one test spinning inside `SimRng::range`'s unbounded
rejection loop means the process never reports the failures that had already
happened. The hanging tests and the detecting tests were **different tests**.
TIMEOUT therefore said "something in this run hangs", and was read as "this
mutant is only detected by a hang", which is a different and much weaker claim.

The inconsistency this created is worth seeing. `roll_wander_path`, one crate
away, bounds its re-roll loop and its doc comment says the bound *"is what
stops that becoming a hang"*, citing [L15]. The identical argument had already
been accepted for the identical shape of bug; it did not transfer, because a
rejection loop and a re-roll loop do not look alike.

Once the assertions were known to exist, the cap was free. A rejection needs a
draw below `2^32 % bound`, which is under `2^31` for every bound, so one
rejection is always less likely than a coin flip and 128 in a row is under
2^-128. It cannot fire on a working generator and it changes no draw, so no
golden hash and no replay moved.

**Prevention rules:**

1. **A TIMEOUT is a statement about the run, not about the mutant. Find the
   hanging test before concluding anything.** Run each test alone under a
   deadline; expect the hang and the detection to be in different tests.
2. **Bound every loop in production code, and panic on overrun** - however
   unreachable the bound is, and with the arithmetic for "unreachable" written
   next to it. `debug_assert!` will not do: `wasm-pack` builds release, so per
   [L12] the shipped target would keep the hang while `cargo mutants`, which
   builds debug, reported it fixed.
3. **Make the guard reachable by a test.** The cap can only fire on a broken
   generator, so `range`'s loop was extracted as `draw_below_bound(bound,
   draw)` taking its draws from a closure. A test hands it `|| 0`; without
   that seam the cap would be an untested guard, indistinguishable from no
   guard.
4. **Gate on `timeout.txt` as well as `missed.txt`.** Zero tolerance, not a
   second baseline: the fix for a hang is a bound, and an allowance that can
   grow invites raising `--timeout` instead.

**How to verify:** apply any of the three mutations to
`crates/terri-core/src/rng.rs` and run `cargo test -p terri-core --lib`. Before
the cap it never terminates; after it, `draw_below_bound` panics and the run
reports failures. Do it under the [L15] harness rules - output to a file,
`taskkill /F /T` the tree, restore in a `finally` - and confirm
`git hash-object crates/terri-core/src/rng.rs` matches the pre-mutation value.

---

## [L51] A detector needs a must-be-negative case and a must-be-positive case, asserted in the same run

**What happened:** three instruments built to verify the alpha's rendering and
behaviour were wrong before they were right, and each was wrong in a way that
produced a confident answer.

1. A pixel test for "is anything drawn here" classified emptiness as
   `alpha < 128`. The WebGPU render target is **opaque**, so alpha is 255 on
   every pixel of the canvas. It reported zero gaps in the floor and zero gaps
   in the walls, and both were vacuous. The tell was a fourth number printed
   beside them - `paintedCoveragePct: 100` - which cannot be true of a
   704 x 462 lot on a 1280 x 720 canvas.
2. A text render of the frame, built to inspect the layout cheaply, showed
   apparent **gaps in the wall runs** - exactly the defect the pass had just
   claimed to fix. Artifacts: it sampled one pixel in ten across and one in
   fifteen down, and binned antialiased edge pixels as background. A dense
   per-column scan found 0 gaps in 864 columns.
3. A behaviour-trace harness classified every tick of every meal as a wander
   pause, because it tested for the `Wander` marker before the `Eating` one. It
   reported 52.3% of a run paused against 0.2% interacting, for 124 interactions
   averaging 30 ticks - two numbers that cannot both be true.

**Root cause:** each detector had only one kind of case. Nothing in the run
established that it could say "no" when the answer was no, or "yes" when the
answer was yes - so its output was unfalsifiable, and a vacuous pass looked
identical to a real one.

**Prevention rule:** a detector must assert, in the same run that uses it, both
that it reports **negative on a case that must be negative** and **positive on a
case that must be positive**. The column scan that finally settled the wall
question does this structurally: it prints the empty-column count next to the
notch count, and a broken classifier moves both to absurd values at once. The
colour-based pixel test asserts the canvas corners read as background and the lot
centre does not, before it reports anything.

This is [L3], [L7] and [L34]'s family, but the rule is sharper than "test your
tests": it names the two specific cases to include. Where a detector's output is
a count, print a second count that must move the other way.

**How to verify:** invert the classifier - swap background for foreground - and
confirm the sanity assertions fail rather than the counts merely changing.

---

## [L52] A hand-mutation harness must be calibrated on a mutation that is known to be caught

**What happened:** this task's hand-mutation pass over the web shell - five
mutations of the new `interaction` argument, each applied, tested and reverted by
a script - reported **"NOTHING FAILED" for all five**. Taken at face value that
would have meant the entire TypeScript side of the change was untested, and the
honest response would have been to write five more tests.

All five were in fact caught. The script scraped vitest's output for lines
beginning with `×`, which the reporter in use does not emit; the failure lines
are `FAIL  tests/<file> > <suite> > <name>`. Applying one mutation by hand and
reading the raw output took under a minute and showed the named test failing with
the expected diff.

A second, quieter instance in the same script: it captured output as text with
the platform's default `cp1252` codec, vitest writes UTF-8 box-drawing
characters, and the resulting `UnicodeDecodeError` killed the runner thread
**after the mutation had been written and before it was reverted**. The
mutation sat in `web/src/input.ts` until the next `grep`.

**Root cause:** the harness had no positive control. Its "no test failed" branch
and its "the parser matched nothing" branch produce the same output, which is
[L51]'s missing must-be-positive case applied to a tool rather than to a
detector - and it is worse here, because the failure direction is *reassuring*.
A parser that silently matches nothing reports every mutation as undetected,
which reads as "write more tests" rather than as "fix the harness". The
unreverted mutation is the ordinary version of the same thing: the revert was in
the happy path instead of a `finally`.

**Prevention rule:** any script that decides whether a mutation was caught must
**first run a mutation whose answer is known**, and abort if the answer comes
back wrong. Calibrating on a known-caught mutation is one extra iteration and it
converts a silent parser into a loud one. Two corollaries:

- Put the revert in a `finally`, and hash the file before and after so
  "restored byte-identical" is printed rather than assumed. Testing-protocol
  rule 1 asks for that assertion; it also has to survive the runner crashing.
- Decode subprocess output as UTF-8 explicitly on Windows. `capture_output=True,
  text=True` uses the ANSI code page, and every modern test runner emits box
  drawing.

**How to verify:** point the harness at a mutation that a named test definitely
catches - here, hardcoding `interaction: 0` back into `drain_commands` - and
confirm it reports that test by name. If it reports nothing, the harness is
broken, not the suite.

---

## [L53] A rule that is correct for every case the fixture can express is not a correct rule

`tiles.ts` decided which of two wall sprites a tile draws:

```ts
return isWall(x, y - 1) || isWall(x, y + 1) ? 'wallNS' : 'wallEW';
```

One panel per tile, ties resolved towards north-south. It had a paragraph of
comment justifying the tie-break, three tests, and it was **wrong**, and neither
the comment nor the tests could tell.

The lot it was written against had two wall runs meeting at a single L corner.
At an L corner the tile has a neighbour on one side of each axis, so either
panel closes the join and both possible rules produce an identical picture. The
fixture was an L. The tests asserted the corner's sprite with
`expect(...).toContain(ns)`, which the correct rule also satisfies.

Then the lot became five rooms. Its spine runs east-west across the lot with
three north-south dividers hanging off it, and a T-junction tile has neighbours
on BOTH sides of one axis. All three took the north-south panel, so the spine had
three panels turned ninety degrees in the middle of it and read as a wall with
holes punched through it - at exactly the three places a viewer looks first.

**What caught it was a screenshot.** Not a test, not a review, not the type
system: a PNG of the running game, looked at. The full gate was green before and
after.

### The fix was also wrong, and that is the more useful half

The obvious repair was to draw BOTH panels at a junction tile, reasoning that a
32 px panel on a 64 px tile diamond leaves room for two - one on the tile's east
half, one on its west, abutting rather than overlapping. Tests were written, the
gate went green, a new screenshot was taken, and it **looked** fixed.

It was not. `sprites.wgsl` centres every quad on its anchor, so two panels
written at the same tile occupy the same 32 px rather than two halves. Measured
off the atlas: only 356 of the second panel's 2540 opaque pixels - 14% - fall
where the first is transparent. A pixel diff of the before and after frames
matched that exactly: 726 pixels changed in the whole 1280 x 720 frame, every one
inside the three junction boxes, and the most exposed box changed by precisely
356. So 86% of the "fix" was hidden behind the panel it was meant to replace, and
the junction still read as the wrong orientation.

What ships is a third rule: at a junction, the run that PASSES THROUGH wins - a
T has neighbours on both sides of one axis and one side of the other, and that
asymmetry is the answer. One panel per tile, which also avoids [V12]'s depth
conflict, since two quads at one tile share a depth and `depthCompare` is
`less`.

### What to take from it

1. **"Correct on every input the fixture can express" is the trap, and it is not
   the same as [L34].** [L34] is about a fixture whose values coincide, so a
   transposition is invisible. This is about a fixture whose SHAPE excludes the
   case - an L-shaped wall run cannot contain a T-junction, however its
   coordinates are chosen. Ask what shapes the fixture cannot be, not only what
   values it happens to hold.
2. **`toContain` cannot see a missing element.** The original bug was an absent
   panel, and "the answer includes X" is satisfied by the too-small answer as
   well. Reach for an exact list whenever the defect you fear is omission.
3. **A comment that argues for a tie-break is a signal that the tie is real.**
   The old comment said a corner "qualifies both ways" and then explained which
   way it was given. That sentence contained the whole bug.
4. **A screenshot is not a measurement, and it will confirm what you expect.**
   The second wrong version was signed off on an after-shot that looked better.
   The pixel diff took two minutes and was decisive. When the claim is "this
   changed what is drawn", diff the pixels and predict the number first - the
   356 matching on both sides is what turned a hunch into a finding.

**How to verify:** the fixture set is now an L, a T, a **transposed** T - because
the T alone cannot see "always prefer east-west at a junction", where the
through-run already is east-west - and a free-standing tile. See [B5] in
`docs/specs/2026-07-30-the-house-design.md`.

---

## [L54] Halving a delta and halving a rate are different operations

The house gained five comfort objects and all five went unused, because comfort
never dropped low enough for `deficit^3` to make them worth anything. Two of the
three fixes were right. The third was to **halve the five new comfort deltas**,
on the reasoning that a smaller top-up means a sim has to sit down more often, so
comfort settles at a lower level where the seats are worth choosing.

That reasoning is sound and the change was still wrong, because it ignored what
the five objects were being compared *against*. Score is

```
delta * deficit^3 / (distance / TILES_PER_TICK + duration + 1)
```

so what decides between two seats at similar distance is `delta / duration` - a
rate. The five new seats had durations from 41 to 78 ticks; the pre-existing
ottoman sofa is 34 comfort in 50 ticks, a rate of 0.667. Halving put the two
biggest new seats at about 0.37, which is not "less generous", it is **strictly
dominated**. Over 120 000 ticks the ottoman took 72 uses and those two took
zero.

So the first pass had comfort objects that were never wanted, and the second had
comfort objects that were wanted and never best. The fix was to raise the two
deltas until their RATES matched the field - 37 in 62 ticks and 43 in 72, both
0.597 against the ottoman's 0.667 and the armchair's 0.707 - which left the
supply where pass two had put it while spreading the demand.

**The rule:** when tuning a value that appears in a numerator over a duration,
tune the quotient. Halving a numerator is only a halving if every alternative
was halved too, and the alternatives here included an object that predated the
change by two milestones.

**How to verify:** compute `delta / duration` for every object advertising the
need before and after any delta edit, and check the ordering has not inverted.
The trace's candidate table prints per-need contributions at a fixed moment,
which is the same information from the other end.

---

## [L55] Arithmetic that cannot be called cannot be pinned with a golden value

`select_action` carried the habituation multiplier inline:

```rust
let benefit_scale = 1.0 - hab * (1.0 - content.0.tuning.habituation_floor);
let delta = if *delta > 0.0 { delta * benefit_scale } else { *delta };
```

Two lines, eight mutants, **seven of them surviving the entire workspace
suite** - confirmed by hand-mutation, not just by the sweep. This is the
mechanic that makes sims rotate between objects instead of repeating one, and
nothing constrained its arithmetic at all.

Three separate reasons nothing caught it, and each is worth recognising on
sight.

**1. The test that names the behaviour computes it itself.**
`habituation_scales_the_benefit_and_leaves_a_cost_at_full_strength` exists for
exactly this rule. It never calls `select_action`. It computes
`BENEFIT * scale` in the test body and compares that against other values it
also computed, so it is green with the production guard deleted. Rule 3 and
[L5]'s family, in a test whose name is a promise it does not keep.

**2. The end-to-end check has one candidate.** The world-hash golden vector's
scenario holds a single object, so a wrongly scaled score has nothing to
out-rank, the sim's choice is identical at any multiplier, and the digest does
not move. [L36] already recorded that this scenario cannot see how candidates
are ORDERED; it cannot see how they are WEIGHTED either.

**3. A behavioural test would not have been enough.** The obvious repair -
"habituate the sim on A, assert it picks B" - passes for three of the four
`benefit_scale` mutants, because they all still produce a multiplier below 1
for a partly habituated sim. Only magnitudes separate them: at full
habituation the four give 1.55, -0.818, -0.45 and -1.22 against the correct
0.45. Two of those are negative, which turns a benefit into a repellent.

### The rule

**A multiplier needs a golden value, and a golden value needs a callable
function.** Arithmetic inlined into a system whose only observable output is a
discrete choice can be bounded in sign and nothing more, because a choice
throws away the magnitude that produced it.

So: when a formula is the mechanic rather than a step in one, give it a name
and a signature. `benefit_scale(habituation, floor)` and
`scaled_delta(delta, scale)` are three lines of code between them, and pinning
them takes six assertions at the ends of the range and the midpoint.

The smell to watch for is a test whose body performs the operation it is
testing. If the fixture computes `expected` using the same arithmetic the
production code uses, the test is a statement about arithmetic in general
rather than about this program.

**How to verify:** hand-mutate the extracted function and confirm a NAMED test
fails. Calibrate the harness first on a mutation known to be caught ([L52]) -
and beware that `cargo test` prints `error: test failed` to **stderr**, so a
harness that scans stderr for "error:" before reading the failing-test names
reports every real kill as a compile error. That happened on the first run of
this very check.

## [L56] Two sessions fixed the same finding independently, and neither could have known

**What happened:** [C3] of `docs/alpha-feel-notes.md` - an agent beaten to an
object being told nothing was worth doing - was fixed **twice**, in parallel, by
two sessions working in two git worktrees off the same branch. Neither fix was
pushed while the other was being written. The two arrived at structurally the
same core change, down to the same variable, the same guard placement, and the
same three test cases including the empty-room control.

The duplication cost a full implementation. What made it recoverable is that the
two differed in what they added around the core fix, so one could be reduced to
the difference rather than thrown away: this branch keeps only the knob deciding
how much a contested object is worth and the marker recording that an agent's
best option is somebody else's, both of which the other fix lacks.

**Root cause:** parallel worktrees make it cheap to run several sessions at once,
and there is no cheap way for one to see what another has committed but not
pushed. A worktree's branch is invisible to `git branch -r`, absent from the PR
list, and reachable only by reading another checkout's local refs - which
nothing prompts anyone to do. **The findings list itself was the collision
point:** a numbered list of known defects is exactly the artifact two sessions
will independently pick the most interesting item from.

**Prevention rule:**

1. **Before implementing a numbered finding from a shared list, check every
   worktree's local branch, not just the remote.** `git worktree list` then
   `git log --oneline <remote>..<each local branch>` is two commands and it is
   the whole check. A branch that exists only in another checkout still contains
   the work.
2. **Push early on a branch nobody else can see.** An unpushed commit is
   invisible to every collision check anybody else could reasonably run,
   including the one above if they check the remote instead of the worktree.
3. **When duplication is found, diff the two before choosing.** The instinct is
   to keep the one that landed first and discard the other whole. The useful
   question is what each has that the other does not: here one had a tuning knob
   and a marker, the other had unrelated duration work in the same commit, and
   the answer was to keep the first fix and port only the difference.
4. This is a process failure rather than a code one, and it does not have a test.
   That is why it is written down.

**How to verify:** `git worktree list` shows every checkout. For each, compare
its branch against the remote it tracks. Any commit that appears there and not
on the remote is work no PR and no remote-branch listing will show you.

**A second, smaller observation from the same collision.** The two independent
implementations chose different names for the same concept - one called a taken
object "busy", the other "contested" - and the merged result had to pick one.
Naming is where parallel work diverges first and most visibly, and it is the
cheapest thing to standardise in advance if a findings list is going to be split
across sessions.
## [L57] A hand-mutation restored with `mv` reports the mutant's verdict against the original's source

**What happened.** Verifying two M2d guards by hand-deletion (they are
query filters and statement blocks, outside cargo-mutants' grammar): the
deletion failed the named test as hoped, the file was restored with
`mv file.bak file`, and the next `cargo test` run FAILED the same test
again - against source code that was demonstrably correct, confirmed by
a probe example that showed the mechanism working perfectly. Fifteen
minutes went to debugging phantom breakage in correct code.

**Root cause.** `mv` preserves the backup's modification time, which
predates the mutated build. Cargo's freshness check therefore considered
the mutated binary current and reran IT, while every tool reading the
file - grep, diff, the editor - showed the restored, correct source. The
test output and the source code were describing two different programs.

**Prevention rule.** After restoring a hand-mutated file, force the
rebuild: `touch` the file, or restore by writing content rather than by
renaming. Treat a hand-verification's second run as valid only if the
test output shows the crate actually recompiled. The same trap arms
itself in reverse: a hand-mutation applied with a backdated mtime would
"pass" without the mutant ever being built, making the whole
verification vacuous.

**How to verify.** Both orders of the M2d verification were rerun with a
`touch` between: delete guard, test fails; restore plus touch, test
passes, with a visible `Compiling terri-sim` line in each run.

## [L58] Humour shipped without the owner's eyes is a bug report waiting in a flyout

**What happened.** Every interaction label was written as a deadpan
joke in the game's intended register - "Take the good chair", "Shower
at length", "Soak until reconsidered" - and shipped through several
milestones unreviewed, because labels rode along with balance work.
The first time the owner actually played over the network, the labels
were the first thing he hit: one was ambiguous enough to misread
("TAKE the good chair"), others were "cringy and awkward", and the
direction was blunt - stop trying to be clever in interaction names.
All nineteen labels were rewritten to plain verb phrases the same day.

**Root cause.** Two errors compounding. First, jokes were placed where
they had the least room to work: a menu row is read in half a second
and the game renders no object descriptions, so a joke premised on
"there is exactly one good chair" had no way to establish itself.
Second and larger: tone is art direction, and art direction is one of
the five things the rules of engagement explicitly reserve to the
owner - shipping humour without his eyes on it was a scope violation
that happened to be spelled like content.

**Prevention rule.** Player-visible STRINGS are two categories with
different rules. Functional text (labels, buttons, errors) is plain
and says exactly what happens - the startup-failure card got this
right on the same day the labels got it wrong. Voice text (goal item
11's dark comedy) is drafted, shown to the owner, and only shipped
approved. Nothing in the second category ships as a side effect of a
milestone about mechanics.

**How to verify.** content/objects.toml's header carries the rule;
every current label is a plain verb phrase; the memory file
interaction-labels-stay-plain.md carries the standing direction.


## [L59] An undisplayed browser pane fires no animation frames, and headless WebGPU dies on reload

**What happened.** The M2e PR 3 played watch tried to run in the app's
browser pane while nobody had it displayed. The page loaded, the tools
answered, and the game silently never ticked: the pane only composites
when shown, an uncomposited page gets no requestAnimationFrame, and
the whole driver hangs off rAF. Twenty minutes went to "why is the sim
frozen" before the screenshot error's own text - "the Browser pane is
not displayed, so the page is not compositing frames" - was taken at
face value. The fallback, Playwright's headless Chromium, rendered and
ran perfectly ONCE; every subsequent reload in the same browser
process hit the no-WebGPU startup card, because the first page's GPU
device is never released and headless Chromium will not hand out a
second adapter. A separate self-inflicted confusion stacked on top:
under ?debug=1 the stats overlay starts VISIBLE, so the reflexive
backtick press HID it, and its frozen textContent then read as a
frozen simulation while the pixels were moving fine.

**Root cause.** Three tools with three quiet failure modes - pane
needs display, headless WebGPU is one-shot per process, the overlay
toggle is stateful - and all three fail as SILENCE rather than error.

**Prevention rule.** For an autonomous browser watch: use Playwright,
treat the browser process as single-use (one navigation per watch; if
a reload is needed, expect the WebGPU card and get a fresh process),
and read the startup-failure card FIRST on any frozen-looking page -
the game says out loud when it has no GPU. Never diagnose through the
?debug=1 overlay without first confirming it is updating (two reads a
second apart must differ while unpaused). What pixels cannot show,
pin with a boundary test through the release wasm instead - the
shipped-day career test is the pattern.

**How to verify.** [A-14]'s watched-session paragraph records the
episode; web/tests/bridge.test.ts runs the shipped day through the
release artifact.

## [L60] Names shipped that only their author understood, and nothing defined them

**What happened.** The owner played two sessions and both times the
report was about WORDS rather than behaviour. The debug overlay called
a sim's traits `wears:` ("wtf is wears? that's a terrible name for it
unless it's referring to a t-shirt"), and printed personality
multipliers as two rows of seven `1.00`s labelled `drain:` and
`satisfaction:` - which he read, correctly, as broken statistics,
because a column of neutral values labelled like a reading looks like a
reading that failed. The replacement line naming why a sim was stuck
then shipped as `standing:`, which he caught in the same breath:
"can't you see how that would be confusing?" It was also carrying a
pending-order count, which is not a stall reason at all.

Then the real question: was any of this written down anywhere? It was
not. The project had 59 lessons and 13 design specs recording every
decision in obsessive detail - and no glossary. To learn what a drain
multiplier was, a reader had to find [S4] inside a spec named after a
July date. The documentation was organised for its author, keyed by
IDs, which is the same failure as the labels, one level up.

**Root cause.** Naming was treated as a side effect of implementing,
so labels came out as whatever the implementation called the thing
internally, and the definition lived in the head of whoever wrote it.
Nothing in the process ever asked "would this word mean anything to
somebody who did not write it?"

**Prevention rule.** `docs/glossary.md` now exists and carries the
naming rules as its last section: a label names the thing rather than
the implementation's mood; one label means one thing (if it needs "and
also", it is two lines); a number's label says what the number DOES
(`drains: fun x1.30`); show deviations, never rows of defaults; and
**every player-visible or developer-visible word gets a glossary
entry** - if it is not in there, either name it better or document it,
those being the only two options. Functional text stays plain; the
comedy lives in object names and the authored voice pass ([L58]).

**How to verify.** `docs/glossary.md` defines every term the overlay
prints; the overlay's own test asserts the current labels
(`traits:`, `drains:`, `refills:`, `stalled:`, `orders waiting:`); and
README.md points at the glossary first, so the next reader lands on
definitions rather than on decisions.

## [L61] A sweep is per code change, not per pull request

**What happened.** Three CI failures in one afternoon, all the same
shape: a change made AFTER the branch's local mutation sweep went out
untested, and the sharded sweep in CI found the survivors instead of
me. First the M2f overlay accessors, then `stall_reason_of` and
`queued_orders_of` (added mid-conversation for the owner), then the
busy check that fixed the stale stall reason - each one a small,
obviously-correct edit made in response to live feedback, each one
pushed within minutes of being written.

**Root cause.** The sweep was being treated as a PR-shaped ritual -
"sweep before opening the PR" - rather than as a gate on code. Every
one of these changes landed after that moment, and none of them felt
big enough to re-run a three-minute sweep for. The pattern is
strongest exactly when feedback is arriving quickly, which is also
when the pressure to push fast is highest.

**Prevention rule.** Re-run the targeted sweep before EVERY push that
changes Rust, not once per branch: `git diff origin/main HEAD --
crates/ > patch` then `cargo mutants ... --in-diff patch`. It costs
two to three minutes against a CI round trip of fifteen, and the
sweep is the only gate that sees the class of bug these were -
accessors nothing reads back, and boolean chains whose terms are only
partly exercised.

**How to verify.** The last push of this session ran the sweep first
(21 mutants, 21 caught) and CI agreed. A red mutants shard on a
branch whose last local sweep was clean means the sweep was run
before the change rather than after it.

## [L62] A mouse gesture is not a feature contract

**What happened.** The simulation had object actions, queued orders, camera
gestures, need meters and failure handling, but much of that disappeared for
anyone who did not already know the source code. Full actions required a
right-click, queueing required Ctrl or Cmd, the menu could extend beyond a
viewport corner, its focus stayed on the page body, need meters exposed no
numeric accessibility values, and the running canvas announced fallback text
claiming WebGPU was unsupported. The features existed mechanically and failed
as a game interface.

**Root cause.** Input was implemented per event handler rather than as a
player capability matrix. Desktop mouse success was treated as proof of an
interaction even though touch, keyboard, responsive placement, focus return,
screen-reader state, discovery, and visible rejection feedback were separate
contracts.

**Prevention rule.** Every new player action must name its mouse, touch, and
keyboard routes, its visible discovery path, accepted and rejected feedback,
and its focus behavior. Any floating surface is checked at all four viewport
corners. Any visual meter publishes min, max, current value, and readable
state. Canvas fallback warnings are rendered only after an actual startup
failure, never left in the live accessibility tree.

**How to verify.** Unit tests cover long-press firing and cancellation, queue
mode, menu clamping, command rejection, need-meter values, keyboard target
selection, and save status. [A-16] records the visible desktop and phone-size
passes, bottom-right menu bounds, focus return, and keyboard action workflow.

## [L63] A paused frame is not allowed to become hidden simulation time

**What happened.** The first household-roster pause fix drained commands once
per rendered frame. Two quiet bugs came with it. Refreshing the render buffer
after an empty drain swapped the interpolation samples and snapped a moving sim
to the tick endpoint. Worse, `UseObject` followed by `CancelIntents` produced a
different saved world when the two commands landed in separate rendered frames
instead of one batch. The browser frame rate had become simulation state while
the simulation clock still claimed it had not moved.

**Root cause.** The existing drain was deterministic within one tick-sized
batch, but nobody had required it to be associative across batch boundaries.
The render sync also bundled two unrelated jobs: refreshing activity metadata
and advancing the previous/current position pair.

**Prevention rule.** Any command-only pause path must satisfy both invariants:
splitting or joining an ordered command stream cannot change the saved world,
and a command-only render refresh cannot advance interpolation history. Factor
browser frame coordination into a testable function; do not leave the paused
branch as untested entry-point wiring.

**How to verify.** `split_and_batched_paused_drains_produce_the_same_saved_world`
compares complete save snapshots, the WASM interpolation-pair regression pins
both position samples, and the web frame test requires paused frames to flush
without ticking while running frames tick without a command-only flush.

## [L64] Serializing storage does not serialize the state captured before storage

**What happened.** The OPFS wrapper queued every worker operation, but two
player operations could still overlap outside that queue. An autosave could
capture the current world while Load was reading, then write that discarded
world back after Load applied the older slot. A manual Save could likewise
capture bytes while New game was clearing, then run behind the clear and
resurrect the slot.

**Root cause.** The lock began at `store.save`, after `sim.saveBytes()` had
already chosen which world would be written. It ended when storage returned,
without owning the later `sim.loadBytes()` state swap. The serialized I/O queue
was correct inside its boundary; the boundary was simply too small.

**Prevention rule.** Save, Load, autosave, visibility save, and clear share one
controller-owned operation boundary. Acquire it before capturing or reading
bytes, keep it through the world swap, suppress automatic saves while it is
held, and disable persistence controls until release. Keep the worker queue as
defense in depth, not as proof that player operations cannot race.

**How to verify.** Use deferred storage promises. While Load is pending, cross
a simulated day and prove no save bytes are captured or queued. While clear is
pending, attempt manual Save and prove the only storage operation after the
initial restore remains clear. In both cases, assert all persistence controls
are disabled until the owner operation settles.
## [L65] A validator that models one case of a union rejects the other two silently

**What happened.** `Target` names one of three things - a chain station
(the `CHAIN_STEP` sentinel), an object's interaction, or another SIM for
a conversation - and `follow_path` has dispatched on all three since
M2f. The save validator was written when only the middle case existed
and was never revisited when the other two arrived. The result was not
a crash and not a wrong answer: it was **28.4% of all ticks producing a
snapshot the game refused to load**, discovered only when the alpha
acceptance pass saved at every tick of a 36 000-tick run instead of at
one.

**Root cause.** The union has no type. `Target { object: Entity,
interaction: u32 }` is one struct whose meaning depends on what the
entity IS and on a sentinel value, so nothing in the compiler notices
when a new arm is added at the producer and not at the consumer. Two
more consumers shared the same blind spot: queued `Intent`s, and
habituation keys, both of which address an object by FLYOUT ROW - a
fourth index space, running past the interactions into the chains.

**Prevention rule.** When a field's meaning is decided at run time by a
sentinel or by the kind of the thing it points at, every reader of that
field is a place the union must be re-stated. Adding an arm at the
producer means grepping for every reader before the PR, and a doc
comment on the field naming its arms is the cheapest way to make the
next reader look. Where an index space exists in more than one place -
interactions, flyout rows, the social table - give it ONE named helper
that all callers share, so a widening happens once.

**How to verify.** Save at every tick of a played run, not at one
chosen tick, and assert COVERAGE before asserting success: the new test
fails loudly if nobody happened to walk to a chat during the window,
because a vacuous pass is what let this ship.

## [L66] Measuring a milestone's own numbers is not measuring the game

**What happened.** Every one of the ten shipped alpha criteria was
measured when it landed, in a session written for it: [A-14] measured
the career's money, its time share, and its satisfaction, and concluded
"shipped as measured." It never looked at whether the working sim's
NEEDS survived the job. They did not - she hit zero on six of seven and
lived at or under 5 on hunger for 27.3% of her life, from the day the
career shipped. The trace harness had been printing `<-- floor near
zero: somebody is barely being served` on that run the entire time, and
I read past it three milestones running, because the number I had come
to check was a different number.

**Root cause.** A milestone's measurement is written by the person who
just built the milestone, and it asks the questions that milestone was
about. The career pass asked "does the job cost time?" - the right
question, answered correctly. Nobody asked "is this household still
liveable with a job in it?", because that question does not belong to
any one milestone.

**Prevention rule.** A feature's own session cannot be its only
measurement. When a system lands that competes for a shared resource -
time, an object, a need - the NEXT session re-measures the things that
resource already fed, and a whole-game acceptance pass runs against the
finished set rather than against each part in turn. Warnings a harness
prints unprompted are findings; if one is not worth acting on, the
harness should stop printing it.

**How to verify.** `docs/specs/2026-08-01-alpha-acceptance-findings.md`
is the shape: every criterion re-run on one build, each judged against
evidence gathered now rather than against the milestone that shipped
it.

## [L67] The preview server serves the ORIGINAL project root, not the worktree

**What happened.** Working from a git worktree under
`.claude/worktrees/`, I built this branch's `web/dist`, started the
preview through the Browser pane, and measured the save/load fix in the
page. It failed - reproducibly, at exactly the same tick every run,
with a failure rate matching the PRE-fix measurement. An hour went into
chasing a bug that was not there: the preview was serving the SHARED
working tree's `dist`, on another branch, without the fix.

**Root cause.** `preview_start` resolves its launch configuration
relative to the session's original project root rather than the
worktree's cwd, so `npm --prefix web run preview` ran in the shared
checkout. Every symptom pointed the wrong way - a clean rebuild did not
change the served bundle, restarting the server did not change it, and
clearing OPFS, caches and service workers changed nothing, because none
of those were the mechanism.

**Prevention rule.** In a worktree, confirm WHICH build is being served
before drawing any conclusion from the browser, and confirm it by
identity rather than by having just built:

```bash
curl -s http://localhost:4173/ | grep -o 'assets/index-[^"]*'
```

Compare that filename against `ls web/dist/assets/`. If they differ,
the server is serving somebody else's tree. A bundle hash that does not
move after a real source change is the tell, and it is a stronger
signal than any amount of cache-clearing.

**How to verify.** Run the app's own build from the worktree
(`web/node_modules/.bin/vite preview --port 4173`) so the served
`index-*.js` matches the local `dist`, then re-measure. The
before/after this produced is in [A-19]: 2 013 refused saves of 6 000
on the shared build, 0 of 6 000 on this one.

## [L68] Disabling a clicked submitter can cancel the default action it was about to perform

**What happened.** The persistence operation guard correctly disabled an
already-open Load confirmation as soon as Load began. In visible Chromium, the
world loaded and the status changed to `Saved game loaded`, but the modal stayed
open over it. The button's click handler acquired the lock and disabled the
same button before the browser completed the form's native `method=dialog`
submission.

**Root cause.** Button state and dialog lifecycle were treated as independent.
They are ordered parts of one activation: a click listener runs before the
submitter's default action. Making the submitter disabled inside that listener
can invalidate the default action that would close the dialog.

**Prevention rule.** When a confirmed action synchronously disables its own
submitter, do not depend on a later form default. Prevent that default and close
the dialog explicitly before acquiring or publishing the busy state. Apply the
same ordering to every sibling confirmation that shares the control-state
helper.

**How to verify.** Delay storage-worker message delivery by several seconds,
confirm Load, and inspect immediately. The dialog must already be closed while
the status reads `Loading` and Save, Load, and New game are disabled. After the
delayed response, the status must read `Saved game loaded` and all applicable
controls must recover.

## [L69] A readable overlay is still gameplay if the clock keeps moving behind it

**What happened.** First-run Help opened over a simulation already running at
1x. Reading and capturing the nine instructions advanced several game hours,
changed needs, and sent the selected sim into her work shift before the player
could issue a first order. Manual Help also focused Got it at the bottom of a
scrollable surface, while first-run Help did not move focus into the dialog at
all.

**Root cause.** The overlay was treated as visual UI only. Its hidden flag and
button focus were wired independently from the fixed-step driver, so no owner
held simulated time for the interval in which game input was blocked. The Load
and New game dialogs shared the same lifecycle gap because native modal dialogs
block interaction, not JavaScript animation frames.

**Prevention rule.** Every blocking surface names its complete ownership
interval and suspends the shell driver for that interval. Preserve the speed
the player selected, do not record browser reading time as a replayable pause,
focus the beginning of the surface, support Escape, and restore the opener when
it closes. Confirmed asynchronous work owns the pause until the work settles,
not merely until its confirmation disappears.

**How to verify.** In a visible browser, record the clock, hold each blocking
surface open for longer than one tick, and prove the text does not change.
Verify the initial focus target, Escape behavior, focus return, selected-speed
restoration, and a compact viewport. Unit-test overlapping owners so one modal
cannot resume time while another still owns it.

## [L70] The outer timeout must cover the mutation campaign, not one mutant

**What happened.** A targeted `cargo mutants` run covered three changed Rust
files and expanded to 320 mutants. Each mutant had the intended 60-second
timeout, but the shell wrapper itself had a 15-minute timeout. The wrapper
killed a healthy run after 78 completed mutants, discarding work that Cargo
Mutants cannot resume.

**Root cause.** The per-mutant timeout and the orchestration timeout were
treated as if they bounded the same thing. They do not: one bounds a single
synthetic defect, while the other must cover the baseline build plus every
planned defect. Whole-file targeting made two large `lib.rs` files much wider
than the changed lines suggested.

**Prevention rule.** List or inspect the planned mutant count before a scoped
campaign and size the outer timeout for the complete campaign with margin. For
multiple independent files, use separate output directories and concurrent
processes when the machine can support them. Never describe a partial
`outcomes.json` as a completed gate.

**How to verify.** A completed output directory has a non-null `end_time` in
`outcomes.json`, its completed count matches the planned count in
`mutants.json`, and `missed.txt` plus `timeout.txt` have both been inspected.

## [L71] Null cannot explain why a projection has no view

**What happened.** The mood panel returned `null` both when no person was
selected and when a selected entity produced invalid boundary data. Its render
path therefore overwrote the intentional selection prompt with `Mood
unavailable`, even though those states ask the player to do different things.
The same read also requested the text projection after an empty numeric result
had already proved there was nothing valid to align.

**Root cause.** Absence was modeled as one sentinel instead of a state with a
reason. That made the renderer guess at copy and made the boundary reader keep
working after it already knew the result.

**Prevention rule.** Player-facing projections use a discriminated state for
unselected, unavailable, and ready data. Treat an authoritative empty boundary
result as a short-circuit before allocating dependent projections.

**How to verify.** With no selection, the panel keeps `Select a person to see
their mood.` and performs no projection reads. With an empty numeric result for
a selected entity, it reads no labels and shows `Mood unavailable`. Unit tests
assert both the distinct copy and the boundary call counts.

## [L72] A fresh WASM view is stale after the next allocating boundary call

**What happened.** Keyboard target discovery read fresh zero-copy ID and kind
views, then kept them while asking WASM for person, object, and interaction
labels. A string allocation can grow linear memory and detach both views during
the first row. The loop then silently lost the remaining keyboard targets. Load
also kept the previously armed raw entity index even though restore may reuse
that index for a different live entity.

**Root cause.** The bridge rule said not to cache a view, but the caller treated
"freshly read" as a lifetime guarantee. It is not: a view is valid only until
the next call that may grow memory. Separately, an entity index was treated as
stable across wholesale world replacement even though it identifies storage,
not identity.

**Prevention rule.** Copy aligned primitive projection rows before performing
dependent string calls. Any operation that replaces the world clears transient
UI selections and targets before reconciling restored panels. Stable `SimId`
belongs in state that must survive Load; raw entity indices do not.

**How to verify.** Transfer and detach the original ID and kind buffers during
the first label lookup and prove the complete keyboard target list still
returns. Arm a target, clear it as the successful-Load path does, and prove the
status is hidden and `current()` returns no target.

## [L73] A full-screen failure card is not a modal until the dead page beneath it is inert

**What happened.** Startup failures covered the viewport with a clear recovery
card, but keyboard focus stayed on the page body and every canvas and HUD
control underneath remained in the tab order. A sighted player saw one terminal
surface while assistive technology exposed two interfaces, one of them dead.

**Root cause.** The failure renderer was treated as emergency visual output.
It created styled elements but declared no dialog semantics, moved no focus,
and did not disable the interface that startup had left behind.

**Prevention rule.** A terminal full-screen failure owns the whole document.
Expose it as an `alertdialog` with an accessible name and description, focus
the dialog itself, and make every pre-existing sibling inert before appending
it. Close any open native dialog first: top-layer order beats every z-index and
can otherwise leave the failure surface unfocusable. Render through
`parent.ownerDocument` so the contract remains testable and correct outside the
ambient global document.

**How to verify.** Render into a structural fake document and prove the card is
the active element, its title/detail/hints are referenced by ARIA attributes,
every previous child is inert, and a pre-existing open native dialog is closed.
In a compact visible browser, force startup to fail with a modal already open
and confirm the whole message remains scrollable with no focusable controls
behind it.

## [L-shared-counter-ids] A counter cannot be shared by branches that cannot see each other

**What happened.** Both accreting docs numbered their entries by taking
the next free integer. It collided on 2026-07-29 (two different
`[L41]`s) and the fix recorded at the time was a convention: claim the
number in a tiny commit before writing the entry. That convention held
for three days. On **2026-08-01 the same thing happened three times in
one afternoon** - PRs #26, #28 and #27 each appended what they honestly
believed was `[A-17]`, and the last one through renumbered twice, each
time re-running a ~35-minute CI cycle for a conflict that had nothing to
do with its code.

**Root cause.** "Take the next free number" is an allocation, and an
allocator needs a single point that hands ids out. Parallel branches
have no such point: each reads the same file, sees the same maximum, and
picks the same successor. The convention could not have worked, because
it asked authors to serialise something the tool does not serialise for
them. This is the same shape as any lock-free allocation bug - the read
and the write are not atomic with respect to another writer.

**Prevention rule.** An id that identifies an entry in a document
several branches append to must be **derivable from the entry's own
content** rather than from the document's state. A kebab-case slug of
the subject is: two authors writing about different things cannot
produce the same one, and no lookup or reservation is needed. Keep the
old numbers for ever - here, ~60 files cite them, and a citation that
rots is worse than a mixed scheme.

A second, independent change removes the merge conflict itself:
`merge=union` on the file, so two appends at the end combine instead of
conflicting. The id scheme and the merge strategy fix different halves -
the scheme removes the renumbering and the reference sweep, the strategy
removes the conflict.

**How to verify.** `check-doc-ids.py`, run in the `rust` CI job, fails
on four things, each demonstrated against a deliberately broken copy: a
number past the closed series, an id that merely STARTS with a number
(`[L74-something]` is the same allocation wearing a slug's clothes), the
same id twice, and - as a negative - a fenced EXAMPLE of the format,
which must not be counted as an id at all. The union merge was verified
on a scratch repository rather than assumed: two branches each appending
an entry merge with exit 0, zero conflict markers, and both entries
present.

**The guard needed a guard.** Its first version tested only for a purely
numeric id, so `[L74-something]` walked past it, and it counted the
format example inside this file's own code fence as a real id - which
would have reported a duplicate against the first genuine entry to use
that name. Review caught both. A checker written from the failure you
just had sees that failure and no other; the cheap correction is to ask
what ELSE satisfies the rule you wrote, before the rule is the thing
everyone trusts.
## [L74] A shipped checkbox left open becomes counterfeit backlog

**What happened.** The feature overview correctly described save/load, time
controls, seven-need behavior, and player-facing blocked-state feedback as
shipped in its status prose, while later roadmap bullets and architecture
comments still described the same work as unfinished. A fresh audit therefore
produced contradictory recommendations depending on which paragraph it read.

**Root cause.** Milestone implementation updated the detailed design and the
top-level status summary, but did not search sibling roadmap bullets and source
comments that shared the same completion claim. Historical plans also retained
unchecked execution steps, which made a text search look more like a current
backlog than an archive of how the work was built.

**Prevention rule.** When a feature ships, impact-scan documentation and source
comments for every statement about whether it exists, who reads it, and what is
still deferred. Treat old plan checkboxes as historical evidence unless the
requirements index explicitly names them as live work.

**How to verify.** Search current non-archive documentation for each shipped
feature name. The requirements index, feature overview, architecture, and code
comments must agree on its status and on any deliberately deferred extension.

## [L-render-buffer-live-prefix] A reused render buffer has no meaningful trailing slots

**What happened.** A selection-ring test read the slot immediately after the
live instance count and expected it not to contain an old ring. Adding an
earlier test that legitimately drew a ring made the assertion depend on test
order even though the renderer still uploaded exactly the correct live prefix.

**Root cause.** `buildInstances` deliberately reuses a high-water-mark scratch
buffer. Slots after `instanceCount` are unspecified leftovers, not part of the
frame. The test treated physical array capacity as rendered output and tested a
cleanup behavior the production contract neither promises nor needs.

**Prevention rule.** When a producer returns reusable storage plus a separate
live count, assert only within that count. Do not inspect or clear trailing
capacity unless a consumer can actually read it; needless clearing adds frame
work and merely makes an invalid test look stable.

**How to verify.** Draw a frame with extras, then a smaller frame without them.
Assert the second `instanceCount` and its live prefix. Permit any value beyond
that prefix, and verify the draw call receives the same live count.

## [L-save-presentation-boundary] Tick state and presentation state are different save boundaries

**What happened.** A movement-animation test rendered the pre-save and
post-Load frames with interpolation alpha 1, then the acceptance note described
that as proof that any exact pre-save screen position returns. A real paused
frame can retain an alpha between 0 and 1, while the save format correctly owns
the simulation tick state only.

**Root cause.** The test proved deterministic reconstruction from the saved
tick-end position, but the prose silently widened that contract to include the
renderer-only fractional sample. Load reseeds previous and current position to
the saved tick endpoint; it cannot recreate an interpolation alpha that was
never part of the simulation snapshot.

**Prevention rule.** State save/load evidence at the ownership boundary it
actually exercises. A simulation snapshot may reproduce tick state exactly
without preserving transient presentation state. If exact presentation is a
requirement, name it explicitly and persist or reconstruct every input that
creates it.

**How to verify.** Test the restored walking transform against the saved tick
position and document that boundary. Separately inspect whether the product
requires between-tick interpolation state to survive Save; do not infer that
contract from an alpha-1 fixture.

## [L-current-versus-roadmap-docs] Architecture needs status at the claim

**What happened.** The architecture and stack documents opened by calling the
playable-alpha systems implemented, then described parallel scheduling,
room-graph pathfinding, multi-lot streaming, a toon shader, and a ten-year soak
as if they were current. The source deliberately used a single-threaded
schedule, one-lot A*, a sprite atlas, and no such soak gate.

**Root cause.** Long-range design and shipped implementation shared sections
without local status labels. A true top-level disclaimer was too far from each
specific claim to stop a reader from treating planned machinery as available.

**Prevention rule.** Put `shipped` or `planned` beside an architectural claim
whenever both states live in one document. If the current implementation is a
smaller precursor, name both at the point of comparison. Do not rely on an
introductory status paragraph to govern hundreds of lines of mixed tense.

**How to verify.** Compare the schedule, renderer, pathfinder, art pipeline, and
test-gate sections against their source configuration. A reader should be able
to answer what runs today without consulting git history or inferring tense.

## [L-fingerprint-changes-need-their-own-migration] A better save hash can still delete every old save

**What happened.** Replacing the whole-content Save V1 fingerprint with a
narrow structural digest made future balance and art patches compatible, but
the first draft compared existing saves directly against the new algorithm.
Every public save still carried an old full-pack value, so the release meant to
stop invalidation would have invalidated all of them one more time.

**Root cause.** The design treated the fingerprint as content metadata and
forgot that its algorithm is itself persisted wire behavior. Keeping schema
version 1 does not make a newly computed number comparable with an old one.

**Prevention rule.** Treat any persisted digest-algorithm change as a migration.
Inventory every public value the old algorithm emitted, verify the wire shape,
and map each legacy value only to the exact reviewed new structural shape.
Recognition enters ordinary validation; it never bypasses it.

**How to verify.** Reconstruct historical fingerprints independently, feed a
serialized old value through the public byte loader, assert every reference is
validated, and assert the next save carries the new digest. Change the target
structural digest and prove the legacy bridge closes.

## [L-save-digest-must-follow-post-load-reads] A save digest owns current-content reads after Load too

**What happened.** The repaired Save V1 digest covered every numeric row held
inside the snapshot, but its first audited version still missed two structural
facts read from current content after reconstruction: which objects serve each
chain station role, and where a career sends a worker to leave the lot. Moving
a role or the front door therefore left the digest unchanged while a restored
chain or future shift quietly followed different geometry. The household-name
migration had the same boundary mistake in miniature: it recognized an old
name without first proving the save itself was old.

**Root cause.** The compatibility inventory stopped at fields serialized in
`SaveSnapshotV1`. A restored world is not self-contained; later systems still
consult the current content pack. Those reads are part of the save contract
whenever the snapshot persists the state that will reach them.

**Prevention rule.** Trace restored state forward through every system that can
resume it. Hash any unsaved structural current-content value that gives that
state meaning, or persist a stable authored id in the next schema. Gate a
one-time data migration on the legacy format discriminator, never on a user
value that future editing may deliberately reproduce.

**How to verify.** Move a station role and the front door independently and
prove each moves the digest. Load every known legacy fingerprint and prove the
old household names migrate. Then load the current fingerprint with Tim
deliberately named Terri and prove Load leaves that name alone.

## [L-name-the-state-in-content] Infer behavior from authored identity, not a convenient number

**What happened.** Sleeping was inferred from an interaction whose dominant
positive advert was energy. That happened to identify beds, but it would also
classify a future coffee machine as sleep, slowing need decay and drawing Zzz
over a sim drinking espresso.

**Root cause.** A numeric consequence was used as the activity's identity even
though content already had an authored tag vocabulary for identity.

**Prevention rule.** When multiple systems need to know what an action IS, give
content one explicit semantic tag and share the predicate. Do not reverse-engineer
identity from balance numbers that designers are expected to tune.

**How to verify.** Hold every advert constant and vary only the authored tag.
Scoring, need decay, and activity presentation must agree on the tagged case and
reject the untagged twin.

## [L-check-glyphs-at-the-size-they-ship] Enlarged art can conceal a collapsed icon

**What happened.** The first Zzz activity glyph read correctly when inspected
enlarged but collapsed into an ambiguous mark in its 26-pixel shipping bubble.

**Root cause.** Review measured the source drawing rather than the rasterized
bounds, stroke separation, and silhouette at the actual render scale.

**Prevention rule.** Judge small UI art at one-to-one shipping size before
approving it. Enlarged inspection is useful for defects, but it is not evidence
of legibility.

**How to verify.** Regenerate the atlas, crop the glyph at native size, inspect
its occupied bounds and separated strokes, then view it in the real bubble on
the page at normal zoom.

## [L-generated-image-contract-is-pixels] PNG bytes are packaging, not artwork

**What happened.** The atlas reproducibility gate reported the committed image
as stale under Pillow 12 even though the regenerated and committed 512 by 500
images had no differing pixel. Their SHA-256 hashes differed because the PNG
encoder packaged identical RGBA data differently.

**Root cause.** The gate compared a compressed file format byte for byte when
the generator's contract is the decoded sprite pixels. Encoder and zlib output
are implementation details unless file-byte identity is itself a requirement.

**Prevention rule.** Compare generated raster images by dimensions, mode, and
decoded pixels. Keep exact comparison for textual manifests whose bytes are the
authored contract. Do not regenerate a correct image merely to appease the
currently installed compressor.

**How to verify.** Record that the old and new PNG byte hashes differ, prove an
RGBA pixel diff has no bounding box, and run the generator check successfully.
Then alter one generated pixel and prove the same check fails.

## [L-test-the-visible-speed-control] Click the label the player can actually use

**What happened.** A browser acceptance pass clicked the visually hidden radio
input behind the speed controls. Pause happened to accept that synthetic click,
but 1x did not, which looked like a product defect where the simulation could
never resume. Clicking the visible 1x label resumed immediately and the clock
advanced normally.

**Root cause.** The speed inputs are intentionally transparent and have
`pointer-events: none`; their labels are the 44-pixel player-facing targets.
The first check exercised an automation shortcut that a pointer user cannot
take, then treated its failure as evidence about the visible control.

**Prevention rule.** Browser acceptance must operate the visible label or use
the documented keyboard path for custom-styled radio controls. Do not infer a
player-facing defect from a synthetic click on a hidden, pointer-disabled
input.

**How to verify.** Pause through the visible Pause label, choose the visible 1x
label, and verify both the checked state and clock advancement. Keep the unit
test for option values, but do not mistake it for browser hit-target coverage.

## [L-test-symmetric-presentation-rules-both-ways] One direction does not prove a symmetric rule

**What happened.** Conversation rendering tests covered positive x, positive y,
and only the higher-index side of a coincident pair. Mutation testing showed
that negative y's opposite-facing arm, the lower-index coincidence result, and
the requirement that both conversation participants be agents could all change
without a failing test.

**Root cause.** The fixtures demonstrated representative happy paths, but each
rule had a sibling path hidden by symmetry or by valid production data. The
implementation looked symmetric; the evidence was not.

**Prevention rule.** For directional presentation rules, exercise both signs
and both sides of every deterministic tie. For component joins, include one
well-formed near miss where exactly one required component is absent.

**How to verify.** Run the render-buffer tests with positive and negative y
talkers, coincident pairs in both entity-index orders, and an authored talk
whose positioned partner lacks `Agent`. Then mutation-test `terri-sim/src/lib.rs`
and require the new facing and participant-guard mutations to be caught.

## [L-stagger-before-frame-division] Different first frames do not prove staggered transitions

**What happened.** The first eating-frame calculation added an entity-id parity
after dividing the simulation tick by the frame duration. Adjacent sims could
start on different frames, but every one of them still crossed a frame boundary
on the same tick.

**Root cause.** The test checked only the initial frame difference. It did not
observe the transition ticks, so a phase flip looked like a true time offset.

**Prevention rule.** Apply a stable entity phase to the simulation tick before
dividing by frame duration. When animation staggering matters, test the timing
of transitions as well as the starting pose.

**How to verify.** Use three consecutive entity ids and record their frame
changes across two full cycles. Each id must transition on a distinct tick,
Pause must freeze the result, and reduced motion must still select frame zero.

## [L-exercise-geometry-on-both-axes] A rectangular fixture can still leave one axis untested

**What happened.** Eating faced the centre of a 2 by 1 dining table, and the
directional test proved that the width changed the answer. Mutation testing
still found six surviving arithmetic changes in the centre calculation. The
one-tile depth made every depth offset zero, while several wrong width offsets
continued to point in the expected direction.

**Root cause.** The fixture was non-square, but its assertion observed only the
final facing category. It did not force every operator on both axes to change
that category.

**Prevention rule.** For geometry collapsed into a direction, distance, or
bucket, use non-unit dimensions on both axes and choose boundary-adjacent probe
points. Each load-bearing arithmetic operator must have at least one probe
whose observable result changes when that operator changes.

**How to verify.** Use a 3 by 2 footprint and probe from three positions that
separate the correct centre from width-offset, depth-sign, and depth-scale
mutants. Run a mutation filter over the centre helper and require every viable
mutant to be caught.

## [L-career-tests-follow-events-not-guessed-ticks] Travel time is not shift time

**What happened.** The release-WASM career test proved Tim was off the lot at
tick 600, then assumed he would be home by tick 900. Local idle wandering
changed his deterministic position when the 06:00 shift began, so his walk to
the front door took longer and the assertion found him legitimately still at
work. The career itself remained correct and the 12,000-tick shipped trace
still completed and paid every shift.

**Root cause.** The test silently treated `shift_start + shift_ticks` as the
return time, then added a guessed commute margin. Authored behavior says the
sim walks to the door first and is gone for `shift_ticks` after arrival. The
clock therefore schedules departure, while the path and movement speed decide
clock-in. A deterministic random-sequence change can move that arrival without
changing the career contract at all.

**Prevention rule.** Test event-owned lifecycles by their observable events.
Use an exact tick only when the schedule owns that exact tick. When travel
precedes a fixed-duration phase, prove the intermediate phase, then wait within
an authored outer bound for completion and assert its effects. Do not turn one
seed's path length into an undocumented product promise.

**How to verify.** The release-WASM test still requires Tim to be `AT_WORK` at
tick 600 with no money paid. It then observes the first return before the
1,440-tick day wraps and requires the row to be visible plus Funds to equal one
exact 120-credit paycheck. Removing the return, hiding flag, countdown, or
payout still fails; changing an unrelated earlier random draw does not.

## [L-split-subsumed-path-guards] Do not join a prefilter to the real invariant

**What happened.** The local-wandering mutation sweep replaced
`distance == 0 || distance > radius` with `&&`, and the whole workspace stayed
green. The two predicates cannot both be true, so the mutation removed the
early rejection. The later path validation still rejected both cases: the
empty-path check rejected the origin, and the walked-path cap rejected every
endpoint outside the radius because a four-neighbor path cannot be shorter than
its Manhattan distance. The survivor was behaviorally equivalent, not evidence
that the locality tests had missed a long route.

**Root cause.** One `if` combined two prefilters whose gameplay consequences
were already subsumed by a later, stronger invariant. The expression invited a
Boolean mutant that could delete both prefilters without changing accepted
paths. The origin check also protected the path finder from an empty route,
while the distance check merely avoided unnecessary A* work; writing them as
one gameplay guard overstated what the code owned.

**Prevention rule.** Keep independent early exits separate, and name whether a
guard owns behavior or only avoids work. When a hand mutation survives, prove
whether a later invariant subsumes it before adding a contrived assertion.
Equivalent mutants should be removed by clearer code when possible, not hidden
behind a baseline entry that makes the suite look more precise than it is.

**How to verify.** The two early exits are separate statements, the wall-detour
test still fails when the walked-path cap is removed, and a targeted
`cargo mutants` sweep over `idle.rs` must report no missed or timed-out mutants.

## [L-mobile-fit-is-not-mobile-reflow] Reachable controls can still bury the game

**What happened.** The original phone acceptance proved that every control fit
inside a 390 by 844 viewport. Later roster, relationship, persistence, Queue,
and Help features all joined the same 212-pixel vertical sidebar. Nothing
overflowed horizontally, but the overlay consumed more than half the screen in
both axes and left the house awkward to play.

**Root cause.** The mobile rule narrowed the desktop column without changing
its one-dimensional composition. Acceptance checked presence and viewport
bounds, not the remaining canvas aperture, hit ownership, expanded-panel
behavior, or accumulated height after new features landed.

**Prevention rule.** Treat mobile usability as a geometry budget. Responsive
HUD checks must measure how much uninterrupted canvas remains, prove that the
aperture reaches the stage, keep visible targets at least 44 pixels, and open
the largest dynamic panels before declaring the layout usable. Short landscape
and 200% text sizing are separate budgets; if fixed rows exceed the height, the
HUD needs a reachable scroll boundary rather than visible overflow into the
body's clip. An equal grid with `minmax(0, 1fr)` does not itself preserve a
44-pixel target; fixed control groups need a 44-pixel track minimum and wrapping
when the width cannot hold every item. Re-run those budgets whenever a
persistent HUD section is added.

**How to verify.** At 390 by 844, require a full-width folded canvas band of at
least 400 CSS pixels, no horizontal overflow, reachable bottom controls, and
44-pixel targets. Open Needs and People separately and together, pan through
the remaining aperture, repeat at 320 by 568, 568 by 320, and wide landscape,
double inherited text with Needs open, and prove Help remains reachable by
scrolling. Then hand-mutate each load-bearing layout rule and require the
geometry gate to fail.

## [L-restore-css-mutations-by-context-and-hash] Repeated declarations make blind restoration unsafe

**What happened.** During the mobile mutation audit, a one-line restoration of
`grid-template-columns` matched another identical declaration in the same media
query. The intended game-action rule remained mutated while the HUD column rule
changed instead.

**Root cause.** The restore patch identified a repeated CSS value without its
owning selector. A successful patch application proved only that some matching
line changed, not that the original file had returned.

**Prevention rule.** Scope manual CSS mutations and their restorations with the
owning selector, and record the authored file hash before the first mutation.
Do not continue to final validation until the restored hash matches exactly.

**How to verify.** After every hand-mutation sequence, compare SHA-256 for the
authored file, inspect the scoped diff, rebuild, and rerun the unmutated geometry
gate. A clean-looking browser frame is not byte restoration.

## [L-shadows-belong-to-one-light-before-composition] Occlusion is not a global tile flag

**What happened.** The first [ML-pools] implementation built one union of every
object's `+x` shadow band, then applied that mask while spreading every light.
A lamp west of a tile marked it shadowed, and a television east of the same
tile was dimmed too. The field still looked plausible in single-source tests;
the two-light overlap test exposed the wrong `0.10` where the television's
unshadowed `0.12` should have won.

The first correction materialised one `ShadowCaster` object per render row.
That moved the calculation off the frame-hot path but still violated [D11]'s
stronger rule: zero-copy views do not become permission to rebuild every row as
a JavaScript object during startup and Load.

**Root cause.** Shadow state was represented after composition when it belongs
to one source contribution before composition. The convenient global mask
could not say which side of a caster a light occupied. The convenient caster
array then copied row-shaped bridge data into heap-shaped JavaScript data.

**Prevention rule.** Compute occlusion inside each source's contribution, then
combine completed contributions by the lighting rule, here `max`. Keep bridge
work columnar: rescan fresh typed-array views or use reusable primitive scratch
columns. Do not materialise per-entity objects merely because the calculation
runs less often than a frame.

**How to verify.** Put a lamp west and a weaker light east of the lamp's shadow
tile. The east light's stronger unshadowed value must survive regardless of row
order. Add ordinary multi-tile furniture between a lamp and a probe so deleting
the caster path brightens the probe, and place an agent in the same geometry so
accepting agents as casters darkens it. A static scan of `lighting.ts` must find
no per-row object construction, retained WASM view, second draw, or second
submit.

## [L-semantic-overlays-need-their-own-lighting-contract] World tint is not UI contrast

**What happened.** The first local-light build kept the sage selection ring in
the same ambient and pool lighting as the floor beneath it. At midnight that
ring measured roughly 1.38:1 against the floor. The command target still
existed, but it was no longer reliably visible in the exact scene where the
new lighting mattered most.

**Root cause.** Selection was treated as another world sprite even though it
communicates player state. A colour that identifies selection at noon does not
automatically provide enough luminance contrast after the floor and overlay
take the same night multiply. Local light can narrow that difference again.

**Prevention rule.** Give semantic canvas overlays an explicit lighting and
contrast contract. Keep the identity colour if it helps recognition, but add
an independently legible key when the overlay must survive the full ambient
range. Measure both the darkest floor and the brightest local pool; checking
only one end leaves the other failure available.

**How to verify.** Select a Sim at midnight outside a pool and beside the
strongest source. Sample rendered pixels from the legibility key and the
adjacent floor, and require at least 3:1 in both scenes. Muting the key or
letting it inherit world emissive must make the focused renderer test or the
displayed contrast gate fail.

## [L-media-query-events-need-a-cheap-convergence-path] Preference events can go missing

**What happened.** The lighting control listened for the reduced-motion media
query's `change` event. One embedded-Chromium run delivered it and forced Flat;
a clean focused retry changed `matchMedia(...).matches` but never called the
application listener, leaving `Light: auto` visible under reduced motion. A
separate diagnostic listener received the browser event, which made the
failure intermittent and particularly unpleasant to reason about.

**Root cause.** Presentation state converged only through one browser event.
The frame already read the same media-query value for animation, but the light
controller trusted event delivery as if it were simulation data. In an embed
or emulation path, that trust was stronger than the platform evidence.

**Prevention rule.** Keep the normal event listener for immediate response,
but give accessibility preferences a cheap idempotent convergence path when
their current value is already read regularly. Cache the last reflected value;
steady frames do one comparison and never rewrite the DOM or static buffer.

**How to verify.** Delete the frame-loop synchronization while leaving the
event listener intact, change emulated reduced motion after startup, and watch
the button remain Auto in the affected embed. Restore the cached check and
require reduce to produce disabled `Light: flat` with `aria-pressed=true`, then
require no-preference to restore enabled `Light: auto` without reload.

## [L-live-region-feedback-needs-a-recovery-transition] Repeating an error requires an empty state between announcements

**What happened.** Displayed acceptance found that the queue-full error stayed
visible after a later accepted replacement. Review then found the second half:
assigning the same queue-full text after another rejection might not announce
anything because the live region never changed. Persistence and command
feedback also wrote the same status element, so a day-boundary autosave could
replace a same-frame rejection.

**Root cause.** The first implementation modeled the simulation's rejection
correctly but treated its DOM text as a permanent flag. It had no player-action
transition that retired the old announcement, and it gave unrelated
asynchronous owners one shared output surface.

**Prevention rule.** A transient live-region error needs four named parts: the
authoritative failure event, the player event that clears it, a real empty DOM
state before an identical repeat, and one status owner per asynchronous
domain. When frame order matters, put it behind a small tested orchestration
seam instead of relying on line placement in an entry point.

**How to verify.** Drive rejection, accepted replacement, and the same later
rejection through the real command routes. Require the live-region text to
transition from the exact error to empty and back to the exact error. At a day
boundary, require the frame seam to run command drain, persistence update, then
feedback consumption, with autosave visible only in the persistence region.

## [L-shared-component-is-not-an-activity-name] Storage names are not player semantics

**What happened.** The shared `Eating` component carries every ordinary object
interaction. Render sync treated that implementation name as the fallback
activity, so using a toilet, shower, television, sink, bookshelf, or reading
chair could say `Eating` and draw a fork bubble.

**Root cause.** The classifier named the storage mechanism instead of the
authored action. Exact visual metadata already distinguished eating, and the
sleep tag already distinguished sleeping, but the remaining branch collapsed
unrelated uses into `EATING`.

**Prevention rule.** Derive player-facing activity from validated authored
identity. When a shared component has several semantic owners, give the
unclassified remainder a distinct append-only code. Never let an entity
component's historical name become UI text or art selection by default.

**How to verify.** Hold the component and exact-target shape steady while
varying only authored interaction metadata across snack, shower, bed, and
terminal dinner fixtures. Hand-change the generic fallback to `EATING` and
require the ordinary-use matrix to fail. Remove the code 3 fork mapping and
require the frame test to fail. Restore both mutations and require the focused
Rust and Web suites to pass.

## [L-a-sha-query-label-is-not-an-immutable-deployment] A query label does not pin mutable Pages content

**What happened.** Post-merge notes called a GitHub Pages URL with
`?rev=<merge-sha>` revision-pinned. The application does not read `rev`, and
Pages publishes one mutable site. After PR 47 deployed, the old PR 46-labelled
URL returned the same current document metadata as the PR 47-labelled URL.

**Root cause.** The SHA query was useful as a cache-busting and observation
label, then its human meaning was mistaken for a server-side routing guarantee.
Nothing in the application, workflow, or host retained an immutable build at
that URL.

**Prevention rule.** Call these URLs SHA-labelled public sessions and record
that they were opened immediately after the named deployment. Cite the Actions
run as proof that an exact SHA built and deployed. Use `revision-pinned` only
when the host actually routes to immutable content and that behavior has been
verified.

**How to verify.** Inspect which query parameters the application reads, then
request old and current SHA-labelled URLs after a later deployment. If their
content hash, ETag, or `Last-Modified` value is identical, the query is only a
label. The immutable evidence is the successful workflow run tied to the exact
head SHA, not the mutable Pages response.

## [L-transform-motion-is-not-a-character-animation] Moving a sprite is not the same as animating its body

**What happened.** The walking slice was described as a walking animation even
though it only lifted the unchanged character sprite during travel. The seated
reading pose was also called acceptable after mechanical and atlas inspection,
but the owner saw the deployed result and rejected its distorted neck and head
silhouette. Eating technically moved the hand, yet had no visible food in it,
and every action pose changed too quickly to read comfortably at 1x speed.

**Root cause.** Implementation categories such as `visual_action`, distinct
sprite indices, and deterministic phase changes were allowed to stand in for
the player's visual meaning. The checks proved that pixels changed on schedule;
they did not prove that legs and arms formed a believable walk, that a held
prop explained the eating gesture, or that a seated silhouette looked human.

**Prevention rule.** Name each motion precisely. A transform-only body lift is
a footfall effect, not a walk cycle. A walk cycle requires visibly different
limb silhouettes in the character frames. Action art must show the object that
explains the gesture, preserve believable anatomy, and remain on screen long
enough to read at 1x. Owner visual review may reject code-complete art, and that
rejection reopens acceptance rather than becoming a documentation footnote.

**How to verify.** Inspect the deployed action at 1x through the normal player
route. Require walking legs and arms to change shape, food to remain visible in
the eater's hand, and seated reading to retain a normal neck and head silhouette
at ordinary zoom. Watch at least two full pose holds for each action, then repeat
at 2x and 3x. Record any visual rejection explicitly and do not call that art
accepted or shipped until the replacement passes the same played check.

## [L-protect-the-complement-of-an-art-exception] An allowed redraw needs a guard around everything else

**What happened.** The animation-repair contract allowed seated-reading pixels
98 through 121 to change while requiring every other legacy sprite through 146
to remain fixed. The first generator checks pinned names, dimensions, Chat, and
the dinner prop, but did not causally protect all remaining decoded pixels. A
review confirmed that the generated atlas was currently correct, yet a future
floor, wall, object, or character-pixel regression could still pass the stated
gate.

**Root cause.** The test guarded memorable examples rather than the complete
complement of the exception. The written invariant covered 123 protected
sprites; the implementation checked only a few highlighted subsets.

**Prevention rule.** When an append-only atlas permits one in-place redraw,
hash the names, dimensions, and decoded pixels of every legacy sprite outside
the allowed range. Keep focused semantic checks too, but do not mistake them
for full prefix protection.

**How to verify.** Change one decoded pixel in any protected legacy crop and
run the generator check. It must fail on the protected-record digest. Restore
the pixel and confirm the atlas reproduces exactly; only the explicitly allowed
range may differ from its recorded predecessor.

## [L-implementation-docs-do-not-create-owner-requirements] An implementation note is not owner authority

**What happened.** A responsive-layout spec described the CSS-only mobile dock
as a contract. When the owner asked for collapsed small-screen controls, that
sentence was treated as a conflicting requirement and used to stop for
confirmation. The same claim was repeated after the owner explicitly said it
had never been their requirement.

**Root cause.** A document that recorded what the code did was granted authority
over why the product should do it. No owner decision, acceptance note, or
source instruction supported that elevation. The rendered phone evidence also
showed that the documented choice had failed its actual purpose.

**Prevention rule.** Repository specs describe implementation and accepted
behavior unless they cite an owner decision explicitly. They do not invent
owner intent. When a direct owner instruction conflicts with an uncited design
choice, follow the instruction, inspect the current behavior, and update the
document. Do not make the owner disprove provenance the document never had.

**How to verify.** Trace any claimed owner requirement to the message, issue,
or acceptance record where the owner stated it. If no such source exists,
classify the text as a project decision rather than owner authority. Confirm
that the replacement behavior is documented, causally tested, and played at
the viewport where the old choice failed.
## [L-a-save-digest-exception-does-not-migrate-the-world] Accepting a fingerprint does not rebuild an old snapshot

**What happened.** The aquarium mock wanted a wider cabinet, and the exercise
bike looked like an obvious new object. Both changes also needed public Save V1
households to keep loading. A compatibility-fingerprint bridge initially
looked like the migration mechanism, but old snapshots restore their own entity
list and blocked-tile grid. A new bike would be absent from every old household,
and a widened aquarium would still carry the old one-tile collision map.

**Root cause.** A digest gate answers whether current code may interpret a
snapshot. It does not rewrite the snapshot. Object existence, identity,
position, footprint collision, and active references remain whatever the save
serialized unless an explicit migration changes them.

**Prevention rule.** Before accepting a changed content digest, inventory every
structural fact the save owns. Either keep those facts identical, as this slice
does by repurposing two inert persistence slots, or write a versioned migration
that reconstructs and validates entities, collision, paths, and references. Do
not call a relaxed fingerprint check a world migration.

**How to verify.** Load a fixture carrying the prior structural digest and
compare entity indices, persistence IDs, positions, and every blocked-grid bit
before issuing either new action. Confirm the bridge does not run unrelated
legacy household renaming. Save again and require the current digest while the
same entity and collision identities remain intact. Remove or alter one
reviewed interaction and require the digest bridge to close.

## [L-an-old-fingerprint-does-not-own-new-content-rows] Preserve source-shape rules through save validation

**What happened.** The aquarium and exercise bike reused two formerly inert
object IDs. Their old fingerprints were accepted against the new pack, then
saved interaction references were checked only against that new pack. A
corrupt pre-feature snapshot could therefore claim row zero on an object that
had no rows when the snapshot format was produced, and Load would reinterpret
it as a new action.

**Root cause.** Fingerprint provenance was reduced to a yes-or-no compatibility
answer before row validation. The validator knew the destination pack but had
discarded the source shape, so it could not distinguish a current row from a
historically impossible one.

**Prevention rule.** When compatibility accepts more than one structural
shape, retain a source-shape classification through every validation path.
Reject references that the accepted source could not have authored before
reconstructing any state. Do not let destination bounds manufacture history.

**How to verify.** For each of the five accepted pre-feature fingerprints and
both repurposed objects, forge row zero independently in `Target`, `Eating`,
`Intent`, queued `UseObject`, `Habituation`, and Personality dispositions.
All 60 loads must return `InvalidContentReference` and leave a running
simulation byte-for-byte unchanged. A valid prior-structural snapshot must
still cross the public WASM byte loader, retain its names, and resave with the
current digest.

## [L-generated-public-assets-need-content-addressed-urls] Bind generated manifests to cached public files

**What happened.** Vite gave the JavaScript bundle a content hash, but the
generated sprite texture remained a stable `atlas.png` URL. GitHub Pages caches
that public file for ten minutes. A returning browser could therefore load the
new manifest beside the previous PNG and abort because their dimensions did
not match.

**Root cause.** Reproducible generation proved the committed PNG and manifest
agreed at build time. It did not bind the two independent HTTP cache entries at
runtime.

**Prevention rule.** Content-address every generated public asset consumed by
hashed code. On a host whose CDN ignores query strings in its cache key, the
digest must be in the pathname rather than only in a query. Alternatively, let
the bundler own and hash the asset. A human query label on the page URL does not
revise subresource requests.

**How to verify.** Hash the committed PNG bytes in the Web test, require the
generated filename and duplicate runtime file to match, and require the
renderer URL to use that exact path. Request two cold, never-before-used query
variants from the deployed stable path; if the CDN reports cache hits, queries
are not a release boundary. Mutate either the filename digest or path
construction and require the focused test to fail.

## [L-rgba-animation-guards-must-read-rgba] Alpha-only image checks miss color motion

**What happened.** The aquarium validator used Pillow's default RGBA
`getbbox()`, which considers alpha only. The tank is opaque across both frames,
so an RGB-only change to water, glass, lid, or cabinet pixels could evade the
motion boundary. The additional cabinet crop still left most of the tank
outside a causal guard.

**Root cause.** A convenient image-difference helper had channel semantics that
did not match the art contract. The check described fish-only motion while
measuring transparency changes and one broad vertical boundary.

**Prevention rule.** Inspect all four channels when color stability matters,
and define the allowed motion as reviewed pixel regions. Reject every changed
pixel outside those regions rather than inferring safety from one bounding
coordinate.

**How to verify.** Change one RGB value outside the three fish-motion regions
without touching alpha and run the generator check. It must fail with the
escaped pixel coordinate. Restore the mutation and require exact regeneration.

## [L-restored-countdowns-must-enter-a-valid-update-state] Validate before decrementing

**What happened.** Save validation accepted `AtWork { remaining_ticks: 0 }`.
The career system decrements before checking for completion, so the next debug
tick panicked and a release build wrapped to `u32::MAX`, leaving the Sim at
work for years of game time.

**Root cause.** Serialization preserved the integer type but not the live
component's positive-domain invariant. The update loop assumed every restored
component came from the constructor that enforces that invariant.

**Prevention rule.** Validate saved countdowns against the domain required by
their first update operation. A decrement-before-check counter must restore as
strictly positive, or the system must use saturating subtraction and define
zero as a legal completion state.

**How to verify.** Require one remaining work tick to load and zero to fail
with `InvalidValue`. Remove the validation and require the focused boundary
test to fail before exercising the dangerous update.

## [L-visual-acceptance-must-follow-shared-generator-changes] Art evidence expires when shared drawing code changes

**What happened.** The selected aquarium and exercise-bike mockups looked
convincing, but the deployed procedural sprites did not preserve their readable
silhouettes. The aquarium became a white display cube under a brown roof and the
bike collapsed into a small dark knot. A later shared character rewrite then
changed the previously reviewed exercise body into a standing Sim that bobbed
in front of the machine. Dimensions, sprite indices, animation timing, and the
older atlas complement guard all continued to pass.

**Root cause.** Acceptance focused on ingredient lists and isolated technical
contracts. The durable pixel guard protected the complement of the intentional
art exceptions, but nothing pinned the reviewed exception pixels themselves.
The played captures were also treated as permanent evidence even after shared
generator code changed the current atlas bytes.

**Prevention rule.** Compare the selected reference and the current runtime at
the same scale and state. Pin the exact decoded pixels of every corrective art
candidate, including action bodies that depend on shared character code. Do not
call those pixels owner-approved until the owner accepts them. Any later change
to a shared generator invalidates prior played art evidence until the affected
object and body composites are replayed.

**How to verify.** Inspect current native crops, object-and-rider composites,
and played 1x actions beside the selected references. Require a deliberate
pixel mutation in the aquarium, bike, or exercise body to fail the reviewed
subset digest. Require a whole-body exercise translation to fail the planted
upper-body invariant, and require a frozen pedal leg to fail the lower-body
motion check. Restore the source byte-identically and regenerate the exact
content-addressed atlas.

## [L-atlas-height-can-invalidate-a-camera-fit-contract] A fixed viewport cannot fit an extent taller than itself

**What happened.** The Clear Line atlas pass increased the tallest sprite from
132 to 136 pixels. The camera's conservative 16 by 12 lot extent therefore grew
from 720 to 724 pixels, but the desktop regression test still required both its
top and bottom to fit inside a 720-pixel canvas. CI correctly reported the
resulting negative two-pixel top bound. No camera origin can satisfy both old
assertions because the modeled extent is four pixels taller than the viewport.

**Root cause.** The generated atlas and sprite-specific checks were updated
without re-evaluating the viewport arithmetic that consumes the maximum sprite
height. The test encoded an outcome that had become mathematically impossible
instead of the camera's actual rule: center the complete conservative extent.

**Prevention rule.** Treat maximum sprite width and height as renderer inputs,
not merely atlas metadata. Whenever either maximum changes, run the full Web
suite and recalculate every fixed-viewport budget. If a fixed scale no longer
fits, make an explicit product decision between automatic scaling and centered
overflow; do not disguise the conflict by moving one clipped edge off the
assertion.

**How to verify.** At 136 pixels, the 16 by 12 conservative span is exactly 724
pixels. `cameraOrigin` must place it at -2 through 722 in a 720-pixel canvas,
sharing the unavoidable overflow equally. A future shorter extent may fit, but
overflow beyond four pixels must fail for deliberate review. The obsolete
tile-only centering formula must remain observably off-center.

## [L-pages-must-follow-green-ci] A successful static build is not a releasable revision

**What happened.** GitHub Pages deployed `f38c64a` while the CI run for the
same revision failed the desktop camera-extent test. The site remained
playable, but the public release boundary claimed a revision the test boundary
had rejected.

**Root cause.** The Pages workflow and CI both triggered independently on a
push to `main`. Pages only built the static bundle, so it had no dependency on
the CI conclusion and could finish first or succeed while CI failed.

**Prevention rule.** Production Pages builds must be triggered by completion
of the `CI` workflow on `main`, must run only when that CI conclusion is
successful and its event was a push, and must check out the triggering run's
exact `head_sha`. Immediately before deployment, compare that SHA with the live
`main` ref and skip it when an overlapping or re-run CI job has made the
artifact stale. Do not substitute the newest default-branch revision.

**How to verify.** Push a branch through a pull request and require CI to pass
before merge. After merge, confirm the Pages run names that merge SHA as its
triggering workflow revision and that the deployed HTML loads that revision's
content-addressed assets. In a controlled test branch, force CI to fail and
confirm the downstream Pages build job is skipped.

## [L-seated-state-needs-a-seated-silhouette] A socket position cannot make straight legs read as sitting

**What happened.** The first armchair candidate used the right seat socket,
lowered torso, `Sitting` HUD label, and deterministic activity code, but the
played composite still looked like a standing Sim placed in front of a chair.
The legs remained nearly vertical, so the most important anatomical cue
contradicted every technical signal.

**Root cause.** The implementation treated lower hip coordinates and floor
contact as sufficient evidence of a seated pose. Those invariants protected
placement but did not require a visible hip-to-knee-to-foot angle in the final
person-and-furniture composite.

**Prevention rule.** Review body art composited with its real furniture before
accepting an object action. A seated pose must expose an intentional knee angle,
credible cushion contact, and planted shoes without hiding the object. Reject
the slice even when sockets, labels, indices, and tests are correct if the
silhouette tells a different story.

**How to verify.** Run the real action at normal and close zoom, pause both
animation phases, and compare the runtime composite with the pose reference.
The hips must meet the cushion, the knee must visibly break the straight leg
line, the feet must stay near the base, and the chair arms must remain readable.

## [L-audio-follows-fixed-ticks-and-world-boundaries] Audio phase belongs to simulation travel, not rendered frames

**What happened.** The first audio wiring nearly sampled footsteps once per
rendered frame, resolved stable identity through one Rust call per agent on
every tick, stopped all voices when Pause was selected, and reset walking phase
only when a tab became hidden. Each choice looked reasonable alone. Together
they would undercount 2x and 3x travel, become quadratic at town scale, cut off
the Pause confirmation cue, and let hidden ticks contribute to the first sound
after tab return.

**Root cause.** Playback lifecycle, world lifecycle, and simulation phase were
treated as one concern. They are three. UI audio remains usable while the world
is paused. World replacement changes render rows. Walking phase advances
only with fixed ticks and travelled distance. Browser visibility is an
asynchronous hardware boundary whose stale promises can settle out of order.

**Prevention rule.** Sample movement after every fixed tick and never from a
render frame or paused command flush. Carry stable `SimId` in an aligned render
column, read it with the other row data, and key stride state by that value. Keep
UI and world boundaries distinct.
Gate hidden audio synchronously, serialize context state changes, and clear
stride history on both visibility edges. Keep trusted-gesture recovery armed
after the first successful activation.

**How to verify.** Split identical travel across 1x, 2x, and 3x tick batches and
require identical step indices. Require no `simIdOf` call during steady ticks.
Hide, sample several moving positions, show, and require the first visible
sample to anchor without sound. Reject an automatic foreground resume, then
require a later trusted gesture to recover. Deliberately remove each guard and
require its focused test to fail before restoring the original bytes.

## [L-performance-features-need-a-disabled-baseline] Attribute a regression before blaming the new feature

**What happened.** The first 1,037-entity footstep-sampling browser run exceeded
the 16.6 ms application-work target. The paired run with footstep sampling
disabled missed by the same amount. Profiling the full fixed tick found the
actual cost: 1,000 idle agents scored 34 objects with one A* search per pair,
about 34,000 route searches on a selection tick. Release-WASM fixed-tick p95 was
24.5844 ms. The audio sampler was cheap throughout.

**Root cause.** One absolute performance number answers whether the whole game
meets its frame budget. It does not answer which subsystem caused a miss. A
feature can satisfy its bounded regression budget while an older renderer or
simulation bottleneck fails the application-wide gate. The stale stress comment
still described a one-object lot, so the workload had changed while its cost
model had not.

**Prevention rule.** Keep both gates. Run the identical production scenario
with the feature enabled and explicitly disabled, then report the delta and
both absolute results. When both modes fail similarly, profile the complete
frame and fixed-tick phases before changing the feature under review. Stress
comments and fixtures must name the current object count and the cost it causes.

**How to verify.** Pin entity count, viewport, speed, warm-up, and measurement
window. Require the feature-specific sampler budget and enabled-versus-disabled
delta independently. Also require each whole-frame run to meet the absolute
target. Vary placed-object count across 0, 1, 10, and 34 or profile the selection
phase directly; a cost that scales with agent-object pairs names the subsystem.

The corrective implementation builds one breadth-first distance field per
occupied source tile, scores every object and person from that field, and runs
the existing adjacent A* only for the chosen winner. Exhaustive small-grid tests
require every field distance to match the old A* length. A focused mutation test
requires eight agents on one source tile to build one field and one winning
path, not eight fields or nine paths. After the repair, release-WASM fixed-tick
p95 is 1.3716 ms and the visible production run sustains about 120 animation
frames per second with application-work p95 1.615 ms enabled and 1.640 ms
disabled.

## [L-aligned-row-metadata-beats-repeated-sparse-queries] Recurring row metadata belongs in the row

**What happened.** The first footstep design rebuilt stable identity at startup
and Load by calling `simIdOf` for each render row. Moving those calls into every
fixed tick would have crossed WASM once per row and scanned the Rust ECS query
once per call. At town scale that shape becomes quadratic. Keeping a separate
lookup also made live topology changes a second alignment problem.

**Root cause.** Stable Sim identity was treated as sparse metadata because only
Sims use it. The render buffer is already the authoritative aligned row set;
reconstructing one parallel relationship outside it adds boundary calls and a
new synchronization obligation.

**Prevention rule.** Metadata consumed with every render row travels as an
aligned primitive column. Use an explicit sentinel for rows where it does not
apply. Re-create the zero-copy view after every potentially growing WASM
boundary under [D11]. Reserve sparse lookup calls for infrequent queries rather
than recurring row traversal.

**How to verify.** Render household and object rows together. Require the Sim
rows to expose their authored `SimId`, non-Sim rows to expose `u32::MAX`, and the
WASM pointer to address that exact column rather than entity IDs. Mutate the row
fill to the sentinel, mutate the pointer to entity IDs, use row number in the
footstep sampler, and use entity IDs in the roster; each focused test must fail.
Instrument `simIdOf` during a 600-tick production stress run and require zero
steady-tick calls.

## [L-audio-node-failures-need-transactional-cleanup] Sound failure must remain presentation failure

**What happened.** The first audio implementation caught context creation and
resume failures but allowed a later oscillator or parameter exception to escape
the cue player. A failure after registering a voice could retain dead nodes, and
an exception during fixed-tick sampling could leave the footstep frame open.

**Root cause.** Web Audio node construction was treated as one operation. It is
a sequence of fallible browser calls: allocate, schedule, connect, register,
start, and stop. Catching only the first and last boundary leaves half-built
graphs between them.

**Prevention rule.** Construct every cue transactionally. Track which nodes and
voices exist, disconnect the exact partial state on any failure, close abandoned
contexts, contain final cue errors at the controller, and close sampler frames
in `finally`. Sound may be dropped; the simulation frame may not be dropped.

**How to verify.** Inject failures on the second controller gain, during cue
parameter scheduling, and after a voice is registered but before its stop is
scheduled. Require the context to close, every created node to disconnect, zero
voices to remain, and the sampler end hook to run. Delete each cleanup branch,
paste the actual failing assertion, restore it, and verify exact source hashes.

## [L-paired-facing-sprites-need-the-same-facing-matrix] Parallel sprite fields need parallel facing evidence

**What happened.** The foreground sprite resolver copied the primary sprite's
unsuffixed SE convention and directional suffix rules, but its tests covered
only a placement with no authored facing. Three guard mutations survived: the
SE branch could run always, never run, or invert its comparison. The primary
sprite tests stayed green because they never observed the foreground field.

**Root cause.** Two fields implemented the same presentation rule through
separate branches, while only one field received the complete facing matrix.
Code similarity was mistaken for shared evidence.

**Prevention rule.** When parallel presentation fields resolve from the same
facing, test every supported facing against both fields in the same fixture.
Include the absent-facing fallback and any exceptional naming convention such
as the unsuffixed SE sprite.

**How to verify.** Compile one foreground-bearing placement with no facing and
with SE, SW, NW, and NE. Require the primary and foreground atlas indices to
match their respective variants. Replace the foreground SE guard with true,
false, and `facing != "SE"`; each mutation must fail this test.

## [L-browser-automation-cannot-claim-a-hidden-tab-from-target-placement] A new target is not proof of a hidden document

**What happened.** The audio listening harness needed to prove that hiding the
game suspends its Web Audio context and prevents new voices. Default Playwright
Chrome disables background throttling, so the harness launched ordinary Chrome
and attached over the Chrome DevTools Protocol instead. Four automation routes
created another page: Playwright page creation, raw target creation, a trusted
renderer link, and the exact owned Chrome window's New tab button through
Windows UI Automation. Some routes even proved equal Chrome window IDs and a
selected new tab. Chrome 151 still reported the game document as `visible`.

**Root cause.** Browser target creation, window placement, accessibility
selection, document visibility, and Web Audio lifecycle are separate facts.
Automation can successfully perform the first three without producing the last
two. Counting a created or selected target as a hidden-tab pass would test the
harness's optimism instead of the application.

**Prevention rule.** Hidden-tab acceptance requires direct evidence from every
relevant layer: an ordinary Chrome launch without background-disabling flags,
the same native browser window, `document.visibilityState === "hidden"`, a
suspended game `AudioContext`, and zero new oscillator nodes while semantic
events are attempted. After repeated automated placement failures, stop changing
tab mechanisms. Require one explicit owner tab switch and let the harness verify
the resulting state. Never convert an automation limitation into an application
pass or failure.

**How to verify.** Run `scripts/audio-listening.ps1 -MechanicalOnly`. It must
select a non-sentinel stable Sim ID, stage a real walk, record settings
persistence and `hidden-tab: owner-required`, then exit nonzero. Run the owner
workflow, open exactly one same-window tab when prompted, and require equal CDP
window IDs, hidden document state, suspended context state, zero oscillator
growth across 20 hidden events, visible state on return, and a human judgment
that no hidden or catch-up sound occurred.

## [L-listening-fixtures-must-prove-the-audible-identity] An agent row is not necessarily an audible Sim

**What happened.** The first owner-listening setup selected the first render row
whose kind was agent. Under the stress fixture, that row could be a synthetic
agent with the `u32::MAX` no-Sim sentinel. The walk command could therefore be
staged for a row that the stable-identity footstep sampler must deliberately
ignore, producing a silent listening test that looked like an audio failure.

**Root cause.** The fixture selected by broad render kind instead of the exact
identity contract used by the feature. A visually valid agent row is not enough
for audio; footsteps require an authored, stable Sim ID.

**Prevention rule.** A listening fixture must select a row that satisfies every
identity predicate required by the audible path. For footsteps, require agent
kind and a non-sentinel aligned Sim ID. Fail setup immediately if no such row
exists or if the real walk command is not admitted to the command queue. Never
ask a human to diagnose sound from an unproven game state.

**How to verify.** Run the mechanical listening workflow under the stress
fixture. Its report must name the chosen stable Sim ID and record that the real
walk command was staged before any owner prompt appears. Mutate selection back
to the first agent row; the fixture must fail when a sentinel stress row sorts
first instead of continuing into a misleading silent listening session.
