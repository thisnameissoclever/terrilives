# Mutation campaign operations

CI accepts a production campaign only when authenticated results cover the exact
complete manifest, every baseline passed, and the survivor and timeout policies
pass. An interrupted worker stays failed while its completed results remain
available for recovery. Fixture qualification proves the recovery mechanism;
it supplies no production mutation coverage.

## Preparation and execution

1. Manually dispatch the registered `ci.yml` with `mutation_mode=fixture` on the
   reviewed branch. The `mutation-fixture-tool` job acquires global slot zero,
   builds the exact reviewed cargo-mutants 27.1.0 patch with Rust 1.94.1 and
   locked dependencies, exercises same-line field selection, and uploads one
   immutable executable and receipt. It does not install into Cargo home.
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
   assignment. Changes to computation inputs require a new campaign.

Before a full campaign, retain actual Linux measurements for cold preparation,
workspace tests, representative mutant builds/tests, shutdown, report validation,
artifact size/upload and API request demand. Per-attempt admission proves only
that a baseline and one full mutation fit inside the job window. It does not
prove that the full manifest fits the finite campaign. The initial 30-second
shutdown, 120-second validation and 240-second upload reserves are conservative
capacity inputs; measured evidence must establish that they suffice.

The executable archive has a separate 256 MiB binary capacity limit and a 1 MiB
receipt limit. These are safety bounds, not measured sizes. Result evidence keeps
its 128 MiB archive, 32 MiB member and 10,000-member bounds. Consumers authenticate
bytes before restoring executable permission. All tool calls use the verified
absolute path; PATH and Cargo-home alternatives cannot replace it.

## Continuation and acceptance

After the full attempt finishes with a resumable incomplete verdict, authenticate
its numeric `mutation-prepare` job ID (`mutation-fixture-prepare` for fixtures)
and run `gh run rerun RUN_ID --job PREPARATION_JOB_ID`. This reruns preparation
and its mutation dependents without rerunning Rust or web checks. Completed slots
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
requests per attempt. Keep measured request counts in dated evidence, not this guide.
GitHub's ordinary repository GITHUB_TOKEN budget is 1,000 requests per hour; separate
jobs share it. Object-store transfers and artifact-service uploads also need byte
and time measurement even when they use a different request quota.

Each job checks its actual token's remaining/reset values before work. Preparation
requires 800 requests available, a worker requires 50, and aggregation requires
400. Tool preparation and original planning require 100 and 400 respectively.
Preparation and aggregation retain another observation with its timestamp. The
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
and aggregation also request a non-following run-log download redirect for each
referenced run. A valid 302 establishes only that GitHub issued a current download
location; the signed URL is never retained, logged or followed with credentials.
This is an additional run-level deletion signal, not a fresh fetch of every old
per-job body or proof that a latest-run archive contains older attempts. Any
separately observed loss of required original evidence still stops recovery.

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
