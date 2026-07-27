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
