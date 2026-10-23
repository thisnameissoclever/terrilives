# Native Linux admission implementation authority

Implement the adopted same-run route: existing full production plan -> native diagnostic under shared slot zero -> lightweight finished report -> explicit native_review_required admission -> root reviews the report and reruns the numeric admission job -> existing preparation, eight workers and aggregate.

This is an additive admission repair on the locally reviewed base ad67b0b59, which root reports is committed but not pushed. Root reports native/UI inputs remain those of 0b886b73d. This note authorizes no implementation, Git operation, test, build or dispatch by its reviewer. It supersedes the earlier alternatives in this file; none of those alternatives is part of the adopted design.

## Verified current behavior

1. ci.yml exposes production and fixture modes. The fixture-only mutation-tool job builds the pinned tool and the tiny fixture qualifies orchestration. It does not measure native game throughput.
2. The current production mutation-plan job selects authenticated fixture qualification and its executable. When qualification is missing, planning fails promptly; independent Rust/web checks can finish. This is the initial blocked job root must rerun after qualification.
3. mutation_workflow.prepare_plan calls runner.calibrate and runner.plan. Calibration uses a fresh isolated native source copy and owned target directory, runs the locked whole-workspace build and tests, and freezes the measured baseline and absolute test cap.
4. Calibration writes calibration.json.build.log and calibration.json.test.log beside scratch/calibration.json. Those files currently lie outside the uploaded scratch/plan directory. The current plan artifact therefore does not retain the cold build/test logs.
5. runner.plan freezes the complete native manifest, calibration, caps, tool contract and all eight logical slot assignments. Its capacity check establishes that setup, a baseline, one fully capped mutation, shutdown, validation and upload can fit 7,200 seconds. It does not establish complete-manifest throughput or retained-evidence capacity.
6. The current graph releases mutation-prepare after successful planning and all eight matrix workers after preparation. Its production aggregate uses always() after the plan. No external native measurement decision separates planning from broad worker release.
7. execute_slot selects all remaining identities for its slot. Its deliberate record-count stop is fixture-only and must remain forbidden for production. It is not a supported native diagnostic sampler.
8. docs/mutation-campaign.md already requires real Linux native preparation, representative mutant, shutdown, validation, artifact/upload and API measurements before the full campaign. The new path supplies that missing operational gate.

## Adopted job graph and external action

1. Preserve fixture mode and its existing tool, plan, preparation, workers, interrupted recovery and qualification path. Native measurement/admission jobs are production-only. Do not modify fixture qualification into native coverage.
2. Keep the existing full production mutation-plan producer. If the initial PR lacks qualification, root first completes the manual fixture and then reruns only the PR's authenticated numeric mutation-plan job. Its mutation dependents can run; previously passing Rust/web jobs are outside that subtree.
3. Insert mutation-native-pilot after the original plan producer has completed. It authenticates the exact finished plan, qualification, executable and current inputs. It owns ci-mutation-shard-0, uses the existing queue/cancellation behavior and Ubuntu image, and has a 120-minute timeout. Calibration and the native diagnostic remain separate jobs so each has an honest elapsed-time budget.
4. Insert mutation-native-pilot-report after the diagnostic producer finishes and uploads. This is a metadata/authentication/reporting job, with no native build, test or mutation process and no large full-manifest sizing workload. It authenticates completed diagnostic evidence and producer logs, obtains actual uploaded sizes and upload-step duration from authenticated completed metadata, and publishes the finished report.
5. Insert mutation-admission after the finished report. It independently authenticates the original plan, diagnostic, finished report, producer histories, current source/runtime, retention and computed bounds. If all measurement checks pass but the current run attempt equals the finished measurement producer attempt, emit the distinct orchestration decision native_review_required and fail that check. No production preparation, worker or production aggregate may start.
6. Root reads the finished report and makes the finite-capacity decision. To admit the campaign, root runs gh run rerun RUN_ID --job ADMISSION_JOB_ID for that authenticated admission job. The later attempt must reauthenticate the same immutable plan and measurement references, pass current-input checks, and prove its previous admission verdict was exactly authenticated native_review_required. It then succeeds and releases only existing mutation-prepare, the eight workers and aggregation.
7. A later attempt alone is insufficient. It must be linked to the valid prior measurement and expected review-required verdict; a failed measurement or missing earlier admission artifact cannot be converted into approval by another rerun. The numeric admission rerun is root's explicit external action after review. It proves a separate rerun occurred, not that a machine can verify the quality of human judgment.
8. After admission, ordinary incomplete mutation continuation still targets mutation-prepare and its mutation dependents. Keep the diagnostic/admission producers outside that dependent subtree. Preparation carries the fixed authenticated admission reference; workers and aggregation validate its binding to the original plan. Aggregate-only recovery must also require valid admission.
9. Update production aggregation's condition so the deliberate review-required attempt cannot start a production aggregate. Its existing always() behavior must be constrained by valid admission. Preserve truthful aggregation after admitted workers fail or stop incomplete.
10. Do not use generic --failed for measurement admission or mutation continuation. Do not automatically rerun admission merely because a report becomes green. Do not stall the matrix by occupying slots or depend on cancellation timing.

