# Testing Protocol

Standing rules for this project, derived from five separate tests that were
permanently green while protecting nothing. See [L3], [L5], [L6], and [L7] in
`lessons-learned.md` for the individual cases.

**The governing principle:**

> You cannot determine whether a test tests something by reading it. Only by
> breaking the thing and watching the test fail.

This matters because the failure family does not look like itself. Each of the
five instances presented, in the moment, as a different problem: a null query
result, a same-process comparison, a guard reading the wrong term. Written down
together they are obviously one bug. Encountered one at a time, they are not.
**A rule you have to recognise the need for is not a defence against a bug
whose defining property is being unrecognisable.** That is why the defences
below are mechanical rather than advisory.

## 1. Mutation testing is mandatory for load-bearing invariants

For any test guarding determinism, ordering, an architectural rule, or a guard
itself:

1. Delete the mechanism.
2. Confirm the test fails, and paste the actual failure output.
3. Restore it.
4. Confirm the tree is byte-identical.

Report all four. A test claiming to pin a mechanism it cannot detect is **worse
than no test**, because it also removes the suspicion that would otherwise
prompt someone to check.

## 2. `cargo mutants` runs in CI

Automated backstop for everything rule 1 depends on a human to notice. A
surviving mutant is, by definition, behaviour that nothing constrains.

- Gate on **no new** surviving mutants, not zero survivors. A wall of known
  noise gets ignored, which is the failure mode this whole document is about.
- Baseline lives in `mutants.out/` conventions or an explicit skip list; keep
  deliberate exclusions annotated with why.
- It mutates **production** code, so it finds untested production behaviour. A
  test vacuous in a way not tied to a production mutation can still slip
  through. It is a backstop, not a replacement for rule 1.
- **Every real tool timeout fails policy.** A timeout is a recorded build or
  test phase failure; it does not prove an infinite loop. A controller stop at
  the job budget is unfinished work and cannot become a timeout or a caught
  mutant. Preserve the last validated report before signaling the owned process.
  The baseline and each mutant use the same complete `cargo test --workspace
  --locked` command. Planning freezes the test cap at the larger of 120 seconds
  and four times that measured baseline, with a 600-second build cap. A failed
  baseline supplies no mutation coverage. Exact planned/completed identity
  equality replaces the former positive-count check. A resumed slot with no
  pending identities may pass from authenticated evidence; a partially tested
  manifest may not. See [campaign operations](mutation-campaign.md).
  Production loops still need bounds whose violation fails an assertion. [L50]
  records why a hung test can conceal assertions that already failed. Distinguish
  a real loop defect from a test workload whose legitimate runtime exceeds its
  calibrated cap before deciding which code to repair.
- **It does not emit statement-deletion mutants.** It rewrites expressions and
  return values, so a whole statement whose only effect is on state - `swap`,
  `clear`, `sort`, `push`, `insert` - is outside its grammar. A clean report
  over such a line is true and is simultaneously no evidence. Delete those by
  hand. See [L11], where deleting one `std::mem::swap` left all 31 tests green
  under a "0 survivors" report.
- **A documentation-only change skips game checks.** The `changes` job in
  `ci.yml` runs the fast classifier tests, then decides whether the game could
  be affected. The independent `ci-guards` job runs every CI script and
  workflow contract test on every change. Mutation tooling and planning require
  successful complete guards. After classification, Rust, web and artwork
  checks run independently with the same code-change and fixture conditions.
  Documentation means files ending `.md` in any letter case, outside `.agents/`
  and `.claude/`, because a web test reads the skill files there. Published
  articles, metadata and images under `docs/player/` also skip game checks,
  except `quick-help.md`, `reviewed-sources.json` and `generated/`, which require
  them. Everything else counts as code, including `docs/mutants-baseline.txt`,
  which the mutation gate reads. A pull request is compared from where it
  branched; a push to main is compared with
  the newest main push whose `web` job passed, so a documentation push cannot
  skip code whose own run was cancelled or failed. When only documentation
  changed, the Rust, web, artwork and mutation jobs skip and the `docs` job checks
  document ids. Changes under `docs/player/` or `docs/changelog/` also run the
  lightweight `changelog` job and redeploy Pages; other documentation does not
  redeploy. The classifier's `site` output includes game changes and both public
  documentation paths, so the Pages stale-artifact check rejects an older artifact
  when newer guide content or notes have reached main.
  Pages can still publish a tested revision whose only difference from main's
  tip is unpublished documentation. See `docs/changelog.md`.
  Anything the script cannot decide runs everything. Local gates are
  unchanged: a change that touches code still runs every step before it is
  pushed.
