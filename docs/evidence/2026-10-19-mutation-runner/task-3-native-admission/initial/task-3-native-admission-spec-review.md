# Native admission spec review

One actionable P2 finding remains. Fix the pessimistic forecast before the first push and actual qualification. I found no additional spec defect in the reviewed admission transition, failure retention, calibration-log transport, or production coverage boundaries. This review does not establish real Linux measurements, GitHub rerun scheduling, or exhaustive game coverage.

Reviewed package SHA-256: `db36c9dbfd0961cd4e566e7aadad5d0bda473d6d1117cde53bedc21a518df60d`, against the declared `ad67b0b5995276a34c7434b9370042c6d6016dbd` base. All 13 current file hashes match `task-3-native-admission-hashes.json`. All nine report/package/test/API evidence hashes match `task-3-native-admission-evidence-hashes.json`. Root-only `b1c8d4bff` evidence/docs are outside this review.

## Finding

1. **[P2] Include campaign overhead in the pessimistic deadline comparison.** `.github/scripts/mutation_native.py:420-421` computes `pessimistic_mutation_cap_seconds_per_slot` as `count * (build_cap + test_cap)` and uses that same subtotal for `pessimistic_cap_bound_fits_remaining`. The subtotal is correctly named as mutation time, but it is not the separate pessimistic campaign upper bound required by the brief's Capacity and root judgment section and preflight's Computed safety bounds section. It omits repeated baselines, setup, fixed reserves, and the forecast's own queue allowance. A bounded fixture with 100 identities per slot, unchanged 600-second build and 120-second test caps, and 80,000 seconds remaining returns `pessimistic_cap_bound_fits_remaining=True` from 72,000 seconds. Even using the fixture's two-second measured baseline and two-second setup, only nine capped mutations fit a 7,200-second job after the fixed 390 seconds of reserves. Twelve waves are required. Their declared 1,800-second queue allowance alone adds 21,600 seconds, producing 93,600 seconds before the repeated baseline/setup/reserve costs. The purported fit is therefore false under the report's own assumptions. Retain the mutation subtotal if useful, but add the separate per-slot capped campaign projection with repeated overhead and compare that projection with the original remaining lifetime. Preserve the unfavorable result as decision evidence; this does not require making the pessimistic bound an automatic admission gate. Add a regression where mutation time fits but the capped campaign projection does not.

The observable failure is misleading spending-decision evidence. It does not bypass the existing sample-based admission envelope, and it is not a claim that the actual game will encounter the synthetic costs.

## Bounded reproduction

Executed from the repository root through `python -B -`, with `.github/scripts` added to `sys.path`. The existing `NativeFixture` creates disposable local API/archive fixtures and cleans them up. No native code was built and no external workflow ran.

```python
import sys, unittest, datetime as dt
sys.path.insert(0, '.github/scripts')
from test_mutation_native import NativeFixture
import mutation_native as native

owner = unittest.TestCase()
try:
    fixture = NativeFixture(owner, count=800)
    pilot = fixture.passing_pilot()
    records = native.validate_samples(
        fixture.planned, pilot['payload']['selection'],
        pilot['payload']['batches'], fixture.baseline.splitlines())
    now = dt.datetime.now(dt.timezone.utc)
    chain = dict(fixture.chain)
    chain['expires_at'] = (now + dt.timedelta(seconds=80000)).isoformat()
    chain['started_at'] = (
        now + dt.timedelta(seconds=80000) - dt.timedelta(days=7)).isoformat()
    result = native.forecast(
        fixture.planned, chain, fixture.settings, records,
        pilot['payload']['measurements'])
    print({key: result[key] for key in (
        'per_slot_counts', 'pessimistic_mutation_cap_seconds_per_slot',
        'pessimistic_cap_bound_fits_remaining', 'remaining_wall_seconds',
        'envelope_wall_seconds')})
finally:
    owner.doCleanups()
```

Observed output: eight slot counts of 100, eight mutation-cap subtotals of 72,000 seconds, `pessimistic_cap_bound_fits_remaining: True`, `remaining_wall_seconds: 79999.799843`, and `envelope_wall_seconds: 45000`. Exit 0, about one second. The sample-based envelope is intentionally separate from the capped projection.

## Scope and evidence

1. Read project instructions, relevant lessons, the adopted brief/preflight, approved main plan, implementation report, campaign guide, frozen diff, native helper/tests, and the workflow/recovery/runner interfaces needed by the new gate. Memory search returned no relevant entry.
2. Confirmed the full original plan precedes the production-only slot-zero pilot; the finished report authenticates completed uploads; the initial valid decision is `native_review_required`; preparation and aggregate are withheld until admission. Fixture qualification remains separate. The admitted preparation and aggregate-only paths require the fixed native reference and validate current inputs.
3. Inspected authenticated phase history, missing/failed decision refusal, fixed review/admitted links, retained producer log bytes and expiry, calibration members, lower-level diagnostic selection/controller use, zero diagnostic coverage, compact transport, and the additional total-history ceiling. Timestamped skipped phases are excluded only with the stated contradiction checks.
4. Verified retained discovery output says 204 tests passed in 201.305 seconds. The frozen full-wrapper API evidence reports a maximum of 513 calls within its synthetic 56-total-attempt admission envelope. These are supplied, hash-verified local results, not a newly rerun suite or actual native sizing. I did not rerun unchanged full suites.
5. Real Linux fixture interruption/resume, final full native inventory sizing, actual caught-control execution, upload/cleanup measurements, root's external decision, and eventual exhaustive production completion remain required. They are pending operational gates, not additional code findings.

Only this ignored review report was authored. Source, tests, dependencies, Git state, workflows and browser state were not edited or operated.

**Next steps**: Correct and narrowly verify the capped campaign forecast, then obtain review of that repair before root performs the first push and actual qualification. No user answer is needed for this review.
