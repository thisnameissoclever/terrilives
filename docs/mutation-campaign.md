# Mutation campaign operations

CI accepts a production campaign only when authenticated results cover the exact
complete manifest, every baseline passed, and the survivor and timeout policies
pass. An interrupted worker stays failed while its completed results remain
available for recovery. Fixture qualification proves the recovery mechanism;
it supplies no production mutation coverage.

## Preparation and execution

When production planning reports missing fixture qualification, complete the
fixture setup and same-run recovery below. The workflow creates the proof from
authenticated results; an operator never creates or substitutes it manually.
The first checkpoint attempt is intentionally incomplete. Qualification appears
only after the resumed attempt completes its exact fixture inventory.

If setup refuses `tool runtime changed`, compare the tool and consumer jobs'
hosted image and runtime identities. Keep the refusal. Start a fresh fixture
campaign after the hosted image rollout has settled; rerunning an immutable
campaign cannot make a different runtime equivalent to its original tool.

1. Manually dispatch the registered `ci.yml` with `mutation_mode=fixture` on the
   reviewed branch. The `mutation-fixture-tool` job acquires global slot zero,
   builds the exact reviewed cargo-mutants 27.1.0 patch with Rust 1.94.1 and
   locked dependencies, exercises same-line field selection, and uploads one
   immutable executable and receipt. It does not install into Cargo home.
   Before Cargo work, the same job verifies log transport with its own Actions
   token and the completed `changes` predecessor. An optional manual
   `transport_probe_job_id` adds a completed historical job to that diagnostic.
   It selects no qualification, plan, recovery anchor or mutation result. Empty
   input checks only the current predecessor and claims no historical diagnostic.
2. Fixture planning acquires the same slot after tool preparation finishes.
   It authenticates executable bytes, committed recipe inputs, producer logs,
   artifact IDs and expiry, then calibrates and freezes the plan. A separate
   `mutation-fixture-prepare` job authenticates that completed producer's logs
   and publishes the current attempt's immutable recovery input. All eight
   fixture slots deliberately checkpoint after retaining a terminal record on
   the first attempt. The aggregate must report incomplete coverage.
3. After that attempt finishes, the authorized external controller reruns the
   successful preparation job and its mutation dependents. Workers recover the original plan and retained results,
   execute pending identities, and upload immutable deltas. Exact fixture
   completion with authenticated interruption and same-run recovery produces
   `mutation-fixture-qualification-run-RUN-attempt-ATTEMPT`.
4. A production PR or manual production dispatch selects a qualification by
   bounded read-only discovery, or by the optional `qualification_run_id`.
   Discovery examines at most 30 manual runs and three 100-artifact pages per
   candidate. A convincing name alone is insufficient. The resolver validates
   committed workflow/helper/fixture inputs, tool identity, raw result evidence,
   producer identity and retention. Missing qualification fails promptly.
5. Production planning freezes a complete native manifest and the measured
   matching workspace baseline. All workers and later attempts use that original
   plan, calibration, timeout contract, executable artifact and eight-slot
   assignment. The original plan also declares the exact byte lengths and SHA-256
   digests of its retained cold calibration build/test logs. Changes to computation
   inputs require a new campaign.
6. The same run's `mutation-native-pilot` acquires global slot zero and measures a
   small explicit native selection against the full original manifest. The caught
   control must actually be caught; a compilation failure does not qualify it.
   Ordinary samples keep their original logical slots and whole-workspace test
   commands. A separate intentional shutdown probe retains only pre-signal
   outcomes. Every diagnostic outcome contributes zero production coverage.
7. `mutation-native-pilot-report` waits for the pilot's completed upload and
   authenticates its raw evidence, producer log, upload step and artifact bytes.
   `mutation-admission` then authenticates the finished report's own completed
   upload. Its first successful measurement decision is deliberately
   `native_review_required` (exit 24). Preparation, workers and production
   aggregation do not start at that boundary.
8. Read the finished report before making the spending decision. If its sample,
   capacity assumptions and finite forecast justify proceeding, rerun only the
   authenticated numeric admission job:
   `gh run rerun RUN_ID --job ADMISSION_JOB_ID`. That later attempt must prove
   the exact previous review-required verdict, unchanged plan and original
   measurement references. It then releases preparation and its eight workers.
   This explicit external action records a separate decision; a later attempt
   cannot mathematically prove that a person read the report.