- **Mutation jobs share eight runner slots across this repository.** Each
  shard uses `ci-mutation-shard-${{ matrix.shard }}` as its job concurrency
  group, without a PR number or run id. `queue: max` retains up to 100 pending
  jobs per group; GitHub cancels additional jobs when that queue is full.
  A cancelled sweep is not a passed sweep. The outer workflow still cancels
  obsolete heads of the same PR. Its groups also separate events so a manual
  sweep on main cannot block push CI while it waits for mutation slots.
  Rust, web, artwork, CI guards and Pages jobs do not use these groups. Tool
  builds, calibration and mutation execution share the eight slots; lightweight aggregation uses
  a separate job after its workers finish. This budget does not guarantee available account-wide
  runners. Previously dispatched workflows retain their old configuration.
  See [GitHub's concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

  Every mutation stage uses the same committed container image and tool-inventory
  pin. The image supplies the compiler, libraries and command-line tools;
  hosting-machine metadata remains separate provenance. The owner-dispatched
  runtime publisher shares slot zero and receives package-write permission only
  for that operation. Mutation consumers remain read-only. Runtime replacement
  requires a reviewed actual image receipt and fresh interrupted/resumed fixture
  qualification. See `docs/mutation-campaign.md` and `.github/runtime/README.md`.
  `.github/scripts/test_workflow_concurrency.py` pins the shared group, queue,
  shard count and CI invocation; it does not emulate GitHub's scheduler.
  Tool preparation, calibration, native diagnostics and current-attempt recovery
  preparation acquire slot zero sequentially, before the workers. The same-run
  native report authenticates completed uploads, then admission deliberately
  stops with `native_review_required`. Only the external owner's later numeric
  admission-job rerun releases production preparation after report review.
  Native samples contribute no production coverage; their fixed admission,
  original lifetime and additional total-history ceiling remain mandatory on
  continuation and aggregate-only recovery. See [campaign operations](mutation-campaign.md).
  Every mutation job has a 120-minute cap. The distinct fixture checks
  prove interruption and recovery; they never establish production coverage.
  Read-only jobs cannot dispatch themselves. An authorized external controller
  owns finite reruns and explicitly selected predecessor chains.

## 3. Prefer causal assertions to equality assertions

All five failures asserted a relation between two computed values, which is the
shape that is easiest to satisfy by accident.

Weak:

```rust
assert_eq!(run_a.hash(), run_b.hash());
```

Strong:

```rust
let baseline = sim.world_hash();
mutate_one_field(&mut sim);
assert_ne!(baseline, sim.world_hash(), "hash ignores this field");
restore_that_field(&mut sim);
assert_eq!(baseline, sim.world_hash(), "restoring state must restore the digest");
```

The second pins a **causal relationship**. The first pins a coincidence.

## 4. A guard is a mechanism like any other

An untested guard is indistinguishable from no guard.

A guard must **hold everything else constant** to isolate what it claims to
check. [L7] happened because a guard compared a ticked world against an
unticked one: the clock term alone made the digests differ, so the guard passed
without ever observing the entity rows it existed to verify.

## 5. Any test that can pass on empty input must assert the input was not empty

The narrow original form of rule 3, kept because it is the single most common
instance.

## 6. Name the invariant in the test name

`hash_observes_entity_state_not_only_the_clock` tells a reader which mutation
should break it. `pathfinding_is_deterministic` does not. If you cannot write a
name that implies its own mutation, the test probably does not have one.

## 7. Take enough samples to exclude the degenerate alternative

For an invariant of the form "X lags, leads, or differs from Y by exactly N",
**N + 1 observations make the relation expressible and N + 2 are needed to test
it.** At N + 1 a *frozen* or *saturated* alternative predicts the same numbers,
so the test cannot tell the two apart and is green either way.

Before writing the assertions, name the degenerate alternative out loud: *what
else would produce exactly these numbers?* Then add samples until only the
intended mechanism survives.

[L11] is the recorded instance: `prev_positions_lag_by_one_sync` synced twice,
and "prev lags by one frame" and "prev is frozen at the first frame" agree on
both of those frames. They disagree only on the third.

## 8. Validate at the boundary, and check that the check ships

An FFI export reclassifies every argument from trusted to hostile, and nothing
in the type system marks the moment it happened. Two consequences:

- Put the validation in the crate where untrusted input **enters**
  (`terri-wasm`). The sim crates keep the right to assume valid inputs; that
  assumption is what makes them testable.
- **`debug_assert!` documents an invariant, it does not enforce one.**
  `wasm-pack build` is a release build, so every `debug_assert!` reachable from
  JavaScript is absent on the only target that ships. Verify boundary tests
  with `--release`, or a debug-only panic will fail them for the wrong reason
  and hide whether the real check works. See [L12].

## Standing review question

Every code review of this project must answer, for each test that names an
invariant:

> **Which specific mutation would make this test fail?**

If the reviewer cannot name one, that is a finding, not a pass. This question
has caught five of five instances so far; it is the defence that actually
works, and it only works when asked explicitly rather than re-derived.

## 9. Every milestone ends with a PLAYED visual pass

<!-- Renumbered from a second "8" on 2026-08-02: two rules shared the
number. Rule 8 is cited five times across crates/, web/ and docs/, and
every one of those means "validate at the boundary", so that rule kept
the number and this one moved. Nothing cited this one. -->

A milestone is not done when its tests are green and its trace numbers
are recorded; it is done when somebody has PLAYED the build and looked.
The M2d cycle proved the gap: every gate was green, the trace was
clean, and the first human session filed twelve findings in one
message - wrong-facing kitchen sprites, a bed drawn through a wall,
free-standing wall screens, an orphaned chair - none of which any test
or trace could see, because they are facts about pixels and reading,
not about state.

The pass, before the milestone PR:

- Play the build in a displayed browser (the pane, or over the LAN).
- Walk a fixed checklist: every object's sprite against its footprint;
  every wall run end to end; every UI element exercised; one full need
  cycle for one sim; one conversation watched end to end; every new
  mechanic SEEN doing its thing, not inferred from a counter.
- File findings in docs/alpha-feel-notes.md with the milestone's entry,
  fixed or explicitly deferred with the reason.

A finding class caught here twice becomes a candidate for automation -
the anchor rule got a render-buffer test the same day it got eyes - but
the pass itself is not automatable, which is the point: it is the one
gate that measures what a player actually receives.

### Evidence required for visual repairs

Do not commit or upload review videos, either as files, converted animated GIF loops, or inside trace archives. Retain selected screenshots, measurements, reproduction settings, and written findings. Watch animations and transitions in the actual game. Keep temporary recordings in ignored local scratch storage; check archive contents before staging evidence.

Keep bulk screenshot sequences in ignored `.scratch/` storage as well. Commit
the selected still images needed to explain the finding, together with the
reproduction settings and structured results. Historical capture paths and
recovery are explained in [verification records](evidence/README.md).

1. Reproduce the reported state in an isolated browser using the actual game or creator. Record the source or built-file hashes, viewport, camera, action, facing, body settings, and animation phase. Label any unavailable original settings instead of inventing an exact reproduction.
2. Capture each supported facing at the normal display size and the enlarged preview size. For selectable parts, include every affected choice and representative combinations with adjacent parts; default-preset captures alone cannot approve a clothing catalogue. Inspect the saved images at their original resolution. Watch the affected animation and its relevant entry/exit transitions separately; paused captures prove only their recorded phases.
3. For a reported defect with a reproducible cause, restore that cause only in an isolated test or browser. Require the regression assertion to fail. Capture the defective and corrected states with matching settings, then restore the current renderer and require identical corrected output. Preserve the failure and restoration receipts.
4. Give a fresh reviewer the reported symptom, acceptance criteria, and actual captures without an expected passing conclusion. When a known defective capture exists, present it alongside the corrected captures without identifying which is which until the reviewer records a verdict. A review that accepts the defective result is a failed review and cannot approve the repair.
5. Record each inspected image filename and its visible findings. Distinguish severe body obstruction, displacement, color changes, and broken outlines from specifically accepted minor contact overlap. A list of generated captures or successful assertions is not a record of visual inspection.
6. The coordinating agent must inspect the triggering state and required facings as well as reading the review. Resolve disagreements and new findings before claiming repair. Link the evidence and name the limits of the actual inspection; source review, screenshot hashes, and test totals do not establish visual quality.

For the chair-preview registration defect, run
`node scripts/character-creator-repair/check-chair-registration.cjs` with a fresh
`CHAIR_CHECK_RUN` label. The isolated transform restores the old anchor and must
fail the source-camera registration assertion. Use
`node scripts/character-creator-repair/capture-chair-review.cjs` with a fresh
`CHAIR_VISUAL_RUN` label for matching current and faulty browser captures. Keep
the capture report's condition mapping hidden from the reviewer until their
visual verdict is recorded. These commands address that specific regression;
they do not replace the broader played pass above.

## 10. A document's own ids must not come from a shared counter

Ids that identify entries in an accreting document - `[L-...]` in
`docs/lessons-learned.md`, `[A-...]` in `docs/alpha-feel-notes.md` - are
kebab-case SLUGS, never the next free integer.

A counter is an allocator, and branches that cannot see each other read
it identically. Both series collided in practice: two different `[L41]`s
on 2026-07-29, then three PRs on 2026-08-01 each appending what they
believed was `[A-17]`. Every collision costs a renumber, a sweep of the
cross-references and a fresh CI run, and none of it is about the code
under review.

- New entry: `## [L-what-it-is-about] ...`. Nothing to look up or
  reserve.
- Existing numbers never move; they are cited from ~60 files. The
  series closed at `[L74]` and `[A-25]`.
- `check-doc-ids.py` fails the build on a number past the closed series
  or on the same id twice. It runs in the `rust` CI job.
- Both files carry `merge=union` in `.gitattributes`, so two branches
  appending different entries merge with no conflict at all. Union keeps
  both sides of an overlapping hunk, so an edit to an OLD entry made on
  two branches at once wants a careful read of the merge rather than a
  trusted auto-resolve.

This rule is about documents. Ids that name a THING rather than an entry
- `[D-1]`, `[K5]`, `[E4]` in the design specs - are allocated inside one
document by one author and have never collided.
