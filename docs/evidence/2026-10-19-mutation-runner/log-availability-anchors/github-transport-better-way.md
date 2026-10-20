# GitHub log transport review

## Real goal

[G1] Finish the authorized release with an actual Linux interrupted/uploaded/resumed fixture, then authenticated complete native mutation coverage. Recovery must work while its workflow is running, preserve failed execution evidence, and remain inside the existing execution, retention and request budgets.

## Diagnosis check

[D1] Confirmed: recovery requires an output of the unfinished workflow. `fresh_inventory` probes every referenced run, including the current run, at `.github/scripts/mutation_recovery.py:414-436`. `WorkflowAPI.probe_logs` requests `/actions/runs/{run_id}/logs` and requires a 302 at lines 646-664. Preparation calls this before workers at `.github/scripts/mutation_workflow.py:292-302,334-345`; aggregation does it while aggregation itself is running at lines 362-381. The workflow graph places preparation before workers and aggregation at `.github/workflows/ci.yml:472-556`. Waiting inside either job cannot establish whole-run completion.

[D2] The actual failure is narrower than a proven GitHub token-permission defect. The retained preparation log reports `infrastructure_failure` with `GitHub did not issue a current run-log download location` at `.local-build/build-ui-followup/fixture-39364646593-prepare-failure.log:268`. The adapter discards the actual status, so that log does not distinguish 404, 403, 429 or malformed redirect. The root's separate host observation in `fixture-39364646593-runlog-probe.json` records 404 and no Location while the run was active. It expressly uses a host credential, not the Actions token. Together with the lifecycle dependency this strongly supports an unavailable active-run archive; it does not establish the failing job's exact HTTP status.

[D3] Completed job logs are already the producer-authentication primitive. `.github/scripts/mutation_artifacts.py:323-357` authenticates run/attempt/job identity, fetches the exact job log, and matches both the receipt and uploaded artifact ID. Recovery retains original bytes, digest, identity and original expiry at `.github/scripts/mutation_recovery.py:70-111`; snapshots authenticate their completed producer at lines 263-279. This evidence is materially stronger than an unfollowed whole-run redirect.

[D4] The mocks conceal the broken platform contract. `test_mutation_recovery.py:34` and `test_mutation_native.py:88` install a successful `probe_logs` lambda. `WorkflowAPI` delegates to that lambda before its real HTTP code at `.github/scripts/mutation_recovery.py:650-653`. Wrapper request counts therefore exercise accounting but do not establish HTTP behavior, lifecycle availability or credential behavior.

[D5] The three failures share a verification mistake, although their immediate causes differ. The raw CLI transport assumed captured output bypassed the escape guard; full-repository recursive tree enumeration assumed a complete response; the run-log probe assumed active-run archive availability. The ledger records the first two at `.superpowers/sdd/mutation-campaign-repair-plan/progress.md:107,117`; the third is in the preparation failure log cited in [D2], the credential-specific diagnosis. The first two prevention rules are in `docs/lessons-learned.md:13037-13057`. More mocks at the high-level API interface will not test those assumptions. Verify each platform boundary using its real transport and minimal representative input before spending on native execution.

## What was taken as fixed but is not