No new workflow mode, cross-run discovery, source selector, head exception, dependency, secret, permission, repository setting, self-dispatch or approval environment is part of this repair. Use the existing same-run and explicit continuation/recovery contracts and strict head checks. A later production continuation preserves the original admission reference.

## Preserve original measurements and computation

Keep the original plan, calibration, absolute caps, complete manifest, slot assignments, qualified executable and execution fingerprint fixed. Diagnostic time and the deliberate review attempt consume the original seven-day lifetime and 51-attempt allowance. Do not reset those limits on admission.

Retain the existing cold calibration build/test logs in the original plan artifact as bounded declared hashed members. Move or copy them into the upload directory before finalizing the plan receipt. The authenticated plan must name each permitted log member and its byte length/digest. Verify those declarations and members on recovery; reject absent, changed, undeclared or oversized calibration evidence. The existing recover_plan archive reader permits additional safe members, so no broad archive-format relaxation is needed. Preserve the existing result/member limits and safe-path checks.

The earlier same-run attempts contain no started production workers and no accepted production deltas. Recovery must authenticate that empty worker history, without manufacturing records. Preserve all existing checks for a started worker missing its artifact. Account for the three-attempt history-gap bound: the normal initial missing-qualification attempt and measurement/review-required attempt leave two historical attempts when production first prepares. Unsupported repeated retries must not disappear from history to evade the bound.

Current-source validation remains mandatory at diagnostic execution, admission, preparation, workers and aggregate, including complete-history shortcuts. If inputs or runtime differ, stop. If measured reserve needs cannot fit the fixed contract, reject this campaign and require a new reviewed plan; do not revise the old calibration or caps in place.

## Native diagnostic work

Use a small explicit selection specification resolved against the complete frozen manifest. Select exact full identity descriptors or names and reject missing, ambiguous or duplicate matches. Include a known caught candidate, a reviewed accepted-survivor candidate when one exists, and representative expensive rebuild cases covering the native workload. Retain the selection rationale and full identities. Root judges whether the sample is representative; a tiny generic fixture cannot supply that judgment.

Reuse exact-name batch configuration, selected-enumeration equality, input guards, absolute executable identity, production argv, caps, owned process control and pre-signal evidence rules. Execute diagnostic batches grouped by their original logical slot when that is necessary for existing validators. The physical job always holds global slot zero; it does not reassign production work. Record physical ownership and original logical assignment separately.

Add a narrow diagnostic adapter over those existing lower-level primitives. Do not call execute_slot with a truncated manifest, fake completed history or a production use of fixture_stop_after_records. Never use a file-filter workaround for identity selection. Keep locked whole-workspace tests, assertions, overflow checks, tool/runtime identity and all production identities unchanged.

Diagnostic artifacts use distinct job names, artifact names and receipt markers. They must never resemble a production delta upload or enter production merging. Every diagnostic outcome contributes zero accepted production coverage. The eventual production workers still execute every original manifest identity under its assigned slot.

Retain raw diagnostic reports, test/build logs, phase timings and terminal outcomes. A real diagnostic timeout, unaccepted survivor, baseline failure, malformed result, cleanup failure or contradictory execution blocks admission even though diagnostic results do not count as coverage. If deliberately measuring native shutdown, use an explicitly labeled diagnostic case. Its controlled interruption is incomplete measurement and cannot produce a caught/timeout result from post-signal output.

## Completed upload measurements without a receipt loop

The diagnostic job performs substantial serialization, reconstruction and sizing work under slot zero. It uploads its bounded immutable evidence and prints its receipt and actual upload ID. The finished-report job waits for that producer to complete before authenticating its logs and reading upload-step timestamps and artifact metadata.

The finished-report job cannot truthfully include its own final upload duration inside the artifact being uploaded. Admission solves that last boundary: it waits for the report producer to finish, authenticates that producer and upload ID, and reads the completed report upload's metadata/timestamps separately. No further report job or self-referential receipt is needed. Record exactly which durations were observed and which remain estimates. A pre-upload timestamp is not proof an upload completed.