Before a full campaign, retain actual Linux measurements for cold preparation,
workspace tests, representative mutant builds/tests, shutdown, report validation,
artifact size/upload and API request demand. Per-attempt admission proves only
that a baseline and one full mutation fit inside the job window. It does not
prove that the full manifest fits the finite campaign. The initial 30-second
shutdown, 120-second validation and 240-second upload reserves are conservative
capacity inputs; measured evidence must establish that they suffice. The pilot
compares those reserves with measured shutdown/reaping, owned-directory cleanup, full-plan validation and
lossless snapshot reconstruction; the two completed producer uploads are checked
separately. The report includes measured child resource use, but a child's maximum
RSS is not simultaneous process-group memory and does not guarantee future use.

Admission freezes an additional total-history ceiling across every linked run and
attempt, including orchestration. Its forecast uses 1.5 times the slowest sampled
build/test cost, the original baseline, observed setup, a 30-minute queue allowance
per wave, 1.5 times the forecast waves, a separate admission attempt and two extra
attempts. The ceiling must fit the original remaining seven-day lifetime and
attempt budget. Review delay consumes that same lifetime. The report separately
retains the per-slot mutation-cap subtotal and a capped campaign projection.
The latter uses both phase caps for every baseline and mutation, computes capped
throughput inside each 7,200-second job after setup and all reserves, then adds
that repeated overhead and the declared queue allowance for every required wave.
Its fit verdict compares the complete per-slot projection with the original
remaining lifetime. If a baseline plus one capped mutation cannot fit, the
projection reports explicit nonfit and null wave/duration values, never infinity.
Observed setup and queue allowances remain assumptions; externally imposed delays
can exceed them. This pessimistic evidence can be unfavorable without changing
the independent sample-based admission decision. Sampling supports a finite
experiment; only exhaustive completion proves coverage. Reaching the admitted
ceiling stops the campaign even if the outer 8-run/51-attempt limits would permit
more work.

Native measurement computes the largest production batch count B that fits a
typed raw-artifact projection with 20% headroom. The full original manifest stays
in every raw bundle. Individual baseline logs, mutant logs and diffs remain
separate members; frozen outcomes, post-shutdown outcomes and process output have
their own aggregate growth estimates. The projection considers the longest
record/outcome rows across every full-manifest identity, including shorter slots.
Paths follow the pinned tool's source-path/location/collision naming. Measured
record/log shapes and future process-output growth remain explicit assumptions.
Largest member, expanded total and member count have separate unchanged limits;
one identity that cannot fit refuses the campaign.

The algorithm/version belongs to the committed recipe. B, its byte assumptions,
full computation binding and digest belong to authenticated native admission.
Every production worker requires the resulting typed in-process policy before
launch or complete-history return. It selects the first at most B identities in
its original remaining order, before configuration, enumeration, source guards
and provenance. A normal completed prefix stays incomplete progress while slot
identities remain. Only validated terminal records leave the remaining set; an
interrupted active identity remains first on resume. Fixture record stops remain
fixture-only. No CLI, environment or workflow input can choose B.

Both measured and all-at-caps forecasts use the smaller of B and time-derived
throughput. Smaller B repeats more baselines/setup/reserves and can make the
original finite campaign impossible; it cannot be chosen to disguise that result.
The separate whole-slot raw projection remains visible even when it does not fit.
History sizing uses the retained schema through lossless encode/decode: full
plan, all records and repeated baseline references, bounded batch IDs, full slot
remaining arrays every admitted attempt, original artifact metadata, distinct
base64 producer logs, started jobs/phases, aggregate verdicts and native proofs.
The logical reconstruction limit remains authoritative even when compressed or
interned bytes are tiny. A projected fit is conditional, never game coverage.

After lossless compaction and final retention, every outgoing worker directory
receives an exact safe path/size/hash inventory. Oversized members, expanded total
or member count disable result upload and produce a failed capacity verdict in
bounded authenticated job-log chunks. The complete inventory, digest, source,
manifest, policy and producer identities remain bound together. Oversized raw
bytes stay intact locally; the marker does not claim they were durably uploaded
and supplies no accepted records. Recovery authenticates that failed job and
original log before missing-result handling, retains the terminal verdict and
its original expiry, and refuses a later favorable retry. Missing, malformed,
conflicting or too-large marker evidence also refuses; nothing is truncated.
Uploader ZIP bytes remain unknown locally and are checked from completed artifact
metadata/download. These checks bound accepted evidence, not temporary disk writes.

