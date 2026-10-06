# Needs integration with current main

Delivery integration on 2026-10-06 combines the reviewed needs patch at
`10fc5aa3` with fetched and pulled `origin/main` at `d19c2d6e`.
The [initial verification record](2026-10-06-verification.md) describes the
pre-integration checks; its original logs remain historical evidence.

## Reconciliation

1. Retain main's skills, repetition moodlets, weekday schedules, object
   affinities, editing and queued-chain lifetime. Keep both Relationships and
   ChainState in directed-action queries.
2. Keep all incoming tuning fields in their published order. Append the
   need-interaction values after them. The compiled golden fixture preserves
   main's bytes, with four seat bytes and twelve need-tuning bytes inserted
   at their owning record boundaries. Public save formats remain unchanged.
3. Consolidate this branch's unpublished notes into the existing October 6
   entry, `docs/changelog/2026-10-06-skills.md`, preserving incoming bullets.
4. Verify that media nuisance can move a receiver's feeling through zero
   before that minute's Social payment, while chair Comfort remains available.

## Regression diagnosis

The first combined run found three existing fixture assumptions and one new
fixture-admission problem. Traces confirmed the causes before expectations
changed:

1. Five dishes were conserved: the actor carried four and a bystander carried
   the fifth under a separate valid claim. The single-owner test now isolates
   bystanders using supported zero critical-cleanup willingness, critical
   Energy and zero Energy recovery. It retains quantity, foreign ownership
   and save/load assertions and checks the isolation each tick.
2. The interrupted actor completed the toilet correctly, but an unrelated
   autonomous visit no longer happened in the same seed replay. The test now
   orders a co-user visit explicitly, checks every event against actual
   one-tick completion counters and requires nonempty co-user attribution.
3. Habituation was 2.34501171 after snack 9 and 2.52990270 after snack 10,
   crossing the unchanged 2.5 threshold. The seed-specific expectation now
   records ten, while an independent measured-duration recurrence, threshold,
   unchanged food rewards, satisfaction decline and healing assertions remain.
4. The co-viewer legitimately acquired the only available chair before the
   intended receiver began. The nuisance test now establishes the receiver's
   seat before introducing the active co-viewer.

Independent integration review and a fresh Rule of Three review endorsed the
reconciliations without finding a new runtime defect or weakened assertion.
The final combined checks passed after those corrections.


## Combined validation

| Check | Exit | Result |
| --- | --- | --- |
| `cargo fmt --all -- --check` | 0 | PASS |
| `cargo clippy --workspace --all-targets -j 1 -- -D warnings` | 0 | PASS; `integrated-clippy.txt` |
| `cargo test --workspace --no-fail-fast -j 1 -- --test-threads=1` | 0 | PASS: 1,702 tests; `integrated-rust.txt` |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | 0 | PASS; `integrated-wasm.txt` |
| `npm --prefix web run typecheck` | 0 | PASS |
| `npm --prefix web test -- --maxWorkers=1` | 0 | PASS: 153 files, 2,081 tests |
| `npm --prefix web run build` | 0 | PASS; existing large-chunk warning |
| Changelog tests and generator | 0 | PASS: 12 tests; same-day notes consolidated |
| Documentation IDs and whitespace | 0 | PASS |

The native total is 129 core, 309 data, 1,066 simulation, 197 browser-boundary
and one auxiliary test. Node used one test worker and a 3,072 MiB heap.
Rust builds used one worker. The 28 original causal deletions remain
pre-integration evidence; the full hosted mutation sweep is separate and is
not claimed passed. No additional behavior was introduced during conflict
resolution. No task-owned preview server or game page was left running.


## Final main refresh

Main advanced to `0a1e36e8` with published sleeping-audio work before
delivery. A second pull preserved it and reconciled the shared changelog
header. No Rust source changed in that incoming range, so passing Rust
checks were not repeated. The affected audio, cue and snore tests passed:
18 files, 442 tests. Type checking, production build, changelog validation
and document IDs also passed with exit zero after this pull. Both
contributors' notes and the published filename remain intact.