[F1] A run archive is not the only log-availability primitive. GitHub documents a separate job-log redirect, requiring Actions read access, for an individual job. Both documented redirects expire after one minute. Neither documented 302 proves that the destination body was fetched or that historical attempts are complete. The reviewed REST text does not promise active-run archive availability. See [job-log API](https://docs.github.com/en/rest/actions/workflow-jobs#download-job-logs-for-a-workflow-run) and [run-log API](https://docs.github.com/en/rest/actions/workflow-runs#download-workflow-run-logs).

[F2] The approved policy is complete retained original evidence plus a limited fresh availability signal. It never established live retrieval of every historical GitHub log on every continuation. The distinction is explicit in `task-3-api-design-review.md:94-109` and `docs/mutation-campaign.md:269-279`. Replacing the signal with a completed-job probe can preserve that policy. Accepting a failed request, skipping the current run, or claiming retained bytes prove current availability would violate it.

[F3] Selection of a log to probe belongs above the HTTP adapter. Only authenticated recovery knows which original producer belongs to a run. The adapter should receive an exact validated job identity and implement one bounded request. The existing `probe_logs(repository, run_id)` interface encourages a generic whole-run request without that context.

[F4] A new cross-run continuation need not have a new plan artifact. `prepare_plan` reuses the original plan at `.github/scripts/mutation_workflow.py:235-243` and emits no new `MUTATION_PLAN` receipt. Consequently, “pick a log from retained originals” alone fails for a new current run. Its completed planning job must supply an explicitly authenticated availability-only anchor. This is a real case that the replacement contract must handle before implementation.

## Alternative routes

[ALT1] Completed-job availability anchors with complete retained evidence.

Mechanism: retain the existing complete original producer logs and authenticate new original evidence exactly as today. For each referenced run, probe one deterministically selected completed original producer job. Prefer the earliest required original producer by attempt and numeric job ID; select before any probe, and never replace a missing selected log with another log. A new current continuation with no original producer uses its authenticated completed planning job as an availability-only anchor. Apply this mechanism to active and completed runs alike.

Work required: split metadata inventory from the availability pass; finish loading the snapshot and collecting the already-authenticated original log references before selecting anchors. Retain the original plan recording before the initial availability check instead of probing an empty `data["logs"]`. Authenticate a new continuation's completed planning job against the current run, exact attempt, expected planning name and workflow identity. Keep availability-only observations separate from producer receipts and accepted records. Replace the adapter's run endpoint with an exact job endpoint and update its tests, budget fixtures and operational documentation.

Costs and risks: one fresh redirect per distinct referenced run per preparation/aggregation process, as before, plus any uncached job metadata needed to validate the selected anchor. With retained authenticated job inventories, historical selection needs no new lookup. A new current continuation can require one additional bounded current-attempt jobs lookup per wrapper. If an implementation instead requires one fresh job lookup per run, charge that full cost explicitly. The probe establishes issuance of a current location for the selected completed log, not all historical bodies or future availability. Original bytes and original expiry still carry the complete evidence.

Makes easier or harder later: works across active runs, completed runs and reruns without waiting for whole-run completion. It also detects loss of an old selected job even if a newer attempt has logs. Selection and the empty-current-run case become explicit, testable policy. This is my recommended route.

[ALT2] Revalidate every required original job-log location.

Mechanism: probe each unique required original job ID in every preparation and aggregate, retaining existing original byte authentication.

Work required: replace run enumeration with complete required-job enumeration, account for every redirect, and prove the complete finite admitted history fits before admission. A followed bounded body fetch and digest comparison would provide stronger evidence again, with separate byte/time accounting.

Costs and risks: for L required logs and R referenced runs, replacing one-per-run probes adds `2 * (L - R)` REST calls across preparation and aggregation, before extra metadata lookups. Hundreds of historical worker logs can exhaust the unchanged 800-request envelope. A redirect still does not prove body retrieval. This route cannot be adopted on the strength of the existing 582-request fixture.

Makes easier or harder later: gives a more precise per-job availability signal, but ties recovery cost directly to historical job count. It is credible only if the actual admitted history fits unchanged limits; raising caps or silently accepting smaller coverage is forbidden.

[ALT3] Move archive validation beyond workflow completion.

Mechanism: an external authorized controller validates a completed run's archive, then a separate consumer workflow authenticates that evidence before starting further work.

Work required: redesign the workflow graph, proof producer and continuation protocol, including who authenticates the external observation and how it is bound to the next consumer. Preserve read-only workflow tokens and explicit external dispatch.

Costs and risks: substantially larger change, more workflow boundaries, and likely conflict with same-run recovery qualification and the eight-run limit. An external assertion alone cannot replace authenticated producer bytes. This route does not fit the current release's approved constraints.

Makes easier or harder later: whole-run archives become naturally available at the validation boundary, but continuation and failure ownership become more complex. Do not use it as a quick fix.

## Recommendation

[R1] Implement [ALT1], completed-job availability anchors with complete retained evidence. The surrounding immutable-snapshot architecture is sound for the approved evidence policy; its generic run-archive probe is the wrong primitive. Keep all original authentication, full inventories, original retention deadlines, terminal failures and mutation policy gates. Change the selection boundary and transport, then prove the real completed-job endpoint before another native qualification attempt. Do not retry the current failure into success, disable probes, special-case the current head, or reinterpret a 404 as acceptable.

[R2] Minimal ownership: one implementer owns `mutation_recovery.py`, the narrow orchestration changes in `mutation_workflow.py`, and directly affected recovery/native/budget tests. Any shared byte-transport change in `mutation_artifacts.py` needs a separate concrete reason; its raw-byte repair already works. Root owns workflow preflight wiring, docs/lessons, Git, dispatch and delivery. The model, executor, admission algorithms, native selection and game source stay closed. The review writes only this report.

[R3] Required tests must exercise the actual HTTP implementation, with only the opener/response boundary injected. Cover 302 with valid HTTPS Location, missing/invalid Location, 401/403/404/429/5xx and transport errors; each failure remains fatal and reports sanitized status and exact resource identity without token or signed URL. Assert one charged REST request, no redirect following, no credential forwarding, no raw terminal rendering and no failed-result cache. Keep the high-level counting fixtures, but do not treat them as transport tests.

[R4] Required lifecycle tests: active current run with completed plan and unavailable whole-run archive succeeds through the completed-job primitive; current preparation/aggregate cannot select itself; foreign run, wrong attempt, skipped/in-progress job and missing anchor refuse. Cover first fixture preparation, same-run resumed preparation, aggregate-only recovery, a new cross-run continuation with no new plan receipt, completed predecessor/source runs, and source-run budget exhaustion. Deleting the selected old log must fail even if a newer log is available. Removing any required original, corrupting retained bytes, expired original retention, missing failed-worker upload and terminal native/aggregate failure must still fail. A guard-removal control should expose a current-run skip and an anchor substitution.

[R5] Request accounting: measure the actual wrapper again. The known 582 and 481 totals are evidence for the old code, not a certificate for the proposal. Under [ALT1], completed-job availability anchors, redirect count remains at most `2R`, with `R <= 10`; replacing run redirects alone has zero REST-count delta. Additional uncached anchor lookups add their actual count. For a design requiring only one current-run lookup in each wrapper, the calculated increment is at most two requests; 584 and 483 would be projections, not observed totals. Keep 800 nominal, all existing job admission thresholds and the current-job `GITHUB_TOKEN` quota checks. Object-store bytes and snapshot validation still have their separate bounds.

[R6] Bounded real preflight, before any new Cargo work:

1. Root can first verify the replacement endpoint against an already completed producer from the failed fixture using one non-following host request, retaining only job/run identity, status, Location-present/HTTPS booleans and timestamp. Label that host-credential evidence. The old active-run 404 is already retained; do not repeat it for reassurance.
2. The same-token proof requires an actual Actions job. Put a small transport preflight before Cargo in the existing slot-zero fixture tool stage, or a separately reviewed no-native diagnostic job. Use only its existing Actions-read token. Authenticate its run and the completed `changes` predecessor, test that completed job's log endpoint, then test one authenticated completed historical job. Record rate status before and after. With one bounded current jobs page, one historical job lookup, two redirects, current run metadata and two rate observations, this is seven REST calls. Refuse pagination/capacity mismatch rather than silently omit a producer. Do not persist either signed location or credentials.
3. An optional eighth request can demonstrate the active run-archive status inside the same job. It is diagnostic only and must not become an acceptance prerequisite or a permissive production fallback.
4. Stop before Cargo if the completed-job contract fails. Only after this proof should the repaired fixture perform its real interruption, immutable upload and same-run recovery. A short transport check cannot establish that qualification, exhaustive native coverage, or live deployment.

There is no legitimate way to substitute the host CLI credential for the Actions token. The current token cannot be extracted from an old job for a local test. A new job is necessary for that specific proof; placing the check before native execution limits wasted work. Existing unchanged source checks remain required, even if they account for most of the preflight workflow's elapsed time.

## What I could not determine

[U1] The failed preparation's exact HTTP status is absent from its retained output. The root's host 404 is supporting evidence with a different credential. A sanitized in-job transport observation settles the credential-specific question.

[U2] Public REST docs describe redirects, permissions and expiry, but do not give an active-run archive availability guarantee or guarantee that every completed-job body is immediately retrievable. The proposed real preflight must establish the actual platform behavior. No retry or timing allowance is approved by this review.

[U3] No probe guarantees future durability or detects every possible deletion of every original body. [ALT1], completed-job availability anchors, deliberately preserves the previously approved limited signal plus complete authenticated retained bytes and original expiry. If root changes the requirement to fresh proof of every body, [ALT2], individual-original revalidation, needs a new unchanged-budget capacity proof.

[U4] I performed no live GitHub API request, workflow dispatch, build, test suite, credential read, source edit or Git mutation. I inspected the supplied failure receipt, code, current local contracts and official documentation. The only written file is this report.

**Next steps**: Root should adopt the explicit anchor contract, assign the narrow repair and transport tests, and run the bounded real preflight before new native execution. No additional user decision is needed for this scoped recommendation.