A started native phase with missing evidence, failed authentication, bad measurement
or a terminal verdict blocks the campaign. Another run cannot replace it with a
favorable sample. Authenticated skipped jobs do not count as execution, even when
GitHub supplies a start timestamp; contradictory upload evidence still fails.

The executable archive has a separate 256 MiB binary capacity limit and a 1 MiB
receipt limit. These are safety bounds, not measured sizes. Result evidence keeps
its 128 MiB archive, 32 MiB member and 10,000-member bounds. Consumers authenticate
bytes before restoring executable permission. All tool calls use the verified
absolute path; PATH and Cargo-home alternatives cannot replace it.

## Continuation and acceptance

After the full attempt finishes with a resumable incomplete verdict, authenticate
its numeric `mutation-prepare` job ID (`mutation-fixture-prepare` for fixtures)
and run `gh run rerun RUN_ID --job PREPARATION_JOB_ID`. This reruns preparation
and its mutation dependents without rerunning Rust, web, native measurement or
admission jobs. The original admitted reference remains fixed in every prepared
input and retained snapshot, including aggregate-only and cross-run recovery.
Completed slots
validate the current inputs and prior results, then perform zero mutations.

Do not use `--failed` for this workflow's mutation continuation. It skips successful
preparation and supplies stale input; workers refuse that before mutation work.
Such an unsupported started worker remains an infrastructure failure. An
aggregate-only rerun may refresh authenticated history itself and does not require
eight new workers. The underlying raw recovery API still supports valid partial
slot histories.

The workflow never dispatches
itself and has only `contents: read` and `actions: read` permissions. Keep the
same-run limit of 51 total attempts and the 30-day rerun window. The campaign
itself has a fixed seven-day end, at most eight explicitly linked runs, and
30-day requested artifact retention. Recovery never resets its end or limits.

For an explicitly authorized cross-run continuation, dispatch `ci.yml` with all
three inputs: `resume_run_id`, `resume_plan_artifact_id`, and `resume_chain`.
The chain is the versioned JSON object retained with the original plan and
aggregate proof. The external controller supplies the predecessor and original
plan ID; the workflow appends its own verified run and checkout metadata.
Ordinary qualification discovery never searches for production results.

Stop on changed head or computation inputs, expired or missing evidence, a failed
baseline, a real timeout, a new survivor, malformed evidence, infrastructure
failure, exhausted capacity, or three identical no-progress attempts. A failed
worker whose upload is missing cannot disappear behind a favorable rerun.
Partial failed-job and aggregate-only recovery must still validate current
inputs, even when all mutation identities were completed previously.

The aggregate retains original and current checkout provenance, exact planned,
completed, remaining and failing identities, recovered deltas, and structured
continuation advice. The states are:

| State | Exit code | Controller action |
| --- | --- | --- |
| `complete` | 0 | Accept only the appropriate fixture or production check. |
| `incomplete_with_progress` | 10 | Continue within unchanged limits after the attempt finishes. |
| `incomplete_without_progress` | 11 | Inspect the cause; stop after three identical attempts. |
| `baseline_failure` | 20 | Stop and repair the unmodified workload. |
| `policy_failure` | 21 | Stop; preserve every timeout and unaccepted survivor. |
| `infrastructure_failure` | 22 | Stop; inspect missing or invalid execution evidence. |
| `capacity_failure` | 23 | Stop and revise the reviewed execution plan. |

The test cap is fixed at `max(120, ceil(full_workspace_test_seconds * 4))`.
Baseline and mutant phases run the complete workspace with locked dependencies,
debug assertions and overflow checks. A controlled stop retains only results
validated before the first termination signal. The process group must be reaped;
post-signal reports cannot manufacture terminal results.

Each reviewed survivor-baseline line permits one normalized missed name across
the entire merged campaign. Full mutation identities retain their source spans
and diff digests. Policy comparison does not collapse distinct identities.

## Compact recovery and API capacity

Preparation authenticates the latest immutable aggregate snapshot from the explicit
chain, freshly checks the complete original-artifact inventory, and validates only
new deltas beyond the sealed frontier. Eight workers consume its current-attempt
proof. Aggregation repeats the fresh inventory check, authenticates current deltas,
and publishes the next snapshot even when valid coverage remains incomplete.
Snapshot copies preserve every original record, raw-report reference, artifact
digest, started-job inventory, producer log and verdict. Global model merging and
counted survivor allocation remain authoritative.