Keep every byte cap and authentication check. Additional diagnostic artifacts and REST calls belong in the same bounded inventory/API budget. Preserve exact original producer-log bytes and their original retention bounds under the reviewed recovery policy.

## Failure history and the expected review pause

Only an authenticated native_review_required verdict, produced after complete passing measurement/authentication checks, is eligible for the owner-directed admission rerun.

Every started native diagnostic, finished-report or admission job must appear in authenticated phase history, with its immutable evidence or verdict. Missing artifacts from started jobs, absent producer logs, malformed receipts, unsuccessful measurement, failed authentication, actual capacity failures and contradictory earlier verdicts remain terminal. A later successful sample, report or admission must not erase them. A job that never started because its prerequisite failed is different from a started job whose evidence disappeared.

Extend retained phase inventory and verdict validation narrowly to these new native decision jobs. Include the decision history in the admitted prepared input and subsequent snapshots. Preserve all existing production/aggregate failure protections. Do not map native_review_required onto a production baseline, policy or infrastructure failure and then broadly exempt that failure class. It is a separate orchestration verdict with exact permitted producer, evidence and transition conditions.

The initial qualification-missing plan failure occurs before this campaign's original plan and native decision evidence exist; the existing authorized qualification/bootstrap retry remains supported. Once the original plan exists and a native decision phase starts, its failures cannot be retried into a favorable result under this repair.

## Computed safety bounds versus root's judgment

The finished evidence must establish:

1. Exact current full manifest and per-slot counts; original calibration/caps; complete test argv/inventory; unchanged source, qualification, tool and runtime.
2. Cold setup/copy/build/baseline costs, sampled mutant build/test costs, process startup, native shutdown/reaping, raw-report validation, lossless snapshot encode/decode, actual archive/member/reconstructed/log sizes, upload/download observations and API demand.
3. A full-manifest sizing probe using the real complete manifest, measured record/log shapes and the bounded history metadata. Any expanded diagnostic shapes must be labeled sizing data, never execution evidence. Check the existing compressed, expanded, member and logical reconstruction limits. Sample log sizes are not proof that every future test emits the same volume; show the extrapolation assumptions and retain runtime limits.
4. Existing 7,200-second admission arithmetic with fixed baseline/mutation caps and evidence that shutdown, validation and upload reserves are adequate. Reject a plan whose measurements exceed its reserve assumptions.
5. Per-slot finite-capacity forecasts including remaining identities, measured sample costs, repeated setup/baseline, continuation counts, actual remaining campaign lifetime and queue/headroom assumptions. Show the slowest slot. Eight possible runs do not multiply the seven-day wall-clock budget; run and attempt limits are additional constraints.

Root judges sample representativeness, conservative timing allowance and whether the forecast warrants the finite experiment. Measured means or percentiles do not prove the unexecuted remainder will finish. A true pessimistic upper bound can use every mutation's fixed build/test caps plus overhead; if that exceeds the window, report it honestly. Actual exhaustive coverage remains the acceptance gate, with all existing failure, no-progress, evidence and capacity stops.

## Narrow implementation surface and acceptance

Change ci.yml only for the production diagnostic/report/admission jobs, their conditions and dependency edges. Add focused diagnostic/report/admission helpers and adapter commands, bounded hashed calibration-log members, authenticated native decision history/reference plumbing, meaningful contract tests and operations documentation. Reuse reviewed model, artifact, tool, process and compact recovery contracts. Do not change game source, dependencies, survivor policy, slot assignment or accepted coverage semantics.

Prove that the expected review pause starts no production preparation/worker/aggregate; only an authenticated later admission transition releases them; missing or failed native evidence cannot become favorable on rerun; the full original plan is unchanged; diagnostic results cannot become coverage; current input changes fail; and retained calibration logs are authenticated. Test that the targeted admission rerun preserves passing Rust/web and original plan/pilot producers, while ordinary continuation still targets prepare.

Workflow/helper changes alter qualification identity. Finalize this additive repair before root obtains the final real fixture qualification. The fixture proves orchestration, the native diagnostic supports the spending decision, and only the exhaustive production campaign proves game mutation coverage.

**Next steps**: Implement and review this same-run gate on ad67b0b59. Root then obtains fixture qualification, reruns the initially blocked production plan job, reviews the finished native measurements, and explicitly reruns admission only if the evidence supports the finite budget.

