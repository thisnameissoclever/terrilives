# Completed-job anchor quality and security review

Changes requested for one narrow transport error-handling defect. The stable-anchor design, persistence, consumer ordering, finite request accounting and root YAML/docs changes otherwise pass this scoped review. This does not establish actual Actions-token behavior, fixture qualification or native mutation coverage.

## Frozen identity

1. Baseline supplied by root: `6f75d367d99a026bccf69aae58753164541a480c`. Independently calculated the package SHA-256 as `3e53b0ee8b52389f14c8de6604d67df5e6679dc643cad1ab789b827d67cfb221`. Every one of the eight current Python files matches its exact after-byte SHA-256 and byte count in `github-log-anchor-hashes.json`. No source was changed during this review.
2. Independently calculated the root package SHA-256 as `fbbcb6d623855c47f18377cf8be5762a05c82138c6cfe78da54fd6e6164908d8`, length 6412 bytes. Current ci.yml, mutation-campaign.md and lessons-learned.md match all three hashes and byte counts in `github-log-anchor-root-hashes.json`.
3. Read the approved architecture, design review, implementation brief, frozen diff/report, control receipt and current consumers. Root supplied the narrow root diff so no Git command was needed. The memory search returned no relevant transport history; no memory-derived fact informed the findings.

## Finding

1. **[P2] Sanitize HTTP parser exceptions at the probe boundary.** `.github/scripts/mutation_recovery.py:783` catches `urllib.error.URLError` and `OSError`, but `http.client.BadStatusLine` inherits from `HTTPException`, not either caught class. Python urllib calls `h.getresponse()` and re-raises this exception without wrapping it. A malformed HTTP response can therefore escape with raw response text. `mutation_workflow.main` does not catch HTTPException either, so this path also bypasses its structured infrastructure-failure status and emits an ordinary traceback. This violates the approved safe transport-category error contract. Catch HTTPException at the same boundary, emit only its class/category and the already validated resource identity, and suppress the original exception context. Add opener-boundary tests for malformed status/header responses that require sanitized errors, one charged request and no failure cache. Do not add retry or fallback behavior.

The isolated read-only reproduction injected `http.client.BadStatusLine('signed-location-secret-fixture')` through the existing opener boundary, then called `probe_job_logs('owner/repo', '100', 1, '901')`. Observed output:

```text
BadStatusLine signed-location-secret-fixture requests= 1 cached= False
```

The marker is synthetic. This proves raw error text can escape; it does not claim an actual credential or signed URL has leaked. Inspection of the installed urllib implementation confirmed its unwrapped getresponse path. No network request was made.

## Reviewed behavior

1. Original plan recording precedes preliminary inventory. Final refresh still requires availability after authenticated restoration and ingestion. Seal/load require exact anchor coverage of the bounded chain/source union. Missing originals, digest checks, original expiry and terminal failure handling remain in the acceptance path.
2. First selection orders required original producers by attempt and numeric job ID. Later refresh preserves the complete selected row and validates exact completed-job metadata. The receipt-free planning anchor survives authenticated prepared and aggregate snapshots; its null original reference cannot add mutation results. The selected job is never replaced after a failed probe. Current jobs cannot select themselves.
3. HTTP success uses an exact repository job endpoint, NoRedirect, HTTPS Location validation and an exact repository/run/attempt/job success cache. The redirect body is not read and the signed destination is neither followed nor stored. Aside from the parser-exception finding, checked status and ordinary network failures report sanitized identities/categories.
4. Preflight reuses current run/jobs/rate observations, checks the completed changes predecessor including its actual earlier attempt, and keeps the historical job input diagnostic-only. The root YAML change is exactly the optional string input and environment forwarding in the existing fixture-tool step. No job, edge, permission, concurrency group or cap changed.
5. Native changes add complete future anchor shapes and preserve existing larger seed rows. Forecast, selection, admission algorithms and budgets are unchanged. The measured 602 distinct-root composition, 563 shared case and 493 native gate are bounded fixture measurements, not universal guarantees. Broader histories still face existing capacity refusal.
6. Root documentation accurately distinguishes selected-job redirect issuance, original retained evidence, expiry, fixture qualification and production results. This internal transport repair needs no player-facing guide, screenshot or changelog entry.

## Evidence limits

I inspected the retained local results and all three control receipts. The controls report unchanged positive passes and ordinary assertion failures for current-run omission, anchor substitution and future-shape omission. I did not repeat heavy tests, run Cargo, execute native mutations, call GitHub, dispatch workflows, use a browser or mutate Git. The only local execution beyond hashes and inspection was the small malformed-status reproduction. Local mocks and fixture counts do not establish the actual Actions-token contract. Root retains ownership of the same-token preflight, actual interrupted/resumed fixture and full authorized delivery.

**Next steps**: Repair the single HTTPException gap, freeze updated source/test hashes and obtain focused re-review. Then root can proceed with the actual same-token preflight and remaining acceptance work; no user decision is needed.