Snapshots intern repeated values losslessly rather than concatenate raw archives.
They have separate 128 MiB archive/expanded bounds, 32 MiB chunks, and a 128 MiB
logical reconstruction bound. Cyclic or excessive dictionary graphs fail before
expansion. Reconstruction must reproduce original bundle and delta digests. These
bounds do not claim that a particular native campaign fits; retain its measured
bytes and validation/upload costs before admission.

At most three missing-snapshot attempts may be replayed. A malformed newest
snapshot is fatal; it cannot be replaced with an older favorable result. Full
artifact inventories are capped at 16 pages per referenced run, with at most eight
campaign runs and two additional tool/qualification source runs. Exceeding any
bound fails capacity instead of truncating evidence. A predecessor advancing past
its sealed final attempt also fails.

The full wrapper request fixture covers preparation, eight consumers and aggregation
at 10, 30 and 50 historical attempts, the eight-run ceiling, and a three-attempt gap
with maximal inventory pages. The nominal sum must remain at or below 800 REST
requests per attempt. The native tests also count original planning, the pilot,
finished report, review-required decision, later admission and first preparation
without a production snapshot. Native history tests use a finite admitted envelope;
the fixture transport test still covers the outer eight-run history ceiling.
Keep measured request counts in dated evidence, not this guide.
GitHub's ordinary repository GITHUB_TOKEN budget is 1,000 requests per hour; separate
jobs share it. Object-store transfers and artifact-service uploads also need byte
and time measurement even when they use a different request quota.

Each job checks its actual token's remaining/reset values before work. Preparation
requires 800 requests available, a worker requires 50, and aggregation requires
400. Tool preparation and original planning require 100 and 400 respectively.
Each native stage requires 400; the later admission additionally requires 850
remaining before releasing preparation. Preparation, aggregation and native
verdicts retain another observation with its timestamp. The
external controller inspects those observations and waits outside runner slots
when necessary. A local `gh api rate_limit` call describes that local credential,
not a completed job's GITHUB_TOKEN bucket. Waiting past an observed reset is
conservative; other repository activity still makes the fresh in-job admission
necessary. Low quota, 403/429 responses and exhausted capacity never waive evidence
checks or authorize an indefinite retry.

## Evidence availability and verification

Every required artifact must outlive the campaign end plus a two-day recovery
margin. Check actual API `expires_at`, the producer's recorded
`GITHUB_RETENTION_DAYS`, and the current runner-provided retention value. The
repository retention administration endpoint is not available to the workflow's
read-only token. Deleted artifacts, known missing logs and incompatible hosted
images stop recovery. A rebuilt executable or a new receipt cannot renew evidence.

The initial authenticator retains the exact original producer-log bytes, SHA-256,
retrieval identity, observation time and that producer's own original retention
bound. Later snapshots carry those bytes and original expiry forward. Preparation
and aggregation also check one stable completed-job log anchor for each referenced
run, including the active current run. Selection follows authenticated original
producers in attempt and job-ID order. A new continuation without an original
producer uses its authenticated completed planning job solely for availability.
The selected identity, basis, observation and original expiry remain fixed across
snapshots and later uploads. Missing selected evidence fails; another available
job cannot replace it.

Each check authenticates completed-job metadata and requests a non-following
job-log redirect. A valid 302 establishes only that GitHub issued a current
download location for that selected job. The signed URL is never retained,
logged or followed with credentials. This is a limited availability signal,
not a fresh fetch of every historical body, proof of future durability or
production coverage. All original evidence and its original retention remain
required. Any separately observed loss of required evidence still stops recovery.
The check does not require an unfinished workflow's whole-run log archive.

Hosted Ubuntu 24.04 image identity, architecture, ELF interpreter, loaded-library
hashes and verbose Rust/Cargo identities are part of the authenticated runtime.
A rolling image change can invalidate a campaign before its artifacts expire.
Requalification and a new campaign are then required.

Run the focused local contract suites with:

```text
python -B -m unittest discover -s .github/scripts -p 'test_mutation_*.py'
python -B -m unittest discover -s .github/scripts -p 'test_workflow_*.py'
```

These tests include raw-report/API fixtures and isolated guard-removal controls.
They do not establish GitHub scheduler behavior, actual artifact/log availability,
Linux cleanup, complete native inventory equality or production throughput.
Retain the real interrupted/resumed GitHub proof and the final complete production
campaign separately from local fixture results.
